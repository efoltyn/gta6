/* ============================================================
   city/schedule.js — DAILY TIMETABLES + the OFFLINE LEDGER (the LoD of
   the online). Two ideas stolen from the games that solved living cities:

   • KINGDOM COME's schedules: every persistent identity runs a daily
     timetable derived from WHO THEY ARE — the worker commutes, lunches
     and hits the bar after the whistle; the dealer takes the corner at
     dusk and walks the take to the trap on a stash run; the gangster
     rotates HQ/turf posts; the vagrant works the daylight circuit and
     beds down at the camp fire; the clubgoer owns the night core. The
     timetable is only a PROPOSER — aigoals.js keeps arbitration, so a
     grudge, a provoked crew or a craving always outranks the calendar.
   • STALKER's offline A-Life: a despawned identity doesn't die — it
     keeps living on paper. The ledger stores {who, wallet, phase}; when
     a body spawns where that identity is DUE right now, the identity is
     dealt back onto it, FAST-FORWARDED: the dealer who worked his corner
     all day re-enters CARRYING the day's take. WHY: casing one dealer
     across days becomes a real score (money), and the same vendor at the
     same stall every morning makes the city learnable (show off that you
     know it). Street-remembers state (grudge/respect/your name) rides
     the same entries, so the man you robbed still crosses the street.

   CLOCK: keyed ONLY to the canonical sun (CBZ.sunAngle/nightAmount from
   core/daynight.js). The peds.js cityHour loop is desynced by design and
   is NEVER read here (unification deliberately deferred).

   COST/LOD (KCD ran 300 schedules in ~1.7ms; we budget far under that):
   near peds are scheduled through aigoals' existing slice + goal-cooldown
   (full rate where you look, ~1/30 of the crowd per frame); the sun-hour
   every consumer reads is cached at 8Hz; offline entries advance on a
   0.5Hz rolling sweep (a few per tick), 900-identity LRU cap (raised again
   for W5: family pages now qualify too — the sweep stays a fixed 16
   entries/2s and the deal-in scan is ≤CAP squared-dist compares per
   promotion, so the budget is flat), no per-frame
   allocation (one reused proposal scratch). Host-only — guests'
   crowds are set dressing (the host owns the population).

   CBZ.cityNpcLedger = { serialize(), apply(obj) } feeds world persistence
   (src/net/netpersist.js consumes it, guarded). Wall-clock timestamps
   mean a saved world's dealers kept earning while the server slept.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  let _s = 90210;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const wall = () => Date.now();
  const hostSim = () => !(CBZ.net && CBZ.net.noSim && CBZ.net.noSim());

  // ---- the SUN HOUR: 0..24 derived from the sun's actual arc (sunrise 6,
  //      noon 12, sunset 18, midnight 0). Cached at 8Hz — every read below
  //      (proposer, fast-forward, vendor till) uses the cache. ----
  const DAY_SECS = 150;            // mirrors core/daynight.js CYCLE
  let _h = 9, _hT = 0;
  function computeHour() {
    if (CBZ.sunAngle != null) return (((CBZ.sunAngle / (Math.PI * 2)) * 24) + 6) % 24;
    return (CBZ.nightAmount || 0) > 0.5 ? 1 : 12;   // coarse fallback pre-publish
  }
  CBZ.citySunHour = function () { return _h; };

  // ============================================================
  //  TIMETABLES — who you are decides where your day puts you
  // ============================================================
  function castKey(ped) {
    if (ped.vendor) return "vendor";
    if (ped.vagrant || ped.archetype === "vagrant") return "vagrant";
    if (ped.gang) return ped.archetype === "dealer" ? "dealer" : "gangster";
    const a = ped.archetype;
    if (a === "dealer" || a === "hustler") return "dealer";
    if (ped._role === "clubgoer" || a === "socialite" || ped.job === "out on the town") return "clubgoer";
    const JK = CBZ.cityJobKinds;                    // aigoals' job→lot vocabulary
    if (JK && JK[ped.job]) return "worker";
    return "drifter";                               // no fixed life — stays emergent
  }
  // the activity this identity OWES the hour. salt (0..1, per identity) keeps
  // the whole city from moving in lockstep: shifts stagger, not everyone bars.
  // Workers run THEIR OWN shift window (CBZ.cityJobs hours — the bartender
  // works nights, the docker pre-dawn), so the street turns over in waves
  // instead of one synchronized 9-to-5 tide.
  function actOf(k, h, salt, job) {
    salt = salt || 0.5;
    if (k === "worker") {
      const J = CBZ.cityJobs && CBZ.cityJobs[job];
      const s = J && J.hours ? J.hours[0] : 9, e = J && J.hours ? J.hours[1] : 18;
      const len = ((e - s + 24) % 24) || 9;          // shift length, wrap-safe (night shifts)
      const into = (h - s + 24) % 24;                // hours into the shift
      if (into < len) {
        const mid = len / 2;                         // a mid-shift bite for most
        if (into >= mid - 1 && into < mid + 1 && salt < 0.75) return "lunch";
        return "work";
      }
      const off = (h - e + 24) % 24;                 // hours since the whistle
      if (off < 2.5 && salt < 0.55) return "bar";    // some clock straight out
      const pre = (s - h + 24) % 24;                 // hours until the next shift
      if (pre <= 2) return "commute";
      return "home";
    }
    if (k === "vendor") return (h >= 7 && h < 21) ? "stall" : "closed";
    if (k === "dealer") {
      if (h >= 17 || h < 3) {
        // the corner shift — once in a while the take walks to the trap
        if ((((h | 0) + ((salt * 7) | 0)) % 5) === 0) return "stash";
        return "corner";
      }
      if (h < 11) return "home";                    // sleeping off the shift
      return "layup";                               // low-key near the trap by day
    }
    if (k === "gangster") {
      if (h >= 2 && h < 9) return "home";
      return ((((h / 3) | 0) + ((salt * 3) | 0)) % 3) === 0 ? "hq" : "post";
    }
    if (k === "vagrant") return (h >= 7 && h < 20) ? "panhandle" : "camp";
    if (k === "clubgoer") {
      if (h >= 19 || h < 3) return "club";
      if (h < 11) return "home";
      return null;                                  // afternoons drift (emergent)
    }
    return null;
  }
  // proposal strengths sit UNDER the urgent drives in aigoals' utility race
  // (feud 0.95 / defend up to ~1.4 / dusk clock-out 1.05) — threats pre-empt.
  const SCORE = {
    commute: 0.92, work: 0.5, lunch: 0.62, bar: 0.58, home: 0.85,
    corner: 0.9, stash: 0.86, layup: 0.35, post: 0.55, hq: 0.62, // stash < feud 0.95 even at max jitter — a grudge outranks the calendar
    camp: 0.9, club: 0.85,
  };
  // $-per-sim-hour by activity: what an OFFLINE identity accrues (the dealer's
  // corner is the fat one — that take is the whole point of casing him).
  // A worker's "work" hour pays the JOB's wage (CBZ.cityJobs .pay — a doctor's
  // wallet fattens faster than a student's), falling back to the flat 12.
  const RATE = {
    corner: 80, layup: 6, stall: 40, work: 12, post: 8, hq: 10,
    panhandle: 3, lunch: -4, bar: -8, club: -26,
  };
  function wageOf(job) {
    const J = CBZ.cityJobs && CBZ.cityJobs[job];
    return J && J.pay ? J.pay : RATE.work;
  }

  // one reused proposal scratch — aigoals consumes it synchronously per ped
  const _prop = { act: "", score: 0, mood: null };
  CBZ.citySchedProposal = function (ped) {
    if (!ped || ped.dead) return null;
    let S = ped._sched;
    if (!S || S.a !== ped.archetype || S.j !== ped.job) {   // recast → new life, new timetable
      S = ped._sched = { k: castKey(ped), salt: rng(), a: ped.archetype, j: ped.job };
    }
    if (S.k === "drifter" || S.k === "vendor") return null;   // posted / emergent
    const act = actOf(S.k, _h, S.salt, S.j);
    if (!act) return null;
    const sc = SCORE[act];
    if (!sc) return null;                            // panhandle: peds.js' beg loop owns it
    _prop.act = act;
    _prop.mood = act === "commute" ? "hurry" : null;
    // already living this hour's activity → low re-anchor pull, so chats,
    // errands and street moments happen AROUND the anchor instead of never
    _prop.score = ped._schedAct === act ? sc * 0.25 : sc;
    return _prop;
  };

  // ============================================================
  //  THE OFFLINE LEDGER — identities the city remembers (LRU, cap 900 —
  //  raised from 600 for W5: a boss/tycoon's spouse/kid is now ledger-worthy
  //  too (worth() below), so households persist instead of respawning as
  //  strangers. Cost stays flat: the sweep window is fixed-size and the deal
  //  scan is one bounded squared-dist pass. JSON budget re-checked: entries
  //  run ~280B, so 900 × 280B ≈ 250KB — still far under the 1.4MB wsave cap.)
  // ============================================================
  const CAP = 900, DEAL_R2 = 45 * 45;
  let led = {};                  // sid -> entry (plain JSON-able objects only)
  let list = [];                 // same entries, for rolling sweeps
  let liveBy = {};               // sid -> live ped ref (never serialized)
  let seq = 1;

  // is this person worth a page in the book? (selective, or the cap churns)
  function worth(ped) {
    if (ped.vendor || ped.gang || ped.nameKnown || ped.bounty) return true;
    // FAMILY (W5): a boss/tycoon's household is worth a page too — family.js
    // stamps p.family = role (a STRING) on its wife/kid; social.js stamps
    // isFamily/protectGang on the spouse+kid it weaves for a boss/rich head.
    // Deliberately narrower than ped.partner (~45% of civilians are coupled —
    // that would blow the cap): only these protected-household markers count.
    if (ped.protectGang || ped.isFamily || typeof ped.family === "string") return true;
    const k = castKey(ped);
    if (k === "dealer") return true;
    const r = ped.relPlayer;
    if (r && r.seen && (Math.abs(r.grudge) > 8 || r.respect > 12 || r.fear > 14)) return true;
    if (k === "worker" && ped._jobLot) return true;  // a learnable commute
    if ((ped.cash | 0) > 140) return true;           // a mark worth re-finding
    return false;
  }
  function trim() {
    while (list.length > CAP) {
      let oi = -1, ot = Infinity;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (liveBy[e.sid]) continue;                 // never evict a standing body
        if (e.seen < ot) { ot = e.seen; oi = i; }
      }
      if (oi < 0) return;
      delete led[list[oi].sid];
      list.splice(oi, 1);
    }
  }
  function dropSid(sid) {
    const e = led[sid];
    if (!e) return;
    delete led[sid]; delete liveBy[sid];
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
  }

  // bank a live ped into its entry. Called when a body leaves play (crowd.js
  // park), just before an hour-recast rewrites it, and on the live refresh
  // sweep, so the page is never more than a couple of seconds stale.
  CBZ.cityPedStash = function (ped) {
    if (!hostSim() || !ped || ped.dead || ped.isPlayer || ped.companion || ped.controlled || ped.recruited) return;
    let sid = ped._sid;
    if (!sid && !worth(ped)) return;
    if (!sid) sid = ped._sid = "p" + (seq++);
    let e = led[sid];
    if (!e) { e = led[sid] = { sid }; list.push(e); trim(); }
    const t = wall();
    e.k = castKey(ped);
    e.salt = (ped._sched && ped._sched.salt) || e.salt || rng();
    e.name = ped.name; e.arch = ped.archetype; e.job = ped.job;
    e.wealth = ped.wealth || 0.3; e.aggr = ped.aggr || 0.3; e.drug = !!ped.drugUser;
    e.cash = ped.cash | 0; e.known = !!ped.nameKnown;
    // W5: gender + the longHair roll (peds.js makePed) — compact ints, same as
    // the fields above — so a woman who despawns comes back a woman.
    e.sex = ped.gender === "f" ? 1 : 0; e.lh = ped._longHair ? 1 : 0;
    const r = ped.relPlayer;   // the street remembers — grudges ride the page
    e.rel = (r && r.seen) ? { r: r.respect | 0, f: r.fear | 0, l: r.loyalty | 0, a: r.affection | 0, g: r.grudge | 0, s: r.seen | 0 } : null;
    if (!ped._parked) {        // a parked body sits off-map — keep the old spots
      // anchors: where this life WORKS and where it SLEEPS (doors, posts, fires)
      let jx = null, jz = null;
      const jl = ped._jobLot && ped._jobLot.building && ped._jobLot.building.door;
      if (jl) { jx = jl.x; jz = jl.z; }
      else if (ped.vendor && ped.vendor.building && ped.vendor.building.vendorSpot) { jx = ped.vendor.building.vendorSpot.x; jz = ped.vendor.building.vendorSpot.z; }
      else if (ped.gang && CBZ.cityGangById) { const G = CBZ.cityGangById(ped.gang); if (G && G.center) { jx = G.center.x; jz = G.center.z; } }
      else if (ped._beg) { jx = ped._beg.x; jz = ped._beg.z; }
      if (jx == null) { jx = ped.pos.x; jz = ped.pos.z; }   // last seen working = the spot
      e.jx = jx; e.jz = jz;
      const hl = ped._digs && ped._digs.building && ped._digs.building.door;
      if (hl) { e.hx = hl.x; e.hz = hl.z; }
      else if (e.hx == null) { e.hx = ped.pos.x; e.hz = ped.pos.z; }
      e.tx = ped.pos.x; e.tz = ped.pos.z;
    }
    e.act = ped._schedAct || e.act || null;
    e.t = t; e.seen = t; e.alive = true;
  };

  // delta fast-forward: walk the sim-hours this identity lived off-page and
  // accrue/spend by activity. Stash runs flush the carry (the take banked at
  // the trap), so the window to rob a dealer fat is REAL, not cosmetic.
  function fastForward(e) {
    const t = wall();
    let hrs = (t - (e.t || t)) / 1000 * (24 / DAY_SECS);
    e.t = t;
    if (hrs > 0) {
      if (hrs > 48) hrs = 48;                        // two city days max — no infinities
      let cash = e.cash | 0;
      const n = Math.ceil(hrs);
      for (let i = 0; i < n; i++) {
        const span = Math.min(1, hrs - i);
        const hh = (_h - hrs + i + 240) % 24;        // the hour this slice happened at
        const act = actOf(e.k, hh, e.salt, e.job);
        if (act === "stash") cash = Math.min(cash, 40);
        else if (act === "work") cash += wageOf(e.job) * span * (0.6 + (e.wealth || 0.3) * 0.8);
        else if (RATE[act]) cash += RATE[act] * span * (0.6 + (e.wealth || 0.3) * 0.8);
      }
      e.cash = Math.max(0, Math.min(2500, cash | 0));
    }
    // where the timetable puts them RIGHT NOW (the deal-in spawn match)
    const act = actOf(e.k, _h, e.salt, e.job) || "home";
    e.act = act;
    const homeish = act === "home" || act === "camp";
    if (homeish ? e.hx != null : e.jx != null) {
      e.tx = homeish ? e.hx : e.jx;
      e.tz = homeish ? e.hz : e.jz;
    }
  }

  // a fresh body just got dealt as a "new person" (crowd promotion / hour
  // recast). If a remembered identity is DUE at this spot, it walks back in
  // instead — fast-forwarded, carrying its accrued wallet and its grudges.
  CBZ.cityPedDeal = function (ped) {
    if (!hostSim() || g.mode !== "city" || !ped || ped.dead) return;
    if (ped.vendor || ped.gang || ped.isPlayer || ped.companion || ped.recruited ||
        ped.controlled || ped.bounty || ped.isFamily || ped.kind !== "civilian") return;
    const t = wall();
    if (ped._sidFresh && t - ped._sidFresh < 4000) return;       // just dealt — idempotent
    if (ped._sid) {                                  // the old page lets the body go
      if (liveBy[ped._sid] === ped) delete liveBy[ped._sid];
      ped._sid = null; ped._sched = null; ped._schedAct = null;
    }
    // gender-matched entry pick (W3 precedent, crowd.js pickFreeSlot): the fresh
    // body's rig (build/hair) is ALREADY fixed by the time this runs (spawn ran
    // first), so we can't rebuild geometry — instead prefer the nearest entry
    // whose stored sex agrees with this body's rolled gender, and only fall
    // back to the plain-nearest entry (rare visual mismatch) when none matches
    // within range. e.sex == null covers old saves from before this field existed.
    const wantSex = ped.gender === "f" ? 1 : 0;
    let best = null, bd = DEAL_R2;
    let bestM = null, bdM = DEAL_R2;
    for (let i = 0; i < list.length; i++) {          // ≤200 squared-dist compares
      const e = list[i];
      if (!e.alive || liveBy[e.sid] || e.k === "vendor" || e.k === "gangster" || e.tx == null) continue;
      const dx = e.tx - ped.pos.x, dz = e.tz - ped.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = e; }
      if ((e.sex == null || e.sex === wantSex) && dd < bdM) { bdM = dd; bestM = e; }
    }
    best = bestM || best;
    if (!best) return;
    fastForward(best);
    ped.name = best.name || ped.name;
    ped.archetype = best.arch || ped.archetype;
    ped.job = best.job || ped.job;
    if (best.wealth != null) ped.wealth = best.wealth;
    if (best.aggr != null) ped.aggr = best.aggr;
    ped.drugUser = !!best.drug;
    ped.cash = best.cash | 0;                        // the carry — the whole score
    ped.nameKnown = !!best.known;
    // restore identity's sex/hair onto the record (soft-matched above, so this
    // is usually a no-op; on the rare mismatch the rig geometry stays as spawned
    // — accepted, cheap, matches the W3 precedent's own fallback tradeoff).
    if (best.sex != null) ped.gender = best.sex ? "f" : "m";
    if (best.lh != null) ped._longHair = !!best.lh;
    if (best.rel) ped.relPlayer = { respect: best.rel.r, fear: best.rel.f, loyalty: best.rel.l, affection: best.rel.a, grudge: best.rel.g, seen: best.rel.s || 1, t: 0, ambushT: 0 };
    ped._dayCast = null; ped._role = null; ped._dripKey = null;  // this IS the person now
    ped._sched = { k: best.k, salt: best.salt || 0.5, a: ped.archetype, j: ped.job };
    ped._schedAct = null;                            // let the timetable re-anchor them
    ped._jobLot = null; ped._digs = null;            // re-derive toward the stored anchors
    ped._sid = best.sid; ped._sidFresh = t;
    liveBy[best.sid] = ped; best.seen = t;
    // a regular reads as a regular — one street line, only for someone you KNOW
    if (best.known && CBZ.citySay && rng() < 0.3) {
      CBZ.citySay(ped, best.k === "dealer" ? "“Same corner, same me.”" : "“Back at it — you know how it is.”", "#cfe6ff", 2.2);
    }
  };

  // aigoals' recycle hygiene calls this the tick a parked body re-enters play:
  // release a STALE identity (the body is someone new) but never wipe a deal
  // that just landed (crowd.js deals before the hygiene tick runs).
  CBZ.cityScheduleRecycled = function (ped) {
    if (!ped) return;
    if (ped._sidFresh && wall() - ped._sidFresh < 4000) return;
    if (ped._sid && liveBy[ped._sid] === ped) delete liveBy[ped._sid];
    ped._sid = null; ped._sched = null; ped._schedAct = null; ped._sidFresh = 0;
  };

  // fresh run (spawnCityPeds → cityRampageReset): the bodies are gone but the
  // BOOK survives — identities re-deal onto the new population at their spots.
  CBZ.cityScheduleNewRun = function () { liveBy = {}; _vendScan = 0; _swCur = 0; };

  // ---- taps via the established wrap pattern (no edits in peds.js). Each
  //      wraps ONCE per load and carries the previous wrapper's idempotence
  //      flags forward (social.js/killfeed.js check theirs on the current fn). ----
  let _wrappedKill = false, _wrappedRecast = false;
  function carry(w, prev) { for (const k in prev) w[k] = prev[k]; w._schedWrapped = true; return w; }
  function wrapTaps() {
    const ok = CBZ.cityKillPed;
    if (!_wrappedKill && typeof ok === "function") {
      _wrappedKill = true;
      CBZ.cityKillPed = carry(function (ped) {
        if (ped && ped._sid) dropSid(ped._sid);      // the dead don't walk back in
        return ok.apply(this, arguments);
      }, ok);
    }
    const or = CBZ.cityRecastForHour;
    if (!_wrappedRecast && typeof or === "function") {
      _wrappedRecast = true;
      CBZ.cityRecastForHour = carry(function (ped, r) {
        // about to be rewritten as someone new — bank who they WERE first.
        // _wasParked = a body fresh out of the pool (crowd.assign already moved
        // it): its park-moment stash is the truth, and the explicit promotion
        // deal handles it — touching it here would glue identities to the body.
        if (ped && ped._sid && !ped._parked && !ped._wasParked && !ped.dead && CBZ.cityPedStash) CBZ.cityPedStash(ped);
        const changed = or.apply(this, arguments);
        // a new face stepped in — unless the book says this spot is taken
        if (changed && ped && !ped._wasParked && CBZ.cityPedDeal) CBZ.cityPedDeal(ped);
        return changed;
      }, or);
    }
  }

  // ---- vendors: bound to stable stall sids ("v:kind:x,z" — the city build is
  //      deterministic, so the SAME stall maps across runs/sessions). The till
  //      fattens through open hours (rob the register at closing, not at dawn)
  //      and a saved world hands the stall back its till + your standing. ----
  let _vendScan = 0;
  function vendorSweep(A, t) {
    const ls = A.shopLots;
    if (!ls || !ls.length) return;
    for (let n = 0; n < 3; n++) {
      const lot = ls[_vendScan % ls.length]; _vendScan++;
      const v = lot.building && lot.building.vendor;
      if (!v || v.dead) continue;
      if (!v._sid) {
        v._sid = "v:" + lot.kind + ":" + Math.round(lot.cx) + "," + Math.round(lot.cz);
        const e0 = led[v._sid];
        if (e0 && e0.alive) {                        // the same keeper opens the same stall
          fastForward(e0);
          e0.cash = Math.min(600, e0.cash | 0);      // a stall till tops out where the live sweep does
          if ((e0.cash | 0) > (v.cash | 0)) v.cash = e0.cash | 0;
          if (e0.known) v.nameKnown = true;
          if (e0.rel) v.relPlayer = { respect: e0.rel.r, fear: e0.rel.f, loyalty: e0.rel.l, affection: e0.rel.a, grudge: e0.rel.g, seen: e0.rel.s || 1, t: 0, ambushT: 0 };
          liveBy[v._sid] = v; e0.seen = t;
          // one greeting for a face the stall knows — diegetic, near-gated by citySay
          if (e0.known && CBZ.citySay && CBZ.player && !CBZ.player.dead && rng() < 0.5) CBZ.citySay(v, "“Morning. The usual face.”", "#cfe6ff", 2.2);
          continue;
        }
      }
      let e = led[v._sid];
      if (!e) { CBZ.cityPedStash(v); e = led[v._sid]; if (!e) continue; }
      const eHrs = Math.min(2, (t - (e.accT || t)) / 1000 * (24 / DAY_SECS));
      e.accT = t;
      if (actOf("vendor", _h, e.salt) === "stall") v.cash = Math.min(600, (v.cash | 0) + Math.round((RATE.stall || 0) * eHrs));
      CBZ.cityPedStash(v);                           // refresh the page from the live till
      liveBy[v._sid] = v;
    }
  }

  // ============================================================
  //  TICKS — 8Hz hour cache; 0.5Hz offline sweep (the city working on paper)
  // ============================================================
  let _swT = 0, _swCur = 0;
  CBZ.onUpdate(35.8, function (dt) {
    _hT -= dt;
    if (_hT <= 0) { _hT = 0.125; _h = computeHour(); }
    if (g.mode !== "city" || !hostSim()) return;
    _swT -= dt;
    if (_swT > 0) return;
    _swT = 2;
    wrapTaps();
    const t = wall();
    const A = CBZ.city && CBZ.city.arena;
    if (A) vendorSweep(A, t);
    const n = list.length;
    for (let k = 0; k < 16 && n; k++) {              // rolling window, bounded (16/2s keeps a 600 book ~75s-fresh)
      const e = list[_swCur % n]; _swCur++;
      if (!e || !e.alive) continue;
      const body = liveBy[e.sid];
      if (body) {
        // live-bodied: keep the page true (or release a body that's gone)
        if (body.dead || body._parked || body._sid !== e.sid) { delete liveBy[e.sid]; e.t = t; }
        else CBZ.cityPedStash(body);
        continue;
      }
      fastForward(e);                                // offline: the day advances
    }
  });

  // ============================================================
  //  world persistence surface (consumed by src/net/netpersist.js, guarded)
  // ============================================================
  CBZ.cityNpcLedger = {
    serialize: function () {
      for (const sid in liveBy) {                    // bank every standing body first
        const p = liveBy[sid];
        if (p && !p.dead && !p._parked && p._sid === sid) CBZ.cityPedStash(p);
      }
      const ids = [];
      for (let i = 0; i < list.length; i++) if (list[i].alive) ids.push(list[i]);
      return { v: 1, ids };
    },
    apply: function (obj) {
      if (!obj || obj.v !== 1 || !Array.isArray(obj.ids)) return;
      led = {}; list = []; liveBy = {};
      for (let i = 0; i < obj.ids.length && list.length < CAP; i++) {
        const e = obj.ids[i];
        if (!e || !e.sid || !e.name || led[e.sid]) continue;
        e.alive = true;
        led[e.sid] = e; list.push(e);
        const m = /^p(\d+)$/.exec(e.sid);
        if (m) seq = Math.max(seq, (+m[1]) + 1);
      }
    },
  };
})();
