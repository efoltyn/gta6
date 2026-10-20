/* ============================================================
   city/custody.js — TAKING SOMEBODY IN. The one arrest pipeline.

   OWNER (2026-10-09): "When I press Detain in the president game, the person
   just disappears. That's not realistic. They don't just instantly
   disappear." / "We already have arresting built from the jail game."

   WHY HE VANISHED. orders.js's Detain called politics.act("detain") the
   moment the order was given, and politics' consequences() took every
   arrested or detained body off the board on the spot (CBZ.cityUnpostNpc).
   The agents had not reached him yet. Every other arrest was its own thing:
   a cop's arrest of a ped was cuffs plus a knockdown and then nothing (he got
   up and walked on), politics.order() vanished him the same way, the
   player's collar ended in a body hidden at the desk.

   NOW EVERY ARREST AND DETENTION OF A PERSON IN THE CITY IS THIS FILE, built
   from the pieces the jail game and the city already had:
     the rule      systems/arrest.js: cuffs go on a man who gave up or is down
     the hands     systems/verbs.js: tackle, cuff (one wrist, then the other,
                   on the floor with a knee in his back), frisk, escort (a hand
                   on his arm, one on the cuffs)
     the state     city/restrain.js's ONE enum (ped.restraint: cuffed /
                   escorted / boarding / in_vehicle); its seat() walks him to
                   the back door through city/boarding.js and the door shuts
     the ride      the arrest arc's unit (city/wanted.js): a marked cruiser
                   (CBZ.cityMarkCruiser) or a black SUV rolls up the lane
                   (CBZ.roadPick), parks at the kerb, and drives off in traffic
     the record    a DETAINEE: who he is (identity and affiliations), what was
                   found on him, where he is held (the County Jail when the
                   city has one, else the precinct), and what happens next:
                   pardon, release, trial, a visit.

   THE BEATS (a job per person, CBZ.custody.take):
     close    the officers come at him; the lead gives the order out loud
     subdue   he runs or swings: chased down and tackled
     cuff     hands on, the cuffs (the restraint enum goes "cuffed"); his gun
              is bagged, not thrown in the street. THE ACT happens here:
              politics.act fires now, with the witnesses who saw THIS
     frisk    the pat-down; the unit is already on its way
     escort   walked by the arm to the back door of the unit
     board    in, door shut (boarding.js), the restraint goes "in_vehicle"
     away     the unit pulls out and drives off; he is "in transit"
     held     only when the car is out of draw range does the body leave the
              world, and the record says "held at <facility>"
   NO SEAT, NO CAR: he is WALKED (walkoff), by the arm, away from the player,
   and leaves only where nobody sees. There is no hidden back seat any more:
   the old fallback switched the body off beside the cruiser (2026-10-14, the
   owner in Gang City: "they just disappear after they get arrested").
   THE DESK (intake, restrain.js's Hand over): booked, still cuffed, walked
   through the precinct door by the nearest officer, gone once a wall is
   between him and the player.
   The lab measures all of it: node tools/lab/run.mjs --kit detain
   (flow=player|officer|desk, car=0).
   Stand down before the cuffs and it is off (cancel()); after the cuffs he is
   in custody and leaves by the car, or by "Let him go" (cancel(t,{free})).

   THE GUARD. While a body is in custody (ped._custody, or any ped.restraint)
   nothing else may take it out of play: occupy.js's cityUnpostNpc, police.js's
   station intake, config.js's bodyMayLeave and the crowd's park all refuse
   it. The only door out is this file (ped._custodyExit), and this file only
   opens it when the car carrying him has left draw range (or, for an arrest
   nobody could see, where nobody can see).

   A SURRENDER ALWAYS RESOLVES (owner 2026-10-20, Gang City: "They put their
   hands up and act like they're going to be detained, but nobody goes to
   detain them"). The man stood there with his hands up for a full minute and
   then walked off, silently, whenever the hands that were sent could not
   reach him: an agent's walk is a straight line (protection.js moveOrder
   skips pednav), so a corner or a wall between them was the end of it; an
   agent seated in the motorcade was "sent" and never moved; a cuff verb that
   never finished held the job forever; an officer streamed out of the world
   was still "the lead". Now every responder walks on the nav grid, a
   responder who makes no ground in STALL_T is unstuck, then replaced by the
   next nearest, a unit with its own crew is dispatched at REACH_T, the
   player's own hands are asked when nobody else is near, and only after all
   of that (GIVEUP_T) does he lower his hands, say so, and walk off
   (CBZ.leave). Nothing ends in silence.

   HELD, NOT SHIPPED (owner 2026-10-20): a man YOU detained (the President's
   Detain, opts.hold) is not driven off on his own. He is cuffed and kept: the
   agent who cuffed him walks him at your shoulder wherever you go (into the
   back of your car when you drive, out again when you get out), or you march
   him yourself; walk far enough away and the agent stands with him for you.
   You decide, with his own verbs:
     Jail      a unit comes and he goes through the pipeline above (or, in the
               back of your car, the precinct desk takes him: Hand over)
     Search    the pat-down: what he carries, said over the searcher's head
     Execute   shot where he stands: the normal death, the President's bill
     Release   the cuffs come off and he walks away (CBZ.leave)
   node tools/custody-check.mjs plays all of it, and every stall, in a vm.

   PUBLIC: CBZ.custody = { take, cancel, jobOf, cuffed, holds, jobs,
     book, records, held, get, release, pardon, trial, visit, facility, audit,
     jail, search, execute, free }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.custody) return;
  const g = CBZ.game || (CBZ.game = {});

  // ---- tuning -------------------------------------------------------------------
  const RUN = 4.8, WALK = 1.4;          // m/s: closing in, the perp walk
  const ORDER_R = 14;                   // the order is shouted from here
  const TACKLE_R = 2.2, CUFF_R = 2.4;
  const CHASE_MAX = 25;                 // s: a runner who outlasts this got away
  const CUFF_T = 2.6, FRISK_T = 2.4;    // s: the beats when no verb has the hands
  const LOAD_MAX = 14;                  // s: getting him through the door
  const RIDERS_MAX = 6;                 // s: the unit waits this long for its crew
  const UNIT_BACK = 42;                 // m: where the unit starts down the lane
  const DRAW_R = 140, GONE_MIN = 70;    // m: out of draw range / out of sight (inside traffic.js's 150 m recycle ring)
  const SEEK_R = 70;                    // m: officers on scene
  // THE SURRENDER ALWAYS RESOLVES
  const STALL_T = 4;                    // s without closing half a metre: that responder is stuck
  const REACH_T = 14;                   // s with nobody's hands on him: a unit is dispatched with its crew
  const GIVEUP_T = 45;                  // s: truly nobody can come; he lowers his hands and walks off
  const PLAYER_WAIT = 20;               // s more while the player's own hands are close
  const CUFF_VERB_MAX = 7;              // s: a cuff verb that never finishes is finished for it
  // HELD WITH YOU
  const HOLD_GAP = 2.6;                 // m: the holder walks him this far off your shoulder
  const HOLD_FAR = 32;                  // m: you went further; the holder stands and keeps him
  const SEAT_R = 14;                    // m: your car this near when you drive: he goes in the back
  const OUT_T = 1.2;                    // s after you get out before he is taken out of your car

  // who is taking him: the agency (its uniform, its car, its words)
  const AGENCY = {
    police: { name: "police", job: "police officer", unit: "cruiser", shout: "Police! Get on the ground!" },
    ss: { name: "secret service", job: "secret service", unit: "suv", shout: "Secret Service! Hands where I can see them!" },
    fbi: { name: "federal agents", job: "federal agent", unit: "suv", shout: "Federal agents! Down on the ground!" },
    cia: { name: "agency officers", job: "federal agent", unit: "suv", shout: "Down! Hands behind your head!" },
    army: { name: "soldiers", job: "soldier", unit: "suv", shout: "Down! Get down on the ground!" },
    gang: { name: "gang", job: "gang member", unit: "van", shout: "On your knees." },
  };
  function agencyKey(by) {
    const s = String(by == null ? "police" : by).toLowerCase();
    if (/^gang/.test(s)) return "gang";
    if (s === "ss" || /secret service/.test(s)) return "ss";
    if (s === "fbi" || /bureau|federal/.test(s)) return "fbi";
    if (s === "cia" || /intelligence/.test(s)) return "cia";
    if (s === "army" || /army|military|soldier/.test(s)) return "army";
    return "police";
  }
  const IN_CUSTODY = { taken: 1, transit: 1, held: 1, convicted: 1 };

  // ---- small helpers ------------------------------------------------------------------
  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function dist(a, b) { return a && b && a.pos && b.pos ? hyp(a.pos.x, a.pos.z, b.pos.x, b.pos.z) : 1e9; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function hash(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function h01(s) { return (hash(s) % 100000) / 100000; }
  function say(p, line, secs) { if (p && line && CBZ.citySay) { try { CBZ.citySay(p, line, null, secs || 2.2); } catch (e) {} } }
  function R() { return CBZ.cityRestrain || null; }
  function VB() { return CBZ.verbs || null; }
  function rstate(p) { return p && p.restraint ? p.restraint.state : null; }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  // nobody can see this spot (no view model loaded: nobody is looking)
  function unseen(x, z, minD) {
    if (!CBZ.npcTransitionSafe) return true;
    try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: minD == null ? 40 : minD, maxDistance: DRAW_R }); } catch (e) { return false; }
  }
  // ...or it is on screen but a wall stands between it and the camera (a man
  // walked through a door is gone from view even a few metres away)
  // (systems/leave.js's rule, the one every walk-out asks)
  function hidden(x, z, minD) {
    if (CBZ.leave && CBZ.leave.unseen) { try { return !!CBZ.leave.unseen({ x: x, z: z }, { minDistance: minD == null ? 40 : minD, far: DRAW_R }); } catch (e) { return false; } }
    if (!CBZ.npcTransitionSafe) return true;
    try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: minD == null ? 40 : minD, maxDistance: DRAW_R, occlusion: true }); } catch (e) { return false; }
  }

  // still a body in this world (not streamed out, not exited, not dead)
  function inWorld(o) {
    if (!o || o.dead || o._gone || o._custodyExit || !o.pos) return false;
    const a = CBZ.cityPeds, b = CBZ.cityCops;
    if ((a || b) && !(a && a.indexOf(o) >= 0) && !(b && b.indexOf(o) >= 0)) return false;
    return true;
  }
  let CLOCK = 0;
  /* THE WALK GOES ROUND THE WALL. A body custody walks is a moveOrder (an
     agent: protection.js) or a hand step (a cop), and both are a straight
     line: peds.js skips pednav for a moveOrder. A corner between the agent
     and the man was a wall he pressed into for a minute while the man stood
     there with his hands up. This asks the nav grid (systems/navgrid.js, the
     one leave.js walks on) for the next waypoint when the line is blocked. */
  function navNext(o, x, z) {
    const G = CBZ.navGrid;
    if (!G || !G.ready || !G.plan || !G.lineBlocked || !G.inWindow) return null;
    if (!safe(G.ready) || Math.abs(o.pos.y || 0) > 1.2) return null;
    if (!G.inWindow(o.pos.x, o.pos.z) || !G.inWindow(x, z)) return null;
    let N = o._cuNav;
    if (!N || hyp(N.gx, N.gz, x, z) > 2.5 || CLOCK - N.at > 3) {
      const blocked = !!safe(function () { return G.lineBlocked(o.pos.x, o.pos.z, x, z, 0.6); });
      const pts = blocked ? safe(function () { return G.plan({ x: o.pos.x, z: o.pos.z }, { x: x, z: z }, { actor: o }); }) : null;
      N = o._cuNav = { gx: x, gz: z, at: CLOCK, pts: pts && pts.length > 1 ? pts : null, i: 0 };
    }
    if (!N.pts) return null;
    while (N.i < N.pts.length - 1 && hyp(o.pos.x, o.pos.z, N.pts[N.i].x, N.pts[N.i].z) < 0.9) N.i++;
    return N.i < N.pts.length - 1 ? N.pts[N.i] : null;      // the last leg is the goal itself
  }

  // ================================================================
  //  THE RECORD. One list of everybody the state (or anybody) holds. It
  //  lives in the city world's save (worldstate.js saves the whole record),
  //  so a detainee is still held after a reload.
  // ================================================================
  function store() {
    let w = g.cityWorld;
    if (!w && CBZ.cityWorldEnsure) { safe(CBZ.cityWorldEnsure); w = g.cityWorld; }
    const host = (w && w.version === 2) ? w : g;
    if (!host.custody || !Array.isArray(host.custody.records)) host.custody = { v: 1, seq: 0, records: [] };
    return host.custody;
  }
  // WHERE HE IS HELD: the County Jail when the city has one (games/jail.js's
  // compound), else the precinct desk (police.js); a gang holds its own.
  function facilityFor(by) {
    const k = agencyKey(by);
    if (k === "gang") return { id: "gang", name: "a gang hideout", x: null, z: null };
    const J = CBZ.cityJailAnchors ? safe(CBZ.cityJailAnchors) : null;
    if (J && J.desk) return { id: "countyjail", name: "County Jail", x: J.desk.x, z: J.desk.z, outX: J.release ? J.release.x : J.gate.x, outZ: J.release ? J.release.z : J.gate.z };
    const st = CBZ.cityPoliceStation ? safe(CBZ.cityPoliceStation) : null;
    if (st) return { id: "precinct", name: "the precinct", x: st.x, z: st.z, outX: st.x, outZ: st.z };
    return { id: "custody", name: "state custody", x: null, z: null };
  }
  // who he is, as the political model reads anybody (identity + affiliations)
  function whoOf(t) {
    let d = null;
    const Pol = CBZ.politics;
    if (Pol && typeof Pol.describe === "function") d = safe(function () { return Pol.describe(t); });
    d = d ? Object.assign({}, d) : {};
    if (t && typeof t === "object" && t.pos) {
      if (!t._sid && CBZ.cityPedStash) safe(function () { CBZ.cityPedStash(t); });
      d.sid = d.sid || t._sid || null;
      d.name = d.name || (t.name ? String(t.name) : null);
      d.job = t.job || null;
      d.gender = t.gender || d.gender || "m";
      if (d.gang == null && t.gangId != null) d.gang = t.gangId;
      d.look = { outfit: t.outfit != null ? t.outfit : null, skin: t.skin != null ? t.skin : null };
      d.charges = [];
      if ((t.npcWanted | 0) > 0) d.charges.push("wanted (" + (t.npcWanted | 0) + ")");
      if (t.rampage) d.charges.push("rampage");
      if (t.gstat && (t.gstat.bodies | 0) > 0) d.charges.push("homicide");
    }
    return d;
  }
  function recFrom(d, o) {
    const s = store();
    return {
      id: "cu" + (++s.seq), sid: d.sid || null, name: d.name || null, gender: d.gender || "m", title: d.title || "", job: d.job || null,
      ideology: d.ideology || null, inst: d.inst || null, party: d.party || null, gang: d.gang != null ? d.gang : null, gangName: d.gangName || null,
      role: d.role || null, member: d.member || null,
      kind: d.kind && d.kind !== "person" ? d.kind : (d.role ? "minister" : d.member ? "member" : d.gang != null ? "gang" : "citizen"),
      verb: o.verb || "arrest", by: o.by != null ? String(o.by) : "police", agency: agencyKey(o.by),
      day: o.day != null ? o.day : day(), status: o.status || "held", facility: o.facility || facilityFor(o.by),
      seized: (o.seized || []).slice(), charges: (d.charges || []).slice(), trial: null, visits: 0, look: d.look || null,
    };
  }
  function findRec(sid, name) {
    const L = store().records;
    for (let i = L.length - 1; i >= 0; i--) {
      const r = L[i];
      if (!IN_CUSTODY[r.status]) continue;
      if ((sid && r.sid === sid) || (!sid && name && r.name === name)) return r;
    }
    return null;
  }
  // book(who, opts): a person (a ped, a politics descriptor, a member of
  // Congress) is in custody. One record per person in custody.
  function book(who, opts) {
    opts = opts || {};
    const d = who && who.pos ? whoOf(who) : Object.assign({}, who || {});
    if (d.kind === "member" || d.member) { d.kind = "member"; d.member = d.member || d.sid; }
    const prev = findRec(d.sid, d.sid ? null : d.name);
    if (prev) { if (opts.status && prev.status !== "held") prev.status = opts.status; return prev; }
    const r = recFrom(d, opts);
    const s = store();
    s.records.push(r);
    // the long tail of the released stays bounded; nobody held is ever dropped
    if (s.records.length > 240) { for (let i = 0; i < s.records.length && s.records.length > 240; i++) if (!IN_CUSTODY[s.records[i].status]) s.records.splice(i--, 1); }
    return r;
  }
  function records(filter) { const L = store().records; return filter ? L.filter(filter) : L.slice(); }
  function held() { settle(); return store().records.filter(function (r) { return !!IN_CUSTODY[r.status]; }); }
  function get(x) {
    if (!x) return null;
    if (typeof x === "object" && x.id && x.status) return x;
    const L = store().records;
    for (let i = L.length - 1; i >= 0; i--) { const r = L[i]; if (r.id === x || r.sid === x) return r; }
    for (let i = L.length - 1; i >= 0; i--) { const r = L[i]; if (r.name === x && IN_CUSTODY[r.status]) return r; }
    return null;
  }
  // a record left "taken"/"transit" by a reload has no scene any more: he got there
  function settle() {
    const L = store().records;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      if ((r.status === "taken" || r.status === "transit") && !JOBS.some(function (j) { return j.rec === r && !j.done; })) r.status = "held";
    }
  }

  // ================================================================
  //  THE SCENE. One job per person being taken.
  // ================================================================
  const JOBS = [];
  const LEAVERS = [];        // bodies and cars walking / driving out of the world
  let JSEQ = 0;
  const STATS = { taken: 0, cuffed: 0, seated: 0, departed: 0, delivered: 0, offscreen: 0, cancelled: 0, blocked: 0, walked: 0, intake: 0, refusedSeat: 0,
    unstuck: 0, swapped: 0, dispatched: 0, nobody: 0, cuffForced: 0, held: 0, jailed: 0, executed: 0, freed: 0, searched: 0 };
  function jobOf(t) { for (let i = 0; i < JOBS.length; i++) if (JOBS[i].t === t && !JOBS[i].done) return JOBS[i]; return null; }

  function isOfficerOf(q, key, j) {
    const job = String(q.job || "").toLowerCase();
    if (key === "police") return q.kind === "cop" || /police|officer|sheriff|trooper/.test(job);
    if (key === "ss") return /secret service/.test(job) || !!q._protUnit;
    if (key === "fbi" || key === "cia") return /federal|bureau|agent|intelligence/.test(job);
    if (key === "army") return q.organization === "military" || /soldier|trooper|marine/.test(job);
    if (key === "gang") { const gid = j && j.gang; return gid != null && (q.gangId === gid || (q.gang && (q.gang.id === gid || q.gang === gid))); }
    return false;
  }
  // a body that can walk to him right now (not in a seat, not in somebody's car door)
  function canWalk(q) {
    return !!(q && !q.inCar && !q._cbzSeat && !q._cbzArc && !q._airPilot && !q._swatPassenger && q._protRole !== "counter-sniper" &&
      !(CBZ.boardingHolds && safe(function () { return CBZ.boardingHolds(q); })));
  }
  function usableOfficer(q, t) {
    return !!(q && q !== t && !q.dead && q.pos && !q.player && !q.isPlayer && !q.restraint && !q._custodyJob && canWalk(q) &&
      !(q.ko > 0) && inWorld(q));
  }
  function findOfficers(key, t, n, j) {
    const out = [];
    const lists = [CBZ.cityCops, CBZ.cityPeds];
    for (let k = 0; k < lists.length; k++) {
      const L = lists[k]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        if (!usableOfficer(q, t) || out.indexOf(q) >= 0 || !isOfficerOf(q, key, j)) continue;
        if (j && (q._cuStuck === j.id || j.officers.indexOf(q) >= 0)) continue;   // already tried for this man
        const d = dist(q, t);
        if (d > SEEK_R) continue;
        out.push(q);
      }
    }
    out.sort(function (a, b) { return dist(a, t) - dist(b, t); });
    return out.slice(0, n || 2);
  }
  // nobody on scene: two of them come in on foot from where nobody sees them appear
  function spawnOfficers(key, t, n) {
    if (!CBZ.cityPostNpc) return [];
    const A = AGENCY[key] || AGENCY.police;
    let at = null, fallback = null;
    for (let i = 0; i < 16 && !at; i++) {
      const a = (i / 16) * Math.PI * 2 + h01("cu:sp:" + JSEQ) * 6.28, r = 32 + (i % 3) * 6;
      const x = t.pos.x + Math.sin(a) * r, z = t.pos.z + Math.cos(a) * r;
      if (CBZ.roadPointOpen && !safe(function () { return CBZ.roadPointOpen(x, z); }) && CBZ.walkableAt && !safe(function () { return CBZ.walkableAt(x, z); })) continue;
      if (!fallback) fallback = { x: x, z: z };
      if (unseen(x, z, 25)) at = { x: x, z: z };
    }
    at = at || fallback;
    if (!at) return [];
    const out = [];
    for (let i = 0; i < (n || 2); i++) {
      const p = safe(function () { return CBZ.cityPostNpc(at.x + i * 0.9, at.z + i * 0.6, { job: A.job, src: "custody" }); });
      if (p) out.push(p);
    }
    return out;
  }

  // ---- bodies: walking somebody nobody else walks, and handing a walk to peds.js --
  function faceTo(o, x, z) { if (o.group && o.group.rotation) o.group.rotation.y = Math.atan2(x - o.pos.x, z - o.pos.z); }
  function goTo(o, x, z, spd, dt, stop) {
    const dx = x - o.pos.x, dz = z - o.pos.z, d = Math.hypot(dx, dz);
    stop = stop == null ? 0.4 : stop;
    // a verb has his body right now; except the officer's own ESCORT hold,
    // where the verb carries the man and the officer's legs are his own (this
    // guard used to freeze every officer escort: 30 s standing still with his
    // hand on the man's arm until the walk timed out)
    const VS = o._verbS;
    if (VS && !VS.done && !(VS.verb === "escort" && VS.a === o && VS.phase === "hold")) return d;
    // round the wall, not into it: the next waypoint when the line is blocked
    const w = d > stop ? navNext(o, x, z) : null;
    const wx = w ? w.x : x, wz = w ? w.z : z;
    const PR = CBZ.protection;
    if (PR && PR.moveToward && CBZ.cityPeds && CBZ.cityPeds.indexOf(o) >= 0) {
      if (d <= stop) { if (PR.release) safe(function () { PR.release(o); }); o.state = "idle"; o.speed = 0; faceTo(o, x, z); return d; }
      PR.moveToward(o, wx, wz, spd, dt);
      return d;
    }
    // a body no brain walks while it works for us (a cop: police.js yields him)
    let sp = 0;
    if (d > stop) {
      const ex = wx - o.pos.x, ez = wz - o.pos.z, ed = Math.hypot(ex, ez) || 1;
      const s = Math.min(w ? ed : d - stop, spd * dt);
      o.pos.x += ex / ed * s; o.pos.z += ez / ed * s;
      if (CBZ.collide) safe(function () { CBZ.collide(o.pos, 0.45, 0, 1.7); });
      sp = dt > 0 ? s / dt : 0;
      faceTo(o, wx, wz);
    }
    o.speed = sp;
    if (o.target && o.target.set) o.target.set(o.pos.x, 0, o.pos.z);
    if (o.group && o.group.position && o.group.position !== o.pos && o.group.position.set) o.group.position.set(o.pos.x, o.pos.y || 0, o.pos.z);
    if (CBZ.animChar && o.char) safe(function () { CBZ.animChar(o.char, sp, dt); });
    return d;
  }
  function stand(o, faceAt, dt) {
    if (!o || o.dead) return;
    if (o._verbS && !o._verbS.done) return;
    const PR = CBZ.protection;
    if (PR && PR.release && CBZ.cityPeds && CBZ.cityPeds.indexOf(o) >= 0) safe(function () { PR.release(o); });
    o.speed = 0; o.state = o.state === "fight" ? "idle" : o.state;
    if (o.target && o.target.set) o.target.set(o.pos.x, 0, o.pos.z);
    if (faceAt && faceAt.pos) faceTo(o, faceAt.pos.x, faceAt.pos.z);
    if (CBZ.animChar && o.char && !(CBZ.cityPeds && CBZ.cityPeds.indexOf(o) >= 0)) safe(function () { CBZ.animChar(o.char, 0, dt || 0.016); });
  }
  // his hands go up and he stays where he is told
  function holdStill(t) {
    t.controlled = true; t.rage = null; t.speed = 0;
    if (t.state === "flee" || t.state === "fight") t.state = "walk";
    t.path = null; t.finalGoal = null; t.pause = Math.max(t.pause || 0, 0.5);
    if (t.target && t.target.set) t.target.set(t.pos.x, 0, t.pos.z);
    if (!rstate(t)) { t.surrender = true; t.surrenderT = Math.max(t.surrenderT || 0, 4); t.poseHandsUp = true; if (t.char) t.char.handsUp = true; }
  }
  function lowerHands(t) {
    t.surrender = false; t.surrenderT = 0; t.poseHandsUp = false;
    if (t.char) { t.char.handsUp = false; t.char.surrender = false; }
  }
  function cuffable(t) {
    const A = CBZ.arrest;
    if (A && typeof A.cuffable === "function") { const r = safe(function () { return A.cuffable(t); }); if (r) return true; }
    return !!(t.surrender || t.poseHandsUp || (t.char && t.char.handsUp) || (t.ko || 0) > 0);
  }
  // the hands on him: a live officer of THIS job still in the world
  function lead(j) {
    for (let i = 0; i < j.officers.length; i++) {
      const o = j.officers[i];
      if (o && !o.dead && !o.restraint && !(o.ko > 0) && o._custodyJob === j.id && inWorld(o)) return o;
    }
    return null;
  }
  // an officer streamed out of the world, killed, or taken by another job is
  // not on this one any more (he used to stay "the lead" and nobody came)
  function prune(j) {
    for (let i = j.officers.length - 1; i >= 0; i--) {
      const o = j.officers[i];
      if (o && !o.dead && o._custodyJob === j.id && inWorld(o)) continue;
      if (o && o._custodyJob === j.id) releaseOfficer(j, o);
      j.officers.splice(i, 1);
    }
  }
  // more hands: the nearest free officers of the agency (within `r` when given)
  function recruit(j, n, r) {
    const add = findOfficers(j.key, j.t, n, j).filter(function (q) { return r == null || dist(q, j.t) < r; });
    for (let i = 0; i < add.length; i++) { claim(j, add[i]); j.officers.push(add[i]); }
    return add.length;
  }
  function claim(j, o) {
    o._custodyJob = j.id;
    if (!o._order) { o._order = { kind: "custody", target: j.t, t: 0, custody: true }; o._custodyOwnsOrder = true; }
    o.rage = null; o.npcTarget = null; o.curTarget = null;
  }
  function releaseOfficer(j, o) {
    if (!o || o._custodyJob !== j.id) return;
    o._custodyJob = null;
    if (o._custodyOwnsOrder) { o._order = null; o._custodyOwnsOrder = false; }
    const PR = CBZ.protection;
    if (PR && PR.release) safe(function () { PR.release(o); });
    if (j.opts.onRelease) safe(function () { j.opts.onRelease(o); });
  }

  // ---- take(target, opts) -------------------------------------------------------------
  //  opts.by        who takes him: "police" | "ss" | "fbi" | "cia" | "army" | "gang:<id>" | an institution name
  //  opts.verb      "arrest" | "detain"
  //  opts.officers  the hands on scene (else the nearest of that agency, else two come on foot)
  //  opts.act       fire politics.act(verb) when the cuffs go on (actBy, actOpts)
  //  opts.subdued   he already gave up (a cop's own takedown): no resistance roll
  //  opts.resist    force "run" | "fight" | null
  //  opts.handsOff  nobody's hands but whoever already holds him (the player's collar)
  //  opts.onCuffed / onRelease(officer) / onEnd(job, why)
  function take(t, opts) {
    opts = opts || {};
    if (!t || t.dead || t.player || t.isPlayer || !t.pos || t._custodyExit) return null;
    const had = jobOf(t);
    if (had) return had;
    if (rstate(t) === "grappled" || rstate(t) === "boarding" || rstate(t) === "in_vehicle") return null;   // in somebody's hands already
    const key = agencyKey(opts.by);
    const j = mkJob(t, key, opts);
    if (!opts.handsOff) {
      // the hands sent: never one sitting in the motorcade or on a roof post
      // (they were "sent", never moved, and the man waited with his hands up)
      let off = (opts.officers || []).filter(function (q) {
        return usableOfficer(q, t) || (q && q._order && q._order.force && !q.dead && !q.restraint && canWalk(q) && inWorld(q));
      });
      if (!off.length) off = findOfficers(key, t, 2, j);
      if (!off.length) {
        // AN ARREST NOBODY SEES happens where nobody sees it
        if (unseen(t.pos.x, t.pos.z, 60)) { JOBS.push(j); offscreen(j); return j; }
        off = spawnOfficers(key, t, 2);
        j.spawned = off.slice();
        if (!off.length) {
          // nobody at all on foot: a unit with its crew, or the giver's own hands
          if (!dispatch(j) && !playerHands(j)) return null;
        }
      }
      j.officers = off;
      for (let i = 0; i < off.length; i++) claim(j, off[i]);
    }
    t._custody = { job: j.id, state: "taken" };
    JOBS.push(j);
    STATS.taken++;
    if (rstate(t) === "cuffed" || rstate(t) === "escorted") cuffedEvent(j);   // the player's collar: already in cuffs
    return j;
  }

  function mkJob(t, key, opts) {
    return {
      id: ++JSEQ, t: t, by: opts.by != null ? opts.by : key, key: key, verb: opts.verb === "detain" ? "detain" : "arrest", opts: opts,
      gang: key === "gang" ? String(opts.by).split(":")[1] : null,
      officers: [], spawned: [], phase: "close", pt: 0, age: 0, ordered: false, resist: null, cuffed: false, done: false,
      reach: null, dispatched: false, crewOut: false, playerHands: false, held: false, searched: false, riding: null, outT: 0,
      car: null, unit: null, rec: null, seized: [], cuffS: null, friskS: null, fallT: 0, retry: 0, said: {}, boardTries: 0, parkT: 0,
    };
  }

  // ---- THE CUFFS ARE ON: the moment it becomes custody -----------------------------
  function cuffedEvent(j) {
    if (j.cuffed) return;
    const t = j.t;
    j.cuffed = true; j.cuffedAt = j.age;
    const gun = t.armed && t.weapon ? t.weapon : null;
    const Rs = R();
    // the player's own hands did it (restrain.js's Cuff): that file already
    // priced it, so the act below is not fired a second time
    const ownHands = !!(t.restraint && t.restraint.by === "player");
    if (!t.restraint) {
      let ok = false;
      if (Rs && Rs.cuff) ok = !!safe(function () { return Rs.cuff(t, { by: (AGENCY[j.key] || AGENCY.police).name, seize: true, custody: true }); });
      if (!ok) { t.restraint = { state: "cuffed", by: j.key, t: 0, vehicle: null }; t.controlled = true; t.armed = false; t.weapon = null; }
    }
    if (gun) j.seized.push(gun);
    lowerHands(t);
    t._custody = { job: j.id, state: "cuffed" };
    STATS.cuffed++;
    j.rec = book(t, { verb: j.verb, by: j.by, status: "taken", seized: j.seized });
    if (gun && j.rec.seized.indexOf(gun) < 0) j.rec.seized.push(gun);
    // THE ACT: the political model hears it now, with the witnesses who saw it
    if (j.opts.act && !ownHands && CBZ.politics && CBZ.politics.act) {
      const ao = Object.assign({}, j.opts.actOpts || {}, { target: t, by: j.opts.actBy || (j.opts.actOpts && j.opts.actOpts.by) || j.by, keepBody: true });
      safe(function () { CBZ.politics.act(j.verb, ao); });
    }
    if (j.cuffS && !j.cuffS.done && j.cuffS.cancel) safe(function () { j.cuffS.cancel(); });
    j.cuffS = null;
    if (j.opts.onCuffed) safe(function () { j.opts.onCuffed(j); });
    // HELD, NOT SHIPPED: the man you detained stays with you until you decide
    if (j.opts.hold) { enterHold(j); return; }
    requestUnit(j);
    j.phase = j.opts.handsOff ? "wait" : "frisk"; j.pt = 0;
  }

  // ---- the arrest nobody saw (politics.order on a man across town) -----------------
  function offscreen(j) {
    const t = j.t;
    j.cuffed = true; j.offscreen = true;
    if (t.armed && t.weapon) j.seized.push(t.weapon);
    j.rec = book(t, { verb: j.verb, by: j.by, status: "held", seized: j.seized });
    t._custody = { job: j.id, state: "held" };
    if (j.opts.act && CBZ.politics && CBZ.politics.act) {
      const ao = Object.assign({}, j.opts.actOpts || {}, { target: t, by: j.opts.actBy || j.by, keepBody: true });
      safe(function () { CBZ.politics.act(j.verb, ao); });
    }
    STATS.offscreen++;
    exitBody(t);
    finish(j, "offscreen");
  }

  // ================================================================
  //  THE UNIT. A car that comes for him: the agency's own cruiser or SUV,
  //  rolled up the lane from out of sight, parked at the kerb beside him.
  // ================================================================
  function unitModel(key) {
    if (key === "police") return CBZ.cityCruiserModel ? safe(CBZ.cityCruiserModel) : null;
    if (key === "gang") return null;
    let m = null;
    if (CBZ.cityEcon && CBZ.cityEcon.carByName) m = safe(function () { return CBZ.cityEcon.carByName("Bison Frontier"); });
    return m ? Object.assign({}, m, { color: 0x101216 }) : null;
  }
  // the lane beside him, and where down it the unit starts
  function kerbPlan(t) {
    if (!CBZ.roadPick) return null;
    const spot = safe(function () { return CBZ.roadPick({ near: { x: t.pos.x, z: t.pos.z }, maxDist: 26, cls: "emergency", tries: 30, spacing: 4 }); });
    if (!spot || !spot.road) return null;
    const r = spot.road, half = Math.max(4, (r.len || 60) / 2 - 3);
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    const stop = spot.vertical ? { x: spot.x, z: clamp(t.pos.z, r.z - half, r.z + half) } : { x: clamp(t.pos.x, r.x - half, r.x + half), z: spot.z };
    const along = spot.vertical ? stop.z - r.z : stop.x - r.x, dirAlong = spot.vertical ? fz : fx;
    const back = Math.max(8, Math.min(UNIT_BACK, half + along * dirAlong));
    return { road: r, seg: spot, stop: stop, spawn: { x: stop.x - fx * back, z: stop.z - fz * back }, heading: spot.heading };
  }
  // no road graph: straight in from beyond him, as seen from where you stand
  function openPlan(t) {
    const P = CBZ.player;
    let ax = 1, az = 0;
    if (P && P.pos) { ax = t.pos.x - P.pos.x; az = t.pos.z - P.pos.z; }
    const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
    const stop = { x: t.pos.x + ax * 3.5, z: t.pos.z + az * 3.5 };
    const spawn = { x: stop.x + ax * UNIT_BACK, z: stop.z + az * UNIT_BACK };
    return { road: null, seg: null, stop: stop, spawn: spawn, heading: Math.atan2(stop.x - spawn.x, stop.z - spawn.z) };
  }
  function requestUnit(j) {
    if (j.car) return;
    const t = j.t;
    if (!CBZ.cityMakeCar) return;
    const plan = kerbPlan(t) || openPlan(t);
    const car = safe(function () { return CBZ.cityMakeCar(plan.spawn.x, plan.spawn.z, plan.heading, plan.seg ? !!plan.seg.vertical : false, unitModel(j.key), 0); });
    if (!car) return;
    if (j.key === "police" && CBZ.cityMarkCruiser) { safe(function () { CBZ.cityMarkCruiser(car); }); car._cruiser = true; }
    car.ai = false; car.v = 0; car.heading = plan.heading; car._custodyUnit = j.id; car._persist = true;
    // its own driver, in the agency's clothes, at the wheel
    let driver = null;
    if (CBZ.carOccupancySeat && CBZ.cityPostNpc) {
      safe(function () { if (CBZ.carOccupancyClear) CBZ.carOccupancyClear(car); });
      driver = safe(function () { return CBZ.cityPostNpc(plan.spawn.x, plan.spawn.z, { job: (AGENCY[j.key] || AGENCY.police).job, src: "custody:driver" }); });
      if (driver && !safe(function () { return CBZ.carOccupancySeat(car, "driver", driver); })) { safe(function () { CBZ.cityUnpostNpc(driver); }); driver = null; }
    }
    j.car = car;
    j.unit = { ours: true, state: "coming", t: 0, plan: plan, driver: driver, riders: [], best: 1e9, stall: 0 };
  }
  function driveCar(car, heading, spd, dt) {
    car.heading = heading; car.v = spd;
    if (car.group && car.group.rotation) car.group.rotation.y = heading;
    car.pos.x += Math.sin(heading) * spd * dt;
    car.pos.z += Math.cos(heading) * spd * dt;
    if (car.group && car.group.position && car.group.position !== car.pos && car.group.position.set) car.group.position.set(car.pos.x, car.group.position.y || 0, car.pos.z);
  }
  /* NO ROAD UNDER IT: it drives off AWAY from the player, turning at a car's
     rate. "Straight on down the line it came in on" was the line it came in
     on toward him: it ran the player over and shoved him 120 m down the
     road in the lab (kit detain). */
  function awayHeading(car, dt) {
    const P = CBZ.player, h = car.heading || 0;
    if (!P || !P.pos) return h;
    const want = Math.atan2(car.pos.x - P.pos.x, car.pos.z - P.pos.z);
    let d = want - h;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const k = 0.9 * dt;
    return h + (d > k ? k : d < -k ? -k : d);
  }
  function unitStep(j, dt) {
    const u = j.unit, car = j.car;
    if (!u || !car) return;
    u.t += dt;
    if (u.state !== "coming") return;
    if (car.dead) { j.car = null; j.unit = null; requestUnit(j); return; }
    const st = u.plan.stop;
    const d = hyp(car.pos.x, car.pos.z, st.x, st.z);
    if (d < u.best - 0.05) { u.best = d; u.stall = 0; } else u.stall += dt;
    if (d < 0.6 || u.stall > 3 || u.t > 25) { u.state = "parked"; car.v = 0; car.vx = 0; car.vz = 0; crewOut(j); return; }
    const hd = u.plan.seg ? u.plan.heading : Math.atan2(st.x - car.pos.x, st.z - car.pos.z);
    driveCar(car, hd, clamp((d - 0.3) * 1.1, 1.5, 11), dt);
  }
  // the back door he goes in by: the side of the car nearer the man walking him
  function doorSpot(car, near) {
    const h = car.heading || 0, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const side = near && near.pos ? (((near.pos.x - car.pos.x) * rx + (near.pos.z - car.pos.z) * rz) >= 0 ? 1 : -1) : 1;
    return { x: car.pos.x + rx * side * 1.7 - fx * 0.7, z: car.pos.z + rz * side * 1.7 - fz * 0.7 };
  }

  // ================================================================
  //  A SURRENDER ALWAYS RESOLVES. Somebody is coming, visibly, or he is told
  //  nobody is and walks off. Never a man with his hands up and nobody.
  // ================================================================
  // the responder this frame, with his progress watched
  function responder(j, dt) {
    prune(j);
    let L = lead(j);
    if (!L && !j.playerHands) { if (recruit(j, 2)) L = lead(j); else if (!j.dispatched) dispatch(j); }
    if (!L && !j.playerHands && !(j.unit && j.unit.state === "coming")) playerHands(j);
    if (!L) return null;
    const d = dist(L, j.t);
    let Rr = j.reach;
    if (!Rr || Rr.who !== L) Rr = j.reach = { who: L, best: d, stall: 0, tries: 0 };
    if (d < Rr.best - 0.5) { Rr.best = d; Rr.stall = 0; }
    else if (d > CUFF_R + 1.3 && !(j.cuffS && !j.cuffS.done)) Rr.stall += dt;
    if (Rr.stall > STALL_T) { Rr.stall = 0; Rr.best = d; unstick(j, L, Rr); L = lead(j); }
    return L;
  }
  // he made no ground: first shake loose whatever has him (a verb that never
  // ended, a stale walk), then hand the job to the next nearest, then a unit
  function unstick(j, L, Rr) {
    if (!Rr.tries) {
      Rr.tries = 1; STATS.unstuck++;
      const VS = L._verbS, V = VB();
      if (VS && !VS.done && VS !== j.cuffS && VS !== j.friskS && V && V.release) safe(function () { V.release(L, "set"); });
      L._cuNav = null;
      if (CBZ.protection && CBZ.protection.release) safe(function () { CBZ.protection.release(L); });
      return;
    }
    STATS.swapped++;
    L._cuStuck = j.id;
    releaseOfficer(j, L);
    const i = j.officers.indexOf(L); if (i >= 0) j.officers.splice(i, 1);
    if (lead(j)) return;                              // his partner is still coming
    if (recruit(j, 2)) return;
    if (!j.dispatched) dispatch(j);
    playerHands(j);
  }
  // A UNIT WITH ITS CREW: the agency's car comes to the kerb beside him and two
  // get out (crewOut). No car in this world: two come on foot.
  function dispatch(j) {
    if (j.dispatched) return false;
    j.dispatched = true; STATS.dispatched++;
    const L = lead(j);
    if (L) say(L, "Need a unit here.", 1.6);
    if (!j.car) requestUnit(j);
    if (j.car) return true;
    const off = spawnOfficers(j.key, j.t, 2);
    for (let i = 0; i < off.length; i++) { claim(j, off[i]); j.officers.push(off[i]); j.spawned.push(off[i]); }
    j.crewOut = off.length > 0;
    return off.length > 0;
  }
  function crewOut(j) {
    if (!j.dispatched || j.crewOut || j.cuffed || !j.car || !CBZ.cityPostNpc) return;
    j.crewOut = true;
    const A = AGENCY[j.key] || AGENCY.police;
    for (let i = 0; i < 2; i++) {
      const door = doorSpot(j.car, i ? null : j.t);
      const p = safe(function () { return CBZ.cityPostNpc(door.x + i * 0.8, door.z + i * 0.5, { job: A.job, src: "custody:crew" }); });
      if (p) { claim(j, p); j.officers.unshift(p); j.spawned.push(p); }
    }
  }
  // NOBODY ELSE IS NEAR: the man who gave the order may put the cuffs on
  // himself (restrain.js's Cuff shows on a man with his hands up)
  function playerHands(j) {
    if (j.playerHands || j.opts.handsOff) return j.playerHands;
    const P = CBZ.player, own = j.opts.owner === "president" || j.opts.owner === "player";
    if (!own || !P || !P.pos || P.dead || dist(P, j.t) > 25) return false;
    j.playerHands = true; j.playerAt = j.age;
    return true;
  }
  // somebody's hands are on him, or about to be
  function closing(j) {
    const L = lead(j);
    if (j.cuffS && !j.cuffS.done) return true;
    if (L && dist(L, j.t) < CUFF_R + 1.5) return true;
    if (L && dist(L, j.t) < 25 && j.reach && j.reach.who === L && j.reach.stall < 1.5) return true;
    if (j.unit && j.unit.state === "coming" && j.age < GIVEUP_T + 20) return true;
    const P = CBZ.player;
    if (j.playerHands && P && P.pos && dist(P, j.t) < 6 && j.age < GIVEUP_T + PLAYER_WAIT) return true;
    return false;
  }
  // TRULY NOBODY: his hands come down, he says so, he walks off
  function giveUp(j) {
    const t = j.t;
    STATS.nobody++;
    if (j.ordered || t.surrender) say(t, "Guess nobody's coming.", 2);
    finish(j, "nobody");
    walkFree(t, "custody:nobody");
  }
  // a free man walks away (systems/leave.js); a man at his own post goes back to it
  function walkFree(t, tag) {
    if (!t || t.dead || t._custodyExit) return;
    lowerHands(t);
    if (t._post || t._occupySrc || t.staffPost || t._iOnly || t._presStaff || t._presOfficer) return;
    t.controlled = false; t.state = "walk";
    if (CBZ.leave && CBZ.leave.go) safe(function () { CBZ.leave.go(t, { tag: tag || "custody:free" }); });
  }

  // ================================================================
  //  HELD WITH YOU (opts.hold): cuffed, walked at your shoulder by the agent
  //  who cuffed him (or by you), until you choose Jail / Execute / Release
  // ================================================================
  function playerCar() {
    const P = CBZ.player;
    return P && P.driving && P._vehicle && !P._vehicle.dead ? P._vehicle : null;
  }
  function enterHold(j) {
    j.phase = "hold"; j.pt = 0; j.held = true; STATS.held++;
    const L = lead(j);
    // one pair of hands keeps him; the other goes back to what he was doing
    for (let i = j.officers.length - 1; i >= 0; i--) {
      const o = j.officers[i];
      if (o === L) continue;
      if (j.spawned.indexOf(o) >= 0) leave(o, j); else releaseOfficer(j, o);
      j.officers.splice(i, 1);
    }
    // a unit that brought the hands has nobody to take yet: it goes back
    if (j.car && j.unit && !j.departed) { CARS_LEAVING.push({ car: j.car, unit: j.unit, t: 0 }); pullOut(j.car, j.unit); j.car = null; j.unit = null; }
  }
  function stepHold(j, dt) {
    const t = j.t, P = CBZ.player, Rs = R(), s = rstate(t);
    // IN THE BACK OF YOUR CAR: he rides with you; the hands go back to work
    if (s === "in_vehicle") {
      const car = t.restraint.vehicle;
      if (j.riding !== car) {
        j.riding = car; j.outT = 0;
        for (let i = j.officers.length - 1; i >= 0; i--) { const o = j.officers[i]; if (j.spawned.indexOf(o) >= 0) leave(o, j); else releaseOfficer(j, o); }
        j.officers.length = 0;
      }
      // you got out beside him: he is taken out with you
      if (P && !P.driving && car && car.pos && hyp(P.pos.x, P.pos.z, car.pos.x, car.pos.z) < 8) {
        j.outT += dt;
        if (j.outT > OUT_T && Rs && Rs.unseat) { safe(function () { Rs.unseat(t); }); j.outT = 0; }
      } else j.outT = 0;
      return;
    }
    j.riding = null;
    if (s === "boarding") {
      if (j.pt > LOAD_MAX && Rs && Rs.unseat) { safe(function () { Rs.unseat(t); }); j.pt = 0; }
      return;
    }
    j.pt = 0;
    // YOU DRIVE: into the back seat of your car
    const car = playerCar();
    if (car && dist(t, car) < SEAT_R && Math.abs(car.v || 0) < 3 && Rs && Rs.seat) {
      const H = lead(j);
      if (safe(function () { return Rs.seat(t, car); })) { if (H && !j.said.back) { j.said.back = true; say(H, "In the back.", 1.4); } return; }
    }
    // the player is marching him himself: his hands, not an agent's
    if (s === "escorted" && !t.restraint.officer) return;
    prune(j);
    let L = lead(j);
    // an agent near him takes him over (yours, when you were the one holding him)
    if (!L && !j.opts.handsOff && recruit(j, 1, 25)) L = lead(j);
    if (!L) {
      // your own hands: he walks with you when you are at his side
      if (P && P.pos && !P.dead && !P.driving && dist(t, P) < 2.6 && s === "cuffed" && Rs && Rs.escort) safe(function () { Rs.escort(t); });
      return;
    }
    if (rstate(t) === "cuffed" && Rs && Rs.escort) safe(function () { Rs.escort(t, L); });
    if (rstate(t) === "cuffed" && !(Rs && Rs.escort && VB())) { t.restraint.state = "escorted"; t.restraint.officer = L; }
    // you walked off (or drove off): the agent stands with him and keeps him
    if (!P || !P.pos || P.dead || P.driving || dist(P, t) > HOLD_FAR) { stand(L, t, dt); placeEscorted(j, L); return; }
    // at your shoulder, on his side of you
    let ax = L.pos.x - P.pos.x, az = L.pos.z - P.pos.z;
    const n = Math.hypot(ax, az);
    if (n < 0.01) { ax = 1; az = 0; } else { ax /= n; az /= n; }
    const gx = P.pos.x + ax * HOLD_GAP, gz = P.pos.z + az * HOLD_GAP;
    const dd = hyp(L.pos.x, L.pos.z, gx, gz);
    goTo(L, gx, gz, dd > 6 ? 3.4 : dd > 2 ? 2.2 : WALK, dt, 0.7);
    placeEscorted(j, L);
  }
  // ---- the four choices --------------------------------------------------------------
  function heldJob(x) { const j = x && x.t && x.phase ? x : jobOf(x); return j && j.cuffed && j.held && !j.done ? j : null; }
  // JAIL: a unit comes for him and he goes through the pipeline; in the back
  // of your car he is yours to drive in (the desk's Hand over takes him)
  function jail(x) {
    const j = heldJob(x);
    if (!j) return false;
    j.held = false; STATS.jailed++;
    const L = lead(j), t = j.t;
    if (rstate(t) === "in_vehicle") {
      j.phase = "desk"; j.pt = 0;
      const f = facilityFor("police");
      if (f.x != null && CBZ.fullMap && CBZ.fullMap.setWaypoint) safe(function () { CBZ.fullMap.setWaypoint(f.x, f.z, f.name); });
      return true;
    }
    if (L) say(L, "Taking him in.", 1.6);
    requestUnit(j);
    j.phase = L ? "escort" : "wait"; j.pt = 0; j.parkT = 0;
    return true;
  }
  // SEARCH: the pat-down; what he carries is said over the searcher's head
  function search(x) {
    const j = heldJob(x);
    if (!j || j.searched) return false;
    j.searched = true; STATS.searched++;
    const t = j.t, L = lead(j), V = VB();
    const hands = L || (V && V.playerActor ? safe(V.playerActor) : null);
    if (V && V.frisk && hands) safe(function () { return V.frisk(hands, t, { far: true }); });
    const found = j.seized.slice();
    if (t.armed && t.weapon) found.push(t.weapon);
    const keys = CBZ.cityKeys && CBZ.cityKeys.pedKeys ? safe(function () { return CBZ.cityKeys.pedKeys(t); }) : null;
    if (keys && keys.length) {
      found.push(keys.length > 1 ? keys.length + " keys" : "a key");
      if (CBZ.cityKeys.lift) safe(function () { CBZ.cityKeys.lift(t, "gunpoint"); });   // the keys are yours now
    }
    if ((t.cash | 0) > 0) found.push("$" + (t.cash | 0));
    if (j.rec) for (let i = 0; i < found.length; i++) if (j.rec.seized.indexOf(found[i]) < 0 && !/^\$/.test(found[i])) j.rec.seized.push(found[i]);
    const line = found.length ? found.join(", ") + "." : "He's clean.";
    const by = L || (CBZ.city && CBZ.city.playerActor) || null;
    if (by) say(by, line, 2.4);
    j.found = found;
    return true;
  }
  // EXECUTE: shot where he stands. The normal death (city/peds.js
  // cityKillPed: the corpse, the alarm, the witnesses); the agent's shot is
  // the President's to answer for (city/orders.js bills a man killed under his
  // order), yours is murder like any other
  function execute(x) {
    const j = heldJob(x);
    if (!j) return false;
    const t = j.t, L = lead(j), P = CBZ.player;
    j.executed = true; STATS.executed++;
    let imp;
    if (L) {
      if (CBZ.cityBrain && CBZ.cityBrain.unholster) safe(function () { CBZ.cityBrain.unholster(L); });
      faceTo(L, t.pos.x, t.pos.z);
      if (CBZ.muzzleFlash) safe(function () { CBZ.muzzleFlash({ x: L.pos.x, y: (L.pos.y || 0) + 1.4, z: L.pos.z }, {}); });
      imp = { fromX: L.pos.x, fromZ: L.pos.z, force: 6, fling: 3, attacker: L, byPlayer: false };
    } else {
      const m = CBZ.playerMuzzleWorld ? safe(CBZ.playerMuzzleWorld) : null;
      if (CBZ.muzzleFlash && P && P.pos) safe(function () { CBZ.muzzleFlash(m || { x: P.pos.x, y: 1.4, z: P.pos.z }, {}); });
      imp = { fromX: P ? P.pos.x : t.pos.x, fromZ: P ? P.pos.z : t.pos.z, force: 6, fling: 3 };
    }
    if (CBZ.sfx) safe(function () { CBZ.sfx("report"); });
    if (CBZ.cityKillPed) safe(function () { CBZ.cityKillPed(t, imp, "executed"); });
    if (!t.dead) { t.dead = true; t.hp = 0; }
    // an agent's shot on the President's word is the President's bill
    if (L && j.opts.owner === "president" && CBZ.cityOrders2 && CBZ.cityOrders2.billKill) safe(function () { CBZ.cityOrders2.billKill(t); });
    else if (L && j.opts.owner === "player" && CBZ.cityCrime) safe(function () { CBZ.cityCrime(250, { x: t.pos.x, z: t.pos.z, type: "murder" }); });
    finish(j, "dead");
    return true;
  }
  // RELEASE: the cuffs come off and he walks away
  function free(x) {
    const j = x && x.t && x.phase ? x : jobOf(x);
    if (!j || !j.cuffed || j.departed || j.done) return false;
    const t = j.t, L = lead(j);
    STATS.freed++;
    cancel(j, { free: true });
    if (L) say(L, "You're free to go.", 1.8);
    walkFree(t, "custody:released");
    return true;
  }

  // ================================================================
  //  THE BEATS
  // ================================================================
  function decideResist(j) {
    const t = j.t, o = j.opts;
    if (o.resist !== undefined) return o.resist || null;
    if (o.subdued || (t.ko || 0) > 0 || cuffable(t) && !t.rage) return null;
    let p = 0.08;
    if (t.armed) p += 0.3;
    if (t.gangId != null || t.gang) p += 0.2;
    if ((t.npcWanted | 0) > 0) p += 0.2;
    if (t.rage || t.state === "fight") p += 0.4;
    const roll = h01("cu:resist:" + (t._sid || t.name || "") + ":" + j.id);
    if (roll >= p) return null;
    return t.armed && roll < p * 0.5 ? "fight" : "run";
  }
  function react(j, L) {
    const t = j.t;
    j.resist = decideResist(j);
    if (!j.resist) { holdStill(t); say(t, "Okay! Okay!", 1.6); return; }
    t.controlled = false; lowerHands(t);
    if (j.resist === "run") {
      const ax = t.pos.x - L.pos.x, az = t.pos.z - L.pos.z, n = Math.hypot(ax, az) || 1;
      t.state = "flee"; t.fear = 10; t.alarmed = 8; t.rage = null;
      if (t.target && t.target.set) t.target.set(t.pos.x + ax / n * 40, 0, t.pos.z + az / n * 40);
      say(t, "No way!", 1.4);
    } else {
      t.rage = L; t.state = "fight"; t.alarmed = 8;
      say(t, "Back off!", 1.4);
    }
  }
  function flank(j, L, dt, spd) {
    for (let i = 0; i < j.officers.length; i++) {
      const o = j.officers[i];
      if (!o || o === L || o.dead) continue;
      const ax = j.t.pos.x - L.pos.x, az = j.t.pos.z - L.pos.z, n = Math.hypot(ax, az) || 1;
      const s = i % 2 ? 1 : -1;
      goTo(o, j.t.pos.x - az / n * 1.9 * s, j.t.pos.z + ax / n * 1.9 * s, spd || RUN, dt, 0.5);
    }
  }
  function stepClose(j, dt) {
    const t = j.t, L = responder(j, dt);
    if (!L) {
      // nobody's hands yet: a unit is coming, or yours are asked. A man who
      // was already told keeps his hands up while they come.
      if (j.playerHands && !j.ordered) {
        const P = CBZ.player;
        if (P && P.pos && dist(P, t) < ORDER_R) { j.ordered = true; j.resist = null; say(t, "Okay! Okay!", 1.6); }
      }
      if (j.ordered && !j.resist) holdStill(t);
      return;
    }
    const d = dist(L, t);
    if (!j.ordered && d < ORDER_R) {
      j.ordered = true;
      say(L, (AGENCY[j.key] || AGENCY.police).shout, 2.4);
      react(j, L);
    }
    if (j.ordered && !j.resist) holdStill(t);
    goTo(L, t.pos.x, t.pos.z, d > 5 ? RUN : 2.2, dt, 1.2);
    flank(j, L, dt);
    if (j.ordered) {
      if (j.resist) { j.phase = "subdue"; j.pt = 0; return; }
      if (d < CUFF_R + 1.2 && cuffable(t)) { j.phase = "cuff"; j.pt = 0; return; }
    }
  }
  function stepSubdue(j, dt) {
    const t = j.t;
    prune(j);
    let L = lead(j);
    if (!L && recruit(j, 2)) L = lead(j);
    if (!L) { say(t, "Later.", 1.2); finish(j, "escaped"); return; }     // nobody left to chase him
    const d = dist(L, t);
    if (j.resist === "run" && t.target && t.target.set && !(t.ko > 0)) {
      // he keeps running away from them
      const ax = t.pos.x - L.pos.x, az = t.pos.z - L.pos.z, n = Math.hypot(ax, az) || 1;
      t.state = "flee"; t.target.set(t.pos.x + ax / n * 30, 0, t.pos.z + az / n * 30);
    }
    // down: on the pavement, he is cuffed where he lies
    if ((t.ko || 0) > 0 || (CBZ.arrest && CBZ.arrest.downState && safe(function () { return CBZ.arrest.downState(t); }))) {
      t.rage = null; t.controlled = true; j.resist = null;
      j.phase = "cuff"; j.pt = 0; return;
    }
    if (d < TACKLE_R && !j.tackled) {
      j.tackled = true;
      const V = VB();
      const S = V && V.tackle ? safe(function () { return V.tackle(L, t, { far: true }); }) : null;
      if (!S) {
        t.ko = Math.max(t.ko || 0, 2.6);
        if (CBZ.body && CBZ.body.hit) safe(function () { CBZ.body.hit(t, { fromX: L.pos.x, fromZ: L.pos.z, force: 3.5, knockdown: 1.4 }); });
      }
      say(L, "Stop resisting!", 1.6);
      return;
    }
    if (j.tackled && j.pt > 3 && !(t.ko > 0)) j.tackled = false;        // the tackle missed: go again
    goTo(L, t.pos.x, t.pos.z, RUN + 0.6, dt, 0.9);
    flank(j, L, dt, RUN);
    if (j.pt > CHASE_MAX) { say(L, "Lost him.", 1.6); finish(j, "escaped"); }
  }
  function stepCuff(j, dt) {
    const t = j.t;
    if (rstate(t) === "cuffed" || rstate(t) === "escorted") { cuffedEvent(j); return; }
    const L = responder(j, dt);
    if (!(t.ko > 0)) holdStill(t);
    if (!L) { j.phase = "close"; j.pt = 0; return; }          // his hands went; the next come in
    flank(j, L, dt, 2.2);
    if (j.cuffS) {
      // a cuff verb that never finishes is finished for it: the cuffs go on
      if (!j.cuffS.done) { j.cuffT = (j.cuffT || 0) + dt; if (j.cuffT > CUFF_VERB_MAX) { STATS.cuffForced++; cuffedEvent(j); } return; }
      const out = j.cuffS.result && j.cuffS.result.outcome;
      const V = VB();
      j.cuffS = null;
      if (out === "cuffed" || (V && V.cuffed && safe(function () { return V.cuffed(t); }))) { cuffedEvent(j); return; }
      j.retry = 0.6;
    }
    if (j.retry > 0) { j.retry -= dt; return; }
    const d = dist(L, t);
    if (d > CUFF_R) { goTo(L, t.pos.x, t.pos.z, d > 6 ? RUN : 2.2, dt, 1.0); return; }
    if (!j.said.cuff) { j.said.cuff = true; say(L, "Hands behind your back.", 1.8); }
    const V = VB();
    if (V && V.cuff && j.fallT < 4) {
      const S = safe(function () { return V.cuff(L, t, { far: true }); });
      if (S) { j.cuffS = S; j.cuffT = 0; return; }
    }
    // no hands to animate (or the verb would not start): the cuffs still take their time
    stand(L, t, dt);
    j.fallT += dt;
    if (j.fallT >= CUFF_T) cuffedEvent(j);
  }
  function stepFrisk(j, dt) {
    const t = j.t, L = lead(j);
    if (!L) { j.phase = "escort"; j.pt = 0; return; }
    flank(j, L, dt, 2.2);
    if (!j.frisking) {
      j.frisking = true;
      const V = VB();
      j.friskS = V && V.frisk ? safe(function () { return V.frisk(L, t, { far: true }); }) : null;
    }
    const done = j.friskS ? !!j.friskS.done : j.pt >= FRISK_T;
    if (!j.friskS) stand(L, t, dt);
    if (!done && j.pt < 8) return;
    j.friskS = null;
    say(L, j.seized.length ? "He was carrying. Bagged it." : "He's clean.", 1.8);
    j.phase = "escort"; j.pt = 0;
  }
  // walked by the arm to the back door
  function stepEscort(j, dt) {
    prune(j);
    if (!lead(j) && !j.opts.handsOff) recruit(j, 1, 30);
    const t = j.t, L = lead(j), car = j.car, u = j.unit;
    // still in the back of somebody else's car (yours): out first, then walked
    if (rstate(t) === "in_vehicle" && car && t.restraint.vehicle !== car) {
      if (u && u.state === "parked" && !playerCar() && R() && R().unseat) safe(function () { R().unseat(t); });
      return;
    }
    if (rstate(t) === "in_vehicle" && t.restraint.vehicle === car) { j.phase = "load"; j.pt = 0; return; }
    if (!car) {
      requestUnit(j);
      // no unit can come (no car in this world): they walk him off, and he
      // leaves where nobody sees it
      if (!j.car && j.pt > (CBZ.cityMakeCar ? 20 : 1.5)) { walkOff(j); return; }
      if (L) stand(L, t, dt);
      return;
    }
    const Rs = R();
    if (!L) {
      // nobody's hands: he is put in by the door arc on his own legs
      if (u && u.state === "parked") { j.phase = "board"; j.pt = 0; }
      return;
    }
    // the arm: the verb's escort hold (restrain.js's enum goes "escorted")
    if (rstate(t) === "cuffed" && Rs && Rs.escort) safe(function () { Rs.escort(t, L); });
    if (rstate(t) === "cuffed" && !(Rs && Rs.escort && VB())) { t.restraint.state = "escorted"; t.restraint.officer = L; }
    if (!u || u.state !== "parked") {
      stand(L, car, dt);
      placeEscorted(j, L);
      flank(j, L, dt, 2.2);
      return;
    }
    const door = doorSpot(car, L);
    const d = goTo(L, door.x, door.z, WALK, dt, 1.1);
    placeEscorted(j, L);
    for (let i = 0; i < j.officers.length; i++) { const o = j.officers[i]; if (o && o !== L && !o.dead) goTo(o, L.pos.x - Math.sin(L.group ? L.group.rotation.y : 0) * 1.4, L.pos.z - Math.cos(L.group ? L.group.rotation.y : 0) * 1.4, WALK + 0.3, dt, 0.4); }
    if (d < 1.5 || dist(t, { pos: door }) < 1.3 || j.pt > 30) { j.phase = "board"; j.pt = 0; }
  }
  // with no verbs loaded nothing holds him in front of the officer: this does
  function placeEscorted(j, L) {
    const t = j.t;
    if (VB() && VB().sessionOf && VB().sessionOf(t)) return;
    const yaw = L.group && L.group.rotation ? L.group.rotation.y : 0;
    const D = (R() && R().ESCORT_D) || 0.9;
    t.pos.x = L.pos.x + Math.sin(yaw) * D; t.pos.z = L.pos.z + Math.cos(yaw) * D;
    if (t.group && t.group.rotation) t.group.rotation.y = yaw;
    if (t.target && t.target.set) t.target.set(t.pos.x, 0, t.pos.z);
  }
  function stepBoard(j, dt) {
    const t = j.t, car = j.car, L = lead(j);
    if (!car || car.dead) { j.phase = "escort"; j.pt = 0; j.car = null; j.unit = null; return; }
    if (!j.said.head && L) { j.said.head = true; say(L, "Watch your head.", 1.6); }
    const Rs = R();
    const ok = !!(Rs && Rs.seat && safe(function () { return Rs.seat(t, car); }));
    if (ok) { j.phase = "load"; j.pt = 0; return; }
    /* NO SEAT FOR HIM (a full car, a door that will not take him, no door
       layer at all). This used to put him in a HIDDEN back seat: the body
       switched off beside the car, the owner's "they just disappear". He
       stays a body: try the door again, and if it still will not take him,
       he is walked off on foot and leaves where nobody can see. */
    STATS.refusedSeat++;
    j.boardTries++;
    if (j.boardTries < 3) { j.phase = j.opts.handsOff ? "wait" : "escort"; j.pt = 0; j.parkT = 0; return; }
    if (j.opts.handsOff && !j.officers.length) { j.phase = "wait"; j.pt = 0; j.parkT = -1e9; return; }   // your collar stays yours
    walkOff(j);
  }
  function stepLoad(j, dt) {
    const t = j.t, car = j.car, L = lead(j);
    if (L) stand(L, car, dt);
    const s = rstate(t);
    if (s === "in_vehicle") {
      if (!j.seated) {
        j.seated = true; STATS.seated++; j.pt = 0;
        t._custody.state = "seated";
        // the hands on scene go back to what they were doing; the unit's own crew rides with him
        for (let i = 0; i < j.officers.length; i++) {
          const o = j.officers[i];
          if (j.spawned.indexOf(o) >= 0) {
            claimRide(j, o);
          } else releaseOfficer(j, o);
        }
      }
      // the crew that came on foot gets in (or walks off and leaves where nobody sees)
      const riding = j.spawned.every(function (o) { return !o || o.dead || o._cbzSeat || o._custodyLeaving; });
      if (riding || j.pt > RIDERS_MAX) depart(j);
      return;
    }
    if (s === "boarding") {
      // a walk to the door that never arrives: back out of it, try again
      if (j.pt > LOAD_MAX) { const Rs = R(); if (Rs && Rs.unseat) safe(function () { Rs.unseat(t); }); j.boardTries++; j.phase = "board"; j.pt = 0; }
      return;
    }
    // the door arc ended without a seat: try the door again (stepBoard counts)
    if (j.pt > 1.5) { j.phase = "board"; j.pt = 0; }
  }
  /* ---- ON FOOT: walked off, or walked in ------------------------------------------
     No car can take him (none in this world, or no door will): he is walked
     away from the player by the arm, still cuffed, and leaves the world only
     where nobody can see him. A collar handed over at the precinct desk is
     walked through the door the same way (intake below). While custody walks
     him, restrain.js's standing pin lets go of his legs (_custody.walking). */
  function awayFrom(p, m) {
    const P = CBZ.player;
    let ax = 1, az = 0;
    if (P && P.pos) { ax = p.pos.x - P.pos.x; az = p.pos.z - P.pos.z; const n = Math.hypot(ax, az); if (n > 0.01) { ax /= n; az /= n; } else { ax = 1; az = 0; } }
    return { x: p.pos.x + ax * m, z: p.pos.z + az * m };
  }
  function startWalk(j, kind, to) {
    const t = j.t;
    j.phase = kind; j.pt = 0; j.walkTo = to;
    if (t._custody) t._custody.walking = true;
    else t._custody = { job: j.id, state: kind, walking: true };
    STATS.walked++;
  }
  function walkOff(j) {
    if (j.car && j.unit && !j.departed) {
      // the unit that could not take him goes back without him
      CARS_LEAVING.push({ car: j.car, unit: j.unit, t: 0 });
      pullOut(j.car, j.unit);
      j.car = null; j.unit = null;
    }
    const L = lead(j);
    if (L && !j.said.walk) { j.said.walk = true; say(L, "We walk him.", 1.6); }
    startWalk(j, "walkoff", awayFrom(j.t, 60));
  }
  function stepWalk(j, dt) {
    const t = j.t, L = lead(j);
    if (CBZ.boardingHolds && CBZ.boardingHolds(t)) return;     // still climbing out of a car door
    // a door is walked TO, then through (a straight line to the room behind
    // it runs into the wall beside the door)
    const via = j.walkVia, H0 = L || t;
    if (via && Math.hypot(H0.pos.x - via.x, H0.pos.z - via.z) < 0.7) j.walkVia = null;
    const to = j.walkVia || j.walkTo;
    const Rs = R();
    let d;
    if (L) {
      if (rstate(t) === "cuffed" && Rs && Rs.escort) safe(function () { Rs.escort(t, L); });
      if (rstate(t) === "cuffed" && !(Rs && Rs.escort && VB())) { t.restraint.state = "escorted"; t.restraint.officer = L; }
      d = goTo(L, to.x, to.z, WALK, dt, 0.3);
      placeEscorted(j, L);
      for (let i = 0; i < j.officers.length; i++) { const o = j.officers[i]; if (o && o !== L && !o.dead) goTo(o, L.pos.x - Math.sin(L.group ? L.group.rotation.y : 0) * 1.4, L.pos.z - Math.cos(L.group ? L.group.rotation.y : 0) * 1.4, WALK + 0.3, dt, 0.4); }
    } else {
      d = goTo(t, to.x, to.z, WALK * 0.85, dt, 0.3);
    }
    // the street runs out and he is still in view: keep walking the same way
    if (j.phase === "walkoff" && d < 0.5) j.walkTo = awayFrom(t, 40);
    // gone only where nobody sees: through a door (a wall between him and
    // the camera, a few metres on), off screen, or far
    const minD = j.phase === "walkin" ? 6 : 40;
    if (hidden(t.pos.x, t.pos.z, minD) || unseen(t.pos.x, t.pos.z, GONE_MIN)) {
      if (j.rec) { j.rec.status = "held"; j.rec.arrived = day(); }
      for (let i = 0; i < j.spawned.length; i++) { const o = j.spawned[i]; if (o && !o.dead && (hidden(o.pos.x, o.pos.z, minD) || unseen(o.pos.x, o.pos.z, GONE_MIN))) exitPlain(o); }
      STATS.delivered++;
      exitBody(t);
      finish(j, "delivered");
    }
  }
  /* THE DESK TAKES HIM (restrain.js turnIn): booked, still cuffed, walked by
     the nearest officer on the block (or on his own feet) through the
     precinct door, and out of play once a wall is between him and you. */
  function intake(t, S, o) {
    o = o || {};
    if (!t || t.dead || !t.pos || t._custodyExit) return false;
    const had = jobOf(t);
    if (had) finish(had, "handed");                      // a unit you radioed for goes back empty
    const j = mkJob(t, "police", { by: "police", verb: "arrest", owner: o.by || null, intake: true });
    const off = findOfficers("police", t, 1, j).filter(function (q) { return dist(q, t) < 30; });
    j.officers = off;
    for (let i = 0; i < off.length; i++) claim(j, off[i]);
    j.cuffed = true; j.cuffedAt = 0;
    j.rec = book(t, { verb: "arrest", by: o.by || "police", status: "held", facility: facilityFor("police") });
    t._custody = { job: j.id, state: "intake", walking: true };
    JOBS.push(j);
    STATS.taken++; STATS.intake++;
    // through the door, four metres in: toward the middle of the lot the door fronts
    const door = { x: S && S.x != null ? S.x : t.pos.x, z: S && S.z != null ? S.z : t.pos.z };
    const lot = S && S.lot;
    let ix, iz;
    if (lot && lot.cx != null && Math.hypot(lot.cx - door.x, lot.cz - door.z) > 0.5) {
      ix = lot.cx - door.x; iz = lot.cz - door.z; const n = Math.hypot(ix, iz); ix /= n; iz /= n;
    } else { const a = awayFrom({ pos: door }, 1); ix = a.x - door.x; iz = a.z - door.z; }
    startWalk(j, "walkin", { x: door.x + ix * 4, z: door.z + iz * 4 });
    // to the kerb side of the door first, then in
    j.walkVia = { x: door.x - ix * 1.2, z: door.z - iz * 1.2 };
    t._custody.state = "intake";
    if (off[0]) say(off[0], "I've got him.", 1.6);
    return true;
  }

  function claimRide(j, o) {
    const B = CBZ.boarding;
    let ok = false;
    if (B && B.board && j.car) ok = !!safe(function () { return B.board(o, j.car, { role: "guard" }); });
    if (ok) { j.unit.riders.push(o); return; }
    leave(o, j);
  }
  function depart(j) {
    const car = j.car, u = j.unit, t = j.t;
    if (j.departed) return;
    j.departed = true; STATS.departed++;
    j.phase = "away"; j.pt = 0;
    if (j.rec) j.rec.status = "transit";
    t._custody.state = "transit";
    for (let i = 0; i < j.spawned.length; i++) { const o = j.spawned[i]; if (o && !o._cbzSeat && !o._custodyLeaving) leave(o, j); }
    pullOut(car, u);
  }
  // back into traffic, in its lane (vehicles.js drives it from here); with no
  // road under it, straight on down the line it came in on
  function pullOut(car, u) {
    const seg = u.plan && u.plan.seg;
    if (seg && seg.road) {
      car.road = seg.road; car.vertical = !!seg.vertical; car.dirSign = seg.dirSign; car.lane = seg.lane; car.laneIdx = seg.laneIdx | 0;
      car.turning = null; car.parked = false; car.baseV = 11; car.v = Math.max(car.v || 0, 1.5); car.ai = true;
      u.manual = false;
    } else u.manual = true;
    car._custodyRide = true;
  }
  function stepAway(j, dt) {
    const car = j.car, u = j.unit, t = j.t;
    if (!car || car.dead || (CBZ.cityCars && CBZ.cityCars.indexOf(car) < 0)) {
      // the car is gone (blown up, scrapped): restrain.js tumbles him out at the
      // wreck, still cuffed; a new unit is called
      if (!t.dead && (rstate(t) === "cuffed" || rstate(t) === "escorted")) { j.car = null; j.unit = null; j.departed = false; j.seated = false; j.phase = "escort"; j.pt = 0; if (j.rec) j.rec.status = "taken"; requestUnit(j); return; }
      if (!t.dead) { finish(j, "lost"); return; }
      return;
    }
    if (u.manual) driveCar(car, awayHeading(car, dt), Math.min(11, 1.5 + j.pt * 3.5), dt);
    const P = CBZ.player;
    const d = P && P.pos ? hyp(car.pos.x, car.pos.z, P.pos.x, P.pos.z) : 1e9;
    if (d > DRAW_R || (d > GONE_MIN && unseen(car.pos.x, car.pos.z, GONE_MIN)) || (j.pt > 120 && unseen(car.pos.x, car.pos.z, 35))) deliver(j);
  }
  // OUT OF DRAW RANGE: the one moment the body leaves the world
  function deliver(j) {
    const car = j.car, u = j.unit, t = j.t;
    if (j.rec) { j.rec.status = "held"; j.rec.arrived = day(); }
    STATS.delivered++;
    exitBody(t);
    retireCar(car, u);
    finish(j, "delivered");
  }
  function retireCar(car, u) {
    if (!car) return;
    const riders = (u && u.riders) || [];
    const drv = u && u.driver;
    if (CBZ.carOccupancyClear) safe(function () { CBZ.carOccupancyClear(car); });
    for (let i = 0; i < riders.length; i++) exitPlain(riders[i]);
    if (drv) exitPlain(drv);
    if (CBZ.cityScrapCar) safe(function () { CBZ.cityScrapCar(car); });
    else { car.dead = true; if (car.group && car.group.parent) car.group.parent.remove(car.group); }
  }

  // ---- bodies leaving -------------------------------------------------------------------
  function exitPlain(p) {
    if (!p || p.dead) return;
    p._custodyExit = true;
    if (CBZ.cityUnpostNpc) safe(function () { CBZ.cityUnpostNpc(p); });
    else if (p.group && p.group.parent) p.group.parent.remove(p.group);
  }
  function exitBody(p) {
    if (!p) return;
    p._custodyExit = true;
    const Rs = R();
    if (p.restraint && Rs && Rs.handOff) safe(function () { Rs.handOff(p); });
    else p.restraint = null;
    if (p._custody) p._custody.state = "gone";
    // a crowd body: its street row is consumed (he will not walk this street again)
    if (p._crowd && CBZ.streetLife && CBZ.streetLife.retire) safe(function () { return CBZ.streetLife.retire(p); });
    if (CBZ.cityUnpostNpc) safe(function () { CBZ.cityUnpostNpc(p); });
    else if (p.group && p.group.parent) p.group.parent.remove(p.group);
    p._gone = true;
  }
  // somebody who came for him walks off and leaves where nobody sees it
  function leave(o, j) {
    if (!o || o.dead) return;
    if (j) releaseOfficer(j, o);
    o._custodyLeaving = true;
    const P = CBZ.player;
    let ax = 1, az = 0;
    if (P && P.pos) { ax = o.pos.x - P.pos.x; az = o.pos.z - P.pos.z; const n = Math.hypot(ax, az) || 1; ax /= n; az /= n; }
    LEAVERS.push({ ped: o, to: { x: o.pos.x + ax * 60, z: o.pos.z + az * 60 }, t: 0 });
  }
  function stepLeavers(dt) {
    for (let i = LEAVERS.length - 1; i >= 0; i--) {
      const L = LEAVERS[i], o = L.ped;
      L.t += dt;
      if (!o || o.dead || o._gone) { LEAVERS.splice(i, 1); continue; }
      goTo(o, L.to.x, L.to.z, WALK + 0.2, dt, 0.5);
      const may = CBZ.bodyMayLeave ? !!safe(function () { return CBZ.bodyMayLeave(o, { minDistance: 40 }); }) : unseen(o.pos.x, o.pos.z, 40);
      if (may || L.t > 240) { exitPlain(o); o._gone = true; LEAVERS.splice(i, 1); }
    }
  }

  function finish(j, why) {
    if (j.done) return;
    j.done = true; j.why = why;
    const t = j.t;
    for (let i = 0; i < j.officers.length; i++) releaseOfficer(j, j.officers[i]);
    if (j.cuffS && !j.cuffS.done && j.cuffS.cancel) safe(function () { j.cuffS.cancel(); });
    if (j.friskS && !j.friskS.done && j.friskS.cancel) safe(function () { j.friskS.cancel(); });
    if (!j.cuffed && t && !t.dead && !t._custodyExit) {
      // called off before the cuffs: he is a free man where he stands
      lowerHands(t);
      if (!t._post && !t._occupySrc && !t.staffPost) t.controlled = false;
      if (t.state === "surrender") t.state = "walk";
      t._custody = null;
    }
    if (why === "dead" && j.rec && IN_CUSTODY[j.rec.status]) j.rec.status = "died";
    if (why === "escaped" || why === "lost") { if (j.rec && IN_CUSTODY[j.rec.status]) j.rec.status = "escaped"; if (t) t._custody = null; }
    // spawned hands that never got in walk off; a unit of ours with nobody in it drives off
    for (let i = 0; i < j.spawned.length; i++) { const o = j.spawned[i]; if (o && !o._custodyLeaving && !o._cbzSeat && !o._custodyExit) leave(o, null); }
    if (j.car && j.unit && why !== "delivered" && why !== "offscreen") {
      CARS_LEAVING.push({ car: j.car, unit: j.unit, t: 0 });
      if (!j.departed) pullOut(j.car, j.unit);
    }
    const i = JOBS.indexOf(j);
    if (i >= 0) JOBS.splice(i, 1);
    if (j.opts.onEnd) safe(function () { j.opts.onEnd(j, why); });
  }
  const CARS_LEAVING = [];
  function stepCarsLeaving(dt) {
    const P = CBZ.player;
    for (let i = CARS_LEAVING.length - 1; i >= 0; i--) {
      const c = CARS_LEAVING[i], car = c.car;
      c.t += dt;
      if (!car || car.dead) { CARS_LEAVING.splice(i, 1); continue; }
      if (c.unit.manual) driveCar(car, awayHeading(car, dt), Math.min(11, 1.5 + c.t * 3.5), dt);
      const d = P && P.pos ? hyp(car.pos.x, car.pos.z, P.pos.x, P.pos.z) : 1e9;
      if (d > DRAW_R || (d > GONE_MIN && unseen(car.pos.x, car.pos.z, GONE_MIN)) || c.t > 180) { retireCar(car, c.unit); CARS_LEAVING.splice(i, 1); }
    }
  }

  // ---- stand down / let him go ------------------------------------------------------------
  //  before the cuffs: the job is off, he goes free. After: only {free:true}
  //  cuts him loose (the ties come off where he stands, or at the kerb).
  function cancel(x, o) {
    const j = x && x.t && x.phase ? x : jobOf(x);
    if (!j) return false;
    o = o || {};
    if (j.cuffed && !o.free) return false;
    STATS.cancelled++;
    if (j.cuffed) {
      const t = j.t;
      const Rs = R();
      if (Rs && Rs.release) safe(function () { Rs.release(t); }); else t.restraint = null;
      t._custody = null; t.controlled = false;
      if (j.rec) j.rec.status = "released";
    }
    finish(j, j.cuffed ? "freed" : "called-off");
    return true;
  }

  // ================================================================
  //  AFTERWARDS: pardon, release, trial, a visit
  // ================================================================
  // the body comes back into the world: out of the facility's gate (or `at`)
  function release(id, o) {
    o = o || {};
    const r = get(id);
    if (!r || !IN_CUSTODY[r.status]) return null;
    // still on scene (in the car, at the kerb): he is let go right there
    for (let i = 0; i < JOBS.length; i++) if (JOBS[i].rec === r && !JOBS[i].done) { cancel(JOBS[i], { free: true }); r.status = o.how || "released"; return r; }
    r.status = o.how || "released";
    r.out = day();
    const v = VISITS[r.id];
    if (v && v.body && !v.body.dead) {
      // the man in the visiting room walks out
      const b = v.body; const Rs = R();
      if (Rs && Rs.release) safe(function () { Rs.release(b, { silent: true }); });
      b._custody = null; b.controlled = false;
      delete VISITS[r.id];
      return r;
    }
    const f = r.facility || {};
    // out of the facility's own gate; `at` is where to put him when it has none
    let x = f.outX != null ? f.outX : f.x, z = f.outZ != null ? f.outZ : f.z;
    if ((x == null || z == null) && o.at) { x = o.at.x; z = o.at.z; }
    if (x != null && z != null && CBZ.cityPostNpc && o.body !== false) {
      const p = safe(function () {
        const opts = { job: r.gang != null ? "gang member" : (r.job || "civilian"), archetype: "resident", src: "custody:release" };
        if (r.look && r.look.outfit != null) opts.outfit = r.look.outfit;
        if (r.look && r.look.skin != null) opts.skin = r.look.skin;
        return CBZ.cityPostNpc(x + 3, z + 9, opts);
      });
      if (p) { p.name = r.name; p.nameKnown = true; p._sid = r.sid; if (r.gang != null) p.gangId = r.gang; r.body = true; }
    }
    return r;
  }
  function pardon(id) {
    const r = get(id);
    if (!r) return { ok: false, why: "Nobody by that name is held." };
    const Pol = CBZ.politics;
    if (Pol && Pol.pardon && Pol.owns && CBZ.gov && CBZ.gov.holds) {
      const h = safe(function () { return CBZ.gov.holds(); });
      if (h && h.kind === "country" && Pol.owns(h.id)) return Pol.pardon(r.sid || r.name);
    }
    release(r.id, { how: "pardoned" });
    return { ok: true, line: "He walks out today.", who: r };
  }
  // the case is what they found on him and what he had done
  function trial(id) {
    const r = get(id);
    if (!r || !IN_CUSTODY[r.status] || r.status === "convicted") return { ok: false, why: r && r.status === "convicted" ? "Already convicted." : "Nobody by that name is held." };
    const w = (r.seized.length ? 0.35 : 0) + Math.min(0.45, (r.charges || []).length * 0.15) + (r.gang != null ? 0.15 : 0) + (r.verb === "arrest" ? 0.1 : 0);
    const guilty = h01("cu:trial:" + r.id + ":" + (r.sid || r.name)) < 0.15 + w;
    r.trial = { day: day(), verdict: guilty ? "guilty" : "acquitted" };
    if (guilty) { r.status = "convicted"; r.sentence = 30 + Math.round(w * 300); }
    else release(r.id, { how: "acquitted" });
    if ((r.name || r.title) && CBZ.news && CBZ.news.push) {
      safe(function () { CBZ.news.push((r.name || r.title) + (guilty ? " convicted" : " acquitted"), { cat: "COURTS", sub: guilty ? (r.sentence + " days") : "Walks free", phone: true }); });
    }
    return { ok: true, verdict: r.trial.verdict, record: r };
  }
  // A VISIT: the map points at the facility; get there and he is brought out
  const VISITS = {};
  function visit(id) {
    const r = get(id);
    if (!r || !IN_CUSTODY[r.status]) return { ok: false, why: "Nobody by that name is held." };
    const f = r.facility || {};
    if (f.x == null) return { ok: false, why: "Nobody will say where he is." };
    VISITS[r.id] = VISITS[r.id] || { rec: r, body: null };
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) safe(function () { CBZ.fullMap.setWaypoint(f.x, f.z, r.name || "Detainee"); });
    return { ok: true, facility: f.name, x: f.x, z: f.z, line: (r.name || "He") + " is at " + f.name + "." };
  }
  function stepVisits(dt) {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    for (const k in VISITS) {
      const v = VISITS[k], r = v.rec, f = r.facility || {};
      if (!IN_CUSTODY[r.status]) { delete VISITS[k]; continue; }
      const d = hyp(P.pos.x, P.pos.z, f.x, f.z);
      if (!v.body && d < 25 && CBZ.cityPostNpc) {
        const b = safe(function () { return CBZ.cityPostNpc(f.x + 1.6, f.z + 1.6, { job: r.job || "civilian", src: "custody:visit" }); });
        if (b) {
          b.name = r.name; b.nameKnown = true; b._sid = r.sid; if (r.gang != null) b.gangId = r.gang;
          const Rs = R();
          if (Rs && Rs.cuff) safe(function () { Rs.cuff(b, { by: "custody", seize: true, custody: true }); });
          b._custody = { visit: r.id, state: "held" };
          v.body = b; r.visits = (r.visits | 0) + 1;
        }
      } else if (v.body && d > 80) {
        exitBody(v.body); v.body = null; delete VISITS[k];
      }
    }
  }

  // ================================================================
  //  THE GUARD: nobody in custody leaves play except through this file
  // ================================================================
  function holds(p) {
    if (!p || p._custodyExit) return false;
    return !!(p._custody || p.restraint || jobOf(p));
  }
  function blocked(p, why) {
    STATS.blocked++;
    if (STATS.blocked < 4 && typeof console !== "undefined" && console.warn) console.warn("[custody] refused to remove a body in custody (" + (why || "?") + "): " + ((p && p.name) || "?"));
  }

  // ================================================================
  //  THE TICK (36.45: after orders.js 36.4, before restrain.js 38.5)
  // ================================================================
  function tick(dt) {
    if (!wired) wired = wire();
    if (g.mode !== "city") {
      // the city is torn down with everyone in it: the cuffed are held, the rest never happened
      for (let i = JOBS.length - 1; i >= 0; i--) { const j = JOBS[i]; if (j.rec && IN_CUSTODY[j.rec.status]) j.rec.status = "held"; j.done = true; }
      JOBS.length = 0; LEAVERS.length = 0; CARS_LEAVING.length = 0;
      return;
    }
    dt = dt || 0;
    CLOCK += dt;
    for (let i = JOBS.length - 1; i >= 0; i--) {
      const j = JOBS[i];
      if (!j || j.done) { JOBS.splice(i, 1); continue; }
      j.pt += dt; j.age += dt;
      const t = j.t;
      if (t.dead) { finish(j, "dead"); continue; }
      // the ties came off by some other hand (the player cut him loose): free
      if (j.cuffed && !t.restraint && !j.offscreen) { if (j.rec && IN_CUSTODY[j.rec.status]) j.rec.status = "released"; t._custody = null; finish(j, "freed"); continue; }
      // somebody's hands got the cuffs on (yours, restrain.js's Cuff): custody from here
      if (!j.cuffed && (rstate(t) === "cuffed" || rstate(t) === "escorted")) cuffedEvent(j);
      // THE SURRENDER ALWAYS RESOLVES: a unit at REACH_T, and only when
      // truly nobody is coming does he give up waiting
      if (!j.cuffed && (j.phase === "close" || j.phase === "cuff")) {
        if (!j.dispatched && j.age > REACH_T && !closing(j)) dispatch(j);
        if (j.age > GIVEUP_T && !closing(j)) { giveUp(j); continue; }
      }
      unitStep(j, dt);
      switch (j.phase) {
        case "close": stepClose(j, dt); break;
        case "subdue": stepSubdue(j, dt); break;
        case "cuff": stepCuff(j, dt); break;
        case "frisk": stepFrisk(j, dt); break;
        case "escort": stepEscort(j, dt); break;
        case "wait":
          // the player's collar: he puts him in the unit himself (restrain.js's
          // Stuff in), or the unit takes him once it has stood at the kerb a
          // few seconds: he walks to its back door on his own legs
          if (rstate(t) === "in_vehicle" && j.car && t.restraint.vehicle === j.car) { j.phase = "load"; j.pt = 0; }
          else if (!t.restraint) finish(j, "freed");
          else if (j.car && j.unit && j.unit.state === "parked" && rstate(t) !== "boarding") {
            j.parkT += dt;
            if (j.parkT > 4 && dist(t, j.car) < 30) { j.phase = "board"; j.pt = 0; }
          }
          break;
        case "hold": stepHold(j, dt); break;
        case "desk":
          // in the back of your car on the way to the desk; out of it, he is held again
          if (rstate(t) !== "in_vehicle" && rstate(t) !== "boarding") { j.phase = "hold"; j.held = true; j.pt = 0; }
          break;
        case "walkoff": case "walkin": stepWalk(j, dt); break;
        case "board": stepBoard(j, dt); break;
        case "load": stepLoad(j, dt); break;
        case "away": stepAway(j, dt); break;
      }
    }
    if (LEAVERS.length) stepLeavers(dt);
    if (CARS_LEAVING.length) stepCarsLeaving(dt);
    stepVisits(dt);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.45, tick);

  // ---- the verbs on a man being taken ---------------------------------------------------
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register) return false;
    // THE MAN YOU HOLD: his verbs are your choice (E = Jail, the rest on the wheel)
    const yours = function (t) { const j = jobOf(t); return j && j.cuffed && !j.departed && (j.opts.owner === "player" || j.opts.owner === "president") ? j : null; };
    const holding = function (t) { const j = yours(t); return j && j.held ? j : null; };
    I.register("ped", { id: "cu-jail", prio: 79, campaignSafe: true, anyone: true,
      canShow: function (t) { return !!holding(t); }, label: "Jail",
      onSelect: function (t) { jail(t); if (I.refresh) I.refresh(); } });
    I.register("ped", { id: "cu-search", wheel: true, prio: 62, campaignSafe: true, anyone: true,
      canShow: function (t) { const j = holding(t); return !!(j && !j.searched && rstate(t) !== "in_vehicle"); }, label: "Search",
      onSelect: function (t) { search(t); if (I.refresh) I.refresh(); } });
    I.register("ped", { id: "cu-execute", wheel: true, prio: 40, bad: true, campaignSafe: true, anyone: true,
      canShow: function (t) { const j = holding(t); return !!(j && rstate(t) !== "in_vehicle" && rstate(t) !== "boarding"); }, label: "Execute",
      onSelect: function (t) { execute(t); if (I.refresh) I.refresh(); } });
    // LET HIM GO: the cuffs come off before the car takes him (whoever gave the order)
    I.register("ped", { id: "cu-let-go", wheel: true, prio: 70, campaignSafe: true, anyone: true,
      canShow: function (t) { return !!yours(t) && rstate(t) !== "boarding"; },
      label: "Release",
      onSelect: function (t) { free(t); if (I.refresh) I.refresh(); } });
    return true;
  }
  let wired = wire();          // else the tick wires it once the registry is up

  CBZ.custody = {
    take: take, cancel: cancel, jobOf: jobOf, holds: holds, blocked: blocked, intake: intake,
    cuffed: function (t) { const j = jobOf(t); return !!(j && j.cuffed); },
    jobs: function () { return JOBS.map(function (j) { return { id: j.id, name: j.t && j.t.name, phase: j.phase, cuffed: j.cuffed, departed: !!j.departed, car: !!j.car, unit: j.unit ? j.unit.state : null, by: j.by, verb: j.verb, held: !!j.held, holder: (lead(j) || {}).name || (j.held ? "player" : null), dispatched: !!j.dispatched, playerHands: !!j.playerHands }; }); },
    jail: jail, search: search, execute: execute, free: free,
    book: book, records: records, held: held, get: get, release: release, pardon: pardon, trial: trial, visit: visit,
    facility: facilityFor, agencyKey: agencyKey,
    audit: function () { return Object.assign({ jobs: JOBS.length, leavers: LEAVERS.length, held: held().length, records: store().records.length }, STATS); },
    _job: function (t) { return jobOf(t); },
  };
})();
