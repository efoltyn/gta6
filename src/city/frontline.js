/* ============================================================
   city/frontline.js — THE GROUND WAR IS FOUGHT, IN THE WORLD.

   Every day a war is on, the two armies meet on the ground in ONE battle at
   the front (the war's front point, between the two capitals, pushed by how
   the war is going), and the battle decides it: who died (one for one off
   polwar's counted soldiers), who held the ground (the front moves by how
   decisive it was), and how much the country can stand (war-weariness grows
   with its dead).

   THE BATTLE IS FOUGHT BY THE BATTLE CORE, ON THE CITY'S OWN GROUND
   (city/army.js: NPC War's core, sim and unit kit hosted by Gang City). Each
   nation's committed men come out as a FORCE through CBZ.army.spawnForce: its
   soldiers (training and rifles read off the nation's wealth and readiness),
   its vehicles (a rich army rides Bradleys with Abrams in support, a middling
   one Strykers, a poor one technicals), its attack helicopter when it still
   has the airframes. The nation whose ground it is holds; the other attacks
   (CBZ.army.orderForce). Near the player they are full men and machines;
   off-screen the same battle is fought by the core's MID / FAR tiers. Nothing
   is rolled: the dead are the bodies on the ground.

   (This file used to open games/battle.html in an iframe over a frozen city,
   or resolve the day with a headless attrition model. Both are gone: the
   battle is in the world, where the President can drive to it.)

   THE PRESIDENT (Situation Room map, F: Front): today's battle is marked on
   his map; if it has not started it starts now. He goes there like anywhere
   else, and his own nation's men are on his side while the enemy's shoot him.

   EVENTS (CBZ.presidency.emit, read by city/newsroom.js):
     battle-started {warId, a, aName, b, bName, where, ground, watched, text}
     battle-ended   {warId, winner, winnerName, loser, loserName, dead:{id:n},
                     where, ground, watched, shift, text}

   PUBLIC: CBZ.frontline = { dayOfBattle, specFor, apply, go, canGo, status,
     battles, foughtOn, groundAt, unitsFor }
   LOAD: after city/warroom.js (reads polwar, polity, warroom, presidency
   lazily). polwar.js calls dayOfBattle() from its daily tick.
============================================================ */
(function () {
  "use strict";
  const W0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W0.CBZ;
  if (!CBZ || CBZ.frontline) return;

  // ---------------------------------------------------------------- tuning
  const COMMIT_FRAC = 0.12;      // of a nation's soldiers on the line on any one day
  const COMMIT_MIN = 8, COMMIT_MAX = 150;
  const SHIFT_BASE = 0.012, SHIFT_DECISIVE = 0.036;  // front moves 1..5% of the way per battle
  const FATIGUE_DEAD = 30;       // weariness per "whole army" of dead
  const FATIGUE_LOSS = 2;        // and for losing the day
  const HOLD_BACK = 120;         // m: the holder digs in this far back from the front point, on its own side
  const ATTACK_BACK = 520;       // m: the attacker forms up this far back and comes across
  const FIGHT_CAP = 360;         // s of contact before the field is called on what is left
  const QUIET_CAP = 600;         // s without contact: nobody found anybody, no ground changes
  const CLEAR_AFTER = 120;       // s after the call before the field is cleared (when nobody is watching)
  const WATCH_R = 450;           // m: the player this close is watching

  function clamp(lo, hi, v) { return v < lo ? lo : v > hi ? hi : v; }
  function PW() { return CBZ.polwar || null; }
  function polGet(id) { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; }
  function nameOf(id) { const r = id ? polGet(id) : null; return (r && r.name) || id || ""; }
  // "Kingdom of Kesh" -> "Kesh": the word a soldier would say
  function shortName(id) {
    const n = String(nameOf(id)).replace(/^the\s+/i, "");
    if (!/\s/.test(n)) return n;                     // "The Republic" -> "Republic"
    return n.replace(/^(republic|kingdom|federation|empire|state|union|commonwealth)\s+of\s+/i, "")
      .replace(/\s+(federation|republic|kingdom)$/i, "") || n;
  }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function emit(evt, payload) {
    const P = CBZ.presidency;
    if (P && typeof P.emit === "function") { try { P.emit(evt, payload); } catch (e) {} }
  }
  function hashStr(s) {
    let h = 2166136261; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  /* ============================================================ THE GROUND
     What kind of ground the front is on, for the news ("in the snow"). */
  function groundAt(x, z) {
    const P = CBZ.polity;
    let rec = null;
    try { rec = P && P.of ? P.of(x, z) : null; } catch (e) { rec = null; }
    if (rec && rec.kind === "city") return "city";
    let b = null;
    try { b = CBZ.cityBiomeAt ? CBZ.cityBiomeAt(x, z) : null; } catch (e) { b = null; }
    if (b === "snow") return "snow";
    if (b === "desert") return "dunes";
    if (b === "forest" || b === "farmland" || b === "wilds" || b === "grass") return "grass";
    if (b === "city" || b === "town") return "city";
    return "open ground";
  }
  function placeName(x, z) {
    const P = CBZ.polity; if (!P || !P.of) return null;
    try { const r = P.of(x, z); return r && r.name ? r.name : null; } catch (e) { return null; }
  }
  function nationAt(x, z) {
    const WR = CBZ.warroom;
    if (WR && WR.nationAt) { try { return WR.nationAt(x, z); } catch (e) {} }
    return null;
  }

  /* ============================================================ THE ARMIES
     What a nation sends is read off what it is. Training from wealth and
     readiness (a rich, ready army fields soldiers; a poor one fields men with
     rifles), the rifle from wealth (carbines and optics, or the AK). */
  function tierOf(mil, wealth) {
    const s = 0.55 * wealth + 0.45 * (mil ? mil.readiness : 0.5);
    return s >= 0.72 ? "elite" : s >= 0.5 ? "pro" : "thug";
  }
  function gunsOf(wealth) {
    if (wealth >= 0.8) return "carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine";
    if (wealth >= 0.5) return "ak47,carbine,ak47,lmg,ak47,ak47,sniper,ak47,carbine,bazooka";
    return "ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47";
  }
  function wealthOf(id) {
    const r = polGet(id);
    if (r && r.wealthLevel != null) return clamp(0, 1, +r.wealthLevel);
    return id === "republic" ? 1 : 0.5;
  }
  function committed(mil) {
    const s = Math.max(0, Math.floor(mil ? mil.soldiers : 0));
    if (s <= 0) return 0;
    return Math.min(s, clamp(COMMIT_MIN, COMMIT_MAX, Math.round(s * COMMIT_FRAC)));
  }
  /* WHAT THE MEN RIDE (src/units/vehicles: real crews and benches). The men
     are the crews and the dismounts: the force's own crew plan seats drivers
     first, then gunners and commanders, then the benches.
       rich (wealth >= 0.8)   a mechanised team: an M2 Bradley (3 crew + 6) per
                              nine men, an M1 Abrams (4 crew) for every three
                              Bradleys, and an AH-64 when the nation still has
                              the airframes (three or more aircraft)
       middling (>= 0.5)      Strykers (2 crew + 9) per eleven men and a Humvee
       poor                   technicals (a pickup with a mounted gun) for a
                              third of the men; the rest walk
     Capped for the frame: six carriers, two tanks a side. */
  function unitsFor(id, n, mil) {
    const wl = wealthOf(id);
    const out = [];
    if (n <= 0) return out;
    if (wl >= 0.8) {
      const nb = Math.min(6, Math.floor(n / 9)), nt = Math.min(2, Math.floor(nb / 3) + (n >= 30 ? 1 : 0));
      if (nt) out.push("m1_abrams*" + nt);
      if (nb) out.push("bradley_ifv*" + nb);
      if (mil && mil.planes >= 3 && n >= 20) out.push("ah64_apache*1");
    } else if (wl >= 0.5) {
      const ns = Math.min(6, Math.floor(n / 11));
      if (ns) out.push("stryker_apc*" + ns);
      if (n >= 12) out.push("hmmwv*1");
    } else {
      const nt = Math.min(6, Math.floor(n / 15));
      if (nt) out.push("technical*" + nt);
    }
    out.push("men*" + n);
    return out;
  }

  /* ============================================================ THE SPEC
     The battle, as data: where, who holds, and each side's men. */
  function battlePoint(war) {
    const f = war.fronts && war.fronts[0];
    const W = PW();
    if (f && f.real) return { x: f.x, z: f.z };
    const a = W && W.anchorOf ? W.anchorOf(war.sides[0]) : null;
    const b = W && W.anchorOf ? W.anchorOf(war.sides[1]) : null;
    if (!a || !b) return f ? { x: f.x, z: f.z } : { x: 0, z: 0 };
    // position -> 1 means sides[0] is winning: the line is pushed toward sides[1]
    const t = clamp(0.06, 0.94, f ? f.position : 0.5);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }
  function anchor(id, pt) {
    const W = PW();
    const a = W && W.anchorOf ? W.anchorOf(id) : null;
    if (a && isFinite(a.x) && Math.hypot(a.x - pt.x, a.z - pt.z) > 1) return a;
    return { x: pt.x + (hashStr(id) % 2 ? 1000 : -1000), z: pt.z };
  }
  function specFor(war, d, opts) {
    opts = opts || {};
    const W = PW();
    if (!war || war.ended || !W || !W.militaryOf) return null;
    const ids = war.sides.slice();
    const you = opts.you && ids.indexOf(opts.you) >= 0 ? opts.you : null;
    const redId = you || ids[0], blueId = redId === ids[0] ? ids[1] : ids[0];
    const pt = battlePoint(war);
    const f = war.fronts && war.fronts[0];
    const pos = f ? f.position : 0.5;
    // WHO HOLDS: the nation whose ground it is; else the side the line has
    // been pushed back on; else whoever did not start it
    let holder = nationAt(pt.x, pt.z);
    if (ids.indexOf(holder) < 0) holder = pos > 0.52 ? ids[1] : pos < 0.48 ? ids[0] : (war.aggressor === ids[0] ? ids[1] : ids[0]);
    const side = function (id) {
      const mil = W.militaryOf(id), wl = wealthOf(id), n = committed(mil);
      return { id: id, name: shortName(id), full: nameOf(id), n: n, tier: tierOf(mil, wl), guns: gunsOf(wl), units: unitsFor(id, n, mil) };
    };
    const red = side(redId), blue = side(blueId);
    if (!red.n && !blue.n) return null;
    return {
      v: 2, warId: war.id, day: d, ground: groundAt(pt.x, pt.z), where: placeName(pt.x, pt.z) || null,
      x: Math.round(pt.x), z: Math.round(pt.z),
      hold: holder === redId ? "red" : "blue",
      you: you ? "red" : null,
      red: red, blue: blue,
    };
  }

  /* ============================================================ APPLY
     What the battle did to the war. Dead are polwar's soldiers, one for one
     (and, for the republic, the city's finite headcount — polwar's own
     casualties()). The front moves toward the loser by how decisive it was.
     Each country's weariness grows with its dead and with losing the day. */
  function apply(war, spec, res) {
    const W = PW();
    if (!war || war.ended || !W || !spec || !res) return null;
    const idOf = function (t) { return spec[t].id; };
    const winT = res.winner === "red" || res.winner === "blue" ? res.winner : null;
    const loseT = winT ? (winT === "red" ? "blue" : "red") : null;
    const out = { dead: {}, winner: winT ? idOf(winT) : null, loser: loseT ? idOf(loseT) : null, shift: 0 };
    ["red", "blue"].forEach(function (t) {
      const id = idOf(t), n = Math.max(0, Math.round(res.dead[t] || 0));
      out.dead[id] = n;
      if (n > 0) {
        if (W.casualties) W.casualties(id, n);
        else { const mil = W.militaryOf(id); mil.soldiers = Math.max(0, mil.soldiers - n); mil.warDead = (mil.warDead || 0) + n; }
      }
      const mil = W.militaryOf(id);
      const seed = Math.max(1, (mil && mil.seedSoldiers) || 100);
      war.fatigue[id] = (war.fatigue[id] || 0) + FATIGUE_DEAD * n / seed + (t === loseT ? FATIGUE_LOSS : 0);
    });
    const d = spec.day != null ? spec.day : day();
    const where = spec.where || null;
    let text;
    if (winT) {
      const lossW = (res.dead[winT] + (res.fled[winT] || 0)) / Math.max(1, spec[winT].n);
      const lossL = (res.dead[loseT] + (res.fled[loseT] || 0)) / Math.max(1, spec[loseT].n);
      const decisive = clamp(0, 1, (lossL - lossW) * 1.4);
      out.shift = SHIFT_BASE + SHIFT_DECISIVE * decisive;
      const verb = spec.hold === winT ? "holds" : "takes";
      text = spec[winT].name + " " + verb + " the line" + (where ? " at " + where : "") + ", " +
        (out.dead[idOf(loseT)] | 0) + " " + spec[loseT].name + " dead";
    } else {
      text = "No ground changes hands" + (where ? " at " + where : "");
    }
    war.log.push({ day: d, kind: "battle", text: text, winner: out.winner, dead: out.dead, ground: spec.ground, watched: !!res.watched });
    emit("battle-ended", {
      warId: war.id, winner: out.winner, winnerName: out.winner ? nameOf(out.winner) : null,
      loser: out.loser, loserName: out.loser ? nameOf(out.loser) : null,
      dead: out.dead, where: where, ground: spec.ground, watched: !!res.watched, shift: out.shift, day: d,
      headline: text, text: text,
    });
    if (winT && out.shift > 0) {
      if (W.pushFront) W.pushFront(war.id, out.winner, out.shift);
    }
    return out;
  }
  function startedText(spec) {
    const a = spec[spec.hold === "red" ? "blue" : "red"], b = spec[spec.hold];
    return a.name + " attacks " + b.name + (spec.where ? " at " + spec.where : " on the front");
  }
  function emitStarted(war, spec, watched) {
    const text = startedText(spec);
    emit("battle-started", {
      warId: war.id, a: spec.red.id, aName: nameOf(spec.red.id), b: spec.blue.id, bName: nameOf(spec.blue.id),
      where: spec.where, ground: spec.ground, watched: !!watched, day: spec.day, headline: text, text: text,
    });
  }

  /* ============================================================ THE BATTLE
     Two forces through CBZ.army: the holder digs in on its own side of the
     front point, the attacker forms up further back and comes across. The
     battle is called when a side is gone or broken, after FIGHT_CAP seconds
     of contact on what is left, or after QUIET_CAP seconds with no contact. */
  const BATTLES = Object.create(null);     // warId -> battle
  function you() { return CBZ.warroom && CBZ.warroom.nation ? CBZ.warroom.nation() : null; }
  function hostileTo(id) {
    const me = you();
    if (!me) return "never";
    return id === me ? "never" : "always";
  }
  function startBattle(war, spec) {
    const A = CBZ.army;
    if (!A || !A.spawnForce) return null;
    const pt = { x: spec.x, z: spec.z };
    const forces = {};
    ["red", "blue"].forEach(function (t) {
      const S = spec[t];
      if (!S.n) return;
      const home = anchor(S.id, pt);
      const dx = home.x - pt.x, dz = home.z - pt.z, l = Math.hypot(dx, dz) || 1;
      const holds = spec.hold === t;
      const back = holds ? HOLD_BACK : ATTACK_BACK;
      const at = { x: pt.x + dx / l * back, z: pt.z + dz / l * back };
      forces[t] = { at: at, S: S, holds: holds };
    });
    const out = { war: war, spec: spec, day: spec.day, forces: {}, waits: 0, t0: null, contactT: null, called: null, watched: false };
    ["red", "blue"].forEach(function (t) {
      const f = forces[t];
      if (!f) return;
      const other = forces[t === "red" ? "blue" : "red"];
      const face = other ? other.at : pt;
      out.forces[t] = A.spawnForce({
        id: war.id + ":" + spec.day + ":" + t, side: f.S.id, nation: f.S.id, hostile: hostileTo(f.S.id),
        units: f.S.units, training: f.S.tier, gun: f.S.guns, at: f.at, face: face, name: f.S.full,
        order: f.holds ? { type: "hold", at: f.at, face: face } : { type: "attack", at: other ? other.at : pt },
      });
    });
    BATTLES[war.id] = out;
    return out;
  }
  function sideOf(B, t) { const F = B.forces[t]; return F && CBZ.army ? CBZ.army.status(F) : null; }
  function nearPlayer(x, z) {
    const P = CBZ.player;
    return !!(P && P.pos && Math.hypot(P.pos.x - x, P.pos.z - z) < WATCH_R);
  }
  // the war's own clock (seconds of fought time; it stops when the game does)
  function clock() { return CBZ.army && CBZ.army.realm ? CBZ.army.realm.simT : 0; }
  // once a second: is it over, and is the field clear yet
  function watchBattles() {
    const now = clock();
    for (const id in BATTLES) {
      const B = BATTLES[id];
      const r = sideOf(B, "red"), b = sideOf(B, "blue");
      if (!r || !b || !r.ready || !b.ready) {
        if (++B.waits > 120) { clear(B); delete BATTLES[id]; }   // the engine never came up (two minutes of play)
        continue;
      }
      if (B.t0 == null) B.t0 = now;
      if (nearPlayer(B.spec.x, B.spec.z)) B.watched = true;
      if (B.called) {
        if (now - B.called > CLEAR_AFTER && !nearPlayer(B.spec.x, B.spec.z)) { clear(B); delete BATTLES[id]; }
        continue;
      }
      if ((r.contact || b.contact) && B.contactT == null) B.contactT = now;
      const goneR = r.alive === 0 || r.alive <= r.routed, goneB = b.alive === 0 || b.alive <= b.routed;
      const fought = B.contactT != null ? now - B.contactT : 0;
      const quiet = B.contactT == null && now - B.t0 > QUIET_CAP;
      if (!(goneR || goneB || fought > FIGHT_CAP || quiet || B.war.ended)) continue;
      // THE CALL: who still stands on the field
      let winner = null;
      if (goneR && !goneB) winner = "blue";
      else if (goneB && !goneR) winner = "red";
      else if (!quiet) {
        const kr = r.alive - r.routed, kb = b.alive - b.routed;
        const fr = kr / Math.max(1, B.spec.red.n), fb = kb / Math.max(1, B.spec.blue.n);
        if (Math.abs(fr - fb) > 0.15) winner = fr > fb ? "red" : "blue";
        else winner = B.spec.hold;              // nobody broke: the line held
      }
      B.called = now;
      const res = { winner: winner, dead: { red: r.dead, blue: b.dead }, fled: { red: r.fled, blue: b.fled }, watched: B.watched };
      if (!B.war.ended) apply(B.war, B.spec, res);
      // the winner keeps the ground, the loser falls back toward home
      const A = CBZ.army;
      ["red", "blue"].forEach(function (t) {
        const F = B.forces[t], st = t === "red" ? r : b;
        if (!F || !st.alive) return;
        if (t === winner || !winner) A.orderForce(F, { type: "hold", at: { x: st.x, z: st.z } });
        else { const h = anchor(B.spec[t].id, { x: B.spec.x, z: B.spec.z }); A.orderForce(F, { type: "withdraw", at: { x: st.x + (h.x - st.x) * 0.15, z: st.z + (h.z - st.z) * 0.15 } }); }
      });
    }
  }
  function clear(B) {
    const A = CBZ.army;
    if (!A) return;
    ["red", "blue"].forEach(function (t) { if (B.forces[t]) A.disband(B.forces[t]); });
  }
  if (CBZ.onUpdate) {
    let acc = 0;
    CBZ.onUpdate(46.41, function (dt) { acc += dt; if (acc < 1) return; acc = 0; watchBattles(); });
  }

  /* ============================================================ THE DAY
     polwar's daily tick asks this once per war. The battle is the day that
     just ENDED (`day - 1`): if a battle is still being fought it carries on;
     if that day was fought, it is done; otherwise today's battle starts on
     the front. Returns true when a battle decides the ground war. */
  function foughtOn(war, d) {
    const L = war && war.log;
    if (!L) return false;
    for (let i = L.length - 1; i >= 0; i--) if (L[i] && L[i].kind === "battle" && L[i].day === d) return true;
    return false;
  }
  function dayOfBattle(war, newDay) {
    if (!war || war.ended) return false;
    const d = (newDay != null ? newDay : day()) - 1;
    if (BATTLES[war.id] && !BATTLES[war.id].called) return true;       // still being fought
    if (foughtOn(war, d)) return true;
    const spec = specFor(war, d, { you: you() });
    if (!spec) return false;
    // an army with nobody left to send has nothing between the enemy and home
    if (!spec.red.n || !spec.blue.n) {
      const W = PW(), loser = !spec.red.n ? spec.red.id : spec.blue.id;
      const winner = loser === spec.red.id ? spec.blue.id : spec.red.id;
      war.log.push({ day: d, kind: "battle", text: nameOf(winner) + " advances unopposed", winner: winner, dead: {} });
      if (W && W.pushFront) W.pushFront(war.id, winner, 0.12);
      return true;
    }
    if (BATTLES[war.id]) { clear(BATTLES[war.id]); delete BATTLES[war.id]; }   // yesterday's field
    if (!startBattle(war, spec)) return false;
    emitStarted(war, spec, nearPlayer(spec.x, spec.z));
    return true;
  }

  /* ============================================================ THE FRONT
     The President goes. One verb on the Situation Room map (F: Front): the
     battle is marked on his map (and starts if it has not), and he gets there
     the way he gets anywhere. */
  function canGo() {
    const me = you(), W = PW();
    if (!me) return { ok: false, why: "You do not hold the country." };
    const war = W && W.activeWarFor ? W.activeWarFor(me) : null;
    if (!war || war.ended) return { ok: false, why: "We are not at war." };
    const B = BATTLES[war.id];
    if (B && !B.called) return { ok: true, war: war, battle: B };
    if (foughtOn(war, day())) return { ok: false, why: "They fought today. Tomorrow, sir." };
    const spec = specFor(war, day(), { you: me });
    if (!spec || !spec.red.n) return { ok: false, why: "We have nobody left on that line." };
    return { ok: true, war: war, spec: spec };
  }
  function go() {
    const gt = canGo();
    if (!gt.ok) return gt;
    let B = gt.battle;
    if (!B) {
      B = startBattle(gt.war, gt.spec);
      if (!B) return { ok: false, why: "The army is not answering." };
      emitStarted(gt.war, gt.spec, true);
    }
    const M = CBZ.fullMap;
    if (M && M.setWaypoint) { try { M.setWaypoint(B.spec.x, B.spec.z, "The front"); } catch (e) {} }
    return { ok: true, why: "", line: "It's on your map, sir. The line is at " + (B.spec.where || "the front") + "." };
  }

  function status() {
    const me = you(), W = PW();
    const war = me && W && W.activeWarFor ? W.activeWarFor(me) : null;
    const B = war ? BATTLES[war.id] : null;
    return { warId: war ? war.id : null, battle: B ? { day: B.day, x: B.spec.x, z: B.spec.z, called: !!B.called,
      red: sideOf(B, "red"), blue: sideOf(B, "blue") } : null, foughtToday: war ? foughtOn(war, day()) : false };
  }

  CBZ.frontline = {
    dayOfBattle: dayOfBattle, specFor: specFor, apply: apply, canGo: canGo, go: go, status: status,
    groundAt: groundAt, unitsFor: unitsFor, foughtOn: foughtOn,
    battles: function () { return BATTLES; }, _watch: watchBattles,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.frontline;
})();
