/* tools/probes/president.mjs — THE PRESIDENT PLAYS. One boot, every organ.

   Boots the real title-card President run (seed 260811 unless --seed), then
   asks each organ of the mode the one question a player asks of it, in the
   order a player meets them:
     presidency.js   status()/site()/events — the spine every other organ reads
     president_hud   is the strip on screen while I hold the seat
     president_agenda after a new day, did the Chief of Staff hand me work
     motorcade       is the car in the court; does go() seat me in the back,
                     drive me there, and let me out the rear door
     presidency.js   arm an attack: does it come to MY gate as bodies
     president_regime declare a dictatorship: does the house change
     interior_programs the audited rooms did not regress
   Every organ is feature-detected: an organ that is not loaded SKIPS (so the
   gate is useful while the wave is half built) — but an organ that IS loaded
   and answers wrong FAILS. Page errors from any president file fail the run.

   Days are advanced through polity's own wrap hook (_checkDayWrap), never by
   waiting 150 real seconds. Sim time runs through CBZ.stepSim(1/60).

   testbus:  node tools/testbus/submit.mjs --probe "tools/probes/president.mjs --quick"
   alone:    node tools/president-check.mjs [--seed N] [--quick] [--motorcade]
   The world (title card -> President -> Play -> the Mansion built) is booted
   by tools/testbus/worlds.mjs. It drives the motorcade away and arms attacks,
   so it runs LAST on a shared world (fresh:false, dirties:true). */
export const meta = { world: "president", seed: 260811, fresh: false, dirties: true, timeoutMs: 40 * 60e3 };

