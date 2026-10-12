/* ============================================================
   systems/convoy.js — CBZ.convoy: ONE DRIVER FOR MILITARY COLUMNS, on any
   map, in both games. Pure logic: no THREE, no DOM. It reaches the world and
   the vehicles only through a HOST (below), so NPC War (src/battle/
   convoyhost.js), Gang City's army (CBZ.army's "move along route" order,
   through moveForce) and node tools all drive columns with this one file.

   THE ROUTE. CBZ.roadGraph.plan: the road graph where the map has roads
   (right-hand lane, junctions, a closed road or bridge never used), the
   terrain planner where it has none (NPC War's dunes: open ground round
   anything steeper than the column's worst climber, round water and walls).

   THE COLUMN (FM 4-01.45 / ATP 4-01.45, convoy operations)
     ORDER OF MARCH  the lead security vehicle (a scout or gun truck) out
                     front, then the armour, then the troop carriers with
                     the protected gun-armed ones interleaved among the soft
                     trucks, and a rear security vehicle (a second scout, else
                     the last armed carrier) at the tail.
     INTERVAL        25-50 m bumper to bumper (each vehicle's own
                     tactics.convoy.gap, clamped), closed up to 25 m in a
                     town, measured along the route.
     SPEED           the column moves at the speed of its slowest vehicle's
                     march speed (tactics.convoy.speed, else 60 % of its top
                     speed), under the posted limit, slowed for bends by the
                     worst cornerer's grip (the MRAP's 0.42 g rollover
                     limit), 70 % of that off the road.
     STRETCH         a vehicle that falls back more than 0.6 of its interval
                     slows the lead; two intervals stops it until the column
                     closes up (the regroup).
     DRIVING         every vehicle steers and throttles through ITS OWN drive
                     model (pure pursuit on the route for steering; the
                     throttle is the speed it wants): wheeled Ackermann with
                     its own wheelbase and lock, tracked pivot-steer. Nothing
                     is slid or set, except far from the camera (LOD, below).

   CONTACT DRILLS
     CONTACT         the column is fired on, or an enemy is inside the kill
                     zone (150 m). Somebody seen further off (out to 600 m) is
                     a SIGHTING: logged, engaged by the gunners on the move,
                     and the column drives on. A fight the column has already
                     driven past is not a new contact.
     REPORT          the first contact is reported (event "contact": where,
                     range, how many, launchers, the drill chosen) and an air
                     support request goes out (event "air"; any system may
                     answer it by returning true from its listener).
     NEAR AMBUSH     inside 150 m with the road ahead open: the column does
                     NOT stop. It speeds up to 85 % of its slowest top speed
                     and drives through while the gunners fire on the move
                     (the MaxxPro keeps its section aboard: the capsule is the
                     safest place there is); a wreck in the lane is driven
                     round where the ground allows; a vehicle disabled in the
                     kill zone drops out and its troops dismount on the side
                     away from the fire. When the tail is 60 m past the ambush
                     and 220 m from it (an RPG's reach) it reports "clear" and
                     carries on to its objective.
     FAR AMBUSH      (fire from beyond 150 m, or a near ambush with no way
                     through): halt, the vehicles turn to face the threat (a
                     tracked hull pivots, a wheeled one creeps out into a
                     herringbone), gunners engage, the carriers' sections get
                     out on the side away from the fire and go to their squads.
                     Fifteen seconds with no fire and nobody inside 350 m and
                     they walk back, board, and the column moves on.
     IED             halt; the carriers' troops dismount and throw a cordon
                     round the blast at 35 m; after thirty seconds the route
                     is re-planned from short of the site round it (a road is
                     closed in the graph, open ground gets a 45 m no-go
                     circle), the troops board and the column moves on. A
                     disabled vehicle is left.
     BLOCKED         a wreck or a wall in the lane ahead: halt and re-route.
     ROAD DESTROYED  CBZ.convoy.roadClosed(x, z, r) (or roadGraph.close):
                     every column whose road ahead used it re-routes.

   MOUNT / DISMOUNT. Riders (spec.riders: [{ man, u }]) walk to their
   carrier's door (tactics.dismount.door: rear, right-rear...), round the
   hull rather than through it, form a file there and climb in one at a time
   (a man every 0.6 s), are seated through the host's own seat contract, ride,
   and get out on order: at the objective, on contact, at an IED. A man who
   has broken or is down is left to his squad; the column waits at most
   150 s at the start and 75 s to remount.

   LOD. Far from the camera (beyond CBZ.battleLod.RULES.CONVOY_R, else 450 m,
   with hysteresis) and out of contact, the column is a set of markers: the
   lead's arc length advances at the column's road speed and every vehicle
   sits its interval behind, placed on the route (host.place). Back inside,
   each vehicle carries on from exactly there at exactly that speed under its
   own drive model. No dice anywhere.

   ORDERS (multiplayer: every change of state is an order, AI and player
   alike): CBZ.convoy.order(cv, { kind: "move", to | route } | "halt" |
   "resume" | "dismount" | "mount" | "reroute").

   THE HOST (the world and the vehicles; a missing optional member means
   "the map has none"):
     pose(u) -> { x, z, h, v }   alive(u)   mobile(u)   def(u)   dims(u) -> { len, wid }
     apply?(u, ctrl, dt)          drive it (a host whose own step reads
                                  CBZ.convoy.control(u) instead leaves this out)
     place(u, x, z, h, v)         LOD, and the opening line-up
     groundAt(x, z)  waterAt?(x, z)  blockedAt?(x, z, r)  roads?()  speedLimit?(x, z) (m/s)  town?(x, z)
     camPos?() -> { x, z }        threats?(cv) -> [{ x, z, unit, launcher }]
     passengers?(u)  dismount?(u, lee | null, why) -> [men]
     manPos?(man) manAlive?(man) walk?(man, x, z, pace) seat?(man, u) -> bool cover?(man, x, z, secs)
     release?(u)  report?(cv, kind, data)  now?()

   PUBLIC  CBZ.convoy = { create(spec), order(cv, o), tick(dt), control(u), hit(u, imp),
     roadClosed(x, z, r), moveForce(force, order), fulfil(force, order), handles(kind),
     on(evt, fn), off(evt, fn), request(kind, data), list(), audit(cv?), roleOf(def),
     cityHost(over), coreOps, DOCTRINE }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});

  const DOCTRINE = {
    GAP_MIN: 25, GAP_MAX: 50, GAP_TOWN: 25,      // m bumper to bumper: open column / close column in a town
    NEAR: 150,                                    // m: inside this an ambush is near (the kill zone)
    ENGAGE_R: 350,                                // m: a halted column stays in the fight while anyone is inside this (or fire comes in)
    CONTACT_R: 600,                               // m: beyond this nobody is the column's business (a sighting inside it is reported)
    CLEAR_M: 60,                                  // m the tail must be past the ambush ...
    CLEAR_R: 220,                                 // ... and this far from it (an RPG's reach) before "clear"
    CLEAR_S: 15,                                  // s with no threat before the troops remount
    CORDON_R: 35, CORDON_S: 30, IED_AVOID: 45,    // m, s, m
    STRETCH: 0.6, REGROUP: 2.0,                   // intervals behind: slow the lead / stop it
    BOARD_S: 150,                                 // s the longest a column waits for its riders at the start
    REMOUNT_S: 75,                                // ... and to remount after a halt
    LOD_R: 450, LOD_HYST: 1.2,
    TOWN_V: 11,                                   // m/s (40 km/h) through a town
    OFFROAD_K: 0.7,                               // of the march speed, off the road
    PUSH_K: 0.85,                                 // of the slowest top speed, through a kill zone
    HB_CREEP: 7,                                  // m a wheeled hull creeps out into the herringbone
  };
  const RG = function () { return CBZ.roadGraph; };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  /* ---------------------------------------------------------------- events */
  const EVT = {};
  function on(e, fn) { (EVT[e] = EVT[e] || []).push(fn); }
  function off(e, fn) { const L = EVT[e]; if (L) { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); } }
  function emit(e, a, b) {
    const L = EVT[e]; let any = false;
    if (L) for (let i = 0; i < L.length; i++) { try { if (L[i](a, b)) any = true; } catch (err) { if (W.console) console.error("[convoy] " + e, err); } }
    return any;
  }
  // AN ORDER OTHER SYSTEMS CAN ANSWER (air support): true when someone took it
  function request(kind, data) { return emit(kind, data); }

  /* ---------------------------------------------------------------- roles */
  function roleOf(def) {
    def = def || {};
    const t = def.tactics || {}, c = t.convoy || {}, S = def.stats || {};
    const r = String(t.role || "").toLowerCase(), slot = String(c.slot || c.place || "").toLowerCase();
    const weapons = def.weapons || [];
    if (/scout|security|gun truck/.test(r) || /lead/.test(slot)) return "scout";
    if (def.drive === "tracked" && weapons.some(function (w) { return w.kind === "cannon" || w.kind === "autocannon"; })) return "armour";
    if ((def.passengers || 0) > 2 || t.carries) return "carrier";
    if (weapons.length) return "escort";
    return "support";
  }
  function protectedArmed(def) {
    const A = (def.stats && def.stats.armour) || {};
    return (def.weapons || []).length > 0 && (A.side || 0) >= 14;
  }
  // FRONT TO BACK: lead security, armour, the body (protected gun-armed
  // carriers interleaved among the soft trucks), escorts, support, the tail
  function marchOrder(recs) {
    const by = { scout: [], armour: [], carrier: [], escort: [], support: [] };
    recs.forEach(function (m) { by[m.role].push(m); });
    const hard = by.carrier.filter(function (m) { return protectedArmed(m.def); });
    const soft = by.carrier.filter(function (m) { return !protectedArmed(m.def); });
    let tail = null;
    if (by.scout.length > 1) tail = by.scout.pop();
    else if (hard.length > 1) tail = hard.pop();
    else if (by.escort.length) tail = by.escort.pop();
    const lead = by.scout.length ? [by.scout.shift()] : [];
    const body = [];
    while (hard.length || soft.length) { if (hard.length) body.push(hard.shift()); if (soft.length) body.push(soft.shift()); if (soft.length) body.push(soft.shift()); }
    const out = lead.concat(by.scout, by.armour, body, by.escort, by.support);
    if (tail) out.push(tail);
    return out;
  }
  function rec(u, H) {
    const def = (H.def ? H.def(u) : u.def) || {};
    const S = def.stats || {}, t = def.tactics || {}, c = t.convoy || {};
    const dims = H.dims ? H.dims(u) : { len: S.length || 6, wid: S.width || 2.5 };
    const top = S.speed || 15;
    const tracked = def.drive === "tracked";
    return {
      u: u, def: def, role: roleOf(def), len: dims.len || 6, wid: dims.wid || 2.5,
      top: top, cruise: c.speed || top * 0.6, accel: S.accel || 2, tracked: tracked,
      wb: S.wheelbase || 3.5, maxSteer: S.maxSteer || 0.5, turn: S.turn || 0.6,
      lat: (S.grip || (tracked ? 0.55 : 0.6)) * 9.8 * 0.6,
      gap: clamp(c.gap || 40, DOCTRINE.GAP_MIN, DOCTRINE.GAP_MAX),
      maxGrade: tracked ? 0.55 : (S.grip && S.grip < 0.5 ? 0.3 : 0.36),
      door: (t.dismount && t.dismount.door) || "rear",
      s: 0, x: 0, z: 0, h: 0, v: 0, state: "col", k: 0,
      ctrl: { throttle: 0, steer: 0, brake: 1, skip: false }, hb: null, faced: false, out: false,
    };
  }

  /* ---------------------------------------------------------------- the route */
  const LIVE = [];
  const BYU = new Map();         // host unit -> { cv, m }
  let SEQ = 0;
  function world(cv) {
    const H = cv.host;
    return { groundAt: H.groundAt, waterAt: H.waterAt, blockedAt: H.blockedAt,
      roads: H.roads ? H.roads() : null, avoid: cv.avoid };
  }
  function planLeg(cv, from, to) {
    const R = RG();
    if (cv.route && !cv.routeUsed) {
      cv.routeUsed = true;
      const pts = [{ x: from.x, z: from.z }].concat(cv.route.map(function (p) { return { x: p.x, z: p.z }; }));
      return { pts: pts, radii: pts.map(function (p, i) { return i === 0 || i === pts.length - 1 ? 0 : 14; }), junctions: [], kind: "route", ok: true };
    }
    const G = cv.host.roads ? R.of(cv.host.roads()) : null;
    return R.plan(world(cv), from, to, {
      maxGrade: cv.maxGrade, r: cv.bodyR, offRoad: 160, radius: 16,
      avoidSeg: G && cv.avoid.length ? function (si, sg) {
        for (let q = 0; q < cv.avoid.length; q++) {
          const A = cv.avoid[q], t = clamp((A.x - sg.ax) * sg.ux + (A.z - sg.az) * sg.uz, 0, sg.len);
          if (hyp(A.x, A.z, sg.ax + sg.ux * t, sg.az + sg.uz * t) < A.r) return true;
        }
        return false;
      } : null,
    });
  }
  // the column's speed profile on a path: the slowest march speed, the
  // posted limit, a town, the bends (worst cornerer), off the road, braking
  function profile(cv, P, kind) {
    const H = cv.host, n = P.n;
    let V = Infinity, lat = Infinity;
    cv.members.forEach(function (m) { if (m.state !== "lost") { V = Math.min(V, m.cruise); lat = Math.min(lat, m.lat); } });
    if (!isFinite(V)) V = 10;
    if (kind === "terrain") V *= DOCTRINE.OFFROAD_K;
    cv.V = V;
    const town = new Uint8Array(n);
    const c = P.caps(V, isFinite(lat) ? lat : 3, 2.0, 1);
    for (let i = 0; i < n; i++) {
      const x = P.x[i], z = P.z[i];
      if (H.speedLimit) { const L = +H.speedLimit(x, z); if (L > 0) c[i] = Math.min(c[i], Math.max(4, L)); }
      if (H.town && H.town(x, z)) { town[i] = 1; c[i] = Math.min(c[i], DOCTRINE.TOWN_V); }
    }
    for (let i = n - 2; i >= 0; i--) c[i] = Math.min(c[i], Math.sqrt(c[i + 1] * c[i + 1] + 2 * 2.0 * (P.s[i + 1] - P.s[i])));
    P.capC = c; P.town = town;
    // the junctions along it, by arc length (the lead tells the host when it reaches one)
    P.jx = (cv.plan && cv.plan.junctions || []).map(function (j) { return { s: RG().projectS(P, j.x, j.z), x: j.x, z: j.z, told: false }; });
  }
  function townAt(P, s) { if (!P.town) return false; const i = RG().segIdx(P, s); return !!P.town[i]; }
  /* RE-PLAN from arc length sPivot of the current path: the stretch of the
     old path the column stands on is kept (nobody jumps), the new route is
     appended from there. */
  function replan(cv, sPivot, why) {
    const R = RG(), P0 = cv.P;
    const col = column(cv);
    let sTail = Infinity;
    col.forEach(function (m) { sTail = Math.min(sTail, m.s); });
    if (!isFinite(sTail)) sTail = 0;
    sTail = Math.max(0, sTail - 8);
    sPivot = clamp(sPivot, sTail + 1, P0.len);
    const sl = R.pathSlice(P0, sTail, sPivot);
    const at = R.pathAt(P0, sPivot);
    const leg = planLeg(cv, { x: at.x, z: at.z }, cv.to);
    const pts = sl.pts.concat(leg.pts.slice(1)), radii = sl.radii.concat(leg.radii.slice(1));
    radii[sl.pts.length - 1] = 12;
    cv.plan = leg;
    const P = R.path(pts, radii, null);
    profile(cv, P, leg.kind);
    // every vehicle re-finds itself: those behind the pivot on the kept stretch
    col.forEach(function (m) { m.s = m.s <= sPivot ? Math.max(0, m.s - sTail) : R.projectS(P, m.x, m.z, sPivot - sTail - 5, sPivot - sTail + 200); m.hb = null; });
    cv.P = P;
    cv.planVer = leg.ver || 0;
    cv.reroutes++;
    log(cv, "reroute", { why: why, plan: leg.kind, ok: leg.ok, len: Math.round(P.len) });
    emit("reroute", cv, { why: why });
  }

  /* ---------------------------------------------------------------- create */
  function create(spec) {
    const H = spec.host;
    if (!H || !RG()) return null;
    const recs = (spec.units || []).filter(function (u) { return u && (!H.alive || H.alive(u)); }).map(function (u) { return rec(u, H); });
    if (!recs.length) return null;
    const cv = {
      id: ++SEQ, side: spec.side || null, host: H, members: marchOrder(recs), to: spec.to ? { x: spec.to.x, z: spec.to.z } : null,
      route: spec.route || null, routeUsed: false, avoid: [], P: null, plan: null, V: 10, phase: "move", phaseT: 0, t: 0,
      manifest: [], lod: "full", lodT: 0, senseT: 0, threats: [], hits: [], T: null, dmin: Infinity, contact: null,
      contacts: 0, clearT: 0, ied: null, dismountAtEnd: spec.dismountAtEnd !== false, reroutes: 0,
      log: [], regroup: false, maxGrade: 0.36, bodyR: 2, planVer: 0, air: null, kz: null, done: false,
    };
    cv.members.forEach(function (m, k) { m.k = k; BYU.set(m.u, { cv: cv, m: m }); const p = H.pose(m.u); m.x = p.x; m.z = p.z; m.h = p.h; m.v = p.v || 0; });
    cv.maxGrade = Math.min.apply(null, cv.members.map(function (m) { return m.maxGrade; }));
    cv.bodyR = Math.max.apply(null, cv.members.map(function (m) { return m.wid * 0.5 + 0.5; }));
    if (!cv.to && cv.route && cv.route.length) cv.to = cv.route[cv.route.length - 1];
    if (!cv.to) return null;
    const lead = cv.members[0];
    // THE OPENING LINE-UP (spec.stage): the column stands on its route at its
    // intervals, the lead at the start point (a spawn, before anything moves)
    let from = spec.from || { x: lead.x, z: lead.z };
    if (spec.stage) {
      let colLen = 0;
      for (let k = 1; k < cv.members.length; k++) colLen += gapC(cv, k, false);
      const dx = cv.to.x - from.x, dz = cv.to.z - from.z, d = Math.hypot(dx, dz) || 1;
      const back = { x: from.x - dx / d * (colLen + 10), z: from.z - dz / d * (colLen + 10) };
      cv.plan = planLeg(cv, back, cv.to);
      cv.P = RG().path(cv.plan.pts, cv.plan.radii, null);
      profile(cv, cv.P, cv.plan.kind);
      let s = Math.min(cv.P.len - 1, colLen + 10);
      cv.members.forEach(function (m, k) {
        if (k > 0) s -= gapC(cv, k, false);
        m.s = Math.max(0, s);
        const q = RG().pathAt(cv.P, m.s);
        if (H.place) H.place(m.u, q.x, q.z, q.h, 0);
        m.x = q.x; m.z = q.z; m.h = q.h; m.v = 0;
      });
    } else {
      cv.plan = planLeg(cv, from, cv.to);
      cv.P = RG().path(cv.plan.pts, cv.plan.radii, null);
      profile(cv, cv.P, cv.plan.kind);
      cv.members.forEach(function (m) { m.s = RG().projectS(cv.P, m.x, m.z); });
    }
    cv.planVer = cv.plan.ver || 0;
    // RIDERS walk to their seats first
    (spec.riders || []).forEach(function (r) { if (r && r.man && BYU.has(r.u)) cv.manifest.push({ man: r.man, u: r.u, seated: false, out: false }); });
    cv.phase = cv.manifest.length ? "board" : "move";
    LIVE.push(cv);
    log(cv, "order", { to: { x: Math.round(cv.to.x), z: Math.round(cv.to.z) }, plan: cv.plan.kind, len: Math.round(cv.P.len), V: +cv.V.toFixed(1),
      march: cv.members.map(function (m) { return m.def.id || m.role; }) });
    emit("order", cv);
    return cv;
  }

  /* ---------------------------------------------------------------- helpers */
  function column(cv) { return cv.members.filter(function (m) { return m.state !== "lost"; }); }
  // the centre-to-centre interval to the vehicle ahead of column member k
  function gapC(cv, k, town) {
    const col = cv.members, m = col[k], a = col[k - 1];
    const g = town ? DOCTRINE.GAP_TOWN : Math.max(m.gap, DOCTRINE.GAP_MIN);
    return g + (m.len + a.len) * 0.5;
  }
  function gapOf(cv, col, k) {
    const m = col[k], a = col[k - 1];
    const g = townAt(cv.P, m.s) ? DOCTRINE.GAP_TOWN : m.gap;
    return g + (m.len + a.len) * 0.5;
  }
  function log(cv, kind, data) {
    const e = { t: +cv.t.toFixed(1), kind: kind };
    if (data) for (const k in data) e[k] = data[k];
    cv.log.push(e);
    if (cv.log.length > 80) cv.log.shift();
    if (cv.host.report) { try { cv.host.report(cv, kind, e); } catch (err) {} }
  }
  function setPhase(cv, p, why) {
    if (cv.phase === p) return;
    log(cv, "phase", { from: cv.phase, to: p, why: why || "" });
    cv.phase = p; cv.phaseT = 0;
    cv.members.forEach(function (m) { m.hb = null; m.faced = false; });
  }
  function doorOf(m) {
    const d = m.door, L = m.len * 0.5, Wd = m.wid * 0.5;
    // hull space: +X is the vehicle's LEFT, +Z its nose (units/vehicles/*)
    if (/right/.test(d)) return { x: -(Wd + 0.9), z: /rear/.test(d) ? -L * 0.35 : 0 };
    if (/left/.test(d)) return { x: Wd + 0.9, z: /rear/.test(d) ? -L * 0.35 : 0 };
    if (/side/.test(d)) return { x: Wd + 0.9, z: 0 };
    return { x: 0, z: -(L + 1.2) };
  }
  function toWorld(m, p) {
    const c = Math.cos(m.h), s = Math.sin(m.h);
    return { x: m.x + p.x * c + p.z * s, z: m.z - p.x * s + p.z * c };
  }
  function stop(m) { m.ctrl.throttle = 0; m.ctrl.brake = 1; m.ctrl.skip = false; }

  /* PURE PURSUIT on the route, through the vehicle's own drive model: the
     steer it would take to put the carrot on its nose, the throttle that is
     the speed it wants (the drive models approach throttle x top speed at
     their own acceleration), the brake when it is going too fast. */
  function pursue(m, P, wantV) {
    const R = RG();
    const v = m.v, Ld = clamp(6 + 0.9 * Math.abs(v), 8, 24);
    const c = R.pathAt(P, m.s + Ld);
    const al = wrap(Math.atan2(c.x - m.x, c.z - m.z) - m.h);
    let st;
    if (m.tracked) {
      if (Math.abs(v) < 1.2 || Math.abs(al) > 0.6) st = clamp(-al * 1.8, -1, 1);
      else {
        const k = 0.55 + 0.45 * Math.min(1, Math.abs(v) / 6), w = v * 2 * Math.sin(al) / Ld;
        st = clamp(-w / (m.turn * k), -1, 1);
      }
      if (Math.abs(al) > 1.1) wantV = 0;           // pivot onto the line first
    } else {
      st = clamp(-Math.atan(2 * Math.sin(al) * m.wb / Ld) / m.maxSteer, -1, 1);
      wantV *= clamp(Math.cos(al), 0.3, 1);
    }
    m.ctrl.steer = st;
    m.ctrl.throttle = clamp(wantV / m.top, 0, 1);
    m.ctrl.brake = v > wantV + 1.0 ? 1 : 0;
    m.ctrl.skip = false;
    m.want = wantV;
  }
  // turn a halted hull to face the threat
  function face(m, T) {
    const b = Math.atan2(T.x - m.x, T.z - m.z), err = wrap(b - m.h);
    m.ctrl.skip = false;
    if (m.tracked) {
      if (Math.abs(err) > 0.12 && m.v < 1.5) { m.ctrl.throttle = 0; m.ctrl.brake = 0; m.ctrl.steer = clamp(-err * 1.6, -1, 1); }
      else { stop(m); m.ctrl.steer = 0; m.faced = Math.abs(err) <= 0.12; }
      return;
    }
    // a wheeled hull cannot pivot: it creeps out at an angle (the herringbone)
    if (!m.hb) m.hb = { x: m.x, z: m.z, done: Math.abs(err) < 0.4 };
    const moved = hyp(m.x, m.z, m.hb.x, m.hb.z);
    if (!m.hb.done && moved < DOCTRINE.HB_CREEP && Math.abs(err) > 0.3) {
      m.ctrl.steer = clamp(-err * 2, -1, 1); m.ctrl.throttle = clamp(3 / m.top, 0, 1); m.ctrl.brake = 0;
    } else { m.hb.done = true; stop(m); m.faced = true; }
  }

  /* ---------------------------------------------------------------- senses */
  function sense(cv) {
    const H = cv.host, col = column(cv);
    const list = H.threats ? (H.threats(cv) || []) : [];
    const now = cv.t;
    for (let i = cv.hits.length - 1; i >= 0; i--) if (now - cv.hits[i].t > 8) cv.hits.splice(i, 1);
    const all = list.concat(cv.hits);
    // T: every threat in reach (what a halted column faces and fights);
    // TF: those the column has not yet driven past (a fight left behind the
    // tail is not a new contact: the gunners keep firing, the column goes on)
    const R = RG(), tail = col[col.length - 1];
    let sx = 0, sz = 0, n = 0, launchers = 0, dmin = Infinity;
    let fx = 0, fz = 0, fn = 0, fl = 0, fmin = Infinity, fired = 0;
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      let d = Infinity;
      for (let k = 0; k < col.length; k++) d = Math.min(d, hyp(t.x, t.z, col[k].x, col[k].z));
      if (d > DOCTRINE.CONTACT_R) continue;
      sx += t.x; sz += t.z; n++;
      if (t.launcher) launchers++;
      dmin = Math.min(dmin, d);
      if (d < 120 || !tail || R.projectS(cv.P, t.x, t.z) > tail.s - 30) { fx += t.x; fz += t.z; fn++; if (t.launcher) fl++; fmin = Math.min(fmin, d); if (t.fired) fired++; }
    }
    cv.threats = all;
    cv.T = n ? { x: sx / n, z: sz / n, n: n, launchers: launchers } : null;
    cv.dmin = dmin;
    cv.TF = fn ? { x: fx / fn, z: fz / fn, n: fn, launchers: fl } : null;
    cv.dminF = fmin;
    /* CONTACT is being fired on, or an enemy inside the kill zone. Somebody
       seen further off is a SIGHTING: reported, engaged by the gunners on
       the move, and the column drives on. */
    cv.CT = cv.TF && (fmin <= DOCTRINE.NEAR || fired > 0) ? cv.TF : null;
    cv.hot = !!(cv.T && (dmin <= DOCTRINE.ENGAGE_R || cv.hits.length > 0));
    if (cv.TF && !cv.CT && cv.t - (cv.sightT || -99) > 20) { cv.sightT = cv.t; log(cv, "sighting", { x: Math.round(cv.TF.x), z: Math.round(cv.TF.z), range: Math.round(fmin), size: fn }); }
  }
  // can the column drive on? the lead is mobile and nothing stands in the lane ahead
  function aheadBlocked(cv) {
    const col = column(cv), lead = col[0], R = RG(), H = cv.host;
    if (!lead) return true;
    for (let q = 1; q <= 3; q++) {
      const p = R.pathAt(cv.P, lead.s + q * 12);
      for (let i = 0; i < cv.members.length; i++) {
        const m = cv.members[i];
        if (m.state === "lost" && hyp(p.x, p.z, m.x, m.z) < m.wid * 0.5 + lead.wid * 0.5 + 0.8) return { x: m.x, z: m.z, r: m.len * 0.5 + 6 };
      }
      if (H.blockedAt && lead.s + q * 12 < cv.P.len && H.blockedAt(p.x, p.z, lead.wid * 0.5)) return { x: p.x, z: p.z, r: 8 };
    }
    return null;
  }

  /* ---------------------------------------------------------------- troops */
  function riders(cv, u) { return cv.manifest.filter(function (r) { return r.u === u; }); }
  function dismount(cv, m, lee, why) {
    const H = cv.host;
    if (!H.dismount) return 0;
    const men = H.dismount(m.u, lee, why) || [];
    men.forEach(function (man) {
      let r = null;
      for (let i = 0; i < cv.manifest.length; i++) if (cv.manifest[i].man === man) { r = cv.manifest[i]; break; }
      if (!r) { r = { man: man, u: m.u, seated: false, out: true }; cv.manifest.push(r); }
      r.seated = false; r.out = true;
    });
    if (men.length) { m.out = true; log(cv, "dismount", { unit: m.def.id || m.role, n: men.length, why: why, lee: lee ? { x: +lee.x.toFixed(2), z: +lee.z.toFixed(2) } : null }); emit("dismount", cv, { m: m, men: men, lee: lee, why: why }); }
    return men.length;
  }
  function leeOf(m, T) {
    if (!T) return null;
    const dx = m.x - T.x, dz = m.z - T.z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }
  /* THE FILE AT THE DOOR. A carrier's riders queue in a file behind (or
     beside) its door, half a metre apart, and climb in one at a time, about
     a man every 0.6 s up a tailgate ladder; the file closes up as each goes.
     Returns where rider j of this carrier stands. */
  function fileSpot(m, j) {
    const d = doorOf(m), back = Math.abs(d.x) > Math.abs(d.z) ? { x: Math.sign(d.x), z: 0 } : { x: 0, z: -1 };
    return toWorld(m, { x: d.x + back.x * j * 0.9 + (back.z ? ((j % 2) - 0.5) * 0.6 : 0), z: d.z + back.z * j * 0.9 + (back.x ? ((j % 2) - 0.5) * 0.6 : 0) });
  }
  /* ROUND THE HULL, NOT THROUGH IT. A man on the far side of his truck from
     its door walks to the corner on his side first (the hull's footprint
     plus a metre), then to the door: a straight line would press him into
     the side of the truck for as long as the column waited. */
  function segBox(ax, az, bx, bz, hx, hz) {
    let t0 = 0, t1 = 1;
    const d = [bx - ax, bz - az], a = [ax, az], lo = [-hx, -hz], hi = [hx, hz];
    for (let k = 0; k < 2; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (a[k] < lo[k] || a[k] > hi[k]) return false; continue; }
      let u = (lo[k] - a[k]) / d[k], v = (hi[k] - a[k]) / d[k];
      if (u > v) { const t = u; u = v; v = t; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) return false;
    }
    return true;
  }
  function roundHull(m, p, q) {
    const c = Math.cos(m.h), s = Math.sin(m.h);
    const lx = function (x, z) { return (x - m.x) * c - (z - m.z) * s; }, lz = function (x, z) { return (x - m.x) * s + (z - m.z) * c; };
    const px = lx(p.x, p.z), pz = lz(p.x, p.z), qx = lx(q.x, q.z), qz = lz(q.x, q.z);
    const hx = m.wid * 0.5 + 0.5, hz = m.len * 0.5 + 0.5;
    if (!segBox(px, pz, qx, qz, hx, hz)) return q;
    const cx = m.wid * 0.5 + 1.3, cz = m.len * 0.5 + 1.3;
    const C = [{ x: -cx, z: -cz }, { x: cx, z: -cz }, { x: cx, z: cz }, { x: -cx, z: cz }];
    const clear = function (a, b) { return !segBox(a.x, a.z, b.x, b.z, hx, hz); };
    const P0 = { x: px, z: pz }, Q = { x: qx, z: qz };
    let best = null, bd = Infinity;
    // one corner, or two along a side (the four corners and their sides are clear of the hull)
    for (let i = 0; i < 4; i++) {
      const c1 = C[i];
      if (!clear(P0, c1)) continue;
      const d1 = Math.hypot(c1.x - px, c1.z - pz);
      if (clear(c1, Q)) { const d = d1 + Math.hypot(qx - c1.x, qz - c1.z); if (d < bd) { bd = d; best = c1; } }
      for (let k = 1; k <= 3; k += 2) {
        const c2 = C[(i + k) % 4];
        if (!clear(c2, Q)) continue;
        const d = d1 + Math.hypot(c2.x - c1.x, c2.z - c1.z) + Math.hypot(qx - c2.x, qz - c2.z);
        if (d < bd) { bd = d; best = c1; }
      }
    }
    // standing on the corner already: the next one along
    if (best && Math.hypot(best.x - px, best.z - pz) < 1.0) {
      let nb = null, nd = Infinity;
      for (let i = 0; i < 4; i++) { const c = C[i]; if (c === best || !clear(P0, c)) continue; const d = Math.hypot(c.x - px, c.z - pz) + Math.hypot(qx - c.x, qz - c.z); if (d < nd) { nd = d; nb = c; } }
      if (nb) best = nb;
    }
    if (!best) { best = { x: px >= 0 ? cx : -cx, z: pz }; }  // flush against a side: step out along it
    return toWorld(m, best);
  }
  // riders walk to their carrier's door and are seated there; true when all aboard
  function board(cv, dt) {
    const H = cv.host;
    let left = 0;
    const line = new Map();          // carrier -> riders still in its file
    cv.members.forEach(function (m) { m.boardT = (m.boardT || 0) - dt; });
    for (let i = 0; i < cv.manifest.length; i++) {
      const r = cv.manifest[i];
      if (r.seated) continue;
      if (H.manAlive && !H.manAlive(r.man)) { r.seated = true; r.dead = true; continue; }
      // a man who has broken, is down, or is fighting it out far off is left
      // to his squad: the column does not wait on him
      if (H.manFit && !H.manFit(r.man)) { r.seated = true; r.left = true; if (H.releaseMan) H.releaseMan(r.man); continue; }
      const e = BYU.get(r.u);
      let m = e && e.m;
      if (!m || m.state === "lost") {
        // his carrier is gone: the nearest carrier with room takes him
        m = null;
        const col = column(cv);
        for (let k = 0; k < col.length && !m; k++) if (H.freeSeats && H.freeSeats(col[k].u) > 0) m = col[k];
        if (!m) { r.seated = true; r.left = true; if (H.releaseMan) H.releaseMan(r.man); continue; }
        r.u = m.u;
      }
      left++;
      (line.get(m) || line.set(m, []).get(m)).push(r);
    }
    line.forEach(function (rs, m) {
      const door = toWorld(m, doorOf(m));
      // nearest the door first: that is the order the file forms in
      rs.forEach(function (r) { const p = H.manPos ? H.manPos(r.man) : door; r.dd = hyp(p.x, p.z, door.x, door.z); });
      rs.sort(function (a, b) { return a.dd - b.dd; });
      for (let j = 0; j < rs.length; j++) {
        const r = rs[j];
        if (j === 0 && r.dd < 1.8 && m.v < 1 && m.boardT <= 0) {
          if (H.seat && H.seat(r.man, m.u)) { r.seated = true; r.out = false; left--; m.boardT = 0.6; continue; }
        }
        const q = fileSpot(m, j), p = H.manPos ? H.manPos(r.man) : q, w = roundHull(m, p, q);
        // the last few metres at a walk, the rest at a jog
        if (H.walk) H.walk(r.man, w.x, w.z, r.dd > 12 || w !== q ? 3.6 : 1.6);
      }
    });
    return left === 0;
  }

  /* ---------------------------------------------------------------- the drills */
  function contactBegins(cv) {
    const T = cv.TF || cv.T, dmin = cv.TF ? cv.dminF : cv.dmin, near = dmin <= DOCTRINE.NEAR;
    const blocked = aheadBlocked(cv);
    const drill = near && !blocked && cv.phase !== "board" ? "push" : "react";
    cv.contacts++;
    cv.contact = { t: +cv.t.toFixed(1), x: Math.round(T.x), z: Math.round(T.z), range: Math.round(dmin), size: T.n, launchers: T.launchers, near: near, drill: drill };
    log(cv, "contact", cv.contact);
    emit("contact", cv, cv.contact);
    // CAS: an order other systems answer
    if (!cv.air) cv.air = { asked: cv.t, answered: request("air", { convoy: cv.id, side: cv.side, at: { x: T.x, z: T.z }, kind: "cas", range: dmin }) };
    // every rider on his feet (walking to board, in a cordon) drops the walk
    // and fights where he stands: the squads have him
    cv.manifest.forEach(function (r) { if (!r.seated) { r.out = true; if (cv.host.releaseMan) cv.host.releaseMan(r.man); } });
    if (drill === "push") {
      const R = RG();
      const lead = column(cv)[0];
      cv.kz = { sT: R.projectS(cv.P, T.x, T.z, Math.max(0, lead.s - 300), lead.s + 300), x: T.x, z: T.z };
      setPhase(cv, "push", "near ambush");
    } else setPhase(cv, "react", near ? "near ambush, the road ahead blocked" : "far ambush");
  }
  function iedBegins(cv, x, z, m) {
    cv.ied = { x: x, z: z, t: cv.t, unit: m ? (m.def.id || m.role) : null };
    log(cv, "ied", { x: Math.round(x), z: Math.round(z), unit: cv.ied.unit });
    emit("ied", cv, cv.ied);
    request("air", { convoy: cv.id, side: cv.side, at: { x: x, z: z }, kind: "isr" });
    setPhase(cv, "ied", "IED");
  }

  /* ---------------------------------------------------------------- the step */
  function stepCv(cv, dt) {
    const H = cv.host, R = RG();
    cv.t += dt; cv.phaseT += dt;
    // who is still in the column
    for (let i = 0; i < cv.members.length; i++) {
      const m = cv.members[i];
      if (m.state === "lost") continue;
      const alive = !H.alive || H.alive(m.u), mobile = alive && (!H.mobile || H.mobile(m.u));
      if (!mobile) {
        m.state = "lost";
        const p = H.pose(m.u); m.x = p.x; m.z = p.z; m.h = p.h;
        log(cv, alive ? "disabled" : "destroyed", { unit: m.def.id || m.role });
        // its troops get out on the side away from the fire
        if (alive) dismount(cv, m, leeOf(m, cv.T), "disabled");
      }
    }
    const col = column(cv);
    if (!col.length) { finish(cv, "destroyed"); return; }
    // where every vehicle is, on the route
    for (let k = 0; k < col.length; k++) {
      const m = col[k], p = H.pose(m.u);
      m.x = p.x; m.z = p.z; m.h = p.h; m.v = p.v || 0;
      if (cv.lod === "full") m.s = R.projectS(cv.P, m.x, m.z, Math.max(0, m.s - 20), m.s + 40);
    }
    // a road the column will use was closed (a bridge blown, a crater): re-route
    if (cv.plan && cv.plan.G && cv.plan.G.ver !== cv.planVer && cv.plan.segs) {
      cv.planVer = cv.plan.G.ver;
      let hit = false;
      cv.plan.segs.forEach(function (si) { if (cv.plan.G.closed.has(si)) hit = true; });
      if (hit && cv.phase !== "done") replan(cv, col[0].s, "road closed");
    }
    // the senses, twice a second
    cv.senseT -= dt;
    if (cv.senseT <= 0) { cv.senseT = 0.4; sense(cv); }
    lod(cv, dt, col);
    const T = cv.T;
    switch (cv.phase) {
      case "board": {
        col.forEach(stop);
        const done = board(cv, dt);
        if (cv.CT) { contactBegins(cv); break; }
        if (done || cv.phaseT > DOCTRINE.BOARD_S) { log(cv, "mounted", { aboard: cv.manifest.filter(function (r) { return r.seated && !r.dead && !r.left; }).length }); emit("mounted", cv); setPhase(cv, "move", "mounted"); }
        break;
      }
      case "move": {
        if (cv.CT) { contactBegins(cv); break; }
        const blk = aheadBlocked(cv);
        if (blk) { cv.avoid.push(blk); setPhase(cv, "blocked", "the lane ahead"); break; }
        if (march(cv, col, dt, false)) arrive(cv, col);
        break;
      }
      case "push": {
        // THROUGH THE KILL ZONE: no stopping, no regroup halt
        // a wreck in the lane: round it if the ground allows (off the road, or
        // the road graph has another way), else stop and fight it out
        const blk = aheadBlocked(cv);
        if (blk) {
          cv.avoid.push(blk);
          const before = cv.P;
          replan(cv, col[0].s, "bypass");
          if (!cv.plan.ok) { cv.P = before; setPhase(cv, "react", "the road through the kill zone is blocked"); break; }
        }
        // a new ambush further down the road moves the kill zone on
        if (cv.TF && cv.dminF <= DOCTRINE.NEAR && cv.kz) {
          const sN = R.projectS(cv.P, cv.TF.x, cv.TF.z, col[0].s - 60, col[0].s + 300);
          if (sN > cv.kz.sT + 80) { cv.kz.sT = sN; cv.kz.x = cv.TF.x; cv.kz.z = cv.TF.z; }
        }
        march(cv, col, dt, true);
        // CLEAR: the tail is past the ambush and out of its weapons' reach
        const K = cv.kz, tail = col[col.length - 1];
        const clear = tail.s > K.sT + DOCTRINE.CLEAR_M && hyp(tail.x, tail.z, K.x, K.z) > DOCTRINE.CLEAR_R;
        if (clear || col[0].s >= cv.P.len - 3) {
          log(cv, "clear", { lost: cv.members.length - col.length });
          emit("clear", cv);
          setPhase(cv, "move", "through the kill zone");
        }
        break;
      }
      case "react": {
        // HALT, FACE, ENGAGE, DISMOUNT AWAY FROM THE FIRE
        const at = T || cv.contact;
        for (let k = 0; k < col.length; k++) {
          const m = col[k];
          if (m.v > 0.6 && !m.hb) { stop(m); continue; }
          if (at) face(m, at); else stop(m);
          if (m.v < 0.6 && !m.out && (!H.passengers || H.passengers(m.u) > 0)) dismount(cv, m, leeOf(m, at), "contact");
        }
        // CLEAR: no fire on the column and nobody inside small-arms range
        if (cv.hot) cv.clearT = 0; else cv.clearT += dt;
        if (cv.clearT > DOCTRINE.CLEAR_S) { log(cv, "clear", { lost: cv.members.length - col.length }); emit("clear", cv); setPhase(cv, "remount", "no fire for " + DOCTRINE.CLEAR_S + " s"); }
        break;
      }
      case "ied": {
        col.forEach(stop);
        const I = cv.ied;
        // the cordon: once halted, the carriers put their troops out round the site
        if (!I.cordon && col.every(function (m) { return m.v < 0.6; })) {
          I.cordon = true;
          const out = [];
          col.forEach(function (m) { if (!H.passengers || H.passengers(m.u) > 0) { const n = dismount(cv, m, leeOf(m, I), "IED"); if (n) out.push(m); } });
          const men = cv.manifest.filter(function (r) { return r.out && (!H.manAlive || H.manAlive(r.man)); });
          men.forEach(function (r, i) {
            const a = (i / Math.max(1, men.length)) * Math.PI * 2;
            if (H.cover) H.cover(r.man, I.x + Math.sin(a) * DOCTRINE.CORDON_R, I.z + Math.cos(a) * DOCTRINE.CORDON_R, DOCTRINE.CORDON_S);
          });
          log(cv, "cordon", { r: DOCTRINE.CORDON_R, men: men.length });
        }
        if (cv.CT) { contactBegins(cv); break; }
        if (cv.phaseT > DOCTRINE.CORDON_S) {
          cv.avoid.push({ x: I.x, z: I.z, r: DOCTRINE.IED_AVOID });
          if (cv.plan && cv.plan.G) R.close(cv.plan.G, I.x, I.z, 15);
          // re-plan from behind the site: the column stands short of it
          let sPivot = col[0].s;
          const sI = R.projectS(cv.P, I.x, I.z);
          if (sI <= col[0].s + 5) sPivot = Math.max(col[col.length - 1].s, sI - DOCTRINE.IED_AVOID - 15);
          cv.planVer = cv.plan && cv.plan.G ? cv.plan.G.ver : 0;
          replan(cv, sPivot, "IED");
          setPhase(cv, "remount", "cordon lifted");
        }
        break;
      }
      case "blocked": {
        col.forEach(stop);
        if (cv.CT) { contactBegins(cv); break; }
        if (cv.phaseT > 2.5 && col[0].v < 0.6) { replan(cv, col[0].s, "blocked"); setPhase(cv, "move", "re-routed"); }
        break;
      }
      case "remount": {
        col.forEach(stop);
        if (cv.CT) { contactBegins(cv); break; }
        const done = board(cv, dt);
        if (done || cv.phaseT > DOCTRINE.REMOUNT_S) { col.forEach(function (m) { m.out = false; }); log(cv, "mounted", { aboard: cv.manifest.filter(function (r) { return r.seated && !r.dead && !r.left; }).length }); emit("mounted", cv); setPhase(cv, "move", "mounted"); }
        break;
      }
      case "arrived": {
        col.forEach(stop);
        if (cv.phaseT > 1.5 && col.every(function (m) { return m.v < 0.5; })) {
          if (cv.dismountAtEnd) col.forEach(function (m) { if (!m.out) dismount(cv, m, leeOf(m, cv.T), "objective"); });
          finish(cv, "arrived");
        }
        break;
      }
    }
    // a host with no step of its own: drive it here
    if (H.apply && cv.lod === "full") for (let k = 0; k < col.length; k++) H.apply(col[k].u, col[k].ctrl, dt);
    // the lost: brakes on, whoever drives them
    cv.members.forEach(function (m) { if (m.state === "lost") stop(m); });
  }
  /* THE MARCH. The lead holds the column's speed on its profile, slowed when
     the column stretches; everyone else holds its interval to the vehicle
     ahead. `push` drives the kill zone: the slowest top speed, no regroup. */
  function march(cv, col, dt, push) {
    const R = RG(), P = cv.P, lead = col[0];
    // how stretched is it?
    let stretch = 0, worstGap = 40;
    for (let k = 1; k < col.length; k++) {
      const gc = gapOf(cv, col, k), e = (col[k - 1].s - col[k].s) - gc;
      if (e > stretch) { stretch = e; worstGap = gc; }
      col[k].e = e; col[k].gc = gc;
    }
    let f = 1;
    if (!push && stretch > DOCTRINE.STRETCH * worstGap) f = clamp(1 - (stretch - DOCTRINE.STRETCH * worstGap) / ((DOCTRINE.REGROUP - DOCTRINE.STRETCH) * worstGap), 0, 1);
    if (f < 1 && !cv.regroup) log(cv, "regroup", { stretch: Math.round(stretch) });
    cv.regroup = f < 1;
    let Vp = Infinity;
    if (push) for (let k = 0; k < col.length; k++) Vp = Math.min(Vp, col[k].top * DOCTRINE.PUSH_K);
    const endS = P.len;
    // the lead
    let want = push ? Math.min(Vp, R.capAt(P, lead.s, P.capC) * 1.6) : R.capAt(P, lead.s, P.capC) * f;
    want = Math.min(want, Math.sqrt(2 * 1.8 * Math.max(0, endS - 1.5 - lead.s)));
    pursue(lead, P, want);
    // junctions the lead reaches (the host may hold cross traffic)
    if (P.jx) for (let i = 0; i < P.jx.length; i++) { const j = P.jx[i]; if (!j.told && lead.s > j.s - 30) { j.told = true; if (cv.host.junction) cv.host.junction(cv, j); } }
    for (let k = 1; k < col.length; k++) {
      const m = col[k], a = col[k - 1];
      let w = (push ? Math.min(Vp, R.capAt(P, m.s, P.capC) * 1.6) : R.capAt(P, m.s, P.capC)) + 0.35 * m.e;
      if (m.e < -0.35 * m.gc) w = Math.min(w, a.v * 0.7);
      if (m.e < -0.6 * m.gc) w = 0;
      // stop behind the vehicle ahead at the end
      w = Math.min(w, Math.sqrt(2 * 1.8 * Math.max(0, a.s - m.gc - m.s)) + Math.max(0, a.v * 0.8));
      w = clamp(w, 0, m.top * 0.95);
      pursue(m, P, w);
    }
    return lead.s >= endS - 3 && lead.v < 0.5;
  }
  function arrive(cv, col) { setPhase(cv, "arrived", "objective"); emit("arrived", cv); }
  function finish(cv, why) {
    if (cv.done) return;
    cv.done = true; cv.phase = "done";
    log(cv, "done", { why: why });
    cv.members.forEach(function (m) { BYU.delete(m.u); if (cv.lod === "marker" && cv.host.marker) cv.host.marker(m.u, false); if (cv.host.release) cv.host.release(m.u); });
    cv.manifest.forEach(function (r) { if (cv.host.releaseMan && !r.seated) cv.host.releaseMan(r.man); });
    const i = LIVE.indexOf(cv); if (i >= 0) LIVE.splice(i, 1);
    emit("done", cv, why);
  }

  /* ---------------------------------------------------------------- LOD */
  function lodR() { const L = CBZ.battleLod; return (L && L.RULES && L.RULES.CONVOY_R) || DOCTRINE.LOD_R; }
  function lod(cv, dt, col) {
    const H = cv.host, R = RG();
    cv.lodT -= dt;
    if (cv.lodT <= 0 && H.camPos) {
      cv.lodT = 0.5;
      const c = H.camPos();
      if (c) {
        let dc = Infinity;
        for (let k = 0; k < col.length; k++) dc = Math.min(dc, hyp(c.x, c.z, col[k].x, col[k].z));
        const calm = cv.phase === "move" && !cv.T && !cv.regroup;
        if (cv.lod === "full" && calm && dc > lodR() * DOCTRINE.LOD_HYST) {
          cv.lod = "marker"; cv.markV = col[0].v;
          col.forEach(function (m) { if (H.marker) H.marker(m.u, true); });
          log(cv, "lod", { to: "marker", cam: Math.round(dc) });
        } else if (cv.lod === "marker" && (!calm || dc < lodR())) {
          cv.lod = "full";
          col.forEach(function (m) { if (H.marker) H.marker(m.u, false); m.ctrl.skip = false; });
          log(cv, "lod", { to: "full", cam: Math.round(dc) });
        }
      }
    }
    if (cv.lod !== "marker") return;
    // MARKERS: the lead advances on the column's road speed; everyone sits
    // its interval behind; every vehicle stands on the route
    const P = cv.P, lead = col[0];
    const want = Math.min(R.capAt(P, lead.s, P.capC), Math.sqrt(2 * 1.8 * Math.max(0, P.len - 1.5 - lead.s)));
    const a = lead.accel || 1.5;
    cv.markV += clamp(want - cv.markV, -a * 2 * dt, a * dt);
    lead.s = Math.min(P.len, lead.s + Math.max(0, cv.markV) * dt);
    for (let k = 1; k < col.length; k++) col[k].s = Math.max(0, col[k - 1].s - gapOf(cv, col, k));
    for (let k = 0; k < col.length; k++) {
      const m = col[k], q = R.pathAt(P, m.s);
      m.x = q.x; m.z = q.z; m.h = q.h; m.v = cv.markV;
      if (H.place) H.place(m.u, q.x, q.z, q.h, cv.markV);
      m.ctrl.skip = true;
    }
    if (lead.s >= P.len - 3) { cv.lod = "full"; col.forEach(function (m) { if (H.marker) H.marker(m.u, false); m.ctrl.skip = false; }); }
  }

  /* ---------------------------------------------------------------- the public face */
  function tick(dt) {
    if (!LIVE.length || !(dt > 0)) return;
    for (let i = LIVE.length - 1; i >= 0; i--) { const cv = LIVE[i]; if (cv && !cv.done) stepCv(cv, dt); }
  }
  function control(u) { const e = BYU.get(u); return e ? e.m.ctrl : null; }
  function member(u) { return BYU.get(u) || null; }
  function hit(u, imp) {
    const e = BYU.get(u); if (!e) return;
    const cv = e.cv, m = e.m;
    imp = imp || {};
    if (imp.cause === "ied" || imp.cause === "mine") {
      if (cv.phase !== "ied") iedBegins(cv, imp.fromX != null ? imp.fromX : m.x, imp.fromZ != null ? imp.fromZ : m.z, m);
      return;
    }
    const by = imp.by;
    let x = null, z = null;
    if (by && by.pos) { x = by.pos.x; z = by.pos.z; } else if (imp.fromX != null) { x = imp.fromX; z = imp.fromZ; }
    if (x == null) return;
    cv.hits.push({ x: x, z: z, t: cv.t, unit: by || null, launcher: !!(by && by.launcher), fired: true });
    if (cv.phase === "move" || cv.phase === "board") { cv.senseT = 0; sense(cv); if (cv.CT) contactBegins(cv); }
  }
  function order(cv, o) {
    if (!cv || cv.done || !o) return false;
    const col = column(cv);
    switch (o.kind) {
      case "move": case "move along route":
        if (o.to) cv.to = { x: o.to.x, z: o.to.z };
        if (o.route) { cv.route = o.route; cv.routeUsed = false; cv.to = o.route[o.route.length - 1]; }
        replan(cv, col[0].s, "order"); setPhase(cv, "move", "order"); return true;
      case "halt": setPhase(cv, "blocked", "order"); cv.phaseT = -1e9; return true;
      case "resume": setPhase(cv, "move", "order"); return true;
      case "dismount": col.forEach(function (m) { dismount(cv, m, leeOf(m, cv.T), "order"); }); return true;
      case "mount": setPhase(cv, "remount", "order"); return true;
      case "reroute": replan(cv, col[0].s, "order"); return true;
    }
    return false;
  }
  function roadClosed(x, z, r) {
    let n = 0;
    LIVE.forEach(function (cv) {
      if (cv.plan && cv.plan.G) { n += RG().close(cv.plan.G, x, z, r || 15); }
      else {
        // open ground: a crater or a blown culvert on the route is a no-go circle
        const s = RG().projectS(cv.P, x, z), q = RG().pathAt(cv.P, s), col = column(cv);
        if (col.length && hyp(q.x, q.z, x, z) < (r || 15) + 6 && s > col[0].s) { cv.avoid.push({ x: x, z: z, r: (r || 15) + 10 }); replan(cv, col[0].s, "road destroyed"); n++; }
      }
    });
    return n;
  }
  function audit(cv) {
    if (!cv) return LIVE.map(function (c) { return audit(c); });
    const col = column(cv);
    return {
      id: cv.id, side: cv.side, phase: cv.phase, lod: cv.lod, V: +cv.V.toFixed(1), len: cv.P ? Math.round(cv.P.len) : 0, kind: cv.plan ? cv.plan.kind : null,
      march: cv.members.map(function (m) { return { id: m.def.id || null, role: m.role, s: Math.round(m.s), v: +m.v.toFixed(1), state: m.state }; }),
      gaps: col.slice(1).map(function (m, k) { return Math.round(col[k].s - m.s - (m.len + col[k].len) / 2); }),
      contact: cv.contact, contacts: cv.contacts, reroutes: cv.reroutes, regroup: cv.regroup,
      riders: cv.manifest.length, aboard: cv.manifest.filter(function (r) { return r.seated && !r.dead && !r.left; }).length,
      log: cv.log.slice(-30),
    };
  }

  /* ---------------------------------------------------------------- THE ARMY SEAM
     CBZ.army.orderForce(force, { kind: "move along route", to | route }) hands
     a force with vehicles here. force = { side, units: [vehicle units],
     riders?: [{ man, u }], host? }. A unit is a battle-core vehicle (def,
     pos, h, ds; units/kit/vehicle.js's drive) unless the force brings its own
     host. Returns the convoy (or null: nothing here can drive). */
  function moveForce(force, o) {
    if (!force || !o) return null;
    const units = force.units || force.vehicles || [];
    if (!units.length) return null;
    return create({
      side: force.side || null, units: units, riders: force.riders || null,
      host: force.host || o.host || cityHost(),
      to: o.to || null, route: o.route || null, stage: !!o.stage, dismountAtEnd: o.dismount !== false,
    });
  }
  const HANDLES = { "move along route": moveForce, "convoy": moveForce };
  function handles(kind) { return !!HANDLES[kind]; }
  function fulfil(force, o) { const f = o && HANDLES[o.kind]; return f ? f(force, o) : null; }

  /* THE CORE VEHICLE, driven here (Gang City's army; node tools): a unit with
     def, pos {x,y,z}, h, ds (units/kit/vehicle.js's state), optional group. */
  const coreOps = {
    def: function (u) { return u.def; },
    dims: function (u) { const S = (u.def && u.def.stats) || {}; return { len: u.vlen ? u.vlen * 2 : S.length || 6, wid: u.vwid ? u.vwid * 2 : S.width || 2.5 }; },
    pose: function (u) { return { x: u.pos.x, z: u.pos.z, h: u.h || 0, v: u.ds ? u.ds.v || 0 : 0 }; },
    alive: function (u) { return !u.dead; },
    mobile: function (u) { return !u.dead && !(u.vs && u.vs.mobility); },
    apply: function (u, ctrl, dt) {
      const D = CBZ.vehicleDrive; if (!D || ctrl.skip) return;
      const S = (u.def && u.def.stats) || {};
      u.ds = u.ds || { v: 0, w: 0, steer: 0 };
      const spec = { speed: S.speed, reverse: S.reverse, accel: S.accel, turn: S.turn, width: S.width, wheelbase: S.wheelbase,
        maxSteer: S.maxSteer, grip: S.grip, mobilityKill: !!(u.vs && u.vs.mobility) };
      if (u.def && u.def.drive === "tracked") D.tracked(u.ds, spec, ctrl, dt); else D.wheeled(u.ds, spec, ctrl, dt);
      u.h = D.wrap((u.h || 0) + u.ds.w * dt);
      u.pos.x += Math.sin(u.h) * u.ds.v * dt; u.pos.z += Math.cos(u.h) * u.ds.v * dt;
      if (this.collide) this.collide(u);
      if (this.groundAt) { D.pose(u.ds, this.groundAt, u.pos.x, u.pos.z, u.h, S.length || 6, S.width || 2.5, dt); u.pos.y = u.ds.y; }
      if (u.group) { u.group.position.set(u.pos.x, u.pos.y || 0, u.pos.z); u.group.rotation.set(-(u.ds.pitch || 0), u.h, -(u.ds.roll || 0)); }
    },
    place: function (u, x, z, h, v) {
      u.pos.x = x; u.pos.z = z; u.h = h;
      u.ds = u.ds || {}; u.ds.v = v || 0; u.ds.w = 0; u.ds.steer = 0;
      if (this.groundAt) u.pos.y = this.groundAt(x, z);
      if (u.group) { u.group.position.set(u.pos.x, u.pos.y || 0, u.pos.z); u.group.rotation.y = h; }
    },
  };
  // Gang City's world, read through its own names (every one guarded)
  function cityHost(over) {
    const H = Object.assign({}, coreOps, {
      groundAt: function (x, z) {
        try { if (CBZ.cityCarGroundY) { const y = +CBZ.cityCarGroundY(x, z); if (isFinite(y)) return y; } } catch (e) {}
        try { return CBZ.floorAt ? (+CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; }
      },
      waterAt: function (x, z) { try { return CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : false; } catch (e) { return false; } },
      roads: function () { const c = CBZ.city; return c ? ((c.arena && c.arena.roads) || c.roads || null) : null; },
      speedLimit: function (x, z) { try { return CBZ.roadSpeedLimit ? CBZ.roadSpeedLimit(x, z) * 0.44704 : 0; } catch (e) { return 0; } },
      town: function (x, z) {
        try { const r = CBZ.roadSegmentAt ? CBZ.roadSegmentAt(x, z, 3) : null; return !!(r && r.district && r.district !== "highway" && r.district !== "freeway" && !r.frontier); } catch (e) { return false; }
      },
      camPos: function () { const c = CBZ.camera; return c && c.position ? c.position : null; },
      collide: function (u) { try { if (CBZ.collide) CBZ.collide(u.pos, Math.max(1.2, ((u.def && u.def.stats && u.def.stats.width) || 2.5) * 0.5)); } catch (e) {} },
    });
    return Object.assign(H, over || {});
  }

  CBZ.convoy = {
    create: create, order: order, tick: tick, control: control, member: member, hit: hit, roadClosed: roadClosed,
    moveForce: moveForce, fulfil: fulfil, handles: handles, on: on, off: off, request: request,
    list: function () { return LIVE.slice(); }, audit: audit, roleOf: roleOf, marchOrder: marchOrder,
    cityHost: cityHost, coreOps: coreOps, DOCTRINE: DOCTRINE, ORDER: "move along route",
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.convoy;
})();
