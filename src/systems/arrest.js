/* ============================================================
   systems/arrest.js — GETTING ARRESTED IS A CONTEST, NOT A CUTSCENE.

   Owner, 2026-09-28: "when I get handcuffed it's almost like a cutscene.
   It's not realistic. I'm getting handcuffed too easily."

   Before this file every game ran its own arrest of the player, and every
   one of them was a scene: the city's bust() locked your input the instant
   the ladder said "cuff" and played a 0.9 s hands-up pose; the prison threw
   you on the floor, took the camera and tased you AFTER you complied; a
   tackle was a 6.5 m/s homing missile with a 6.5 m reach that always put you
   down; the struggle was a timed button that lost by default.

   Now the PLAYER'S arrest is one thing, here, for every game:

     THE RULE      a cop can only put cuffs on a man who is
                     compliant  (stopped, hands up, on the ground after an order)
                     subdued    (tased and down, pinned under a tackle, knocked down)
                     outnumbered and grabbed from behind
                   A running man has to be CAUGHT (A.lungeAim: a tackle is a
                   committed lunge that can miss and leaves the cop on the
                   ground), a fighting man has to be tased or beaten first.
                   brain.js authority asks A.canCuff; verbs.js does the bodies.
     THE CONTEST   hands on you are a contest (A.contest): your pull (your
                   wind and your strength, how you time it against his
                   brace) against his hold (his size and trade, how many are
                   on you, whether you are pinned or cuffed, how tired he is).
                   verbs.js's struggle runs it every frame for any held
                   player; nothing on screen names it, the bodies show it.
     THE TAKE      A.take(officer, opts): hands on (the cuff verb's reach),
                   the cuffs (one wrist, then the other, ~2.5 s, a last
                   struggle possible), then the escort (an arm and the cuffs,
                   walked where the game wants you, still resistible: pull
                   away, drop your weight, a crewmate can jump him). Your
                   input is live until the hands are actually on you.
     THE TASER     A.tase(officer): probes can miss (range, a moving target),
                   a hit drops you and you are subdued for the ride of it.
     CUFFED LOOSE  a man who tears out of an escort is still in cuffs: slower,
                   no hands. Out of every officer's reach for a while and he
                   works them off.

   Pure where it can be (the contest, the rule, the lunge, the tiers): no
   THREE in those, plain node runs them (tools/arrest-check.mjs).
============================================================ */
(function () {
  "use strict";
  const W = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis.window : null);
  const CBZ = W && W.CBZ;
  if (!CBZ) { if (typeof module !== "undefined") module.exports = null; return; }
  const g = CBZ.game || (CBZ.game = {});
  const A = CBZ.arrest = CBZ.arrest || {};

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mode() { return (g && g.mode) || ""; }
  const V = () => CBZ.verbs || null;

  /* ============================================================
     TIERS — who is putting hands on you. A lone patrol cop is a man with a
     belt; a SWAT stack is three men who do this for a living; a guard is a
     guard, and a wing with a tower over it is a wing.
     ============================================================ */
  const TIERS = {
    patrol: { hold: 1.09, taseHit: 0.78, runFor: 9,  lungeSkill: 0.55 },
    swat:   { hold: 1.40, taseHit: 0.92, runFor: 13, lungeSkill: 0.80 },
    guard:  { hold: 1.10, taseHit: 0.82, runFor: 8,  lungeSkill: 0.60 },
    warden: { hold: 0.95, taseHit: 0.70, runFor: 5,  lungeSkill: 0.40 },
    civ:    { hold: 0.85, taseHit: 0.00, runFor: 7,  lungeSkill: 0.35 },
  };
  A.TIERS = TIERS;
  function tierOf(o) {
    if (!o) return "civ";
    if (o.swat || o.kind === "swat") return "swat";
    if (o.kind === "warden") return "warden";
    if (o.kind === "guard" || (CBZ.guards && CBZ.guards.indexOf(o) >= 0)) return "guard";
    if (o.kind === "cop" || o.copRank || (CBZ.cityCops && CBZ.cityCops.indexOf(o) >= 0)) return "patrol";
    return "civ";
  }
  A.tierOf = tierOf;
  A.tier = function (o) { return TIERS[tierOf(o)] || TIERS.civ; };

  /* ============================================================
     THE RULE (pure). ctx:
       compliant  stopped / hands up / kneeling / prone on an order
       subdued    tased, knocked down, winded on the floor
       pinned     under a tackle that landed
       cuffed     already in cuffs (a re-take is just an escort)
       behind     the officer is behind him (his back to the hands)
       backup     OTHER officers within arm's reach of him
       fighting   swinging at somebody right now
     Returns the reason cuffs may go on, or null.
     ============================================================ */
  A.canCuff = function (ctx) {
    if (!ctx) return null;
    if (ctx.cuffed) return "cuffed";
    if (ctx.subdued) return "subdued";
    if (ctx.pinned) return "pinned";
    if (ctx.fighting) return null;                         // beaten or tased first
    if (ctx.compliant) return "compliant";
    if (ctx.behind && (ctx.backup | 0) >= 1) return "outnumbered";
    return null;
  };

  /* ============================================================
     THE CONTEST (pure). A held man's PULL against the HOLD on him, every
     frame. verbs.js keeps one state per session (S.cst) and feeds it:
       inp.effort   0..1  the steady pull (a held direction, dead weight)
       inp.wrench   true on the frame of a press (Space / click / tap)
       inp.hold     the grabber's hold this frame (A.holdOf)
       inp.pullMul  what state he is in (tased 0.2, winded 0.75, fresh 1)
       inp.strength his size against the grabber's (1 = even)
     The grabber braces and eases on a visible beat; a wrench in the ease is
     worth four in the brace, and only the first in each ease counts full.
     Progress is how far off the grip he is (1 = loose). While he is not
     pulling, the grip settles back. Wind is his breath: every pull spends it,
     and a gassed man pulls like one.
     ============================================================ */
  const C = A.CONTEST = {
    BEAT: 1.55,          // grip re-sets per second (the brace you SEE)
    RATE: 0.70,          // progress per second per unit of net pull
    HOLD_K: 0.45,        // how much of the hold a steady pull has to beat
    WRENCH: 0.32,        // progress from one well-timed wrench against hold 1
    BRACE_W: 0.25,       // a wrench into the brace is worth this much of one
    SETTLE: 0.30,        // progress lost per second per unit hold while not pulling
    DRAIN: 10,           // wind per second of steady all-out pull (100 = full)
    WRENCH_WIND: 4,      // wind per wrench
    WIND_FLOOR: 0.22,    // a gassed man still pulls this fraction
    FATIGUE: 0.10,       // the grabber's hold lost per second of hard struggle...
    FATIGUE_MAX: 0.30,   // ...up to this much (he recovers when it stops)
    NOISE: 0.50,         // +- per beat on how hard he braces (a man re-setting a grip is no machine)
  };
  function rnd(st) {
    // a per-contest LCG: deterministic under a seed (sims), varied otherwise
    st.seed = (st.seed * 1103515245 + 12345) & 0x7fffffff;
    return st.seed / 0x7fffffff;
  }
  A.contest = {
    begin: function (seed) {
      return {
        prog: 0, beat: 0, cycle: 0, goodCycle: -1, brace: 1, braceK: 1, fatigue: 0,
        seed: (seed == null ? (Math.random() * 0x7fffffff) | 0 : seed | 0) || 1, windSpent: 0,
        effortT: 0, pullNow: 0, holdNow: 0,
      };
    },
    // the brace curve: 0..1, tight in the first half of the beat, slack in the second
    brace: function (st) { return st.beat < 0.5 ? Math.sin(st.beat * 2 * Math.PI) : 0; },
    inEase: function (st) { return st.beat >= 0.5 && st.beat < 0.95; },
    /* one frame. wind: {get() -> 0..1, spend(units)}. Returns "escaped" | null */
    step: function (st, dt, inp, wind) {
      const b = st.beat + dt * C.BEAT;
      if (b >= 1) { st.cycle++; st.braceK = 1 + (rnd(st) * 2 - 1) * C.NOISE; }
      st.beat = b % 1;
      const w = wind ? clamp01(wind.get()) : 1;
      const windF = C.WIND_FLOOR + (1 - C.WIND_FLOOR) * w;
      const str = inp.strength > 0 ? inp.strength : 1;
      const pullMul = inp.pullMul != null ? inp.pullMul : 1;
      const hold = Math.max(0.05, (inp.hold || 1) * st.braceK * (1 - st.fatigue));
      st.holdNow = hold;
      const effort = clamp01(inp.effort || 0);
      let dp = 0;
      if (effort > 0.01) {
        const pull = effort * str * windF * pullMul;
        st.pullNow = pull;
        dp += (pull - C.HOLD_K * hold) * C.RATE * dt;
        if (wind) wind.spend(C.DRAIN * effort * dt);
        st.windSpent += C.DRAIN * effort * dt;
        st.fatigue = Math.min(C.FATIGUE_MAX, st.fatigue + C.FATIGUE * effort * dt);
      } else {
        st.pullNow = 0;
        // the grip settles back once he has stopped fighting it (a man
        // wrenching between steady pulls is still fighting)
        st.sinceWrench = (st.sinceWrench || 0) + dt;
        if (st.sinceWrench > 0.6) dp -= C.SETTLE * hold * dt;
        st.fatigue = Math.max(0, st.fatigue - C.FATIGUE * 0.5 * dt);
      }
      if (inp.wrench) {
        st.sinceWrench = 0;
        const good = A.contest.inEase(st) && st.goodCycle !== st.cycle;
        if (good) st.goodCycle = st.cycle;
        dp += C.WRENCH * (good ? 1 : C.BRACE_W) * str * windF * pullMul / hold;
        if (wind) wind.spend(C.WRENCH_WIND);
        st.windSpent += C.WRENCH_WIND;
        st.fatigue = Math.min(C.FATIGUE_MAX, st.fatigue + 0.02);
        st.lastGood = good;
      }
      st.prog = clamp01(st.prog + dp);
      st.effortT = effort > 0.01 || inp.wrench ? st.effortT + dt : 0;
      return st.prog >= 1 ? "escaped" : null;
    },
  };

  /* THE HOLD on a man (pure): the grabber's own grip (verbs.js gripOf: his
     mass against yours, his trade), times the tier, times the hands helping
     him, times where you are (pinned under him, already cuffed, taken from
     behind), times how hurt he is. */
  const HOLD = { BACKUP: 0.30, BACKUP_MAX: 3, PIN: 1.3, CUFFED: 1.35, BEHIND: 1.2 };
  A.HOLD = HOLD;
  A.holdOf = function (grip, o) {
    o = o || {};
    let h = grip > 0 ? grip : 1.2;
    h *= o.tierHold > 0 ? o.tierHold : 1;
    h *= 1 + HOLD.BACKUP * Math.min(HOLD.BACKUP_MAX, Math.max(0, o.backup | 0));
    if (o.pinned) h *= HOLD.PIN;
    if (o.cuffed) h *= HOLD.CUFFED;
    if (o.behind) h *= HOLD.BEHIND;
    if (o.hpRatio != null) h *= 0.55 + 0.45 * clamp01(o.hpRatio);
    return h;
  };

  /* ============================================================
     THE LUNGE (pure). A tackle is COMMITTED: he picks where you will be
     when he gets there, and goes. A man who holds his line is met; a man
     who cuts, stops dead or is simply faster than the gap is not.
       from (ax,az) to (tx,tz), target velocity (tvx,tvz), lunge speed,
       skill 0..1 (how well he reads you), r a 0..1 random.
     Returns { dx, dz, tHit, reach } — the direction he commits to and how
     far he can carry it.
     ============================================================ */
  const LUNGE = { SPEED: 7.6, TIME: 0.42, REACH: 2.6, CATCH: 0.62, AIM_ERR: 0.32 };
  A.LUNGE = LUNGE;
  A.lungeAim = function (ax, az, tx, tz, tvx, tvz, skill, r) {
    const dx0 = tx - ax, dz0 = tz - az, d0 = Math.hypot(dx0, dz0) || 1e-4;
    const tHit = Math.min(LUNGE.TIME, d0 / LUNGE.SPEED);
    // he leads you by what he read of your line, as well as he reads it
    const k = clamp01(skill == null ? 0.5 : skill);
    const lx = tx + tvx * tHit * (0.35 + 0.65 * k), lz = tz + tvz * tHit * (0.35 + 0.65 * k);
    let dx = lx - ax, dz = lz - az;
    const dl = Math.hypot(dx, dz) || 1e-4;
    dx /= dl; dz /= dl;
    // and a man at a run misjudges it a little (worse on a fast target)
    const tsp = Math.hypot(tvx, tvz);
    const err = ((r == null ? Math.random() : r) * 2 - 1) * LUNGE.AIM_ERR * (1 - 0.6 * k) * Math.min(1, tsp / 5);
    const c = Math.cos(err), s = Math.sin(err);
    return { dx: dx * c - dz * s, dz: dx * s + dz * c, tHit: tHit, reach: LUNGE.REACH };
  };

  /* ============================================================
     THE PLAYER'S WIND. The city has stamina (P.stamina, 0..staminaMax);
     the prison does not, so a struggle there spends P._wind (0..1), which
     comes back on its own. Either way a man who fought his way out of one
     pair of hands is gassed for the chase that follows.
     ============================================================ */
  function staminaMode() {
    const P = CBZ.player;
    return !!(P && typeof P.stamina === "number" && mode() !== "escape");
  }
  function stamMax() {
    const S = (mode() === "city" ? CBZ.CITY : CBZ.SURV) || {};
    return (CBZ.player && CBZ.player.maxStamina) || S.staminaMax || 100;
  }
  A.wind = {
    get: function () {
      const P = CBZ.player;
      if (!P) return 1;
      if (staminaMode()) return clamp01(P.stamina / stamMax());
      return P._wind == null ? 1 : clamp01(P._wind);
    },
    spend: function (units) {
      const P = CBZ.player;
      if (!P || !(units > 0)) return;
      if (staminaMode()) { P.stamina = Math.max(0, P.stamina - units * stamMax() / 100); P._grappleT = 0.6; return; }
      P._wind = clamp01((P._wind == null ? 1 : P._wind) - units / 100);
      P._grappleT = 0.6;
    },
  };

  /* ============================================================
     WHAT THE OFFICER SAYS, over his head (never a HUD line)
     ============================================================ */
  function say(o, line, secs) {
    if (!o || !line || o.dead) return false;
    try {
      if (mode() === "escape" && CBZ.prisonSay) return !!CBZ.prisonSay(o, line, { secs: secs || 1.8, force: true });
      if (mode() === "city" && CBZ.citySay) return !!CBZ.citySay(o, line, "#9fc3ff", { secs: secs || 1.8, force: true });
      if (CBZ.speech && CBZ.speech.say) return !!CBZ.speech.say(o, line, { secs: secs || 1.8 });
    } catch (e) {}
    return false;
  }
  A.say = say;

  /* ============================================================
     WHO IS ON YOU. Officers are the game's law bodies; the count is the
     number of OTHER usable ones within `r` of the player.
     ============================================================ */
  function officers() {
    const m = mode();
    if (m === "city") return CBZ.cityCops || [];
    if (m === "escape") return CBZ.guards || [];
    return A._officers ? (A._officers() || []) : [];
  }
  A.officers = officers;
  A.setOfficers = function (fn) { A._officers = typeof fn === "function" ? fn : null; };
  function posOf(o) { return (o && (o.pos || (o.group && o.group.position))) || null; }
  function usable(o) {
    if (!o || o.dead || o.ko > 0 || o.asleep || o.bribed > 0 || o.tied || o._airPilot || o._swatPassenger) return false;
    const ch = o.char || o.ch;
    return !(ch && (ch.koPose || (ch.fall && ch.fall.on)));
  }
  A.usable = usable;
  A.backup = function (except, r) {
    const P = CBZ.player;
    if (!P) return 0;
    const R = r || 2.6;
    let n = 0;
    const L = officers();
    for (let i = 0; i < L.length; i++) {
      const o = L[i];
      if (o === except || !usable(o)) continue;
      const p = posOf(o); if (!p) continue;
      const dx = p.x - P.pos.x, dz = p.z - P.pos.z;
      if (dx * dx + dz * dz <= R * R) n++;
    }
    return n;
  };
  // is `o` behind the player (the player's back to him)?
  A.behind = function (o) {
    const P = CBZ.player, pc = CBZ.playerChar, p = posOf(o);
    if (!P || !pc || !pc.group || !p) return false;
    const yaw = pc.group.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const dx = p.x - P.pos.x, dz = p.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    return (dx * fx + dz * fz) / d < -0.35;
  };

  /* ============================================================
     SUBDUED: the taser, the floor. subduedUntil is the one clock.
     ============================================================ */
  let subduedUntil = -1, subduedWhy = null, clock = 0;
  A.subdued = function () { return clock < subduedUntil; };
  A.subduedWhy = function () { return clock < subduedUntil ? subduedWhy : null; };
  A.subdue = function (secs, why) {
    subduedUntil = Math.max(subduedUntil, clock + (secs || 2));
    subduedWhy = why || subduedWhy || "down";
    const P = CBZ.player;
    if (P) P.stun = Math.max(P.stun || 0, secs || 2);
  };
  A.unsubdue = function () { subduedUntil = -1; subduedWhy = null; };
  // how much of your strength you have right now
  A.pullMul = function () {
    const why = A.subduedWhy();
    if (why === "tased") return 0.2;
    if (why === "pinned") return 0.75;
    if (why) return 0.45;
    return 1;
  };

  /* ============================================================
     THE TASER. Probes from `officer` at the player. A hit is not a given:
     a probe spread at 5 m on a man moving across the line misses. A hit:
     the body goes down (STRIKE's knockdown), the input is gone for the
     cycle, and he is subdued long enough to be reached and cuffed.
       returns { hit, d } (never throws)
     ============================================================ */
  const TASE = { RANGE: 6.5, STUN: 2.8, DOWN: 1.8, RELOAD: 2.6 };
  A.TASE = TASE;
  A.taseChance = function (d, targetSpeed, tierHit) {
    if (!(d <= TASE.RANGE)) return 0;
    const base = tierHit > 0 ? tierHit : 0.78;
    const rangeF = d <= 2.5 ? 1 : clamp01(1 - (d - 2.5) / (TASE.RANGE - 2.5) * 0.55);
    const moveF = clamp01(1 - Math.max(0, (targetSpeed || 0) - 1.2) * 0.07);
    return clamp01(base * rangeF * moveF);
  };
  A.tase = function (officer, opts) {
    opts = opts || {};
    const P = CBZ.player, op = posOf(officer);
    if (!P || !op || P.dead) return { hit: false, d: 99 };
    const d = Math.hypot(P.pos.x - op.x, P.pos.z - op.z);
    const t = A.tier(officer);
    // how fast he is really going (the measured ground speed, not one frame's)
    const pv = V() && V()._pv;
    const sp = pv ? Math.hypot(pv.x, pv.z) : (+P.speed || 0);
    const p = opts.chance != null ? opts.chance : A.taseChance(d, sp, t.taseHit);
    const r = opts.rng ? opts.rng() : Math.random();
    // the probes fly either way: the wire is the feedback
    if (CBZ.taserFx && CBZ.taserFx.actorTasePlayer) { try { CBZ.taserFx.actorTasePlayer(officer); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("tase"); } catch (e) {} }
    if (!(r < p)) return { hit: false, d: d };
    A.subdue(TASE.STUN, "tased");
    const Vb = V();
    if (Vb && Vb.knockdown && Vb.playerActor) {
      const dx = P.pos.x - op.x, dz = P.pos.z - op.z, l = Math.hypot(dx, dz) || 1;
      try { Vb.knockdown(Vb.playerActor(), { dir: { x: dx / l, z: dz / l }, dur: TASE.DOWN, ko: false }); } catch (e) {}
    }
    if (CBZ.shake) { try { CBZ.shake(0.5); } catch (e) {} }
    return { hit: true, d: d };
  };

  /* ============================================================
     THE TAKE — the one physical arrest of the player.

       const h = A.take(officer, {
         tier,                 // optional override ("patrol" | "swat" | "guard")
         subdued, pinned,      // how he has you (the struggle's odds)
         to: () => {x,z}|null, // where the escort walks you (null: held in place)
         walk: 1.35,           // m/s of the perp walk
         crew: () => [...],    // bodies loyal to you who might jump him
         onCuffed(h), onEscaped(h, why), onMissed(h), onArrived(h), onBroke(h, why)
       });
       h.done, h.result.outcome   ("cuffed" -> "arrived" | "escaped" | "missed" | "broke" | "cancelled")
       h.phase                    ("reach" | "cuffing" | "escort" | "arrived" | "done")
       h.cancel(), h.finish()     (let go / hand the body to the game)

     Your controls are yours until the cuff verb's hands are on you (its
     align beat): walk off during his reach and he misses (onMissed: the
     ladder escalates). From then on the input is the struggle.
     ============================================================ */
  let live = null;
  A.active = function () { return live && !live.done ? live : null; };
  function end(h, outcome, why) {
    if (!h || h.done) return;
    h.done = true; h.phase = "done";
    h.result = h.result || {};
    if (outcome) h.result.outcome = outcome;
    if (why) h.result.why = why;
    for (const k of ["cuffS", "escS"]) { const S = h[k]; if (S && !S.done) { try { S.cancel(); } catch (e) {} } h[k] = null; }
    if (live === h) live = null;
    if (h.officer) h.officer._arresting = false;
  }
  function cb(h, name, a, b) {
    const f = h.opts[name];
    if (typeof f === "function") { try { f(h, a, b); } catch (e) { if (CBZ.CONFIG && CBZ.CONFIG.DEBUG) console.error("[arrest]", name, e); } }
  }
  // what verbs.js's struggle reads off a session: the odds (kept live by
  // stepTake: who else is on you, whether you are still pinned)
  function sessOpts(h) {
    const o = {
      far: true,
      backupN: h.backupN | 0,
      tierHold: A.tier(h.officer).hold,
      pinned: !!h.pinned,
      pullMulFn: A.pullMul,
    };
    h._vo = o;
    return o;
  }
  A.take = function (officer, opts) {
    const Vb = V();
    if (!Vb || !officer || officer.dead || !CBZ.player || CBZ.player.dead) return null;
    if (live && !live.done) {
      if (live.officer === officer) return live;
      return null;                       // one pair of hands at a time on you
    }
    opts = opts || {};
    const h = {
      officer: officer, opts: opts, phase: "reach", done: false, result: null,
      t0: clock, t: 0, reachT: 0, cuffS: null, escS: null, backupN: 0, bT: 0,
      pinned: !!opts.pinned, fromBehind: !!opts.behind, crewT: 0, said: {},
      goalT: 0, stall: 0, lastP: null, dragT: 0, _crouch: false,
      cancel: function () { end(h, "cancelled"); },
      finish: function () { end(h, h.result && h.result.outcome ? h.result.outcome : "arrived"); },
      // walked to one mark, now on to the next (the gate, then the desk)
      resume: function () { if (!h.done && h.phase === "arrived") { h.phase = "escort"; h.result = { outcome: "cuffed" }; } },
    };
    officer._arresting = true;
    live = h;
    h.backupN = A.backup(officer);
    // a man cuffed on the wire (or under a knee): he keeps the trigger down /
    // his weight on you until the cuffs are closed (stepTake keeps it up)
    h.sub = opts.subdued || A.subduedWhy() === "tased" ? "tased" : null;
    if (h.sub) A.subdue(0.5, h.sub);
    if (CBZ.playerChar && CBZ.playerChar.cuffed) {
      // already in cuffs (a re-take of a man who tore loose): nothing to
      // cuff, a hand on the arm and the walk
      h.result = { outcome: "cuffed" };
      cb(h, "onCuffed");
      if (!h.done) startEscort(h);
      return h;
    }
    startCuff(h);
    return h;
  };
  function startCuff(h) {
    const Vb = V();
    // on the floor (tased, knocked down, a tackle): he hauls you up by the arm
    // for the cuffs; you are still subdued while the get-up plays
    const pa = Vb.playerActor();
    let down = false;
    try { down = Vb.body(pa).down(); } catch (e) { down = false; }
    if (down) {
      if (!h._hauled && Vb.getUp) { h._hauled = true; try { Vb.getUp(pa); } catch (e) {} }
      if (A.subdued()) A.subdue(0.4);
      h.cuffS = null; h.phase = "reach";
      return;
    }
    const o = sessOpts(h);
    o.far = 6;                          // he walks the last few metres to you himself
    o.onOutcome = function (S, k) { if (k === "cuffed") h._tied = true; };
    const S = Vb.cuff(h.officer, Vb.playerActor(), o);
    h.cuffS = S || null;
    h.phase = "reach";
    h.officer._arresting = !!S;         // (police.js leaves a body the verb is walking alone)
  }
  function startEscort(h) {
    const Vb = V();
    h.phase = "escort";
    h.t = 0;
    if (h.escS && !h.escS.done) return;
    const o = sessOpts(h);
    o.pinned = false;
    h.escS = Vb.escort(h.officer, Vb.playerActor(), o) || null;
    h._escTry = (h._escTry || 0) + 1;
    h.officer._arresting = true;
  }
  function stepTake(h, dt) {
    const Vb = V(), P = CBZ.player;
    h.t += dt;
    if (!Vb || !P || P.dead) { end(h, "cancelled", "dead"); return; }
    const off = h.officer;
    if (!off || off.dead) {
      // the hands on you are gone: cuffed, you are loose in cuffs; not yet, just loose
      const cuffed = !!(CBZ.playerChar && CBZ.playerChar.cuffed);
      end(h, cuffed ? "broke" : "escaped", "officer down");
      cb(h, cuffed ? "onBroke" : "onEscaped", "officer down");
      return;
    }
    h.bT -= dt;
    if (h.bT <= 0) { h.bT = 0.25; h.backupN = A.backup(off); if (h._vo) h._vo.backupN = h.backupN; }
    // pinned under a tackle counts for the first seconds of the cuffs, then he is just a man cuffing you
    if (h._vo) h._vo.pinned = !!h.pinned && (clock - h.t0) < 3.5;

    if (h.phase === "reach" || h.phase === "cuffing") {
      if (h.sub) A.subdue(0.25, h.sub);
      const S = h.cuffS;
      if (!S) {
        // not in reach yet: the game walks him in; we try again as he closes
        h.reachT += dt;
        if (h.reachT > (h._hauled ? 4.5 : 2.4)) { end(h, "missed", "out of reach"); cb(h, "onMissed"); return; }
        if (((h.reachT * 8) | 0) !== ((h.reachT - dt) * 8 | 0)) startCuff(h);
        return;
      }
      if (S.phase === "approach" && !S.done) {
        // YOUR CONTROLS ARE YOURS until his hands land: walk off and he missed
        const pv = Vb._pv || { x: 0, z: 0 };
        h.walkT = Math.hypot(pv.x, pv.z) > 1.3 ? (h.walkT || 0) + dt : 0;
        if (h.walkT > 0.35) {
          S.cancel();
          end(h, "missed", "walked off"); cb(h, "onMissed");
          return;
        }
      }
      if (S.phase !== "approach" && h.phase === "reach") {
        h.phase = "cuffing"; h.t0 = clock;
        if (CBZ.playerChar) CBZ.playerChar.handsUp = false;       // his hands take yours down behind you
        if (!h.said.hands) { h.said.hands = true; say(off, h.pinned ? "Stay down! Hands behind your back!" : "Hands behind your back!"); }
      }
      if (h.phase === "cuffing" && S.cst && S.cst.prog > 0.35 && !h.said.resist) { h.said.resist = true; say(off, "Stop resisting!"); }
      if (S.done) {
        const k = S.result && S.result.outcome;
        if (k === "cuffed" || h._tied || (CBZ.playerChar && CBZ.playerChar.cuffed)) {
          h.result = { outcome: "cuffed" };
          A.unsubdue();
          cb(h, "onCuffed");
          if (h.done) return;
          if (h.opts.noEscort) { end(h, "cuffed"); return; }
          startEscort(h);
          return;
        }
        if (k === "escaped") { end(h, "escaped", "struggle"); cb(h, "onEscaped", "struggle"); return; }
        end(h, "missed", k || "cancelled"); cb(h, "onMissed");
        return;
      }
      return;
    }
    if (h.phase === "escort") {
      const S = h.escS;
      if (!S) {
        if ((h._escTry | 0) < 12 && ((h.t * 6) | 0) !== (((h.t - dt) * 6) | 0)) { h.escS = null; startEscort(h); return; }
        if (h.t > 2.5) { end(h, "broke", "no escort"); cb(h, "onBroke", "no escort"); }
        return;
      }
      if (S.done) {
        const k = S.result && S.result.outcome;
        if (h.phase === "arrived") return;
        end(h, "broke", k === "escaped" ? "struggle" : (k || "let go"));
        if (k === "escaped" || k === "interrupted") say(off, "He's loose! He's in cuffs!", 2.0);
        cb(h, "onBroke", k === "escaped" ? "struggle" : (k || "let go"));
        return;
      }
      if (S.phase !== "hold") return;
      // DEAD WEIGHT: crouch and he has to drag you (and a lone man can trip on it)
      const keys = CBZ.keys || {};
      const crouch = !!(keys.c || keys.control);
      if (crouch && !h._crouch && S.cst && h.backupN < 1 && Math.random() < 0.25) {
        S.cst.prog = Math.min(0.95, S.cst.prog + 0.4);
        if (Vb.react) { try { Vb.react(off, { reaction: "stagger", zone: "legs", power: 0.5, stagger: true }); } catch (e) {} }
      }
      h._crouch = crouch;
      // THE MARCH: he walks, you go where his hands send you
      const goal = typeof h.opts.to === "function" ? h.opts.to(h) : h.opts.to;
      if (goal && isFinite(goal.x) && isFinite(goal.z)) {
        const dx = goal.x - P.pos.x, dz = goal.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d <= (h.opts.arrive || 0.6)) {
          h.phase = "arrived";
          h.result = { outcome: "arrived" };
          cb(h, "onArrived");
          return;
        }
        // round the walls, not through them: the nav grid's path, re-planned
        // as he goes (the next corner is where he steers you)
        let tx = goal.x, tz = goal.z;
        const NG = CBZ.navGrid;
        if (NG && NG.plan && NG.ready && NG.ready() && (!NG.inWindow || NG.inWindow(P.pos.x, P.pos.z))) {
          h.pathT = (h.pathT || 0) - dt;
          const key = goal.x.toFixed(1) + "," + goal.z.toFixed(1);
          if (!h.path || h.pathKey !== key || h.pathT <= 0) {
            let path = null;
            try { path = NG.plan({ x: P.pos.x, z: P.pos.z }, { x: goal.x, z: goal.z }); } catch (e) { path = null; }
            h.path = path && path.length ? path : null; h.pathKey = key; h.pathT = 2.5; h.pi = 0;
          }
          if (h.path) {
            while (h.pi < h.path.length - 1 && Math.hypot(h.path[h.pi].x - P.pos.x, h.path[h.pi].z - P.pos.z) < 0.8) h.pi++;
            const wp = h.path[h.pi];
            if (wp && h.pi < h.path.length - 1) { tx = wp.x; tz = wp.z; }
          }
        }
        let ux = tx - P.pos.x, uz = tz - P.pos.z;
        const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const pace = (h.opts.walk || 1.35) * (crouch ? 0.3 : 1) * (S.cst && S.cst.pullNow > 0 ? 0.6 : 1);
        Vb.walk(S, S, tx - ux * S.work, tz - uz * S.work, pace, dt, Math.atan2(ux, uz));
        const lp = h.lastP || (h.lastP = { x: P.pos.x, z: P.pos.z });
        const moved = Math.hypot(P.pos.x - lp.x, P.pos.z - lp.z);
        lp.x = P.pos.x; lp.z = P.pos.z;
        h.stall = moved < pace * dt * 0.2 && !crouch ? h.stall + dt : 0;
        if (h.stall > 2.5 && typeof h.opts.onStall === "function") { h.stall = 0; cb(h, "onStall"); }
      }
      // A CREWMATE JUMPS HIM: your people near you, the odds of them trying
      h.crewT -= dt;
      if (h.crewT <= 0 && typeof h.opts.crew === "function") {
        h.crewT = 1.0;
        let list = null; try { list = h.opts.crew(h); } catch (e) { list = null; }
        const op = posOf(off);
        if (list && op) {
          for (let i = 0; i < list.length; i++) {
            const m = list[i];
            const mp = posOf(m);
            if (!m || m.dead || m.ko > 0 || !mp || Vb.sessionOf(m)) continue;
            const dd = Math.hypot(mp.x - op.x, mp.z - op.z);
            if (dd > 9) continue;
            const riot = !!(CBZ.lockdown && CBZ.lockdown.active && CBZ.lockdown.active());
            const loyal = (m.personality && m.personality.loyalty != null) ? m.personality.loyalty : 0.5;
            const p = (riot ? 0.35 : 0.1) * (0.5 + loyal) / Math.max(1, 1 + h.backupN);
            if (Math.random() < p) {
              // he goes in low at the man holding you
              const T2 = Vb.tackle(m, off, { far: true, force: true });
              if (T2) { say(off, "Get off me!"); break; }
            }
          }
        }
      }
      return;
    }
  }
  A.release = function () { if (live) end(live, "arrived"); };

  /* ============================================================
     CUFFED AND LOOSE. Tore out of the escort (or his partner was jumped):
     still cuffed. Out of every officer's reach for a while and the hands
     come free (you worked them round, a friend cut the tie). A re-take is
     just an escort: nothing to cuff.
     ============================================================ */
  const LOOSE = { FREE_T: 22, NEAR_R: 14 };
  A.LOOSE = LOOSE;
  let looseT = 0;
  A.freeHands = function () {
    const Vb = V();
    if (Vb && Vb.setCuffs && Vb.playerActor) { try { Vb.setCuffs(Vb.playerActor(), false); } catch (e) {} }
    if (CBZ.playerChar) CBZ.playerChar.cuffed = false;
    looseT = 0;
    if (CBZ.sfx) { try { CBZ.sfx("reload"); } catch (e) {} }
  };
  function tickLoose(dt) {
    const pc = CBZ.playerChar, P = CBZ.player;
    if (!pc || !P || !pc.cuffed || live || P.dead) { looseT = 0; return; }
    // a game that is walking you somewhere itself (the ride, the booking)
    if (P._cityArrested || g.busted || P.captureState === "cuffed") { looseT = 0; return; }
    let near = false;
    const L = officers();
    for (let i = 0; i < L.length; i++) {
      const o = L[i], p = posOf(o);
      if (!p || !usable(o)) continue;
      if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < LOOSE.NEAR_R) { near = true; break; }
    }
    looseT = near ? Math.max(0, looseT - dt) : looseT + dt;
    if (looseT >= LOOSE.FREE_T) A.freeHands();
  }

  /* ============================================================
     THE CLOCK (before verbs.js's late pass at 91, so a take that ends this
     frame hands the body back the same frame)
     ============================================================ */
  let lastMode = null;
  function tick(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    const m = mode();
    if (m !== lastMode) { if (live) end(live, "cancelled", "mode"); A.unsubdue(); lastMode = m; looseT = 0; }
    const P = CBZ.player;
    if (P) {
      // the wind comes back on its own (the prison has no stamina loop)
      if (P._grappleT > 0) P._grappleT -= dt;
      else if (P._wind != null && P._wind < 1) P._wind = Math.min(1, P._wind + 0.09 * dt);
    }
    if (live && !live.done) stepTake(live, dt);
    tickLoose(dt);
    // hands up is a promise: walk off and they come down
    const pc = CBZ.playerChar;
    if (pc && pc.handsUp && P && !live && !g.busted && !P._cityArrested && (+P.speed || 0) > 1.0) {
      pc.handsUp = false;
      if (g._citySurrender) g._citySurrender = false;
    }
  }
  A.tick = tick;
  A.clock = function () { return clock; };
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(89.5, tick);

  if (typeof module !== "undefined" && module.exports) module.exports = A;
})();
