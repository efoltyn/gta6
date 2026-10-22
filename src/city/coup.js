/* ============================================================
   city/coup.js — THE SITUATION ROOM. The General shoots the President, then
   turns to you.

   OWNER (2026-10-22): "you're a top soldier and the top general kills the
   president and is doing a coup and asking if you support or if you want to
   switch sides essentially. This game can be like Call of Duty."

   WHERE IT BELONGS. The Bureau arc (city/agency.js) can end with you as THE
   PRESIDENT'S MAN: you shot Voss, the palace read the cable and kept you. A
   day later his office texts: the Mansion, tonight. You walk up to the
   Executive Mansion and the scene cuts to the Situation Room (presidency.js
   builds it; this file only stands people in it): the President at the head
   of the table, the General at his left, you at his right, two of the
   President's guards at the door, two of the General's soldiers along the
   walls.

   THE SCENE (city/cinematics.js's director, CBZ.cinePlay):
     the President asks; the General answers; the General draws and shoots
     him: a real round (CBZ.tracer, CBZ.gunVoice) and a real death
     (CBZ.cityKillPed: the ragdoll, the witnesses, officials.js's
     succession). He turns to you, first person, and asks. The question is
     the cinematic prompt (city/campaign_ui.js): his line as the subtitle,
     three answers round the d-pad, eight seconds.

     UP     "I'm with you, General."   you are his man. He sends you out; the
            President's guards turn on you; the coup holds (civilwar.coup
            success: he is the head of state, the body at the Mansion door).
     LEFT   "You killed him."          the room is a firefight now: he and
            his soldiers draw on you, the guards on him. Kill him and the
            coup is crushed (the Vice President holds); die and it holds.
     RIGHT  "I didn't see anything."   "Prove it." The coup holds and he gives
            you an order: tomorrow at ten, the Mansion steps, at his shoulder.
            For a minute there you stand next to the new head of state with
            your gun. What you do with it is yours.
     silence                           he reads it as doubt: "Disarm him." His
            soldiers take your guns and walk you out. The coup holds.

   STATE: cityWorld.records.coup (saves with the world): stage, choice, the
   General's sid and name, the steps appointment.

   Debug: ?coup=1 sends the summons and starts the scene as soon as the
   Mansion has its President (the ?agency= convention).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.game) return;
  const g = CBZ.game;

  /* ---------------- reads ---------------- */
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function P() { return CBZ.player || null; }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || null; }
  function hour() { const h = CBZ.cityHour ? CBZ.cityHour() : 12; return isFinite(h) ? h : 12; }
  function today() { return CBZ.dayCount ? (CBZ.dayCount() | 0) : 0; }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function UI() { return CBZ.campaignUI || null; }
  function rec() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (!w) return null;
    w.records = w.records || {};
    return (w.records.coup = w.records.coup || { stage: null, seen: null, choice: null, sid: null, name: null, steps: null });
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  function site() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    return null;
  }
  // the President in his chair: an NPC, alive, with a body at the Mansion
  function president() {
    const PZ = CBZ.presidency;
    if (!PZ || !PZ.current) return null;
    let c = null; try { c = PZ.current(); } catch (e) { c = null; }
    if (!c || c.kind !== "npc" || !c.ped || c.ped.dead) return null;
    return c;
  }
  function general() {
    const PZ = CBZ.presidency;
    let c = null; try { c = PZ && PZ.cabinet ? PZ.cabinet().general : null; } catch (e) { c = null; }
    return c && !c.dead ? c : null;
  }
  function text(body, from) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: from || "Unknown number", text: body, priority: 2 }); } catch (e) {} }
  }
  // a line in a framed shot is the subtitle (campaign_ui.js); out in the
  // world it goes over the speaker's head
  function line(by, words) {
    if (!by || !words) return;
    const ui = UI();
    if (CBZ.cineActive && CBZ.cineActive() && ui && ui.say) { try { ui.say(by.name || "", words, { actor: by }); return; } catch (e) {} }
    if (CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(by, words, { force: true, important: true }); } catch (e) {} }
  }
  const PIN = { wp: null };
  function pin(x, z, label) {
    const M = CBZ.fullMap; if (!M || !M.setWaypoint || !isFinite(x) || !isFinite(z)) return;
    const fh = CBZ.flashHint; CBZ.flashHint = null;
    try { PIN.wp = M.setWaypoint(x, z, label) || null; } catch (e) {} finally { CBZ.flashHint = fh; }
  }
  function unpin() {
    const M = CBZ.fullMap;
    if (M && M.clearWaypoint && PIN.wp) {
      let cur = null; try { cur = M.waypoint ? M.waypoint() : null; } catch (e) {}
      if (!M.waypoint || cur === PIN.wp) { try { M.clearWaypoint(); } catch (e) {} }
    }
    PIN.wp = null;
  }

  /* ---------------- the cast ---------------- */
  const CAST = { pres: null, gen: null, guards: [], men: [], all: [], hold: false, presPost: null, room: null };
  function post(name, x, z, face, fy, o) {
    if (!CBZ.cityPostNpc) return null;
    let p = null;
    try {
      p = CBZ.cityPostNpc(x, z, {
        name: name, gender: o.gender || "m", job: o.job || "soldier", archetype: o.archetype || "professional",
        armed: !!o.weapon, weapon: o.weapon || null, aggr: 0.1, wealth: 0.6, pin: true, face: face,
        floorY: fy, src: "coup",
      });
    } catch (e) { p = null; }
    if (!p) return null;
    p.name = name; p.nameKnown = !!o.named;
    p.organization = o.org || "state";
    p._coup = true; p._campaignTarget = true;
    if (o.sid) p._sid = o.sid;
    if (CBZ.actorHolster && p.armed) CBZ.actorHolster(p, true);
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    CAST.all.push(p);
    return p;
  }
  function faceAt(a, b) { return Math.atan2(b.x - a.x, b.z - a.z); }
  function turnTo(p, tgt) {
    if (!p || p.dead || !tgt || !tgt.pos) return;
    const f = faceAt(p.pos, tgt.pos);
    if (p.staffPost) p.staffPost.face = f;
    if (p.group) p.group.rotation.y = f;
  }
  // a body in the scene holds its mark: no panic, no fight, no walk-off
  function holdMarks() {
    if (!CAST.hold) return;
    for (let i = 0; i < CAST.all.length; i++) {
      const a = CAST.all[i];
      if (!a || a.dead) continue;
      a.rage = null; a.fear = 0; a.flee = null; a.alarmed = 0;
      if (a.state === "fight" || a.state === "flee" || a.state === "walk") a.state = "idle";
      a.pause = 9999;
    }
  }
  function draw(p) { if (p && !p.dead && CBZ.actorHolster) CBZ.actorHolster(p, false); }
  function fight(p, tgt) {
    if (!p || p.dead || !tgt) return;
    draw(p);
    p.staffPost = null; p.controlled = false; p.pause = 0;
    p.rage = tgt; p.state = "fight"; p.aggr = Math.max(p.aggr || 0, 0.95);
    if (tgt === PA()) p.mem = P();
  }
  function release(p, fn) {
    if (!p || p.dead) return;
    p.pause = 0.3;
    if (fn) fn(p);
  }
  function walkOut(p) {
    if (!p || p.dead) return;
    p.rage = null; p.staffPost = null;
    if (CBZ.leave && CBZ.leave.go) { try { CBZ.leave.go(p, { tag: "coup", remove: function (b) { if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(b); } }); return; } catch (e) {} }
    p.controlled = false; p.state = "walk";
  }

  // THE ROUND. Aimed from his muzzle, heard as his gun, and a death through
  // the one kill path (ragdoll, witnesses, succession).
  function shoot(att, tgt) {
    if (!att || att.dead || !tgt || tgt.dead) return false;
    draw(att);
    if (CBZ.actorAimAt) { try { CBZ.actorAimAt(att, tgt); } catch (e) {} }
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(att) : { x: att.pos.x, y: (att.pos.y || 0) + 1.4, z: att.pos.z };
    const to = { x: tgt.pos.x, y: (tgt.pos.y || 0) + 1.62, z: tgt.pos.z };
    if (CBZ.tracer) { try { CBZ.tracer(from, to, { muzzleScale: 1.0, hit: true, shooter: att, weapon: att.weapon, targetActor: tgt }); } catch (e) {} }
    const Pp = P();
    if (CBZ.gunVoice) { try { CBZ.gunVoice(att.weapon || "Pistol", Pp ? d2(from.x, from.z, Pp.pos.x, Pp.pos.z) : 0); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(0.35);
    if (CBZ.cityKillPed) CBZ.cityKillPed(tgt, { attacker: att, fromX: att.pos.x, fromZ: att.pos.z, point: to, cal: 1, headshot: true }, "headshot");
    return true;
  }

  /* ---------------- the room ---------------- */
  function stage() {
    const PZ = CBZ.presidency;
    const room = PZ && PZ.sitRoom ? PZ.sitRoom() : null;
    const pr = president(), gn = general();
    if (!room || !pr || !gn) return null;
    const T = room.table, Y = room.floorY, L = T.len;
    const S = function (a, b) { return T.spot(a, b); };
    const head = S(L / 2 + 1.35, 0);
    const mid = S(0, 0);
    // the President: his own body, walked in from the Mansion door
    const pres = pr.ped;
    CAST.presPost = pres.staffPost ? { x: pres.staffPost.x, z: pres.staffPost.z, face: pres.staffPost.face } : null;
    pres.staffPost = { x: head.x, z: head.z, face: faceAt(head, mid) };
    pres.pos.set(head.x, Y, head.z);
    if (Y > 0.2) pres._occupyY = Y;
    if (pres.group) { pres.group.position.copy(pres.pos); pres.group.rotation.y = pres.staffPost.face; }
    pres.state = "idle"; pres.path = null; pres.speed = 0;
    CAST.pres = pres; CAST.all.push(pres);
    const gp = S(L / 2 - 0.3, 2.05), pp = S(L / 2 - 0.3, -2.05);
    CAST.gen = post(gn.name, gp.x, gp.z, faceAt(gp, head), Y, { weapon: "Pistol", named: true, sid: gn.sid, gender: gn.gender, job: "general", org: "army" });
    if (CAST.gen) CAST.gen.vipTitle = gn.display || "General";
    for (const b of [1.4, -1.4]) {
      const q = S(-L / 2 - 1.0, b);
      const p = post("Presidential guard", q.x, q.z, faceAt(q, head), Y, { weapon: "SMG", org: "detail:president" });
      if (p) CAST.guards.push(p);
    }
    const m1 = S(-0.4, 2.05), m2 = S(-L / 2 + 0.6, -2.05);
    for (const q of [m1, m2]) {
      const p = post("Soldier", q.x, q.z, faceAt(q, mid), Y, { weapon: "Carbine", org: "army" });
      if (p) CAST.men.push(p);
    }
    if (!CAST.gen) { teardown(true); return null; }
    // you: across the table from him, at the President's right hand
    const Pp = P();
    Pp.pos.set(pp.x, Y, pp.z); Pp.vy = 0; Pp.grounded = true; Pp.speed = 0;
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(Pp.pos); CBZ.playerChar.group.rotation.y = faceAt(pp, head); }
    // the President's man carries a sidearm
    if (!(CBZ.weaponInventory && CBZ.weaponInventory.length) && CBZ.unlockWeapon) { try { CBZ.unlockWeapon("sidearm", { select: true }); } catch (e) {} }
    CAST.room = { T: T, Y: Y, S: S, head: head, mid: mid, me: pp, gp: gp, seatId: pr.seatId, presName: pr.name };
    CAST.hold = true;
    return CAST.room;
  }
  function teardown(hard) {
    CAST.hold = false;
    for (let i = 0; i < CAST.all.length; i++) {
      const a = CAST.all[i];
      if (!a) continue;
      a._campaignTarget = false;
      if (a === CAST.pres) continue;
      if (hard && !a.dead) walkOut(a);
      else if (!a.dead && a.state !== "fight") a.pause = 0.3;   // off the mark hold
    }
    if (hard && CAST.pres && !CAST.pres.dead && CAST.presPost) {
      // the scene never happened: he goes back to his door
      const pp = CAST.presPost;
      CAST.pres.staffPost = { x: pp.x, z: pp.z, face: pp.face };
      CAST.pres.pos.set(pp.x, 0, pp.z); CAST.pres._occupyY = 0;
      if (CAST.pres.group) CAST.pres.group.position.copy(CAST.pres.pos);
    }
    if (hard) { CAST.pres = null; CAST.gen = null; CAST.guards = []; CAST.men = []; CAST.all = []; }
  }

  /* ---------------- what each answer makes true ---------------- */
  // the coup holds: he is the head of state, and the body at the Mansion
  // door is his (govcomplex.js re-reads the holder onto site.actor)
  function coupHolds() {
    const R = rec(); if (!R) return;
    const gen = CAST.gen, s = site();
    if (s && gen && !gen.dead) {
      const old = s.actor;
      s.actor = gen; s.power = null; s.seated = false;
      gen._govSite = s.id; gen.controlled = true;
      if (old && old !== gen && !old.dead && old !== CAST.pres) {
        if (CBZ.powerDissolve) { try { CBZ.powerDissolve(old); } catch (e) {} }
        walkOut(old);
      }
    }
    const seatId = (CAST.room && CAST.room.seatId) || "republic";
    if (CBZ.civilwar && CBZ.civilwar.coup) { try { CBZ.civilwar.coup(seatId, "success", R.sid); } catch (e) {} }
    R.held = true;
    commit();
  }
  function coupCrushed() {
    const R = rec(); if (!R || R.crushed) return;
    R.crushed = true;
    const seatId = (CAST.room && CAST.room.seatId) || "republic";
    if (CBZ.civilwar && CBZ.civilwar.coup) { try { CBZ.civilwar.coup(seatId, "failure", R.sid); } catch (e) {} }
    commit();
    setTimeout(function () { text("The Vice President is safe. He knows what you did in that room.", "Unknown number"); }, 6000);
  }

  function join() {
    const R = rec();
    R.choice = "join"; R.side = "junta";
    coupHolds();
    // his soldiers finish the President's guards; the guards go for you
    for (let i = 0; i < CAST.guards.length; i++) {
      const gd = CAST.guards[i];
      fight(gd, PA());
      if (CAST.men[i]) fight(CAST.men[i], gd);
    }
    const s = site();
    if (s && s.gate) pin(s.gate.x, s.gate.z, "the gate");
  }
  function turn() {
    const R = rec();
    R.choice = "turn"; R.side = "loyal";
    const gen = CAST.gen;
    fight(gen, PA());
    for (let i = 0; i < CAST.men.length; i++) fight(CAST.men[i], PA());
    for (let i = 0; i < CAST.guards.length; i++) fight(CAST.guards[i], i === 0 ? gen : (CAST.men[0] || gen));
    g.cityHolstered = false;
    R.fight = { t: 0 };
    commit();
  }
  function stall() {
    const R = rec();
    R.choice = "stall"; R.side = "watched";
    coupHolds();
    R.steps = { day: today() + 1, h: 10, open: false, done: false };
    for (let i = 0; i < CAST.guards.length; i++) walkOut(CAST.guards[i]);
    commit();
  }
  function silent() {
    const R = rec();
    R.choice = "silence"; R.side = "disarmed";
    coupHolds();
    // his soldiers take every gun you carry
    const inv = (CBZ.weaponInventory || []).slice();
    for (let i = 0; i < inv.length; i++) { if (CBZ.lockWeapon) { try { CBZ.lockWeapon(inv[i]); } catch (e) {} } }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    for (let i = 0; i < CAST.guards.length; i++) walkOut(CAST.guards[i]);
    commit();
  }

  /* ---------------- the scene ---------------- */
  function steps(ctx) {
    const R = ctx.room, Y = R.Y, S = R.S, L = R.T.len;
    const at = function (p, y) { return { x: p.x, y: Y + y, z: p.z }; };
    const headOf = function (p) { return p && p.pos ? { x: p.pos.x, y: (p.pos.y || Y) + 1.62, z: p.pos.z } : at(R.head, 1.62); };
    const eyes = function () { const Pp = P(); return { x: Pp.pos.x, y: (Pp.pos.y || Y) + 1.62, z: Pp.pos.z }; };
    const list = [
      { // wide from the door: the table, the wall of screens, the men round it
        dur: 3.2, cut: true,
        cam: function () { return { pos: at(S(-L / 2 - 1.7, 1.6), 2.5), look: headOf(CAST.pres) }; },
        enter: function () { line(CAST.pres, "The north road. Can we hold it?"); },
      },
      { // over your shoulder, onto him
        dur: 2.6,
        cam: function () { const m = S(L / 2 - 1.3, -2.6); return { pos: at(m, 1.9), look: headOf(CAST.gen) }; },
        enter: function () { turnTo(CAST.gen, CAST.pres); line(CAST.gen, "No, sir. Not with you."); },
      },
      { // he draws
        dur: 1.0, cut: true,
        cam: function () { const m = S(L / 2 - 1.6, 0.2); return { pos: at(m, 1.45), look: headOf(CAST.gen) }; },
        enter: function () { draw(CAST.gen); if (CBZ.actorAimAt) { try { CBZ.actorAimAt(CAST.gen, CAST.pres); } catch (e) {} } },
      },
      { // the round
        dur: 2.2,
        cam: function () { const m = S(L / 2 - 1.0, -1.0); return { pos: at(m, 1.7), look: at(R.head, 0.9) }; },
        enter: function () { shoot(CAST.gen, CAST.pres); },
      },
      { // he turns to you
        dur: 1.6, cut: true,
        cam: function () { const m = S(L / 2 - 2.4, -0.6); return { pos: at(m, 1.6), look: headOf(CAST.gen) }; },
        enter: function () { turnTo(CAST.gen, P()); },
      },
      { // your eyes. The question.
        dur: 0.4, cut: true, hideRig: true, track: true,
        cam: function () { return { pos: eyes(), look: headOf(CAST.gen) }; },
        enter: function (c) { ask(c); },
        until: function (c) { return c.answer != null; },
      },
    ];
    ctx.list = list;
    return list;
  }
  const ANSWERS = [
    { id: "join", dir: "up", label: "I'm with you, General." },
    { id: "turn", dir: "left", label: "You killed him." },
    { id: "stall", dir: "right", label: "I didn't see anything." },
  ];
  function ask(ctx) {
    const ui = UI(), gen = CAST.gen;
    if (!ui || !ui.say || !gen || gen.dead) { ctx.answer = "turn"; branch(ctx); return; }
    let pr = null;
    try { pr = ui.say(gen.name, "He's gone. The army is with me. Are you?", ANSWERS, { actor: gen, cinematic: true, timeout: 8 }); } catch (e) { pr = null; }
    if (!pr || !pr.then) { ctx.answer = "silence"; branch(ctx); return; }
    pr.then(function (v) {
      if (ctx.answer != null) return;
      ctx.answer = v === "join" || v === "turn" || v === "stall" ? v : (v === "silence" ? "silence" : null);
      if (ctx.answer == null) return;      // the scene was torn down under the question
      branch(ctx);
    });
  }
  // the answer's last shots go on the end of the running scene
  function branch(ctx) {
    const R = ctx.room, Y = R.Y, S = R.S, L = R.T.len;
    const at = function (p, y) { return { x: p.x, y: Y + y, z: p.z }; };
    const headOf = function (p) { return p && p.pos ? { x: p.pos.x, y: (p.pos.y || Y) + 1.62, z: p.pos.z } : at(R.head, 1.62); };
    const eyes = function () { const Pp = P(); return { x: Pp.pos.x, y: (Pp.pos.y || Y) + 1.62, z: Pp.pos.z }; };
    const close = { cam: function () { return { pos: eyes(), look: headOf(CAST.gen) }; }, hideRig: true, track: true };
    const L2 = ctx.list;
    if (ctx.answer === "join") {
      L2.push(Object.assign({ dur: 2.4, enter: function () { line(CAST.gen, "Good. Get out there and hold the gate."); } }, close));
      ctx.after = join;
    } else if (ctx.answer === "turn") {
      L2.push(Object.assign({ dur: 1.4, enter: function () { line(CAST.gen, "Then you die with him."); } }, close));
      ctx.after = turn;
    } else if (ctx.answer === "stall") {
      L2.push(Object.assign({ dur: 1.6, enter: function () { line(CAST.gen, "Prove it."); } }, close));
      L2.push(Object.assign({ dur: 3.0, enter: function () { line(CAST.gen, "Tomorrow at ten. The Mansion steps. You stand at my shoulder."); } }, close));
      ctx.after = stall;
    } else {
      L2.push(Object.assign({ dur: 1.8, enter: function () { line(CAST.gen, "Disarm him."); } }, close));
      L2.push({
        dur: 2.6, cut: true,
        cam: function () { return { pos: at(S(-L / 2 - 1.7, -1.6), 2.4), look: eyes() }; },
        enter: function () {
          for (let i = 0; i < CAST.men.length; i++) { const m = CAST.men[i]; if (m && !m.dead) { draw(m); turnTo(m, P()); } }
          line(CAST.gen, "Get him out of my sight.");
        },
      });
      ctx.after = silent;
    }
  }

  function begin(R) {
    if (!CBZ.cinePlay || (CBZ.cineBusy && CBZ.cineBusy())) return false;
    const room = stage();
    if (!room) return false;
    R.stage = "scene"; commit();
    unpin();
    const ctx = { room: room, answer: null, after: null, list: null };
    const ok = CBZ.cinePlay(steps(ctx), ctx, function (aborted) {
      CAST.hold = false;
      if (aborted && ctx.answer == null) {
        // died or left before he asked: the room never happened (if the
        // President still lives); he asks again the next time you come
        if (CAST.pres && !CAST.pres.dead) { teardown(true); R.stage = "summoned"; commit(); return; }
        ctx.answer = "silence"; branch(ctx);
      }
      R.stage = "done"; R.day = today();
      commit();
      if (ctx.after) { try { ctx.after(); } catch (e) {} }
      teardown(false);
    });
    if (!ok) { teardown(true); R.stage = "summoned"; commit(); return false; }
    return true;
  }

  /* ---------------- the turn: the room's firefight ---------------- */
  function tickFight(R, dt) {
    const F = R.fight; if (!F) return;
    F.t += dt;
    const gen = CAST.gen, Pp = P();
    if (gen && gen.dead) { R.fight = null; coupCrushed(); return; }
    // you died, or ran and left him the building: the coup holds
    if ((Pp && Pp.dead) || F.t > 240 || (gen && Pp && d2(gen.pos.x, gen.pos.z, Pp.pos.x, Pp.pos.z) > 160)) {
      R.fight = null;
      coupHolds();
    }
  }

  /* ---------------- the stall: the steps, tomorrow at ten ---------------- */
  const STEPS = { men: [], t: 0, said: false };
  function tickSteps(R, dt) {
    const A = R.steps; if (!A || A.done) return;
    const s = site(), gen = (s && s.actor && s.actor._sid === R.sid) ? s.actor : CAST.gen;
    const d = today(), h = hour();
    if (!gen || gen.dead) { A.done = true; commit(); return; }
    if (d < A.day || (d === A.day && h < A.h - 0.25)) return;
    const Pp = P(); if (!Pp) return;
    const sp = s && s.seatPoint;
    if (!sp) return;
    if (!A.open) {
      // he takes the steps (moved while nobody watches him go)
      if (d2(Pp.pos.x, Pp.pos.z, gen.pos.x, gen.pos.z) > 45 || (CBZ.leave && CBZ.leave.unseen && CBZ.leave.unseen(gen.pos))) {
        gen.staffPost = { x: sp.x, z: sp.z, face: sp.face }; gen.controlled = true;
        gen.pos.set(sp.x, 0, sp.z); gen._occupyY = 0;
        if (gen.group) { gen.group.position.copy(gen.pos); gen.group.rotation.y = sp.face; }
        const side = { x: Math.cos(sp.face), z: -Math.sin(sp.face) };
        STEPS.men = [];
        for (const k of [-2.2, 2.2]) {
          const p = post("Soldier", sp.x + side.x * k, sp.z + side.z * k, sp.face, 0, { weapon: "Carbine", org: "army" });
          if (p) STEPS.men.push(p);
        }
        A.open = true; A.t = 0; commit();
        pin(sp.x, sp.z, "the Mansion steps");
      }
      return;
    }
    A.t = (A.t || 0) + dt;
    const near = d2(Pp.pos.x, Pp.pos.z, gen.pos.x, gen.pos.z) < 4;
    if (near && !STEPS.said) { STEPS.said = true; A.came = true; line(gen, "Here. At my shoulder."); STEPS.t = 0; }
    if (A.came) STEPS.t += dt;
    // a minute at his shoulder, then he has his answer
    if (A.came && STEPS.t > 60) {
      A.done = true; R.side = "junta"; R.choice = "stall-kept";
      line(gen, "Good. You're mine now.");
      g.cash = (g.cash || 0) + 20000;
      text("$20,000. From the General.", "Unknown number");
      finishSteps(); commit(); return;
    }
    // he never came
    if (!A.came && (d > A.day || h > A.h + 2)) {
      A.done = true; R.side = "doubted"; R.choice = "stall-absent";
      text("You weren't on the steps. The General noticed.", "Unknown number");
      finishSteps(); commit();
    }
  }
  function finishSteps() {
    unpin();
    for (let i = 0; i < STEPS.men.length; i++) walkOut(STEPS.men[i]);
    STEPS.men = [];
  }
  // shot on the steps (by you, or by anyone while you stood there): the new
  // head of state is dead through officials.js's own succession; his
  // soldiers know who was at his shoulder
  function onKilled(ped) {
    const R = rec(); if (!R || !R.sid || ped._sid !== R.sid) return;
    if (R.steps && R.steps.open && !R.steps.done) {
      R.steps.done = true; R.side = "betrayed"; R.choice = "stall-betrayed";
      for (let i = 0; i < STEPS.men.length; i++) fight(STEPS.men[i], PA());
      STEPS.men = [];
      unpin(); commit();
    }
  }
  function wrapKill() {
    const ok = CBZ.cityKillPed;
    if (!ok || ok._coupWrapped) return;
    const w = function (ped) {
      const was = ped && !ped.dead;
      const r = ok.apply(this, arguments);
      if (was && ped.dead) { try { onKilled(ped); } catch (e) {} }
      return r;
    };
    w._coupWrapped = true; w._coupOrig = ok;
    CBZ.cityKillPed = w;
  }

  /* ---------------- the way in ---------------- */
  function presidentsMan() {
    const A = CBZ.agency;
    return !!(A && A.ending && A.ending() === "turned");
  }
  let checkT = 0, forced = false, forceTried = false;
  function tick(dt) {
    if (!playing()) return;
    wrapKill();
    holdMarks();
    const R = rec(); if (!R) return;
    if (R.fight) tickFight(R, dt);
    if (R.steps && !R.steps.done) tickSteps(R, dt);
    checkT += dt;
    if (checkT < 1) return;
    checkT = 0;
    if (!forceTried) {
      forceTried = true;
      try { forced = /(?:^|[?&])coup=1(?:&|$)/.test(String(window.location && window.location.search || "")); } catch (e) { forced = false; }
      // a save taken mid-scene: the room is gone, the summons stands
      if (R.stage === "scene") { R.stage = "summoned"; commit(); }
      if (forced && R.stage !== "done") R.stage = "summoned";
    }
    if (R.stage === "done" || R.stage === "scene") return;
    const Pp = P(); if (!Pp || Pp.dead || Pp.driving) return;
    if (!president() || !general()) return;
    const s = site(); if (!s) return;
    if (!R.stage) {
      if (!presidentsMan()) return;
      if (R.seen == null) { R.seen = today(); commit(); return; }
      const h = hour();
      if (today() < R.seen + 1 || !(h >= 18 || h < 3)) return;
      R.stage = "summoned"; commit();
      text("The President wants you at the Mansion tonight. Bring your gun.", "Unknown number");
      if (s.seatPoint) pin(s.seatPoint.x, s.seatPoint.z, "the Executive Mansion");
      return;
    }
    if (R.stage === "summoned") {
      const sp = s.seatPoint || { x: s.cx, z: s.cz };
      if (forced || d2(Pp.pos.x, Pp.pos.z, sp.x, sp.z) < 16) {
        const gn = general();
        R.sid = gn.sid; R.name = gn.name;
        if (begin(R)) forced = false;
      }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(39.62, tick);

  CBZ.coup = {
    state: function () { const R = rec(); return R ? JSON.parse(JSON.stringify(R)) : null; },
    cast: function () { return { pres: CAST.pres, gen: CAST.gen, guards: CAST.guards.slice(), men: CAST.men.slice() }; },
    // straight in (debug and the ?coup=1 entry): the summons, then the room
    begin: function () { const R = rec(); if (!R) return false; R.stage = "summoned"; forced = true; return true; },
  };
})();
