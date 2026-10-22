/* ============================================================
   city/fireorder.js — THE ORDER TO FIRE ON THE CROWD.

   OWNER (2026-10-22): much of dialogue is commands, obeyed or not, and
   occasionally they lead to coups and fight-backs. This is the biggest one
   a man in uniform is ever given. You are a soldier (enlisted on the
   islands, g.isleArmy, world/island_civic.js; or the army in Gang City,
   factions "army", city/militia.js), there is a crowd in front of you, and
   your officer tells you to fire on it. CBZ.command.bigOrder asks it, the
   cinematic three answers (city/campaign_ui.js), and every one of them is
   real:

     Fire               you and the line open up. Every man beside you is
                        given the same order (CBZ.command.issue) and decides
                        it himself: an unarmed crowd in front of witnesses
                        weighs on a conscience, so some of them will not,
                        and what they carried or refused stays on them
                        (strain). The crowd runs; the papers have it.
     Lower your weapon  your no goes down the line first (the men beside you
                        answer pulled toward it), and then you are under
                        arrest: "Drop your weapon, Private." Drop it and you
                        are out of the army; do not and the men who still
                        take his word put you on the ground. Silence, the bar
                        running out, is this answer.
     Turn on him        the fatal one: he draws on you the moment it is said
                        (CBZ.cinematicShoot; your gun already up gives you a
                        beat). The men who would carry his order stand with
                        him; the rest turn their rifles on him with you. You
                        are a mutineer: out of the army and wanted.
   Enough of this (bad orders carried, refusals) and command.js calls a
   mutiny against the officer: the sour men turn on him.

   WHERE IT HAPPENS
     Gang City   a crowd that is not his supporters (city/mob.js, the one
                 crowd: the President's gate, an address, a march) within
                 90 m, and an officer with two or more soldiers by you: he
                 walks up and puts it to you.
     The Isles   the town hall: some days, at midday, the townspeople come
                 out in front of it (real island people, the ones already
                 about and more stood out of sight; city/mob.js is Gang
                 City's and not on the islands). A captain and three
                 soldiers form a line between them and the doors, and you
                 are told to fall in (CBZ.command.toPlayer "go"). Walk away
                 from that and it is a muster missed.

   PUBLIC: CBZ.fireOrder = { state(), begin(kind) (tests), end() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.fireOrder) return;
  const g = CBZ.game || (CBZ.game = {});

  const ASK_R = 4.5;          // m: he comes this close to put it to you
  const SQUAD_R = 45;         // m: the men with him
  const FIRE_SECS = 9;        // how long the line fires
  const CITY_CD = 600;        // s between two such orders in Gang City
  const CROWD_N = 12;

  let S = null;               // the scene running now
  let cityCD = 0, tickT = 0;
  const DONE_MOBS = new Set();

  function onIsles() { return g.mode === "archipelago"; }
  function P() { return CBZ.player; }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function hour() { return CBZ.islandFit && CBZ.islandFit.hour ? CBZ.islandFit.hour() : (CBZ.cityHour ? CBZ.cityHour() : 12); }
  function day() { return CBZ.dayCount ? CBZ.dayCount() : 0; }
  function say(p, s, secs) { if (p && !p.dead && s && CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(p, s, { secs: secs || 2.2, force: true }); } catch (e) {} } }
  function armed() { try { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); } catch (e) { return false; } }
  function up(p) { return !!(p && !p.dead && p.pos && p.group && !((p.ko || 0) > 0) && !p.restraint); }
  function walkTo(p, x, z) {
    p.controlled = true; p.staffPost = null; p.pause = 0; p.rage = null;
    p.path = [{ x: x, z: z }]; p.finalGoal = { x: x, z: z };
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = "walk";
  }
  function standAt(p, fx, fz) {
    p.state = "idle"; p.speed = 0; p.path = null;
    if (CBZ.cityPedFaceTo) { try { CBZ.cityPedFaceTo(p, fx, fz, 0.5); } catch (e) {} }
  }
  function letGo(p, s) {
    if (!p || p.dead) return;
    p.controlled = false; p._protest = null; p._fireSquad = null;
    s = s || S;
    if (p._cmdBy && s && p._cmdBy === s.officer) p._cmdBy = null;
  }

  /* ---- WHO YOU SERVE ---------------------------------------------------- */
  function isleArena() { return (CBZ.surv && CBZ.surv.arena) || null; }
  function onIslandOf(b) {
    const IV = CBZ.islandVenue, A = isleArena();
    const I = IV && IV.island ? IV.island(b) : null;
    return !!(I && A && I.arena === A);
  }
  function soldierIsles() {
    const A = g.isleArmy, C = CBZ.islandCivic;
    if (!A || !A.reported || !onIsles() || !C || !C.offices) return false;
    return C.offices().some(function (O) { return O.iid === A.island && onIslandOf(O.b); });
  }
  function soldierCity() {
    const F = CBZ.factions;
    try { return g.mode === "city" && !!(F && F.isMember && F.isMember("army")); } catch (e) { return false; }
  }
  function discharge(why) {
    if (onIsles()) { g.isleArmy = null; return; }
    const F = CBZ.factions;
    if (F && F.leave) { try { F.leave("army", why); } catch (e) {} }
  }

  /* ---- THE CROWD --------------------------------------------------------- */
  function free(p) {
    return !!(up(p) && !p.controlled && !p.companion && !p.recruited && !p.staffPost && !p._islandPost && !p.rage &&
      p.state !== "fight" && p.state !== "flee" && !p._ladder && !p.inCar && !p._leaving && !p._protest && p.kind !== "cop" &&
      p.organization !== "military" && !p.vendor);
  }
  // a spot out of sight between near and far of (x, z), on land
  function unseenNear(x, z, r0, r1) {
    const A = isleArena();
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const qx = x + Math.cos(a) * r, qz = z + Math.sin(a) * r;
      const y = A && A.groundHeightAt ? A.groundHeightAt(qx, qz) : 1;
      if (!(y > 0.4)) continue;                                   // not in the sea
      if (CBZ.leave && CBZ.leave.unseen && !CBZ.leave.unseen({ x: qx, y: y, z: qz })) continue;
      return { x: qx, z: qz };
    }
    return null;
  }
  function crowdSlot(S, i) {
    // a loose knot, rows across the front, facing the doors
    const row = (i / 4) | 0, col = i % 4;
    const lat = (col - 1.5) * 1.3 + (row % 2 ? 0.55 : 0), dep = row * 1.25;
    return { x: S.at.x + S.tx * lat + S.ox * dep, z: S.at.z + S.tz * lat + S.oz * dep };
  }
  function joinCrowd(S, p) {
    p._protest = S;
    const s = crowdSlot(S, S.crowd.length);
    p._protestSlot = s;
    S.crowd.push(p);
    walkTo(p, s.x, s.z);
  }
  function formIsleCrowd(S) {
    const A = isleArena(), PP = CBZ.islandPeople, L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length && S.crowd.length < 6; i++) {
      const p = L[i];
      if (!A || p._isleRoot !== A.root || !free(p)) continue;
      if (hyp(p.pos.x, p.pos.z, S.at.x, S.at.z) > 160) continue;
      joinCrowd(S, p);
    }
    for (let k = 0; k < 30 && S.crowd.length < CROWD_N && PP && PP.spawnAt; k++) {
      const q = unseenNear(S.at.x, S.at.z, 35, 90);
      if (!q) continue;
      let p = null;
      try { p = PP.spawnAt(q.x, q.z, {}); } catch (e) { p = null; }
      if (p) joinCrowd(S, p);
    }
    return S.crowd.length >= 5;
  }
  const CHANTS = ["Hear us!", "Not in our name!", "Out! Out! Out!", "We're not leaving!"];
  function holdCrowd(S, dt) {
    let there = 0;
    for (let i = S.crowd.length - 1; i >= 0; i--) {
      const p = S.crowd[i];
      if (!up(p) || p._protest !== S) { S.crowd.splice(i, 1); continue; }
      const s = p._protestSlot;
      if (hyp(p.pos.x, p.pos.z, s.x, s.z) < 0.9) { standAt(p, S.door.x, S.door.z); there++; }
      else if (p.state !== "walk") walkTo(p, s.x, s.z);
    }
    S.chantT -= dt;
    if (there && S.chantT <= 0) {
      S.chantT = 3.5 + Math.random() * 3;
      const p = S.crowd[(Math.random() * S.crowd.length) | 0];
      say(p, CHANTS[(Math.random() * CHANTS.length) | 0], 1.8);
    }
    return there;
  }
  // the people the order is about, alive
  function targets(S) {
    if (S.mobId) {
      const out = [], L = CBZ.cityPeds || [];
      for (let i = 0; i < L.length; i++) { const p = L[i]; if (p && p._mob === S.mobId && up(p) && p.kind !== "cop" && p.organization !== "military") out.push(p); }
      return out;
    }
    return S.crowd.filter(up);
  }
  function nearestTarget(S, q) {
    const L = targets(S);
    let best = null, bd = 1e9;
    for (let i = 0; i < L.length; i++) { const d = hyp(L[i].pos.x, L[i].pos.z, q.pos.x, q.pos.z); if (d < bd) { bd = d; best = L[i]; } }
    return best;
  }
  function scatter(S) {
    if (S.mobId) return;                       // city/mob.js runs from gunfire itself
    for (let i = 0; i < S.crowd.length; i++) {
      const p = S.crowd[i];
      if (!up(p)) continue;
      letGo(p);
      if (CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(p, S.line.x, S.line.z); } catch (e) {} }
    }
    S.crowd.length = 0;
  }

  /* ---- THE SQUAD --------------------------------------------------------- */
  function spawnSoldier(S, x, z, officer) {
    const PP = CBZ.islandPeople;
    if (!PP || !PP.spawnAt) return null;
    let p = null;
    try { p = PP.spawnAt(x, z, { job: "soldier", kind: "civilian", armed: true, weapon: "AK-47", aggr: 0.45, hp: 140 }); } catch (e) { p = null; }
    if (!p) return null;
    p.organization = "military"; p.organizationLoyalty = 100;
    p.milRank = officer ? 4 : 1;
    p._fireSquad = S; p._fireSpawned = true;
    if (officer && p.name) p.name = "Capt. " + String(p.name).split(" ").pop();
    return p;
  }
  function military(p) { return !!(p && (p.organization === "military" || p.job === "soldier")); }
  function citySquad(px, pz) {
    const L = (CBZ.cityMilitaryPersonnel || []).concat(CBZ.cityPeds || []);
    const seen = new Set(), men = [];
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (!up(p) || !military(p) || p.inCar || p.companion || p._turned) continue;
      if (hyp(p.pos.x, p.pos.z, px, pz) > SQUAD_R) continue;
      men.push(p);
    }
    if (men.length < 3) return null;
    men.sort(function (a, b) { return (b.milRank || 0) - (a.milRank || 0); });
    return { officer: men[0], soldiers: men.slice(1, 7) };
  }

  /* ---- BEGIN ------------------------------------------------------------- */
  function base(kind) {
    return { kind: kind, stage: "", t: 0, stageT: 0, crowd: [], soldiers: [], officer: null, followers: [], firing: new Set(),
      chantT: 2, mobId: null, rec: null, at: null, line: null, door: null, tx: 1, tz: 0, ox: 0, oz: 1 };
  }
  function beginIsles() {
    const A = g.isleArmy, C = CBZ.islandCivic;
    const H = C && C.halls ? C.halls().find(function (h) { return h && h.b && h.bounds && onIslandOf(h.b); }) : null;
    if (!H || !CBZ.islandFit || !CBZ.islandFit.frame) return false;
    const F = CBZ.islandFit.frame(H.b), Z0 = H.bounds.Z0;
    const s = base("isles");
    s.door = F.w(0, Z0 - 0.5);
    s.line = F.w(0, Z0 - 4.5);
    s.at = F.w(0, Z0 - 13);
    // out of the doors (local -z) and across them
    const yaw = F.yaw || 0;
    s.ox = -Math.sin(yaw); s.oz = -Math.cos(yaw);
    s.tx = s.oz; s.tz = -s.ox;
    s.hall = H;
    if (!formIsleCrowd(s)) { for (const p of s.crowd) letGo(p); return false; }
    // the captain and three men, out of sight, walking to their line
    const q = unseenNear(s.line.x, s.line.z, 40, 85);
    if (!q) { for (const p of s.crowd) letGo(p); return false; }
    const off = spawnSoldier(s, q.x, q.z, true);
    if (!off) { for (const p of s.crowd) letGo(p); return false; }
    s.officer = off;
    for (let i = 0; i < 3; i++) {
      const m = spawnSoldier(s, q.x + (i - 1) * 1.2, q.z + 1.2, false);
      if (m) { m._cmdBy = off; s.soldiers.push(m); }
    }
    s.officer.controlled = true;
    placeSquad(s);
    A.protestDay = day();
    S = s; go(s, "gather");
    return true;
  }
  function squadSpot(s, i) {
    const lat = (i - (s.soldiers.length - 1) / 2) * 1.6;
    return { x: s.line.x + s.tx * lat, z: s.line.z + s.tz * lat };
  }
  function placeSquad(s) {
    for (let i = 0; i < s.soldiers.length; i++) { const p = squadSpot(s, i); walkTo(s.soldiers[i], p.x, p.z); s.soldiers[i]._fireSlot = p; }
    const b = { x: s.line.x - s.ox * 2.2, z: s.line.z - s.oz * 2.2 };
    walkTo(s.officer, b.x, b.z); s.officer._fireSlot = b;
  }
  function beginCity(mob) {
    const p = P();
    const sq = citySquad(p.pos.x, p.pos.z);
    if (!sq) return false;
    const s = base("city");
    s.mobId = mob.id;
    s.at = { x: mob.centroid.x, z: mob.centroid.z };
    s.line = { x: p.pos.x, z: p.pos.z };
    s.officer = sq.officer; s.soldiers = sq.soldiers;
    for (const m of s.soldiers) m._cmdBy = s.officer;
    DONE_MOBS.add(mob.id);
    cityCD = CITY_CD;
    S = s; go(s, "approach");
    return true;
  }
  function go(s, stage) { s.stage = stage; s.stageT = 0; }

  /* ---- THE ORDER --------------------------------------------------------- */
  const ANSWERS = [
    { id: "fire", dir: "up", label: "Fire" },
    { id: "lower", dir: "left", label: "Lower your weapon" },
    // the wrong thing to do with an armed officer at your shoulder: he draws
    // the moment you do it (CBZ.cinematicShoot)
    { id: "turn", dir: "right", label: "Turn on him", fatal: true },
  ];
  function ask(s) {
    const C = CBZ.command, off = s.officer;
    go(s, "ask");
    standAt(off, P().pos.x, P().pos.z);
    // the men who would carry his order against you, read before you answer:
    // they are the ones who stand with him if you turn
    s.followers = [];
    if (C && C.decide) {
      for (const m of s.soldiers) {
        if (!up(m)) continue;
        let d = null;
        try { d = C.decide(off, m, "kill", PA(), { game: "city" }); } catch (e) { d = null; }
        if (d && d.answer === "obey") s.followers.push(m);
      }
    }
    const pr = C && C.bigOrder ? C.bigOrder(off, "Fire on them. That's an order.", ANSWERS, {
      actor: off, timeout: 7, drawn: armed(), followers: s.followers, silent: { line: "Coward.", as: "lower" },
    }) : null;
    if (!pr || !pr.then) { answer(s, "lower"); return; }
    pr.then(function (v) { if (S === s && s.stage === "ask") answer(s, v || "lower"); });
  }
  function aim(q, t) {
    if (!up(q) || !t || t.dead) return false;
    if (CBZ.cityBrain && CBZ.cityBrain.unholster) { try { CBZ.cityBrain.unholster(q); } catch (e) {} }
    q.controlled = false; q.staffPost = null; q.pause = 0; q.fear = 0; q.surrender = false;
    q._drawWhy = { why: "order", by: "officer", target: t };
    if (typeof CBZ.npcDrawReason === "function") { try { CBZ.npcDrawReason(q, "order", t); } catch (e) {} }
    if (q.armed && q.ammo != null && q.ammo < 8) q.ammo = 60;
    if (CBZ.cityBrain && CBZ.cityBrain.exec && CBZ.cityBrain.exec.verb) { try { CBZ.cityBrain.exec.verb("attack", q, t); } catch (e) {} }
    q.rage = t; q.state = "fight";
    return true;
  }
  // the order goes down the line; each man answers it (systems/command.js)
  function orderLine(s, delta) {
    const C = CBZ.command, t0 = nearestTarget(s, s.officer);
    if (!t0) return null;
    const men = s.soldiers.filter(up);
    if (!C || !C.issue || !men.length) return null;
    return C.issue(s.officer, men, "kill", t0, { game: "city", say: false, delta: delta,
      exec: function (q) { if (!aim(q, nearestTarget(s, q) || t0)) return false; s.firing.add(q); return true; } });
  }
  function answer(s, v) {
    const off = s.officer;
    if (v === "fire") {
      orderLine(s, 0.06);
      go(s, "fire");
      scatterSoon(s);
      if (CBZ.news && CBZ.news.push) {
        try { CBZ.news.push(onIsles() ? "Soldiers open fire on protesters at the town hall" : "Soldiers open fire on protesters", { cat: "SECURITY", phone: true }); } catch (e) {}
      }
      return;
    }
    if (v === "turn") {
      // the men who would not carry his order are with you now
      for (const m of s.soldiers) {
        if (!up(m) || s.followers.indexOf(m) >= 0) continue;
        aim(m, off);
      }
      discharge("mutiny");
      if (CBZ.cityAddStars) { try { CBZ.cityAddStars(3, "mutiny"); } catch (e) {} }
      if (CBZ.news && CBZ.news.push) { try { CBZ.news.push("Soldiers turn on their officer", { cat: "SECURITY", phone: true }); } catch (e) {} }
      scatterSoon(s);
      go(s, "after");
      return;
    }
    // LOWER YOUR WEAPON (or nothing at all): your no is down the line before
    // theirs, and then he deals with you
    orderLine(s, -0.16);
    go(s, s.firing.size ? "fire" : "cm");
    if (s.firing.size) scatterSoon(s);
    courtMartial(s);
  }
  function scatterSoon(s) { s.scatterAt = s.t + 0.6; }
  function courtMartial(s) {
    const C = CBZ.command, off = s.officer;
    const loyal = s.followers.slice();
    s.rec = C && C.toPlayer ? C.toPlayer(off, "drop", {
      complied: function () { return !armed(); },
      patience: [4, 4, 3], maxDist: 80,
      lines: ["Drop your weapon, Private.", "Drop it!", "Last chance."],
      alive: function () { return up(off) && S === s; },
      // he would not drop it: the men who still take the officer's word put
      // him on the ground, hands, not rounds
      onForce: function () {
        for (const m of loyal) {
          if (!up(m)) continue;
          if (CBZ.cityBrain && CBZ.cityBrain.holster) { try { CBZ.cityBrain.holster(m); } catch (e) {} }
          s.firing.delete(m);
          m.controlled = false; m.rage = PA(); m.state = "fight";
        }
      },
      onDone: function (r, out) {
        discharge("court martial");
        if (out === "complied") say(off, "You're done.", 2);
        if (S === s && s.stage === "cm") go(s, "after");
      },
    }) : null;
    if (!s.rec) discharge("court martial");
  }

  /* MUTINY (systems/command.js): the men under the officer have carried and
     refused enough and think little of him. The sour ones turn on him. */
  if (CBZ.command && CBZ.command.on) CBZ.command.on("mutiny", function (m) {
    if (!S || !m || m.from !== S.officer) return;
    const men = m.men || [];
    for (let i = 0; i < men.length; i++) { if (up(men[i])) { S.firing.delete(men[i]); aim(men[i], S.officer); } }
    if (m.leader && CBZ.voice && CBZ.voice.say) { try { CBZ.voice.say(m.leader, "turn", { order: "kill", force: true }); } catch (e) {} }
  });

  /* ---- THE SCENE, STEP BY STEP ------------------------------------------ */
  function end() {
    const s = S;
    if (!s) return;
    S = null;
    if (s.rec && CBZ.command && CBZ.command.cancelPlayer && up(s.officer)) { try { CBZ.command.cancelPlayer(s.officer); } catch (e) {} }
    for (const p of s.crowd) letGo(p, s);
    const sq = [s.officer].concat(s.soldiers);
    const PP = CBZ.islandPeople;
    for (const p of sq) {
      if (!p || p.dead) continue;
      const mine = p.rage && (targets(s).indexOf(p.rage) >= 0);
      if (mine) { p.rage = null; if (p.state === "fight") p.state = "idle"; }
      const spawned = p._fireSpawned;
      letGo(p, s);
      // the islands' squad came for this; it walks back out of the world,
      // and is taken away only where nobody sees it (systems/leave.js)
      if (spawned && !p.rage && CBZ.leave && CBZ.leave.go) {
        try { CBZ.leave.go(p, { tag: "fireorder", remove: PP && PP.despawn ? function (b) { PP.despawn(b); } : undefined }); } catch (e) {}
      }
    }
  }
  function step(s, dt) {
    s.t += dt; s.stageT += dt;
    const pl = P();
    if (!pl || pl.dead || (!up(s.officer) && s.stage !== "after" && s.stage !== "fire")) { end(); return; }
    if (s.kind === "isles" && !onIsles()) { end(); return; }
    if (s.scatterAt && s.t >= s.scatterAt) { s.scatterAt = 0; scatter(s); }
    if (s.stage === "gather") {
      const there = holdCrowd(s, dt);
      let ready = 0;
      for (const p of [s.officer].concat(s.soldiers)) {
        if (!up(p)) continue;
        if (hyp(p.pos.x, p.pos.z, p._fireSlot.x, p._fireSlot.z) < 1) { standAt(p, s.at.x, s.at.z); ready++; }
        else if (p.state !== "walk") walkTo(p, p._fireSlot.x, p._fireSlot.z);
      }
      if (there >= 5 && ready >= 3) {
        // fall in, Private
        const C = CBZ.command, A = g.isleArmy, off = s.officer;
        go(s, "summon");
        s.rec = C && C.toPlayer ? C.toPlayer(off, "go", {
          at: { x: s.line.x, z: s.line.z }, maxDist: 400,
          complied: function () { return hyp(pl.pos.x, pl.pos.z, s.line.x, s.line.z) < 6; },
          patience: [90, 60, 40],
          lines: ["Private! Fall in.", "Fall in, Private.", "Now, Private."],
          alive: function () { return S === s && up(off); },
          onDone: function (r, out) {
            s.rec = null;
            if (S !== s) return;
            if (out === "complied") ask(s);
            else { if (A && g.isleArmy === A && out !== "cancelled" && out !== "dead") A.strikes = (A.strikes | 0) + 1; end(); }
          },
        }) : null;
        if (!s.rec) end();
      } else if (s.stageT > 90) end();
      return;
    }
    if (s.stage === "summon") { holdCrowd(s, dt); return; }
    if (s.stage === "approach") {
      const off = s.officer, d = hyp(off.pos.x, off.pos.z, pl.pos.x, pl.pos.z);
      if (d <= ASK_R) { ask(s); return; }
      if (s.stageT > 40 || !targets(s).length) { end(); return; }
      s.walkT = (s.walkT || 0) - dt;
      if (s.walkT <= 0) { s.walkT = 0.5; walkTo(off, pl.pos.x, pl.pos.z); }
      return;
    }
    if (s.stage === "ask") { if (s.kind === "isles") holdCrowd(s, dt); return; }
    if (s.stage === "fire") {
      // every man firing keeps firing, the next one when his is down
      s.firing.forEach(function (q) {
        if (!up(q)) { s.firing.delete(q); return; }
        if (q.rage && q.rage.dead !== true && targets(s).indexOf(q.rage) >= 0) return;
        if (q.rage === PA() || q.rage === s.officer) { s.firing.delete(q); return; }
        const t = nearestTarget(s, q);
        if (t) aim(q, t); else s.firing.delete(q);
      });
      if (s.stageT > FIRE_SECS || !s.firing.size) {
        s.firing.forEach(function (q) { if (q.rage && targets(s).indexOf(q.rage) >= 0) { q.rage = null; if (q.state === "fight") q.state = "idle"; } });
        s.firing.clear();
        go(s, s.rec ? "cm" : "after");
      }
      return;
    }
    if (s.stage === "cm") { if (s.stageT > 30) go(s, "after"); return; }
    if (s.stage === "after") { if (s.stageT > 20) end(); }
  }

  /* ---- WHEN ------------------------------------------------------------- */
  function hashDay(d) { let h = (d * 2654435761) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; return (h >>> 8) / 16777216; }
  function look() {
    const pl = P();
    if (!pl || pl.dead || pl.driving || g.busted || (CBZ.cineBusy && CBZ.cineBusy())) return;
    if (soldierIsles()) {
      const A = g.isleArmy, h = hour(), d = day();
      if (A.protestDay === d || h < 10 || h >= 16 || hashDay(d) > 0.5) return;
      const C = CBZ.islandCivic;
      const H = C && C.halls ? C.halls().find(function (x) { return x && x.b && x.bounds && onIslandOf(x.b); }) : null;
      if (!H || !CBZ.islandFit || !CBZ.islandFit.frame) return;
      const F = CBZ.islandFit.frame(H.b), at = F.w(0, H.bounds.Z0 - 8);
      if (hyp(pl.pos.x, pl.pos.z, at.x, at.z) > 160) return;
      if (!beginIsles()) A.protestDay = d;          // no crowd today
      return;
    }
    if (soldierCity() && cityCD <= 0 && CBZ.mob && CBZ.mob.near) {
      let m = null;
      try { m = CBZ.mob.near(pl.pos.x, pl.pos.z, 90); } catch (e) { m = null; }
      if (!m || m.side === "supporters" || DONE_MOBS.has(m.id) || (m.agents | 0) < 10 || m.stage === "disperse") return;
      beginCity(m);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.47, function (dt) {
    if (g.state !== "playing" || !(g.mode === "city" || onIsles())) { if (S) end(); return; }
    dt = Math.min(0.1, dt || 0);
    if (cityCD > 0) cityCD -= dt;
    if (S) { step(S, dt); return; }
    tickT -= dt;
    if (tickT > 0) return;
    tickT = 1;
    look();
  });

  CBZ.fireOrder = {
    state: function () {
      if (!S) return null;
      return { kind: S.kind, stage: S.stage, t: +S.t.toFixed(1), crowd: S.crowd.length, soldiers: S.soldiers.filter(up).length,
        firing: S.firing.size, followers: S.followers.length, officer: S.officer ? S.officer.name || null : null };
    },
    // tests / a director: put the scene up now if there is one to put up
    begin: function (kind) {
      if (S) return false;
      if (kind === "isles" || (kind == null && onIsles())) return soldierIsles() ? beginIsles() : false;
      const pl = P(), m = CBZ.mob && CBZ.mob.near && pl ? CBZ.mob.near(pl.pos.x, pl.pos.z, 90) : null;
      return m ? beginCity(m) : false;
    },
    end: end,
  };
})();
