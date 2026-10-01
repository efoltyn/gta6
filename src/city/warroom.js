/* ============================================================
   city/warroom.js — THE COMMANDER IN CHIEF. A President goes to war, orders
   airstrikes, and — only if his country has them — orders a nuke.

   OWNER: "MAKE IT SO PRESIDENT CAN GO TO WAR AND ORDER AIRSTRIKE AND IF
   THEY HAVE NUKES ORDER NUKE".

   NOTHING HERE IS A SECOND SYSTEM. Every organ already existed:
     the war        city/polwar.js — declareWar/endWar, counted matériel, the
                    front, fatigue, reparations. This file adds no war math:
                    polwar.strikeOn / nuclearStrike / makePeace are the
                    consequences, and they run off a strike that LANDED.
     the arsenal    `warheads` is data on each country's row (polity.js's
                    republic record, countries.js's COUNTRIES), seeded into
                    polwar's mil record and persisted with it. Zero warheads,
                    no nuclear verb anywhere — the phone in the Situation Room
                    and the football are simply dead objects.
     the jets       city/playerair.js's CBZ.cityStrikeFlight — the ONE strike
                    flight (the phone's F-22 flies it too). Real jets run in
                    from your own capital, release real Mk-84s through
                    strategic.js's own bay release, and fly on out.
     the bombs      city/strategic.js CBZ.strategicRelease -> CBZ.detonate ->
                    systems/impactbus.js -> city/structural.js (buildings burn,
                    sag and pancake) — the same path the B-2 drops through.
     the nuke       strategic.js's CBZ.strategicNuclearSortie: the parked B-2
                    at Fort Brandt is claimed, a real trooper flies it, and the
                    B61 comes down under its parachute onto the mark. If that
                    bomber is gone (stolen, destroyed, no aircrew) the weapon
                    goes on a strike jet instead, through the same release.
                    The raymarched cloud is nukefx.js's, untouched.
     the target     the ONE waypoint in the game (systems/fullmap.js). No
                    waypoint and at war: the enemy capital. The football can
                    also send jets at where you are looking.
     the people     presidency.js's Situation Room (the red phones and the map
                    on the table, the General) — orders are BUTTONS keys
                    "war" / "peace" / "strike" / "nuke", so the officer's yes,
                    the phone and the map all run one implementation.

   THE WAR HAPPENS IN THE WORLD. While your country is at war and you stand
   on its soil, the enemy flies real raids at you: two jets out of their
   capital's direction bombing a block a couple of hundred metres away. Their
   jets are lockable like any aircraft. A nuke on a country with its own
   warheads is answered: forty seconds later one of theirs comes in on one of
   your cities, far enough away that you watch the cloud on the horizon.

   THE FOOTBALL. One agent of your detail (protection.js's real body) carries
   the briefcase. E on him: Order airstrike. Hold E: Order nuke (only while
   the country has warheads). He answers in one line over his head.

   EVENTS — on presidency.js's bus (CBZ.presidency.on(evt, fn)):
     war-declared      {warId, attacker, attackerName, defender, defenderName,
                        byPlayer, day, front:{x,z}, text}         (polwar.js)
     war-ended         {warId, winner, winnerName, loser, loserName, reason,
                        day, text}                                (polwar.js)
     airstrike-ordered {x, z, label, nation, nationName, attacker,
                        attackerName, byPlayer, jets, bombs, day, text}
     airstrike         same payload + hits, text — the FIRST bomb landed
     nuke-launched     {x, z, label, nation, nationName, attacker,
                        attackerName, byPlayer, carrier:"B-2"|"jet", day, text}
     nuke              {x, z, label, nation, nationName, attacker,
                        attackerName, byPlayer, surrendered, day, text} —
                        EVERY nuclear detonation in the game (wrapped on
                        CBZ.detonate), attributed when one was ordered

   PUBLIC: CBZ.warroom = { nation, enemy, warheads, target, canWar, war,
     canPeace, peace, canStrike, strike, canNuke, nuke, status, audit }.
   LOAD: after presidency.js / president_staff.js (reads them lazily anyway).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.warroom) return;
  const g = CBZ.game || (CBZ.game = {});
  const THREE = window.THREE;

  const STRIKE_COST = 12000;     // fuel, ordnance, sortie pay — out of rec.treasury
  const STRIKE_JETS = 2, STRIKE_BOMBS = 3;
  const RAID_FIRST = [45, 75];   // s after war reaches you before the first raid
  const RAID_GAP = [140, 230];   // s between raids
  const RETALIATE_S = 40;        // s from their country burning to their weapon in the air
  const NUKE_MATCH_R = 1600;     // m: a detonation this close to an ordered aimpoint is that order

  let CLOCK = 0;
  const PEND = [];               // ordered nukes in the air: {x,z,attacker,target,label,byPlayer,t}
  const RAID = { t: null, n: 0, foe: null };
  let RET = null;                // {foe, us, at}
  const FB = { ped: null, mesh: null, t: 0 };

  // ---------------------------------------------------------------- helpers
  function PW() { return CBZ.polwar || null; }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : 0.5; }
  function emit(evt, payload) {
    const P = CBZ.presidency;
    if (P && typeof P.emit === "function") { try { P.emit(evt, payload); } catch (e) {} }
  }
  function polGet(id) { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; }
  function nameOf(id) { const r = id ? polGet(id) : null; return (r && r.name) || id || null; }
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country" && h.rec) ? h : null;
  }
  function nation() { const h = seat(); return h ? h.id : null; }
  function enemyOf(id) {
    const W = PW(); if (!id || !W || !W.activeWarFor) return null;
    const w = W.activeWarFor(id);
    if (!w || w.ended) return null;
    return w.sides[0] === id ? w.sides[1] : w.sides[0];
  }
  function enemy() { return enemyOf(nation()); }
  function warheads(id) {
    id = id || nation();
    const W = PW();
    return (id && W && W.warheadsOf) ? (W.warheadsOf(id) | 0) : 0;
  }
  function milOf(id) { const W = PW(); return (id && W && W.militaryOf) ? W.militaryOf(id) : null; }
  function shock(id, n) { if (CBZ.approvalShock && id) { try { CBZ.approvalShock(id, n); } catch (e) {} } }
  function scandal(n) {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const p = (w && w.politics) || g.cityPolitics;
    if (p) p.scandal = Math.max(0, Math.min(100, (p.scandal || 0) + n));
  }

  // WHOSE GROUND IS THIS. A city/base rect first (polity.of), then a state's
  // rect (the republic's mainland is one), then nobody's — open sea.
  function inRect(r, x, z) { return r && Math.abs(x - r.cx) <= r.hx && Math.abs(z - r.cz) <= r.hz; }
  function placeAt(x, z) {
    const P = CBZ.polity; if (!P) return null;
    let rec = null;
    try { rec = P.of ? P.of(x, z) : null; } catch (e) { rec = null; }
    if (!rec && P.list) {
      const st = P.list("state") || [];
      for (let i = 0; i < st.length; i++) if (inRect(st[i].rect, x, z)) { rec = st[i]; break; }
    }
    return rec;
  }
  function nationAt(x, z) {
    const rec = placeAt(x, z);
    if (!rec) return null;
    const c = CBZ.polity.countryOf ? CBZ.polity.countryOf(rec.id) : null;
    return c ? c.id : null;
  }
  function placeName(x, z) { const r = placeAt(x, z); return r ? r.name : null; }

  function capitalPoint(id) {
    const W = PW(); if (!W) return null;
    const cap = W.capitalOf ? W.capitalOf(id) : null;
    if (cap) { const r = polGet(cap.id); return { x: cap.cx, z: cap.cz, name: (r && r.name) || nameOf(id) }; }
    const a = W.anchorOf ? W.anchorOf(id) : null;
    return a ? { x: a.x, z: a.z, name: nameOf(id) } : null;
  }
  function homeAnchor(id) {
    const W = PW();
    const a = W && W.anchorOf ? W.anchorOf(id) : null;
    return a && (a.x || a.z) ? a : null;
  }
  function waypoint() {
    try {
      const w = CBZ.fullMap && CBZ.fullMap.waypoint && CBZ.fullMap.waypoint();
      return (w && isFinite(w.x) && isFinite(w.z)) ? w : null;
    } catch (e) { return null; }
  }
  function aimPoint() {
    const P = CBZ.player;
    if (!P || !P.pos) return null;
    const y = (CBZ.cam && CBZ.cam.yaw) || 0;
    const x = P.pos.x - Math.sin(y) * 140, z = P.pos.z - Math.cos(y) * 140;
    return { x: x, z: z, label: placeName(x, z) || "the mark", nation: nationAt(x, z), src: "aim" };
  }
  // THE TARGET: the map's mark, else (at war) the enemy capital, else (only
  // when the caller allows it) where you are looking.
  function target(opts) {
    opts = opts || {};
    const wp = waypoint();
    if (wp) return { x: wp.x, z: wp.z, label: placeName(wp.x, wp.z) || wp.label || "the mark", nation: nationAt(wp.x, wp.z), src: "map" };
    const foe = enemy();
    if (foe) {
      const c = capitalPoint(foe);
      if (c) return { x: c.x, z: c.z, label: c.name, nation: foe, src: "war" };
    }
    return opts.aim ? aimPoint() : null;
  }
  function mostHostile(us) {
    if (!CBZ.polity || !CBZ.polity.list) return null;
    const l = CBZ.polity.list("country") || [];
    let best = null, bv = Infinity;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c || c.id === us) continue;
      const v = CBZ.relations && CBZ.relations.get ? (CBZ.relations.get(us, c.id) || 0) : 0;
      if (v < bv) { bv = v; best = c.id; }
    }
    return best ? { id: best, rel: bv } : null;
  }
  function channelBusy() {
    if (PEND.length) return true;
    try { const s = CBZ.strategicSortieState ? CBZ.strategicSortieState() : null; return !!(s && (s.channelBusy || s.active)); }
    catch (e) { return false; }
  }
  function ourFlightsUp() {
    const l = CBZ.cityStrikeFlights ? CBZ.cityStrikeFlights() : [];
    let n = 0;
    for (let i = 0; i < l.length; i++) if (l[i].data && l[i].data.warroom === "ours") n++;
    return n;
  }
  function payload(tgt, attacker, extra) {
    const o = {
      x: Math.round(tgt.x), z: Math.round(tgt.z), label: tgt.label || null,
      nation: tgt.nation || null, nationName: nameOf(tgt.nation),
      attacker: attacker || null, attackerName: nameOf(attacker), day: day(),
    };
    if (extra) for (const k in extra) o[k] = extra[k];
    return o;
  }

  // ---------------------------------------------------------------- WAR
  function warFoe(us) {
    const wp = waypoint();
    if (wp) { const n = nationAt(wp.x, wp.z); if (n && n !== us) return n; }
    const h = mostHostile(us);
    return h ? h.id : null;
  }
  function canWar() {
    const us = nation(), W = PW();
    if (!us) return { ok: false, why: "You do not hold the country." };
    if (!W || !W.declareWar) return { ok: false, why: "The army is not answering." };
    const cur = enemyOf(us);
    if (cur) return { ok: false, why: "We are already at war with " + nameOf(cur) + "." };
    const foe = warFoe(us);
    if (!foe) return { ok: false, why: "There is nobody to fight." };
    if (enemyOf(foe)) return { ok: false, why: nameOf(foe) + " is tied up in another war." };
    const rec = polGet(us);
    if (rec && rec.govType === "anarchism") return { ok: false, why: "There is no army left to send." };
    return { ok: true, foe: foe, name: nameOf(foe) };
  }
  function war() {
    const gt = canWar();
    if (!gt.ok) return gt;
    const us = nation();
    const w = PW().declareWar(us, gt.foe, { byPlayer: true });
    if (!w) return { ok: false, why: "The order did not go through." };
    shock(us, 3);                      // the flag goes up; for a week, the country rallies
    RAID.t = null; RAID.foe = gt.foe;  // the first raid is armed fresh
    return { ok: true, why: "", line: "Then it's war with " + gt.name + "." };
  }
  function canPeace() {
    const us = nation();
    if (!us) return { ok: false, why: "You do not hold the country." };
    const foe = enemyOf(us);
    if (!foe) return { ok: false, why: "We are not at war." };
    return { ok: true, foe: foe };
  }
  function peace() {
    const gt = canPeace();
    if (!gt.ok) return gt;
    const us = nation();
    const r = PW().makePeace ? PW().makePeace(us) : null;
    if (!r) return { ok: false, why: "They will not take the call." };
    RAID.t = null;
    return { ok: true, why: "", line: r.loser === us ? "They'll take the terms. It will cost us." : nameOf(gt.foe) + " has signed. It's over." };
  }

  // ---------------------------------------------------------------- AIRSTRIKE
  function canStrike(opts) {
    const us = nation();
    if (!us) return { ok: false, why: "You do not hold the country." };
    if (!CBZ.cityStrikeFlight) return { ok: false, why: "Nothing can get airborne." };
    const mil = milOf(us);
    if (mil && !(mil.planes > 0)) return { ok: false, why: "We have no aircraft left." };
    const rec = polGet(us);
    if (rec && (rec.treasury || 0) < STRIKE_COST) return { ok: false, why: "The treasury can't fly a sortie." };
    if (ourFlightsUp() >= 2) return { ok: false, why: "Our jets are already in the air." };
    const tgt = target(opts);
    if (!tgt) return { ok: false, why: "Mark it on the map." };
    return { ok: true, tgt: tgt, us: us, rec: rec, mil: mil };
  }
  function strike(opts) {
    const gt = canStrike(opts);
    if (!gt.ok) return gt;
    const us = gt.us, tgt = gt.tgt;
    const foe = tgt.nation && tgt.nation !== us ? tgt.nation : null;
    const jets = Math.max(1, Math.min(STRIKE_JETS, gt.mil ? gt.mil.planes | 0 : STRIKE_JETS));
    const f = CBZ.cityStrikeFlight({
      x: tgt.x, z: tgt.z, jets: jets, bombs: STRIKE_BOMBS,
      from: homeAnchor(us), by: null, byPlayer: false, stateAct: true,
      side: "ours", label: tgt.label, data: { warroom: "ours" },
      onImpact: function (im, fl, n) {
        if (n !== 1) return;
        // the war-side consequence runs off the bomb that LANDED
        let hit = null;
        if (foe && PW() && PW().strikeOn) { try { hit = PW().strikeOn(foe, us, 1); } catch (e) {} }
        emit("airstrike", payload(tgt, us, {
          byPlayer: true, jets: jets, bombs: jets * STRIKE_BOMBS, killed: hit ? hit.soldiers : 0,
          text: nameOf(us) + " airstrike hits " + (tgt.label || nameOf(foe) || "the target"),
        }));
      },
    });
    if (!f) return { ok: false, why: "Nothing can get airborne right now." };
    if (gt.rec) gt.rec.treasury = (gt.rec.treasury || 0) - STRIKE_COST;
    // striking a foreign country you are not at war with IS going to war
    if (foe && !enemyOf(us) && !enemyOf(foe) && PW() && PW().declareWar) {
      try { PW().declareWar(us, foe, { byPlayer: true }); RAID.t = null; } catch (e) {}
    }
    // bombing your own country is a scandal the papers will not let go
    if (tgt.nation === us) { shock(us, -12); scandal(15); }
    emit("airstrike-ordered", payload(tgt, us, {
      byPlayer: true, jets: jets, bombs: jets * STRIKE_BOMBS,
      text: nameOf(us) + " orders an airstrike on " + (tgt.label || "a target"),
    }));
    return { ok: true, why: "", line: (jets > 1 ? "Two jets" : "One jet") + " wheels up for " + (tgt.label || "the mark") + "." };
  }

  // ---------------------------------------------------------------- NUKE
  function canNuke(opts) {
    const us = nation();
    if (!us) return { ok: false, why: "You do not hold the country." };
    if (CBZ.CONFIG && CBZ.CONFIG.STRAT_NUKE === false) return { ok: false, why: "Strategic command is offline." };
    if (warheads(us) <= 0) return { ok: false, why: "We have no warheads." };
    if (channelBusy() || RET) return { ok: false, why: "One weapon at a time." };
    const tgt = target(opts);
    if (!tgt) return { ok: false, why: "Mark it on the map." };
    return { ok: true, tgt: tgt, us: us };
  }
  function nuke(opts) {
    const gt = canNuke(opts);
    if (!gt.ok) return gt;
    const us = gt.us, tgt = gt.tgt, W = PW();
    if (!W.useWarhead(us)) return { ok: false, why: "We have no warheads." };
    let carrier = "B-2", line = "The bomber is rolling.";
    // THE AEROPLANE ON THE APRON first: the real B-2, a real crew.
    let res = null;
    if (CBZ.strategicNuclearSortie) {
      try { res = CBZ.strategicNuclearSortie({ x: tgt.x, z: tgt.z, label: tgt.label, by: null, byPlayer: false, stateAct: true }); } catch (e) { res = null; }
    }
    if (!res || !res.ok) {
      // no bomber on its pad (stolen, shot down, no crew): a strike jet carries it
      const f = CBZ.cityStrikeFlight ? CBZ.cityStrikeFlight({
        x: tgt.x, z: tgt.z, kind: "nuke", jets: 1, bombs: 1, alt: 210,
        from: homeAnchor(us), by: null, byPlayer: false, stateAct: true, side: "ours", label: tgt.label,
        data: { warroom: "nuke" },
      }) : null;
      if (!f) {
        const mil = milOf(us); if (mil) mil.warheads = (mil.warheads | 0) + 1;   // never left the bunker
        return { ok: false, why: (res && res.why) || "Nothing can carry it." };
      }
      carrier = "jet"; line = "One jet, one weapon. It's away.";
    }
    PEND.push({ x: tgt.x, z: tgt.z, attacker: us, target: tgt.nation, label: tgt.label, byPlayer: true, t: CLOCK });
    const foe = tgt.nation && tgt.nation !== us ? tgt.nation : null;
    if (foe && !enemyOf(us) && !enemyOf(foe) && W.declareWar) { try { W.declareWar(us, foe, { byPlayer: true }); RAID.t = null; } catch (e) {} }
    emit("nuke-launched", payload(tgt, us, {
      byPlayer: true, carrier: carrier,
      text: nameOf(us) + " launches a nuclear weapon at " + (tgt.label || "a target"),
    }));
    return { ok: true, why: "", line: line };
  }

  // ---------------------------------------------------------------- DETONATIONS
  // EVERY nuclear detonation in the game passes CBZ.detonate(.., "nuke"): the
  // B-2 you fly, the sortie, the planted device, a strike jet. Attributed to an
  // order when one was aimed near here; the war consequence runs only then.
  function onNuke(x, z) {
    let p = null, bi = -1, bd = NUKE_MATCH_R;
    for (let i = 0; i < PEND.length; i++) {
      const d = Math.hypot(PEND[i].x - x, PEND[i].z - z);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) { p = PEND[bi]; PEND.splice(bi, 1); }
    const where = nationAt(x, z);
    const tgt = { x: x, z: z, label: (p && p.label) || placeName(x, z) || "open country", nation: where };
    const attacker = p ? p.attacker : null;
    // the detonation is the news; what it does to the war follows it (a
    // surrender arrives as its own "war-ended" right after this)
    emit("nuke", payload(tgt, attacker, {
      byPlayer: !!(p && p.byPlayer),
      text: "Nuclear detonation over " + tgt.label,
    }));
    let r = null;
    if (attacker && where && attacker !== where && PW() && PW().nuclearStrike) {
      try { r = PW().nuclearStrike(where, attacker); } catch (e) { r = null; }
    }
    if (attacker && where === attacker) { shock(attacker, -40); scandal(40); }
    // A COUNTRY WITH ITS OWN WARHEADS ANSWERS.
    const us = nation();
    if (r && r.canAnswer && attacker === us && !RET) {
      RET = { foe: where, us: us, at: CLOCK + RETALIATE_S };
      sayNear("They have warheads. They'll answer.");
    }
  }
  function installDetonateTap() {
    const det = CBZ.detonate;
    if (typeof det !== "function" || det._warroomTap) return !!(det && det._warroomTap);
    const w = function (x, y, z, kind) {
      const out = det.apply(this, arguments);
      if (kind === "nuke") { try { onNuke(x, z); } catch (e) {} }
      return out;
    };
    w._warroomTap = true;
    CBZ.detonate = w;
    if (CBZ.impact && CBZ.impact.detonate === det) CBZ.impact.detonate = w;
    return true;
  }
  installDetonateTap();

  function retaliationTarget(us) {
    const l = CBZ.polity && CBZ.polity.list ? (CBZ.polity.list("city") || []) : [];
    const P = CBZ.player;
    const px = P && P.pos ? P.pos.x : 0, pz = P && P.pos ? P.pos.z : 0;
    let best = null, bd = Infinity, far = null, fd = -1;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c || !c.rect) continue;
      const co = CBZ.polity.countryOf ? CBZ.polity.countryOf(c.id) : null;
      if (!co || co.id !== us) continue;
      const d = Math.hypot(c.rect.cx - px, c.rect.cz - pz);
      // near enough to watch, far enough to live: the nearest city past 1.2 km
      if (d >= 1200 && d < bd) { bd = d; best = c; }
      if (d > fd) { fd = d; far = c; }
    }
    const c = best || far;
    return c ? { x: c.rect.cx, z: c.rect.cz, label: c.name, nation: us } : null;
  }
  function tickRetaliation() {
    if (!RET || CLOCK < RET.at) return;
    if (channelBusy()) { RET.at = CLOCK + 5; return; }
    const R = RET; RET = null;
    if (!PW() || !PW().useWarhead || !PW().useWarhead(R.foe)) return;
    const tgt = retaliationTarget(R.us);
    if (!tgt || !CBZ.cityStrikeFlight) return;
    const f = CBZ.cityStrikeFlight({
      x: tgt.x, z: tgt.z, kind: "nuke", jets: 1, bombs: 1, alt: 210,
      from: homeAnchor(R.foe), by: null, byPlayer: false, stateAct: true, side: "enemy", label: tgt.label,
      data: { warroom: "enemy" },
    });
    if (!f) return;
    PEND.push({ x: tgt.x, z: tgt.z, attacker: R.foe, target: R.us, label: tgt.label, byPlayer: false, t: CLOCK });
    if (CBZ.sfxAt) { try { CBZ.sfxAt("siren", tgt.x, tgt.z, { volume: 0.5 }); } catch (e) {} }
    sayNear("They've launched. One weapon, for " + tgt.label + ".");
    emit("nuke-launched", payload(tgt, R.foe, {
      byPlayer: false, carrier: "jet",
      text: nameOf(R.foe) + " launches a nuclear weapon at " + tgt.label,
    }));
  }

  // ---------------------------------------------------------------- ENEMY RAIDS
  // The war comes to you: while your country is at war and you are on its
  // soil, their jets bomb a block a couple of hundred metres from where you are.
  function raidPoint(us, P) {
    for (let k = 0; k < 8; k++) {
      const a = h01(RAID.n, k, 911) * Math.PI * 2;
      const d = 190 + 130 * h01(k, RAID.n, 913);
      const x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d;
      if (nationAt(x, z) === us) return { x: x, z: z, label: placeName(x, z) || "the city", nation: us };
    }
    // a small town: somewhere inside the place you are standing in, clear of you
    const home = placeAt(P.pos.x, P.pos.z), r = home && home.rect;
    if (r) {
      for (let k = 0; k < 8; k++) {
        const x = r.cx + (h01(RAID.n, k, 915) * 2 - 1) * r.hx * 0.9;
        const z = r.cz + (h01(k, RAID.n, 917) * 2 - 1) * r.hz * 0.9;
        if (Math.hypot(x - P.pos.x, z - P.pos.z) >= 110) return { x: x, z: z, label: home.name || "the city", nation: us };
      }
    }
    return null;
  }
  function tickRaids() {
    const us = nation();
    const foe = us ? enemyOf(us) : null;
    if (!foe) { RAID.t = null; return; }
    if (RAID.foe !== foe) { RAID.foe = foe; RAID.t = null; }
    const P = CBZ.player;
    if (!P || P.dead || !P.pos || nationAt(P.pos.x, P.pos.z) !== us) return;
    const fm = milOf(foe);
    if (fm && !(fm.planes > 0)) return;
    if (RAID.t == null) RAID.t = RAID_FIRST[0] + (RAID_FIRST[1] - RAID_FIRST[0]) * h01(day(), RAID.n, 907);
    RAID.t -= 1;
    if (RAID.t > 0) return;
    RAID.t = RAID_GAP[0] + (RAID_GAP[1] - RAID_GAP[0]) * h01(RAID.n, day(), 909);
    if (!CBZ.cityStrikeFlight) return;
    const tgt = raidPoint(us, P);
    if (!tgt) return;
    RAID.n++;
    const f = CBZ.cityStrikeFlight({
      x: tgt.x, z: tgt.z, jets: 2, bombs: 2, from: homeAnchor(foe),
      by: null, byPlayer: false, stateAct: true, side: "enemy", label: tgt.label, data: { warroom: "enemy" },
      onImpact: function (im, fl, n) {
        if (n !== 1) return;
        let hit = null;
        if (PW() && PW().strikeOn) { try { hit = PW().strikeOn(us, foe, 0.6); } catch (e) {} }
        emit("airstrike", payload(tgt, foe, {
          byPlayer: false, jets: 2, bombs: 4, killed: hit ? hit.soldiers : 0,
          text: nameOf(foe) + " jets bomb " + tgt.label,
        }));
      },
    });
    if (!f) return;
    sayNear("Jets. Get down.");
    emit("airstrike-ordered", payload(tgt, foe, {
      byPlayer: false, jets: 2, bombs: 4, text: nameOf(foe) + " jets inbound on " + tgt.label,
    }));
  }

  // ---------------------------------------------------------------- THE FOOTBALL
  // one line over a head: the agent with the briefcase if he is near, else
  // the radio by your hand
  function sayNear(line) {
    const p = FB.ped, P = CBZ.player;
    if (p && !p.dead && p.pos && P && P.pos && Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 14 && CBZ.citySay) {
      try { if (CBZ.citySay(p, line, "#dfe7ff", 3)) return; } catch (e) {}
    }
    if (CBZ.speech && CBZ.speech.phone) { try { CBZ.speech.phone(line, { secs: 3 }); } catch (e) {} }
  }
  function aideSay(p, r) {
    const line = r && r.ok ? (r.line || "Yes, sir.") : String((r && r.why) || "Not now.");
    if (CBZ.citySay) { try { CBZ.citySay(p, line, "#dfe7ff", 3); } catch (e) {} }
  }
  function briefcase() {
    if (!THREE) return null;
    const grp = new THREE.Group();
    grp.name = "nuclear-football";
    const mat = (hex) => (CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }));
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); grp.add(b); return b; };
    const leather = mat(0x17181b), brass = mat(0xb08a3e);
    box(0.13, 0.34, 0.46, 0, 0, 0, leather);          // the case, hanging edge-down by his leg
    box(0.04, 0.05, 0.16, 0, 0.2, 0, leather);        // handle
    box(0.135, 0.03, 0.05, 0, 0.12, 0.15, brass);     // the two latches
    box(0.135, 0.03, 0.05, 0, 0.12, -0.15, brass);
    return grp;
  }
  function dropFootball() {
    if (FB.mesh && FB.mesh.parent) FB.mesh.parent.remove(FB.mesh);
    FB.mesh = null; FB.ped = null;
  }
  function wireFootball(p) {
    if (p._footballWired || !CBZ.interactions || !CBZ.interactions.registerFor) return;
    p._footballWired = true;
    CBZ.interactions.registerFor(p, {
      id: "football-strike", slot: "e", prio: 46, campaignSafe: true,
      label: "Order airstrike",
      canShow: function () { return FB.ped === p && !p.dead && !!nation(); },
      onSelect: function () { aideSay(p, strike({ aim: true })); },
    });
    CBZ.interactions.registerFor(p, {
      id: "football-nuke", hold: true, prio: 45, campaignSafe: true,
      label: "Order nuke",
      canShow: function () { return FB.ped === p && !p.dead && warheads() > 0; },
      onSelect: function () { aideSay(p, nuke()); },
    });
  }
  function giveFootball(p) {
    FB.ped = p;
    wireFootball(p);
    if (p.group && !FB.mesh) {
      FB.mesh = briefcase();
      if (FB.mesh) { FB.mesh.position.set(0.36, 0.62, 0.02); p.group.add(FB.mesh); }
    }
  }
  function tickFootball() {
    const us = nation();
    let want = null;
    if (us && CBZ.protection && CBZ.protection.get) {
      let det = null;
      try { det = CBZ.protection.get("off_" + us); } catch (e) { det = null; }
      const refs = (det && det.memberPedRefs) || [];
      // the briefcase rides with an agent, not the shift leader who runs the walk
      for (let i = 0; i < refs.length && !want; i++) { const q = refs[i]; if (q && !q.dead && q.group && q._protRole !== "shift-leader") want = q; }
      for (let i = 0; i < refs.length && !want; i++) { const q = refs[i]; if (q && !q.dead && q.group) want = q; }
    }
    if (want === FB.ped && (!want || (FB.mesh && FB.mesh.parent === want.group))) return;
    dropFootball();
    if (want) giveFootball(want);
  }

  // ---------------------------------------------------------------- TICK
  let _acc = 0;
  CBZ.onUpdate && CBZ.onUpdate(46.4, function (dt) {
    if (g.mode !== "city") {
      if (PEND.length || RET || FB.ped) { PEND.length = 0; RET = null; RAID.t = null; dropFootball(); }
      return;
    }
    if (g.state !== "playing") return;
    CLOCK += dt;
    _acc += dt;
    if (_acc < 1) return;
    _acc = 0;
    installDetonateTap();                      // another file may have replaced it
    // an ordered weapon that never detonated (shot down, dud) stops blocking
    for (let i = PEND.length - 1; i >= 0; i--) if (CLOCK - PEND[i].t > 120) PEND.splice(i, 1);
    try { tickFootball(); } catch (e) {}
    try { tickRaids(); } catch (e) {}
    try { tickRetaliation(); } catch (e) {}
  });

  function status() {
    const us = nation();
    const foe = enemyOf(us);
    const mil = milOf(us);
    return {
      nation: us, nationName: nameOf(us), enemy: foe, enemyName: nameOf(foe),
      warheads: warheads(us), planes: mil ? mil.planes | 0 : 0,
      target: target(), raidIn: RAID.t, inFlight: PEND.length, retaliation: RET ? Math.max(0, RET.at - CLOCK) : null,
      football: !!FB.ped,
    };
  }

  CBZ.warroom = {
    nation: nation, enemy: enemy, warheads: warheads, target: target, nationAt: nationAt,
    canWar: canWar, war: war, canPeace: canPeace, peace: peace,
    canStrike: canStrike, strike: strike, canNuke: canNuke, nuke: nuke,
    status: status,
    audit: function () {
      return Object.assign(status(), {
        detonateTapped: !!(CBZ.detonate && CBZ.detonate._warroomTap),
        flight: !!CBZ.cityStrikeFlight, release: !!CBZ.strategicRelease, sortie: !!CBZ.strategicNuclearSortie,
        pending: PEND.map(function (p) { return { x: Math.round(p.x), z: Math.round(p.z), attacker: p.attacker, target: p.target }; }),
      });
    },
  };
})();
