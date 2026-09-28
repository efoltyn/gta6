/* ============================================================
   systems/prisonwarden.js — THE WARDEN RUNS THE PRISON.

   OWNER: "The warden doesn't really act like a warden."

   He was a guard in a suit with a desk. world/adminwing.js walked him between
   rooms on the schedule and economy.js let you rob him, and that was all: a
   riot, a stabbing, a man caught with a lockpick, none of it ever reached him.
   Lockdowns fired off a raw heat number; nobody ever ordered one.

   This file is the man's head. adminwing.js still owns his body, his rooms and
   his doors; this owns what he DECIDES:

     ROUTINE   office most of the working day, ROUNDS at chow (11:30, 17:00)
               with one or two officers at his shoulders, the wing throat for
               the evening count, quarters after 21:00. One PA line in the
               morning. The DUTY table below is the only copy of that day.
     INCIDENTS every fight / assault / escape / contraband / riot / alarm is
               reported to him (CBZ.warden.incident). One fight is nothing.
               A fight the screws saw you in, contraband, or two incidents in
               three hours: a SHAKEDOWN. An assault on staff, an escape, a riot:
               a LOCKDOWN, ordered by him (systems/lockdown.js no longer
               fires itself off a heat number, it reports the alarm here).
     SUMMONS   after your trouble, the next morning or when the hole lets you
               out, an officer comes to your door and walks you to his office.
               Follow him or it is an offense. In the office: DEAL (a name),
               FAVOR (a real errand), THREATEN (only works with leverage from
               his safe; otherwise it is the hole), or walk out (a warning).
     PRESENCE  presence() 1 when he is on the floor near you or the trouble,
               0.3 in the building, 0 off shift. entities/guards.js reads it
               to sharpen his officers.
     NOT A PUNCHING BAG  a hand on him is an assault: every officer in range
               comes, and the block locks down. He never chases anyone himself;
               he calls it in. On rounds his escort takes the hit for him.
     ORDERS    (2026-09-28, owner: "the warden just acts like a normal cop")
               He is the warden, not a patrol. entities/guards.js hands his
               body to body() below every frame: a hunt, a search, a yard case
               that lands on him is turned into an ORDER to the nearest free
               officer, who stops, turns to him ("Sir."), and goes. He never
               frisks, cuffs or chases anyone; he stands and watches it done.
               On rounds he stops at cell doors (the inspection), and a blade
               he sees on the tier is an order to toss that man.
     THE GATE  a new arrival (a run's start, a transfer) finds him at the wing's
               mouth, watching the new man walk in.
     GRUDGE / FAVOR  g.wardenStanding. Down at -4 he takes your yard; up at +5
               his officers owe you one. A lie to his face costs you both.
     TELL      systems/prisonsnitch.js: in his office the card is TELL (what
               you know), FAVOR (an errand) or PROTECTION, THREATEN. On the
               floor "Tell" gets you "My office." and an officer comes for you.
     HIS GUN   (world/adminwing.js, the prison-slop lead's pickup; feature-
               detected, never built here) a real threat in or by his office
               sends him for it. If it walks, the prison locks down and every
               cell gets tossed.

   Every line he says is a few words. No mechanics in his mouth.
   Probe: CBZ.prisonWardenAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;

  /*<core>  pure decision logic: no CBZ, no THREE. The scratch sim loads this
    block verbatim, so what it prints is what the game runs. */
  const CORE = (function () {
    // schedule block id -> where he is. The ONE copy of his day.
    const DUTY = {
      wake: "office",      // 05:00 in at his desk; the morning PA comes from here
      yard: "office",
      mess: "rounds",      // 11:30 walks the tier with his officers
      work: "office",
      supper: "rounds",    // 17:00 walks it again
      count: "throat",     // 18:30 stands at the wing throat while they come in
      secure: "quarters", night: "quarters",
    };
    function duty(id) {
      const k = String(id || "").toLowerCase().replace(/[^a-z]/g, "");
      return DUTY[k] || "office";
    }
    const WEIGHT = { fight: 1, contraband: 2, alarm: 2, assault: 3, riot: 3, escape: 4, gun: 4 };
    const WINDOW_H = 3;      // incidents that count together
    const MOOD_H = 6;        // how long an incident sours him
    const SHAKE_CD_H = 3;    // one shakedown per three hours at most
    const LOCK_CD_H = 1;     // a lifted lockdown is not re-ordered inside the hour
    function recent(list, now, hourLen, hours) {
      const out = [];
      for (let i = 0; i < list.length; i++) if (now - list[i].at <= hours * hourLen) out.push(list[i]);
      return out;
    }
    function moodOf(list, now, hourLen) {
      let s = 0;
      for (let i = 0; i < list.length; i++) {
        const age = (now - list[i].at) / hourLen;
        if (age < 0 || age > MOOD_H) continue;
        s += (WEIGHT[list[i].kind] || 1) * (1 - age / MOOD_H);
      }
      return s >= 5 ? "furious" : (s >= 2 ? "tense" : "calm");
    }
    /* st: {incidents (already holding inc), lockdownActive, lastShake, lastLockEnd}
       -> {lockdown, shakedown, summon, why} */
    function decide(st, inc, now, hourLen) {
      const win = recent(st.incidents, now, hourLen, WINDOW_H);
      const out = { lockdown: false, shakedown: false, summon: null, why: "" };
      const k = inc.kind, pl = !!inc.player;
      const seenFight = k === "fight" && pl && !!inc.seen;
      const hard = k === "assault" || k === "escape" || k === "riot" || k === "gun" || (k === "alarm" && win.length >= 2);
      if (hard) {
        // the cooldown is for the ALARM only: heat can chain, a riot cannot wait
        if (!st.lockdownActive && (k !== "alarm" || now - st.lastLockEnd >= LOCK_CD_H * hourLen)) { out.lockdown = true; out.why = k; }
      } else if (seenFight || (k === "contraband" && !inc.found) || k === "alarm" || win.length >= 2) {
        if (!st.lockdownActive && now - st.lastShake >= SHAKE_CD_H * hourLen) {
          out.shakedown = true;
          out.why = (seenFight || k === "contraband" || k === "alarm") ? k : "pattern";
        }
      }
      if (pl && (seenFight || k === "assault" || k === "escape" || k === "riot" || (k === "contraband" && inc.found))) out.summon = k;
      return out;
    }
    function presence(post, asleep, onFloor, dPlayer, dIncident) {
      if (asleep || !post || post === "quarters") return 0;
      if (!onFloor) return 0.3;
      if (dPlayer <= 25 || dIncident <= 25) return 1;
      return 0.5;
    }
    return { DUTY: DUTY, duty: duty, WEIGHT: WEIGHT, moodOf: moodOf, decide: decide, presence: presence,
      recent: recent, WINDOW_H: WINDOW_H };
  })();
  /*</core>*/

  const g = CBZ.game;
  if (!g) return;

  // ---- geometry this file needs (world/adminwing.js + world/cellblock.js) ----
  const CB = (CBZ.WORLD && CBZ.WORLD.cellBlock) || { x0: -16, x1: 16, z0: -44, z1: -8 };
  const OFFICE = { x0: 6.2, x1: 19.7, z0: -57.2, z1: -49.6 };        // PX_B..IX1, QZ..CORR_Z
  const INDOORS = { x0: -19.5, x1: 19.5, z0: -63.5, z1: -8 };        // wing + admin block
  function inRect(r, x, z) { return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1; }
  // the officer's walk from the tier to the office: the admin spine, reversed
  const CALL_ROUTE = [[0, -39], [-3.2, -42.0], [-3.2, -46.6], [11.4, -46.6], [11.4, -51.2], [11.4, -53.0]];
  // where the favor blade is dropped: open yard, off the lanes
  const FAVOR_SPOTS = [[-21, 46], [21, 44], [-24, 30]];

  // ---- his words. Few, short, real. ----
  const LINE = {
    paMorning: ["Morning count. On your doors.", "Count time. Stand on your doors."],
    paLockdown: ["Lockdown. Everybody in your cell.", "Yard's closed. Everybody in."],
    paShakedown: ["Stand by your doors.", "Everybody on your doors. Officers coming through."],
    paClear: ["Doors open. Normal movement."],
    fetch: ["Warden wants you. Walk.", "Let's go. Warden."],
    lag: ["Now.", "Keep up."],
    open: {
      fight: "Fighting in my yard.",
      cuffed: "You again.",
      contraband: "My officers found things on you.",
      assault: "You put hands on my officer.",
      escape: "You tried my fence.",
      riot: "That was you out there.",
      ignored: "You walked off on my officer.",
      favor: "You found it.",
      tell: "You wanted to see me.",
    },
    dealAsk: ["Give me something, and this goes away.", "Tell me something I don't know."],
    tellAsk: ["Go on."],
    take: ["Take him.", "Officer. Him."],
    breakup: ["Break that up.", "Officer. Over there."],
    toss: ["Officer. That one.", "Toss that man."],
    look: ["Go and look."],
    sir: ["Sir.", "Yes, sir."],
    inspect: ["Stand up.", "Bunk's a mess.", "Let me see your hands."],
    arrival: ["Another one. Walk him in."],
    paYard: {
      calm: ["Yard is open. Keep it clean."],
      tense: ["Yard is open. Anybody carrying steel goes to the hole."],
      furious: ["Somebody in this yard cut a man. I will find him."],
    },
    paGun: ["Lockdown. Nobody moves until it's found."],
    gunDraw: ["Down. On the floor.", "Don't."],
    lied: ["You lied to me.", "Nothing on him. You wasted my time."],
    checked: ["It checked out.", "Good. It was there."],
    noYard: ["No yard for you. Inside."],
    protect: ["You'll have an officer on you."],
    favorAsk: ["Somebody buried a blade in my yard. Find it."],
    handOver: ["Good. We're square."],
    threatWin: ["...Get out of my office."],
    threatLose: ["Officer. Take him down."],
    silent: ["Next time you talk.", "Suit yourself. Next time it's the hole."],
    hands: ["Hands on the wall.", "Hands. Wall. Now."],
    clean: ["Clean. Go on."],
    trespass1: ["This is my office. Out.", "Wrong room."],
    trespass2: ["I won't say it twice. Out."],
    trespass3: ["Officers. My office."],
  };
  let lineSeq = 0;
  function pick(list) { lineSeq++; return list[(lineSeq * 7 + ((S.now * 10) | 0)) % list.length]; }
  function say(actor, line, secs) {
    if (!line || !CBZ.prisonSay || !actor) return false;
    try { return !!CBZ.prisonSay(actor, line, { force: true, secs: secs || 2.4 }); } catch (e) { return false; }
  }
  // THE PA. The horn sounds from the nearest real speaker (prisonschedule.js)
  // and the words come out of that same horn, over it, like every voice in
  // the prison (systems/speech.js): he is on the speaker, not in the room.
  // (It used to anchor on the PLAYER's own position, so the Warden's PA
  // announcement floated over your head as if you had said it.)
  const PA_VOICE = { kind: "pa", data: { name: "Warden" }, pos: null };
  function paSay(list) {
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return false;
    const day = CBZ.dayCount ? (CBZ.dayCount() | 0) : 0;
    if (S.paDay !== day) { S.paDay = day; S.paToday = 0; }
    if (S.paToday >= 3) return false;                 // a PA that never shuts up is noise
    S.paToday++;
    S.log.pa++;
    const sched = CBZ.prisonSchedule;
    if (sched && sched.announce) { try { sched.announce(1); } catch (e) {} }
    S.paQueue = { line: pick(list), t: 0.9 };         // the words land after the horn
    return true;
  }

  // ---- state ----
  const S = {
    now: 0,
    incidents: [],
    log: { incidents: 0, lockdowns: 0, shakedowns: 0, summons: 0, deals: 0, favors: 0, threats: 0,
      warnings: 0, ignored: 0, pa: 0, assaults: 0, found: 0 },
    lastShake: -1e9, lastLockEnd: -1e9, lockdownMine: false,
    blockSeq: 0, lastBlock: null, wakeSeq: -1,
    pending: null,        // {reason, seq, hole:bool, now:bool}
    call: null,           // the officer walking you in
    meet: null,           // you are in his office
    shake: null,          // a shakedown under way
    escorts: [], escortScan: 0,
    lastInc: null,        // {x,z,at}
    paQueue: null, paDay: -1, paToday: 0, morningSaid: -1, morningT: 0,
    favor: null,          // {x,z,shiv0,seq,picked}
    owes: false,          // a done favor buys one pass
    immuneSeq: -1,        // leverage used: no summons before this block seq
    holeWas: false, cuffWas: false, hpWas: null, koWas: 0,
    arrival: null, lastDecision: null,
    orders: [],           // an officer standing to hear his order ("Sir.")
    insp: { t: 0, stop: 0, side: 1 },
    seeT: 0, sayT: 0,
    noYard: -1,           // block seq until which your yard is gone
    standWas: 0, ack: null, lies: 0,
    gun: { phase: "", t: 0, armed: false, fireCD: 0, calmT: 0, missing: false, invWas: -1 },
    yardPaSeq: -1, runT: 0,
  };
  function hourLen() {
    const s = CBZ.prisonSchedule;
    const h = s && s.hourLength ? +s.hourLength() : 30;
    return h > 0 ? h : 30;
  }
  function blockId() { const s = CBZ.prisonSchedule; try { return s && s.id ? s.id() : null; } catch (e) { return null; } }
  function P() { return CBZ.player && CBZ.player.pos; }
  function wardenG() {
    const R = CBZ.wardenRoutine;
    const w = R && R.guard ? R.guard() : null;
    if (w) return w;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) if (list[i].kind === "warden") return list[i];
    return null;
  }
  function post() { const R = CBZ.wardenRoutine; return R && R.post ? R.post() : null; }
  function onShift() {
    const w = wardenG();
    if (!w || w.dead) return false;
    const p = post() || CORE.duty(blockId());
    return p !== "quarters" && !w.asleep;
  }
  function wardenIn(r) { const w = wardenG(); return !!(w && inRect(r, w.group.position.x, w.group.position.z)); }
  function onFloor() {
    const w = wardenG();
    if (!w) return false;
    const p = w.group.position;
    return p.z > -44.2;                                // south of the admin wall: the wing, or beyond
  }
  function able(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !gd.tied && gd.kind !== "warden");
  }
  function free(gd) {
    return able(gd) && !gd._escort && !gd._wardenEscort && !gd._wardenCall && !gd._shakedown && !gd._dayRoute &&
      !gd._snitchTask && !gd._pcEscort && !gd._yardCase && !(gd.pause > 0) && !(gd.hunt > 0) && gd.intimidMode !== "scared";
  }
  function inv() { return g.inventory || {}; }
  function has(item) { return (inv()[item] | 0) > 0; }
  function playerFree() {
    const pl = CBZ.player;
    if (!pl || g.state !== "playing" || g.mode !== "escape" || g.role === "cop") return false;
    if (CBZ.jailEscortPhase && CBZ.jailEscortPhase()) return false;
    if (CBZ.playerDowned && CBZ.playerDowned()) return false;
    if (CBZ.playerCellSealed && CBZ.playerCellSealed()) return false;
    if (pl.captureState && pl.captureState !== "normal") return false;
    return true;
  }
  function lockdownOn() { return !!(CBZ.lockdownActive && CBZ.lockdownActive()); }
  function offense(kind, opts) {
    if (!CBZ.prisonOffense) return false;
    try { CBZ.prisonOffense(kind, opts || {}); return true; } catch (e) { return false; }
  }
  const boost = function () { return CBZ.jailBoost || null; };
  const V3 = function (x, z) { return new THREE.Vector3(x, 0, z); };

  /* ==========================================================
     1. INCIDENTS -> ORDERS
     ========================================================== */
  function incident(kind, opts) {
    opts = opts || {};
    if (g.mode !== "escape") return null;
    kind = String(kind || "").toLowerCase();
    if (!CORE.WEIGHT[kind]) return null;              // "minor" / "restricted" are the screws' business
    // systems/prisonlaw.js reports every offense it records, and every one of
    // those is the player's; anything about somebody else says player:false
    const isPlayer = opts.player != null ? !!opts.player : true;
    const at = opts.at || (isFinite(opts.x) && isFinite(opts.z) ? { x: +opts.x, z: +opts.z } : null) ||
      (isPlayer && P() ? { x: P().x, z: P().z } : null);
    const seen = opts.seen != null ? !!opts.seen : !!opts.seenBy;
    // ONE BRAWL IS ONE INCIDENT. prisonlaw.js reports every punch it records,
    // and two systems often report the same event: anything of the same kind
    // and party inside MERGE_S folds into the first. A report that adds what
    // the first lacked (a screw saw it, the goods were found) re-asks him.
    const MERGE_S = kind === "fight" ? 25 : 4;
    for (let i = S.incidents.length - 1; i >= 0; i--) {
      const o = S.incidents[i];
      if (S.now - o.at > 25) break;
      if (o.kind !== kind || o.player !== isPlayer || S.now - o.at > MERGE_S) continue;
      const upgrade = (seen && !o.seen) || (opts.found && !o.found);
      if (!upgrade) return S.lastDecision;
      o.seen = o.seen || seen; o.found = o.found || !!opts.found;
      return respond(o);
    }
    const inc = { kind: kind, at: S.now, player: isPlayer, seen: seen,
      found: !!opts.found, x: at ? at.x : null, z: at ? at.z : null };
    S.incidents.push(inc);
    if (S.incidents.length > 40) S.incidents.shift();
    S.log.incidents++;
    if (kind === "assault" && isPlayer) S.log.assaults++;
    if (at) S.lastInc = { x: at.x, z: at.z, at: S.now };
    return respond(inc);
  }
  function respond(inc) {
    const d = CORE.decide({ incidents: S.incidents, lockdownActive: lockdownOn(), lastShake: S.lastShake,
      lastLockEnd: S.lastLockEnd }, inc, S.now, hourLen());
    S.lastDecision = { kind: inc.kind, lockdown: d.lockdown, shakedown: d.shakedown, summon: d.summon, why: d.why };
    if (d.lockdown) orderLockdown(d.why, inc);
    else if (d.shakedown) orderShakedown(d.why);
    if (d.summon) summon(d.summon);
    return S.lastDecision;
  }

  function orderLockdown(why, inc) {
    const L = CBZ.lockdown;
    if (!L || !L.begin) return false;
    // the player is hunted only when he is the reason
    const hunt = !!(inc && inc.player);
    const ok = L.begin(why, { hunt: hunt, max: hourLen() * 2.5 });
    if (!ok) return false;
    S.lockdownMine = true;
    S.log.lockdowns++;
    if (S.shake) endShakedown();
    paSay(LINE.paLockdown);
    return true;
  }

  /* ---- THE SHAKEDOWN. One officer comes for you (hands on the wall, pockets
     out); two more toss your cell. What he finds is taken, and it is an
     offense with LAW's ledger. ---- */
  function orderShakedown(why) {
    if (S.shake || g.role === "cop") return false;
    S.lastShake = S.now;
    S.log.shakedowns++;
    S.shake = { t: 0, why: why, gd: null, phase: "go", hold: 0 };
    paSay(LINE.paShakedown);
    // the cell: two free officers walk to it and look
    const c = CBZ.cellblock && CBZ.cellblock.playerCell;
    if (c && isFinite(+c.x) && isFinite(+c.z)) {
      let sent = 0;
      const list = CBZ.guards || [];
      for (let i = 0; i < list.length && sent < 2; i++) {
        const gd = list[i];
        if (!free(gd) || !inRect(INDOORS, gd.group.position.x, gd.group.position.z)) continue;
        gd.investigate = { x: +c.x, z: +c.z, t: 14 };
        sent++;
      }
    }
    return true;
  }
  function pickNear(x, z, maxD, filter) {
    let best = null, bd = maxD * maxD;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!filter(gd)) continue;
      const dx = gd.group.position.x - x, dz = gd.group.position.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    return best;
  }
  function endShakedown() {
    const sh = S.shake;
    if (!sh) return;
    if (sh.gd) { sh.gd._shakedown = false; if (boost()) boost().restore("wardenshake", sh.gd); }
    S.shake = null;
  }
  function contrabandTake() {
    const EP = CBZ.escapePlan;
    if (EP && EP.confiscate) { try { return EP.confiscate() || []; } catch (e) { return []; } }
    const RX = /key|card|lockpick|hacksaw|blade|shiv|shank|baton|knuckle|c4|charge|rope|saw/i;
    const out = [], I = inv();
    for (const k in I) if ((I[k] | 0) > 0 && RX.test(k) && k !== "Gun") { out.push(k); I[k] = 0; }
    if (out.length && CBZ.refreshInventory) { try { CBZ.refreshInventory(); } catch (e) {} }
    return out;
  }
  function driveShakedown(dt) {
    const sh = S.shake;
    if (!sh) return;
    sh.t += dt;
    const p = P();
    if (sh.t > 50 || lockdownOn()) { endShakedown(); return; }
    if (!p || !playerFree()) return;                  // cuffed or down: the search waits
    if (!sh.gd || !able(sh.gd) || sh.gd.hunt > 0) {
      if (sh.gd) { sh.gd._shakedown = false; if (boost()) boost().restore("wardenshake", sh.gd); sh.gd = null; }
      const gd = pickNear(p.x, p.z, 70, free);
      if (!gd || !boost()) return;
      boost().apply("wardenshake", gd, { waypoints: [V3(p.x, p.z)], wi: 0, speed: Math.max(gd.speed || 2.6, 3.0) });
      gd._shakedown = true;
      sh.gd = gd;
    }
    const gd = sh.gd, gp = gd.group.position;
    const d = Math.hypot(p.x - gp.x, p.z - gp.z);
    if (sh.phase === "go") {
      if (gd.waypoints && gd.waypoints[0]) { gd.waypoints[0].set(p.x, 0, p.z); gd.wi = 0; }
      if (d < 2.2) {
        sh.phase = "search"; sh.hold = 0;
        say(gd, pick(LINE.hands), 1.8);
        if (CBZ.player) CBZ.player.stun = Math.max(CBZ.player.stun || 0, 1.4);
      }
      return;
    }
    // hands on the wall: he stands over you for a beat, then turns the pockets
    gd.alert = Math.max(gd.alert || 0, 0.3);
    sh.hold += dt;
    if (sh.hold < 1.4) return;
    const took = contrabandTake();
    if (took.length) {
      S.log.found++;
      // his incident first (found = the summons), then the screws' record,
      // whose own report to him lands inside the dedupe window
      incident("contraband", { player: true, found: true, seenBy: gd, at: { x: p.x, z: p.z } });
      offense("contraband", { by: gd, seenBy: gd, severity: Math.min(3, 1 + took.length), at: { x: p.x, z: p.z }, items: took });
    } else say(gd, pick(LINE.clean), 1.6);
    endShakedown();
  }

  /* ==========================================================
     2. SUMMONS
     ========================================================== */
  const REASON_RANK = { cuffed: 1, fight: 2, contraband: 3, ignored: 3, riot: 4, assault: 4, escape: 5, favor: 0, tell: 0 };
  function summon(reason, opts) {
    opts = opts || {};
    if (g.role === "cop" || g.mode !== "escape") return false;
    reason = reason || "cuffed";
    // a man who did him a favor gets one pass
    const asked = reason === "favor" || reason === "tell";       // you came to him; nothing to excuse
    if (S.owes && !asked && (REASON_RANK[reason] || 0) <= 2) { S.owes = false; return false; }
    if (S.blockSeq < S.immuneSeq && !asked) return false;
    const cur = S.pending;
    if (cur && (REASON_RANK[cur.reason] || 0) >= (REASON_RANK[reason] || 0) && !opts.now) return true;
    S.pending = { reason: reason, seq: S.blockSeq, now: !!opts.now, hole: false };
    return true;
  }
  function deliverable() {
    const pd = S.pending;
    if (!pd || S.call || S.meet) return false;
    if (!onShift() || lockdownOn() || S.shake || !playerFree()) return false;
    const p = P();
    if (!p || !inRect(CB, p.x, p.z)) return false;              // the officer comes to the wing
    if (pd.now || pd.hole) return true;
    return S.wakeSeq > pd.seq;                                  // the next morning
  }
  function startCall() {
    const p = P();
    const gd = pickNear(p.x, p.z, 60, function (x) { return free(x) && inRect(INDOORS, x.group.position.x, x.group.position.z); });
    if (!gd || !boost()) return false;
    boost().apply("wardencall", gd, { waypoints: [V3(p.x, p.z)], wi: 0, speed: 2.7 });
    gd._wardenCall = true;
    S.call = { gd: gd, phase: "fetch", t: 0, lag: 0, warned: false, reason: S.pending.reason };
    S.log.summons++;
    return true;
  }
  function endCall() {
    const c = S.call;
    if (!c) return;
    if (c.gd) { c.gd._wardenCall = false; if (boost()) boost().restore("wardencall", c.gd); }
    S.call = null;
  }
  function driveCall(dt) {
    const c = S.call;
    if (!c) return;
    const p = P();
    c.t += dt;
    if (!p || !able(c.gd) || !playerFree() || lockdownOn()) { endCall(); return; }   // pending stays: he tries again
    const gd = c.gd, gp = gd.group.position;
    const d = Math.hypot(p.x - gp.x, p.z - gp.z);
    if (c.phase === "fetch") {
      if (gd.waypoints && gd.waypoints[0]) { gd.waypoints[0].set(p.x, 0, p.z); gd.wi = 0; }
      if (d < 2.6) {
        say(gd, pick(LINE.fetch), 2.2);
        c.phase = "lead";
        // join the walk at the first spine node south of the admin wall
        gd.waypoints = CALL_ROUTE.map(function (q) { return V3(q[0], q[1]); });
        gd.wi = 0;
      } else if (c.t > 45) endCall();
      return;
    }
    // LEAD: he walks ahead; lag behind and he stops and turns round
    const last = CALL_ROUTE.length - 1;
    if (gd.waypoints.length > 1 && gd.wi >= last) {
      const q = CALL_ROUTE[last];
      gd.waypoints = [V3(q[0], q[1])]; gd.wi = 0;
    }
    if (d > 6) gd.alert = Math.max(gd.alert || 0, 0.25);
    if (d > 10) c.lag += dt; else c.lag = Math.max(0, c.lag - dt * 0.5);
    if (c.lag > 8 && !c.warned) { c.warned = true; say(gd, pick(LINE.lag), 1.6); }
    if (c.lag > 22) {
      // walked off on the warden's officer: an offense, and he comes for you
      S.log.ignored++;
      const reason = c.reason;
      endCall();
      gd.hunt = Math.max(gd.hunt || 0, 3);
      offense("minor", { by: gd, seenBy: gd, severity: 1, why: "summons", at: { x: p.x, z: p.z } });
      S.pending = { reason: (REASON_RANK[reason] || 0) > REASON_RANK.ignored ? reason : "ignored", seq: S.blockSeq, now: true, hole: false };
      standing(-2);
      return;
    }
    if (inRect(OFFICE, p.x, p.z)) {
      S.meet = { t: 0, reason: c.reason, opened: false, done: false };
      S.pending = null;
      endCall();
    }
  }
  function standing(dv) {
    g.wardenStanding = Math.max(-10, Math.min(10, (g.wardenStanding || 0) + dv));
    return g.wardenStanding;
  }
  function driveMeet(dt) {
    const m = S.meet;
    if (!m) return;
    const w = wardenG(), p = P();
    if (!w || w.dead || !p) { S.meet = null; return; }
    m.t += dt;
    const inside = inRect(OFFICE, p.x, p.z);
    const d = Math.hypot(p.x - w.group.position.x, p.z - w.group.position.z);
    if (!m.opened && inside && wardenIn(OFFICE) && d < 5.5) {
      m.opened = true; m.t = 0;
      say(w, LINE.open[m.reason] || LINE.open.cuffed, 2.6);
      // THE DEAL IS HIS TO OFFER: a name makes the trouble go away
      if (m.reason !== "favor") m.askAt = 2.9;
    }
    if (m.askAt && m.opened && m.t >= m.askAt) {
      m.askAt = 0;
      const SN = CBZ.prisonSnitch;
      if (m.reason === "tell") say(w, pick(LINE.tellAsk), 2);
      else if (SN && SN.canTell && SN.canTell(w)) say(w, pick(LINE.dealAsk), 2.6);
    }
    // walked out, or stood there saying nothing: that is an answer too
    if ((m.opened && !inside) || (m.opened && m.t > 40) || (!m.opened && m.t > 60)) {
      if (m.opened && m.reason === "tell") { S.meet = null; return; }   // you asked, you left: nothing owed
      if (m.opened) {
        S.log.warnings++;
        standing(-1);
        if ((g.wardenWarnings = (g.wardenWarnings || 0) + 1) >= 3) offense("minor", { by: w, severity: 1, why: "warden" });
        say(w, pick(LINE.silent), 2.2);
      }
      S.meet = null;
    }
  }
  function leverage() {
    // something out of HIS safe, and he knows it is gone
    const A = CBZ.adminWingAudit ? CBZ.adminWingAudit() : null;
    const robbed = !!(A && A.safeOpen);
    if (has("Gun-Room Key")) return "Gun-Room Key";
    if (robbed && has("Contraband Map")) return "Contraband Map";
    if (robbed && has("Luxury Watch")) return "Luxury Watch";
    return null;
  }
  function act(v, a) {
    const m = S.meet;
    if (!a || a.kind !== "warden" || !m || !m.opened) return { handled: false, ok: false, msg: "" };
    const w = a;
    if (v === "protect") {
      S.meet = null;
      const SN = CBZ.prisonSnitch;
      const ok = !!(SN && SN.protect && SN.protect(10));
      if (ok) { standing(-1); S.pending = null; }
      return { handled: true, ok: ok, msg: ok ? pick(LINE.protect) : pick(LINE.silent) };
    }
    if (v === "wfavor") {
      S.meet = null;
      S.log.favors++;
      const spot = FAVOR_SPOTS[(CBZ.dayCount ? CBZ.dayCount() | 0 : 0) % FAVOR_SPOTS.length];
      let inst = null;
      if (CBZ.prisonDropOne) { try { inst = CBZ.prisonDropOne("Shiv", spot[0], 0.3, spot[1], { speed: 0, up: 0 }); } catch (e) { inst = null; } }
      if (inst && inst.data) inst.data.life = Infinity;
      S.favor = { x: spot[0], z: spot[1], shiv0: inv().Shiv | 0, seq: S.blockSeq, picked: false, placed: !!inst };
      return { handled: true, ok: true, msg: pick(LINE.favorAsk) };
    }
    if (v === "whand") {
      S.meet = null;
      const took = CBZ.econ && CBZ.econ.takeItem ? CBZ.econ.takeItem("Shiv") : false;
      if (!took) return { handled: true, ok: false, msg: pick(LINE.silent) };
      S.favor = null;
      S.owes = true;
      standing(3);
      if (CBZ.addHeat) CBZ.addHeat(-(g.detection || 0));
      return { handled: true, ok: true, msg: pick(LINE.handOver) };
    }
    if (v === "wthreat") {
      S.meet = null;
      S.log.threats++;
      const lev = leverage();
      if (lev) {
        g.wardenLeverage = { item: lev, t: g.elapsed || 0 };
        S.immuneSeq = S.blockSeq + 8;                 // he leaves you alone for a day
        S.pending = null;
        standing(-4);
        if (CBZ.addHeat) CBZ.addHeat(-(g.detection || 0));
        // it rattles him, and a rattled warden runs a tight block
        S.incidents.push({ kind: "riot", at: S.now, player: false, seen: false, found: false, x: null, z: null });
        return { handled: true, ok: true, msg: pick(LINE.threatWin) };
      }
      // no leverage: a threat to the warden in his own office
      standing(-3);
      // an offense for the screws (cuffs and the hole), not an incident for
      // him: a threat in his own office does not lock the prison down
      offense("minor", { by: w, seenBy: w, severity: 2, why: "threat", hole: true,
        at: P() ? { x: P().x, z: P().z } : null });
      if (!CBZ.prisonOffense && CBZ.haulToCell) { try { CBZ.haulToCell("", { strike: false }); } catch (e) {} }
      return { handled: true, ok: false, msg: pick(LINE.threatLose) };
    }
    return { handled: false, ok: false, msg: "" };
  }
  // the three buttons on his card while you are in his office. TELL is what
  // you know (systems/prisonsnitch.js turns the card into it); PROTECTION
  // takes the errand's slot once the yard has you down as a man who talks.
  function verbs(a) {
    if (!a || a.kind !== "warden") return null;
    const m = S.meet;
    if (!m || !m.opened) return null;
    if (m.reason === "favor") return has("Shiv") ? ["whand"] : null;
    const SN = CBZ.prisonSnitch;
    const out = [];
    if (SN && SN.canTell && SN.canTell(a)) out.push("tell");
    out.push(SN && SN.protectionOffered && SN.protectionOffered() ? "protect" : "wfavor");
    out.push("wthreat");
    return out;
  }
  /* ---- what systems/prisonsnitch.js tells him back ---- */
  function told(job) {
    const m = S.meet;
    S.meet = null;
    S.log.deals++;
    // the trouble you were called in for goes away with a name worth hearing
    standing(job && job.val >= 5 ? 2 : 1);
    if (m && m.reason !== "tell") { S.pending = null; if (CBZ.addHeat) CBZ.addHeat(-Math.max(12, (g.detection || 0) * 0.5)); }
    if (CBZ.reduceCasePressure) { try { CBZ.reduceCasePressure(10, "warden"); } catch (e) {} }
  }
  function lied() {
    S.lies++;
    standing(-4);
    g.wardenLies = (g.wardenLies || 0) + 1;
    S.ack = { line: pick(LINE.lied), t: 0 };
    // twice is the hole
    if (g.wardenLies >= 2) offense("minor", { by: wardenG(), severity: 2, why: "lied", hole: true });
  }
  function checkedOut() { S.ack = { line: pick(LINE.checked), t: 0 }; }
  function noteOrder() { S.log.orders = (S.log.orders || 0) + 1; }

  /* ==========================================================
     3. HIS OFFICERS ON ROUNDS
     ========================================================== */
  function releaseEscorts() {
    for (let i = 0; i < S.escorts.length; i++) {
      const gd = S.escorts[i];
      if (!gd) continue;
      gd._wardenEscort = false;
      if (boost()) boost().restore("wardenescort", gd);
    }
    S.escorts.length = 0;
  }
  function driveEscorts(dt) {
    const w = wardenG();
    const sched = CBZ.prisonSchedule;
    const closing = sched && sched.until && sched.until() < 1.5;   // a block change re-posts the roster
    const want = !!(w && !w.dead && !(w.ko > 0) && post() === "rounds" && onFloor() && !closing && boost());
    if (!want) { if (S.escorts.length) releaseEscorts(); return; }
    for (let i = S.escorts.length - 1; i >= 0; i--) {
      const gd = S.escorts[i];
      if (!able(gd) || gd.hunt > 0 || gd._escort) {
        gd._wardenEscort = false;
        if (boost()) boost().restore("wardenescort", gd);
        S.escorts.splice(i, 1);
      }
    }
    S.escortScan -= dt;
    if (S.escorts.length < 2 && S.escortScan <= 0) {
      S.escortScan = 2;
      const wp = w.group.position;
      const gd = pickNear(wp.x, wp.z, 45, function (x) { return free(x) && inRect(INDOORS, x.group.position.x, x.group.position.z); });
      if (gd) {
        boost().apply("wardenescort", gd, { waypoints: [V3(wp.x, wp.z)], wi: 0, speed: Math.max(gd.speed || 2.4, 2.4) });
        gd._wardenEscort = true;
        S.escorts.push(gd);
      }
    }
    // a pace behind and to either side of him
    const wp = w.group.position, yaw = w.group.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = fz, sz = -fx;
    for (let i = 0; i < S.escorts.length; i++) {
      const gd = S.escorts[i];
      const side = i === 0 ? 1 : -1;
      const tx = wp.x - fx * 1.6 + sx * 1.3 * side, tz = wp.z - fz * 1.6 + sz * 1.3 * side;
      if (gd.waypoints && gd.waypoints[0]) { gd.waypoints[0].set(tx, 0, tz); gd.wi = 0; }
    }
  }
  function escorted() {
    for (let i = 0; i < S.escorts.length; i++) {
      const gd = S.escorts[i], w = wardenG();
      if (!able(gd) || !w) continue;
      if (Math.hypot(gd.group.position.x - w.group.position.x, gd.group.position.z - w.group.position.z) < 6) return true;
    }
    return false;
  }
  // his pocket is reachable only asleep in his quarters, or alone at his desk
  function exposed() {
    const w = wardenG();
    if (!w || w.dead) return false;
    if (w.asleep) return true;
    // knocked down, tied or cuffed: nobody's shoulder protects that belt
    if (w.ko > 0 || w.tied || (w.char && w.char.cuffed)) return true;
    if (escorted()) return false;
    if (post() !== "office" || !wardenIn(OFFICE)) return false;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (gd === w || !able(gd)) continue;
      if (Math.hypot(gd.group.position.x - w.group.position.x, gd.group.position.z - w.group.position.z) < 9) return false;
    }
    return true;
  }

  /* ==========================================================
     4b. HE GIVES THE ORDERS (entities/guards.js calls body() every frame)
     ========================================================== */
  function rnd() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function sayGap(secs) {
    if (S.now - S.sayT < (secs || 5)) return false;
    S.sayT = S.now;
    return true;
  }
  // THE ORDER, SEEN: he says it, the officer stops, turns to him, "Sir.", goes.
  // guards.js's `pause` branch holds the officer and faces him at _facePt.
  function orderOfficer(gd, line, fn) {
    const w = wardenG();
    if (!gd || !w || !fn) return false;
    if (line) say(w, line, 1.8);
    gd.pause = Math.max(gd.pause || 0, 1.1);
    gd._facePt = { x: w.group.position.x, z: w.group.position.z };
    S.orders.push({ gd: gd, fn: fn, at: S.now + 1.0, said: false });
    S.log.orders = (S.log.orders || 0) + 1;
    return true;
  }
  function driveOrders() {
    for (let i = S.orders.length - 1; i >= 0; i--) {
      const o = S.orders[i];
      if (!o.said && S.now > o.at - 0.75) { o.said = true; say(o.gd, pick(LINE.sir), 1.1); }
      if (S.now < o.at) continue;
      S.orders.splice(i, 1);
      o.gd._facePt = null;
      o.gd.pause = 0;
      if (!able(o.gd)) continue;
      try { o.fn(o.gd); } catch (e) {}
    }
  }
  function ordered(gd) {
    for (let i = 0; i < S.orders.length; i++) if (S.orders[i].gd === gd) return true;
    return false;
  }
  function freeForOrder(x) { return free(x) && !ordered(x); }
  // HANDS OFF: whatever lands on him (a hunt, a search, a yard case) becomes
  // an order to an officer. He never runs it himself.
  function handOff(w) {
    if ((w.hunt || 0) > 0) {
      const h = w.hunt;
      w.hunt = 0; w._chase = null;
      w.alert = Math.max(w.alert || 0, 1.5);                 // he stands and watches it done
      if (g.role !== "cop") {
        const gd = pickNear(w.group.position.x, w.group.position.z, 60, function (x) {
          return able(x) && !x._escort && !x._snitchTask && !x._pcEscort;
        });
        if (gd) {
          gd.hunt = Math.max(gd.hunt || 0, h, 3);
          gd.alert = Math.max(gd.alert || 0, 1);
          if (sayGap(6)) say(w, pick(LINE.take), 1.6);
        }
      }
    }
    if (w.investigate) {
      const iv = w.investigate;
      w.investigate = null;
      if (isFinite(iv.x) && isFinite(iv.z)) {
        const gd = pickNear(iv.x, iv.z, 80, freeForOrder);
        if (gd) orderOfficer(gd, sayGap() ? pick(LINE.look) : "", function (o) {
          o.investigate = { x: iv.x, z: iv.z, t: iv.t || 8, scan: 0, type: iv.type || "report", looking: !!iv.looking, player: !!iv.player };
        });
      }
    }
    if (w._yardCase) {
      const n = w._yardCase;
      const PB = CBZ.prisonBrain;
      if (PB && PB.endCase) { try { PB.endCase(w); } catch (e) {} }
      w._yardCase = null; w._returning = false;
      orderBreakup(n);
    }
  }
  function orderBreakup(n) {
    if (!n || !n.group || n.dead || n._lawBy || n.cuffed) return false;
    const PB = CBZ.prisonBrain;
    if (!PB || !PB.beginCase) return false;
    const p = n.group.position;
    const gd = pickNear(p.x, p.z, 45, freeForOrder);
    if (!gd) return false;
    return orderOfficer(gd, sayGap(4) ? pick(LINE.breakup) : "", function (o) { PB.beginCase(o, n, "fight"); });
  }
  // WHAT HE SEES ON THE FLOOR: a fight is an order; steel is a toss
  function watchFloor(w, dt) {
    S.seeT -= dt;
    if (S.seeT > 0) return;
    S.seeT = 0.5;
    const per = CBZ.brain && CBZ.brain.perception;
    if (!per || !per.seesPoint) return;
    const wp = w.group.position;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || !n.group || n.dead || n.escaped || n.ko > 0 || n.cuffed || n._lawBy) continue;
      const q = n.group.position;
      if (Math.hypot(q.x - wp.x, q.z - wp.z) > 20) continue;
      const fighting = n.aiState === "fight" && n.foe && n.foe.group && n.foe.kind !== "guard" && n.foe.kind !== "warden" && n.foe !== CBZ.player;
      const steel = !!n._shankOut && !((n._wardenToss || 0) > S.now);
      if (!fighting && !steel) continue;
      let sees = false;
      try { sees = !!per.seesPoint(w, q.x, 0, q.z, { range: 20 }); } catch (e) { sees = false; }
      if (!sees) continue;
      if (fighting) {
        const st = n._fightStarter && n._fightStarter.group && !n._fightStarter.dead ? n._fightStarter : n;
        if (!st._lawBy) orderBreakup(st);
      } else {
        const SN = CBZ.prisonSnitch;
        const gd = pickNear(q.x, q.z, 45, freeForOrder);
        if (gd && SN && SN.search) {
          n._wardenToss = S.now + 120;
          orderOfficer(gd, sayGap(4) ? pick(LINE.toss) : "", function (o) { SN.search(n, "blade", o); });
        }
      }
      return;                                           // one order a look
    }
  }
  // THE INSPECTION: on rounds he stops at a cell front, looks in, moves on
  function inspectBody(w, dt) {
    const I = S.insp;
    const transit = !!(CBZ.wardenRoutine && CBZ.wardenRoutine.transit && CBZ.wardenRoutine.transit());
    if (post() !== "rounds" || !onFloor() || transit || lockdownOn() || (w.alert || 0) > 0 || (w.sus || 0) > 0.3) {
      I.stop = 0;
      return false;
    }
    const wp = w.group.position;
    if (I.stop > 0) {
      I.stop -= dt;
      if (CBZ.guardFaceTo) CBZ.guardFaceTo(w, wp.x + I.side * 5, wp.z, 0.001, dt);
      if (CBZ.guardStand) CBZ.guardStand(w, dt);
      else if (CBZ.guardIdle) CBZ.guardIdle(w, dt);
      return true;
    }
    I.t -= dt;
    if (I.t > 0) return false;
    I.t = 10 + rnd() * 7;
    I.stop = 3.2;
    I.side = -I.side;
    // a man standing in that cell front hears about it
    const p = P();
    if (p && Math.abs(p.z - wp.z) < 3 && (p.x - wp.x) * I.side > 0.5 && (p.x - wp.x) * I.side < 6 && sayGap(8)) say(w, pick(LINE.inspect), 1.8);
    return true;
  }

  /* ==========================================================
     4c. HIS GUN. The prison-slop lead puts a real gun in his office; this
         reads it through whatever it exports (CBZ.wardenGun: {x, z, weapon?,
         present(), take(w), put(w)}). Without it the inventory stands in: a
         gun that turns up in YOUR pockets while you stand in his office is
         his, gone.
     ========================================================== */
  const GUN_RX = /revolver|shotgun|\.38|warden'?s? (gun|pistol)/i;
  function gunRef() {
    const G = CBZ.wardenGun || CBZ.wardenOfficeGun || (CBZ.adminWing && CBZ.adminWing.gun) || null;
    return G && isFinite(+G.x) && isFinite(+G.z) ? G : null;
  }
  function gunPresent(G) {
    try {
      if (typeof G.present === "function") return !!G.present();
      if (typeof G.taken === "function") return !G.taken();
      if (G.taken != null) return !G.taken;
    } catch (e) {}
    return true;
  }
  function gunTake(G, w) { try { if (typeof G.take === "function") return G.take(w) !== false; } catch (e) { return false; } return true; }
  function gunPut(G, w) { try { if (typeof G.put === "function") G.put(w); else if (typeof G.restore === "function") G.restore(w); } catch (e) {} }
  function invGuns() { let n = 0; const I = inv(); for (const k in I) if ((I[k] | 0) > 0 && GUN_RX.test(k)) n += I[k] | 0; return n; }
  const OFFICE_DOOR = { x: 11.4, z: -49.6 };
  function threatNear(w) {
    const p = P();
    if (!p || g.role === "cop") return false;
    const wp = w.group.position;
    const byOffice = inRect(OFFICE, wp.x, wp.z) || Math.hypot(wp.x - OFFICE_DOOR.x, wp.z - OFFICE_DOOR.z) < 9;
    if (!byOffice) return false;
    const dP = Math.hypot(p.x - wp.x, p.z - wp.z);
    if (S.hitAt != null && S.now - S.hitAt < 20 && dP < 16) return true;          // hands on him
    if (CBZ.playerArmed && CBZ.playerArmed() && dP < 9) return true;               // a weapon out in his room
    if (lockdownOn() && S.lockdownMine && dP < 14 && (g.detection || 0) > 40) return true;
    return false;
  }
  function fireAt(w, p) {
    const wp = w.group.position;
    const miss = rnd() < 0.35;
    if (!miss && CBZ.hurtPlayer) { try { CBZ.hurtPlayer(22, wp.x, wp.z, { weapon: "gun" }); } catch (e) {} }
    try { if (CBZ.sfx) CBZ.sfx("shoot_carbine"); } catch (e) {}
    if (CBZ.tracer && p) {
      try {
        CBZ.tracer({ x: wp.x, y: 1.45, z: wp.z },
          { x: p.x + (miss ? (rnd() - 0.5) * 1.6 : 0), y: miss ? 0.4 + rnd() : 1.2, z: p.z + (miss ? (rnd() - 0.5) * 1.6 : 0) },
          { color: 0xfff2b0, life: 0.09, muzzleScale: 1.3 });
      } catch (e) {}
    }
    const PB = CBZ.prisonBrain;
    if (PB && PB.noise) { try { PB.noise(wp.x, wp.z, 40, "gunshot", w); } catch (e) {} }
  }
  function gunBody(w, dt) {
    const gs = S.gun, G = gunRef();
    const p = P();
    if (gs.armed) {
      w.armed = true;
      if (!w.weapon) w.weapon = (G && G.weapon) || "Pistol";
      if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(w); } catch (e) {} }
      if (p && CBZ.guardFaceTo) CBZ.guardFaceTo(w, p.x, p.z, 0.0001, dt);
      if (CBZ.guardStand) CBZ.guardStand(w, dt);
      const threat = threatNear(w);
      if (threat) {
        gs.calmT = 0;
        gs.fireCD -= dt;
        if (!gs.warned) { gs.warned = true; gs.fireCD = 1.8; say(w, pick(LINE.gunDraw), 1.6); }
        else if (gs.fireCD <= 0 && p && Math.hypot(p.x - w.group.position.x, p.z - w.group.position.z) < 14) {
          let sees = true;
          const per = CBZ.brain && CBZ.brain.perception;
          if (per && per.seesPoint) { try { sees = !!per.seesPoint(w, p.x, 0, p.z, { range: 16, fovHalf: 1.2 }); } catch (e) {} }
          if (sees) { gs.fireCD = 1.3; fireAt(w, p); }
        }
      } else if ((gs.calmT += dt) > 25) {
        // it is over: it goes back where it lives
        gs.armed = false; gs.warned = false;
        w.armed = false;
        if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(w); } catch (e) {} }
        if (G) gunPut(G, w);
        return false;
      }
      return true;
    }
    if (gs.phase === "go") {
      gs.t += dt;
      if (!G || !gunPresent(G) || gs.t > 14 || (w.ko | 0) > 0) { gs.phase = ""; return false; }
      w.alert = Math.max(w.alert || 0, 0.4);       // world/adminwing.js stands him up off the chair
      const d = CBZ.guardWalkTo ? CBZ.guardWalkTo(w, +G.x, +G.z, 3.4, dt, 0.5) : 0;
      if (d < 1.1) {
        gs.phase = "";
        if (gunTake(G, w)) { gs.armed = true; gs.warned = false; gs.calmT = 0; gs.fireCD = 1.5; }
      }
      return true;
    }
    if (G && gunPresent(G) && threatNear(w)) { gs.phase = "go"; gs.t = 0; return gunBody(w, dt); }
    return false;
  }
  // IT WALKED. He notices when he is in the room with where it lived.
  function watchGun(dt) {
    const gs = S.gun, G = gunRef(), p = P(), w = wardenG();
    gs.watchT = (gs.watchT || 0) - dt;
    if (gs.watchT > 0) return;
    gs.watchT = 1;
    // who has been in his office (the name a man could give)
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n && n.group && !n.dead && !n.escaped && inRect(OFFICE, n.group.position.x, n.group.position.z)) { gs.lastIn = { n: n, t: S.now }; break; }
    }
    let gone = false, byPlayer = false;
    if (G) { gone = !gunPresent(G) && !gs.armed; byPlayer = invGuns() > 0; }
    else {
      const k = invGuns();
      if (gs.invWas >= 0 && k > gs.invWas && p && inRect(OFFICE, p.x, p.z)) gs.pendingGone = true;
      gs.invWas = k;
      gone = !!gs.pendingGone; byPlayer = gone;
    }
    if (!gone) { gs.missing = false; gs.pendingGone = false; return; }
    if (gs.missing || !w || w.dead || !onShift() || !wardenIn(OFFICE)) return;
    gs.missing = true;
    gs.pendingGone = false;
    // a missing gun is the biggest thing that happens in a prison
    paSay(LINE.paGun);
    const at = { x: (G ? +G.x : 12.9), z: (G ? +G.z : -53.6) };
    incident("gun", { player: byPlayer, seen: false, at: at });
    S.gunToss = true;
    // a man somebody saw in his office is a name the yard can sell
    const SN = CBZ.prisonSnitch;
    const li = gs.lastIn;
    if (!byPlayer && SN && SN.learn && li && S.now - li.t < 240 && li.n && !li.n.dead) {
      const q = li.n.group.position;
      if (!SN.seen || SN.seen(q.x, q.z)) SN.learn({ kind: "gun", whoA: li.n, sole: true });
    }
  }

  /* ==========================================================
     4d. GRUDGE AND FAVOR, and the yard he can take away
     ========================================================== */
  function drivePrivilege(dt) {
    const st = g.wardenStanding || 0;
    if (st <= -4 && S.standWas > -4) S.noYard = S.blockSeq + 10;             // about a day
    if (st >= 5 && S.standWas < 5) { S.owes = true; g.snitchPass = Math.min(2, (g.snitchPass || 0) + 1); }
    S.standWas = st;
    const p = P();
    if (S.blockSeq >= S.noYard || !p || !playerFree() || S.shake || S.call) return;
    const b = String(blockId() || "");
    if (b !== "yard" && b !== "work") return;
    if (p.z < -8) return;                                                   // indoors: where he wants you
    S.noYardT = (S.noYardT || 0) - dt;
    const nt = S.noYardGd;
    if (nt && able(nt) && Math.hypot(nt.group.position.x - p.x, nt.group.position.z - p.z) < 3.2 && !nt._noYardSaid) {
      nt._noYardSaid = true;
      say(nt, pick(LINE.noYard), 1.8);
      if (CBZ.addHeat) CBZ.addHeat(4);
    }
    if (S.noYardT > 0) return;
    S.noYardT = 30;
    const gd = pickNear(p.x, p.z, 70, free);
    if (!gd) return;
    gd._noYardSaid = false;
    gd.investigate = { x: p.x, z: p.z, t: 8, scan: 0, type: "report", looking: false, player: false };
    S.noYardGd = gd;
  }

  /* ==========================================================
     4. HIS BODY: never chases, never takes a free swing
     ========================================================== */
  function guardHim(w, dt) {
    const p = P();
    if (!p) return;
    const d = Math.hypot(p.x - w.group.position.x, p.z - w.group.position.z);
    // a hand on him
    const hp = typeof w.hp === "number" ? w.hp : null;
    const hit = (hp != null && S.hpWas != null && hp < S.hpWas - 0.5 && d < 4.5) ||
      ((w.ko | 0) > 0 && !(S.koWas > 0) && d < 6);
    S.hpWas = hp; S.koWas = w.ko | 0;
    if (hit && g.role !== "cop") {
      S.hitAt = S.now;
      // his escort was on you before you connected
      if ((w.ko | 0) > 0 && escorted()) { w.ko = 0; w.hp = Math.max(w.hp || 0, 90); S.koWas = 0; }
      for (const gd of CBZ.guards || []) {
        if (!able(gd)) continue;
        const gp = gd.group.position;
        if (Math.hypot(gp.x - p.x, gp.z - p.z) > 40) continue;
        gd.hunt = Math.max(gd.hunt || 0, 4);
        gd.alert = Math.max(gd.alert || 0, 1);
      }
      incident("assault", { player: true, seenBy: w, at: { x: p.x, z: p.z } });
      offense("assault", { by: w, seenBy: w, severity: 3, why: "warden", at: { x: p.x, z: p.z } });
    }
    // he sent for you: a man walking into his office on his orders is not a chase
    const passing = !!(S.call && S.call.phase === "lead") || !!S.meet;
    if (passing && !hit) {
      w.hunt = 0;
      if (S.call && S.call.gd) S.call.gd.hunt = 0;
    }
    // he calls it in; his officers run (anything that landed on him after
    // guards.js handed him to body() this frame)
    handOff(w);
    if (w.approach && !(CBZ.cityCampaignPrisonVerbs && CBZ.cityCampaignPrisonVerbs(w))) w.approach = null;
  }

  /* THE WARDEN'S BODY, FRAME BY FRAME. entities/guards.js calls this after
     his eyes have run and before any branch that would make him a patrol
     officer. true = this owns his body this frame. */
  function body(w, dt) {
    if (g.mode !== "escape" || !w || w.dead || (w.ko | 0) > 0 || w.asleep) return false;
    if (w.intimidMode === "scared" || w._escort) return false;
    handOff(w);
    if (gunBody(w, dt)) return true;
    if (!S.meet && !S.call) watchFloor(w, dt);
    if (inspectBody(w, dt)) return true;
    return false;
  }

  /* ==========================================================
     5. THE TICK
     ========================================================== */
  function reset() {
    endShakedown(); endCall(); releaseEscorts();
    S.incidents.length = 0; S.pending = null; S.meet = null; S.favor = null; S.owes = false;
    S.lastShake = -1e9; S.lastLockEnd = -1e9; S.lockdownMine = false; S.immuneSeq = -1;
    S.blockSeq = 0; S.lastBlock = null; S.wakeSeq = -1; S.paQueue = null; S.lastInc = null; S.morningT = 0;
    S.holeWas = false; S.cuffWas = false; S.hpWas = null; S.koWas = 0; S.now = 0; S.lastDecision = null;
    for (const k in S.log) S.log[k] = 0;
    for (let i = 0; i < S.orders.length; i++) if (S.orders[i].gd) S.orders[i].gd._facePt = null;
    S.orders.length = 0; S.noYard = -1; S.standWas = 0; S.ack = null; S.lies = 0; S.hitAt = null;
    S.gun.phase = ""; S.gun.armed = false; S.gun.missing = false; S.gun.invWas = -1; S.gun.pendingGone = false;
    S.gunToss = false; S.yardPaSeq = -1; S.runT = 0; S.arrivalAt = null; S.arrivalSaid = false;
    g.wardenLeverage = null; g.wardenStanding = 0; g.wardenWarnings = 0; g.wardenLies = 0;
  }
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.5) : null;
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) CBZ.jailBoost.onStateExit(reset, ["title", "won", "lost"]);

  CBZ.onUpdate(41.5, function (dt) {
    if (g.mode !== "escape") return;
    if (pollNewRun && pollNewRun()) reset();
    if (g.state !== "playing") return;
    S.now += dt;
    S.runT += dt;

    // a transfer is a new prison: the old warden's business stays behind
    if (g._arrivalT !== S.arrival) {
      if (S.arrival != null) { S.pending = null; S.meet = null; S.favor = null; endCall(); endShakedown(); S.arrivalAt = S.now; S.arrivalSaid = false; }
      S.arrival = g._arrivalT;
    }

    // the day
    const b = blockId();
    if (b !== S.lastBlock) {
      S.lastBlock = b; S.blockSeq++;
      if (b === "wake") { S.wakeSeq = S.blockSeq; S.morningT = 2.5; }
      // THE YARD OPENS WITH HIS VOICE: what kind of day it is, from his mood
      if (b === "yard" && S.yardPaSeq !== S.blockSeq && onShift()) {
        S.yardPaSeq = S.blockSeq;
        const md = CORE.moodOf(S.incidents, S.now, hourLen());
        paSay(LINE.paYard[md] || LINE.paYard.calm);
      }
      // pending business older than two days is dropped
      if (S.pending && S.blockSeq - S.pending.seq > 16) S.pending = null;
      if (S.favor && !S.favor.picked && S.blockSeq - S.favor.seq > 8) { S.favor = null; standing(-2); }
    }
    if (S.morningT > 0) {
      S.morningT -= dt;
      if (S.morningT <= 0) {
        const day = CBZ.dayCount ? (CBZ.dayCount() | 0) : S.wakeSeq;
        if (S.morningSaid !== day && onShift()) { S.morningSaid = day; paSay(LINE.paMorning); }
      }
    }
    if (S.paQueue) {
      S.paQueue.t -= dt;
      if (S.paQueue.t <= 0) {
        const H = CBZ.prisonSchedule && CBZ.prisonSchedule.horns, me = P();
        let h = null, bd = Infinity;
        if (H && me) for (let i = 0; i < H.length; i++) {
          const dd = (H[i].x - me.x) * (H[i].x - me.x) + (H[i].z - me.z) * (H[i].z - me.z);
          if (dd < bd) { bd = dd; h = H[i]; }
        }
        // the speech anchor adds a head height; the horn IS the mouth
        if (h) { PA_VOICE.pos = { x: h.x, y: (h.y || 3.5) - 1.85, z: h.z }; say(PA_VOICE, S.paQueue.line, 2.8); }
        S.paQueue = null;
      }
    }

    // trouble the rest of the prison already handled: a cuffing, the hole
    const cuffed = !!(CBZ.jailEscortPhase && CBZ.jailEscortPhase());
    if (cuffed && !S.cuffWas) { summon("cuffed"); if (S.call) endCall(); }
    S.cuffWas = cuffed;
    const hole = !!(CBZ.playerCellSealed && CBZ.playerCellSealed());
    if (S.holeWas && !hole && S.pending) S.pending.hole = true;
    S.holeWas = hole;

    // the favor: the blade picked up brings the officer back for you
    if (S.favor && !S.favor.picked && (inv().Shiv | 0) > S.favor.shiv0) {
      S.favor.picked = true;
      S.pending = null;
      summon("favor", { now: true });
    }

    // lockdown lifted: his line, and the clock on the next one
    if (S.lockdownMine && !lockdownOn()) {
      S.lockdownMine = false;
      S.lastLockEnd = S.now;
      paSay(LINE.paClear);
      // the gun is still out there: every cell gets tossed, yours first
      if (S.gunToss) { S.gunToss = false; S.lastShake = -1e9; orderShakedown("gun"); }
    }

    const w = wardenG();
    if (w && !w.dead) guardHim(w, dt);
    driveOrders();
    watchGun(dt);
    drivePrivilege(dt);
    // THE GATE: a new man walks in past him
    if (w && !w.dead && !S.arrivalSaid && arriving() && P() && Math.hypot(P().x - w.group.position.x, P().z - w.group.position.z) < 12) {
      S.arrivalSaid = true;
      say(w, pick(LINE.arrival), 2.2);
    }
    // what he has to say to you since you last stood in front of him
    if (S.ack && w && !w.dead && !w.asleep && !S.meet && P()) {
      S.ack.t += dt;
      if (S.ack.t > 900) S.ack = null;
      else if (Math.hypot(P().x - w.group.position.x, P().z - w.group.position.z) < 7) { say(w, S.ack.line, 2.2); S.ack = null; }
    }
    driveEscorts(dt);
    driveShakedown(dt);
    if (!S.call && deliverable()) startCall();
    driveCall(dt);
    driveMeet(dt);
  });

  /* ==========================================================
     6. THE CONTRACT
     ========================================================== */
  function presence() {
    const w = wardenG();
    if (!w || w.dead || (w.ko | 0) > 0 || g.mode !== "escape") return 0;
    const p = P();
    const wp = w.group.position;
    const dP = p ? Math.hypot(p.x - wp.x, p.z - wp.z) : 1e9;
    const li = S.lastInc && S.now - S.lastInc.at < hourLen() ? S.lastInc : null;
    const dI = li ? Math.hypot(li.x - wp.x, li.z - wp.z) : 1e9;
    return CORE.presence(post() || CORE.duty(blockId()), !!w.asleep, onFloor(), dP, dI);
  }
  // world/adminwing.js asks this for the post he should be on right now
  function arriving() {
    return S.runT < 55 || (S.arrivalAt != null && S.now - S.arrivalAt < 55);
  }
  function override() {
    if (!onShiftRaw()) return null;
    if (S.call || S.meet) return "office";
    if (lockdownOn()) return "rounds";
    if (arriving()) return "throat";
    return null;
  }
  function onShiftRaw() {
    const d = CORE.duty(blockId());
    return d !== "quarters";
  }
  CBZ.warden = {
    presence: presence,
    incident: incident,
    summon: summon,
    get mood() { return CORE.moodOf(S.incidents, S.now, hourLen()); },
    duty: CORE.duty,
    override: override,
    onShift: onShift,
    exposed: exposed,
    escorted: escorted,
    // the player is walking to or standing in his office on his orders
    pass: function () { return !!(S.call && S.call.phase === "lead") || !!S.meet; },
    verbs: verbs,
    act: act,
    line: function (group) { return LINE[group] ? pick(LINE[group]) : ""; },
    // THE OFFICER'S RECORD (systems/prisondoorwatch.js): a cop who keeps
    // opening doors off the schedule loses standing, and the PA says so
    officer: function (dv, lines) {
      if (g.role !== "cop" || g.mode !== "escape") return false;
      standing(dv || 0);
      if (lines && lines.length) paSay(lines);
      return true;
    },
    CORE: CORE,
    // entities/guards.js: his body, every frame
    body: body,
    guard: wardenG,
    // systems/prisonsnitch.js
    inOffice: function (x, z) { return inRect(OFFICE, x, z); },
    meeting: function () { return !!(S.meet && S.meet.opened); },
    told: told,
    lied: lied,
    checkedOut: checkedOut,
    noteOrder: noteOrder,
    order: orderOfficer,
    armed: function () { return !!S.gun.armed; },
  };

  CBZ.prisonWardenAudit = function () {
    const w = wardenG();
    const wp = w ? w.group.position : null;
    const state = !w ? "none" : (w.dead ? "dead" : ((w.ko | 0) > 0 ? "down" : (w.asleep ? "asleep" : (post() || "?"))));
    return {
      state: state,
      at: wp ? { x: Math.round(wp.x * 10) / 10, z: Math.round(wp.z * 10) / 10 } : null,
      block: blockId(), duty: CORE.duty(blockId()), override: override(),
      presence: Math.round(presence() * 100) / 100,
      mood: CORE.moodOf(S.incidents, S.now, hourLen()),
      incidents: S.log.incidents,
      recent: CORE.recent(S.incidents, S.now, hourLen(), CORE.WINDOW_H).map(function (i) { return i.kind + (i.player ? "*" : ""); }),
      lockdowns: S.log.lockdowns, shakedowns: S.log.shakedowns, summons: S.log.summons,
      deals: S.log.deals, favors: S.log.favors, threats: S.log.threats, warnings: S.log.warnings,
      ignored: S.log.ignored, found: S.log.found, assaults: S.log.assaults,
      paAddresses: S.log.pa,
      pending: S.pending ? S.pending.reason : null,
      call: S.call ? S.call.phase : null, meet: S.meet ? (S.meet.opened ? "open" : "waiting") : null,
      shake: S.shake ? S.shake.phase : null,
      escorts: S.escorts.length, escorted: escorted(), exposed: exposed(),
      standing: g.wardenStanding || 0, favor: S.favor ? (S.favor.picked ? "picked" : "out") : null,
      orders: S.log.orders || 0, noYard: S.blockSeq < S.noYard, lies: g.wardenLies || 0,
      gun: S.gun.armed ? "armed" : (S.gun.phase || (S.gun.missing ? "missing" : (gunRef() ? "in place" : "none"))),
      arriving: arriving(),
      lastDecision: S.lastDecision,
    };
  };
})();
