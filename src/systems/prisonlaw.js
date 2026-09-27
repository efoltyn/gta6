/* ============================================================
   systems/prisonlaw.js — WHY the screws want you, and what happens when a
   fight breaks out in front of them.

   OWNER, after playing: "getting handcuffed is way too easy. It's way too
   easy to die." Before this file a guard had no idea why he was chasing you:
   heat (systems/detection.js) rose off almost anything, including every punch
   YOU took, and the moment a hunting screw touched you it was taser, tackle,
   cuffs, strike, transfer. A lost fistfight was a trip up the security ladder.

   This file is the reason ledger. It owns:

     CBZ.prisonOffense(kind, opts)  record an offense. kind is one of
         "fight" | "assault" | "contraband" | "restricted" | "escape" | "minor"
         opts { by, severity, at:{x,z}, seenBy: guard }
         The live record is g.offense = { kind, severity, t, warned, resisted,
         by, at, seenBy, stamp } and it DECAYS: a scuffle nobody followed up is
         forgotten in under a minute, an escape attempt in two.
     CBZ.prisonOffenseNow()         the live record or null
     CBZ.prisonOffenseClear(why)    wipe it (a warning given, time in the hole)
     CBZ.breakUpFight(x, z, opts)   the nearest one or two guards converge and
                                    shout; inmates hunting the player within
                                    8 m stand down (huntPlayer 0, _brokenUpT 20)
     CBZ.prisonLawNoteBlow(from, to) combat bookkeeping: who threw first
     CBZ.prisonLawAudit()           the counters (orders, complied, resisted,
                                    tases, cuffs, shu, transfers, downs,
                                    deaths, warnings, breakups, ...)

   systems/capture.js reads the record in its arrest sequence (order, comply
   window, escalation) and decides what cuffs cost: only "escape" goes up a
   tier. Guards poll for fights here at 4 Hz.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const KINDS = ["fight", "assault", "contraband", "restricted", "escape", "minor"];
  // severity 1 = a warning on comply, 2+ = cuffs and the hole, escape = up a tier
  const SEVERITY = { minor: 1, restricted: 2, fight: 2, contraband: 2, assault: 3, escape: 4 };
  // seconds the record lives if nobody acts on it
  const LIFE = { minor: 20, restricted: 45, fight: 45, contraband: 60, assault: 90, escape: 120 };

  const L = {
    orders: 0, complied: 0, resisted: 0, tases: 0, tackles: 0, cuffs: 0, shu: 0,
    transfers: 0, downs: 0, deaths: 0, warnings: 0, breakups: 0, offenses: 0,
    byKind: { fight: 0, assault: 0, contraband: 0, restricted: 0, escape: 0, minor: 0 },
  };
  CBZ.prisonLawCount = function (k, n) { if (k in L && typeof L[k] === "number") L[k] += (n == null ? 1 : n); };

  function now() { return (g && g.elapsed) || 0; }
  function inPrison() { return g && g.mode === "escape" && g.role !== "cop"; }
  function usableGuard(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !(gd.bribed > 0) &&
      !gd.tied && !gd._escort && gd.intimidMode !== "scared");
  }
  function wardenIncident(kind, opts) {
    const W = CBZ.warden;
    if (W && typeof W.incident === "function") { try { W.incident(kind, opts || {}); } catch (e) {} }
  }

  // ---- THE RECORD -----------------------------------------------------------
  let stamp = 0;
  CBZ.prisonOffense = function (kind, opts) {
    if (!inPrison()) return null;
    if (KINDS.indexOf(kind) < 0) kind = "minor";
    opts = opts || {};
    const sev = opts.severity != null ? +opts.severity : SEVERITY[kind];
    const at = opts.at || (CBZ.player ? { x: CBZ.player.pos.x, z: CBZ.player.pos.z } : null);
    const cur = g.offense && g.offense.t > 0 ? g.offense : null;
    L.offenses++; L.byKind[kind]++;
    let rec;
    if (!cur || sev >= cur.severity) {
      rec = {
        kind, severity: sev, t: LIFE[kind], life: LIFE[kind], by: opts.by || "player", at,
        seenBy: opts.seenBy || null, warned: !!(cur && cur.warned), resisted: !!(cur && cur.resisted),
        stamp: ++stamp, when: now(),
      };
      // escape outranks everything: once you are caught at the wire it stays an escape
      if (cur && cur.kind === "escape" && kind !== "escape") { rec.kind = "escape"; rec.severity = Math.max(sev, cur.severity); }
      g.offense = rec;
    } else {
      rec = cur;
      rec.t = Math.max(rec.t, LIFE[kind]);
      rec.stamp = ++stamp; rec.when = now();
      if (opts.seenBy) rec.seenBy = opts.seenBy;
    }
    // the man who saw it comes for you: that is what puts him in order range
    const gd = opts.seenBy;
    if (gd && usableGuard(gd) && kind !== "minor") {
      gd.hunt = Math.max(gd.hunt || 0, 3.5);
      gd.alert = 1.0;
      gd.investigate = null;
    }
    wardenIncident(kind, { x: at ? at.x : 0, z: at ? at.z : 0, severity: rec.severity, seenBy: gd || null });
    return rec;
  };
  CBZ.prisonOffenseNow = function () {
    const o = g && g.offense;
    return o && o.t > 0 ? o : null;
  };
  let lastClear = -1e9;
  CBZ.prisonOffenseClear = function () { g.offense = null; lastClear = now(); };
  // an offense recorded after the last release (the "same offense cannot
  // re-cuff you" rule: capture.js clears the record at release, so anything
  // live now is a new act)
  CBZ.prisonOffenseFresh = function () {
    const o = CBZ.prisonOffenseNow();
    return !!(o && o.when > lastClear);
  };

  /* ---- WHERE AN ARREST IS AN ESCAPE -----------------------------------------
     Inside the wire is x +-124, z -116..128 (world/prisonwings.js). The sterile
     zone is the patrol road between the inner fence (6.5 m in) and the wall
     (world/prisongrounds.js). The exit run is the sally port approach below
     the south block (z > 108 inside the old compound, gate at z 128). */
  function sterileAt(x, z) {
    return Math.abs(x) > 117.5 || z < -109.5 || (z > 121.5 && Math.abs(x) > 44);
  }
  function outOfBounds(x, z) { return Math.abs(x) > 124 || z > 128.5 || z < -116; }
  CBZ.prisonSterileAt = sterileAt;
  CBZ.prisonOutOfBounds = outOfBounds;
  CBZ.prisonEscapeCapture = function () {
    if (!CBZ.player) return false;
    const p = CBZ.player.pos;
    const o = CBZ.prisonOffenseNow();
    if (o && o.kind === "escape") return true;
    if (outOfBounds(p.x, p.z) || sterileAt(p.x, p.z)) return true;
    const zone = CBZ.restrictedZoneAt ? CBZ.restrictedZoneAt(p) : null;
    return zone === "the exit corridor" && ((g.detection || 0) >= 35 || (g.witnessReportT || 0) > 0);
  };

  // ---- WHO THREW FIRST --------------------------------------------------------
  // from/to are "player" or an inmate actor. A blow from the player on a man
  // who had not come for him (not hunting, has not hit him lately) makes the
  // player the starter of this fight.
  let fight = { starter: null, lastT: -1e9, lastBlowOnPlayerT: -1e9, lastPlayerBlowT: -1e9, foe: null };
  CBZ.prisonLawNoteBlow = function (from, to) {
    if (!inPrison()) return;
    const t = now();
    const fresh = t - fight.lastT > 6;
    if (from === "player") {
      fight.lastPlayerBlowT = t; fight.foe = to || fight.foe;
      const aggressor = to && (((to.huntPlayer || 0) > 0) || (t - (to._lawHitPlayerT || -1e9)) < 10);
      if (fresh && !aggressor) fight.starter = "player";
      else if (fresh) fight.starter = to;
    } else if (to === "player") {
      fight.lastBlowOnPlayerT = t; fight.foe = from || fight.foe;
      if (from) from._lawHitPlayerT = t;
      if (fresh) fight.starter = from || "inmate";
    }
    fight.lastT = t;
  };
  CBZ.prisonFightStarter = function () { return now() - fight.lastT < 8 ? fight.starter : null; };

  // ---- BREAK IT UP ------------------------------------------------------------
  const BREAK_R = 30, STAND_DOWN_R = 8;
  let breakCD = 0;
  CBZ.breakUpFight = function (x, z, opts) {
    if (!inPrison()) return false;
    opts = opts || {};
    const P = CBZ.player;
    if (x == null && P) { x = P.pos.x; z = P.pos.z; }
    // the nearest one or two screws inside BREAK_R
    const cand = [];
    for (const gd of CBZ.guards || []) {
      if (!usableGuard(gd) || gd.kind === "warden") continue;
      const d = Math.hypot(gd.group.position.x - x, gd.group.position.z - z);
      if (d < BREAK_R) cand.push({ gd, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const crew = cand.slice(0, 2).map((c) => c.gd);
    const seenBy = opts.seenBy && usableGuard(opts.seenBy) ? opts.seenBy : null;
    if (seenBy && crew.indexOf(seenBy) < 0) crew.unshift(seenBy);
    if (!crew.length) return false;
    const starter = opts.starter !== undefined ? opts.starter : CBZ.prisonFightStarter();
    const playerStarted = starter === "player" && !!seenBy && opts.reason !== "down";
    L.breakups++;
    breakCD = 6;
    for (let i = 0; i < crew.length && i < 2; i++) {
      const gd = crew[i];
      gd.alert = 1.0;
      if (playerStarted && i === 0) continue;          // he is coming for YOU (below)
      gd.investigate = { x: x + (i ? 1.8 : -1.8), z: z + (i ? -1.2 : 1.2), t: 7, scan: 0, type: "breakup", looking: true, player: false };
      if (!(gd.hunt > 0)) gd.warnT = null;
    }
    if (CBZ.guardLine) CBZ.guardLine(crew[0], "breakup", { force: true });
    // the men on you stand down and step off
    for (const n of CBZ.npcs || []) {
      if (!n || !n.group || n.dead || (n.ko || 0) > 0) continue;
      if (!((n.huntPlayer || 0) > 0)) continue;
      const nx = n.group.position.x, nz = n.group.position.z;
      if (Math.hypot(nx - x, nz - z) > STAND_DOWN_R) continue;
      n.huntPlayer = 0;
      n._brokenUpT = 20;
      n._blow = null;
      if (n.char) { n.char.fightStance = false; n.char.punchT = 0; }
      if (n.target && typeof n.target.set === "function") {
        const ax = nx - x, az = nz - z, al = Math.hypot(ax, az) || 1;
        n.target.set(nx + ax / al * 5, 0, nz + az / al * 5);
      }
    }
    // whoever started it gets the offense. Only the player can be arrested.
    if (playerStarted) {
      CBZ.prisonOffense("fight", { by: "player", seenBy, at: { x, z }, severity: opts.severity });
    }
    wardenIncident("fight", { x, z, starter: starter === "player" ? "player" : "inmate", seenBy, breakup: true });
    return true;
  };

  // ---- the guards' eyes on a fight: 4 Hz ---------------------------------------
  let pollT = 0;
  function fightPoll() {
    const P = CBZ.player;
    if (!P || P.dead || !CBZ.guardWatching) return;
    if (P.captureState && P.captureState !== "normal") return;
    const t = now();
    const live = (t - fight.lastBlowOnPlayerT) < 2.5 || (t - fight.lastPlayerBlowT) < 2.0;
    if (!live) return;
    let w = null;
    try { w = CBZ.guardWatching(P.pos.x, P.pos.y || 0, P.pos.z); } catch (e) { w = null; }
    if (!w || w.kind === "warden" && !usableGuard(w)) return;
    CBZ.breakUpFight(P.pos.x, P.pos.z, { seenBy: w, starter: CBZ.prisonFightStarter() });
  }

  CBZ.onUpdate(30.5, function (dt) {
    if (!inPrison()) return;
    // a new run: nothing carries over
    if (now() < 0.5 && (g.offense || fight.lastT > now())) {
      g.offense = null;
      fight = { starter: null, lastT: -1e9, lastBlowOnPlayerT: -1e9, lastPlayerBlowT: -1e9, foe: null };
      lastClear = -1e9;
    }
    const o = g.offense;
    if (o) { o.t -= dt; if (o.t <= 0) g.offense = null; }
    if (breakCD > 0) breakCD -= dt;
    pollT -= dt;
    if (pollT <= 0) { pollT = 0.25; if (breakCD <= 0) fightPoll(); }
  });

  CBZ.prisonLawAudit = function () {
    const o = CBZ.prisonOffenseNow();
    return {
      orders: L.orders, complied: L.complied, resisted: L.resisted, tases: L.tases, tackles: L.tackles,
      cuffs: L.cuffs, shu: L.shu, transfers: L.transfers, downs: L.downs, deaths: L.deaths,
      warnings: L.warnings, breakups: L.breakups, offenses: L.offenses, byKind: Object.assign({}, L.byKind),
      offense: o ? { kind: o.kind, severity: o.severity, t: +o.t.toFixed(1), warned: o.warned, resisted: o.resisted } : null,
      fightStarter: (function () { const s = CBZ.prisonFightStarter(); return s === "player" ? "player" : s ? "inmate" : null; })(),
      arrest: CBZ.prisonArrestPhase ? CBZ.prisonArrestPhase() : null,
      downed: CBZ.playerDowned ? CBZ.playerDowned() : false,
      hp: CBZ.player ? Math.round(CBZ.player.hp) : null,
    };
  };
})();
