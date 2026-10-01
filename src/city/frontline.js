/* ============================================================
   city/frontline.js — THE GROUND WAR IS FOUGHT, NOT ROLLED.

   OWNER: "NPC WAR THE MINIGAME COULD BE A VERY USEFUL ARENA FOR THESE BATTLES
   WHEN THEY ARE ON GROUND. NPC WAR SUCKS NOW BUT IT IS VERY CAPABLE."

   Before this file, city/polwar.js decided a war's ground fighting by dice:
   every day both sides lost the SAME six-times-intensity soldiers whoever they
   were, and the front slid by a combat-power ratio. Now, every day a war is
   on, the two armies meet on the ground in ONE battle, and the battle decides
   it: who died (one for one off polwar's counted soldiers), who held the
   ground (the front moves by how decisive it was), and how much the country
   can stand (war-weariness grows with its dead).

   THE BATTLE IS NPC WAR'S (games/battle.html). The President can go to the
   front from the Situation Room (the map on the table, F: Front). The page
   opens over the city in this same tab, the city frozen behind it, with the
   battle's real parameters: each nation's committed men, their training and
   rifles (read off the nation's wealth and readiness), their colours and
   flag, the ground under the front (sand, snow, fields, a town, a coast), and
   whatever air each side can fly. He watches it as a general (Hold / Advance,
   and his own airstrikes on the enemy line) or takes a rifle and fights in it.
   The page posts the result back here and polwar takes it.

   WHY AN OVERLAY AND NOT IN-PROCESS. NPC War is a 7,000-line page bound to
   its own studio boot (core/studio.js -> microboot), its own renderer, its own
   ground, its own clock. Gang City's loop, ground and camera are different
   machines. Lifting the sim into the city would be a rewrite of both, and a
   full-page handoff costs two city loads (35 s each) and a resume through
   lastPos. A same-tab iframe gets the honest version of "in-process": the city
   never unloads (its state stays live in memory, no save round trip), the
   battle runs its OWN engine at full fidelity, and the result comes back on
   postMessage. The city draws nothing and ticks nothing while it is up
   (g.state "front", CBZ.drawHeld).

   WHEN NOBODY IS WATCHING the same battle is resolved here, headless, by
   resolve() below: the same men, the same training tiers and DPS ladder
   (systems/combat_iq.js TIER_DPS / ROLE, read live), the same page damage
   rule (x1.45, the 12% head x2.2), the same morale (systems/brain.js
   brain.morale.armyStep / manMorale / nerveFor) and the same win rule
   (a side whose every living man has been running for BREAK_GRACE seconds,
   or that is gone, has lost). It is an attrition model of the page's sim,
   not a dice roll: no geometry, but every number it uses is the page's, and
   tools/npcwar-headless.mjs runs the page's own battle in node next to it
   and holds the two to the same winner and the same order of dead.

   EVENTS (CBZ.presidency.emit, read by city/newsroom.js):
     battle-started {warId, a, aName, b, bName, where, ground, watched, text}
     battle-ended   {warId, winner, winnerName, loser, loserName, dead:{id:n},
                     where, ground, watched, shift, text}

   PUBLIC: CBZ.frontline = { dayOfBattle, specFor, resolve, apply, go, canGo,
     open, status, LOOK, groundAt, _close }.
   LOAD: after city/warroom.js (reads polwar, polity, warroom, presidency
   lazily). polwar.js calls dayOfBattle() from its daily tick.
============================================================ */
(function () {
  "use strict";
  const W0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W0.CBZ;
  if (!CBZ || CBZ.frontline) return;
  const g = CBZ.game || (CBZ.game = {});

  // ---------------------------------------------------------------- tuning
  const COMMIT_FRAC = 0.12;      // of a nation's soldiers on the line on any one day
  const COMMIT_MIN = 8, COMMIT_MAX = 150;
  const SHIFT_BASE = 0.012, SHIFT_DECISIVE = 0.036;  // front moves 1..5% of the way per battle
  const FATIGUE_DEAD = 30;       // weariness per "whole army" of dead
  const FATIGUE_LOSS = 2;        // and for losing the day
  const AIR_MATCH_R = 1500;      // m: a strike this close to the battle point lands in the battle
  const BATTLE_CAP = 240;        // s of sim before the field is called on what is left

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
  function mkRng(seed) {
    let s = (seed >>> 0) & 0x7fffffff || 1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ============================================================ THE LOOK
     A NATION'S COLOURS. The flag is never designed here: city/flags.js owns
     every nation's flag and the battle page is handed its picture. `mark` is the bright colour a helmet cover and a smoke
     trail carry so a crane shot still sorts the lines; `cloth` is the
     fatigues. A polity with no row (a rebel fragment) gets colours off its id
     — the same id always gets the same flag. */
  const LOOK = {
    republic: { mark: 0x3f6fd0, cloth: 0x4b5a3c },
    veridia:  { mark: 0x2fae7c, cloth: 0x3f5249 },
    kesh:     { mark: 0xd23a3a, cloth: 0x6b5236 },
    solara:   { mark: 0xf09a2a, cloth: 0x75684a },
    mbeya:    { mark: 0xe0c03a, cloth: 0x3d4a2c },
  };
  function lookOf(id) {
    if (LOOK[id]) return LOOK[id];
    const h = hashStr(id), hue = (h % 360) / 360;
    const hsl = function (hh, s, l) {
      const a = s * Math.min(l, 1 - l), f = function (n) { const k = (n + hh * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
    };
    const hex = function (n) { return "#" + n.toString(16).padStart(6, "0"); };
    return { mark: hsl(hue, 0.6, 0.5), cloth: 0x4d4a3a };
  }

  /* ============================================================ THE GROUND
     What is under the front. NPC War's grounds are the honest ones: the open
     erg (dunes), the same erg under snow, the same rolling ground in grass,
     a real downtown (city), a real coastal strip (harbor). */
  function groundAt(x, z) {
    const P = CBZ.polity;
    let rec = null;
    try { rec = P && P.of ? P.of(x, z) : null; } catch (e) { rec = null; }
    if (rec && rec.kind === "city") return "city";
    const A = CBZ.city && CBZ.city.arena;
    if (A && CBZ.cityAnyRegion) {
      let reg = null;
      try { reg = CBZ.cityAnyRegion(A, x, z, 0); } catch (e) { reg = null; }
      if (!reg) return "harbor";                 // open sea between them: the fight is on a coast
    }
    let b = null;
    try { b = CBZ.cityBiomeAt ? CBZ.cityBiomeAt(x, z) : null; } catch (e) { b = null; }
    if (b === "snow") return "snow";
    if (b === "desert") return "dunes";
    if (b === "forest" || b === "farmland" || b === "wilds" || b === "grass") return "grass";
    if (b === "city" || b === "town") return "city";
    return "dunes";
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
     rifles), the rifle from wealth (carbines and optics, or the AK), and air
     from the planes it still has. */
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

  // THE AIR THE PRESIDENT SENT AT THE FRONT (warroom strikes that landed near
  // the battle point) waits here for the next battle of that war.
  const AIRQ = Object.create(null);      // warId -> { sideId: sticks }

  /* ============================================================ THE SPEC
     The battle, as data: everything games/battle.html needs to fight it and
     everything resolve() needs to fight it without a camera. */
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
  function specFor(war, d, opts) {
    opts = opts || {};
    const W = PW();
    if (!war || war.ended || !W || !W.militaryOf) return null;
    const ids = war.sides.slice();
    const you = opts.you && ids.indexOf(opts.you) >= 0 ? opts.you : null;
    // the President's own nation is RED: the opening crane comes down behind it
    const redId = you || ids[0], blueId = redId === ids[0] ? ids[1] : ids[0];
    const pt = battlePoint(war);
    const ground = opts.ground || groundAt(pt.x, pt.z);
    const f = war.fronts && war.fronts[0];
    const pos = f ? f.position : 0.5;
    // WHO HOLDS: the nation whose ground it is; else the side the line has
    // been pushed back on; else whoever did not start it
    let holder = nationAt(pt.x, pt.z);
    if (ids.indexOf(holder) < 0) holder = pos > 0.52 ? ids[1] : pos < 0.48 ? ids[0] : (war.aggressor === ids[0] ? ids[1] : ids[0]);
    const side = function (id) {
      const mil = W.militaryOf(id), wl = wealthOf(id), L = lookOf(id);
      const q = AIRQ[war.id] && AIRQ[war.id][id] || 0;
      return {
        id: id, name: shortName(id), full: nameOf(id),
        n: committed(mil), tier: tierOf(mil, wl), guns: gunsOf(wl),
        mark: L.mark, cloth: L.cloth,
        // the nation's ONE flag (city/flags.js: custom, regime, authored); the page draws this picture
        flagUrl: CBZ.flags && CBZ.flags.dataURL ? CBZ.flags.dataURL(id, 192) : null,
        // the army flies one bomber over its own line if it still has the planes
        air: mil && mil.planes >= 3 ? "bomber" : "none",
        // the President's own sorties (in the page: his AIR button)
        strikes: id === you ? Math.min(2, Math.max(0, mil ? mil.planes | 0 : 0)) : 0,
        queued: q,
      };
    };
    const red = side(redId), blue = side(blueId);
    if (!red.n && !blue.n) return null;
    return {
      v: 1, warId: war.id, day: d, ground: ground, where: placeName(pt.x, pt.z) || null,
      x: Math.round(pt.x), z: Math.round(pt.z),
      hold: holder === redId ? "red" : "blue",
      you: you ? "red" : null,
      seed: (hashStr(war.id) ^ (d * 2654435761)) >>> 0,
      red: red, blue: blue,
    };
  }

  /* ============================================================ RESOLVE
     THE PAGE'S BATTLE WITHOUT A CAMERA. Per man: his tier's hp, nerve and
     weight; his gun's class and the DPS ladder; per tick, the fraction of
     each line that actually has a man in its sights. Morale is brain.morale
     itself (armyStep per army, manMorale per man, nerveFor per tier), so a
     line breaks here on the same arithmetic it breaks on in the page. */
  // fallbacks so this runs headless in node with no combat_iq loaded — the
  // live tables win whenever they exist (they are the same numbers)
  const TIER_DPS_FB = {
    civ:   { pistol: 4.0,  smg: 5.5,  shotgun: 5.0,  rifle: 6.5,  lmg: 6.0,  sniper: 3.5,  none: 0 },
    thug:  { pistol: 7.0,  smg: 10.0, shotgun: 8.5,  rifle: 13.0, lmg: 11.0, sniper: 6.0,  none: 0 },
    pro:   { pistol: 9.5,  smg: 14.0, shotgun: 11.5, rifle: 17.0, lmg: 15.0, sniper: 8.0,  none: 0 },
    elite: { pistol: 11.5, smg: 19.0, shotgun: 15.0, rifle: 22.0, lmg: 20.0, sniper: 10.0, none: 0 },
    swat:  { pistol: 13.0, smg: 25.0, shotgun: 18.0, rifle: 25.0, lmg: 23.0, sniper: 12.0, none: 0 },
  };
  const ROLE_FB = { civ: { acc: 0.34, nerve: 0.62 }, thug: { acc: 0.46, nerve: 0.42 }, pro: { acc: 0.58, nerve: 0.30 },
    elite: { acc: 0.70, nerve: 0.20 }, swat: { acc: 0.80, nerve: 0.16 } };
  const WEAP_FB = { pistol: { accMul: 0.86, falloff: 0.030, hi: 14 }, smg: { accMul: 0.80, falloff: 0.034, hi: 16 },
    shotgun: { accMul: 1.05, falloff: 0.075, hi: 10 }, rifle: { accMul: 1.00, falloff: 0.018, hi: 26 },
    lmg: { accMul: 0.72, falloff: 0.026, hi: 24 }, sniper: { accMul: 1.30, falloff: 0.006, hi: 46 } };
  const HP = { civ: 90, thug: 100, pro: 120, elite: 140, swat: 160 };       // games/battle.html TRAININGS
  // a line in the page holds past the arithmetic: men are cornered, rally,
  // and mostly die where they stand (MEASURED, tools/npcwar-headless.mjs 6)
  const NERVE_SLACK = 0.14;
  const TIER_W = { civ: 0.7, thug: 0.85, pro: 1.0, elite: 1.25, swat: 1.4 }; // brain.morale MK.TIER_W
  const CLASS_OF = { ak47: "rifle", carbine: "rifle", lmg: "lmg", smg: "smg", uzi: "smg", shotgun: "shotgun",
    sniper: "sniper", sidearm: "pistol", revolver: "pistol", deagle: "pistol", taser: "pistol",
    bazooka: "launcher", glauncher: "launcher", fists: "none" };
  const PAGE_DMG = 1.45 * (1 + 0.12 * 1.2);  // battle.html fireShot: x1.45, 12% heads x2.2
  // how much of a line has a man in its sights once the lines have met, by
  // ground (dunes cut lanes at the crests, a downtown is corners, a coastal
  // apron is open but cluttered), and how fast the lines close. CALIBRATED
  // against the page's own sim run in node (tools/npcwar-headless.mjs 6: the
  // two side by side on seven rosters); the city/harbor rows follow the
  // page's own measurements in buildMap (a downtown fight runs ~90 s with 26
  // a side, closure through real streets ~5 m/s combined).
  const ENGAGE = { dunes: 0.24, snow: 0.24, grass: 0.26, city: 0.09, harbor: 0.16, arena: 0.16, water: 0.24 };
  const CLOSE = { city: 5, harbor: 6.5, arena: 6.5 };   // m/s combined (open ground 8.5: they stop to shoot), one line walks half
  // a man holding the line is down behind something: crest, wall, container
  const HOLD_COVER = { dunes: 0.72, snow: 0.72, grass: 0.78, city: 0.62, harbor: 0.72, arena: 0.66, water: 1 };
  const GAP = { dunes: 150, snow: 150, grass: 150, city: 170, harbor: 170, arena: 120, water: 110 };

  function MOr() { return (CBZ.brain && CBZ.brain.morale) || null; }
  function armyRec() { return { p0: 0, pNow: 0, men0: 0, morale: 1, shock: 0, alive: 0, routing: 0, fled: 0, broken: false, noFightT: 0 }; }
  function armyStep(A, F, dt) {
    const M = MOr();
    if (M && M.armyStep) return M.armyStep(A, F, dt, null);
    A.shock *= Math.exp(-dt / 7);
    const lost = A.p0 > 0 ? Math.max(0, 1 - A.pNow / A.p0) : 0;
    const theirLost = F && F.p0 > 0 ? Math.max(0, 1 - F.pNow / F.p0) : 0;
    A.morale = clamp(0, 1, 1 - lost * 1.5 + theirLost * 0.5 - (A.alive ? A.routing / A.alive : 0) * 0.35 - A.shock);
    if (!A.broken && A.alive >= 2 && A.routing >= A.alive * 0.5) A.broken = true;
    else if (A.broken && A.alive - A.routing > 0 && A.routing < A.alive * 0.25) A.broken = false;
    return null;
  }
  function nerveFor(tier, i) {
    const M = MOr();
    if (M && M.nerveFor) return M.nerveFor(tier, i);
    return (ROLE_FB[tier] || ROLE_FB.pro).nerve + (((i * 37) % 11) - 5) * 0.012;
  }
  function manMorale(army, supp, hf) {
    const M = MOr();
    if (M && M.manMorale) return M.manMorale(army, supp, hf);
    return army - (supp || 0) * 0.16 - (1 - hf) * 0.28;
  }
  function tables() {
    const IQ = CBZ.combatIQ;
    return {
      dps: (IQ && IQ.TIER_DPS) || TIER_DPS_FB,
      role: (IQ && IQ.ROLE) || ROLE_FB,
      weap: (IQ && IQ.WEAP) || WEAP_FB,
    };
  }
  // DPS this man lays on a standing target at fighting range, page rules
  function dpsOf(T, tier, wid, range) {
    const cls = CLASS_OF[wid] || "rifle";
    if (cls === "none") return 0;
    if (cls === "launcher") return 34;                          // a rocket into a knot of men, averaged
    const row = T.dps[tier] || T.dps.pro;
    const base = row[cls] || 0;
    const R = T.role[tier] || T.role.pro, Wp = T.weap[cls] || T.weap.rifle;
    const hit10 = Math.max(0.05, Math.min(0.92, R.acc * Wp.accMul));
    const hitR = Math.max(0.04, hit10 * 0.9 - Wp.falloff * Math.max(0, range - 10));
    return base * PAGE_DMG * (hitR / hit10);
  }
  function rosterOf(S, team, holds, rnd) {
    const guns = String(S.guns || "ak47").split(",");
    const out = [];
    for (let i = 0; i < S.n; i++) {
      const wid = guns[(i * 7 + ((i / guns.length) | 0)) % guns.length] || "ak47";   // battle.html pickGun's own cycle
      out.push({ team: team, i: i, tier: S.tier, wid: wid, hp: HP[S.tier] || 120, maxHp: HP[S.tier] || 120,
        w: TIER_W[S.tier] || 1, nerve: nerveFor(S.tier, i), supp: 0,
        // how far forward he is: an advance has a front rank, a held line does not
        ex: holds ? 0.5 + 0.5 * rnd() : rnd(),
        dead: false, routed: false, fled: false, routT: 0, rallyT: 0 });
    }
    return out;
  }

  function resolve(spec) {
    const rnd = mkRng(spec.seed || 1);
    const T = tables();
    const ground = spec.ground || "dunes";
    const men = { red: rosterOf(spec.red, "red", spec.hold === "red", rnd), blue: rosterOf(spec.blue, "blue", spec.hold === "blue", rnd) };
    const A = { red: armyRec(), blue: armyRec() };
    ["red", "blue"].forEach(function (t) {
      for (const m of men[t]) { A[t].p0 += m.w; A[t].men0++; }
    });
    const hold = spec.hold || null;
    let gap = GAP[ground] || 150;
    const both = CLOSE[ground] || 8.5;
    const closing = hold ? both / 2 : both;     // one line walks, or both do
    const engageMax = ENGAGE[ground] || 0.45;
    const coverK = { red: hold === "red" ? (HOLD_COVER[ground] || 0.6) : 1, blue: hold === "blue" ? (HOLD_COVER[ground] || 0.6) : 1 };
    // the air: the army's own bomber passes, and the President's sorties
    const sticks = { red: [], blue: [] };
    ["red", "blue"].forEach(function (t) {
      const S = spec[t];
      if (S.air === "bomber") for (let s = 24; s < BATTLE_CAP; s += 24) sticks[t].push(s);
      const extra = S.queued | 0;
      for (let k = 0; k < extra; k++) sticks[t].push(14 + k * 11);
      sticks[t].sort(function (a, b) { return a - b; });
    });
    const dt = 0.5;
    let t = 0, winner = null;
    const deadN = { red: 0, blue: 0 }, fledN = { red: 0, blue: 0 };
    const standing = function (team) { return men[team].filter(function (m) { return !m.dead && !m.fled; }); };
    function kill(m) {
      if (m.dead) return;
      m.dead = true; m.hp = 0; deadN[m.team]++;
      const Aa = A[m.team];
      const M = MOr();
      if (M && M.deathShock) M.deathShock(Aa, m.w); else if (Aa.p0 > 0) Aa.shock += 1.8 * m.w / Aa.p0;
    }
    function hurt(m, dmg) {
      if (m.dead || m.fled) return;
      m.hp -= dmg;
      m.supp = Math.min(1.2, m.supp + 0.12);
      if (m.hp <= 0) kill(m);
    }
    while (t < BATTLE_CAP) {
      t += dt;
      // the lines close until they are trading at a rifle's band
      if (gap > 16) gap = Math.max(16, gap - closing * dt);
      const range = Math.max(16, gap);
      const ramp = gap > 70 ? 0 : clamp(0, 1, (70 - gap) / 40);
      // each side's fire, laid down at the same instant: both lines shoot off
      // the men they had at the start of the tick, then the hits land
      const hits = [];
      ["red", "blue"].forEach(function (team) {
        const foe = team === "red" ? "blue" : "red";
        const mine = standing(team), theirs = standing(foe);
        if (!mine.length || !theirs.length) return;
        let fighting = 0;
        for (const m of mine) if (!m.routed) fighting++;
        let foeFight = 0;
        for (const o of theirs) if (!o.routed) foeFight++;
        // the sweep (battle.html HUNT, 3:1 in fighting men) sees and shoots more
        const hunt = fighting >= Math.max(1, foeFight) * 3;
        const eng = engageMax * (hunt ? 1.4 : 1) * ramp;
        for (const m of mine) {
          if (m.routed) continue;
          if (rnd() > eng) continue;
          // a man keeps his mark until it is down or gone (the page's sticky
          // target), so fire concentrates and men FALL instead of a whole line
          // carrying the same scratch
          let o = m.tgt;
          if (!o || o.dead || o.fled) {
            // a new mark: of three men in his sights, the most exposed — the
            // front rank of an advance, or a man already bleeding. Fire lands
            // where the line meets the enemy, so men FALL there (the page's
            // fights are local: a column's leading squad takes the line's fire)
            const score = function (q) { return q.ex * 0.6 + (q.hp / q.maxHp) * 0.4; };
            o = theirs[(rnd() * theirs.length) | 0];
            for (let k = 0, K = hold === foe ? 2 : 5; k < K; k++) {
              const q = theirs[(rnd() * theirs.length) | 0];
              if (q && score(q) < score(o)) o = q;
            }
            m.tgt = o;
          }
          if (!o || o.dead) continue;
          // a man run down and cornered fights at arm's length, where nobody misses
          let dps = dpsOf(T, m.tier, m.wid, m.cornered ? 6 : o.routed ? range * 1.3 : range);
          if (m.supp > 0.5) dps *= 0.75;                                // suppressed shooters shoot worse
          const ck = o.routed ? 1 : coverK[foe];
          hits.push(o, dps * dt * ck * (0.6 + rnd() * 0.8));
        }
        // the bombers: a stick of five on the densest knot of the enemy line
        while (sticks[team].length && sticks[team][0] <= t) {
          sticks[team].shift();
          const live = standing(foe);
          const k = Math.min(live.length, Math.round(1.5 + live.length * 0.05 + rnd() * 2));
          for (let j = 0; j < k; j++) kill(live[(rnd() * live.length) | 0]);
          for (const o of live) if (!o.dead) o.supp = Math.min(1.2, o.supp + 0.5);
        }
      });
      for (let h = 0; h < hits.length; h += 2) hurt(hits[h], hits[h + 1]);
      // morale: the army, then every man on his own nerve
      const fightingOf = function (team) { let n = 0; for (const m of men[team]) if (!m.dead && !m.fled && !m.routed) n++; return n; };
      const fR = fightingOf("red"), fB = fightingOf("blue");
      const hunting = { red: fR > 0 && fR >= Math.max(1, fB) * 3, blue: fB > 0 && fB >= Math.max(1, fR) * 3 };
      ["red", "blue"].forEach(function (team) {
        const Aa = A[team];
        Aa.alive = 0; Aa.routing = 0; Aa.pNow = 0;
        for (const m of men[team]) {
          if (m.dead || m.fled) continue;
          Aa.alive++;
          if (m.routed) Aa.routing++;
          Aa.pNow += m.w * (0.45 + 0.55 * clamp(0, 1, m.hp / m.maxHp));
        }
      });
      armyStep(A.red, A.blue, dt); armyStep(A.blue, A.red, dt);
      ["red", "blue"].forEach(function (team) {
        const Aa = A[team];
        for (const m of men[team]) {
          if (m.dead || m.fled) continue;
          m.supp = Math.max(0, m.supp - dt * 0.28);
          if (m.rallyT > 0) m.rallyT -= dt;
          const eff = manMorale(Aa.morale, m.supp, clamp(0, 1, m.hp / m.maxHp));
          if (!m.routed) {
            if (m.rallyT <= 0 && eff < m.nerve - NERVE_SLACK) { m.routed = true; m.routT = 0; }
          } else {
            m.routT += dt;
            // RUN DOWN AND CORNERED (the page's routCheck): a sweep at 8 m/s
            // catches a man running at 6, and a man caught turns and fights
            // and will not break again for a while — the last stand
            const caught = hunting[team === "red" ? "blue" : "red"] && m.routT > 1.5 && rnd() < (m.hp < m.maxHp * 0.45 ? 0.16 : 0.1);
            if (caught) { m.routed = false; m.rallyT = 12; m.routT = 0; m.cornered = true; }
            else if (m.routT > 4 && eff > m.nerve + 0.16 && m.supp < 0.3) { m.routed = false; m.rallyT = 6; }
            else if (m.routT > 40) { m.fled = true; fledN[team]++; }
          }
        }
        if (Aa.alive > 0 && Aa.alive - Aa.routing <= 0) Aa.noFightT += dt; else Aa.noFightT = 0;
      });
      // the win check: battle.html inFight()
      const inFight = function (team) {
        const Aa = A[team];
        if (Aa.alive > 0 && Aa.alive - Aa.routing <= 0 && Aa.noFightT >= 5) return 0;
        return Aa.alive;
      };
      const r = inFight("red"), b = inFight("blue");
      if (r === 0 || b === 0) { winner = r > 0 ? "red" : b > 0 ? "blue" : null; break; }
    }
    if (!winner) {
      // the cap: whoever holds more of what they brought holds the field
      const kr = A.red.p0 ? A.red.pNow / A.red.p0 : 0, kb = A.blue.p0 ? A.blue.pNow / A.blue.p0 : 0;
      winner = kr >= kb ? "red" : "blue";
    }
    // the men still running when it ended got away
    ["red", "blue"].forEach(function (team) {
      for (const m of men[team]) if (!m.dead && !m.fled && m.routed) { m.fled = true; fledN[team]++; }
    });
    /* NOBODY WINS FOR FREE. An attrition model lets the bigger side's fire
       land and the smaller side's spread to nothing; the page's fights are
       local, and the winner always pays. MEASURED (tools/npcwar-headless.mjs
       6, seven rosters on dunes/snow/fields): the winner buries 0.14..0.45 of
       what the loser buried, 0.28 on the mean. The floor is the low end. */
    if (winner) {
      const L = winner === "red" ? "blue" : "red";
      const floor = Math.min(spec[winner].n - fledN[winner], Math.round(deadN[L] * 0.18));
      if (deadN[winner] < floor) deadN[winner] = floor;
    }
    return { winner: winner, dead: deadN, fled: fledN, secs: Math.round(t), watched: false };
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
    // the President's own sorties cost what a sortie costs
    const used = res.strikesUsed | 0;
    if (used > 0 && spec.you) {
      const us = idOf(spec.you), rec = polGet(us);
      const cost = (CBZ.warroom && CBZ.warroom.STRIKE_COST) || 12000;
      if (rec) rec.treasury = (rec.treasury || 0) - cost * used;
    }
    if (AIRQ[war.id]) delete AIRQ[war.id];
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

  /* ============================================================ THE DAY
     polwar's daily tick asks this once per war. The battle is the day that
     just ENDED (`day - 1`): if the President fought it himself, it is already
     in the log and the war is not fought twice; otherwise it is fought now,
     headless. Returns true when a battle decided the ground war, which is
     polwar's cue to skip its old even-losses dice and its ratio slide. */
  function foughtOn(war, d) {
    const L = war && war.log;
    if (!L) return false;
    for (let i = L.length - 1; i >= 0; i--) if (L[i] && L[i].kind === "battle" && L[i].day === d) return true;
    return false;
  }
  function dayOfBattle(war, newDay) {
    if (!war || war.ended) return false;
    const d = (newDay != null ? newDay : day()) - 1;
    if (foughtOn(war, d)) return true;
    if (OPEN && OPEN.warId === war.id) return true;     // he is out there right now
    const spec = specFor(war, d, null);
    if (!spec) return false;
    // an army with nobody left to send has nothing between the enemy and home
    if (!spec.red.n || !spec.blue.n) {
      const W = PW(), loser = !spec.red.n ? spec.red.id : spec.blue.id;
      const winner = loser === spec.red.id ? spec.blue.id : spec.red.id;
      war.log.push({ day: d, kind: "battle", text: nameOf(winner) + " advances unopposed", winner: winner, dead: {} });
      if (W && W.pushFront) W.pushFront(war.id, winner, 0.12);
      return true;
    }
    emitStarted(war, spec, false);
    const res = resolve(spec);
    apply(war, spec, res);
    return true;
  }

  /* ============================================================ THE FRONT
     The President goes. One verb on the Situation Room map (F: Front); the
     answer comes back from the General like every other war order. */
  let OPEN = null;               // { warId, spec, frame, prevState, at }
  function us() { return CBZ.warroom && CBZ.warroom.nation ? CBZ.warroom.nation() : null; }
  function canGo() {
    const me = us(), W = PW();
    if (!me) return { ok: false, why: "You do not hold the country." };
    const war = W && W.activeWarFor ? W.activeWarFor(me) : null;
    if (!war || war.ended) return { ok: false, why: "We are not at war." };
    if (CBZ.net && CBZ.net.active) return { ok: false, why: "Not today, sir." };
    if (OPEN) return { ok: false, why: "You're already out there." };
    if (typeof document === "undefined") return { ok: false, why: "No way out there." };
    if (foughtOn(war, day())) return { ok: false, why: "They fought today. Tomorrow, sir." };
    const spec = specFor(war, day(), { you: me });
    if (!spec || !spec.red.n) return { ok: false, why: "We have nobody left on that line." };
    return { ok: true, war: war, spec: spec };
  }
  function go() {
    const gt = canGo();
    if (!gt.ok) return gt;
    open(gt.war, gt.spec);
    return { ok: true, why: "", line: "The helicopter's waiting." };
  }
  function b64(s) {
    try { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
    catch (e) { return ""; }
  }
  function open(war, spec) {
    if (OPEN || typeof document === "undefined") return false;
    const f = document.createElement("iframe");
    f.id = "frontBattle";
    f.title = "The front";
    f.setAttribute("allow", "fullscreen; autoplay");
    f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:100000;background:#0b0d10;";
    f.src = "games/battle.html?v=front0930&front=" + b64(JSON.stringify(spec));
    OPEN = { warId: war.id, spec: spec, frame: f, prevState: g.state, at: Date.now() };
    // THE CITY HOLDS ITS BREATH: no updaters (state), no draw (drawHeld), and
    // the cursor goes to the battle. The state changes BEFORE the lock drops,
    // so camera.js's lock-loss handler does not read it as a pause.
    if (CBZ.setState) CBZ.setState("front"); else g.state = "front";
    CBZ.drawHeld = true;
    // and goes quiet: the battle has its own sound
    try { const ac = CBZ.getAudioCtx && CBZ.getAudioCtx(); if (ac && ac.state === "running" && ac.suspend) ac.suspend(); } catch (e) {}
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
    document.body.appendChild(f);
    try { f.focus(); } catch (e) {}
    emitStarted(war, spec, true);
    return true;
  }
  function close() {
    if (!OPEN) return;
    const o = OPEN; OPEN = null;
    try { if (o.frame && o.frame.parentNode) o.frame.parentNode.removeChild(o.frame); } catch (e) {}
    CBZ.drawHeld = false;
    try { const ac = CBZ.getAudioCtx && CBZ.getAudioCtx(); if (ac && ac.state === "suspended" && ac.resume) ac.resume(); } catch (e) {}
    const back = o.prevState === "playing" || !o.prevState ? "playing" : o.prevState;
    if (CBZ.setState) CBZ.setState(back); else g.state = back;
    if (back === "playing" && CBZ.requestLock) { try { CBZ.requestLock(); } catch (e) {} }
  }
  // THE PAGE ANSWERS. {type:"cbz-front", kind:"end"|"leave", winner, dead,
  // fled, alive, strikesUsed, youDown, secs}
  function onResult(msg) {
    if (!OPEN || !msg) return;
    const o = OPEN;
    const W = PW();
    const war = W && W.allWars ? (W.allWars({ all: true }).find(function (w) { return w.id === o.warId; }) || null) : null;
    let res = {
      winner: msg.winner === "red" || msg.winner === "blue" ? msg.winner : null,
      dead: { red: msg.dead && msg.dead.red | 0 || 0, blue: msg.dead && msg.dead.blue | 0 || 0 },
      fled: { red: msg.fled && msg.fled.red | 0 || 0, blue: msg.fled && msg.fled.blue | 0 || 0 },
      secs: msg.secs | 0, watched: true, strikesUsed: msg.strikesUsed | 0,
    };
    if (msg.kind === "leave" || !res.winner) {
      // HE LEFT BEFORE IT WAS OVER: the rest is fought without him, from the
      // men actually still standing out there
      const rest = JSON.parse(JSON.stringify(o.spec));
      rest.red.n = Math.max(0, (msg.alive && msg.alive.red) | 0);
      rest.blue.n = Math.max(0, (msg.alive && msg.alive.blue) | 0);
      rest.red.air = rest.blue.air = "none"; rest.red.queued = rest.blue.queued = 0;
      rest.seed = (o.spec.seed ^ 0x9e3779b9) >>> 0;
      if (rest.red.n && rest.blue.n) {
        const r2 = resolve(rest);
        res.winner = r2.winner;
        res.dead.red += r2.dead.red; res.dead.blue += r2.dead.blue;
        res.fled.red += r2.fled.red; res.fled.blue += r2.fled.blue;
      } else res.winner = rest.red.n ? "red" : rest.blue.n ? "blue" : null;
    }
    if (war && !war.ended) {
      apply(war, o.spec, res);
      // THE PRESIDENT WAS HIT out there: carried off, and the country hears it
      if (msg.youDown) {
        const me = o.spec.red.id;
        if (CBZ.approvalShock) { try { CBZ.approvalShock(me, 4); } catch (e) {} }
        emit("president-wounded", { nation: me, headline: "The President is wounded at the front", text: "The President is wounded at the front" });
        const P = CBZ.player;
        if (P && isFinite(P.hp) && isFinite(P.maxHp)) P.hp = Math.max(1, Math.min(P.hp, Math.round(P.maxHp * 0.3)));
      }
    }
    close();
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("message", function (e) {
      const d = e && e.data;
      if (!d || d.type !== "cbz-front" || !OPEN) return;
      if (OPEN.frame && e.source && e.source !== OPEN.frame.contentWindow) return;
      try { onResult(d); } catch (err) { try { console.error("[frontline] result", err); } catch (e2) {} close(); }
    });
  }

  /* ============================================================ AIR AT THE FRONT
     A President's airstrike that lands near the battle point lands IN the
     next battle of that war: the bombers are over the line when it goes in. */
  let _busOn = false;
  function wireBus() {
    if (_busOn) return;
    const P = CBZ.presidency;
    if (!P || typeof P.on !== "function") return;
    _busOn = true;
    try {
      P.on("airstrike", function (d) {
        if (!d || !d.attacker || !isFinite(d.x) || !isFinite(d.z)) return;
        const W = PW();
        const war = W && W.activeWarFor ? W.activeWarFor(d.attacker) : null;
        if (!war || war.ended) return;
        const pt = battlePoint(war);
        if (Math.hypot(d.x - pt.x, d.z - pt.z) > AIR_MATCH_R) return;
        const q = AIRQ[war.id] || (AIRQ[war.id] = Object.create(null));
        q[d.attacker] = (q[d.attacker] || 0) + 1;
      });
    } catch (e) { _busOn = false; }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(46.41, function () { if (!_busOn) wireBus(); });

  function status() {
    const me = us(), W = PW();
    const war = me && W && W.activeWarFor ? W.activeWarFor(me) : null;
    const spec = war ? specFor(war, day(), { you: me }) : null;
    return { open: !!OPEN, warId: war ? war.id : null, spec: spec, foughtToday: war ? foughtOn(war, day()) : false };
  }

  CBZ.frontline = {
    dayOfBattle: dayOfBattle, specFor: specFor, resolve: resolve, apply: apply,
    canGo: canGo, go: go, open: open, status: status, groundAt: groundAt,
    LOOK: LOOK, lookOf: lookOf, foughtOn: foughtOn,
    _close: close, _onResult: onResult, _airQ: AIRQ,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.frontline;
})();
