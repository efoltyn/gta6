/* ============================================================
   city/president_storm.js — THEY COME FOR HIM IN HIS OWN HOUSE.

   OWNER (2026-10-28): "Being overthrown is a card. Right now he sits in one
   room he can't leave, and losing is 'OVERTHROWN' text on screen. Make it
   real: a coup or assassination is people actually coming for him in the
   building. Soldiers / agents come through the doors, guns come out, his
   protection detail fights or turns, he can run or fight or hide, and he can
   be shot dead."

   THE THREE WAYS THE PRESIDENT GAME'S WORLD (president/world.js) SENDS MEN:
     coup      the General and a squad of soldiers come up through the West
               Wing to wherever he is. The General says it once: step down,
               or else. "Step down" and he is walked out of office alive.
               Anything else (or saying nothing) and it is a firefight.
     traitor   his own Security Chief's men: an agent of his own detail with
               the resignation and a gun. Sign, or it is a firefight.
     hit       a foreign government's gunmen, dressed as staff, walk in and
               draw. No question.
   Every one of them is a real city ped (city/occupy.js cityPostNpc: the
   shipped rig, real guns, real hits, real deaths through cityKillPed and the
   ragdoll); their brain is peds.js's own fight brain with the one field every
   tactical surface reads (huntPlayer); the Secret Service is
   protection.js's real detail on its real brain, and the men who turn are
   taken off it and pointed at him. Nobody here is scripted to hit or miss.

   WHO WALKS OUT DECIDES IT (world action "storm"): all of them down, or a
   coup that has lost its nerve after four minutes, and he survived it; dead,
   and he was shot; past his own estate wall and away, and he got out (exile).
   The President's page (city/president_game.js) puts up its last card only
   after the shooting is over.

   PUBLIC  CBZ.presStorm = { start(matter, ctx), active(), audit() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || CBZ.presStorm) return;
  const g = CBZ.game || (CBZ.game = {});

  const ST = { on: false, kind: null, m: null, ctx: null, t: 0, phase: null, men: [], lead: null, turned: [], route: null, wp: [], asked: false,
    result: null, armedPlayer: false, rec: null, log: [] };
  function PO() { return CBZ.presidentOffice || null; }
  function P() { return CBZ.player || null; }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }
  function say(ped, text, secs) { if (ped && !ped.dead && CBZ.citySay) { try { CBZ.citySay(ped, text, "#f2e6c8", secs || 2.6); } catch (e) {} } }
  function note(s) { ST.log.push(Math.round(ST.t) + "s " + s); if (ST.log.length > 30) ST.log.shift(); }
  function seatId() { try { const h = CBZ.gov && CBZ.gov.holds ? CBZ.gov.holds() : null; return h ? h.id : null; } catch (e) { return null; } }
  function detail() {
    const id = seatId(), Pr = CBZ.protection;
    const d = id && Pr && Pr.get ? Pr.get("off_" + id) : null;
    return d ? d.memberPedRefs.filter(function (q) { return q && !q.dead; }) : [];
  }
  function mansionRect() { try { const s = CBZ.presidency && CBZ.presidency.site ? CBZ.presidency.site() : null; return s && s.rect ? s.rect : null; } catch (e) { return null; } }
  function office() {
    const O = PO();
    const a = O && O.audit ? O.audit() : null;
    return { inOffice: !!(a && a.inOffice), door: O && O.doorway ? O.doorway() : null, floorY: P() && P().pos ? P().pos.y : 0 };
  }
  function hyp(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  // THEY COME THROUGH THE DOOR: a shut leaf in their way swings open (the
  // office's own openDoorAt: systems/bodydoors.js's provider, the same door
  // the player opens)
  function openDoorsNear(x, z, y, r) { const O = PO(); return O && O.openDoorAt ? O.openDoorAt(x, z, y, r) : 0; }

  // ---- the men
  function post(x, z, y, opts) {
    if (!CBZ.cityPostNpc) return null;
    let p = null;
    try {
      p = CBZ.cityPostNpc(x, z, Object.assign({ aggr: 0.95, wealth: 0.4, floorY: y > 0.3 ? y : undefined, src: "presstorm" }, opts));
    } catch (e) { p = null; }
    if (!p) return null;
    p._presStorm = true; p._campaignTarget = true; p._iOnly = true;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    return p;
  }
  function walkTo(p, x, z) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null;
    p.path = [{ x: x, z: z }]; p.finalGoal = { x: x, z: z };
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = "walk"; p.pause = 0;
  }
  function hold(p) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    const Pp = P();
    if (Pp && p.group) p.group.rotation.y = Math.atan2(Pp.pos.x - p.pos.x, Pp.pos.z - p.pos.z);
  }
  // he means it now: peds.js's fight brain, aimed at the President
  function hunt(p) {
    if (!p || p.dead) return;
    p.controlled = false; p.staffPost = null; p.pause = 0;
    if (!p.armed) { p.armed = true; p.weapon = p.weapon || "Pistol"; if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} } }
    p.ammo = Math.max(p.ammo || 0, 90);
    p.aggr = 0.98;
    p.huntPlayer = 1; p.hunt = Math.max(p.hunt || 0, 1);
    p.rage = PA(); p.state = "fight";
    p.organization = ST.kind === "coup" ? "junta" : "assassins";
    if (CBZ.cityNpcOffense) { try { CBZ.cityNpcOffense(p, 90, "attempt on the President"); } catch (e) {} }
  }

  // ---- the arrival. In the office: through the outer office and the door,
  // ONE AT A TIME from the spot the office's own visitors are posted at
  // (president_office.js doorway().out2), the next as soon as the last is
  // clear of it, the way a squad comes through a door. A file of men posted at
  // once jammed the outer office (measured: five bodies stuck against its
  // furniture for half a minute). Away from the office: a ring 22 m out.
  function spawnPoint(i) {
    const O = office(), Pp = P();
    if (O.inOffice && O.door) return { x: O.door.out2.x, z: O.door.out2.z, y: O.floorY, door: true };
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const a = yaw + Math.PI * 0.8 + i * 0.22;
    return { x: Pp.pos.x - Math.sin(a) * 22, z: Pp.pos.z - Math.cos(a) * 22, y: Pp.pos.y };
  }
  function specs(kind) {
    const S = ST.ctx.state(), me = S.c[ST.ctx.me], out = [];
    if (kind === "coup") {
      out.push({ lead: true, name: "General " + (me.cab.general.name.split(" ").pop()), named: true, o: { job: "military general", archetype: "military", armed: true, weapon: "Pistol", gender: "m" } });
      const n = 4 + Math.min(3, Math.floor((me.armyPower || 30) / 25));
      for (let i = 1; i <= n; i++) out.push({ name: "Soldier", o: { job: "soldier", archetype: "soldier", armed: true, weapon: i % 3 ? "Rifle" : "SMG", gender: "m" } });
    } else if (kind === "traitor") {
      for (let i = 0; i < 2; i++) out.push({ name: "Agent", o: { job: "close protection", archetype: "professional", armed: true, weapon: "SMG", gender: "m" } });
    } else {
      // gunmen in suits: they walk in like anybody with a folder and draw at the desk
      const n = 2 + (S.day % 2);
      for (let i = 0; i < n; i++) out.push({ lead: i === 0, name: "Aide", o: { job: "aide", archetype: "professional", armed: false, weapon: "Pistol", gender: i % 2 ? "f" : "m" } });
    }
    return out;
  }
  function make(spec, i) {
    const q = spawnPoint(i);
    const p = post(q.x, q.z, q.y, spec.o);
    if (!p) return null;
    p.name = spec.name; if (spec.named) p.nameKnown = true;
    p._hp0 = p.hp;
    const D = office().door;
    if (q.door && D && p.group) p.group.rotation.y = Math.atan2(-D.ox, -D.oz);
    ST.men.push(p);
    if (spec.lead && !ST.lead) ST.lead = p;
    const k = ST.men.length - 1;
    ST.route[k] = routeTo(standFor(k));
    ST.wp[k] = 0;
    const w0 = ST.route[k][0];
    walkTo(p, w0.x, w0.z);
    return p;
  }
  function spawnSquad(kind) {
    ST.men = []; ST.route = []; ST.wp = [];
    ST.queue = specs(kind);
    if (kind === "traitor") {
      // one of his own: the agent nearest him walks over with the paper
      const det = detail(), Pp = P();
      det.sort(function (a, b) { return hyp(a.pos, Pp.pos) - hyp(b.pos, Pp.pos); });
      const lead = det[0] || null;
      if (lead) {
        turn(lead); ST.lead = lead; ST.men.push(lead); lead._hp0 = lead.hp;
        ST.route[0] = [standFor(0)]; ST.wp[0] = 0;
        walkTo(lead, ST.route[0][0].x, ST.route[0][0].z);
      } else ST.queue.unshift({ lead: true, name: "Agent", o: { job: "close protection", archetype: "professional", armed: true, weapon: "Pistol", gender: "m" } });
    }
    const O = office();
    if (O.inOffice && O.door) { const s0 = ST.queue.shift(); if (s0) make(s0, 0); }
    else { while (ST.queue.length) make(ST.queue.shift(), ST.men.length); }
    note("men coming: " + (ST.men.length + ST.queue.length));
  }
  // the next man through the door, once the last one is clear of it
  function feedDoor() {
    if (!ST.queue || !ST.queue.length) return;
    const D = office().door;
    if (!D) { while (ST.queue.length) make(ST.queue.shift(), ST.men.length); return; }
    for (const p of ST.men) if (p && !p.dead && Math.hypot(p.pos.x - D.out2.x, p.pos.z - D.out2.z) < 1.1) return;
    make(ST.queue.shift(), ST.men.length);
  }
  // where the k-th man stands when he gets to him: a short arc in front of
  // him, on the doorway's side; the first one closest
  function standFor(k) {
    const Pp = P(), D = office().door;
    const tox = D ? D.inside.x - Pp.pos.x : 1, toz = D ? D.inside.z - Pp.pos.z : 0;
    const l = Math.hypot(tox, toz) || 1, ux = tox / l, uz = toz / l;
    const row = k === 0 ? 0 : 1 + ((k - 1) % 2) + Math.floor((k - 1) / 4);
    const off = k === 0 ? 0 : ((k % 2 ? 1 : -1) * (0.9 + Math.floor((k - 1) / 2) % 2 * 0.9));
    const dist = k === 0 ? 2.4 : 3.3 + (row > 2 ? 0.9 : 0);
    // a spot a man can stand on (not the coffee table, not a sofa): the nearest
    // free one round the planned spot
    const O = PO(), ok = function (x, z) { return !O || !O.standable || O.standable(x, z); };
    const bx = Pp.pos.x + ux * dist - uz * off, bz = Pp.pos.z + uz * dist + ux * off;
    if (ok(bx, bz)) return { x: bx, z: bz };
    for (let r = 0.4; r <= 2.0; r += 0.4) for (let a = 0; a < 8; a++) {
      const x = bx + Math.cos(a * Math.PI / 4) * r, z = bz + Math.sin(a * Math.PI / 4) * r;
      if (ok(x, z)) return { x: x, z: z };
    }
    return { x: bx, z: bz };
  }
  // take an agent off the detail and point him at the President
  function turn(p) {
    const id = seatId(), Pr = CBZ.protection;
    const d = id && Pr && Pr.get ? Pr.get("off_" + id) : null;
    if (d) { const i = d.memberPedRefs.indexOf(p); if (i >= 0) { d.memberPedRefs.splice(i, 1); d.memberCount = Math.max(0, d.memberCount - 1); } }
    p._protUnit = null; p.moveOrder = null; p._presStorm = true;
    ST.turned.push(p);
  }
  function routeTo(stand) {
    const O = PO();
    return O && O.entryRoute && office().inOffice ? O.entryRoute(stand) : [{ x: stand.x, z: stand.z }];
  }

  // ---- the question, once, from the man in front
  function ask() {
    if (ST.asked) return;
    ST.asked = true;
    const UI = CBZ.campaignUI, S = ST.ctx.state(), m = ST.m;
    const line = CBZ.presHoller ? CBZ.presHoller.line(S, ST.ctx.me, m) : "";
    const lead = ST.lead;
    if (lead) hold(lead);
    const choices = ST.kind === "coup" ? [{ id: "yield", label: "Step down" }, { id: "fight", label: "Arrest him" }] : [{ id: "yield", label: "Sign it" }, { id: "fight", label: "Refuse" }];
    if (!UI || !UI.say || !lead) { fight(); return; }
    let pr = null;
    try { pr = UI.say(lead.name || "General", line, choices.map(function (c, i) { return Object.assign({ dir: i ? "right" : "left" }, c); }), { cinematic: true, actor: lead, timeout: 10, silent: { line: "Take him.", as: "fight" } }); } catch (e) { pr = null; }
    if (!pr || !pr.then) { fight(); return; }
    pr.then(function (pick) {
      const id = pick && typeof pick === "object" ? pick.id : pick;
      if (id === "yield") yieldOffice(); else fight();
    });
  }
  function yieldOffice() {
    note("he signs");
    ST.phase = "yielded";
    say(ST.lead, ST.kind === "coup" ? "Walk out with us, sir. Nobody gets hurt." : "Thank you, sir.", 3);
    ST.ctx.submit({ type: "answer", m: ST.m.id, o: 0 });           // resign: the world takes it from here
    finish(false, "resigned", true);
  }
  function fight() {
    if (ST.phase === "fight" || ST.phase === "over") return;
    ST.phase = "fight"; ST.ft = 0;
    note("guns out");
    if (ST.kind === "coup") say(ST.lead, "Take him.", 2);
    while (ST.queue && ST.queue.length) make(ST.queue.shift(), ST.men.length);
    for (const p of ST.men) hunt(p);
    // the detail: some of them were never his
    const S = ST.ctx.state(), me = S.c[ST.ctx.me];
    const loyal = me.cab.security ? me.cab.security.loyalty : 60;
    const det = detail();
    const frac = ST.kind === "coup" ? Math.max(0, Math.min(0.5, (55 - loyal) / 80 + (me.armyPower || 0) / 400)) : ST.kind === "traitor" ? 0.25 : 0;
    const k = Math.round(det.length * frac);
    for (let i = 0; i < k; i++) { const p = det[det.length - 1 - i]; turn(p); hunt(p); }
    if (k) note(k + " of the detail turned");
    // the ones who are his: a gun for him, and between him and them
    const keep = detail();
    const Pp = P();
    if (!ST.armedPlayer && CBZ.cityGiveWeapon) {
      const has = CBZ.equippedWeapon && CBZ.equippedWeapon();
      if (!has) {
        ST.armedPlayer = true;
        const g0 = keep[0];
        if (g0) say(g0, "Sir! Take it!", 2.2);
        try { CBZ.cityGiveWeapon("Pistol"); } catch (e) {}
      }
    }
    if (CBZ.protection && CBZ.protection.alarm && Pp) { try { CBZ.protection.alarm(Pp.pos.x, Pp.pos.z, "gunfire at the President"); } catch (e) {} }
    if (CBZ.cityPanicRaise && Pp) { try { CBZ.cityPanicRaise(Pp.pos.x, Pp.pos.z, 2.2); } catch (e) {} }
  }

  // ---- the end of it
  function finish(won, why, quiet) {
    if (ST.phase === "over") return;
    ST.phase = "over";
    ST.result = { won: won, why: why || null };
    note(won ? "he lived" : "he did not: " + why);
    if (!quiet) ST.ctx.submit({ type: "storm", m: ST.m.id, won: !!won, why: why || null });
    const N = CBZ.presGame && CBZ.presGame.news;
    if (won && N) N(ST.kind === "coup" ? "The coup has failed. The President is alive" : "The President survives an attempt on his life", { kind: "breaking", cat: "NATION" });
    // the living who came for him put their guns down and go; the dead stay where they fell
    setTimeout(function () {
      for (const p of ST.men.concat(ST.turned)) {
        if (!p || p.dead) continue;
        p.huntPlayer = 0; p.rage = null; p.state = "flee"; p.armed = !won && p.armed;
        if (won && PO() && PO().walkOut) { try { PO().walkOut(p, "presstorm"); } catch (e) {} }
      }
      if (won && CBZ.protection && CBZ.protection.standDown) { try { CBZ.protection.standDown("president"); } catch (e) {} }
      ST.on = false;
    }, won ? 6000 : 4000);
  }
  function standing(p) { return p && !p.dead && !(p.ko > 0) && !p.surrendered && !p.cuffed; }

  // ---- the tick
  if (CBZ.onUpdate) CBZ.onUpdate(39.3, function (dt) {
    if (!ST.on || g.mode !== "city") return;
    if (g.state !== "playing") return;
    dt = Math.min(0.1, dt || 0);
    ST.t += dt;
    const Pp = P();
    if (!Pp) return;
    if (ST.phase === "over" || ST.phase === "yielded") return;
    if (Pp.dead) { finish(false, ST.kind === "coup" ? "coup" : "assassinated"); return; }
    if (ST.phase === "enter" || ST.phase === "ask") {
      feedDoor();                       // the next man through the door (and the rest keep coming while he talks)
      // they walk their routes in; the lead holds in front of him
      let arrived = 0;
      for (let i = 0; i < ST.men.length; i++) {
        const p = ST.men[i];
        if (!p || p.dead) continue;
        openDoorsNear(p.pos.x, p.pos.z, p.pos.y || 0, 2.6);
        const r = ST.route[i]; if (!r) continue;
        const w = r[ST.wp[i]];
        if (!w) { arrived++; continue; }
        const d = Math.hypot(p.pos.x - w.x, p.pos.z - w.z);
        if (w.door && d < 3.5) openDoorsNear(w.x, w.z, p.pos.y || 0, 1.4);
        // a waypoint he cannot reach (a sofa, a man in the way) is given up after
        // four seconds without getting closer; the last one means he is there
        ST.st = ST.st || []; ST.bd = ST.bd || [];
        if (ST.bd[i] == null || ST.bd[i] - d >= 0.4) { ST.bd[i] = d; ST.st[i] = 0; } else ST.st[i] = (ST.st[i] || 0) + dt;
        if (d < 0.8 || ST.st[i] > 4) {
          ST.wp[i]++; ST.st[i] = 0; ST.bd[i] = null;
          const n = r[ST.wp[i]]; if (n) walkTo(p, n.x, n.z); else { hold(p); arrived++; }
        }
        else if (p.state !== "walk") walkTo(p, w.x, w.z);
        // the gunmen in suits draw at four metres
        if (ST.kind === "hit" && hyp(p.pos, Pp.pos) < 4.5) { fight(); return; }
      }
      // he shot first (or anybody did): the talking is over
      if (ST.men.some(function (p) { return p && (p.dead || (p._hp0 != null && p.hp < p._hp0)); })) { fight(); return; }
      if (ST.phase === "ask") return;
      const lead = ST.lead;
      const near = lead && !lead.dead && hyp(lead.pos, Pp.pos) < 3.6;
      const inRoom = lead && !lead.dead && hyp(lead.pos, Pp.pos) < 7.5 && Math.abs((lead.pos.y || 0) - (Pp.pos.y || 0)) < 2;
      // in the room with him, or as close as the furniture lets him: he says it
      ST.inRoomT = inRoom ? (ST.inRoomT || 0) + dt : 0;
      if (ST.kind !== "hit" && (near || (inRoom && (arrived >= 1 || ST.inRoomT > 5)) || ST.t > 60)) { ST.phase = "ask"; ask(); }
      if (ST.kind === "hit" && ST.t > 45) fight();
      return;
    }
    if (ST.phase === "fight") {
      ST.ft += dt;
      // keep them on him: a brain that lost him is pointed back
      for (const p of ST.men.concat(ST.turned)) if (standing(p) && p.state !== "fight" && p.state !== "flee") { p.rage = PA(); p.state = "fight"; p.huntPlayer = 1; }
      const left = ST.men.concat(ST.turned).filter(standing).length;
      if (!left) { finish(true); return; }
      // out over the wall and away: he lives, the country is theirs
      const R = mansionRect();
      if (R && (Pp.pos.x < R.minX - 70 || Pp.pos.x > R.maxX + 70 || Pp.pos.z < R.minZ - 70 || Pp.pos.z > R.maxZ + 70)) { finish(false, "exile"); return; }
      // four minutes and he is still standing: they lose their nerve
      if (ST.ft > 240) finish(true);
    }
  });

  function start(m, ctx) {
    if (ST.on) return true;
    const Pp = P();
    if (!Pp || !Pp.pos || g.mode !== "city" || g.state !== "playing") return false;
    ST.on = true; ST.kind = m.kind; ST.m = m; ST.ctx = ctx; ST.t = 0; ST.ft = 0; ST.phase = "enter";
    ST.men = []; ST.turned = []; ST.lead = null; ST.asked = false; ST.result = null; ST.armedPlayer = false; ST.log = []; ST.queue = []; ST.route = []; ST.wp = []; ST.st = []; ST.bd = []; ST.inRoomT = 0;
    ctx.submit({ type: "stormBegin", m: m.id });
    // whatever he was reading, he puts it down
    if (CBZ.presBook && CBZ.presBook.isOpen && CBZ.presBook.isOpen()) CBZ.presBook.close();
    spawnSquad(m.kind);
    if (!ST.men.length && !ST.queue.length) { finish(false, m.kind === "coup" ? "coup" : "assassinated"); return true; }
    if (ST.kind === "coup" && ST.lead) say(ST.lead, "Move.", 1.5);
    note("storm: " + m.kind);
    return true;
  }

  CBZ.presStorm = {
    start: start,
    active: function () { return ST.on; },
    audit: function () {
      return { on: ST.on, kind: ST.kind, phase: ST.phase, t: Math.round(ST.t), men: ST.men.length, standing: ST.men.concat(ST.turned).filter(standing).length,
        turned: ST.turned.length, result: ST.result, log: ST.log.slice() };
    },
    // harness: what the shooting would decide
    _finish: finish, _fight: fight,
  };
})();
