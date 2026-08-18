/* ============================================================
   core/mission.js — THE MISSION BLOCK: one objective primitive for the
   whole game. "Here is a job, track it, pay it, show it to the player."

   WHY THIS EXISTS (2026-07-26 census)
   Seven independent mission state machines shipped in this repo — gigs,
   heists, campaign, activities, jail favors, the arrest arc, PRECINCT 13 —
   and not one of them shares a completion or reward schema. Five separate
   surfaces tell the player what to do. Every new venue that wants to pay
   for a job re-invents: a phase variable, a distance check, a cash call,
   a beacon, a waypoint and a HUD write. This file is the shared block:

     const m = CBZ.mission.start({ id, title, goal, at/actor/vehicle,
                                   reward, onComplete });

   and the caller gets, for free and with NO new UI:
     • TRACKING   — reach / kill / steal / deliver / destroy / survive /
                    timer / custom predicate, ticked once per frame off
                    live game state (no per-system polling loops).
     • STAGES     — pickup → dropoff, case → execute → escape. Each stage
                    is one tracked leg AND one checklist row on the phone.
     • PAY        — routed through the REAL wallet (CBZ.city.addCash /
                    addRespect / CBZ.econ.addCigs). Never a second economy.
     • SURFACE    — the existing g.cityJob HUD distance line (city/hud.js),
                    the existing map waypoint (systems/fullmap.js), the
                    existing rich phone mission card (city/campaign_ui.js),
                    plus ONE world beacon+ring (moved here out of gigs.js).
                    HUD DOCTRINE: no new popup, no new panel, no key glyphs
                    — the killfeed stays the only floating card in the game.
     • INTERRUPT  — one shared death/arrest/mode-exit edge detector. Any
                    module can hang a cleanup off it (CBZ.mission.onInterrupt)
                    instead of leaking modal state when the player dies.
                    This is what cures the activities.js race-modal soft-lock.

   ADOPTION (BLOCK LAW: one line, degrades safe, ≥3 real consumers):
     const m = CBZ.mission && CBZ.mission.start({ id:"heist:jet",
       title:"Hijack the jet", goal:"steal", vehicle: jet, reward: 25000 });
   Every handle method is null-safe at the call site (`m && m.complete()`),
   and packages get a NEVER-null handle via ctx.mission() (core/packages.js),
   so package code never branches at all.

   FACTION SEAM (city/factions.js — the ROLE layer; optional, feature-detected):
     CBZ.factions.isMember(id) -> bool     gates offers to members
     CBZ.factions.tier(id)     -> number   gates offers by minRank (a TIER
                                           number; rank() returns a string key)
     CBZ.factions.payMul(id)   -> number   rank scales the cash reward
     CBZ.factions.onMissionComplete(id, {mission, id, cash, respect})
     CBZ.factions.onMissionFail(id, {mission, id, why})
   All five exist in city/factions.js today. Every one is feature-detected, so
   with no factions module loaded every offer is available and the mission pays
   base cash — WHAT THE JOB IS lives here, WHO PAYS AND WHAT IT MAKES YOU lives
   there, and either file ships alone.

   `tryout: true` on a def/offer is the ONE exception to member-gating: the
   trial job an outfit hands a NON-member, whose completion is what admits
   them (factions.js's admission.mission). See city/contracts.js "cell:tryout".

   RATCHET: CBZ.missionAudit() -> the number of mission systems still
   present in the build that have NOT adopted this block. Only goes down.
   CBZ.missionAudit.detail() names them.

   Revert: CBZ.CONFIG.MISSION_BLOCK = false (start() returns an inert
   handle, nothing tracks, nothing surfaces — callers keep working).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game || (CBZ.game = {});
  const THREE = window.THREE || null;

  CBZ.CONFIG = CBZ.CONFIG || {};
  // MISSION_BLOCK — the whole primitive. Off → start() hands back an inert
  // handle; every migrated caller keeps its own logic and simply loses the
  // shared tracking/surfacing. One-line revert of this entire file.
  if (CBZ.CONFIG.MISSION_BLOCK == null) CBZ.CONFIG.MISSION_BLOCK = true;
  // MISSION_BEACON — the world light-column + ground ring over the current
  // objective (the marker gigs.js used to own). Off → waypoint/HUD only.
  if (CBZ.CONFIG.MISSION_BEACON == null) CBZ.CONFIG.MISSION_BEACON = true;
  // MISSION_PHONE — push the rich objective card into the diegetic phone
  // (city/campaign_ui.js setMission). Off → HUD line + waypoint only.
  if (CBZ.CONFIG.MISSION_PHONE == null) CBZ.CONFIG.MISSION_PHONE = true;
  // MISSION_HUD — paint the one always-on objective distance line into
  // g.cityJob. Off -> beacon + waypoint + phone card only, no HUD line. (It was
  // read at paintSurface() but never defaulted here, so it was an undocumented,
  // undiscoverable switch that only a URL override could reach.)
  if (CBZ.CONFIG.MISSION_HUD == null) CBZ.CONFIG.MISSION_HUD = true;
  // MISSION_INTERRUPT — the shared death/arrest/mode-exit sweeper that fails
  // live missions and runs registered cleanup hooks. Off → old leak-prone
  // behavior (a modal opened before a death stays open forever).
  if (CBZ.CONFIG.MISSION_INTERRUPT == null) CBZ.CONFIG.MISSION_INTERRUPT = true;

  /* ---------------------------------------------------------------- shims */
  function playerPos() { return (CBZ.player && CBZ.player.pos) || null; }
  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function inCity() { return g.mode === "city"; }
  function arenaRoot() {
    const a = CBZ.city && CBZ.city.arena;
    return (a && a.root) || null;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function fmt$(n) { return "$" + Math.round(n).toLocaleString(); }

  // ONE wallet. Money moves through the city's own ledger (mode.js), cigs
  // through the jail economy — never a private balance (BLOCK LAW / no
  // second money system).
  function walletGive(r) {
    const out = { cash: 0, respect: 0, cigs: 0 };
    if (r.cash > 0) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(r.cash);
      else g.cash = Math.max(0, (g.cash || 0) + r.cash);
      out.cash = r.cash;
    }
    if (r.respect > 0 && CBZ.city && CBZ.city.addRespect) { CBZ.city.addRespect(r.respect); out.respect = r.respect; }
    if (r.cigs > 0 && CBZ.econ && CBZ.econ.addCigs) { CBZ.econ.addCigs(r.cigs); out.cigs = r.cigs; }
    if (r.notoriety > 0 && CBZ.cityGainNotoriety) { try { CBZ.cityGainNotoriety(r.notoriety); } catch (e) {} }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return out;
  }
  // what the phone card shows in its reward slot: a number (rendered "$n" by
  // campaign_ui.js) or honest prose. Never an object.
  function rewardLabel(r) {
    const n = normReward(r);
    if (n.cash > 0) return n.cash;
    const bits = [];
    if (n.respect > 0) bits.push(n.respect + " respect");
    if (n.cigs > 0) bits.push(n.cigs + " cigs");
    if (n.notoriety > 0) bits.push("a name");
    return bits.length ? bits.join(" · ") : "No pay";
  }
  function normReward(r) {
    if (r == null) return { cash: 0, respect: 0, cigs: 0, notoriety: 0 };
    if (typeof r === "number") return { cash: r, respect: 0, cigs: 0, notoriety: 0 };
    return {
      cash: +r.cash || 0, respect: +r.respect || 0,
      cigs: +r.cigs || 0, notoriety: +r.notoriety || 0,
    };
  }

  // prose goes to the phone (city.note already routes there) and NEVER to a
  // new floating card. Outside city mode fall back to the jail hint line.
  function announce(m, text, urgent) {
    if (!text || m.def.announce === false) return;
    const from = m.def.giver || m.def.title || "Dispatch";
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "missions", from: from, text: text, priority: urgent ? 2 : 0 }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(text, 2.6, { app: "missions", from: from }); return; } catch (e) {} }
    if (CBZ.flashHint) { try { CBZ.flashHint(text, 2); } catch (e) {} }
  }

  /* -------------------------------------------------- FACTION SEAM (optional) */
  function F() { return (CBZ.factions && typeof CBZ.factions === "object") ? CBZ.factions : null; }
  function factionAllows(def) {
    const f = F(); if (!f || !def || !def.faction) return true;
    // `tryout:true` is the ONE job an outfit hands a non-member — the trial
    // that gets you in. Everything else needs a badge.
    // FAIL CLOSED. Both gates used to swallow a throw and fall through to
    // `return true`, so a membership check that errored HANDED OUT the job — a
    // rank-3 assassination contract to a non-member is the worst possible
    // direction to fail in. A gate that cannot answer refuses.
    if (!def.tryout && typeof f.isMember === "function") {
      try { if (!f.isMember(def.faction)) return false; } catch (e) { return false; }
    }
    // minRank is a TIER NUMBER, matched against factions.tier() (rank() returns
    // a string key — coercing that to a number silently passed every gate).
    if (def.minRank != null && typeof f.tier === "function") {
      try { if ((+f.tier(def.faction)) < +def.minRank) return false; } catch (e) { return false; }
    }
    return true;
  }
  function factionPayMul(faction) {
    const f = F(); if (!f || !faction || typeof f.payMul !== "function") return 1;
    try { const v = +f.payMul(faction); return (isFinite(v) && v > 0) ? v : 1; } catch (e) { return 1; }
  }
  function factionEvent(name, faction, payload) {
    const f = F(); if (!f || !faction || typeof f[name] !== "function") return;
    try { f[name](faction, payload); } catch (e) {}
  }

  /* ------------------------------------------------------------ the beacon */
  /* ONE light column + ground ring for the focused objective. Lifted out of
     city/gigs.js so every mission gets the same physical mark and nobody
     builds a second one. userData.transient keeps core/batch.js off it. */
  let beacon = null, ring = null, beaconKey = "";
  function clearBeacon() {
    if (beacon) { if (beacon.parent) beacon.parent.remove(beacon); if (beacon.geometry) beacon.geometry.dispose(); if (beacon.material) beacon.material.dispose(); beacon = null; }
    if (ring) { if (ring.parent) ring.parent.remove(ring); if (ring.geometry) ring.geometry.dispose(); if (ring.material) ring.material.dispose(); ring = null; }
    beaconKey = "";
  }
  function setBeacon(x, z, color, style) {
    if (!CBZ.CONFIG.MISSION_BEACON || !THREE || style === false || style === "none") {
      if (beacon || ring) clearBeacon();
      return;
    }
    const root = arenaRoot(); if (!root) return;
    style = style || "column";
    const key = color + "|" + style;
    const live = ring && ring.parent === root && (style === "ground" || (beacon && beacon.parent === root));
    if (live && beaconKey === key) { moveBeacon(x, z); return; }
    clearBeacon();
    const hgt = 34;
    // Some objectives live INSIDE a landmark. A 34 m column over an interior
    // door punches straight through its roof and visually replaces the
    // architecture it is meant to lead the player into. `marker:"ground"`
    // keeps the shared waypoint and physical arrival ring, but omits only the
    // skyline column. Every existing caller defaults to the original column.
    if (style !== "ground") {
      beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.0, hgt, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false }));
      beacon.position.set(x, hgt / 2, z); beacon.userData.transient = true;
      root.add(beacon);
    }
    ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 24),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.12, z); ring.userData.transient = true;
    root.add(ring);
    beaconKey = key;
  }
  function moveBeacon(x, z) {
    if (beacon) beacon.position.set(x, beacon.position.y, z);
    if (ring) ring.position.set(x, 0.12, z);
  }

  /* ------------------------------------------------------------- targeting */
  function resolveAt(v) {
    if (!v) return null;
    if (typeof v === "function") { try { return resolveAt(v()); } catch (e) { return null; } }
    if (Array.isArray(v)) return { x: +v[0] || 0, z: +v[1] || 0 };
    if (v.pos && v.pos.x != null) return { x: v.pos.x, z: v.pos.z };
    if (v.position && v.position.x != null) return { x: v.position.x, z: v.position.z };
    if (v.x != null && v.z != null) return { x: +v.x, z: +v.z };
    if (v.cx != null && v.cz != null) return { x: +v.cx, z: +v.cz };
    if (v.building && v.building.door) { const d = v.building.door; return { x: d.x + (d.nx || 0) * 1.4, z: d.z + (d.nz || 0) * 1.4 }; }
    return null;
  }
  // where the current leg points. Actors/vehicles resolve LIVE, so a moving
  // mark drags the beacon, the waypoint and the HUD distance with it.
  function stageTarget(st) {
    if (!st) return null;
    return resolveAt(st.at) || resolveAt(st.actor) || resolveAt(st.vehicle) ||
           resolveAt(st.object) || resolveAt(st.lot) || null;
  }
  function actorDead(a) {
    if (!a) return false;
    if (a.dead === true) return true;
    if (a.hp != null && a.hp <= 0) return true;
    if (a.removed === true || a.despawned === true) return true;
    return false;
  }
  function objectGone(o) {
    if (!o) return false;
    if (o.destroyed || o.demolished || o.wrecked || o.dead) return true;
    if (o.hp != null && o.hp <= 0) return true;
    if (o.building && o.building.demolished) return true;
    return false;
  }
  /* "am I at the controls of THAT thing" — the completion test for goal:"steal".
     There are four real shapes in this game and the naive `P._vehicle === v`
     check only catches one of them:
       · a ground car               -> P._vehicle / P.car
       · an aircraft the player flies -> P._aircraft (set by playeraircraft.js's
         enterAircraft; P._vehicle is NOT set for aircraft)
       · a PARKED-PROP record (militaryvehicles.js / island_airport.js) that the
         player boarded: boarding SPAWNS a separate flyable whose `sourceRec`
         points back at the record, so the record itself is never === the thing
         being flown. Without this branch a "hijack the aircraft" contract can
         never complete — the stage would sit there forever.
       · an armoured ground machine -> CBZ.cityArmorActive() + the same record. */
  function drivingThis(v) {
    const P = CBZ.player; if (!P || !v) return false;
    if (P._vehicle === v || P.car === v || P._aircraft === v) return true;
    const air = P._aircraft;
    if (air && (air.sourceRec === v || v.craft === air)) return true;
    if (armorIs(v)) return true;
    if (v.taken && v._aiPilot && v._aiPilot === P) return true;
    if (!P.driving && !air) return v.player === true || v.owner === "player";
    return v.player === true;
  }
  /* THE ARMOUR BRANCH. militaryvehicles.js deliberately does NOT use
     P._vehicle (vehicles.js owns that singleton and its order-11 loop): the
     tank/armoured-truck sim keeps a MODULE-LOCAL `armor` record and only sets
     P.driving = true, publishing nothing but a boolean, CBZ.cityArmorActive().
     Without this branch a `goal:"steal"` stage bound to a ground machine could
     NEVER complete — both military hijack contracts were unwinnable.

     We do not key on v.taken alone: militaryvehicles.js's own NPC pilots set
     taken=true too (:237, alongside _aiActive/_aiPilot). What identifies the
     ONE hull under the player is that the armour tick writes
     P.pos = rec.pos EVERY frame (militaryvehicles.js:669) — so with armour
     active, at most one record in the world can be standing exactly where the
     player is. Exact position, not a radius guess. */
  function armorIs(v) {
    const P = CBZ.player;
    if (!P || !v || !v.pos) return false;
    if (!P.driving || P._vehicle || P._aircraft) return false;
    if (v._aiActive || v._aiPilot) return false;               // an NPC crew has it
    if (!(CBZ.cityArmorActive && CBZ.cityArmorActive())) return false;
    const pp = P.pos;
    return Math.abs(pp.x - v.pos.x) < 1.5 && Math.abs(pp.z - v.pos.z) < 1.5;
  }

  /* --------------------------------------------------------------- stages */
  function normStages(def) {
    let raw = def.stages;
    if (!raw || !raw.length) {
      // single-leg shorthand: the goal fields live on the def itself.
      raw = [{
        id: "goal", text: def.text || def.brief || def.title,
        goal: def.goal, at: def.at, actor: def.actor, vehicle: def.vehicle,
        object: def.object, lot: def.lot, radius: def.radius,
        seconds: def.seconds, needs: def.needs, done: def.done,
        label: def.label, color: def.color,
      }];
    }
    return raw.map(function (s, i) {
      s = s || {};
      return {
        id: s.id || ("stage" + i),
        text: s.text || s.brief || s.label || ("Objective " + (i + 1)),
        brief: s.brief || s.text || "",
        goal: (s.goal || "manual"),
        at: s.at, actor: s.actor, vehicle: s.vehicle, object: s.object, lot: s.lot,
        radius: s.radius != null ? s.radius : (def.radius != null ? def.radius : 4.5),
        seconds: s.seconds != null ? s.seconds : def.seconds,
        needs: s.needs || null,
        done: s.done || null,
        onEnter: s.onEnter || null,
        onDone: s.onDone || null,
        label: s.label || null,
        color: s.color != null ? s.color : (def.color != null ? def.color : 0x7ed957),
        marker: s.marker != null ? s.marker : def.marker,
        t: 0, complete: false, failed: false,
      };
    });
  }

  // the SHARED completion detector — the whole point of the block. Every
  // shape the owner's jobs need lives here once instead of once per system.
  function stageDone(m, st) {
    if (st.done) { try { if (st.done(m, st)) return true; } catch (e) {} }
    const goal = st.goal;
    if (goal === "manual" || goal === "custom") return false;
    if (goal === "timer" || goal === "survive") return st.t >= (+st.seconds || 0);
    if (goal === "kill") return actorDead(st.actor);
    if (goal === "destroy") return objectGone(st.object || st.lot || st.vehicle);
    if (goal === "steal") return drivingThis(st.vehicle);
    if (goal === "reach" || goal === "deliver") {
      const P = playerPos(); const t = stageTarget(st);
      if (!P || !t) return false;
      if (dist2d(P.x, P.z, t.x, t.z) > st.radius) return false;
      if (st.needs) { try { if (!st.needs(m, st)) return false; } catch (e) { return false; } }
      return true;
    }
    return false;
  }

  /* ----------------------------------------------------------- the handle */
  let serial = 0;
  const live = [];             // active missions, oldest first
  let focus = null;            // the mission currently owning HUD/waypoint/beacon
  let cardDirty = true;

  // an inert handle for the flag-off / block-absent path: every method is a
  // no-op so a caller (or ctx.mission) never has to branch.
  const NULLM = {
    id: null, def: {}, data: {}, state: "off", inert: true,
    stage: function () { return null; }, stageId: function () { return null; },
    advance: function () { return this; }, retarget: function () { return this; },
    brief: function () { return this; }, progress: function () { return this; },
    note: function () { return this; }, complete: function () { return this; },
    fail: function () { return this; }, cancel: function () { return this; },
    alive: function () { return false; }, elapsed: function () { return 0; },
    target: function () { return null; }, distance: function () { return Infinity; },
  };

  function makeMission(def) {
    const stages = normStages(def);
    const m = {
      id: def.id || ("mission" + (++serial)),
      def: def,
      data: def.data || {},
      state: "active",
      t: 0,
      i: 0,                     // current stage index
      stages: stages,
      _prog: null,
      _brief: def.brief || def.desc || def.body || "",
      _paid: null,
      inert: false,
    };
    m.stage = function () { return m.stages[m.i] || null; };
    m.stageId = function () { const s = m.stage(); return s ? s.id : null; };
    m.alive = function () { return m.state === "active"; };
    m.elapsed = function () { return m.t; };
    m.target = function () { return stageTarget(m.stage()); };
    m.distance = function () {
      const P = playerPos(), t = m.target();
      return (P && t) ? dist2d(P.x, P.z, t.x, t.z) : Infinity;
    };
    // advance past the current leg (a caller with its own phase machine —
    // heists.js — drives this by hand; tracked goals call it themselves).
    m.advance = function () { if (m.state === "active") finishStage(m, m.stage()); return m; };
    m.retarget = function (t, label, color) {
      const st = m.stage(); if (!st) return m;
      st.at = t; st.actor = null; st.vehicle = null; st.object = null; st.lot = null;
      if (label) st.label = label;
      if (color != null) st.color = color;
      cardDirty = true; refocus(true);
      return m;
    };
    m.brief = function (text) { if (text) { m._brief = text; cardDirty = true; } return m; };
    m.note = function (text) { announce(m, text); return m; };
    // A progress bar driven from a per-frame predicate (a "hold this position"
    // leg) would otherwise set cardDirty 60x a second and re-render the whole
    // phone app every frame. Only a visible change counts as a change.
    m.progress = function (f) {
      const v = (f == null ? null : clamp01(f));
      const was = m._prog;
      m._prog = v;
      if (was == null || v == null ? was !== v : Math.round(was * 100) !== Math.round(v * 100)) cardDirty = true;
      return m;
    };
    m.complete = function (over) { return endMission(m, "done", over || null, null); };
    m.fail = function (why) { return endMission(m, "failed", null, why || "failed"); };
    m.cancel = function (why) { return endMission(m, "failed", null, why || "cancelled"); };
    // RETIRE — take the handle down WITHOUT calling it a failure. A caller that
    // drives its own phase machine (gigs.js) tears the handle down on the way
    // out of a job it just COMPLETED; routing that through cancel() archived a
    // "FAILED" card on the phone and told the faction layer the player botched
    // it (standing loss, and enough of them expel you). Retiring pays nothing,
    // posts no card and fires no faction event — it just stops tracking.
    m.retire = function (why) { return endMission(m, "retired", null, why || "retired", true); };
    return m;
  }

  function enterStage(m, st) {
    if (!st) return;
    st.t = 0;
    cardDirty = true;
    if (st.onEnter) { try { st.onEnter(m, st); } catch (e) { console.error("[mission:" + m.id + "] onEnter", e); } }
    refocus(true);
  }

  // a stage is done → run its hook (which may VETO by returning false, the
  // "you can't afford the load yet" case), then step or complete.
  function finishStage(m, st) {
    if (!st || m.state !== "active") return;
    if (st.onDone) {
      let ok = true;
      try { ok = st.onDone(m, st); } catch (e) { console.error("[mission:" + m.id + "] onDone", e); }
      if (ok === false) return;                 // veto: stay on this leg
    }
    st.complete = true;
    cardDirty = true;
    if (m.i >= m.stages.length - 1) { endMission(m, "done", null, null); return; }
    m.i++;
    enterStage(m, m.stage());
  }

  function endMission(m, state, over, why, silent) {
    if (!m || m.state !== "active") return m;
    m.state = state;
    const def = m.def;
    if (silent) {
      m._why = why;
      const j0 = live.indexOf(m); if (j0 >= 0) live.splice(j0, 1);
      if (focus === m) focus = null;
      cardDirty = true;
      if (!live.length && CBZ.CONFIG.MISSION_PHONE && !campaignOwns()) {
        // clear the slot rather than archive a verdict we do not have
        if (CBZ.campaignUI && CBZ.campaignUI.setMission) { try { CBZ.campaignUI.setMission(null); } catch (e) {} }
      }
      refocus(true);
      return m;
    }
    let paid = { cash: 0, respect: 0, cigs: 0 };
    if (state === "done") {
      if (def.pay !== false) {
        const r = normReward(over != null ? (typeof over === "number" ? over : Object.assign({}, normReward(def.reward), normReward(over))) : def.reward);
        r.cash = Math.round(r.cash * factionPayMul(def.faction));
        paid = walletGive(r);
      } else if (over) {
        // pay:false callers still report what THEY paid, so the phone card
        // and the faction hook see the true number (no stat fictions).
        paid = normReward(over);
      }
      m._paid = paid;
      const line = def.doneText || ((def.title || "Job") + " complete" + (paid.cash ? " · " + fmt$(paid.cash) : ""));
      announce(m, line);
      factionEvent("onMissionComplete", def.faction, { mission: m, id: m.id, cash: paid.cash, respect: paid.respect });
      if (def.onComplete) { try { def.onComplete(m, paid); } catch (e) { console.error("[mission:" + m.id + "] onComplete", e); } }
    } else {
      m._why = why;
      announce(m, def.failText || ((def.title || "Job") + " failed — " + why));
      factionEvent("onMissionFail", def.faction, { mission: m, id: m.id, why: why });
      if (def.onFail) { try { def.onFail(m, why); } catch (e) { console.error("[mission:" + m.id + "] onFail", e); } }
    }
    const i = live.indexOf(m); if (i >= 0) live.splice(i, 1);
    if (focus === m) { focus = null; }
    cardDirty = true;
    // archive the card only when nothing else is live (otherwise the next
    // mission's card takes over the slot and the phone keeps history).
    if (!live.length) pushCard(m, state === "done" ? "complete" : "failed");
    refocus(true);
    return m;
  }

  /* ---------------------------------------- surfacing: HUD / map / phone */
  function jobIsOurs() { return !!(g.cityJob && g.cityJob._mission); }
  function clearSurface() {
    if (jobIsOurs()) { g.cityJob = null; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
    clearBeacon();
    // forget the last waypoint key, or a NEW mission whose first leg happens to
    // share the previous one's label+rounded position would be de-duped against
    // a waypoint that no longer exists and never get one.
    wpKey = "";
  }
  function campaignOwns() {
    return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission());
  }
  function locationLabel(m) {
    const loc = m.def.locationName || (m.stage() && m.stage().label) || "";
    const tgt = m.def.targetName || "";
    if (loc && tgt && String(loc).toLowerCase() === String(tgt).toLowerCase()) return "";
    return loc;
  }
  function pushCard(m, status) {
    if (!CBZ.CONFIG.MISSION_PHONE || campaignOwns()) return;
    if (!CBZ.campaignUI || !CBZ.campaignUI.setMission) return;
    if (!m) { try { CBZ.campaignUI.setMission(null); } catch (e) {} return; }
    const objectives = m.stages.map(function (s, i) {
      return { id: s.id, text: s.text, done: !!s.complete, failed: !!s.failed };
    });
    const prog = m._prog != null ? m._prog : (m.stages.length > 1 ? (m.i / m.stages.length) : null);
    try {
      CBZ.campaignUI.setMission({
        id: m.id, title: m.def.title || "Job",
        briefing: m._brief || (m.stage() ? m.stage().brief : ""),
        // A JOB CAN CARRY A PICTURE. city/mugshot.js photographs the actual
        // body in the outfit the city cast onto it, so a contract shows the
        // mark instead of describing him — and the paragraph that used to do
        // that job collapses into `facts` rows the card lays out beside it.
        // Both are optional and pass straight through; a def without them
        // renders exactly as before.
        photo: m.def.photo || "",
        facts: m.def.facts || null,
        target: m.def.targetName || "",
        // A STAGE LABEL IS NOT ALWAYS A PLACE. A "kill" leg labels itself with
        // the mark's name, so this printed a LOCATION chip reading MR. CALLOWAY
        // right under the target's own photograph. When the label is just the
        // target again, there is no location to show.
        location: locationLabel(m),
        // campaign_ui.js renders a NUMBER as "$n" and anything else via
        // String(). `cash || def.reward` fell through to the raw object for an
        // unpaid job (the Cause's tryout pays 0 cash), printing
        // "[object Object]" on the phone. Always hand it a number or a string.
        reward: rewardLabel(m.def.reward),
        status: status || "active",
        progress: prog,
        objectives: objectives,
      });
    } catch (e) {}
  }
  // pick the mission that owns the shared surfaces: the newest live mission
  // that wants them. When it ends the previous one takes the slot back.
  function refocus(force) {
    let want = null;
    for (let i = live.length - 1; i >= 0; i--) { if (live[i].def.hud !== false) { want = live[i]; break; } }
    if (want === focus && !force) return;
    if (want !== focus) { focus = want; cardDirty = true; }
    if (!focus) { clearSurface(); if (cardDirty) { pushCard(null); cardDirty = false; } return; }
    if (cardDirty) { pushCard(focus, "active"); cardDirty = false; }
    paintSurface(focus);
  }
  let wpKey = "";
  function paintSurface(m) {
    const st = m.stage(); if (!st) return;
    const t = stageTarget(st);
    // NEVER clobber somebody else's live job. careers.js and activities.js
    // both own g.cityJob for their own contracts and READ IT BACK to pay out
    // (careers.js:646 finishJob reads j.reward); overwriting it paid the wrong
    // number and then deleted their job. If the slot is taken by a non-mission
    // job we simply do not paint the line — the beacon and waypoint below
    // still run, so the objective is never invisible.
    const foreignJob = !!(g.cityJob && !g.cityJob._mission);
    if (inCity() && !foreignJob && CBZ.CONFIG.MISSION_HUD !== false) {
      // the ONE always-on objective line the HUD doctrine allows: distance.
      const job = (jobIsOurs() ? g.cityJob : (g.cityJob = { _mission: true }));
      job._mission = true;
      job.type = "mission";
      job.desc = m._brief || st.text || m.def.title || "Job";
      job.reward = normReward(m.def.reward).cash || 0;
      job.mission = m.id;
      if (t) { job.dest = job.dest || { x: 0, z: 0 }; job.dest.x = t.x; job.dest.z = t.z; }
      else job.dest = null;
      if (st.actor) job.target = st.actor;
    }
    // A LEG WITH NO PLACE CLEARS THE MARK. This used to `return` here, which
    // left the 34m light column and the map waypoint standing over the LAST
    // leg's position for the whole of a location-less stage — a "get clear"
    // or "hold out" leg pinned a glowing marker over the bank you just robbed
    // and told the map that was still where you were going. Callers had to
    // retire-and-retake a whole handle to get rid of it (careers.js's getaway
    // leg does exactly that, and heists.js could not). clearBeacon() is
    // idempotent, so this is a no-op on every frame after the first.
    if (!t) {
      if (beacon || ring) clearBeacon();
      if (wpKey && CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
      wpKey = "";
      return;
    }
    if (inCity()) {
      setBeacon(t.x, t.z, st.color, st.marker);
      moveBeacon(t.x, t.z);
      const label = (st.label || st.text || m.def.title || "OBJECTIVE").toString().toUpperCase();
      const key = label + "|" + Math.round(t.x) + "|" + Math.round(t.z);
      if (key !== wpKey && CBZ.fullMap && CBZ.fullMap.setWaypoint) {
        wpKey = key;
        try { CBZ.fullMap.setWaypoint(t.x, t.z, label); } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------ the tick */
  function tick(dt) {
    if (!live.length) { if (focus) refocus(true); return; }
    dt = (typeof dt === "number" && dt > 0) ? dt : 0.016;
    for (let i = live.length - 1; i >= 0; i--) {
      const m = live[i];
      if (m.state !== "active") { live.splice(i, 1); continue; }
      m.t += dt;
      const st = m.stage();
      if (st) st.t += dt;
      const def = m.def;
      if (def.onTick) { try { def.onTick(m, dt); } catch (e) { console.error("[mission:" + m.id + "] onTick", e); } }
      if (m.state !== "active") continue;
      // ---- failure first (a dead player never completes a delivery) ----
      if (def.failIf) {
        let why = null;
        try { why = def.failIf(m); } catch (e) { why = null; }
        if (why) { m.fail(typeof why === "string" ? why : "conditions changed"); continue; }
      }
      if (def.limit && m.t > def.limit) { m.fail("out of time"); continue; }
      if (st && st.seconds && st.goal !== "timer" && st.goal !== "survive" && st.t > st.seconds) { m.fail("out of time"); continue; }
      if (def.abandonDist) {
        const P = playerPos(), t = stageTarget(st);
        if (P && t && dist2d(P.x, P.z, t.x, t.z) > def.abandonDist) { m.fail("you walked away"); continue; }
      }
      // ---- completion ----
      if (st && stageDone(m, st)) { finishStage(m, st); continue; }
    }
    refocus(false);
    if (focus) paintSurface(focus);
  }

  /* ------------------------------------------- the shared INTERRUPT sweeper */
  /* One place that notices the player died / got arrested / left city mode.
     Modules hang cleanup off it instead of leaking their own modal state —
     this is the cure for the activities.js "die with the race modal open and
     every activity is dead for the session" soft-lock. */
  const interrupts = [];
  let wasDead = false, wasBusted = false, lastMode = g.mode;
  function fireInterrupt(reason) {
    for (let i = 0; i < interrupts.length; i++) {
      try { interrupts[i](reason); } catch (e) { console.error("[mission interrupt]", e); }
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const m = live[i];
      if (reason === "death" && m.def.failOnDeath === false) continue;
      if (reason === "bust" && m.def.failOnBust === false) continue;
      if (reason === "mode" && m.def.failOnModeExit === false) continue;
      m.fail(reason === "death" ? "you went down" : reason === "bust" ? "you got busted" : "you left the job");
    }
    refocus(true);
  }
  function watch() {
    if (!CBZ.CONFIG.MISSION_INTERRUPT) return;
    const dead = !!(CBZ.player && CBZ.player.dead);
    const busted = !!g.busted;
    if (dead && !wasDead) fireInterrupt("death");
    if (busted && !wasBusted) fireInterrupt("bust");
    if (g.mode !== lastMode) { lastMode = g.mode; if (live.length) fireInterrupt("mode"); else refocus(true); }
    wasDead = dead; wasBusted = busted;
  }

  /* ----------------------------------------------------------- OFFER board */
  /* A mission has a GIVER. An offer is a job a giver is willing to hand out;
     CBZ.factions (if loaded) decides WHO may see it. With no factions module
     every offer is open — the board works standalone. */
  const offers = [];
  function offer(def) {
    if (!def || !def.id) return null;
    const i = offers.findIndex(function (o) { return o.id === def.id; });
    if (i >= 0) offers[i] = def; else offers.push(def);
    return def.id;
  }
  function listOffers(filter) {
    return offers.filter(function (o) {
      if (filter && filter.faction && o.faction !== filter.faction) return false;
      if (filter && filter.giver && o.giver !== filter.giver) return false;
      if (o.canOffer) { try { if (!o.canOffer()) return false; } catch (e) { return false; } }
      return factionAllows(o);
    }).slice();
  }
  // is a job already running for this outfit? (a board must not hand you the
  // same contract twice — see start()'s retire-on-restart note)
  function liveFor(faction) {
    for (let i = 0; i < live.length; i++) {
      const d = live[i].def;
      if (d.hud === false) continue;                    // background handles don't count
      if (!faction || d.faction === faction) return live[i];
    }
    return null;
  }
  function take(id) {
    const o = offers.find(function (x) { return x.id === id; });
    if (!o) return null;
    // canOffer() is the "can the WORLD still supply this?" test. listOffers()
    // ran it; take() did not, so an offer registered when a target existed
    // stayed takeable by id forever — offers are only ever replaced, never
    // removed. A board row is drawn from a fresh listOffers(), but any other
    // caller reaching CBZ.mission.take() directly could start a contract whose
    // aircraft had been shot down an hour ago.
    if (o.canOffer) { try { if (!o.canOffer()) return null; } catch (e) { return null; } }
    if (!factionAllows(o)) return null;
    const def = (typeof o.build === "function") ? o.build() : o;
    if (!def) return null;
    // the offer's gate fields carry into the built def — otherwise a `tryout`
    // job (the one an outfit hands a NON-member) would be re-checked as a
    // member-only job by start() and silently refuse itself.
    // THE OFFER'S ID IS THE MISSION'S ID. Without this, every def built by a
    // template lands with no `id` and makeMission() falls through to
    // "mission" + (++serial) — a fresh unique id per take. Two documented
    // behaviours were dead as a result: start()'s "a re-start of the same id
    // replaces the old one" could never match, and factions.js's
    // `if (info.id) markMissionDone(String(info.id))` recorded "mission7"
    // instead of "cell:tryout", so admission.mission — the "finish the tryout
    // and you are in" gate — was unsatisfiable for any outfit that did not
    // hand-call markMissionDone itself. `def.id` still wins if a build()
    // deliberately names its own.
    return start(Object.assign({ id: o.id, giver: o.giver, faction: o.faction, tryout: o.tryout, minRank: o.minRank }, def));
  }

  /* ---------------------------------------------------------------- start */
  function start(def) {
    if (!def) return NULLM;
    if (!CBZ.CONFIG.MISSION_BLOCK) return NULLM;
    if (def.faction && !factionAllows(def)) return NULLM;
    if (def.exclusive && live.some(function (m) { return m.def.exclusive; })) return NULLM;
    const m = makeMission(def);
    // a re-start of the same id replaces the old one (idempotent accept).
    // RETIRE, never cancel: cancelling reported a FAILED job to the faction
    // layer, so pressing "ask for work" twice at a recruiter cost you standing
    // and — four presses in — got you expelled from your own outfit.
    for (let i = live.length - 1; i >= 0; i--) if (live[i].id === m.id) live[i].retire("restarted");
    live.push(m);
    cardDirty = true;
    enterStage(m, m.stage());
    announce(m, def.offerText || ((def.title || "New job") + (normReward(def.reward).cash ? " · " + fmt$(normReward(def.reward).cash) : "")));
    refocus(true);
    return m;
  }

  /* ---------------------------------------------------------------- audit */
  /* THE RATCHET (BLOCK LAW #5). Every mission system that is PRESENT in the
     loaded build but has not called CBZ.mission.adopt() still owns a private
     objective/completion/reward machine. The number may only go DOWN. */
  const LEGACY = [
    { id: "city/gigs.js", what: "gig loops (delivery/taxi/uber/smuggle)", probe: function () { return !!CBZ.cityGig; } },
    { id: "city/heists.js", what: "planned scores", probe: function () { return !!CBZ.cityStartHeist; } },
    { id: "city/activities.js", what: "activity board + hitman contracts", probe: function () { return !!CBZ.cityOpenActivities; } },
    // careers.js was missing from the census's own list of seven — it owns the
    // freelance contract board AND the gang crew contracts, each with its own
    // objective, its own completion tick and its own payout, which is the exact
    // definition this audit uses. Adding it makes the universe honest; it is
    // already migrated, so the PENDING count does not move.
    { id: "city/careers.js", what: "freelance board + gang crew contracts", probe: function () { return !!CBZ.cityJobBoard; } },
    { id: "systems/quests.js", what: "jail favors / reputation", probe: function () { return !!CBZ.quests; } },
    { id: "city/campaign.js", what: "authored hitman spine", probe: function () { return !!CBZ.cityCampaignOwnsMission; } },
    { id: "games/jail.js", what: "player arrest arc", probe: function () { return pkgLoaded("jail"); } },
    { id: "games/police.js", what: "PRECINCT 13 heist arc", probe: function () { return pkgLoaded("police"); } },
  ];
  function pkgLoaded(id) {
    if (!CBZ.games || !CBZ.games._defs) return false;
    try { return CBZ.games._defs().some(function (d) { return d.id === id; }); } catch (e) { return false; }
  }
  const adopted = {};
  function adopt(id) { if (id) adopted[id] = true; return true; }
  function audit() {
    let n = 0;
    for (let i = 0; i < LEGACY.length; i++) if (LEGACY[i].probe() && !adopted[LEGACY[i].id]) n++;
    return n;
  }
  audit.detail = function () {
    const pending = [], done = [];
    for (let i = 0; i < LEGACY.length; i++) {
      const L = LEGACY[i];
      if (!L.probe()) continue;
      (adopted[L.id] ? done : pending).push(L.id + " — " + L.what);
    }
    return { legacy: pending.length, adopted: done.length, pending: pending, migrated: done, liveMissions: live.length };
  };

  /* ----------------------------------------------------------------- wiring */
  // GAMEPLAY band +0.55: after gigs (38.7), activities (38.6) and heists (40)
  // have moved their own state this frame, so completion reads fresh truth.
  if (typeof CBZ.onUpdate === "function") {
    CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.GAMEPLAY, 55) : 40.55, tick);
  }
  // LATE band: the interrupt sweeper must run even while state !== "playing"
  // (a death cinematic still has to release everyone's modal state).
  if (typeof CBZ.onAlways === "function") {
    CBZ.onAlways(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.LATE, 1) : 90.01, watch);
  }

  CBZ.mission = {
    start: start,
    live: function () { return live.slice(); },
    count: function () { return live.length; },
    byId: function (id) { return live.find(function (m) { return m.id === id; }) || null; },
    focus: function () { return focus; },
    /* "am I already carrying a job?" — the question every board and every
       accept-path actually asks. It used to answer `live.some(m.def.exclusive)`,
       and `exclusive` is set by exactly ONE def in the whole repo
       (contracts.js's assassination), so the answer was `false` while a gig, a
       careers.js contract or an activity was running. gigs.js:435 delegates its
       busy-guard here, so with the mission block loaded that guard silently
       stopped firing and a gig could be stacked on top of a live careers job.
       Both halves of "busy" are checked now:
         · any FOREGROUND mission (one that wants the HUD slot), and
         · a foreign g.cityJob — careers.js / activities.js still own that slot
           for their own contracts and never go through this block.
       `exclusiveLive()` keeps the old, narrower question available for the one
       caller that genuinely means it. */
    busy: function () {
      if (g.cityJob && !g.cityJob._mission) return true;
      return !!liveFor(null);
    },
    exclusiveLive: function () { return live.some(function (m) { return m.def.exclusive; }); },
    abortAll: function (why) { for (let i = live.length - 1; i >= 0; i--) live[i].fail(why || "cancelled"); refocus(true); },
    interrupt: fireInterrupt,
    onInterrupt: function (fn) { if (typeof fn === "function") interrupts.push(fn); },
    offer: offer,
    offers: listOffers,
    take: take,
    liveFor: liveFor,
    // one offer record by id, WITHOUT taking it — what a board needs to draw a
    // row (title, giver, pay, gate) before the player commits.
    peek: function (id) { return offers.find(function (x) { return x.id === id; }) || null; },
    allows: function (o) { return factionAllows(o); },
    adopt: adopt,
    audit: audit,
    reward: normReward,
    NULL: NULLM,
  };
  CBZ.missionAudit = audit;
})();
