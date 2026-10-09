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
   Stand down before the cuffs and it is off (cancel()); after the cuffs he is
   in custody and leaves by the car, or by "Let him go" (cancel(t,{free})).

   THE GUARD. While a body is in custody (ped._custody, or any ped.restraint)
   nothing else may take it out of play: occupy.js's cityUnpostNpc, police.js's
   station intake, config.js's bodyMayLeave and the crowd's park all refuse
   it. The only door out is this file (ped._custodyExit), and this file only
   opens it when the car carrying him has left draw range (or, for an arrest
   nobody could see, where nobody can see).

   PUBLIC: CBZ.custody = { take, cancel, jobOf, cuffed, holds, jobs,
     book, records, held, get, release, pardon, trial, visit, facility, audit }
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
  const STATS = { taken: 0, cuffed: 0, seated: 0, departed: 0, delivered: 0, offscreen: 0, cancelled: 0, blocked: 0 };
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
  function usableOfficer(q, t) {
    return !!(q && q !== t && !q.dead && q.pos && !q.player && !q.isPlayer && !q.restraint && !q._custodyJob && !q.inCar &&
      !q._airPilot && !q._swatPassenger && !(q.ko > 0));
  }
  function findOfficers(key, t, n, j) {
    const out = [];
    const lists = [CBZ.cityCops, CBZ.cityPeds];
    for (let k = 0; k < lists.length; k++) {
      const L = lists[k]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        if (!usableOfficer(q, t) || out.indexOf(q) >= 0 || !isOfficerOf(q, key, j)) continue;
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
    if (o._verbS && !o._verbS.done) return d;                 // a verb has his body right now
    const PR = CBZ.protection;
    if (PR && PR.moveToward && CBZ.cityPeds && CBZ.cityPeds.indexOf(o) >= 0) {
      if (d <= stop) { if (PR.release) safe(function () { PR.release(o); }); o.state = "idle"; o.speed = 0; faceTo(o, x, z); return d; }
      PR.moveToward(o, x, z, spd, dt);
      return d;
    }
    // a body no brain walks while it works for us (a cop: police.js yields him)
    let sp = 0;
    if (d > stop) {
      const s = Math.min(d - stop, spd * dt);
      o.pos.x += dx / d * s; o.pos.z += dz / d * s;
      if (CBZ.collide) safe(function () { CBZ.collide(o.pos, 0.45, 0, 1.7); });
      sp = dt > 0 ? s / dt : 0;
      faceTo(o, x, z);
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
  function lead(j) {
    for (let i = 0; i < j.officers.length; i++) { const o = j.officers[i]; if (o && !o.dead && !o.restraint && !(o.ko > 0)) return o; }
    return null;
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
    const j = {
      id: ++JSEQ, t: t, by: opts.by != null ? opts.by : key, key: key, verb: opts.verb === "detain" ? "detain" : "arrest", opts: opts,
      gang: key === "gang" ? String(opts.by).split(":")[1] : null,
      officers: [], spawned: [], phase: "close", pt: 0, age: 0, ordered: false, resist: null, cuffed: false, done: false,
      car: null, unit: null, rec: null, seized: [], cuffS: null, friskS: null, fallT: 0, retry: 0, said: {},
    };
    if (!opts.handsOff) {
      let off = (opts.officers || []).filter(function (q) { return usableOfficer(q, t) || (q && q._order && q._order.force && !q.dead); });
      if (!off.length) off = findOfficers(key, t, 2, j);
      if (!off.length) {
        // AN ARREST NOBODY SEES happens where nobody sees it
        if (unseen(t.pos.x, t.pos.z, 60)) { JOBS.push(j); offscreen(j); return j; }
        off = spawnOfficers(key, t, 2);
        j.spawned = off.slice();
        if (!off.length) return null;
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

  // ---- THE CUFFS ARE ON: the moment it becomes custody -----------------------------
  function cuffedEvent(j) {
    if (j.cuffed) return;
    const t = j.t;
    j.cuffed = true; j.cuffedAt = j.age;
    const gun = t.armed && t.weapon ? t.weapon : null;
    const Rs = R();
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
    if (j.opts.act && CBZ.politics && CBZ.politics.act) {
      const ao = Object.assign({}, j.opts.actOpts || {}, { target: t, by: j.opts.actBy || (j.opts.actOpts && j.opts.actOpts.by) || j.by, keepBody: true });
      safe(function () { CBZ.politics.act(j.verb, ao); });
    }
    if (j.opts.onCuffed) safe(function () { j.opts.onCuffed(j); });
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
  function unitStep(j, dt) {
    const u = j.unit, car = j.car;
    if (!u || !car) return;
    u.t += dt;
    if (u.state !== "coming") return;
    if (car.dead) { j.car = null; j.unit = null; requestUnit(j); return; }
    const st = u.plan.stop;
    const d = hyp(car.pos.x, car.pos.z, st.x, st.z);
    if (d < u.best - 0.05) { u.best = d; u.stall = 0; } else u.stall += dt;
    if (d < 0.6 || u.stall > 3 || u.t > 25) { u.state = "parked"; car.v = 0; car.vx = 0; car.vz = 0; return; }
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
    const t = j.t, L = lead(j);
    if (!L) { finish(j, "no-officers"); return; }
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
    if (j.age > 60) finish(j, "timeout");
  }
  function stepSubdue(j, dt) {
    const t = j.t, L = lead(j);
    if (!L) { finish(j, "no-officers"); return; }
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
    const t = j.t, L = lead(j);
    if (rstate(t) === "cuffed" || rstate(t) === "escorted") { cuffedEvent(j); return; }
    if (!L) { finish(j, "no-officers"); return; }
    if (!(t.ko > 0)) holdStill(t);
    flank(j, L, dt, 2.2);
    if (j.cuffS) {
      if (!j.cuffS.done) return;
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
      if (S) { j.cuffS = S; return; }
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
    const t = j.t, L = lead(j), car = j.car, u = j.unit;
    if (rstate(t) === "in_vehicle" && t.restraint.vehicle === car) { j.phase = "load"; j.pt = 0; return; }
    if (!car) {
      requestUnit(j);
      if (!j.car && j.pt > 20) {
        // no unit can come (no car in this world): they walk him off, and he
        // leaves where nobody sees it
        if (L) {
          const P = CBZ.player;
          let ax = 1, az = 0;
          if (P && P.pos) { ax = L.pos.x - P.pos.x; az = L.pos.z - P.pos.z; const n = Math.hypot(ax, az) || 1; ax /= n; az /= n; }
          goTo(L, L.pos.x + ax * 10, L.pos.z + az * 10, WALK, dt, 0.2);
          placeEscorted(j, L);
        }
        if (unseen(t.pos.x, t.pos.z, GONE_MIN)) { if (j.rec) j.rec.status = "held"; for (let i = 0; i < j.spawned.length; i++) exitPlain(j.spawned[i]); exitBody(t); finish(j, "delivered"); }
        return;
      }
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
    let ok = false;
    if (Rs && Rs.seat) ok = !!safe(function () { return Rs.seat(t, car); });
    if (!ok && Rs && Rs.seat) ok = !!safe(function () { return Rs.seat(t, car, { legacy: true }); });
    if (!ok) {
      // no restrain layer: the enum by hand (hidden in the back, the legacy seat)
      t.restraint = t.restraint || { state: "cuffed", by: j.key, t: 0, vehicle: null };
      t.restraint.state = "in_vehicle"; t.restraint.vehicle = car;
      car._captive = car._captive || t;
    }
    j.phase = "load"; j.pt = 0;
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
    if (s === "boarding") { if (j.pt > LOAD_MAX) { const Rs = R(); if (Rs && Rs.seat) { safe(function () { Rs.unseat(t); }); safe(function () { Rs.seat(t, car, { legacy: true }); }); } } return; }
    // the door arc refused (no seat, no door): put him in the old way
    if (j.pt > 1.5) { j.phase = "board"; j.pt = 0; }
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
    if (u.manual) driveCar(car, car.heading || 0, Math.min(11, 1.5 + j.pt * 3.5), dt);
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
    if (p._crowd && CBZ.cityCrowdRetire) { const ok = safe(function () { return CBZ.cityCrowdRetire(p); }); if (ok === false) { /* not pooled */ } }
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
      if (c.unit.manual) driveCar(car, car.heading || 0, Math.min(11, 1.5 + c.t * 3.5), dt);
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
    for (let i = JOBS.length - 1; i >= 0; i--) {
      const j = JOBS[i];
      if (!j || j.done) { JOBS.splice(i, 1); continue; }
      j.pt += dt; j.age += dt;
      const t = j.t;
      if (t.dead) { finish(j, "dead"); continue; }
      // the ties came off by some other hand (the player cut him loose): free
      if (j.cuffed && !t.restraint && !j.offscreen) { if (j.rec && IN_CUSTODY[j.rec.status]) j.rec.status = "released"; t._custody = null; finish(j, "freed"); continue; }
      unitStep(j, dt);
      switch (j.phase) {
        case "close": stepClose(j, dt); break;
        case "subdue": stepSubdue(j, dt); break;
        case "cuff": stepCuff(j, dt); break;
        case "frisk": stepFrisk(j, dt); break;
        case "escort": stepEscort(j, dt); break;
        case "wait":
          // the player's collar: he puts him in the unit himself (restrain.js's Stuff in)
          if (rstate(t) === "in_vehicle" && j.car && t.restraint.vehicle === j.car) { j.phase = "load"; j.pt = 0; }
          else if (!t.restraint) finish(j, "freed");
          break;
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
    // LET HIM GO: the cuffs come off before the car takes him (whoever gave the order)
    I.register("ped", { id: "cu-let-go", prio: 79, campaignSafe: true, anyone: true,
      canShow: function (t) { const j = jobOf(t); return !!(j && j.cuffed && !j.departed && (j.opts.owner === "player" || j.opts.owner === "president")); },
      label: "Let him go",
      onSelect: function (t) { const j = jobOf(t); const L = j && lead(j); cancel(t, { free: true }); if (L) say(L, "You're free to go.", 1.8); } });
    return true;
  }
  let wired = wire();          // else the tick wires it once the registry is up

  CBZ.custody = {
    take: take, cancel: cancel, jobOf: jobOf, holds: holds, blocked: blocked,
    cuffed: function (t) { const j = jobOf(t); return !!(j && j.cuffed); },
    jobs: function () { return JOBS.map(function (j) { return { id: j.id, name: j.t && j.t.name, phase: j.phase, cuffed: j.cuffed, departed: !!j.departed, car: !!j.car, unit: j.unit ? j.unit.state : null, by: j.by, verb: j.verb }; }); },
    book: book, records: records, held: held, get: get, release: release, pardon: pardon, trial: trial, visit: visit,
    facility: facilityFor, agencyKey: agencyKey,
    audit: function () { return Object.assign({ jobs: JOBS.length, leavers: LEAVERS.length, held: held().length, records: store().records.length }, STATS); },
    _job: function (t) { return jobOf(t); },
  };
})();
