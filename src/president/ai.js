/* ============================================================
   president/ai.js — THE OTHER PRESIDENTS. Same desk, same levers.

   An AI president reads the same numbers a human reads off his papers and
   decides through the SAME apply(S, action) a human's tap goes through, so
   nothing an AI does is a shortcut a player cannot take, and nothing a
   player can do is invisible to an AI. Every AI decision is deterministic
   (the state's own stream), so the world is identical on every machine in
   a multiplayer room.

   WHO HE IS. Each leader carries four dials, rolled when he takes office
   (a successor gets new ones, so a fallen rival's country changes its mind):
     aggr   how readily he reaches for the army
     mad    how far he will go: printing, nukes, assassination
     auth   how much he cares about elections and the press
     prot   protectionism and caution: tariffs, missile defense

   CONQUEST. A beaten country gives up (yields); a victor swallows what it
   can digest and keeps the rest as a puppet; a master with an appetite
   annexes his puppets after a year; a puppet does not pick its own wars.

   PUBLIC  CBZ.presWorld.ai = { turn(S, c, apply), accepts(S, T, from, kind, terms),
                                takesBailout(S, T, lender, amt, strings), yields(S, T, by) }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  function W() { return CBZ.presWorld; }
  function r(S) { return W().rnd(S); }
  function once(S, c, key, gap) {
    const m = c.memo, k = "ai_" + key;
    if (m[k] != null && S.day - m[k] < gap) return false;
    m[k] = S.day; return true;
  }
  function str(S, c) { return W().strength(c); }
  function bloc(S, c) {
    let s = str(S, c);
    for (const a of c.allies) if (S.c[a] && S.c[a].alive) s += str(S, S.c[a]) * 0.5;
    return s;
  }

  function turn(S, c, apply) {
    const L = c.leader, PW = W();
    const act = function (a) { a.c = c.id; return apply(S, a); };
    const B = c.budget;
    const def = -c.deficit / Math.max(1, c.gdp) * 100;
    const dr = PW.debtRatio(c);

    // ---- 1. the books
    // austerity is for a deficit the market will not fund, once a month
    if ((c.yld > 8 || c.crisis) && def > 1 && once(S, c, "austere", 28)) {
      if (B.welfare > 7) act({ type: "budget", k: "welfare", v: B.welfare - 0.8 });
      if (B.infra > 1.2) act({ type: "budget", k: "infra", v: B.infra - 0.3 });
      if (c.tax < 42) act({ type: "tax", v: c.tax + 1 });
      if (c.crisis && L.mad > 0.6 && c.print < 6 && once(S, c, "print", 120)) act({ type: "print", v: c.print + 3 });
    } else if (def > 5 && c.tax < 40 && once(S, c, "taxup", 60)) act({ type: "tax", v: c.tax + 1 });
    else if (c.yld < 6 && c.u > 7.5 && def < 4 && once(S, c, "stim", 45)) {
      act({ type: "budget", k: "infra", v: B.infra + 0.3 });
      if (B.welfare < 18) act({ type: "budget", k: "welfare", v: B.welfare + 0.4 });
    } else if (def < -1.5 && c.tax > 16 && once(S, c, "taxcut", 90)) act({ type: "tax", v: c.tax - 1 });
    else if (c.yld < 4 && def < 1 && c.approval < 45 && c.tax > 18 && once(S, c, "taxcut", 120)) act({ type: "tax", v: c.tax - 1 });
    if (c.print > 0 && (c.infl > 15 || (!c.crisis && L.mad < 0.6))) act({ type: "print", v: Math.max(0, c.print - 1) });

    // ---- 2. the army and the shield
    let threat = 0;
    for (const o of S.c) {
      if (!o.alive || o.id === c.id || c.allies.indexOf(o.id) >= 0) continue;
      if (S.rel[c.id][o.id] > 0) continue;
      if (!PW.reach(S, c.id, o.id)) continue;
      threat = Math.max(threat, str(S, o) / Math.max(0.5, bloc(S, c)));
    }
    // from what the country is used to spending (Costa Rica does not rearm like Russia), up with the threat and the war
    const base = Math.max(0.2, c.memo.mil0 != null ? c.memo.mil0 : 2);
    const milT = clamp(base * (0.85 + L.aggr * 0.4) + (threat > 1 ? Math.max(0.6, base * 0.5) : threat > 0.6 ? Math.max(0.25, base * 0.2) : 0)
      + (c.war.length ? Math.max(1.2, base) : 0), 0, Math.max(9, base * 1.2)) * (c.crisis ? 0.7 : 1);
    if (Math.abs(B.military - milT) > 0.15) act({ type: "budget", k: "military", v: B.military + clamp(milT - B.military, -0.25, 0.25) });
    const misT = clamp(0.2 + L.prot * 0.6 + (threat > 0.8 ? 0.4 : 0) + (c.war.length ? 0.4 : 0), 0, 3);
    if (Math.abs(B.missile - misT) > 0.1) act({ type: "budget", k: "missile", v: B.missile + clamp(misT - B.missile, -0.1, 0.1) });

    // ---- 3. the street
    if (c.unrest > 55) {
      if (L.auth > 0.5 && once(S, c, "crack", 60)) act({ type: "crackdown" });
      else if (B.security < 3) act({ type: "budget", k: "security", v: B.security + 0.3 });
      if (c.unrest > 80 && L.auth > 0.7 && !c.martial) act({ type: "martial", on: 1 });
    }
    if (c.martial && c.unrest < 20 && (L.auth < 0.85 || c.martial > 400)) act({ type: "martial", on: 0 });
    if (c.unrest < 15 && B.security > 2.4 && L.auth < 0.5) act({ type: "budget", k: "security", v: B.security - 0.2 });

    // ---- 4. elections
    if (c.elections && c.nextElection - S.day < 60 && c.nextElection > S.day && PW.voteShare(S, c) < 48) {
      if (L.auth > 0.85 && c.freedom < 40) act({ type: "cancelElections" });
      else if (L.auth > 0.55 && once(S, c, "postpone", 700)) act({ type: "postpone" });
    }
    if (!c.elections && L.auth < 0.3 && c.unrest > 60 && once(S, c, "restore", 900)) act({ type: "restoreElections" });

    // ---- 5. the bank
    if (L.auth > 0.6 && c.rate > 8 && c.approval < 40 && once(S, c, "lean", 240)) act({ type: "rate", v: c.rate - 2 });
    if (L.mad > 0.8 && c.cab.bank.loyalty < 30 && c.cbIndep > 0.5 && once(S, c, "firebank", 500)) act({ type: "fire", role: "bank" });

    // ---- 6. trade
    for (const o of S.c) {
      if (!o.alive || o.id === c.id) continue;
      const theirs = o.tariffs[c.id];
      const hit = theirs && Object.keys(theirs).some(function (g) { return theirs[g] > 0; });
      const mine = c.tariffs[o.id];
      if (hit && !mine && L.prot > 0.3 && once(S, c, "ret" + o.id, 90)) {
        const g = Object.keys(theirs).filter(function (k) { return theirs[k] > 0; })[0];
        act({ type: "tariff", t: o.id, good: PW.topImport(S, c, o.id), v: Math.max(0.2, theirs[g]) });
      }
      if (!hit && mine && L.prot < 0.6 && S.rel[c.id][o.id] > 25 && once(S, c, "lift" + o.id, 180)) {
        for (const g in mine) act({ type: "tariff", t: o.id, good: g, v: 0 });
      }
      if (L.prot > 0.75 && !mine && S.rel[c.id][o.id] < 5 && once(S, c, "prot" + o.id, 365)) {
        const g = PW.topImport(S, c, o.id);
        const gi = PW.GI[g];
        if (S.flow && S.flow[gi][c.id][o.id] > c.dem[gi] * 0.15) act({ type: "tariff", t: o.id, good: g, v: 0.15 });
      }
      if (S.rel[c.id][o.id] > 40 && c.deals.indexOf(o.id) < 0 && !mine && !hit && c.war.indexOf(o.id) < 0 && o.human == null && once(S, c, "deal" + o.id, 240)) act({ type: "deal", t: o.id });
      // sanctions: the free world against the unfree, lifted when things mend
      const sn = c.sanctions.indexOf(o.id) >= 0;
      if (!sn && c.freedom > 65 && o.freedom < 30 && S.rel[c.id][o.id] < -60 && once(S, c, "sanc" + o.id, 200)) act({ type: "sanction", t: o.id, on: 1 });
      if (sn && S.rel[c.id][o.id] > 5 && once(S, c, "unsanc" + o.id, 200)) act({ type: "sanction", t: o.id, on: 0 });
      // alliances: friends with a common problem
      if (c.allies.indexOf(o.id) < 0 && S.rel[c.id][o.id] > 50 && c.war.indexOf(o.id) < 0 && o.human == null && threat > 0.7 && once(S, c, "ally" + o.id, 300)) act({ type: "alliance", t: o.id });
      // a foreign leader who hates a human says so where everyone can read it
      if (o.human != null && !o.out && S.rel[c.id][o.id] < -60 && once(S, c, "threat" + o.id, 220)) act({ type: "post", v: "threaten", t: o.id });
    }

    // ---- 7. war
    // a master swallows his puppets once they are used to it
    if (c.lord < 0 && L.aggr > 0.35) for (const o of S.c) {
      if (!o.alive || o.lord !== c.id || S.day - (o.lordDay || 0) < 365) continue;
      if (once(S, c, "annex" + o.id, 180) && r(S) < 0.5 + L.aggr * 0.4) act({ type: "annex", t: o.id });
    }
    if (!c.war.length && L.aggr > 0.55 && !c.crisis && c.lord < 0) {
      // a democracy needs a far worse grudge, and starts far fewer wars, than a strongman
      // (unless the scenario is a country coming apart: then every governor is a strongman)
      const sc = PW.scen(S), dem = c.regime === "democracy" && !sc.tension, cold = dem ? -40 : -25;
      let best = null, bs = 0, bReach = 0;
      for (const o of S.c) {
        if (!o.alive || o.id === c.id || c.allies.indexOf(o.id) >= 0) continue;
        if (S.rel[c.id][o.id] > cold || o.lord === c.id) continue;
        const rc = PW.reach(S, c.id, o.id);
        if (rc < 1) continue;
        const ratio = str(S, c) / Math.max(0.3, bloc(S, o));
        // the neighbour across a land border first; an invasion over water is a bigger thing
        const score = ratio * (rc === 2 ? 1 : 0.5);
        if (ratio > 1.6 && score > bs) { bs = score; best = o; bReach = rc; }
      }
      // a war is a big decision: a weak, cold neighbour, and a reason to want
      // one (a falling approval, or a man who simply likes them)
      // (and rarer in the first months: the world on day one is the world as it is)
      // a country that has just fought catches its breath, and every conquest makes the next one dearer
      const rested = S.day - (c.memo.peaceDay != null ? c.memo.peaceDay : -1e9) > 540;
      const mood = (dem ? 0.35 : c.regime === "hybrid" ? 0.7 : 1) * (sc.tension || 1) * (bReach === 2 ? 1 : 0.4) / (1 + (c.memo.taken || 0) * 0.5);
      if (best && rested && (c.approval < 40 + (sc.tension ? 15 : 0) || (L.aggr > 0.85 && bs > 2)) && r(S) < L.aggr * 0.035 * mood * (S.day < 180 ? 0.25 : 1)) {
        const k = "ult" + best.id;
        if (best.human != null && !best.out) {
          // a human gets the call first
          if (c.memo[k] == null) {
            c.memo[k] = S.day;
            if (CBZ.presWorld._matter) CBZ.presWorld._matter(S, best, "ultimatum", "leader:" + c.id, { t: c.id }, [
              { label: "Back down", act: { type: "backDown", t: c.id } },
              { label: "Hang up", act: { type: "noop" } },
            ], 15);
          } else if (S.day - c.memo[k] > 15) { delete c.memo[k]; act({ type: "war", t: best.id }); }
        } else act({ type: "war", t: best.id });
      }
    }
    for (const e of c.war) {
      const E = S.c[e];
      if (!E || !E.alive) continue;
      const ratio = str(S, c) / Math.max(0.3, str(S, E));
      act({ type: "posture", t: e, v: ratio > 0.9 || c.posture[e] === "attack" && ratio > 0.7 ? "attack" : "hold" });
      if (c.planes >= 6 && once(S, c, "strike" + e, 12 + Math.floor((1 - L.aggr) * 20))) {
        const tg = PW.bestTarget(S, e);
        if (tg) act({ type: "strike", t: e, p: tg.p, what: tg.what });
      }
      const occ = PW.occupiedShare(S, c);
      // the button nobody should press
      if (c.nukes > 0 && L.mad > 0.55 && (occ > 0.35 || S.p[c.cap].ctl !== c.id) && once(S, c, "nuke" + e, 60)) {
        const p = PW.biggestCity(S, e);
        if (p != null) act({ type: "nuke", t: e, p: p });
      }
      // the world's problem: a country caught killing leaders, or that has
      // already used the bomb, hated by everyone, gets it back
      const pariah = E.heat.plot > 25 || S.log.some(function (ev) { return ev.k === "nuke" && ev.c === e && S.day - ev.d < 365; });
      if (c.nukes > 0 && L.mad > 0.6 && pariah && S.rel[c.id][e] < -80 && once(S, c, "pariah" + e, 120)) {
        const p = PW.biggestCity(S, e);
        if (p != null) act({ type: "nuke", t: e, p: p });
      }
      // winning: ask them to give up (they say yes when they are beaten)
      if (c.posture[e] === "attack" && ratio > 1.2 && PW.occupiedShare(S, E) > 0.3 && once(S, c, "demand" + e, 45)) act({ type: "surrender", t: e });
      if (c.lord >= 0) continue;                                  // a puppet's peace is its master's
      if (c.warDays > 200 && (occ > 0.25 || ratio < 0.7 || c.approval < 30) && once(S, c, "peace" + e, 60)) act({ type: "peace", t: e, terms: "white" });
      else if (c.warDays > 300 && ratio > 1.8 && c.gained > 2 && once(S, c, "peaceS" + e, 90)) act({ type: "peace", t: e, terms: "status" });
    }
    // somebody used a nuke on a friend: the mad answer in kind
    if (c.nukes > 0 && L.mad > 0.7) {
      for (let i = S.log.length - 1; i >= 0 && i > S.log.length - 30; i--) {
        const ev = S.log[i];
        if (ev.k !== "nuke" || S.day - ev.d > 7 || ev.c === c.id) continue;
        if ((ev.t === c.id || c.allies.indexOf(ev.t) >= 0) && once(S, c, "answer" + ev.c, 60)) {
          const p = PW.biggestCity(S, ev.c);
          if (p != null) act({ type: "nuke", t: ev.c, p: p });
        }
      }
    }
    if (!c.nukes && !c.nukeProg && L.mad > 0.6 && S.c.some(function (o) { return o.alive && o.nukes > 0 && S.rel[c.id][o.id] < -40; }) && once(S, c, "prog", 2000)) act({ type: "nukeProgram" });

    // ---- 8. a knife in the dark
    if (L.mad > 0.78 && once(S, c, "plot", 900)) {
      for (const o of S.c) {
        if (!o.alive || o.id === c.id || !o.leader.original) continue;
        if (S.rel[c.id][o.id] < -65 && r(S) < 0.25) { act({ type: "assassinate", t: o.id }); break; }
      }
    }

    // ---- 9. money for friends, with strings
    if (c.yld < 5 && dr < 0.9 && !c.crisis && once(S, c, "lend", 120)) {
      for (const o of S.c) {
        if (!o.alive || o.id === c.id || !(o.crisis || o.yld > 10)) continue;
        if (o.gdp > c.gdp * 0.6 || S.rel[c.id][o.id] < -10 || c.war.indexOf(o.id) >= 0) continue;
        if (o.loans.some(function (l) { return l.from === c.id; })) continue;
        act({ type: "bailout", t: o.id, amt: Math.round(o.gdp * 0.12), strings: L.aggr > 0.6 ? "bases" : L.prot > 0.5 ? "trade" : "alliance" });
        break;
      }
    }
    // ...and the walk-away
    for (const l of c.loans) {
      if (S.rel[c.id][l.from] < -45 && (c.crisis || L.mad > 0.7) && once(S, c, "welsh" + l.from, 365)) { act({ type: "defaultLoan", t: l.from }); break; }
    }
  }

  function accepts(S, T, from, kind, terms) {
    const rel = S.rel[T.id][from.id], PW = W();
    if (kind === "deal") return rel > 15 && T.war.indexOf(from.id) < 0 && T.leader.prot < 0.85;
    if (kind === "alliance") {
      const common = T.war.some(function (e) { return from.war.indexOf(e) >= 0; });
      return rel > 45 || (rel > 20 && (common || str(S, from) > str(S, T) * 1.5));
    }
    if (kind === "peace") {
      const ratio = str(S, T) / Math.max(0.3, str(S, from));
      const occ = PW.occupiedShare(S, T);
      if (terms === "status") return occ > 0.3 || ratio < 0.5 || T.warDays > 700;
      // a white peace hands back what he took: a man holding the other side's
      // land does not sign that for being tired, only for losing
      const holds = S.p.some(function (p) { return p.owner === from.id && p.ctl === T.id; });
      return occ > 0.15 || ratio < 0.85 || (!holds && (T.warDays > 400 || T.approval < 32));
    }
    return false;
  }
  // a country gives up when it is beaten: its capital gone, most of it held, or no army left to speak of
  function yields(S, T, by) {
    const PW = W(), occ = PW.occupiedShare(S, T), ratio = str(S, T) / Math.max(0.3, str(S, by));
    if (T.cap >= 0 && S.p[T.cap].ctl !== T.id && occ > 0.3) return true;
    if (occ > 0.5 && ratio < 0.9) return true;
    if (occ > 0.3 && ratio < 0.45) return true;
    return ratio < 0.15 && T.warDays > 120;
  }
  function takesBailout(S, T, L, amt, strings) {
    const rel = S.rel[T.id][L.id];
    const need = T.crisis > 0 || T.yld > 9;
    if (!need || rel < -30) return false;
    if (strings === "bases") return T.crisis > 0 && rel > 0 && T.leader.prot < 0.8;
    if (strings === "alliance") return rel > -10 && T.war.every(function (e) { return L.allies.indexOf(e) < 0; });
    return true;
  }

  const AI = { turn: turn, accepts: accepts, takesBailout: takesBailout, yields: yields };
  if (CBZ.presWorld) CBZ.presWorld.ai = AI;
  else CBZ.presWorldAI = AI;
  if (typeof module !== "undefined" && module.exports) module.exports = AI;
})(typeof globalThis !== "undefined" ? globalThis : this);
