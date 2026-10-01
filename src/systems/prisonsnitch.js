/* ============================================================
   systems/prisonsnitch.js — TELLING.

   OWNER (2026-09-28): "no matter what, you can never snitch. It never lets
   me snitch anything, and I don't like that. I want to be able to snitch."

   The old verb was a warden-only button gated on YOUR heat ("you're not in
   enough trouble to need me"), and what it sold was a random rival's name
   the player had never seen. So a man who had just watched a stabbing had
   nothing to say about it. This file is the whole informant loop, built on
   what the player actually KNOWS:

     KNOWING   what you saw with your own eyes (a stabbing, a killing, a man
               jumping another, a blade out, a man selling), what you heard
               (a man telling his cellie he is going over the fence tonight),
               what you did (the officer you paid), what your car told you
               (where the stash is), and the warden's gun if it walks. Each
               is a FACT with a man, a time, and whether anybody else saw it.
     TELLING   "Snitch" on a guard (quick, worth less, leaks) or on the warden
               (in his office; he sends for you, worth the most). The card
               turns into what you know, as short items. You can also just
               put a name in: that is a lie unless the man is really holding.
     THE WORLD an officer walks to the man and tosses him. Found: cuffed,
               walked, moved to seg (a killer is transferred out for good).
               A stash gets raided, a bent officer loses his racket, a runner
               never runs. Nothing: the lie is caught, and it comes back.
     FAVORS    paid when it checks out: time off (or the warden's ear toward
               walking out), a phone call, an officer who looks away once,
               cigarettes.
     THE COST  inmates who SEE you talking to staff know. A guard's mouth
               leaks. Information only you had points at you once it is
               acted on. Knowing spreads man to man; your own car turns on
               you past a line; the men you named come for you. The warden
               can put an officer on you (protection).

   Few words, all in mouths. No popups, no ledger on screen.
   Plain-node sim: tools/snitch-sim.mjs loads this file with a stub world.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;

  /*<core>  pure decisions: no CBZ, no THREE */
  const CORE = (function () {
    // what a fact is worth to the man who hears it (warden scale)
    const KIND = {
      kill:   { v: 10 },
      gun:    { v: 10 },
      stab:   { v: 9 },
      escape: { v: 8 },
      stash:  { v: 7 },
      bent:   { v: 6, guardV: 1 },     // a screw about a screw: he closes ranks
      blade:  { v: 5 },
      sells:  { v: 4 },
      fight:  { v: 3 },
      lie:    { v: 4 },                 // what it claims to be worth, until checked
    };
    const GUARD_MUL = 0.5;
    const FRESH_H = 3, STALE_H = 30;    // in-game hours
    function fresh(ageH) {
      if (ageH <= FRESH_H) return 1;
      if (ageH >= STALE_H) return 0;
      return 1 - 0.65 * (ageH - FRESH_H) / (STALE_H - FRESH_H);
    }
    function value(f, to, now, hourLen) {
      const K = KIND[f.kind] || { v: 1 };
      const base = to === "warden" ? K.v : (K.guardV != null ? K.guardV : K.v * GUARD_MUL);
      if (f.kind === "lie") return base;
      return base * fresh((now - f.at) / (hourLen || 30));
    }
    function leakChance(to, corrupt) { return to === "warden" ? 0.04 : 0.28 + (corrupt ? 0.36 : 0); }
    // how much the yard's read of you moves
    function exposure(f, o) {
      let rep = Math.min(32, (o.witnesses | 0) * 8);
      if (o.acted && f.sole) rep += 12;
      if (o.leaked) rep += 14;
      if (o.lieCaught) rep += 5;
      return rep;
    }
    // does the man it is about know it was you
    function targetKnows(f, o) { return !!(o.leaked || (f.sole && o.acted) || o.targetSaw || o.lieCaught); }
    function favor(val, to, st) {
      st = st || {};
      if (to !== "warden") return val >= 2.5 ? "pass" : "cigs";
      if (val >= 8.5) return "time";
      if (val >= 5.5) return st.phone ? "pass" : "phone";
      if (val >= 1.5) return "cigs";
      return "none";
    }
    function cigsFor(val, to) { return Math.max(1, Math.round(val * (to === "warden" ? 1.1 : 0.8))); }
    // the check: a lie survives only if the man turns out to be holding anyway
    function checkOut(f, holds) { return f.kind !== "lie" || !!holds; }
    // your car turns: a third of it knowing, or the yard's read over the line
    const CAR_FRAC = 0.34, CAR_REP = 35;
    function carTurns(rep, carKnow, carSize) {
      return rep >= CAR_REP || (carSize > 0 && carKnow / carSize >= CAR_FRAC);
    }
    function protectionOffered(rep, hunted) { return rep >= 25 || !!hunted; }
    // what only a search can prove (he is holding it, or he is not)
    const PHYSICAL = { blade: 1, sells: 1, gun: 1, lie: 1 };
    // how long a man is gone for it (in-game hours; Infinity = transferred out)
    const SEG_H = { kill: Infinity, stab: 12, gun: 12, escape: 12, blade: 4, sells: 3, lie: 3, fight: 0, stash: 0, bent: 0 };
    function key(f) { return f.kind + "|" + (f.whoId != null ? f.whoId : f.who || "") + "|" + (f.otherId != null ? f.otherId : f.other || ""); }
    // add or refresh; a fact you already told stays told
    function learn(list, f, now) {
      const k = key(f);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.key !== k) continue;
        if (!o.told) { o.at = now; o.sole = o.sole && f.sole; }
        return o;
      }
      f.key = k; f.at = now; f.told = false;
      list.push(f);
      if (list.length > 14) {
        // forget the stalest untold thing first
        let wi = -1, wa = Infinity;
        for (let i = 0; i < list.length; i++) if (list[i].at < wa) { wa = list[i].at; wi = i; }
        if (wi >= 0) list.splice(wi, 1);
      }
      return f;
    }
    // up to `max` things worth saying to this listener, best first
    function menu(list, to, now, hourLen, max, usable) {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.told || (usable && !usable(f))) continue;
        const v = value(f, to, now, hourLen);
        if (v < 0.4) continue;
        out.push({ f: f, v: v });
      }
      out.sort(function (a, b) { return b.v - a.v; });
      return out.slice(0, max || 3).map(function (o) { return o.f; });
    }
    function label(f) {
      const w = f.who || "Him", o = f.other || "a man";
      switch (f.kind) {
        case "kill":   return w + " killed " + o;
        case "stab":   return w + " stabbed " + o;
        case "fight":  return w + " jumped " + o;
        case "blade":  return w + "'s blade";
        case "sells":  return w + " sells " + (f.item || "dope");
        case "escape": return w + "'s running";
        case "bent":   return w + " is bent";
        case "stash":  return w + " stash";
        case "gun":    return w === "Him" ? "The warden's gun" : w + " has the gun";
        case "lie":    return "Name " + w;
        default:       return w;
      }
    }
    return { KIND: KIND, fresh: fresh, value: value, leakChance: leakChance, exposure: exposure,
      targetKnows: targetKnows, favor: favor, cigsFor: cigsFor, checkOut: checkOut, carTurns: carTurns,
      protectionOffered: protectionOffered, SEG_H: SEG_H, PHYSICAL: PHYSICAL, key: key, learn: learn, menu: menu, label: label,
      CAR_FRAC: CAR_FRAC, CAR_REP: CAR_REP };
  })();
  /*</core>*/

  const g = CBZ.game;
  if (!g) return;

  // ---- the few things people say. Short, real, in mouths. ----
  const LINE = {
    guardHears: ["Alright. I'll look at it.", "Noted. Now walk."],
    guardShrug: ["That's it?", "Not my problem."],
    guardNoMore: ["You lied last time. Walk."],
    goOn: ["Go on.", "Talk."],
    wardenHears: {
      time: "If it checks out, it's time off.",
      phone: "If it checks out, you get a call.",
      pass: "If it checks out, my officers owe you one.",
      cigs: "If it checks out, there's something in it.",
      none: "Noted.",
    },
    wardenFloor: ["Not here. My office."],
    hands: ["Hands on the wall."],
    found: ["Look at that.", "What's this, then."],
    clean: ["Clean.", "Nothing on him."],
    named: ["You talked.", "You went to the man."],
    carTurn: ["You're done with us.", "We don't run with a rat."],
    pcEscort: ["Warden says I'm on you."],
    once: ["Once. Go."],
  };
  let seq = 0;
  function pick(list) { seq++; return list[(seq * 5 + ((S.now * 7) | 0)) % list.length]; }
  function say(a, line, secs) {
    if (!a || !line || !CBZ.prisonSay) return false;
    try { return !!CBZ.prisonSay(a, line, { force: true, secs: secs || 2.4 }); } catch (e) { return false; }
  }
  function rng() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function hourLen() {
    const s = CBZ.prisonSchedule;
    const h = s && s.hourLength ? +s.hourLength() : 30;
    return h > 0 ? h : 30;
  }
  function P() { return CBZ.player && CBZ.player.pos; }
  function pos(a) { return a && (a.group ? a.group.position : a.pos); }
  function dist(a, b) { const p = pos(a), q = pos(b); return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity; }
  function alive(a) { return !!(a && !a.dead && !a.escaped && a.group); }
  function up(a) { return alive(a) && !(a.ko > 0); }
  function isStaff(a) { return !!(a && (a.kind === "guard" || a.kind === "warden")); }
  function inmates() { return CBZ.npcs || []; }
  function inPrison() { return g.mode === "escape" && g.role !== "cop"; }
  function nameOf(a) {
    const s = String((a && a.data && a.data.name) || "").replace(/^(the|a|an) /i, "");
    if (!s) return "Him";
    if (isStaff(a)) return s.charAt(0).toUpperCase() + s.slice(1);
    const q = s.match(/['"‘“]([^'"’”]+)['"’”]/);
    if (q) return q[1];
    const f = s.split(/\s+/)[0];
    return f.charAt(0).toUpperCase() + f.slice(1);
  }
  const CONTRA = /shiv|shank|knuckle|razor|burner|phone|pills|powder|hooch|painkiller|lockpick|handcuff key|hacksaw|contraband map|rope|revolver|pistol|shotgun|gun/i;

  /* ---- CARS (systems/prisoncars.js): six racial cars keyed by heritage.
     Every man, the player included, has one. A man whose car turned on him
     for talking is out of it here (S.carTurned), whatever his skin says. ---- */
  function cars() { return CBZ.prisonCars || null; }
  function carOf(a) {
    if (!a) return null;
    if (a === CBZ.player && S.carTurned) return null;
    const C = cars();
    if (C && C.carOf) {
      try { const c = C.carOf(a); return c != null && c >= 0 ? c : null; } catch (e) {}
    }
    if (a === CBZ.player) { const pg = CBZ.player && CBZ.player.gang; return pg != null && pg >= 0 ? pg : null; }
    return a.gang != null && a.gang >= 0 ? a.gang : null;
  }
  function carName(c) {
    const C = cars();
    if (C && C.label) { try { const n = C.label(c); if (n) return String(n); } catch (e) {} }
    return "crew";
  }
  function stashOf(c) {
    const C = cars();
    const Y = C && C.CARS && C.CARS[c] && C.CARS[c].yard;
    return Y ? { x: Y.x, z: Y.z } : null;
  }
  function expelPlayer() {
    // the door out is prisoncars.js's leave(): from here playerCar() is -1
    // for every system (seats, phones, showers, recruits, the claim). The
    // gang standing hit stays here, it is this file's consequence.
    const gid = CBZ.player.gang;
    const C = cars();
    if (C && C.leave) { try { C.leave("outcast"); } catch (e) {} }
    CBZ.player._carOutcast = true;
    if (gid != null && gid >= 0) {
      CBZ.player.gang = null;
      if (CBZ.player._bandMesh) CBZ.player._bandMesh.visible = false;
      if (CBZ.addGangStanding) CBZ.addGangStanding(gid, -45);
    }
  }

  // ---- state ----
  const S = {
    now: 0,
    facts: [],
    mode: null,               // {a, items, until}
    tasks: [],                // officers walking to check what you said
    seg: [],                  // men moved out of the yard for it
    knowers: new Set(),       // inmates who know you talk
    carTurned: false,
    pc: null,                 // {gd, until}
    plan: null,               // a man planning to go over the fence
    heard: 0, scanT: 0, socialT: 0, planT: 0, retalT: 0,
    lastGun: 0,
    log: { learned: 0, told: 0, checked: 0, lies: 0, caught: 0, favors: 0, segs: 0, retaliations: 0, spread: 0 },
  };
  function rep() { return g.snitchRep || 0; }
  function addRep(n, why) {
    if (!(n > 0)) return;
    g.snitchRep = Math.min(100, rep() + n);
    // the block's gossip channel (entities/ai.js blockRumor) carries it
    const br = g.blockRumor || (g.blockRumor = { fear: 0, wealth: 0, heat: 0, badge: 0, snitch: 0, debt: 0, last: "" });
    br.snitch = Math.min(100, (br.snitch || 0) + n * 0.8);
    br.last = why || "snitch";
    const yr = CBZ.prisonYardRep ? CBZ.prisonYardRep() : null;
    if (yr) yr.snitch = Math.max(yr.snitch || 0, Math.floor(rep() / 20));
  }
  function know(m, why) {
    if (!m || isStaff(m) || m === CBZ.player || S.knowers.has(m)) return false;
    S.knowers.add(m);
    m._knowsRat = true;
    m.playerTrust = Math.max(-20, (m.playerTrust || 0) - 6);
    return true;
  }

  /* ==========================================================
     1. KNOWING — only what the player could have seen or heard
     ========================================================== */
  const _obs = { pos: null, yaw: 0 };
  const _see = { range: 22, fovHalf: Math.PI, touch: 3 };
  function playerSees(x, z, range) {
    const p = P();
    if (!p || !isFinite(x) || !isFinite(z)) return false;
    const d = Math.hypot(x - p.x, z - p.z);
    const r = range || 22;
    if (d > r) return false;
    const per = CBZ.brain && CBZ.brain.perception;
    if (!per || !per.seesPoint) return true;
    _obs.pos = p; _see.range = r;
    try { return !!per.seesPoint(_obs, x, 0, z, _see); } catch (e) { return d < 10; }
  }
  // how many other inmates had eyes on that spot (the fact is "sole" if none)
  function otherEyes(x, z, skipA, skipB) {
    const per = CBZ.brain && CBZ.brain.perception;
    let n = 0;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m === skipA || m === skipB || !up(m)) continue;
      const q = m.group.position;
      if (Math.hypot(q.x - x, q.z - z) > 18) continue;
      let sees = true;
      if (per && per.seesPoint && m._brain) { try { sees = !!per.seesPoint(m, x, 0, z, { range: 18 }); } catch (e) { sees = true; } }
      if (sees && ++n >= 2) break;
    }
    return n;
  }
  function learn(f) {
    if (!inPrison() || !f || !f.kind) return null;
    if (f.whoA) { f.who = f.who || nameOf(f.whoA); f.whoId = f.whoA.id != null ? f.whoA.id : f.who; }
    if (f.otherA) { f.other = f.other || nameOf(f.otherA); f.otherId = f.otherA.id != null ? f.otherA.id : f.other; }
    const before = S.facts.length;
    const r = CORE.learn(S.facts, f, S.now);
    if (S.facts.length > before) S.log.learned++;
    return r;
  }
  // A MAN'S VIOLENCE, SEEN. brain_prison's one crime call and its morale hit
  // are the two places every inmate-on-inmate act passes through.
  function wrapBrain() {
    const PB = CBZ.prisonBrain;
    if (!PB || PB._snitchWrapped) return !!(PB && PB._snitchWrapped);
    PB._snitchWrapped = true;
    const crime0 = PB.crime;
    if (typeof crime0 === "function") {
      PB.crime = function (kind, x, z, perp, severity, info) {
        const r = crime0.apply(this, arguments);
        try {
          if (perp && perp !== CBZ.player && !isStaff(perp) && perp.group && playerSees(x, z)) {
            const victim = info && info.victim;
            const steel = !!perp._shankOut || kind === "stabbing";
            learn({ kind: steel ? "stab" : "fight", whoA: perp, otherA: victim && victim.group ? victim : null,
              sole: otherEyes(x, z, perp, victim) === 0, x: x, z: z });
          }
        } catch (e) {}
        return r;
      };
    }
    const down0 = PB.memberDown;
    if (typeof down0 === "function") {
      PB.memberDown = function (victim, by, killed) {
        const r = down0.apply(this, arguments);
        try {
          if (by && by !== CBZ.player && by.group && !isStaff(by) && victim && victim.group && !isStaff(victim)) {
            const vp = victim.group.position;
            const steel = !!by._shankOut || (by._steelT || 0) > 0;
            if ((killed || steel) && playerSees(vp.x, vp.z)) {
              learn({ kind: killed ? "kill" : "stab", whoA: by, otherA: victim,
                sole: otherEyes(vp.x, vp.z, by, victim) === 0, x: vp.x, z: vp.z });
            }
          }
        } catch (e) {}
        return r;
      };
    }
    return true;
  }
  function scan() {
    const p = P();
    if (!p) return;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      // (the merchants are the yard's fixed stalls; a dealer is a man you can name)
      if (!up(n) || n.role === "merchant") continue;
      const q = n.group.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      // steel out in the open
      if (n._shankOut && d < 14 && playerSees(q.x, q.z, 14)) {
        learn({ kind: "blade", whoA: n, sole: otherEyes(q.x, q.z, n) === 0 });
      }
      // his stall: you stood at it, you know what he moves
      const o = n.data && n.data.offer;
      if (o && o.item && CONTRA.test(o.item) && d < 4) learn({ kind: "sells", whoA: n, item: o.item, sole: false });
    }
    // THE OFFICER YOU PAID (econ.bribe stamps `bribed`), or the one who put the
    // racket to you: bent, and you are the one man who knows it for a fact
    const gs = CBZ.guards || [];
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (!gd || gd.kind === "warden" || !alive(gd)) continue;
      // a clean officer who took your street money is bent too
      const paid = (gd.bribed || 0) > 0 && dist(gd, CBZ.player) < 6;
      const pitched = !!(gd.corrupt && gd.approach && /racket|payoff/i.test(String(gd.approach.kind || "")) && dist(gd, CBZ.player) < 5);
      if (paid || pitched) learn({ kind: "bent", whoA: gd, sole: true });
    }
    // YOUR CAR'S STASH: running with a set means knowing where its things are
    const c = carOf(CBZ.player);
    if (c != null && !S.carTurned) {
      const at = stashOf(c);
      if (at) learn({ kind: "stash", who: carName(c), whoId: "car" + c, car: c, x: at.x, z: at.z, sole: true });
    }
  }

  /* ---- A RUN, PLANNED OUT LOUD. The yard's runners used to bolt on a 1.5%
     die roll with no warning; now one man at a time decides, says so to his
     cellie within earshot, and goes at the hour he named — unless somebody
     told. ---- */
  const PLAN_LINES = ["Tonight. I'm gone.", "I'm gone tonight. Don't say nothing."];
  function drivePlan(dt) {
    const H = hourLen();
    if (!S.plan) {
      S.planT -= dt;
      if (S.planT > 0) return;
      S.planT = H * (2 + rng() * 3);
      const list = inmates().filter(function (n) {
        return up(n) && !n.isLeader && n.role !== "merchant" && !n._seg && n.aiState !== "escape" && !n.cuffed;
      });
      if (!list.length) return;
      const n = list[Math.floor(rng() * list.length)];
      S.plan = { n: n, at: S.now + H * (2 + rng() * 2.5), sayT: 4, foiled: false, heard: false };
      return;
    }
    const pl = S.plan, n = pl.n;
    if (!alive(n) || n._seg || pl.foiled) { S.plan = null; return; }
    // he says it where a man could overhear
    pl.sayT -= dt;
    const d = dist(n, CBZ.player);
    if (pl.sayT <= 0 && d < 7 && n.aiState !== "fight" && !(n.huntPlayer > 0)) {
      pl.sayT = 30 + rng() * 20;
      if (CBZ.prisonSay) { try { CBZ.prisonSay(n, PLAN_LINES[(S.heard++) % PLAN_LINES.length], { secs: 2.4 }); } catch (e) {} }
      if (d < 6) { pl.heard = true; learn({ kind: "escape", whoA: n, sole: otherEyes(n.group.position.x, n.group.position.z, n) === 0 }); }
    }
    if (S.now >= pl.at) {
      if (up(n) && !n.cuffed) { n.aiState = "escape"; n.aiTimer = 0; }
      S.plan = null;
    }
  }

  /* ==========================================================
     2. TELLING
     ========================================================== */
  function wardenInOffice(a) {
    const W = CBZ.warden;
    if (!W) return false;
    if (W.meeting && W.meeting()) return true;
    const p = pos(a);
    return !!(W.inOffice && p && W.inOffice(p.x, p.z));
  }
  function listenerOf(a) { return a && a.kind === "warden" ? "warden" : "guard"; }
  // a name to put in when you have nothing: the man who has it in for you most
  function lieTarget() {
    let best = null, bs = 0;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!up(n) || n.role === "merchant" || n._seg || (n._accusedAt != null && S.now - n._accusedAt < hourLen() * 6)) continue;
      const s = (n.playerGrudge || 0) + (n.huntPlayer > 0 ? 4 : 0) + (carOf(n) != null && carOf(n) !== carOf(CBZ.player) ? 0.5 : 0);
      if (s > bs) { bs = s; best = n; }
    }
    return bs >= 2 ? best : null;
  }
  function usable(f) {
    if (f.kind === "stash") return !S.carTurned && carOf(CBZ.player) === f.car;
    if (f.whoA && (f.whoA.dead || f.whoA._seg)) return false;
    if (f.whoA && f.whoA.escaped && !f.whoA._seg) return false;
    return true;
  }
  function itemsFor(a) {
    const to = listenerOf(a);
    const items = CORE.menu(S.facts, to, S.now, hourLen(), 3, usable);
    if (items.length < 3) {
      const n = lieTarget();
      if (n && !items.some(function (f) { return f.whoA === n; })) {
        items.push({ kind: "lie", whoA: n, who: nameOf(n), whoId: n.id, key: "lie|" + nameOf(n), at: S.now, sole: true, lie: true });
      }
    }
    return items;
  }
  // something real to say. A guard hears you only when you do; the warden
  // will also take a name on nothing (it is what a summons is for)
  function canTell(a) {
    if (!inPrison() || !isStaff(a) || !up(a) || a.intimidMode === "scared") return false;
    if ((a._noTellsUntil || 0) > S.now) return false;
    if (CORE.menu(S.facts, listenerOf(a), S.now, hourLen(), 1, usable).length > 0) return true;
    return a.kind === "warden" && !!lieTarget();
  }
  function open(a) {
    if (!canTell(a)) return { ok: false, msg: a && (a._noTellsUntil || 0) > S.now ? pick(LINE.guardNoMore) : "" };
    // THE WARDEN HEARS IT IN HIS OFFICE. On the floor he sends for you.
    if (a.kind === "warden" && !wardenInOffice(a)) {
      if (CBZ.warden && CBZ.warden.summon) CBZ.warden.summon("tell", { now: true });
      return { ok: true, msg: pick(LINE.wardenFloor) };
    }
    S.mode = { a: a, items: itemsFor(a), until: S.now + 14 };
    return { ok: true, msg: pick(LINE.goOn) };
  }
  const SLOTS = ["tellA", "tellB", "tellC"];
  function menu(a) {
    const m = S.mode;
    if (!m || m.a !== a) return null;
    const out = [];
    for (let i = 0; i < m.items.length && i < 3; i++) out.push(SLOTS[i]);
    if (out.length < 3) out.push("tellNo");
    return out;
  }
  function slotFact(v) {
    const m = S.mode;
    const i = SLOTS.indexOf(v);
    return m && i >= 0 ? m.items[i] || null : null;
  }
  function label(v) {
    if (v === "tellNo") return "Nothing";
    const f = slotFact(v);
    return f ? CORE.label(f) : "";
  }
  function close() { S.mode = null; return { ok: true, msg: "" }; }

  // who of the yard sees you standing there talking to him
  function watchersOfTalk(listener) {
    const p = P();
    if (!p) return [];
    const inOffice = listener.kind === "warden" && wardenInOffice(listener);
    const W = CBZ.warden;
    const per = CBZ.brain && CBZ.brain.perception;
    const out = [];
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!up(m) || m.cuffed) continue;
      const q = m.group.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 18) continue;
      // his office is a closed room: only a man IN it sees what happens in it
      if (inOffice && !(W && W.inOffice && W.inOffice(q.x, q.z))) continue;
      let sees = d < 4;
      if (!sees && per && per.seesPoint && m._brain) { try { sees = !!per.seesPoint(m, p.x, 0, p.z, { range: 18 }); } catch (e) { sees = false; } }
      else if (!sees && !per) sees = d < 12;
      if (sees && rng() < 0.75) out.push(m);
    }
    return out;
  }
  function pickSlot(a, v) {
    const m = S.mode;
    const f = slotFact(v);
    S.mode = null;
    if (!m || m.a !== a || !f) return { ok: false, msg: "" };
    return tell(a, f);
  }
  /* THE ACT. What he says back, who saw you say it, and the order that
     puts an officer on the man. The favor lands when it checks out. */
  function tell(a, f) {
    const to = listenerOf(a);
    const val = CORE.value(f, to, S.now, hourLen());
    S.log.told++;
    if (f.kind === "lie") { S.log.lies++; f.whoA._accusedAt = S.now; }
    else f.told = true;
    // eyes on you
    const seen = watchersOfTalk(a);
    const target = f.whoA || null;
    let targetSaw = false;
    for (let i = 0; i < seen.length; i++) { know(seen[i], "saw"); if (seen[i] === target) targetSaw = true; }
    // his mouth
    const leaked = rng() < CORE.leakChance(to, !!a.corrupt);
    addRep(CORE.exposure(f, { witnesses: seen.length, leaked: false }), "seen talking");
    const st = { phone: !!(CBZ.econ && CBZ.econ.hasPhoneAccess && CBZ.econ.hasPhoneAccess()) };
    const fav = CORE.favor(val, to, st);
    const job = { f: f, to: to, val: val, fav: fav, listener: a, leaked: leaked, targetSaw: targetSaw,
      witnesses: seen.length, at: S.now };
    order(job);
    // the warden's side of it (the meet closes, his standing moves)
    if (to === "warden" && CBZ.warden && CBZ.warden.told) { try { CBZ.warden.told(job); } catch (e) {} }
    const line = to === "warden" ? LINE.wardenHears[fav] || LINE.wardenHears.none
      : (val >= 1.5 ? pick(LINE.guardHears) : pick(LINE.guardShrug));
    return { ok: true, msg: line };
  }

  /* ==========================================================
     3. THE WORLD CHANGES — an officer goes and looks
     ========================================================== */
  function freeOfficer(gd) {
    return !!(gd && gd.group && gd.kind !== "warden" && !gd.dead && !(gd.ko > 0) && !gd.asleep && !gd.tied &&
      !(gd.hunt > 0) && !gd._escort && !gd._wardenEscort && !gd._wardenCall && !gd._shakedown && !gd._snitchTask &&
      !gd._pcEscort && !gd._yardCase && gd.intimidMode !== "scared" && !gd.approach);
  }
  function nearestOfficer(x, z, maxD, not) {
    let best = null, bd = (maxD || 120) * (maxD || 120);
    const gs = CBZ.guards || [];
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (gd === not || !freeOfficer(gd)) continue;
      const q = gd.group.position, d2 = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
      if (d2 < bd) { bd = d2; best = gd; }
    }
    return best;
  }
  function V3(x, z) { return typeof THREE !== "undefined" ? new THREE.Vector3(x, 0, z) : { x: x, y: 0, z: z, set: function (a, b, c) { this.x = a; this.y = b; this.z = c; } }; }
  function boost() { return CBZ.jailBoost || null; }
  function order(job) {
    const f = job.f;
    if (f.kind === "bent") { resolveBent(job); return; }
    const where = f.kind === "stash" ? { x: f.x, z: f.z } : null;
    if (!where && !(f.whoA && alive(f.whoA))) { settle(job, true, false); return; }
    S.tasks.push({ job: job, gd: null, phase: "find", t: 0, hold: 0, where: where, tries: 0 });
    // the warden's order is an order: somebody moves NOW (prisonwarden.js
    // plays the deference when he is on the floor to give it)
    if (job.to === "warden" && CBZ.warden && CBZ.warden.noteOrder) { try { CBZ.warden.noteOrder(job); } catch (e) {} }
  }
  // THE WARDEN'S OWN ORDER: "toss that man" (prisonwarden.js), same walk,
  // same pat-down, no informant behind it
  function search(n, kind, gd) {
    if (!n || !alive(n) || n._seg) return false;
    for (let i = 0; i < S.tasks.length; i++) if (S.tasks[i].job.f.whoA === n) return false;
    const t = { job: { f: { kind: kind || "blade", whoA: n, who: nameOf(n) }, to: "warden", staff: true, val: 0, fav: "none" },
      gd: null, phase: "find", t: 0, hold: 0, where: null, tries: 0 };
    if (gd && freeOfficer(gd)) {
      const q = n.group.position;
      if (boost()) boost().apply("snitchtask", gd, { waypoints: [V3(q.x, q.z)], wi: 0, speed: Math.max(gd.speed || 2.6, 3.1) });
      gd._snitchTask = true;
      t.gd = gd; t.phase = "go";
    }
    S.tasks.push(t);
    return true;
  }
  function releaseTask(t) {
    if (t.gd) { t.gd._snitchTask = false; if (boost()) boost().restore("snitchtask", t.gd); }
    t.gd = null;
  }
  function holds(n) {
    const it = n && n.loadout && n.loadout.items;
    if (n && n._shankOut) return true;
    if (!it) return false;
    for (let i = 0; i < it.length; i++) if (CONTRA.test(it[i])) return true;
    return false;
  }
  function strip(n) {
    const it = n && n.loadout && n.loadout.items;
    const took = [];
    if (it) for (let i = it.length - 1; i >= 0; i--) if (CONTRA.test(it[i])) took.push(it.splice(i, 1)[0]);
    if (n) { n._shankOut = false; if (n.data && n.data.offer && CONTRA.test(n.data.offer.item || "")) n.data.offer = null; }
    return took;
  }
  function driveTasks(dt) {
    for (let i = S.tasks.length - 1; i >= 0; i--) {
      const t = S.tasks[i];
      t.t += dt;
      const f = t.job.f, n = f.whoA;
      const tp = t.where || (n && alive(n) ? n.group.position : null);
      if (!tp || (n && !alive(n) && !t.where)) { releaseTask(t); S.tasks.splice(i, 1); settle(t.job, true, false); continue; }
      if (t.t > 120) {                                         // nobody got to it: it goes on the sheet anyway
        releaseTask(t); S.tasks.splice(i, 1);
        if (t.job.staff) { /* the toss never happened */ }
        else if (CORE.PHYSICAL[f.kind]) settle(t.job, false, false);
        else { punish(t.job, null); settle(t.job, true, true); }
        continue;
      }
      if (!t.gd || !freeOfficerOr(t.gd, t)) {
        if (t.gd) releaseTask(t);
        t.tries -= dt;
        if (t.tries > 0) continue;
        t.tries = 2;
        const gd = nearestOfficer(tp.x, tp.z, 140);
        if (!gd) continue;
        if (boost()) boost().apply("snitchtask", gd, { waypoints: [V3(tp.x, tp.z)], wi: 0, speed: Math.max(gd.speed || 2.6, 3.1) });
        else { gd.waypoints = [V3(tp.x, tp.z)]; gd.wi = 0; }
        gd._snitchTask = true;
        t.gd = gd; t.phase = "go";
      }
      const gd = t.gd, gp = gd.group.position;
      const d = Math.hypot(tp.x - gp.x, tp.z - gp.z);
      if (t.phase === "go") {
        if (gd.waypoints && gd.waypoints[0] && gd.waypoints[0].set) { gd.waypoints[0].set(tp.x, 0, tp.z); gd.wi = 0; }
        if (d < (t.where ? 1.6 : 2.0)) {
          t.phase = "search"; t.hold = 0;
          if (n && !t.where) {
            say(gd, pick(LINE.hands), 1.8);
            if (n.target && n.target.set) n.target.set(n.group.position.x, 0, n.group.position.z);
            n.pause = Math.max(n.pause || 0, 3);
            const V = CBZ.verbs;
            if (V && V.frisk) { try { V.frisk(gd, n, {}); } catch (e) {} }
          }
        }
        continue;
      }
      // the search itself: a beat standing over him (or over the stash)
      t.hold += dt;
      if (CBZ.guardFaceTo) { try { CBZ.guardFaceTo(gd, tp.x, tp.z, 0.001, dt); } catch (e) {} }
      if (t.hold < 2.4) continue;
      const found = t.where ? true : holds(n);
      // what a pat-down can prove is what is ON him; a stabbing or a run is on
      // the word of the man who saw it
      const ok = CORE.PHYSICAL[f.kind] || t.job.staff ? found : CORE.checkOut(f, found);
      releaseTask(t);
      S.tasks.splice(i, 1);
      S.log.checked++;
      if (ok) { say(gd, pick(LINE.found), 1.8); punish(t.job, gd); settle(t.job, true, true); }
      else { say(gd, pick(LINE.clean), 1.6); settle(t.job, false, true); }
    }
  }
  function freeOfficerOr(gd, t) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !(gd.hunt > 0) && gd._snitchTask && gd.intimidMode !== "scared");
  }
  // what happens to the man, the stash or the run
  function punish(job, gd) {
    const f = job.f, n = f.whoA;
    if (f.kind === "stash") {
      // the raid: every man of that car loses his steel and his smokes
      const list = inmates();
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!alive(m) || carOf(m) !== f.car) continue;
        strip(m);
        if (m.loadout) m.loadout.cigs = Math.floor((m.loadout.cigs || 0) * 0.3);
      }
      if (CBZ.addGangStanding && f.car != null) CBZ.addGangStanding(f.car, -10);
      return;
    }
    if (!n || !alive(n)) return;
    strip(n);
    if (n.role === "merchant") return;           // a fixed stall is never moved off the yard
    if (f.kind === "escape" && S.plan && S.plan.n === n) S.plan.foiled = true;
    const hours = CORE.SEG_H[f.kind] != null ? CORE.SEG_H[f.kind] : 3;
    // cuffs first, in front of the yard (the officer's own ladder), then gone
    const PB = CBZ.prisonBrain;
    if (gd && PB && PB.beginCase && !n.cuffed) { try { PB.beginCase(gd, n, "report"); } catch (e) {} }
    if (hours > 0) S.seg.push({ n: n, hours: hours, walkAt: S.now + 5, gone: false, until: 0 });
    else if (CBZ.econ && n.loadout) n.loadout.cigs = Math.floor((n.loadout.cigs || 0) * 0.5);
    if (CBZ.prisonNoteSnitched) { try { CBZ.prisonNoteSnitched(n); } catch (e) {} }
  }
  // a man moved out of the yard: in seg for a while, or on a bus for good
  const SEG_AT = { x: 84, z: 20 };
  function driveSeg() {
    for (let i = S.seg.length - 1; i >= 0; i--) {
      const s = S.seg[i], n = s.n;
      if (!n || n.dead) { S.seg.splice(i, 1); continue; }
      if (!s.gone) {
        if (S.now < s.walkAt && !n.cuffed) continue;
        if (S.now < s.walkAt + 3 && n.cuffed) continue;       // a beat on his knees first
        s.gone = true;
        s.until = isFinite(s.hours) ? S.now + s.hours * hourLen() : Infinity;
        n._seg = true; n.escaped = true; n.cuffed = false;
        if (n.char) { n.char.cuffed = false; n.char.surrender = false; }
        n.foe = null; n.huntPlayer = 0; n.aiState = "wander";
        n.group.visible = false;
        n.group.position.set(SEG_AT.x, 0, SEG_AT.z);
        if (n.target && n.target.set) n.target.set(SEG_AT.x, 0, SEG_AT.z);
        S.log.segs++;
        continue;
      }
      if (S.now < s.until) continue;
      // back on the tier, and he knows why he was gone if anybody told him
      n._seg = false; n.escaped = false; n.group.visible = true;
      const r = n.region;
      const x = r ? (r[0] + r[1]) * 0.5 : 0, z = r ? (r[2] + r[3]) * 0.5 : -26;
      n.group.position.set(x, 0, z);
      if (n.target && n.target.set) n.target.set(x, 0, z);
      S.seg.splice(i, 1);
    }
  }
  function resolveBent(job) {
    const gd = job.f.whoA;
    if (job.to !== "warden") {
      // a screw hears you out about another screw and does nothing, except remember
      if (gd) gd._knowsRat = true;
      settle(job, true, false);
      return;
    }
    if (gd) {
      gd.corrupt = false; gd.bribed = 0; gd.approach = null; gd.standingOffer = null;
      gd._reassigned = true;
      if (CBZ.addRacketStanding) { try { CBZ.addRacketStanding(-20); } catch (e) {} }
    }
    settle(job, true, true);
  }

  /* ---- IT CHECKED OUT, OR IT DIDN'T ---- */
  function settle(job, ok, acted) {
    if (job.staff) return;                 // the warden's own order: nobody told
    const f = job.f, to = job.to, n = f.whoA;
    const lieCaught = !ok && f.kind === "lie";
    const leaked = job.leaked;
    const targetKnows = CORE.targetKnows(f, { leaked: leaked, acted: acted, targetSaw: job.targetSaw, lieCaught: lieCaught });
    addRep(CORE.exposure(f, { witnesses: 0, leaked: leaked, acted: acted && ok, lieCaught: lieCaught }), "talked");
    // the man it was about, and his car, know who put them there
    if (targetKnows && n && !isStaff(n)) {
      know(n, "named");
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 8);
      n.grudgeWhy = "you talking to the man";
      n._ratTarget = true;
      const c = carOf(n);
      if (c != null) {
        const list = inmates();
        for (let i = 0; i < list.length; i++) if (list[i] !== n && carOf(list[i]) === c && rng() < 0.5) know(list[i], "car");
      }
    }
    if (targetKnows && f.kind === "stash") {
      // only your own car knew where it was: every man in it knows now
      const list = inmates();
      for (let i = 0; i < list.length; i++) if (carOf(list[i]) === f.car) know(list[i], "stash");
    }
    if (targetKnows && f.kind === "bent" && n) { n._hatesPlayer = true; }
    if (lieCaught) {
      S.log.caught++;
      if (to === "warden") {
        if (CBZ.warden && CBZ.warden.lied) { try { CBZ.warden.lied(job); } catch (e) {} }
      } else {
        const a = job.listener;
        if (a) a._noTellsUntil = S.now + hourLen() * 12;
        if (CBZ.addHeat) CBZ.addHeat(12);
      }
      return;
    }
    if (!ok) return;
    grant(job);
  }
  function grant(job) {
    const fav = job.fav, val = job.val;
    if (!fav || fav === "none") return;
    S.log.favors++;
    const E = CBZ.econ;
    if (fav === "cigs") {
      const c = CORE.cigsFor(val, job.to);
      if (E && E.addCigs) E.addCigs(c);
      if (E && E.announceLoot) { try { E.announceLoot(c, []); } catch (e) {} }
    } else if (fav === "pass") {
      g.snitchPass = Math.min(2, (g.snitchPass || 0) + 1);
    } else if (fav === "phone") {
      if (E && E.grantPhoneTime) E.grantPhoneTime(E.PHONE_TIME_SECS || 90);
    } else if (fav === "time") {
      if ((+g.jailSentence || 0) > 0) g.jailSentence = Math.max(1, (+g.jailSentence) - (60 + val * 12));
      else {
        // no clock on you: his ear, which is the road out the side gate
        const W = CBZ.warden && CBZ.warden.guard ? CBZ.warden.guard() : null;
        if (W) W.rep = (W.rep || 0) + Math.round(val * 4);
      }
    }
    if (job.to === "warden" && CBZ.warden && CBZ.warden.checkedOut) { try { CBZ.warden.checkedOut(job); } catch (e) {} }
    else if (job.to === "guard" && job.listener && dist(job.listener, CBZ.player) < 14) say(job.listener, fav === "pass" ? "I owe you one." : "Here.", 1.8);
  }

  /* ==========================================================
     4. THE YARD KNOWS — spread, the car, retaliation, protection
     ========================================================== */
  function carCounts(c) {
    let size = 0, knowN = 0;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!alive(m) || carOf(m) !== c) continue;
      size++;
      if (S.knowers.has(m)) knowN++;
    }
    return { size: size, know: knowN };
  }
  function driveSocial(dt) {
    // man to man: a knower tells somebody standing next to him
    const H = hourLen();
    const list = inmates();
    const per = dt / (H * 4);
    S.knowers.forEach(function (m) {
      if (!up(m) || m._seg) return;
      if (rng() >= per) return;
      const q = m.group.position;
      const mc = carOf(m);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === m || !up(o) || S.knowers.has(o)) continue;
        const d = Math.hypot(o.group.position.x - q.x, o.group.position.z - q.z);
        if (d > (carOf(o) === mc && mc != null ? 9 : 4)) continue;
        if (know(o, "word")) { S.log.spread++; addRep(1.5, "word"); }
        break;
      }
    });
    // YOUR CAR TURNS
    const c = carOf(CBZ.player);
    if (c != null && !S.carTurned) {
      const cc = carCounts(c);
      if (CORE.carTurns(rep(), cc.know, cc.size)) turnCar(c);
    }
  }
  function turnCar(c) {
    S.carTurned = true;
    const list = inmates();
    let speaker = null, sd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!up(m) || carOf(m) !== c) continue;
      know(m, "car");
      m.playerGrudge = Math.min(14, (m.playerGrudge || 0) + 5);
      m.grudgeWhy = "you being a rat";
      m._ratTarget = true;
      const d = dist(m, CBZ.player);
      if (d < sd) { sd = d; speaker = m; }
    }
    expelPlayer();
    if (speaker && sd < 16) say(speaker, pick(LINE.carTurn), 2.4);
  }
  function protectedNow() {
    const pc = S.pc;
    return !!(pc && pc.gd && S.now < pc.until && up(pc.gd) && dist(pc.gd, CBZ.player) < 12);
  }
  function driveRetaliation(dt) {
    S.retalT -= dt;
    if (S.retalT > 0) return;
    S.retalT = 9 + rng() * 9;
    if (protectedNow() || !CBZ.requestInmateHunt) return;
    if (CBZ.playerDowned && CBZ.playerDowned()) return;
    let best = null, bd = 24;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m._ratTarget || !up(m) || m.cuffed || m._seg || (m.huntPlayer || 0) > 0) continue;
      const d = dist(m, CBZ.player);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best || rng() > 0.5) return;
    if (CBZ.requestInmateHunt(best, 14, "wronged")) {
      S.log.retaliations++;
      if (!best._saidRat) { best._saidRat = true; say(best, pick(LINE.named), 2.2); }
      if (CBZ.provokeGang && best.gang >= 0 && rng() < 0.4) { try { CBZ.provokeGang(best, 12, { crew: 1, why: "snitch" }); } catch (e) {} }
    }
  }
  // PROTECTION: an officer on your shoulder; a man who comes at you meets him first
  function protect(hours) {
    const p = P();
    if (!p) return false;
    const gd = nearestOfficer(p.x, p.z, 200);
    if (!gd) return false;
    endProtect();
    S.pc = { gd: gd, until: S.now + (hours || 8) * hourLen(), said: false };
    gd._pcEscort = true;
    if (boost()) boost().apply("pcescort", gd, { waypoints: [V3(p.x, p.z)], wi: 0, speed: Math.max(gd.speed || 2.6, 3.0) });
    return true;
  }
  function endProtect() {
    const pc = S.pc;
    if (pc && pc.gd) { pc.gd._pcEscort = false; if (boost()) boost().restore("pcescort", pc.gd); }
    S.pc = null;
  }
  function driveProtect() {
    const pc = S.pc;
    if (!pc) return;
    const gd = pc.gd, p = P();
    if (!p || S.now >= pc.until || !up(gd) || gd.hunt > 0) { endProtect(); return; }
    // he took a case off you; when it is done he comes back to your shoulder
    if (!gd._pcEscort) {
      if (gd._yardCase) return;
      gd._pcEscort = true;
      if (boost()) boost().apply("pcescort", gd, { waypoints: [V3(p.x, p.z)], wi: 0, speed: Math.max(gd.speed || 2.6, 3.0) });
    }
    const d = dist(gd, CBZ.player);
    if (!pc.said && d < 4) { pc.said = true; say(gd, pick(LINE.pcEscort), 2); }
    if (gd.waypoints && gd.waypoints[0] && gd.waypoints[0].set) {
      if (d > 2.4) gd.waypoints[0].set(p.x - 1.2, 0, p.z - 1.2);
      else gd.waypoints[0].set(gd.group.position.x, 0, gd.group.position.z);
      gd.wi = 0;
    }
    // a man hunting you inside his reach is his problem now
    const PB = CBZ.prisonBrain;
    const list = inmates();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!((m.huntPlayer || 0) > 0) || !up(m) || m._lawBy) continue;
      if (dist(m, CBZ.player) > 9) continue;
      m.huntPlayer = 0;
      if (m.aiState === "fight" && m.foe === CBZ.player) { m.aiState = "wander"; m.foe = null; }
      if (PB && PB.beginCase) {
        gd._pcEscort = false;
        if (boost()) boost().restore("pcescort", gd);
        try { PB.beginCase(gd, m, "threat"); } catch (e) {}
        return;
      }
    }
  }

  // THE ONE LOOK-AWAY. An officer who owes you lets one thing go.
  function wrapOffense() {
    const off0 = CBZ.prisonOffense;
    if (typeof off0 !== "function" || off0._snitchPass) return;
    const PASS = { minor: 1, restricted: 1, fight: 1, contraband: 1 };
    const w = function (kind, opts) {
      const by = opts && (opts.seenBy || opts.by);
      if ((g.snitchPass | 0) > 0 && PASS[kind] && by && by.kind === "guard" && inPrison()) {
        g.snitchPass = (g.snitchPass | 0) - 1;
        by.hunt = 0; by.alert = Math.min(by.alert || 0, 0.3);
        say(by, pick(LINE.once), 1.6);
        return null;
      }
      return off0.apply(this, arguments);
    };
    w._snitchPass = true;
    CBZ.prisonOffense = w;
  }

  /* ==========================================================
     5. THE TICK
     ========================================================== */
  function reset() {
    for (let i = 0; i < S.tasks.length; i++) releaseTask(S.tasks[i]);
    endProtect();
    for (let i = 0; i < S.seg.length; i++) {
      const n = S.seg[i].n;
      if (n && n._seg) { n._seg = false; n.escaped = false; n.group.visible = true; }
    }
    S.knowers.forEach(function (m) { m._knowsRat = false; m._ratTarget = false; m._saidRat = false; });
    S.facts.length = 0; S.tasks.length = 0; S.seg.length = 0; S.knowers.clear();
    S.mode = null; S.carTurned = false; S.plan = null; S.now = 0; S.planT = 0;
    if (CBZ.player) CBZ.player._carOutcast = false;
    if (cars() && cars().rejoin) { try { cars().rejoin(); } catch (e) {} }
    for (const k in S.log) S.log[k] = 0;
    g.snitchRep = 0; g.snitchPass = 0;
  }
  const pollNewRun = CBZ.jailBoost && CBZ.jailBoost.newRunWatcher ? CBZ.jailBoost.newRunWatcher(0.5) : null;
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) CBZ.jailBoost.onStateExit(reset, ["title", "won", "lost"]);

  CBZ.onUpdate(41.6, function (dt) {
    if (g.mode !== "escape") return;
    if (pollNewRun && pollNewRun()) reset();
    if (g.state !== "playing") return;
    S.now += dt;
    wrapBrain();
    wrapOffense();
    if (g.role === "cop") return;
    // the card's list dies when you walk off or stand on it too long
    if (S.mode && (S.now > S.mode.until || !up(S.mode.a) || dist(S.mode.a, CBZ.player) > 4.5)) S.mode = null;
    S.scanT -= dt;
    if (S.scanT <= 0) { S.scanT = 0.5; scan(); }
    drivePlan(dt);
    driveTasks(dt);
    driveSeg();
    S.socialT -= dt;
    if (S.socialT <= 0) { driveSocial(1 - S.socialT); S.socialT = 1; }
    driveRetaliation(dt);
    driveProtect();
  });

  CBZ.prisonSnitch = {
    CORE: CORE,
    learn: learn,
    canTell: canTell,
    open: open,
    menu: menu,
    label: label,
    pick: pickSlot,
    close: close,
    protect: protect,
    search: search,
    seen: function (x, z) { return playerSees(x, z); },
    protectionOffered: function () {
      let hunted = false;
      const list = inmates();
      for (let i = 0; i < list.length; i++) if (list[i]._ratTarget && up(list[i]) && !list[i]._seg) { hunted = true; break; }
      return CORE.protectionOffered(rep(), hunted) && !protectedNow();
    },
    rep: rep,
    knows: function (m) { return S.knowers.has(m); },
    facts: function () { return S.facts.slice(); },
    segregated: function (n) { return !!(n && n._seg); },
    carTurned: function () { return S.carTurned; },
    // for the sim and a console: the whole state, read-only
    audit: function () {
      return {
        facts: S.facts.map(function (f) { return { kind: f.kind, who: f.who, other: f.other || null, told: !!f.told, sole: !!f.sole }; }),
        mode: S.mode ? S.mode.items.map(CORE.label) : null,
        tasks: S.tasks.map(function (t) { return { kind: t.job.f.kind, phase: t.phase, officer: t.gd ? nameOf(t.gd) : null }; }),
        seg: S.seg.map(function (s) { return { who: nameOf(s.n), gone: s.gone, hours: s.hours }; }),
        rep: Math.round(rep() * 10) / 10, knowers: S.knowers.size, carTurned: S.carTurned,
        pass: g.snitchPass || 0, protection: !!S.pc, plan: S.plan ? { who: nameOf(S.plan.n), heard: S.plan.heard } : null,
        log: Object.assign({}, S.log),
      };
    },
    _S: S,
  };
})();