export default async function (t) {
  const QUICK = t.flag("--quick");
  const ONLY_MC = t.flag("--motorcade");   // boot + spine + the ride only
  // a function body, evaluated in the page; a throw comes back as { __err } (a
  // timeout throws, and the bus reports the probe as an ERROR)
  const evl = (body, ms = 120000) => t.fn(body, ms);
  // settle: the origin swears in, lazy builders (room, staff, car) get frames
  await evl("for (var k=0;k<240;k++) CBZ.stepSim(1/60); return true;");
  t.log(`President run booted (seed ${t.seed}).`);
  // per-updater wall-time profile: every updater/always fn is timed (lazily, so
  // late registrations are covered). profTop() names the slowest organs.
  await evl(`
    if (window.__prof) return true;
    var PR = window.__prof = {}, raw = CBZ.stepSim;
    function wrap(list, tag) { for (var i = 0; i < list.length; i++) { var u = list[i]; if (u.__w) continue;
      (function (u, key) { var f = u.fn; u.fn = function (dt) { var t = performance.now(); try { return f(dt); } finally {
        var d = performance.now() - t, r = PR[key] || (PR[key] = { n: 0, tot: 0, max: 0 }); r.n++; r.tot += d; if (d > r.max) r.max = d; } }; u.__w = true;
      })(u, tag + ":" + u.order + ":" + (u.fn.name || "anon") + (u.source ? "@" + u.source : "")); } }
    CBZ.stepSim = function (dt) { wrap(CBZ.updaters, "u"); wrap(CBZ.always, "a"); return raw(dt); };
    return true;`);
  const profTop = async (reset) => evl(`var PR = window.__prof || {}, L = Object.keys(PR).map(function (k) { var r = PR[k]; return k + " max " + Math.round(r.max) + " avg " + (r.tot / r.n).toFixed(1); });
    L.sort(function (a, b) { return +b.split(" max ")[1].split(" ")[0] - +a.split(" max ")[1].split(" ")[0]; });
    ${reset ? "window.__prof && Object.keys(window.__prof).forEach(function (k) { delete window.__prof[k]; });" : ""}
    return L.slice(0, 6);`, 30000, "profTop");

  const results = [];
  function check(name, ok, detail) { results.push(ok); t.log((ok ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
  function skip(name, why) { t.log("  --  " + name + "  (skipped: " + why + ")"); }
  const tick = (n) => evl(`for (var k=0;k<${n};k++) CBZ.stepSim(1/60); return true;`);
  const newDay = () => evl("CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05); for (var k=0;k<120;k++) CBZ.stepSim(1/60); return CBZ.worldDay();");

  // ---- 1. the spine ----------------------------------------------------------
  const st = await evl("if (!CBZ.presidency || !CBZ.presidency.status) return null; return CBZ.presidency.status();");
  if (!st) skip("presidency.status()", "not exported yet");
  else {
    check("status(): the player holds the country", st.seat === true && st.began === true, JSON.stringify({ seat: st.seat, began: st.began, title: st.title }));
    check("status(): numbers are read off the systems", typeof st.approval === "number" && typeof st.treasury === "number" && typeof st.emergency === "number" && st.threat && typeof st.threat.members === "number",
      `approval=${st.approval} treasury=${st.treasury} emergency=${st.emergency} threat=${st.threat && st.threat.members}`);
    check("status(): a term with an end", st.termDay == null || st.termDay > st.day, `day ${st.day} term ends ${st.termDay}`);
    const s2 = await evl("var s=CBZ.presidency.site&&CBZ.presidency.site(); return s?{id:s.id,gate:s.gate}:null;");
    check("site(): the Mansion", !!(s2 && s2.id === "execmansion" && s2.gate), JSON.stringify(s2));
    const ev = await evl("return !!(CBZ.presidency.on && CBZ.presidency.emit);");
    check("events: on()/emit() exist", ev === true);
  }

  // ---- 1b. the room's powers and the frontier ----------------------------------
  if (st) {
    const pw = await evl(`
      var B = CBZ.presidency.buttons ? CBZ.presidency.buttons() : [];
      var ok = B.filter(function (b) { return b.ok; }).length;
      var w = CBZ.presidency.press('wall');
      for (var k=0;k<120;k++) CBZ.stepSim(1/60);
      var s = CBZ.presidency.status();
      return { pads: B.length, pressable: ok, wall: w, wallStatus: s.wall, members: s.threat.members };`);
    check("every shipped power is a pad, most pressable on day one", pw && pw.pads >= 15 && pw.pressable >= 10, `pads=${pw && pw.pads} pressable=${pw && pw.pressable}`);
    check("BUILD THE WALL finds the Saltlands frontier", !!(pw && pw.wall && pw.wall.ok && pw.wallStatus && pw.wallStatus.ordered && pw.wallStatus.total > 0), JSON.stringify(pw && { wall: pw.wall, status: pw.wallStatus }));
    check("the cell has a roster on the first morning", !!(pw && pw.members > 0), `members=${pw && pw.members}`);
  }

  // ---- 2. the HUD ------------------------------------------------------------
  const hud = await evl("return CBZ.presidentHudAudit ? CBZ.presidentHudAudit() : null;");
  if (!hud) skip("president HUD", "no presidentHudAudit");
  else check("HUD strip is mounted and visible while I hold the seat", hud.mounted === true && hud.visible === true && (hud.fields | 0) >= 4, JSON.stringify(hud));

  // ---- 3. the Chief of Staff --------------------------------------------------
  const hasAgenda = await evl("return !!CBZ.presidentAgendaAudit;");
  if (!hasAgenda) skip("agenda", "no presidentAgendaAudit");
  else {
    const d = await newDay();
    const ag = await evl("return CBZ.presidentAgendaAudit();");
    check("a new day hands the president 2–3 tasks", ag && Array.isArray(ag.today) && ag.today.length >= 2 && ag.today.length <= 3, `day ${d}: ${JSON.stringify(ag && ag.today)}`);
    const live = await evl("return CBZ.mission && CBZ.mission.live ? CBZ.mission.live().map(function(m){return m.id;}) : [];");
    check("…through the one mission system", Array.isArray(live) && live.length >= 1, JSON.stringify(live));
    check("the podium stands on the stylobate", !!(ag && ag.podiumBuilt));
  }

  // ---- 4. the motorcade -------------------------------------------------------
  // A REAL RIDE, not the old teleport: go() seats the President in the state
  // car's BACK seat (city/carseats.js "rearR") with an agent at the wheel, the
  // column drives the road route (motorcade.js tickDrive, one arc-length for the
  // whole formation), pulls up at the venue, and the President gets out of the
  // rear door through the one exit verb (systems/seat_exit.js).
  const mc = await evl("return CBZ.motorcadeAudit ? CBZ.motorcadeAudit() : null;");
  if (!mc) skip("motorcade", "no motorcadeAudit");
  else {
    check("the state car is parked in the motor court", mc.car === true, JSON.stringify(mc));
    const b = await evl(`
      if (!CBZ.motorcade || !CBZ.motorcade.go || !CBZ.motorcade.destinations) return null;
      var sc = CBZ.motorcade.car(); if (!sc) return { noCar: true };
      var ds = CBZ.motorcade.destinations().filter(function (d) { return !/mansion|home/i.test(d.id + " " + d.name); });
      if (!ds.length) return { noDest: true };
      ds.sort(function (a, b) { return Math.hypot(a.x - sc.pos.x, a.z - sc.pos.z) - Math.hypot(b.x - sc.pos.x, b.z - sc.pos.z); });
      var d = ds[0], P = CBZ.player, S = CBZ.carSeats;
      var arr0 = CBZ.motorcadeAudit().arrivals | 0;
      // who hurts the state car: a trap on engineHp keeps the stack of every drop
      // (the column evacuates "under fire" on any drop, so a phantom one aborts the ride)
      window.__scHits = [];
      (function (c) { var v = c.engineHp; try { Object.defineProperty(c, "engineHp", { configurable: true, enumerable: true,
        get: function () { return v; },
        set: function (n) { if (v != null && n != null && n < v - 0.01 && window.__scHits.length < 6) window.__scHits.push({ from: +(+v).toFixed(1), to: +(+n).toFixed(1),
          stack: String(new Error().stack).split("\\n").slice(2, 8).map(function (l) { return l.trim().replace(location.origin + "/", ""); }).join(" < ") }); v = n; } }); } catch (e) {} })(sc);
      // ...and what it hit: cityCarImpact is called for both cars of a crash, a then b
      if (CBZ.cityCarImpact && !CBZ.cityCarImpact.__mcw) { var ci = CBZ.cityCarImpact, pend = false, last = null, lastT = -1;
        var who = function (c) { return c ? (c._motorcade ? "convoy:" + c._motorcade : (c.player ? "player" : (c.ai ? "traffic" : "parked/other"))) + " v=" + (+(c.v || 0)).toFixed(1) : "?"; };
        CBZ.cityCarImpact = function (car) { var mine = CBZ.motorcade.car(), T = CBZ._matrixOwnStamp;
          var note = function (o) { if (window.__scHits.length < 8) window.__scHits.push({ from: 0, to: 0, stack: "IMPACT state car <-> " + who(o) }); };
          if (pend) { pend = false; if (car !== mine) note(car); }
          else if (car === mine) { if (last && last !== car && lastT === T) note(last); else pend = true; }
          last = car; lastT = T; return ci.apply(this, arguments); };
        CBZ.cityCarImpact.__mcw = true; }
      var r = CBZ.motorcade.go(d.id);
      var act = CBZ.motorcade.active();
      window.__mcRide = { dest: d, arr0: arr0, c0: { x: sc.pos.x, z: sc.pos.z }, last: { x: sc.pos.x, z: sc.pos.z }, path: 0, offSeat: 0, apart: 0, samples: 0 };
      var drv = S ? S.occupant(sc, "driver") : null;
      return { r: r, dest: d.id, straight: Math.round(Math.hypot(d.x - sc.pos.x, d.z - sc.pos.z)),
        route: act && act.route ? act.route.length : 0, len: (CBZ.motorcadeAudit().drive || {}).len,
        inCar: P._vehicle === sc, seat: S ? S.seatOf(sc, P) : null,
        riding: CBZ.cityPaxRiding ? CBZ.cityPaxRiding() === sc : null,
        chauffeured: CBZ.cityPaxChauffeured ? CBZ.cityPaxChauffeured(sc) : null,
        driver: drv ? drv.kind : null, bulletproof: !!sc.bulletproof };`);
    if (b && b.__err) check("the ride evaluates", false, b.__err.split("\n")[0]);
    else if (!b || b.noDest || b.noCar) skip("motorcade ride", b ? JSON.stringify(b) : "no motorcade.go");
    else {
      check("go() boards the President (a ride, not a teleport)", !!(b.r && b.r.ok) && b.route >= 2, JSON.stringify({ r: b.r, route: b.route, len: b.len, dest: b.dest, straight: b.straight }));
      check("…by a sane road, not a tour of the country", b.len > 0 && b.len < Math.max(600, b.straight * 3.5), `path ${b.len} m for ${b.straight} m as the crow flies`);
      check("…in the BACK seat, chauffeured, an agent at the wheel", b.inCar && b.seat === "rearR" && b.riding === true && b.chauffeured === true && b.driver === "npc",
        JSON.stringify({ inCar: b.inCar, seat: b.seat, riding: b.riding, chauffeured: b.chauffeured, driver: b.driver }));
      check("the state car is bulletproof", b.bulletproof === true);
      // drive: 1 s of sim (60 steps) per evaluate, up to 6 sim-minutes. Each
      // chunk logs its wall time and its slowest single step, and has a 45 s
      // hard deadline (a timeout is reported as a probe ERROR), so a slow machine
      // and a sim hang can never look alike again.
      let replanned = null, arrived = null, wallSum = 0, worstStep = 0, worstChunk = 0;
      for (let chunk = 0; chunk < 360 && !arrived; chunk++) {
        const t0 = Date.now();
        const r = await evl(`
          var M = window.__mcRide, sc = CBZ.motorcade.car(), P = CBZ.player, S = CBZ.carSeats;
          var slow = 0, tAll = performance.now();
          for (var k = 0; k < 60; k++) {
            var t = performance.now();
            CBZ.stepSim(1/60);
            t = performance.now() - t; if (t > slow) slow = t;
            if (k % 30 !== 0 || !sc) continue;
            M.path += Math.hypot(sc.pos.x - M.last.x, sc.pos.z - M.last.z); M.last = { x: sc.pos.x, z: sc.pos.z };
            M.samples++;
            if (!S || S.seatOf(sc, P) !== "rearR") M.offSeat++;
            if (Math.hypot(P.pos.x - sc.pos.x, P.pos.z - sc.pos.z) > 2.5) M.apart++;
          }
          var a = CBZ.motorcadeAudit();
          return { ms: Math.round(performance.now() - tAll), slow: Math.round(slow), phase: a.phase, arrivals: a.arrivals, at: a.drive, why: a.lastReason, hits: window.__scHits.splice(0),
            done: (a.arrivals | 0) > M.arr0 || a.phase === "halted" || a.phase === "done" };`, 45000, `drive chunk ${chunk}`);
        if (r && r.__err) { check("drive chunk evaluates", false, r.__err.split("\n")[0]); break; }
        const wall = Date.now() - t0; wallSum += wall;
        if (r && r.slow > worstStep) worstStep = r.slow;
        if (wall > worstChunk) worstChunk = wall;
        if (chunk % 10 === 0 || wall > 5000) t.log(`      drive t=${chunk + 1}s  wall ${wall} ms  sim ${r && r.ms} ms  slowest step ${r && r.slow} ms  phase ${r && r.phase}  ${JSON.stringify(r && r.at)}${r && r.why ? "  why: " + r.why : ""}`);
        if (wall > 5000) t.log("        slowest updaters:", JSON.stringify(await profTop(true)));
        if (r && r.hits && r.hits.length) for (const h of r.hits) t.log(`        state car hurt ${h.from} -> ${h.to}: ${h.stack}`);
        if (r && r.at && r.at.len !== b.len && !replanned) replanned = `path ${b.len} m became ${r.at.len} m at t=${chunk + 1}s (phase ${r.phase})`;
        if (r && r.done) arrived = { phase: r.phase, arrivals: r.arrivals };
      }
      t.log("      slowest updaters during the drive:", JSON.stringify(await profTop(true)));
      t.log(`      drive total wall ${Math.round(wallSum / 1000)} s, worst chunk ${worstChunk} ms, slowest single step ${worstStep} ms`);
      const drive = await evl(`
        var M = window.__mcRide, sc = CBZ.motorcade.car(), a = CBZ.motorcadeAudit();
        return { phase: a.phase, arrivals: a.arrivals, arr0: M.arr0, path: Math.round(M.path),
          fromCourt: sc ? Math.round(Math.hypot(sc.pos.x - M.c0.x, sc.pos.z - M.c0.z)) : null,
          toDest: sc ? Math.round(Math.hypot(sc.pos.x - M.dest.x, sc.pos.z - M.dest.z)) : null,
          samples: M.samples, offSeat: M.offSeat, apart: M.apart };`);
      check("nothing re-routes the President's own ride under him", !replanned, replanned);
      check("the column drives the route (the car itself moves, step by step)", !!(drive && drive.path > 150 && drive.fromCourt > 100), JSON.stringify(drive));
      check("…with the President in the back seat the whole way", !!(drive && drive.samples > 0 && drive.offSeat === 0 && drive.apart === 0), drive && `offSeat=${drive.offSeat} apart=${drive.apart} of ${drive.samples}`);
      check("…and arrives at the venue", !!(arrived && drive && drive.arrivals > drive.arr0 && drive.phase === "venue" && drive.toDest < 120), JSON.stringify(arrived));
      const out = await evl(`
        var sc = CBZ.motorcade.car(), P = CBZ.player;
        var st = CBZ.seatState ? CBZ.seatState() : null;
        var verb = st ? st.verb : null, kind = st ? st.kind : null;
        if (st && st.exit) st.exit(); else if (CBZ.cityVehicleGetOut) CBZ.cityVehicleGetOut();
        // he CLIMBS out (city/boarding.js: CBZ.moves.alight opens the door, steps
        // out, shuts it, ~2 s); half a second in he is still in the doorway, so
        // read where he stands once the climb is done
        for (var k = 0; k < 30 || (k < 360 && CBZ.moves && CBZ.moves.busy && CBZ.moves.busy(P)); k++) CBZ.stepSim(1/60);
        var h = sc.heading || 0, dx = P.pos.x - sc.pos.x, dz = P.pos.z - sc.pos.z;
        var lx = dx * Math.cos(h) - dz * Math.sin(h), lz = dx * Math.sin(h) + dz * Math.cos(h);
        return { kind: kind, verb: verb, driving: !!P.driving, vehicle: !!P._vehicle, localX: +lx.toFixed(2), localZ: +lz.toFixed(2),
          seatFree: CBZ.carSeats ? !CBZ.carSeats.occupant(sc, "rearR") : null };`);
      check("the exit verb gets him out of the back seat, by the rear right door", !!(out && out.kind === "vehicle" && out.verb === "Get out" && !out.driving && !out.vehicle && out.localX < -0.8 && out.localZ < 0.2 && out.seatFree === true), JSON.stringify(out));
    }
  }

  if (!ONLY_MC) {
  // ---- 5. the threat comes to the gate ----------------------------------------
  if (!st) skip("gate attack", "no status()");
  else {
    const atk = await evl(`
      var S = CBZ.presidency, site = S.site(), gate = site.gate || { x: site.cx, z: site.cz + site.rect.maxZ };
      // stand in the motor court so a gate attack is "near"
      CBZ.player.pos.set(site.cx, 0.1, site.cz + 18); CBZ.player.vy = 0;
      var seen = { armed: 0, gateTarget: 0, bodies: 0, attacks: 0, targets: [] };
      for (var day = 0; day < 4; day++) {
        S._armAttack();
        var s0 = S.status();
        seen.armed += s0.threat.armed ? 1 : 0;
        seen.targets.push(s0.threat.target);
        var isGate = /mansion|gate/i.test(String(s0.threat.target || ""));
        if (isGate) seen.gateTarget++;
        for (var k = 0; k < ${QUICK ? 1500 : 2700}; k++) {   // 25–45 s of sim
          CBZ.stepSim(1/60);
          if (k % 60 === 0) {
            var n = 0, P = CBZ.cityPeds || [];
            for (var i = 0; i < P.length; i++) { var p = P[i]; if (p && !p.dead && p.organization === 'cell') { var dd = Math.hypot(p.pos.x - gate.x, p.pos.z - gate.z); seen.cellAny = Math.max(seen.cellAny || 0, 1); seen.minD = Math.min(seen.minD == null ? 1e9 : seen.minD, Math.round(dd)); if (dd < 140) n++; } }
            if (n > seen.bodies) seen.bodies = n;
          }
        }
        seen.attacks = S.status().threat && (S.audit().attacksDone | 0);
        if (seen.gateTarget && seen.bodies) break;
        CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05);
      }
      return seen;`, 900000, "gate attack (4 days x 45 s sim)");
    check("an armed attack reports its target", atk && atk.armed >= 1, JSON.stringify(atk));
    check("within a few days the target is MY gate", !!(atk && atk.gateTarget >= 1), `targets: ${atk && JSON.stringify(atk.targets)}`);
    check("…and it arrives as bodies at the gate, not a headline", !!(atk && atk.bodies >= 1), `cell bodies near gate: ${atk && atk.bodies}`);
  }

  // ---- 6. the regime on the building ------------------------------------------
  const rg = await evl("return CBZ.presidentRegimeAudit ? CBZ.presidentRegimeAudit() : null;");
  if (!rg) skip("regime dressing", "no presidentRegimeAudit");
  else {
    const after = await evl(`
      var h = CBZ.presidency.seat(); if (!h) return null;
      var before = CBZ.presidentRegimeAudit();
      h.rec.govType = 'dictatorship';
      for (var k=0;k<240;k++) CBZ.stepSim(1/60);
      var mid = CBZ.presidentRegimeAudit();
      h.rec.govType = 'democracy';
      for (var k=0;k<240;k++) CBZ.stepSim(1/60);
      var back = CBZ.presidentRegimeAudit();
      return { before: before, dictatorship: mid, back: back };`);
    check("a dictatorship hangs its banners on the Mansion", !!(after && after.dictatorship && (after.dictatorship.pieces | 0) > (after.before.pieces | 0)), JSON.stringify(after));
    check("…and the republic takes them down again", !!(after && (after.back.pieces | 0) <= (after.before.pieces | 0) + 0), after && `pieces ${after.before.pieces} -> ${after.dictatorship.pieces} -> ${after.back.pieces}`);
  }

  // ---- 6b. the feet -----------------------------------------------------------
  // Every NPC on the compound must stand ON what the world raised under him
  // (stylobate 0.30, paving 0.10, hall slab) — the player's own groundAt law.
  const feet = await evl(`
    if (!CBZ.groundAt || !CBZ.presidency || !CBZ.presidency.site) return null;
    var s = CBZ.presidency.site(); CBZ.player.pos.set(s.cx, 0.31, s.cz - 12); CBZ.player.vy = 0;
    for (var k = 0; k < 600; k++) CBZ.stepSim(1/60);        // let citystaff mint the household + press
    var P = CBZ.cityPeds || [], n = 0, bad = 0, worst = 0, raised = 0, sample = [];
    for (var i = 0; i < P.length; i++) { var p = P[i]; if (!p || !p.pos || p.dead || p.inCar || p.culled) continue;
      if (Math.hypot(p.pos.x - s.cx, p.pos.z - s.cz) > 90) continue;
      var g = CBZ.groundAt(p.pos.x, p.pos.z, p.pos.y); var d = Math.abs(p.pos.y - g); n++;
      if (g > 0.05) raised++;
      if (d > worst) worst = d;
      if (d > 0.06) { bad++; if (sample.length < 4) sample.push({ job: p.job, y: +p.pos.y.toFixed(2), g: +g.toFixed(2) }); } }
    return { bodies: n, onRaisedGround: raised, sunkOrFloating: bad, worst: +worst.toFixed(3), sample: sample };`);
  if (!feet) skip("NPC feet", "no groundAt/site");
  else {
    check("NPCs on the compound stand on the surface under them", feet.bodies > 0 && feet.sunkOrFloating === 0, JSON.stringify(feet));
    check("…and some of that surface is raised (the check is not vacuous)", feet.onRaisedGround > 0, `raised=${feet.onRaisedGround}/${feet.bodies}`);
  }

  // ---- 7. the house -----------------------------------------------------------
  const ia = await evl("return CBZ.presidentInteriorAudit ? CBZ.presidentInteriorAudit() : null;");
  if (!ia) skip("interior audit", "no presidentInteriorAudit");
  // baseline measured before the interior wave (seed 260811): rooms 6, usable 56, symbols 13
  else check("the authored rooms did not regress", (ia.namedRooms | 0) >= 6 && (ia.usableProps | 0) >= 56 && (ia.stateSymbols | 0) >= 13, `rooms=${ia.namedRooms} usable=${ia.usableProps} symbols=${ia.stateSymbols} empty=${ia.emptyDecor}`);

  }

  // ---- errors from the president files ---------------------------------------
  const uniq = [...new Set(t.errors())].filter((e) => !/ProgressEvent/.test(e));
  const ours = uniq.filter((e) => /presiden|motorcade|govcomplex|interior_programs|statecraft|regimes|elections|candidacy/.test(e));
  check("no page errors from the president wave's files", ours.length === 0, ours.slice(0, 6).join(" | "));
  if (uniq.length) t.log("other page errors (informational):", uniq.filter((e) => !ours.includes(e)).slice(0, 5));

  const fails = results.filter((r) => !r).length;
  return { ok: !fails, summary: fails ? `PRESIDENT: FAIL (${fails}/${results.length})` : `PRESIDENT: ok (${results.length} checks)` };
}
