/* ============================================================
   city/president_agenda.js — THE CHIEF OF STAFF IS A DIRECTOR.

   THE PROBLEM (PRESIDENT-PLAN.md §1b): you are sworn in, you get ONE
   mission ("Enter the Situation Room"), and then the mode never asks you
   for anything again. Every number the presidency is about lives on one
   canvas in one room, and nothing on the outside of that room has a
   reason to exist. There is no WHY loop.

   WHAT THIS FILE IS. Each in-game day (150 real seconds), while the
   player holds the country, the Chief of Staff hands down TWO OR THREE
   concrete tasks. Each one is:
     • a real objective through the ONE mission system (core/mission.js) —
       no second tracker, no second HUD line, no second waypoint;
     • 60-120 s of play, inside the day it was issued;
     • a SCENE at the end (bodies, a headline, a line from a person);
     • paid in REAL approval (city/approval.js's approvalShock, +1..+3),
       never a private score.

   THE FOUR TASKS
     1. ADDRESS THE NATION FROM THE PERRON. There is now a physical
        podium on the Mansion's stylobate, on the front-door axis, 4 m out
        from the facade. Walk to it, press E — and that E calls
        `CBZ.presidency.press("address")`, THE SAME ORDER the Situation
        Room's ADDRESS pad presses. There is exactly one address
        implementation in this build and it is presidency.js's; this file
        owns a lectern and a doorway to it, nothing more. The press corps
        is 8 real peds through occupy.js's cityPostNpc, gathered while the
        task is live and released when it ends.
     2. MEET THE GENERAL IN THE WEST WING. One posted officer at the West
        Wing door for the day. Reach + E is a BRIEFING: he reads the live
        threat off presidency's own state and tells you what it is. It
        unlocks nothing, because that is what a briefing is.
     3. RIDE TO THE BUREAU / INSPECT THE WALL. A reach mission to the
        Agency gate, or to the state wall if one has been ordered. If
        city/motorcade.js is loaded the orders line says to take the car;
        this file never depends on it.
     4. THE DRILL. The moment `threat.armed` goes true, the day's tasks come
        off the board and the only objective in the world is GET TO THE
        SITUATION ROOM. No pay — that is what a drill is. It pre-empts the
        BOARD, not the diary: when the threat stands down the schedule the
        Chief of Staff wrote this morning goes back up.

   WHAT THIS FILE DOES NOT OWN: the address order, approval, the wall, the
   cell, the room, the door, peds, or the mission HUD. It owns a podium,
   a casting call, and a daily list.

   Revert: CBZ.CONFIG.PRESIDENT_AGENDA = false — no podium, no zone, no
   tasks; presidency.js is untouched and every other file is unaware.

   Probe: CBZ.presidentAgendaAudit() -> { today:[ids], done, podiumBuilt }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game || (CBZ.game = {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  if (CFG.PRESIDENT_AGENDA == null) CFG.PRESIDENT_AGENDA = true;
  function on() { return CFG.PRESIDENT_AGENDA !== false; }

  // ---- tuning ------------------------------------------------------------
  const PRESS_CORPS = 8;              // bodies in front of the podium (6-10)
  const PRESS_MIN_R = 10.0;           // ...standing clear of the state stair
  const PAY_ADDRESS = 1;              // ON TOP of what press("address") pays
  const PAY_BRIEF = 2;
  const PAY_RIDE = 2;
  const PAY_WALL = 3;
  const MISS_UNDONE = -1;             // an agenda you ignored costs you a point
  const MISS_UNDONE_FLOOR = -2;       // ...and never more than two in a day

  /* ------------------------------------------------------------ the seams
     Every one of these is somebody else's published function. Nothing here
     computes a number this file could not read from the system that owns it. */
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#8fc1ff"); } catch (e) {} } }
  function big(t) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(t); } catch (e) {} } }
  // presidency.js's `orders()` line, verbatim — the same CBZ.phoneNotify
  // channel, the same app, the same fallback. One voice for the office.
  function orders(from, text, prio) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "system", from: from, text: text, priority: prio == null ? 1 : prio }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(text, 3.0); } catch (e) {} }
  }
  function shock(n) {
    const h = seatH();
    if (!h || !CBZ.approvalShock || !isFinite(n) || !n) return;
    try { CBZ.approvalShock(h.id, n); } catch (e) {}
  }
  function P() { return CBZ.presidency || null; }
  // THE SEAT. presidency.js publishes seat() -> {id, rec, title, kind} (the
  // statecraft holder record). status().seat is the boolean form the
  // president-wave contract uses; either answers "is this yours".
  function seatH() {
    const p = P();
    if (p && typeof p.seat === "function") { try { return p.seat() || null; } catch (e) {} }
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country") ? h : null;
  }
  function seated() {
    const p = P();
    if (p && typeof p.status === "function") { try { const s = p.status(); if (s) return !!s.seat; } catch (e) {} }
    return !!seatH();
  }
  /* THE THREAT. `status().threat` is the president wave's contract and is
     preferred whenever it exists. Until it lands (and if it is ever pulled)
     the same four facts are read straight off presidency's own published
     roster and its test-hook state — a DEGRADE, not a second model: no field
     here is computed, every one is copied. */
  function threat() {
    const p = P();
    if (p && typeof p.status === "function") {
      try { const s = p.status(); if (s && s.threat) return s.threat; } catch (e) {}
    }
    let members = 0, supply = 0, intel = false;
    if (p && typeof p.roster === "function") {
      try {
        const r = p.roster() || [];
        for (let i = 0; i < r.length; i++) if (r[i] && !r[i].dead && !r[i].held) members++;
      } catch (e) {}
    }
    if (p && typeof p._state === "function") {
      try { const S = p._state(); supply = S.supply | 0; intel = !!S.intelKnown; } catch (e) {}
    }
    return { members: members, supply: supply, intel: intel, armed: false, target: null };
  }
  function wall() {
    const p = P();
    if (p && typeof p.status === "function") {
      try { const s = p.status(); if (s && s.wall) return s.wall; } catch (e) {}
    }
    if (CBZ.stateWall && CBZ.stateWall.status) { try { return CBZ.stateWall.status(); } catch (e) {} }
    return null;
  }
  function govSite(id) {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id && L[i].rect) return L[i];
    return null;
  }
  function site() {
    const p = P();
    if (p && typeof p.site === "function") { try { const s = p.site(); if (s && s.rect) return s; } catch (e) {} }
    return govSite("execmansion");
  }
  // The Bureau. The president-wave brief says "an id containing agency/bureau";
  // govcomplex.js's registry row is literally `id: "agency"` (name "Bureau
  // Headquarters"), so match on either rather than on one spelling.
  function bureauSite() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s && s.rect && /agency|bureau/i.test(String(s.id))) return s;
    }
    return null;
  }
  function roomDoor() {
    const p = P();
    if (p && p._room && p._room.doorPt) return p._room.doorPt;
    return null;
  }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function inCity() { return g.mode === "city"; }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : ((a * 0.618 + b * 0.317 + salt * 0.113) % 1); }

  // ============================================================
  //  §1  THE PODIUM — a physical lectern on the Mansion's stylobate.
  //
  //  govcomplex.js's perron() puts the deck at PERRON_TOP = 0.30 running
  //  from the facade (site.cz-17) out to the stair at site.cz-8, and
  //  bldCivicOrder skips the column at t=0 so the door axis is clear. The
  //  lectern therefore stands at (site.cx, site.cz-13): dead on the axis,
  //  4 m out from the facade, 3.5 m clear of the colonnade and 4 m clear
  //  of the top tread. Same primitives govcomplex uses (a box, a collider),
  //  written here in WORLD coordinates because this file has no site root.
  // ============================================================
  const POD = { group: null, col: null, builtFor: null, pt: null, zoned: false };

  function mat(hex) {
    return CBZ.cmat ? CBZ.cmat(hex) : (CBZ.mat ? CBZ.mat(hex) : new THREE.MeshLambertMaterial({ color: hex }));
  }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function box(parent, x, y, z, w, h, d, hex, rx) {
    const m = new THREE.Mesh(bg(w, h, d), mat(hex));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function teardownPodium() {
    if (POD.group && POD.group.parent) POD.group.parent.remove(POD.group);
    if (POD.col && CBZ.colliders) {
      const i = CBZ.colliders.indexOf(POD.col);
      if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} } }
    }
    POD.group = null; POD.col = null; POD.builtFor = null; POD.pt = null;
  }

  function buildPodium() {
    const s = site(), root = arenaRoot();
    if (!s || !root) return false;
    if (POD.group && POD.builtFor === CBZ.govComplexes && POD.group.parent === root) return true;
    teardownPodium();

    const px = s.cx, pz = s.cz - 13;      // door axis, 4 m out from the facade
    const DECK = 0.30;                    // govcomplex.js PERRON_TOP
    const STONE = 0x9aa0a8, DARK = 0x232a34, GOLD = 0xd8c98a, STEEL = 0xb9bec6;

    const grp = new THREE.Group();
    grp.name = "president-podium";
    // userData is the ONE thing core/batch.js reads to spare a mesh from the
    // static merge. This group is raised AFTER the city batch and taken down
    // when the world is rebuilt, so it must stay its own object.
    grp.userData.transient = true;
    root.add(grp);

    // the lectern: a shaft, a reading shelf, the seal, two microphones.
    box(grp, px, DECK + 0.50, pz, 0.76, 1.00, 0.58, DARK);            // shaft
    box(grp, px, DECK + 1.03, pz, 0.90, 0.07, 0.70, STONE);           // cap
    box(grp, px, DECK + 1.13, pz - 0.06, 0.96, 0.10, 0.62, DARK, 0.18); // reading shelf, tipped to the speaker
    box(grp, px, DECK + 0.62, pz + 0.30, 0.42, 0.42, 0.05, GOLD);     // the seal, facing the lawn
    box(grp, px, DECK + 0.06, pz, 0.94, 0.12, 0.74, STONE);           // plinth
    for (const sg of [-1, 1]) {
      // a mic on a short gooseneck, leaning out over the crowd (+z)
      box(grp, px + sg * 0.17, DECK + 1.30, pz + 0.14, 0.030, 0.42, 0.030, STEEL, 0.42);
      box(grp, px + sg * 0.17, DECK + 1.50, pz + 0.30, 0.055, 0.10, 0.055, DARK, 0.42);
    }

    // the collider. y0/y1 so it is a lectern and not a full-height wall —
    // physics.js's banded box, the same shape govcomplex's col() writes.
    POD.col = { minX: px - 0.50, maxX: px + 0.50, minZ: pz - 0.42, maxZ: pz + 0.42, y0: DECK, y1: DECK + 1.20, ref: null };
    (CBZ.colliders = CBZ.colliders || []).push(POD.col);
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }

    POD.group = grp; POD.builtFor = CBZ.govComplexes; POD.pt = { x: px, z: pz };
    return true;
  }

  /* THE E ON THE PODIUM IS THE SITUATION ROOM'S ADDRESS BUTTON.
     Registered exactly the way presidency.js's wireZones() registers the
     door and the pads: one zone, one "e" option, a label that reads the
     order's own gate back, and an onSelect that calls the published
     press(). There is no second address implementation, no second
     cooldown, no second treasury debit — press("address") is the order. */
  function addressOrder() {
    const p = P();
    if (!p || typeof p.buttons !== "function") return null;
    let list = [];
    try { list = p.buttons() || []; } catch (e) { return null; }
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].key === "address") return list[i];
    return null;
  }
  function pressAddress() {
    const p = P();
    if (!p || typeof p.press !== "function") return { ok: false, why: "No presidency loaded." };
    let r = null;
    try { r = p.press("address"); } catch (e) { r = { ok: false, why: "The order did not go through." }; }
    if (r && r.ok) addressDelivered();
    return r || { ok: false, why: "Refused." };
  }
  function wirePodiumZone() {
    if (POD.zoned || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    POD.zoned = true;
    CBZ.interactions.registerZone({
      id: "pres-podium", kind: "prespodium", radius: 2.4, prio: 13,
      find: function (px, pz) {
        if (!on() || !POD.pt || !seated()) return null;
        const dx = POD.pt.x - px, dz = POD.pt.z - pz;
        return (dx * dx + dz * dz) < 2.4 * 2.4 ? { x: POD.pt.x, z: POD.pt.z, kind: "prespodium" } : null;
      },
      options: [{
        id: "pres-podium-address", slot: "e", prio: 6, campaignSafe: true,
        label: function () {
          const B = addressOrder();
          if (!B) return "Address the nation";
          return "Address the nation" + (B.ok ? "" : " — " + B.why);
        },
        onSelect: function () { pressAddress(); },
      }],
    });
    if (CBZ.interactions.describe) {
      try { CBZ.interactions.describe("prespodium", function () { return { label: "The podium", note: "the nation is watching" }; }); } catch (e) {}
    }
  }

  // ============================================================
  //  §2  THE CASTING — press corps and the General, both through
  //  occupy.js's cityPostNpc (the sanctioned atom) and its matching
  //  cityUnpostNpc. No brains written here: `pin` is peds.js's own
  //  posted-staff behaviour.
  // ============================================================
  const CAST = { press: [], slots: null, general: null, generalDied: false, tries: 0, disperse: 0 };

  // The shared "never let the player watch a body appear" guard. It is a
  // PREFERENCE here, not a veto: the press corps stands 10 m in front of a
  // podium the president is himself walking towards, so a slot that stays
  // blocked is eventually filled anyway (they are arriving for an address
  // that was announced — the one case where turning up IS the fiction).
  function spawnSafe(x, z, force) {
    if (CBZ.citySpawnDraining) return false;
    if (force) return true;
    if (CBZ.npcTransitionSafe) { try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: 14 }); } catch (e) {} }
    return true;
  }
  // A CORPSE IS NOT OURS TO DELETE. Releasing the cast means sending the
  // living home; anyone the player shot belongs to morgue.js/death.js now.
  function unpost(ped) {
    if (!ped || ped.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); return; } catch (e) {} }
    try {
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      const arr = CBZ.cityPeds; if (arr) { const i = arr.indexOf(ped); if (i >= 0) arr.splice(i, 1); }
    } catch (e) {}
  }
  // face = the angle that looks AT (tx,tz) from (px,pz) — govcomplex.js's
  // seatPoint convention (atan2 of the delta, x first).
  function faceTo(px, pz, tx, tz) { return Math.atan2(tx - px, tz - pz); }

  const PRESS_JOBS = ["press photographer", "news reporter", "camera operator", "press photographer", "news reporter", "radio correspondent"];

  function gatherPress() {
    if (!POD.pt || !CBZ.cityPostNpc) return;
    if (CAST.press.length >= PRESS_CORPS) return;
    const cx = POD.pt.x, cz = POD.pt.z;
    // ~10 s of polite waiting for a clear slot (the tick is 0.5 s), then the
    // press corps turns up regardless — an address with nobody at it is a
    // worse lie than a camera crew that walked on while you weren't looking.
    const force = ++CAST.tries > 20;
    if (!CAST.slots) {
      CAST.slots = [];
      for (let i = 0; i < PRESS_CORPS; i++) {
        // a shallow arc on the lawn beyond the state stair, all of them turned
        // to the lectern. r >= 10 keeps every body off the 0.30 deck.
        const a = -0.85 + (i / (PRESS_CORPS - 1)) * 1.70;
        const r = PRESS_MIN_R + (i % 3) * 2.2;
        CAST.slots.push({ x: cx + Math.sin(a) * r, z: cz + Math.cos(a) * r, filled: false });
      }
    }
    for (let i = 0; i < CAST.slots.length; i++) {
      const slot = CAST.slots[i];
      if (slot.filled) continue;
      const x = slot.x, z = slot.z;
      if (!spawnSafe(x, z, force)) continue;       // this slot; try it again next tick
      let ped = null;
      try {
        ped = CBZ.cityPostNpc(x, z, {
          job: PRESS_JOBS[i % PRESS_JOBS.length], archetype: "professional",
          pin: true, face: faceTo(x, z, cx, cz), armed: false, aggr: 0.05,
          src: "presagenda:press",
        });
      } catch (e) { ped = null; }
      if (!ped) return;
      slot.filled = true;
      CAST.press.push(ped);
    }
  }
  function releasePress() {
    for (let i = 0; i < CAST.press.length; i++) unpost(CAST.press[i]);
    CAST.press.length = 0;
    CAST.slots = null;
    CAST.tries = 0;
    CAST.disperse = 0;
  }
  // A crowd that vanishes on the last syllable is worse than no crowd. The
  // corps stands there for a few more seconds and then files out — driven off
  // the same 0.5 s tick, so it costs nothing.
  function dispersePress(ticks) { if (CAST.press.length) CAST.disperse = ticks || 12; else releasePress(); }
  function tickDisperse() {
    if (CAST.disperse <= 0) return;
    if (--CAST.disperse <= 0) releasePress();
  }

  /* THE GENERAL. The West Wing shell is centre (site.cx-58, site.cz-30),
     34 x 22, so its +x face — the one looking back at the Mansion — is at
     x = site.cx-41. He stands a stride outside it, turned to face whoever
     comes across the court. `job` carries "military" because outfits.js
     casts its soldier uniform off that word; the interaction says General. */
  function generalPost() {
    const s = site();
    if (!s) return null;
    return { x: s.cx - 39.4, z: s.cz - 30 };
  }
  function postGeneral() {
    if (CAST.general) {
      // A DEAD GENERAL STAYS DEAD. Re-posting him would mean the one person
      // in this file the player can shoot is the one person who cannot die.
      if (CAST.general.dead) { CAST.generalDied = true; CAST.general = null; }
      else return CAST.general;
    }
    if (CAST.generalDied) return null;
    const p = generalPost();
    if (!p || !CBZ.cityPostNpc) return null;
    if (!spawnSafe(p.x, p.z)) return null;
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(p.x, p.z, {
        job: "military general", archetype: "military",
        pin: true, face: Math.PI / 2, armed: false, aggr: 0.02,
        wealth: 0.7, src: "presagenda:general",
      });
    } catch (e) { ped = null; }
    if (!ped) return null;
    ped._presGeneral = true;
    ped.organization = "state";
    CAST.general = ped;
    // the verb rides on the BODY (interactions.js registerFor) so it dies
    // with him and can never outlive the person it belongs to.
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      try {
        CBZ.interactions.registerFor(ped, {
          id: "presagenda-brief", slot: "e", prio: 40, campaignSafe: true,
          label: function () { return "Take the briefing"; },
          canShow: function () { return on() && seated() && !!TASKS.general.live; },
          onSelect: function () { deliverBriefing(); },
        });
      } catch (e) {}
    }
    return ped;
  }
  function releaseGeneral() {
    unpost(CAST.general);
    CAST.general = null; CAST.generalDied = false;
  }

  // ============================================================
  //  §3  THE TASKS. Each is: a mission def through CBZ.mission.start, a
  //  scene when it lands, and a real approval payment. `live` is the
  //  handle; `end()` is the one teardown path.
  // ============================================================
  const AG = {
    day: -1, ids: [], lastIds: [], doneToday: 0, issuedFor: -1, firstDay: -1,
    addressDay: -999, briefDay: -999, drillDay: -999, wasArmed: false,
  };

  function missionStart(def) {
    if (!CBZ.mission || !CBZ.mission.start) return null;
    // announce:false — mission.js's own phone line would double every order
    // this file already speaks in the Chief of Staff's voice.
    def.announce = false;
    try { return CBZ.mission.start(def) || null; } catch (e) { return null; }
  }
  function retire(m, why) {
    if (!m) return;
    try { if (typeof m.retire === "function") m.retire(why || "day over"); else if (m.cancel) m.cancel(why || "day over"); } catch (e) {}
  }

  const TASKS = {
    /* ---- 1. THE ADDRESS ------------------------------------------------ */
    address: {
      id: "address", live: null, suspended: false,
      offer: function () {
        if (!POD.pt) return false;
        const B = addressOrder();
        return !!(B && B.ok);        // never hand down an order the room refuses
      },
      order: function () {
        return "The networks are outside and the podium is on the steps. Say something to the country from your own house, not from a bunker.";
      },
      start: function () {
        const t = TASKS.address;
        t.live = missionStart({
          id: "presagenda:address", title: "Address the nation",
          brief: "The press corps is on the lawn. Speak from the podium.",
          giver: "Chief of Staff", reward: 0, marker: "ground",
          stages: [
            { id: "walk", text: "Walk out to the podium on the perron", goal: "reach", radius: 3.2, label: "The podium",
              at: function () { return POD.pt; } },
            { id: "speak", text: "Deliver the address", goal: "manual", radius: 3.2, label: "The podium",
              at: function () { return POD.pt; },
              done: function () { return AG.addressDay === day(); } },
          ],
          onComplete: function () { TASKS.address.live = null; scored("address"); dispersePress(12); },
          onFail: function () { TASKS.address.live = null; releasePress(); },
        });
        gatherPress();
      },
      end: function () { retire(TASKS.address.live); TASKS.address.live = null; releasePress(); },
      tick: function () {
        const t = TASKS.address;
        if (!t.live) return;
        // THE ORDER CAN BE SPENT SOMEWHERE ELSE. Press ADDRESS on the
        // Situation Room pad instead and the cooldown (or the treasury) is
        // gone for the day — the task is then impossible, so it is withdrawn
        // rather than left standing to be scored against you.
        if (AG.addressDay !== day()) {
          const B = addressOrder();
          if (B && !B.ok) {
            orders("Chief of Staff", "You already spoke, from inside. The lawn is being cleared.", 1);
            t.end();
            return;
          }
        }
        gatherPress();
      },
    },

    /* ---- 2. THE GENERAL ------------------------------------------------ */
    general: {
      id: "general", live: null, suspended: false,
      offer: function () { return !!site(); },
      order: function () {
        return "The General is waiting at the West Wing door. He will not come to you and he will not put it in writing.";
      },
      start: function () {
        const t = TASKS.general;
        const p = generalPost();
        t.live = missionStart({
          id: "presagenda:general", title: "Meet the General",
          brief: "The West Wing door. Hear what the threat actually is.",
          giver: "Chief of Staff", reward: 0,
          stages: [
            { id: "walk", text: "Reach the West Wing door", goal: "reach", radius: 4.0, label: "West Wing",
              at: function () { const q = CAST.general && CAST.general.pos ? CAST.general.pos : generalPost(); return q || p; } },
            { id: "brief", text: "Take the briefing", goal: "manual",
              at: function () { const q = CAST.general && CAST.general.pos ? CAST.general.pos : generalPost(); return q || p; },
              radius: 4.0, label: "West Wing",
              done: function () { return AG.briefDay === day(); } },
          ],
          onComplete: function () { TASKS.general.live = null; scored("general"); },
          onFail: function () { TASKS.general.live = null; },
        });
        postGeneral();
      },
      end: function () { retire(TASKS.general.live); TASKS.general.live = null; releaseGeneral(); },
      tick: function () {
        const t = TASKS.general;
        if (!t.live) return;
        if (!CAST.general || CAST.general.dead) postGeneral();
        if (CAST.generalDied && AG.briefDay !== day()) {
          orders("Chief of Staff", "The General is dead on his own doorstep. There is no briefing today, and there will be questions.", 2);
          feed("The General was killed at the West Wing door.", "#ff9c6a");
          t.end();
        }
      },
    },

    /* ---- 3. THE RIDE --------------------------------------------------- */
    ride: {
      id: "ride", live: null, suspended: false, mode: null,
      // the wall only exists once it has been ORDERED; the Bureau always does.
      offer: function () {
        const w = wall();
        return !!(bureauSite() || (w && w.ordered && wallPoint()));
      },
      pick: function (d) {
        const w = wall();
        const canWall = !!(w && w.ordered && wallPoint());
        const canBureau = !!bureauSite();
        if (canWall && canBureau) return h01(d * 3.7, 11, 7717) < 0.5 ? "wall" : "bureau";
        return canWall ? "wall" : "bureau";
      },
      order: function () {
        // city/motorcade.js is another organ of the same wave and may or may
        // not be in the build. If it is, name the chauffeur's own row so the
        // player is not told to walk 4.7 km; the label is READ from its
        // destinations() so the two can never drift apart. Never a dependency.
        const car = motorcadeLine(TASKS.ride.mode === "wall" ? "saltlands" : "bureau");
        return TASKS.ride.mode === "wall"
          ? "The Saltlands line wants a president standing on it, not a line item. Go and look at the wall." + car
          : "The Bureau will not tell you on a phone what it will tell you at its own gate. Go out there." + car;
      },
      start: function () {
        const t = TASKS.ride;
        const wall_ = t.mode === "wall";
        const pt = wall_ ? wallPoint() : bureauPoint();
        if (!pt) { t.live = null; return; }
        t.live = missionStart({
          id: "presagenda:ride", title: wall_ ? "Inspect the wall" : "Ride to the Bureau",
          brief: wall_ ? "Stand on the Saltlands line yourself." : "The Bureau's gate, in person.",
          giver: "Chief of Staff", reward: 0,
          locationName: wall_ ? "The state wall" : "Bureau Headquarters",
          goal: "reach", radius: wall_ ? 12 : 14,
          at: function () { return wall_ ? wallPoint() : bureauPoint(); },
          label: wall_ ? "The wall" : "The Bureau",
          onComplete: function () { TASKS.ride.live = null; scored("ride"); },
          onFail: function () { TASKS.ride.live = null; },
        });
      },
      end: function () { retire(TASKS.ride.live); TASKS.ride.live = null; },
      tick: function () {},
    },
  };

  // "the car is in the court, and this is the row to press" — or nothing at
  // all when motorcade.js is not loaded. Feature-detected end to end.
  function motorcadeLine(destId) {
    const M = CBZ.motorcade;
    if (!M || typeof M.go !== "function") return "";
    let label = null;
    if (typeof M.destinations === "function") {
      try {
        const L = M.destinations() || [];
        for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === destId) { label = L[i].label || L[i].name; break; }
      } catch (e) {}
    }
    return label
      ? " The chauffeur is in the motor court — “" + label + "”."
      : " The car is in the motor court; the detail will drive you.";
  }
  function bureauPoint() {
    const b = bureauSite();
    if (!b) return null;
    const gp = b.gate || { x: b.cx, z: b.rect ? b.rect.maxZ : b.cz };
    return { x: gp.x, z: gp.z };
  }
  // construction.js's wall plan is the only thing that knows where the line
  // is. `_plan()` is its own test hook; this is a READ, and it is the only
  // way to point at a segment without re-deriving the frontier here.
  function wallPoint() {
    const W = CBZ.stateWall;
    if (!W || typeof W._plan !== "function") return null;
    let P0 = null;
    try { P0 = W._plan(); } catch (e) { P0 = null; }
    if (!P0 || !P0.segs || !P0.segs.length) return null;
    // THE CROSSING, not a random slab. construction.js opens a gap where a
    // road cuts the line and garrisons it; that checkpoint is the only part
    // of a wall a head of state has any business standing at — and it is on
    // the desert highway, which is where the motorcade puts you down.
    const hwy = (CBZ.DESERT_HWY_Z != null) ? +CBZ.DESERT_HWY_Z : ((P0.z0 + P0.z1) / 2);
    let best = null, bestD = Infinity;
    const pool = (P0.gaps && P0.gaps.length) ? P0.gaps : P0.segs;
    for (let i = 0; i < pool.length; i++) {
      const d = Math.abs(pool[i].z - hwy);
      if (d < bestD) { bestD = d; best = pool[i]; }
    }
    if (!best) return null;
    return { x: P0.x + 6, z: best.z };     // the inside of the line, not on it
  }

  /* ---- 4. THE DRILL — pre-empts the whole board ----------------------
     It takes the BOARD, not the diary. The day's tasks come off the
     objective list while the threat is live and go back on when it stands
     down: a drill that costs you the rest of your day would just teach you
     to resent it, and the schedule the Chief of Staff wrote this morning is
     still the schedule. */
  const DRILL = { live: null };
  function suspendBoard() {
    for (const k in TASKS) {
      const T = TASKS[k];
      if (!T.live) continue;
      retire(T.live, "the threat is armed");
      T.live = null; T.suspended = true;
    }
  }
  function resumeBoard() {
    for (const k in TASKS) {
      const T = TASKS[k];
      if (!T.suspended) continue;
      T.suspended = false;
      let ok = false;
      try { ok = !!T.offer(); } catch (e) { ok = false; }
      if (!ok) { const i = AG.ids.indexOf(k); if (i >= 0) AG.ids.splice(i, 1); T.end(); continue; }
      try { T.start(); } catch (e) {}
    }
  }
  function startDrill() {
    const pt = roomDoor();
    if (!pt || DRILL.live) return;
    AG.drillDay = day();
    suspendBoard();
    big("THE THREAT IS ARMED");
    orders("Chief of Staff", "Not a drill. The detail is moving you. Situation Room, now — the door is already open.", 2);
    feed("Mansion detail: the President is being moved to the Situation Room.", "#ff9c6a");
    DRILL.live = missionStart({
      id: "presagenda:drill", title: "GET TO THE SITUATION ROOM",
      brief: "The threat is armed. Get behind the steel door.",
      giver: "Chief of Staff", reward: 0, marker: "ground",
      goal: "reach", radius: 3.4, label: "Situation Room",
      at: function () { return roomDoor(); },
      onComplete: function () {
        DRILL.live = null; AG.doneToday++;
        orders("Situation Room", "Doors sealed. The board is yours.", 2);
        feed("The President is in the Situation Room.", "#8fc1ff");
      },
      onFail: function () { DRILL.live = null; },
    });
  }
  function endDrill(quiet) {
    const had = !!DRILL.live;
    if (had) { retire(DRILL.live, "stood down"); DRILL.live = null; }
    if (!quiet) {
      if (had) orders("Chief of Staff", "Stand down. Whatever it was, it did not come here.", 1);
      resumeBoard();
      if (AG.ids.length) orders("Chief of Staff", "Back to the schedule.", 0);
    }
  }

  // ============================================================
  //  §4  THE SCENES — what a completed task actually looks like.
  // ============================================================
  function addressDelivered() {
    // press("address") already paid its own approval and debited the
    // treasury. This is the premium for doing it in daylight, on the steps,
    // with the press corps in front of you instead of from a bunker.
    AG.addressDay = day();
    big("THE ADDRESS");
    feed("The President addressed the country from the steps of the Executive Mansion.", "#ffd76a");
    if (CAST.press.length) {
      shock(PAY_ADDRESS);
      orders("Chief of Staff", "That played. Every camera on the lawn had you standing in front of your own house.", 1);
    } else {
      orders("Chief of Staff", "Delivered — to an empty lawn. Next time let the press get here first.", 1);
    }
  }

  function deliverBriefing() {
    if (!seated()) return;
    if (AG.briefDay === day()) { orders("Gen. Staff", "You have my report. Nothing has changed in an hour.", 0); return; }
    AG.briefDay = day();
    const T = threat(), W = wall();
    const who = (CAST.general && CAST.general.name) ? ("Gen. " + String(CAST.general.name).split(" ").pop()) : "The General";
    const strength = T.members > 0
      ? (T.members + " we can name, and that is the ones we can name.")
      : "Nobody on the board we can name. That is not the same as nobody out there.";
    const supply = "Supply is running at " + (T.supply | 0) + " of 9.";
    const intel = T.intel
      ? "We have the safehouse marked. The Bureau can move on your word."
      : "No thread to pull. Until one turns up a raid is a raid on an empty room.";
    orders(who, "Sir. Cell strength: " + strength, 1);
    orders(who, supply + " " + intel, 1);
    if (W && W.ordered) {
      orders(who, "The Saltlands line is " + (W.built | 0) + " of " + (W.total | 0) + " sections" +
        (W.done ? ", closed" : "") + (W.manned === false ? ", and the crossings are unmanned." : "."), 1);
    }
    if (T.armed) orders(who, "And they are moving today. Get behind the steel door.", 2);
    feed("The General briefed the President in the West Wing.", "#8fc1ff");
    shock(PAY_BRIEF);
  }

  function scored(id) {
    AG.doneToday++;
    if (id === "general") return;                 // the briefing paid itself
    if (id === "address") return;                 // press("address") + the premium
    if (id === "ride") {
      if (TASKS.ride.mode === "wall") {
        const W = wall();
        shock(PAY_WALL);
        big("THE PRESIDENT AT THE WALL");
        feed("The President walked the Saltlands line" + (W ? " — " + (W.built | 0) + " of " + (W.total | 0) + " sections up." : "."), "#ffd76a");
        orders("Chief of Staff", "Pictures of you on the line are worth more than the line.", 1);
      } else {
        shock(PAY_RIDE);
        feed("The President was received at Bureau Headquarters.", "#8fc1ff");
        orders("Chief of Staff", "The Director knows you came out here yourself. That buys you something the phone does not.", 1);
      }
    }
  }

  // ============================================================
  //  §5  THE DAY — pick two or three, hand them down, close the book.
  // ============================================================
  function available() {
    const out = [];
    for (const k in TASKS) { let ok = false; try { ok = !!TASKS[k].offer(); } catch (e) { ok = false; } if (ok) out.push(k); }
    return out;
  }
  // Deterministic, never the same list two days running. Order the available
  // ids by a per-day hash, take 2 or 3; if that lands on yesterday's exact
  // list, rotate one step. No stored RNG, no Math.random (repo law).
  function pickFor(d, pool) {
    if (!pool.length) return [];
    const ranked = pool.slice().sort(function (a, b) {
      return h01(d * 13.1, a.length * 7 + a.charCodeAt(0), 4211) - h01(d * 13.1, b.length * 7 + b.charCodeAt(0), 4211);
    });
    let n = Math.min(ranked.length, h01(d * 5.5, 3, 913) < 0.45 ? 3 : 2);
    if (n < 1) n = 1;
    let take = ranked.slice(0, n);
    const same = take.length === AG.lastIds.length && take.every(function (x) { return AG.lastIds.indexOf(x) >= 0; });
    if (same && ranked.length > n) take = ranked.slice(1, n + 1);
    else if (same && ranked.length === n && n > 1) take = ranked.slice(0, n - 1);
    return take;
  }

  function closeDay(quiet) {
    let undone = 0;
    for (const k in TASKS) {
      const T = TASKS[k];
      if (T.live || T.suspended) undone++;
      T.suspended = false;
      T.end();
    }
    endDrill(true);
    if (!quiet && undone > 0 && seated()) {
      const pen = Math.max(MISS_UNDONE_FLOOR, MISS_UNDONE * undone);
      shock(pen);
      orders("Chief of Staff", undone === 1
        ? "One thing on the schedule and it did not happen. People notice an empty diary."
        : (undone + " things on the schedule and none of them happened. People notice an empty diary."), 1);
    }
    AG.ids = [];
  }

  function issueDay(d) {
    // THE FIRST DAY IS THE SWEARING-IN'S. presidency.js hands out "Enter the
    // Situation Room" the morning you take office; the Chief of Staff does
    // not start stacking a diary on top of it until you have been through
    // that door. Not issuing leaves AG.issuedFor behind, so the tick retries.
    // ...but only on the day itself. Day two with the seal still unused is
    // not a reason to hand the head of state an empty diary.
    if (d === AG.firstDay && CBZ.mission && CBZ.mission.byId && CBZ.mission.byId("pres_sitroom")) return;
    closeDay(AG.issuedFor < 0);          // first issue of the run: nothing to score
    AG.day = d; AG.issuedFor = d; AG.doneToday = 0;
    if (!seated()) { AG.ids = []; return; }

    const ids = pickFor(d, available());
    AG.ids = ids.slice();
    AG.lastIds = ids.slice();
    if (!ids.length) return;

    // ride decides which of its two destinations it is BEFORE it speaks.
    if (ids.indexOf("ride") >= 0) TASKS.ride.mode = TASKS.ride.pick(d);

    orders("Chief of Staff", "Day " + d + ". " + ids.length + " on the schedule.", 2);
    for (let i = 0; i < ids.length; i++) {
      const T = TASKS[ids[i]];
      try { orders("Chief of Staff", T.order(), 1); } catch (e) {}
      try { T.start(); } catch (e) { try { console.error("[president_agenda] start " + ids[i], e); } catch (e2) {} }
    }
    // the diary is written either way; if the cell armed overnight the board
    // is taken over by the drill and handed back when it stands down.
    if (threat().armed) { AG.wasArmed = true; startDrill(); }
  }

  // ============================================================
  //  §6  WIRING
  // ============================================================
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (d) {
      if (!on()) return;
      try { issueDay(d); } catch (e) { try { console.error("[president_agenda] day", e); } catch (e2) {} }
    });
  }

  // Nothing survives leaving the city: mission.js already fails/retires the
  // handles on a mode change, so all this has to do is take the bodies and
  // the lectern down with them.
  if (CBZ.mission && CBZ.mission.onInterrupt) {
    CBZ.mission.onInterrupt(function (reason) {
      if (reason !== "mode") return;
      for (const k in TASKS) { TASKS[k].live = null; TASKS[k].suspended = false; TASKS[k].end(); }
      DRILL.live = null;
      releasePress(); releaseGeneral(); teardownPodium();
      AG.ids = []; AG.issuedFor = -1; AG.day = -1; AG.firstDay = -1; AG.wasArmed = false;
    });
  }

  // 38.785 — between presidency.js (38.78, which builds the room and arms the
  // threat) and construction.js (38.79). Everything below is throttled.
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(38.785, function (dt) {
    if (!on() || !inCity()) return;
    acc += dt || 0;
    if (acc < 0.5) return;
    acc = 0;

    if (!seated()) {
      // the seat was lost mid-term (impeachment, an election, a coffin).
      if (AG.ids.length || DRILL.live || CAST.press.length || CAST.general) closeDay(true);
      if (POD.group) teardownPodium();
      AG.firstDay = -1;
      return;
    }
    if (AG.firstDay < 0) AG.firstDay = day();     // the morning we took office

    // the podium is architecture: raise it once the Mansion exists, and
    // again if the world (and with it CBZ.govComplexes) was rebuilt.
    if (!POD.group || POD.builtFor !== CBZ.govComplexes || (POD.group.parent !== arenaRoot())) buildPodium();
    wirePodiumZone();

    // The day may not have wrapped since the swearing-in (or since the seat
    // changed hands), so the diary is opened here as well as on onNewDay.
    // issueDay() is idempotent per day and holds itself back while the
    // swearing-in mission is still live.
    const d = day();
    if (AG.issuedFor !== d) {
      try { issueDay(d); } catch (e) { try { console.error("[president_agenda] issue", e); } catch (e2) {} }
      if (AG.issuedFor !== d) return;      // held back: nothing else to do yet
    }

    // THE DRILL pre-empts the board the moment the cell arms, and stands
    // down when it no longer has.
    tickDisperse();
    const armed = !!threat().armed;
    if (armed && !AG.wasArmed && AG.drillDay !== d) startDrill();
    if (!armed && AG.wasArmed) endDrill(false);
    AG.wasArmed = armed;

    for (const k in TASKS) { try { TASKS[k].tick(); } catch (e) {} }
  });

  // ============================================================
  //  §7  AUDIT
  // ============================================================
  CBZ.presidentAgendaAudit = function () {
    return {
      today: AG.ids.slice(),
      done: AG.doneToday | 0,
      podiumBuilt: !!POD.group,
      seated: seated(),
      day: AG.issuedFor,
      pressCorps: CAST.press.length,
      general: !!(CAST.general && !CAST.general.dead),
      drill: !!DRILL.live,
      // every seam this file rides on, so a probe can see which of them the
      // build actually has (the contract half is still landing next door).
      seams: {
        mission: !!(CBZ.mission && CBZ.mission.start),
        press: !!(P() && P().press),
        status: !!(P() && P().status),
        postNpc: !!CBZ.cityPostNpc,
        zones: !!(CBZ.interactions && CBZ.interactions.registerZone),
        approval: !!CBZ.approvalShock,
        motorcade: !!(CBZ.motorcade && CBZ.motorcade.go),
      },
    };
  };
  // harness/test hooks only — not part of any contract
  CBZ.presidentAgenda = {
    audit: CBZ.presidentAgendaAudit,
    _issue: issueDay, _close: closeDay, _tasks: TASKS, _pod: POD, _cast: CAST,
    _drill: startDrill, _brief: deliverBriefing, _podium: buildPodium,
  };
})();
