/* ============================================================
   systems/command.js — CBZ.command: ORDERS, OBEYED OR NOT. Every game.

   OWNER (2026-10-22): "I want to be able to tell my security, or my
   soldiers, or my gang, or my personal security to shoot at people or
   attack people, or tell cops to detain people, or to be told to do stuff
   like that... All dialogue, much of it needs to be commands that are
   either followed or not, and occasionally that lead to coups and
   fight-backs."

   ONE LAYER. A President's agents, a gang boss's crew, a client's hired
   guards, the warden's officers, an officer's word to an inmate and the
   warden's word to YOU are the same thing: somebody with a claim on
   somebody tells him to do something, and he decides. This file is that
   decision and nothing else; each game registers how its bodies carry an
   order out (command.use), so an obeyed "kill" is the city's real attack,
   a prison "take" is the officer's real case.

   THE ORDERS
     kill    shoot him / put him down          take    beat him, grab him
     detain  arrest him (law hands only)       back    back off, stand down
     hold    hold this spot                    come    to me
     go      go there (opts.at {x,z})          guard   cover him / this
     cell    back to your cell                 line    line up, the count
     drop    drop it                           search  strip the cell, frisk

   OBEDIENCE IS DECIDED, NEVER ASSUMED. Per man:
     authority  of the issuer over him (brain.job's employer, the clique's
                leader, the game's chain: president > Service/army/police,
                warden > officers > inmates). No claim, no order.
     standing   what he thinks of the issuer: loyalty, respect, fear (the
                city's relPlayer, the prison's socialRead, the institution's
                loyalty) through the game's hook; his own personality
                (discipline, loyalty) under it.
     weight     what the order asks of his conscience: an unarmed man in
                front of witnesses, a child, a cuffed man, one of his own,
                a senator; less when the man is coming at them.
     danger     the threat in front of him (CBZ.voice.threat) against his
                courage: an armed man is a harder "take".
     strain     every bad order he carried out, and every one he refused,
                is remembered; it decays slowly.
   ANSWERS
     obey      he does it. Routine orders are silent; a heavy one gets a
               word ("Yes, sir.").
     hesitate  a beat ("Sir?"). Give the same order again inside 8 s and it
               is pushed: he goes, or he says no. Pushing costs.
     refuse    "No." He stays where he is.
     turn      the order went too far: he turns his gun on the issuer, or
               walks off and reports him. Rare, and earned.
   A GROUP decides lead first: the man the rest look to (the clique's
   leader, the shift leader, the lieutenant) answers, and his answer pulls
   the others; every refusal after his makes the next easier.
   MUTINY. Strain and refusals pile up per issuer. When the men under him
   carry enough of both and think little of him, command emits "mutiny"
   ({ from, men, leader, game }) and the game acts: the city's crew turns on
   its boss and the lieutenant takes it, the President's institutions feed
   the dissent ladder toward the coup, the prison's officers stop taking
   the warden's word and the yard goes up.

   ORDERS TO YOU. command.toPlayer(from, order, opts) puts the order over
   the issuer's head and READS the answer from what you do (opts.complied()
   each frame), on the brain's demand ladder (systems/brain.js demand, kind
   "order"): the order, the order again, the last word, then the issuer's
   force (opts.onForce). Walking off on it is an answer too.
   command.bigOrder(from, line, choices, meta) is the cinematic three-answer
   moment (CBZ.campaignUI.say, meta.cinematic) for a big order from above,
   and only for those.

   API (CBZ.command)
     issue(from, to, order, target?, opts?) -> { answer, order, obey[], hesitate[],
            refuse[], turn[], answers: [{ man, answer, margin }] }
       to: one man or an array. opts: { at {x,z}, say (issuer speaks, NPC
       issuers only; default true), quiet (no answers spoken), exec (fn(man,
       order, target, from, opts) instead of the game's), pushed, game }
     decide(from, man, order, target?, ctx?) -> { answer, margin, weight, auth, stand }
     authority(from, man, order?, game?) -> 0..1   standing(man, from, game?) -> 0..1
     weight(order, man, target, from, game?, out?) -> 0..1.2 (out.reason: kid |
       cuffed | own | notable | unarmed, the word a refusal is said in)   strain(man) -> 0..1
     can(from, man, order?) -> bool  (has the issuer any claim on him for this)
     threaten(from, man, opts?) -> { answer: obey|cowed|walk|fight|none, order, target }
       the order he said no to again, backed by fear (or a man leaned on)
     pending(man, from?) -> his fresh no / "Sir?" { from, order, target, t, answer } | null
     The game whose hooks answer for a man is the world's (city, prison), never
     the sub-system his brain is registered under (a detail agent's "protection").
     use(game, hooks) hooks: { authority(from, man, order), standing(man, from),
       kin(man, target), notable(target), law(man), lead(man) (rank 0..1),
       exec(man, order, target, from, opts) -> bool, turn(man, from, how),
       cost(man, from, kind, amount) (pushes, refusals: the game's ledger),
       witnesses(x, z) -> n, owed(man, from) -> 0..1 }
     on(event, fn) -> off   events: answer, mutiny, turn, defied, complied
     toPlayer(from, order, opts) -> rec   opts: { complied() -> bool,
       attacking(), armed(), target, patience [s, s, s], maxDist,
       onForce(rec, why), onDone(rec, outcome), say (default true),
       lines [order, again, last] (the issuer's own words), alive(rec) }
     playerOrders() -> live recs   cancelPlayer(from?)   tick(dt)
     bigOrder(from, line, choices, meta)   ORDERS   audit()
   Pure logic: no THREE, no DOM; runs under plain node for checks.
============================================================ */
(function (root) {
  "use strict";
  const W = (typeof window !== "undefined" && window) || root.window || (root.window = {});
  const CBZ = W.CBZ = W.CBZ || {};
  if (CBZ.command && CBZ.command.__core) return;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function now() {
    const B = CBZ.brain;
    if (B && typeof B.now === "function") { const t = B.now(); if (isFinite(t)) return t; }
    if (typeof performance !== "undefined" && performance.now) return performance.now() / 1000;
    return Date.now() / 1000;
  }
  // a stable 0..1 per man and salt
  let _idN = 0;
  function hash(a, salt) {
    const id = (a && (a._cmdId || (a._cmdId = ++_idN))) || 1;
    let h = (id * 2654435761 ^ (salt * 0x45d9f3b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function posOf(a) {
    if (!a) return null;
    if (a.pos && typeof a.pos.x === "number") return a.pos;
    if (a.group && a.group.position) return a.group.position;
    if (a.position && typeof a.position.x === "number") return a.position;
    if (typeof a.x === "number" && typeof a.z === "number") return a;
    return null;
  }
  function dist(a, b) {
    const p = posOf(a), q = posOf(b);
    return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity;
  }
  function isPlayer(a) {
    if (!a) return false;
    if (a === CBZ.player || a.isPlayer) return true;
    const C = CBZ.city;
    return !!(C && a === C.playerActor);
  }
  function out(a) { return !a || a.dead || a.escaped || (a.hp != null && a.hp <= 0 && a.maxHp) || (a.ko || 0) > 0; }
  // WHOSE CHAIN OF COMMAND HE IS IN: the world's game first. A body's brain
  // names the sub-system that walks him (a Secret Service agent is brain game
  // "protection", the detail brain's), never the game whose hooks answer for
  // him. Reading the brain first sent every agent of the President's detail
  // to a game with no hooks: no authority, so every Kill and Detain the
  // President gave went to nobody and nothing happened at all.
  function gameOf(a, opts) {
    if (opts && opts.game) return opts.game;
    const m = CBZ.game && CBZ.game.mode;
    if (m === "city") return "city";
    if (m === "escape") return "prison";
    const b = a && a._brain;
    if (b && b.game) return b.game;
    return m || "*";
  }

  // ================================================================ ORDERS
  //  w     what it asks of a conscience before the target is read
  //  at    it is about a man (true) / may be (opt)
  //  law   only law hands carry it (a cop, a guard, an agent, a soldier)
  //  calm  a de-escalation: almost anyone who works for you does it
  const ORDERS = {
    kill:   { w: 0.5, at: true, harm: 2 },
    take:   { w: 0.26, at: true, harm: 1 },
    detain: { w: 0.16, at: true, law: true, harm: 1 },
    back:   { w: 0, calm: true },
    hold:   { w: 0.02 },
    come:   { w: 0.02 },
    go:     { w: 0.05 },
    guard:  { w: 0.06 },
    cell:   { w: 0.08 },
    line:   { w: 0.04 },
    drop:   { w: 0.16 },
    search: { w: 0.12 },
  };
  const ALIAS = { attack: "kill", shoot: "kill", beat: "take", grab: "take", arrest: "detain", stand: "back", standdown: "back",
    follow: "come", stay: "hold", wall: "search", frisk: "search", toss: "search", count: "line" };
  function norm(o) { o = String(o || "").toLowerCase(); return ORDERS[o] ? o : (ALIAS[o] || null); }

  // ================================================================ HOOKS
  const HOOKS = Object.create(null);
  function use(game, hooks) {
    const k = game || "*";
    const cur = HOOKS[k] || (HOOKS[k] = {});
    for (const j in hooks) cur[j] = hooks[j];
    return function () { if (HOOKS[k] === cur) delete HOOKS[k]; };
  }
  function hook(game, name) {
    const H = HOOKS[game];
    if (H && typeof H[name] === "function") return H[name];
    const D = HOOKS["*"];
    return D && typeof D[name] === "function" ? D[name] : null;
  }
  function call(game, name, a, b, c, d, e) {
    const f = hook(game, name);
    if (!f) return undefined;
    try { return f(a, b, c, d, e); } catch (err) { return undefined; }
  }

  // ================================================================ EVENTS
  const LIS = Object.create(null);
  function on(ev, fn) {
    const L = LIS[ev] || (LIS[ev] = []);
    L.push(fn);
    return function () { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); };
  }
  function emit(ev, data) {
    const L = LIS[ev];
    if (!L) return;
    for (let i = 0; i < L.length; i++) { try { L[i](data); } catch (e) {} }
  }

  // ================================================================ WHO HE IS
  const P0 = { courage: 0.5, aggression: 0.4, discipline: 0.5, curiosity: 0.5, loyalty: 0.5 };
  function persona(a) {
    const b = a && a._brain;
    if (b && b.personality) return b.personality;
    if (a && a.personality && typeof a.personality.courage === "number") return a.personality;
    if (!a) return P0;
    const p = a._cmdP || (a._cmdP = {
      courage: 0.3 + hash(a, 11) * 0.5, aggression: typeof a.aggr === "number" ? clamp01(a.aggr) : 0.2 + hash(a, 12) * 0.5,
      discipline: 0.3 + hash(a, 13) * 0.5, curiosity: 0.5, loyalty: 0.3 + hash(a, 14) * 0.5,
    });
    return p;
  }
  function capability(a) {
    if (!a) return "none";
    const V = CBZ.voice;
    if (V && V.capability) { try { return V.capability(a) || "none"; } catch (e) {} }
    const B = CBZ.brain;
    if (B && B.threat && B.threat.capability) { try { return B.threat.capability(a) || "none"; } catch (e) {} }
    return a.armed || a.hasGun ? "gun" : "none";
  }
  function roleOf(a) { const V = CBZ.voice; try { return V && V.role ? V.role(a) : ""; } catch (e) { return ""; } }
  const LAW = { cop: 1, guard: 1, warden: 1, security: 1, soldier: 1 };
  function lawHands(man, game) {
    const v = call(game, "law", man);
    if (v != null) return !!v;
    return !!LAW[roleOf(man)];
  }
  function restrained(a) {
    return !!(a && (a.restraint || a.cuffed || a.tied || a.surrender || a._custody || (a.char && a.char.cuffed)));
  }
  // is he coming at us: at the issuer, at this man, or at one of theirs
  function hostileTo(t, man, from) {
    if (!t) return false;
    const r = t.rage || t.foe || t.mem || null;
    if (r && (r === man || r === from || (isPlayer(from) && isPlayer(r)))) return true;
    if (r && r._brain && man && man._brain && r._brain.faction && r._brain.faction === man._brain.faction) return true;
    const B = CBZ.brain;
    if (B && B.social && B.social.attitude && man) {
      try { if (B.social.attitude(man, t) < -0.45) return true; } catch (e) {}
    }
    return false;
  }

  // ================================================================ AUTHORITY
  function authority(from, man, order, game) {
    if (!from || !man || from === man || out(man)) return 0;
    game = game || gameOf(man);
    const v = call(game, "authority", from, man, order);
    if (v != null) return clamp01(+v || 0);
    if (man._cmdBy === from) return 1;
    const B = CBZ.brain;
    const job = B && B.job ? B.job(man) : null;
    if (job && job.by === from) return 1;
    const b = man._brain;
    if (b && b.clique != null && B && B.social && B.social.leader) {
      try { if (B.social.leader(b.clique) === from) return 0.8; } catch (e) {}
    }
    return 0;
  }
  function can(from, man, order, game) {
    const o = norm(order);
    if (!o) return false;
    game = game || gameOf(man);
    if (authority(from, man, o, game) <= 0) return false;
    if (ORDERS[o].law && !lawHands(man, game)) return false;
    return true;
  }
  function standing(man, from, game) {
    game = game || gameOf(man);
    const v = call(game, "standing", man, from);
    if (v != null && isFinite(v)) return clamp01(+v);
    const P = persona(man);
    return clamp01(0.2 + P.loyalty * 0.5 + P.discipline * 0.2);
  }

  // ================================================================ MEMORY
  const STRAIN_DECAY = 0.004;     // per s: a bad order fades in a few minutes
  function rec(man) {
    let r = man._cmd;
    if (!r) r = man._cmd = { strain: 0, t: now(), hes: null, refused: 0, obeyed: 0, turned: false, last: null, no: null };
    const t = now(), dt = t - r.t;
    if (dt > 0) { r.strain = Math.max(0, r.strain - dt * STRAIN_DECAY); r.t = t; }
    return r;
  }
  function strain(man) { return man ? rec(man).strain : 0; }
  // per issuer: the refusals and bad orders that make a mutiny
  const ISS = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  const ISS_P = {};
  function issRec(from) {
    if (!from) return null;
    if (ISS && typeof from === "object") {
      let r = ISS.get(from);
      if (!r) { r = { refusals: [], bad: 0, lastMut: -1e9, n: 0 }; ISS.set(from, r); }
      return r;
    }
    const k = String(from);
    return ISS_P[k] || (ISS_P[k] = { refusals: [], bad: 0, lastMut: -1e9, n: 0 });
  }

  // ================================================================ WEIGHT
  function witnesses(target, game) {
    const p = posOf(target);
    if (!p) return 0;
    const v = call(game, "witnesses", p.x, p.z);
    if (v != null && isFinite(v)) return v;
    const B = CBZ.brain;
    if (!B || !B.near) return 0;
    let n = 0;
    try {
      const L = B.near(p.x, p.z, 25);
      for (let i = 0; i < L.length; i++) {
        const o = L[i], a = o && o.actor;
        if (!a || a === target || out(a)) continue;
        if (o.faction === "civilians" || o.faction === "inmates" || !o.faction) n++;
      }
    } catch (e) { n = 0; }
    return n;
  }
  // why: an out object; .reason gets what weighs most on him ("kid",
  // "cuffed", "own", "notable", "unarmed"), the word his refusal is said in
  function weight(order, man, target, from, game, why) {
    const o = norm(order);
    if (why) why.reason = null;
    if (!o) return 0;
    const O = ORDERS[o];
    let w = O.w;
    if (!target || !O.harm) return w;
    game = game || gameOf(man);
    const role = roleOf(target);
    const armed = capability(target);
    const coming = hostileTo(target, man, from);
    let top = 0, reason = null;
    const add = function (v, r) { w += v; if (r && v > top) { top = v; reason = r; } };
    if (o === "kill") {
      if (armed === "none" && !coming) add(0.14, "unarmed");
      if (restrained(target)) add(0.3, "cuffed");              // an execution
      if (LAW[role]) add(0.14, "own");
      if (coming) w -= armed === "gun" ? 0.45 : 0.3;
    } else {
      if (coming) w -= 0.18;
      if (o === "take" && restrained(target)) add(0.22, "cuffed");   // beating a man in cuffs
    }
    if (role === "kid" || target.kid || target.child) add(0.7, "kid");
    if (call(game, "kin", man, target)) add(o === "kill" ? 0.42 : 0.3, "own");
    const notable = call(game, "notable", target);
    if (notable || target.vip || target.official || target.senator || target._presOfficer) add(o === "kill" ? 0.24 : 0.2, "notable");
    if (!coming) w += Math.min(0.16, witnesses(target, game) * 0.025);
    if (why) why.reason = reason;
    return clamp(w, 0, 1.2);
  }
  function danger(order, man, target) {
    const O = ORDERS[order];
    if (!O || !O.harm || !target) return 0;
    const P = persona(man);
    let th = 0;
    const V = CBZ.voice;
    if (V && V.threat) { try { th = V.threat(man, target, { force: true }) || 0; } catch (e) { th = 0; } }
    const cap = capability(target);
    if (cap === "gun") th = Math.max(th, 0.6);
    else if (cap === "melee") th = Math.max(th, 0.35);
    const mine = capability(man);
    if (mine === "gun" && order === "kill") th *= 0.5;
    return th * (1 - P.courage) * 0.55;
  }

  // ================================================================ DECIDE
  const OBEY_M = 0.1;
  function decide(from, man, order, target, ctx) {
    const o = norm(order);
    const res = { answer: "refuse", margin: -1, weight: 0, auth: 0, stand: 0, why: "", reason: null };
    if (!o || !man || out(man)) { res.why = "out"; return res; }
    const game = gameOf(man, ctx);
    const auth = authority(from, man, o, game);
    res.auth = auth;
    if (auth <= 0) { res.why = "authority"; return res; }
    if (ORDERS[o].law && !lawHands(man, game)) { res.why = "law"; return res; }
    const R = rec(man);
    if (R.turned && R.turned === from) { res.answer = "refuse"; res.why = "turned"; return res; }
    const P = persona(man);
    const stand = standing(man, from, game);
    res.stand = stand;
    const w = weight(o, man, target, from, game, res);
    res.weight = w;
    let owed = call(game, "owed", man, from);
    owed = owed != null && isFinite(owed) ? clamp01(owed) : 0;
    let morale = 1;
    const B = CBZ.brain;
    if (B && B.morale && B.morale.of && man._brain) { try { const m = B.morale.of(man); if (isFinite(m)) morale = clamp01(m); } catch (e) {} }
    const pushed = !!(ctx && ctx.pushed);
    const will = 0.3 * auth + 0.45 * stand + 0.2 * P.discipline + 0.1 * P.loyalty
      - 0.35 * R.strain - 0.25 * owed - (1 - morale) * 0.15 + (pushed ? 0.12 : 0) + ((ctx && ctx.delta) || 0);
    // A CONSCIENCE IS HIS OWN. Men of one service share a temper; what an
    // order costs each of them is not the same, so the few who will not are
    // always particular men, never a dice roll on the whole detail.
    const conscience = 0.35 + 0.65 * (1 - P.aggression) + (hash(man, 41) - 0.5) * 0.36;
    const cost = w * conscience;
    const dng = danger(o, man, target);
    const jit = (hash(man, 31 + R.obeyed + R.refused) - 0.5) * 0.08;
    const m = will - cost - dng + jit;
    res.margin = m;
    if (ORDERS[o].calm) { res.answer = stand > 0.12 || m > -0.4 ? "obey" : "refuse"; return res; }
    if (m >= OBEY_M) res.answer = "obey";
    else if (m >= -0.04) res.answer = pushed ? (m >= -0.02 ? "obey" : "refuse") : "hesitate";
    else if (w >= 0.45 && stand < 0.35 && m < -0.38 && P.courage > 0.45) res.answer = "turn";
    else res.answer = "refuse";
    return res;
  }

  // ================================================================ WORDS
  function speak(a, topic, ctx) {
    const V = CBZ.voice;
    if (!a || out(a) || isPlayer(a) || !V || !V.say) return false;
    try { return !!V.say(a, topic, ctx); } catch (e) { return false; }
  }
  // routine obedience is silence; a heavy order gets its word
  function obeyAloud(man, o, w, lead, from) {
    if (!lead) return false;
    if (w >= 0.3) return true;
    // the player sent his men at a man: the one who leads it says so, so you
    // see who is doing it
    if (isPlayer(from) && ORDERS[o].at) return true;
    if (ORDERS[o].calm) return hash(man, 77 + rec(man).obeyed) < 0.3;
    return isPlayer(from) ? hash(man, 91 + rec(man).obeyed) < 0.35 : hash(man, 93 + rec(man).obeyed) < 0.2;
  }

  // ================================================================ CARRY IT OUT
  function execDefault(man, o, target, from, opts) {
    const B = CBZ.brain, A = B && B.act;
    if (!A) return false;
    const p = posOf(target) || posOf(from);
    switch (o) {
      case "kill": case "take": return target ? !!A.verb("attack", man, target, { order: o }) : false;
      case "detain": if (B.authority && target) { try { B.authority.begin(man, target, "order", {}); return true; } catch (e) { return false; } } return false;
      case "come": case "guard": { const q = posOf(from); return q ? !!A.moveTo(man, q.x, q.z, { speed: "jog", arrive: 1.6 }) : false; }
      case "go": { const at = opts && opts.at; return at ? !!A.moveTo(man, at.x, at.z, { speed: "walk", arrive: 0.8 }) : false; }
      case "hold": case "back": case "line": return !!A.stop(man);
      default: return p ? !!A.face(man, p.x, p.z) : false;
    }
  }
  function exec(man, o, target, from, opts) {
    if (opts && typeof opts.exec === "function") { try { return opts.exec(man, o, target, from, opts) !== false; } catch (e) { return false; } }
    const game = gameOf(man, opts);
    const f = hook(game, "exec");
    if (f) { try { const r = f(man, o, target, from, opts || {}); if (r != null) return r !== false; } catch (e) { return false; } }
    return execDefault(man, o, target, from, opts);
  }
  function turnOn(man, from, w, opts, forced) {
    const P = persona(man);
    const how = forced || (capability(man) !== "none" && P.aggression > 0.45 && P.courage > 0.5 ? "fight" : "walk");
    const R = rec(man);
    R.turned = from; R.strain = 0;
    const game = gameOf(man, opts);
    const f = hook(game, "turn");
    let done = false;
    if (f) { try { done = f(man, from, how, opts || {}) !== false; } catch (e) { done = false; } }
    if (!done) {
      const B = CBZ.brain;
      if (how === "fight" && B && B.act) B.act.verb("attack", man, from, { order: "turn" });
      else if (B && B.dismiss) {
        try { B.dismiss(man, { from: typeof from === "object" ? from : null }); } catch (e) {}
        if (B.social && B.social.accuse && typeof from === "object") { try { B.social.accuse(man, from, "order", Math.min(1, w)); } catch (e) {} }
      }
    }
    emit("turn", { man: man, from: from, how: how, game: game });
    return how;
  }

  // the lead of a group answers first
  function leadScore(man, game) {
    const v = call(game, "lead", man);
    if (v != null && isFinite(v)) return v;
    let s = 0;
    const B = CBZ.brain, b = man._brain;
    if (b && b.clique != null && B && B.social && B.social.leader) { try { if (B.social.leader(b.clique) === man) s += 1; } catch (e) {} }
    if (man.rank === "lt" || man.isLeader || man._protRole === "shift-leader") s += 0.8;
    if (typeof man.milRank === "number") s += man.milRank * 0.05;
    return s;
  }

  // ================================================================ ISSUE
  const HES_S = 8;            // s: the same order again inside this is a push
  const MUT_CD = 150;         // s between mutinies against one issuer
  function issue(from, to, order, target, opts) {
    opts = opts || {};
    const o = norm(order);
    const res = { answer: "refuse", order: o, obey: [], hesitate: [], refuse: [], turn: [], answers: [] };
    if (!o || !to) return res;
    const list0 = Array.isArray(to) ? to : [to];
    const list = [];
    for (let i = 0; i < list0.length; i++) { const m = list0[i]; if (m && !out(m) && m !== target && m !== from) list.push(m); }
    if (!list.length) return res;
    const game = gameOf(list[0], opts);
    if (list.length > 1) list.sort(function (a, b) { return leadScore(b, game) - leadScore(a, game); });
    // the issuer says it (an NPC's order is heard; the player's is his own)
    if (opts.say !== false && !isPlayer(from) && typeof from === "object") speak(from, "order", { order: o, from: from, target: target, force: true });
    const t = now();
    const I = issRec(from);
    if (I) I.n++;
    let delta = 0;
    let spoke = 0;
    for (let i = 0; i < list.length; i++) {
      const man = list[i];
      const R = rec(man);
      const h = R.hes;
      const pushed = !!opts.pushed || !!(h && h.from === from && h.order === o && h.target === (target || null) && t - h.t < HES_S);
      const d = decide(from, man, o, target, { pushed: pushed, delta: delta, game: opts.game });
      if (d.why === "authority" || d.why === "law" || d.why === "out") continue;
      let a = d.answer;
      R.hes = null;
      if (pushed) {
        R.strain = Math.min(1, R.strain + 0.04);
        call(game, "cost", man, from, "push", 0.04);
      }
      if (a === "hesitate") R.hes = { from: from, order: o, target: target || null, t: t };
      const lead = i === 0;
      const ctx = { order: o, from: from, to: man, target: target, by: isPlayer(from) ? from : null, force: true, why: d.reason };
      // a NO (or a "Sir?") is remembered on him: who asked, what, about whom.
      // It is what a Threaten presses (threaten() below) and what makes him a
      // man his own issuer can turn the rest on.
      R.no = a === "obey" ? null : { from: from, order: o, target: target || null, t: t, answer: a, opts: opts };
      if (a === "obey") {
        R.obeyed++;
        if (d.weight > 0.3) R.strain = Math.min(1, R.strain + (d.weight - 0.3) * (0.35 + 0.65 * (1 - persona(man).aggression)) * 0.5);
        if (d.weight > 0.45 && I) I.bad++;
        const did = exec(man, o, target, from, opts);
        if (!did) { R.obeyed--; res.refuse.push(man); res.answers.push({ man: man, answer: "cant", margin: d.margin }); continue; }   // his body cannot carry it: not done, not a no
        else {
          res.obey.push(man);
          if (!opts.quiet && obeyAloud(man, o, d.weight, spoke === 0 && lead, from)) { speak(man, "obey", ctx); spoke++; }
        }
      }
      if (a === "hesitate") {
        res.hesitate.push(man);
        if (!opts.quiet && spoke < 2) { speak(man, "hesitate", ctx); spoke++; }
      } else if (a === "refuse") {
        R.refused++;
        R.strain = Math.min(1, R.strain + 0.05);
        if (I) I.refusals.push(t);
        call(game, "cost", man, from, "refuse", d.weight);
        res.refuse.push(man);
        if (!opts.quiet && spoke < 2) { speak(man, "refuse", ctx); spoke++; }
      } else if (a === "turn") {
        if (I) I.refusals.push(t, t);
        call(game, "cost", man, from, "turn", d.weight);
        if (!opts.quiet) speak(man, "turn", ctx);
        turnOn(man, from, d.weight, opts);
        res.turn.push(man);
      }
      res.answers.push({ man: man, answer: a, margin: d.margin });
      emit("answer", { from: from, man: man, order: o, target: target, answer: a, margin: d.margin, weight: d.weight, game: game });
      // his answer pulls the rest, the lead's most: a little. The men who say
      // no are particular men; one refusal does not walk a whole detail off
      // an order (it used to: the lead's no took 0.18 off everybody).
      if (lead) delta += a === "obey" ? 0.05 : a === "hesitate" ? -0.03 : -0.07;
      else if (a === "refuse" || a === "turn") delta -= 0.03;
    }
    // the group's answer: what most of them did, a turn always counted
    const n = res.answers.length;
    if (!n) { res.answer = "refuse"; res.why = "authority"; return res; }
    res.answer = res.turn.length ? (res.obey.length ? "obey" : "turn")
      : res.obey.length * 2 >= n ? "obey" : res.hesitate.length >= res.refuse.length ? "hesitate" : "refuse";
    mutinyCheck(from, list, o, game, t);
    return res;
  }

  // ================================================================ THREATEN
  /* THE ORDER BACKED BY FEAR. Your man said no, or "Sir?", and you lean on
     him. Fear wins and he does it now; or it breaks him: he walks off the
     job, or, with nothing left for you and a gun on him, he turns it on you.
     A man with no order pending is only leaned on: the fear goes in, what he
     thinks of you comes down (the game's ledger, cost kind "threat"), and a
     man who already thought little of you walks.
     threaten(from, man, opts) -> { answer, order, target }
       answer: obey | cowed | walk | fight | none
       opts: { aimed (the issuer's gun is on him), armed, game } */
  function threaten(from, man, opts) {
    opts = opts || {};
    const res = { answer: "none", order: null, target: null };
    if (!from || !man || out(man) || man === from || isPlayer(man)) return res;
    const game = gameOf(man, opts);
    if (authority(from, man, null, game) <= 0) return res;
    const R = rec(man), t = now(), P = persona(man);
    const stand = standing(man, from, game);
    // how hard it lands: his own nerve, and the issuer's gun on him
    const press = clamp01(0.3 + (1 - P.courage) * 0.35 + (opts.aimed ? 0.25 : opts.armed ? 0.1 : 0));
    call(game, "cost", man, from, "threat", press);
    R.strain = Math.min(1, R.strain + 0.08);
    const I = issRec(from);
    let no = R.no && R.no.from === from && t - R.no.t < 90 ? R.no : null;
    if (no && no.target && out(no.target)) no = null;
    R.no = null;
    const ctx = { order: no ? no.order : null, from: from, to: man, target: no ? no.target : null, by: isPlayer(from) ? from : null, force: true };
    const breakHim = function (floor) {
      const how = capability(man) !== "none" && stand < floor && P.courage > 0.45 ? "fight" : "walk";
      if (I) I.refusals.push(t, t);
      speak(man, "turn", ctx);
      turnOn(man, from, 1, opts, how);
      res.answer = how;
      emit("answer", { from: from, man: man, order: ctx.order, target: ctx.target, answer: "turn", margin: -1, weight: 1, game: game });
      return res;
    };
    if (!no) {
      // leaned on for nothing: cowed, unless he had nothing left for you
      if (stand < 0.25 + hash(man, 57 + R.refused) * 0.15) return breakHim(0.18);
      speak(man, "cowed", ctx);
      res.answer = "cowed";
      return res;
    }
    res.order = no.order; res.target = no.target;
    const d = decide(from, man, no.order, no.target, { pushed: true, delta: press * 0.25, game: game });
    if (d.answer === "obey" || d.answer === "hesitate") {
      if (exec(man, no.order, no.target, from, no.opts || opts)) {
        R.obeyed++;
        speak(man, "obey", ctx);
        res.answer = "obey";
        emit("answer", { from: from, man: man, order: no.order, target: no.target, answer: "obey", margin: d.margin, weight: d.weight, game: game });
        return res;
      }
      return res;
    }
    return breakHim(0.35);
  }
  // his standing NO (or "Sir?") to this issuer, while it is fresh
  function pending(man, from) {
    const r = man && man._cmd && man._cmd.no;
    if (!r || (from && r.from !== from) || now() - r.t > 90) return null;
    return r;
  }

  // ================================================================ MUTINY
  function mutinyCheck(from, men, o, game, t) {
    const I = issRec(from);
    if (!I || men.length < 2 || t - I.lastMut < MUT_CD) return false;
    // refusals in the last three minutes
    while (I.refusals.length && t - I.refusals[0] > 180) I.refusals.shift();
    let sStand = 0, sStrain = 0, n = 0;
    const sour = [];
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (out(m) || authority(from, m, null, game) <= 0) continue;
      const st = standing(m, from, game), sr = rec(m).strain;
      sStand += st; sStrain += sr; n++;
      if (st < 0.5 || sr > 0.35 || rec(m).turned === from) sour.push(m);
    }
    if (n < 2) return false;
    const avgStand = sStand / n, avgStrain = sStrain / n;
    const score = avgStrain * 1.3 + I.refusals.length * 0.12 + I.bad * 0.05 + (1 - avgStand) * 0.5;
    if (score < 1.05 || avgStand > 0.45 || sour.length * 2 < n) return false;
    I.lastMut = t;
    I.refusals.length = 0; I.bad = 0;
    // the man who leads it: the one the others look to, among the sour
    let leader = null, ls = -1;
    for (let i = 0; i < sour.length; i++) { const s = leadScore(sour[i], game) + persona(sour[i]).courage * 0.5; if (s > ls) { ls = s; leader = sour[i]; } }
    emit("mutiny", { from: from, men: sour, leader: leader, game: game, order: o });
    return true;
  }

  // ================================================================ ORDERS TO YOU
  const YOU = [];
  const ORDER_KIND = {
    patience: [4.5, 4, 3.2], leaveR: 0, talkR: 99, keepR: 0, hold: true,
    comply: function (s) { return !!s.complied; },
    lines: { demand: [], warn: [], show: [], act: [], comply: [], left: [], fled: [], backoff: [], standoff: [], gaveup: [] },
  };
  function kindReady() {
    const D = CBZ.brain && CBZ.brain.demand;
    if (!D || !D.KINDS) return null;
    if (!D.KINDS.order) D.KINDS.order = ORDER_KIND;
    return D;
  }
  function orderLines(from, o, own) {
    if (own && own.length) {
      const at = function (i) { const s = own[Math.min(own.length - 1, i)]; return s ? [s] : []; };
      return { demand: at(0), warn: at(1), show: at(2), act: [], comply: [], left: [], fled: [], backoff: [], standoff: [], gaveup: [] };
    }
    const V = CBZ.voice;
    const L = function (again) { if (!V || !V.line) return []; let s = null; try { s = V.line(from, "order", { order: o, again: again, force: true }); } catch (e) { s = null; } return s ? [s] : []; };
    const first = L(0), second = L(1), last = L(2);
    return {
      demand: first, warn: second.length ? second : first, show: last.length ? last : second,
      act: [], comply: [], left: [], fled: [], backoff: [], standoff: [], gaveup: [],
    };
  }
  function cancelPlayer(from) {
    for (let i = YOU.length - 1; i >= 0; i--) {
      const r = YOU[i];
      if (from && r.from !== from) continue;
      YOU.splice(i, 1);
      const D = CBZ.brain && CBZ.brain.demand;
      if (D && D.cancel && r.from && typeof r.from === "object") { try { D.cancel(r.from); } catch (e) {} }
      r.outcome = r.outcome || "cancelled";
    }
  }
  function toPlayer(from, order, opts) {
    opts = opts || {};
    const o = norm(order);
    if (!o || !from || typeof from !== "object" || out(from)) return null;
    for (let i = 0; i < YOU.length; i++) if (YOU[i].from === from) { if (YOU[i].order === o) return YOU[i]; cancelPlayer(from); break; }
    const D = kindReady();
    const r = { from: from, order: o, opts: opts, t: 0, c: null, outcome: null, step: "order" };
    const you = (CBZ.city && CBZ.city.playerActor) || CBZ.player;
    if (D && you) {
      try {
        r.c = D.begin(from, you, "order", {
          silent: true, lines: orderLines(from, o, opts.lines), patience: opts.patience || null, hard: false, coward: false,
          armed: capability(from) === "gun", startArmed: false,
        });
      } catch (e) { r.c = null; }
    }
    if (!r.c && opts.say !== false) { const L0 = orderLines(from, o, opts.lines).demand[0]; if (L0) sayLine(from, L0); }
    YOU.push(r);
    return r;
  }
  function finish(r, outcome, i) {
    YOU.splice(i, 1);
    r.outcome = outcome;
    const defied = outcome !== "complied" && outcome !== "cancelled" && outcome !== "dead";
    if (defied) {
      emit("defied", { from: r.from, order: r.order, outcome: outcome });
      if (r.opts.onForce) { try { r.opts.onForce(r, outcome); } catch (e) {} }
    } else if (outcome === "complied") emit("complied", { from: r.from, order: r.order });
    if (r.opts.onDone) { try { r.opts.onDone(r, outcome); } catch (e) {} }
  }
  function sayLine(a, s) {
    if (!s || !a || out(a)) return false;
    const g = CBZ.game || {};
    if (g.mode === "escape" && CBZ.prisonSay) { try { return !!CBZ.prisonSay(a, s, { force: true, secs: 2.2 }); } catch (e) { return false; } }
    const S = CBZ.speech;
    if (S && S.say) { try { return !!S.say(a, s, { force: true, secs: 2.2 }); } catch (e) { return false; } }
    if (CBZ.citySay) { try { return CBZ.citySay(a, s, null, 2.2) !== false; } catch (e) { return false; } }
    return false;
  }
  const _s = { dist: 0, speed: 0, complied: false, attacking: false, armed: false, aiming: false };
  function tickYou(dt) {
    if (!YOU.length) return;
    const you = (CBZ.city && CBZ.city.playerActor) || CBZ.player;
    const D = CBZ.brain && CBZ.brain.demand;
    for (let i = YOU.length - 1; i >= 0; i--) {
      const r = YOU[i];
      r.t += dt;
      if (!r.from || out(r.from)) { finish(r, "dead", i); continue; }
      if (r.opts.alive && !r.opts.alive(r)) { finish(r, "cancelled", i); continue; }
      let ok = false;
      try { ok = !!(r.opts.complied && r.opts.complied(r)); } catch (e) { ok = false; }
      const d = dist(r.from, you);
      if (!ok && r.opts.maxDist && d > r.opts.maxDist) { finish(r, "left", i); continue; }
      if (!r.c || !D) {
        // no ladder on this page: the order, then patience, then force
        if (ok) { finish(r, "complied", i); continue; }
        const P = r.opts.patience || ORDER_KIND.patience;
        if (r.t > P[0] + P[1] + P[2]) finish(r, "acted", i);
        continue;
      }
      _s.dist = d; _s.complied = ok; _s.speed = 0;
      _s.attacking = !!(r.opts.attacking && r.opts.attacking(r));
      _s.armed = !!(r.opts.armed && r.opts.armed(r));
      let st = null;
      try { st = D.step(r.from, dt, _s); } catch (e) { st = null; }
      if (!st) { finish(r, ok ? "complied" : "cancelled", i); continue; }
      r.step = st.step === "demand" ? "order" : st.step;
      if (st.say && r.opts.say !== false) sayLine(r.from, st.say);
      if (st.step === "done" || st.step === "act") finish(r, st.outcome || (ok ? "complied" : "acted"), i);
    }
  }

  // ================================================================ THE BIG ORDER
  // a general's "Fire." at a crowd: the cinematic three answers, silence an answer
  function bigOrder(from, line, choices, meta) {
    const UI = CBZ.campaignUI;
    if (!UI || typeof UI.say !== "function") return null;
    const m = {};
    if (meta) for (const k in meta) m[k] = meta[k];
    m.cinematic = true;
    try { return UI.say(from, line, choices || [], m); } catch (e) { return null; }
  }

  function tick(dt) { tickYou(dt || 0); }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(36.3, tick);

  function audit() {
    return { orders: Object.keys(ORDERS), hooks: Object.keys(HOOKS), toYou: YOU.map(function (r) { return { order: r.order, step: r.step, t: +r.t.toFixed(1) }; }) };
  }

  CBZ.command = {
    __core: true,
    ORDERS: ORDERS, norm: norm,
    issue: issue, decide: decide, authority: authority, standing: standing, weight: weight, strain: strain, can: can,
    threaten: threaten, pending: pending,
    use: use, on: on, emit: emit,
    toPlayer: toPlayer, playerOrders: function () { return YOU.slice(); }, cancelPlayer: cancelPlayer,
    bigOrder: bigOrder, tick: tick, audit: audit,
    _rec: rec,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.command;
})(typeof globalThis !== "undefined" ? globalThis : this);
