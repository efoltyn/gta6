/* ============================================================
   systems/detection.js — the WANTED / HEAT system.

   You are NOT hunted by default. In the yard you're just another
   inmate; guards glance at you and move on. Heat only builds when you
   actually do something: brawl, get caught stealing, trespass in a
   restricted area (armory, cops' lounge, the exit corridor), or make
   an obvious break. Lay low and the heat cools right back down.

   Only when heat is up AND a guard can see you do they switch to a
   HUNT and chase you down (capture is handled in systems/capture.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, el, guardSees } = CBZ;
  const g = CBZ.game;

  // jail feature flag (self-defaulting): tower searchlights feed REAL
  // detection pressure — being in a beam builds heat fast and radios your
  // position to nearby guards (entities/searchlight.js owns the beam +
  // CBZ.litBySearchlight; the visual red-flush lives there too).
  if (CBZ.CONFIG && CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT == null) CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT = true;

  // restricted zones — being seen here is itself a crime
  function zoneOf(p) {
    if (p.x > 18.5 && p.x < 29.5 && p.z > -6.5 && p.z < 8.5) return "the armory";
    if (p.x > 18.5 && p.x < 29.5 && p.z > 29.5 && p.z < 44.5) return "the staff lounge";
    if (p.z > 47) return "the exit corridor";
    return null;
  }

  // anyone can pour heat on (combat, theft, escape attempts call this).
  // After strike two (systems/capture.js three-strikes arc) the block never
  // fully relaxes: g.strikeHeatFloor keeps a minimum simmer under the heat
  // bar. Jail-only — the floor is ignored outside escape mode and cleared by
  // state.js resetGame().
  CBZ.addHeat = function (n) {
    const floor = (g.mode === "escape" && g.strikeHeatFloor) || 0;
    g.detection = Math.max(floor, Math.min(100, g.detection + n));
  };
  CBZ.addComplaint = function (n) { g.complaints = Math.max(0, Math.min(100, (g.complaints || 0) + n)); };

  const raycaster = new THREE.Raycaster();
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  let litNow = false, litPingT = 0;   // searchlight exposure state (see below)

  function metaWithPlayerPos(meta) {
    const m = Object.assign({}, meta || {});
    if (!m.lastKnown) {
      m.lastKnown = {
        x: player.pos.x,
        z: player.pos.z,
        type: m.type || "crime",
        heardOnly: !!m.heardOnly,
      };
    }
    return m;
  }

  function reporterName(reporter) {
    return reporter && reporter.data ? reporter.data.name.replace(/^the |^a |^an /, "") : "witness";
  }

  function caseFile() {
    if (!g.caseFile) g.caseFile = { heat: 0, reports: [], lastSource: "", lastType: "", corrupt: 0 };
    if (!Array.isArray(g.caseFile.reports)) g.caseFile.reports = [];
    return g.caseFile;
  }

  function caseKind(meta) {
    const type = (meta && (meta.type || (meta.lastKnown && meta.lastKnown.type))) || "crime";
    if (type === "gunfire") return "shots";
    if (type === "melee") return "fight";
    if (type === "steal") return "theft";
    if (type === "taser") return "taser";
    if (type === "questioned") return "tip";
    if (type === "visual") return "sighting";
    return String(type).slice(0, 18);
  }

  function witnessCredibility(reporter, meta, opts) {
    opts = opts || {};
    meta = meta || {};
    if (opts.credibility != null) return Math.max(0.12, Math.min(1, opts.credibility));
    if (meta.credibility != null) return Math.max(0.12, Math.min(1, meta.credibility));
    if (!reporter || !reporter.personality) return opts.guardSeen ? 0.92 : (meta.heardOnly ? 0.52 : 0.76);
    const p = reporter.personality || {};
    let c = meta.heardOnly ? 0.42 : 0.68;
    c += (p.snitch || 0.5) * 0.18;
    c += (p.nerve || 0.5) * 0.12;
    c += Math.min(0.16, Math.max(0, reporter.playerGrudge || 0) * 0.018);
    c -= Math.min(0.14, Math.max(0, reporter.playerTrust || 0) * 0.014);
    c -= Math.min(0.12, Math.max(0, reporter.playerFear || 0) * 0.012);
    if (opts.corruptHold) c -= 0.10;
    return Math.max(0.18, Math.min(0.96, c));
  }

  function cleanLastKnown(meta, kind) {
    const lk = meta && meta.lastKnown;
    if (!lk || !Number.isFinite(lk.x) || !Number.isFinite(lk.z)) return null;
    return {
      x: lk.x,
      z: lk.z,
      type: lk.type || kind || meta.type || "crime",
      heardOnly: !!(lk.heardOnly || meta.heardOnly),
    };
  }

  function reportCredibility(r) {
    if (!r) return 0.5;
    return r.credibility == null ? (r.heardOnly ? 0.55 : 0.78) : Math.max(0.12, Math.min(1, r.credibility));
  }

  function reportScore(r) {
    if (!r) return -Infinity;
    const credibility = reportCredibility(r);
    const weak = r.heardOnly || credibility < 0.52;
    return (r.amount || 0) * (0.55 + credibility) + Math.min(22, r.t || 0) * 0.16 - (weak ? 2.4 : 0);
  }

  function strongestReport(cf) {
    let best = null, bestScore = -Infinity;
    for (const r of cf.reports || []) {
      const score = reportScore(r);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  function syncCaseFile(cf) {
    if (!cf) return null;
    cf.reports = (cf.reports || []).filter((r) => (r.t || 0) > 0 && (r.amount || 0) > 0.5);
    cf.reports.sort((a, b) => reportScore(b) - reportScore(a));
    const top = cf.reports[0];
    if (top) {
      cf.lastSource = top.source || cf.lastSource || "";
      cf.lastType = top.type || cf.lastType || "";
    } else if ((cf.heat || 0) <= 4) {
      cf.lastSource = "";
      cf.lastType = "";
    }
    return top || null;
  }

  CBZ.addCasePressure = function (amount, meta, reporter, opts) {
    opts = opts || {};
    meta = meta || {};
    if (meta.copCrime || meta.actorRole === "cop" || g.role === "cop") return null;
    meta = metaWithPlayerPos(meta);
    const cf = caseFile();
    const source = opts.source || reporterName(reporter);
    const kind = caseKind(meta);
    const lastKnown = cleanLastKnown(meta, kind);
    const credibility = witnessCredibility(reporter, meta, opts);
    const weight = opts.corruptHold ? 0.38 : (meta.heardOnly ? 0.48 : 0.74);
    const pressure = Math.max(1, (amount || 8) * weight * (0.62 + credibility * 0.50));
    cf.heat = Math.max(0, Math.min(100, (cf.heat || 0) + pressure));
    cf.lastSource = source;
    cf.lastType = kind;
    cf.corrupt = Math.max(0, (cf.corrupt || 0) + (opts.corruptHold ? pressure : 0));
    const existing = cf.reports.find((r) => r.source === source && r.type === kind);
    if (existing) {
      existing.amount = Math.min(40, (existing.amount || 0) + pressure);
      existing.t = Math.max(existing.t || 0, opts.corruptHold ? 24 : 34);
      existing.heardOnly = !!(existing.heardOnly && meta.heardOnly);
      existing.corrupt = !!(existing.corrupt || opts.corruptHold);
      existing.credibility = Math.max(existing.credibility || 0, credibility);
      if (lastKnown) existing.lastKnown = lastKnown;
    } else {
      cf.reports.unshift({
        source,
        type: kind,
        amount: pressure,
        t: opts.corruptHold ? 24 : 34,
        heardOnly: !!meta.heardOnly,
        corrupt: !!opts.corruptHold,
        credibility,
        lastKnown,
      });
      cf.reports.length = Math.min(cf.reports.length, 6);
    }
    syncCaseFile(cf);
    return cf;
  };

  CBZ.reduceCasePressure = function (amount, source) {
    const cf = caseFile();
    const drop = Math.max(0, amount || 0);
    cf.heat = Math.max(0, (cf.heat || 0) - drop);
    cf.corrupt = Math.max(0, (cf.corrupt || 0) - drop * 0.45);
    for (const r of cf.reports) {
      const match = !source || r.source === source || (source && r.source && source.indexOf(r.source) >= 0);
      if (match) {
        r.amount = Math.max(0, (r.amount || 0) - drop * 0.7);
        r.t = Math.min(r.t || 0, 5);
      } else {
        r.amount = Math.max(0, (r.amount || 0) - drop * 0.14);
      }
    }
    syncCaseFile(cf);
    return cf;
  };

  CBZ.challengeCaseSource = function (source, strength, opts) {
    opts = opts || {};
    const cf = caseFile();
    const s = source || "";
    let drop = 0, touched = 0, weakest = 1;
    for (const r of cf.reports) {
      const match = !s || r.source === s || (r.source && s.indexOf(r.source) >= 0) || (s && r.source && r.source.indexOf(s) >= 0);
      if (!match) continue;
      const credibility = r.credibility == null ? (r.heardOnly ? 0.55 : 0.78) : r.credibility;
      weakest = Math.min(weakest, credibility);
      const doubt = Math.max(0.24, 1.18 - credibility);
      const d = Math.max(0.5, (strength || 4) * doubt * (opts.force ? 1.2 : 1));
      r.amount = Math.max(0, (r.amount || 0) - d);
      r.t = Math.max(0, (r.t || 0) - d * 0.38);
      r.credibility = Math.max(0.12, credibility - d * 0.012);
      drop += d;
      touched++;
    }
    if (drop > 0) {
      cf.heat = Math.max(0, (cf.heat || 0) - drop * 0.72);
      syncCaseFile(cf);
    }
    return { ok: drop > 0.75, drop, touched, credibility: weakest };
  };

  CBZ.caseSummary = function () {
    const cf = caseFile();
    if ((cf.heat || 0) <= 4 && !cf.reports.length) return null;
    const top = strongestReport(cf) || {};
    const credibility = top.source ? reportCredibility(top) : null;
    const heardOnly = !!top.heardOnly;
    const weak = !!top.source && (heardOnly || (credibility != null && credibility < 0.52) || (top.amount || 0) < 4);
    return {
      heat: cf.heat || 0,
      source: top.source || cf.lastSource || "",
      type: top.type || cf.lastType || "case",
      corrupt: cf.corrupt || 0,
      credibility,
      count: cf.reports.length,
      ttl: top.t || 0,
      heardOnly,
      weak,
      reports: caseSourceList(3),
      lastKnown: top.lastKnown ? {
        x: top.lastKnown.x,
        z: top.lastKnown.z,
        type: top.lastKnown.type || top.type || "case",
        heardOnly: !!top.lastKnown.heardOnly,
      } : null,
    };
  };

  function caseSourceList(limit) {
    const cf = caseFile();
    syncCaseFile(cf);
    return (cf.reports || []).slice(0, limit || 4).map((r) => {
      const credibility = reportCredibility(r);
      const weak = !!(r.heardOnly || credibility < 0.52 || (r.amount || 0) < 4);
      return {
        source: r.source || "witness",
        type: r.type || "case",
        amount: r.amount || 0,
        ttl: r.t || 0,
        heardOnly: !!r.heardOnly,
        corrupt: !!r.corrupt,
        credibility,
        weak,
        lastKnown: r.lastKnown ? {
          x: r.lastKnown.x,
          z: r.lastKnown.z,
          type: r.lastKnown.type || r.type || "case",
          heardOnly: !!r.lastKnown.heardOnly,
        } : null,
      };
    });
  }

  CBZ.caseSources = function (limit) {
    return caseSourceList(limit || 4);
  };

  function liveReporter() {
    let best = null, bestScore = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!n || !n.data || n.dead || n.ko > 0 || n.escaped || !(n.reportedPlayerT > 0)) continue;
      const cred = n.reportedPlayerCred == null ? (n.reportedPlayerKind === "noise report" ? 0.45 : 0.68) : n.reportedPlayerCred;
      const score = (n.reportedPlayerT || 0) * 0.42 + (n.reportedPlayerAmount || 0) * 0.85 + cred * 8 + (n.reportedPlayerSpread || 0) * 1.4;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  function sourceName(v) {
    return String(v || "lead").replace(/^the |^a |^an /, "").slice(0, 18);
  }

  function credibilityWord(cred, weak, heardOnly) {
    if (heardOnly) return "heard";
    if (weak || (cred != null && cred < 0.52)) return "shaky";
    if (cred != null && cred > 0.78) return "solid";
    return "lead";
  }

  CBZ.wantedBreakdown = function () {
    const csum = CBZ.caseSummary && CBZ.caseSummary();
    const reporter = liveReporter();
    const lk = g.lastKnown && g.lastKnown.t > 0 ? g.lastKnown : null;
    const zone = zoneOf(player.pos);
    const heat = g.detection || 0;
    if (g.role === "cop") {
      const complaints = g.complaints || 0;
      return {
        mode: "badge",
        label: complaints >= 65 ? "Complaints building" : complaints > 18 ? "Reported by inmates" : "On Duty",
        chip: complaints >= 65 ? `Complaints ${Math.round(complaints)}` : complaints > 18 ? `Badge heat ${Math.round(complaints)}` : "On duty",
        strength: complaints,
      };
    }
    if (lk) {
      const source = sourceName(lk.source || (csum && csum.source) || (reporter && reporter.data && reporter.data.name));
      const corrupt = !!(csum && csum.corrupt > 6 && csum.corrupt >= (csum.heat || 0) * 0.28);
      const ttl = Math.ceil(lk.t || 0);
      return {
        mode: corrupt ? "corrupt" : "search",
        label: `${corrupt ? "Bent file" : "Searching"}: ${source}`,
        chip: `${corrupt ? "Bent file" : "Search"} ${source}${ttl ? " " + ttl + "s" : ""}`,
        source,
        type: lk.type || (csum && csum.type) || "search",
        ttl: lk.t || 0,
        strength: Math.max(heat, lk.amount || 0, csum ? csum.heat : 0),
        credibility: lk.credibility != null ? lk.credibility : (csum && csum.credibility),
        heardOnly: !!lk.heardOnly,
        corrupt,
        lastKnown: lk,
      };
    }
    if (csum && csum.heat > 8) {
      const source = sourceName(csum.source || (reporter && reporter.data && reporter.data.name) || csum.type || "case");
      const corrupt = csum.corrupt > 6 && csum.corrupt >= csum.heat * 0.28;
      const word = credibilityWord(csum.credibility, csum.weak, csum.heardOnly);
      const ttl = Math.ceil(csum.ttl || 0);
      return {
        mode: corrupt ? "corrupt" : "case",
        label: `${corrupt ? "Bent file" : (csum.weak ? "Weak tip" : "Case")}: ${source}`,
        chip: `${corrupt ? "Bent file" : "Case"} ${source} ${word}${ttl ? " " + ttl + "s" : ""}`,
        source,
        type: csum.type || "case",
        ttl: csum.ttl || 0,
        strength: Math.max(heat, csum.heat || 0),
        credibility: csum.credibility,
        heardOnly: !!csum.heardOnly,
        weak: !!csum.weak,
        corrupt,
        count: csum.count || 0,
        lastKnown: csum.lastKnown || null,
      };
    }
    if (reporter) {
      const source = sourceName(reporter.data.name);
      const cred = reporter.reportedPlayerCred == null ? (reporter.reportedPlayerKind === "noise report" ? 0.45 : 0.68) : reporter.reportedPlayerCred;
      const word = credibilityWord(cred, cred < 0.52, reporter.reportedPlayerKind === "noise report");
      const ttl = Math.ceil(reporter.reportedPlayerT || 0);
      return {
        mode: "witness",
        label: `Witness: ${source}`,
        chip: `Witness ${source} ${word}${ttl ? " " + ttl + "s" : ""}`,
        source,
        type: reporter.reportedPlayerKind || "witness",
        ttl: reporter.reportedPlayerT || 0,
        strength: reporter.reportedPlayerAmount || heat || 0,
        credibility: cred,
        heardOnly: reporter.reportedPlayerKind === "noise report",
      };
    }
    if (zone) {
      return {
        mode: "zone",
        label: `Trespass: ${zone}`,
        chip: `Trespass ${sourceName(zone)}`,
        source: zone,
        type: "trespass",
        strength: Math.max(heat, 8),
      };
    }
    if (heat > 5) {
      return {
        mode: "heat",
        label: "Watched",
        chip: `Heat ${Math.round(heat)}`,
        strength: heat,
      };
    }
    return { mode: "clear", label: "Clear", chip: "Clear", strength: 0 };
  };

  function decayCase(dt) {
    const cf = caseFile();
    const rate = (g.detection || 0) > 25 || (g.witnessReportT || 0) > 0 ? 0.16 : 0.34;
    cf.corrupt = Math.max(0, (cf.corrupt || 0) - 0.28 * dt);
    const active = (g.detection || 0) > 25 || (g.witnessReportT || 0) > 0 || (g.lastKnown && g.lastKnown.t > 0);
    let liveTotal = 0;
    for (const r of cf.reports) {
      const credibility = reportCredibility(r);
      const weak = r.heardOnly || credibility < 0.52;
      const tDecay = (active ? 0.72 : 1.0) * (weak ? 1.45 : 0.95);
      const amountDecay = (active ? 0.035 : 0.075) * (weak ? 1.65 : 1.0);
      r.t = Math.max(0, (r.t || 0) - dt * tDecay);
      r.amount = Math.max(0, (r.amount || 0) - amountDecay * dt);
      liveTotal += (r.amount || 0) * (0.72 + credibility * 0.34);
    }
    syncCaseFile(cf);
    const cap = cf.reports.length ? Math.min(100, liveTotal + Math.min(14, (cf.corrupt || 0) * 0.42)) : 0;
    if ((cf.heat || 0) > cap) {
      cf.heat += (cap - cf.heat) * Math.min(1, dt * (cf.reports.length ? 0.42 : 0.7));
    } else {
      cf.heat = Math.max(0, (cf.heat || 0) - rate * dt);
    }
  }

  function storeLastKnown(amount, meta, reporter) {
    meta = metaWithPlayerPos(meta);
    const lk = meta.lastKnown || {};
    g.lastKnown = {
      x: lk.x,
      z: lk.z,
      t: 13,
      amount: amount || 12,
      type: lk.type || meta.type || "crime",
      heardOnly: !!(lk.heardOnly || meta.heardOnly),
      source: reporter && reporter.data ? reporter.data.name.replace(/^the |^a |^an /, "") : "witness",
      credibility: meta.credibility != null ? meta.credibility : (reporter && reporter.reportedPlayerCred != null ? reporter.reportedPlayerCred : null),
      corrupt: !!(reporter && reporter.corrupt),
    };
    return g.lastKnown;
  }

  function dispatchSearch(amount, meta, reporter, focusGuard) {
    const lk = storeLastKnown(amount, meta, reporter);
    const guards = [];
    for (const gd of CBZ.guards) {
      if (!gd || gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0) continue;
      const dx = lk.x - gd.group.position.x, dz = lk.z - gd.group.position.z;
      guards.push({ gd, d2: dx * dx + dz * dz });
    }
    guards.sort((a, b) => a.d2 - b.d2);
    const count = Math.min(guards.length, focusGuard ? 3 : 2);
    if (focusGuard && !focusGuard.dead && !(focusGuard.ko > 0) && !focusGuard.corrupt) {
      focusGuard.investigate = { x: lk.x, z: lk.z, t: 7.5, scan: 0, type: lk.type };
      focusGuard.alert = Math.max(focusGuard.alert || 0, 0.9);
    }
    for (let i = 0, sent = focusGuard ? 1 : 0; i < guards.length && sent < count; i++) {
      const gd = guards[i].gd;
      if (gd === focusGuard || gd.hunt > 0) continue;
      gd.investigate = { x: lk.x, z: lk.z, t: 6.5 + sent * 1.2, scan: 0, type: lk.type };
      gd.alert = Math.max(gd.alert || 0, 0.75);
      sent++;
    }
    return lk;
  }

  CBZ.recordWitnessReport = function (amount, meta, reporter, guard) {
    meta = metaWithPlayerPos(meta || {});
    if (meta.copCrime || meta.actorRole === "cop" || g.role === "cop") {
      CBZ.addComplaint(amount * 0.55);
      return storeLastKnown(amount, meta, reporter);
    }
    if (guard && guard.corrupt) {
      const lk = storeLastKnown(amount, meta, reporter || guard);
      CBZ.addCasePressure(amount, meta, reporter || guard, { corruptHold: true, credibility: witnessCredibility(reporter, meta, { corruptHold: true }) });
      CBZ.addHeat(amount * 0.22);
      g.witnessReportT = Math.max(g.witnessReportT || 0, 6);
      guard.alert = Math.max(guard.alert || 0, 0.65);
      guard.investigate = null;
      if (CBZ.startGuardPayoffApproach && !guard.approach && guard.bribed <= 0) {
        CBZ.startGuardPayoffApproach(guard, "witnessBlackmail", {
          amount,
          source: lk.source || "a witness",
        });
      }
      return lk;
    }
    CBZ.addCasePressure(amount, meta, reporter, { credibility: witnessCredibility(reporter, meta) });
    CBZ.addHeat(amount * 0.78);
    g.witnessReportT = Math.max(g.witnessReportT || 0, 12);
    g.snitchReports = (g.snitchReports || 0) + 1;
    return dispatchSearch(amount, meta, reporter, guard);
  };

  function witnessRange(meta) {
    const type = meta && meta.type;
    if (type === "gunfire") return 18;
    if (type === "taser") return 13;
    if (type === "melee") return 10.5;
    if (type === "steal") return 7.5;
    return 10.5;
  }

  function hasLineToPlayer(n, dist) {
    _ro.set(n.group.position.x, 1.35, n.group.position.z);
    _rd.set(player.pos.x - n.group.position.x, player.pos.y + 1.0 - 1.35, player.pos.z - n.group.position.z).normalize();
    raycaster.set(_ro, _rd);
    raycaster.far = Math.max(0.1, dist - 0.4);
    return (CBZ.losRaycast ? CBZ.losRaycast(raycaster, CBZ.losBlockers) : raycaster.intersectObjects(CBZ.losBlockers, false)).length === 0;
  }

  function npcWitness(n, meta) {
    if (n.dead || n.ko > 0 || n.escaped) return null;
    const dx = player.pos.x - n.group.position.x, dz = player.pos.z - n.group.position.z;
    const dist = Math.hypot(dx, dz);
    const type = meta && meta.type;
    const loud = type === "gunfire" || type === "taser";
    const range = witnessRange(meta);
    if (dist > range) return null;
    const los = hasLineToPlayer(n, dist);

    if (!los) {
      if (loud && dist < range * 0.55) return { dist, heardOnly: true };
      return null;
    }

    if (dist <= (loud ? 6.5 : 4.2)) return { dist, heardOnly: false };
    if (loud) return { dist, heardOnly: false };
    const yaw = n.group.rotation.y || 0;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / Math.max(0.001, dist);
    return dot >= Math.cos(1.35) ? { dist, heardOnly: false } : null;
  }

  // does any guard have line-of-angle to this point? (cheap cone test)
  function seesPos(gd, p) {
    if (gd.dead || gd.ko > 0 || gd.bribed > 0) return false;
    const dx = p.x - gd.group.position.x, dz = p.z - gd.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > gd.viewDist || dist < 0.05) return false;
    const yaw = gd.group.rotation.y;
    return (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist >= Math.cos(gd.half);
  }
  // is the player's crime witnessed? returns the witnessing guard, or null
  CBZ.witnessGuard = function () {
    for (const gd of CBZ.guards) if (!gd.corrupt && guardSees(gd)) return gd;
    return null;
  };

  // a crime only matters if seen. nearby inmates may SNITCH — run to a
  // guard and rat you out even if no guard saw it directly.
  function trySnitch(amount, copCrime, meta) {
    for (const n of CBZ.npcs) {
      const witness = npcWitness(n, meta);
      if (!witness) continue;
      const d = witness.dist;

      const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
      const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
      const protectedByGang = n.gang >= 0 && CBZ.gangProtection && CBZ.gangProtection(n.gang) > 0;
      const standing = CBZ.gangStanding ? CBZ.gangStanding(n.gang) : 0;
      if ((sameGang || protectedByGang) && standing > -20) continue;

      const p = n.personality || {};
      let chance = copCrime ? 0.34 : 0.23;
      chance += (p.snitch || 0.5) * 0.22;
      chance += ((g.detection || 0) / 100) * 0.14;
      chance += rivalGang ? 0.18 : 0;
      chance += (n.playerGrudge || 0) * 0.025;
      chance -= sameGang ? 0.12 : 0;
      chance -= protectedByGang ? 0.18 : 0;
      if ((g.racketProtectionT || 0) > 0) chance += rivalGang ? 0.04 : -0.08;
      if ((g.lowProfileT || 0) > 0) chance -= 0.08;
      chance -= (n.playerTrust || 0) * 0.02;
      chance -= (n.playerFear || 0) * 0.018;
      chance -= Math.max(0, standing) * 0.002;
      if (witness.heardOnly) chance *= 0.45;
      if (d > 8) chance *= 0.72;

      if (CBZ.econ.rng() < chance) {
        const witnessMeta = metaWithPlayerPos(Object.assign({}, meta || {}, { copCrime, heardOnly: witness.heardOnly }));
        if (CBZ.npcWitnessCrime) {
          if (!CBZ.npcWitnessCrime(n, amount, witnessMeta)) continue;
        } else if (CBZ.sendNpcToSnitch && !CBZ.sendNpcToSnitch(n, amount, witnessMeta)) continue;
        if (!CBZ.sendNpcToSnitch && copCrime) CBZ.addComplaint(amount * 0.28);
        else if (!CBZ.sendNpcToSnitch) CBZ.addHeat(amount * 0.6);
        CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} ${witness.heardOnly ? "heard that" : "saw that"}.`, 1.6);
        return true;
      }
    }
    return false;
  }

  CBZ.reportCrime = function (amount, meta) {
    meta = metaWithPlayerPos(meta || {});
    const copCrime = meta.actorRole === "cop" || g.role === "cop";
    if (copCrime) {
      if (!trySnitch(amount, true, meta)) CBZ.addComplaint(amount * 0.05);
      return;
    }
    const gd = CBZ.witnessGuard();
    if (gd) {
      storeLastKnown(amount, meta, gd);
      CBZ.addCasePressure(amount, meta, gd, { guardSeen: true, credibility: 0.94 });
      CBZ.addHeat(amount);
      gd.hunt = 3.5; gd.alert = 1.0;
      return;
    }
    // unseen by guards: maybe a snitch inmate is watching
    if (trySnitch(amount, false, meta)) return;
    CBZ.addHeat(amount * 0.12);                   // got away clean, mostly
  };

  function updateDetection(dt) {
    if (g.mode === "survival") return;   // no wanted/heat system in disaster mode
    decayCase(dt);
    if (g.invuln > 0) g.invuln -= dt;
    if ((g.racketProtectionT || 0) > 0) {
      g.racketProtectionT = Math.max(0, g.racketProtectionT - dt);
      CBZ.addHeat(-2 * dt);
    }
    if (g.witnessReportT > 0) g.witnessReportT = Math.max(0, g.witnessReportT - dt);
    if (g.snitchIntelT > 0) g.snitchIntelT = Math.max(0, g.snitchIntelT - dt);
    if ((g.caseSearchCD || 0) > 0) g.caseSearchCD = Math.max(0, g.caseSearchCD - dt);
    if (g.lastKnown && g.lastKnown.t > 0) {
      g.lastKnown.t = Math.max(0, g.lastKnown.t - dt);
      if (g.lastKnown.t <= 0) g.lastKnown = null;
    }

    if (g.role === "cop") {
      CBZ.addComplaint(-6 * dt);
      for (const gd of CBZ.guards) {
        if (!gd.dead) { gd.hunt = 0; gd.alert = Math.max(0, (gd.alert || 0) - dt); }
        if (CBZ.updateGuardFlashlight) CBZ.updateGuardFlashlight(gd, dt);
      }
      const complaints = g.complaints || 0;
      el.detectLabel.textContent = "Badge";
      el.bar.style.width = complaints.toFixed(1) + "%";
      el.bar.style.background = complaints >= 65 ? "#ffb020" : complaints > 18 ? "#ffe14d" : "#3ad17a";
      el.dstate.textContent = complaints >= 65 ? "Complaints" : complaints > 18 ? "Reported" : "On Duty";
      el.vignette.style.boxShadow = "inset 0 0 200px 40px rgba(220,30,40,0)";
      return;
    }
    el.detectLabel.textContent = "Wanted";

    const zone = zoneOf(player.pos);
    let nearestSeer = Infinity, seenByAnyone = false;

    for (const gd of CBZ.guards) {
      if (gd.dead) continue;
      const sees = g.invuln <= 0 && guardSees(gd);
      if (sees) {
        seenByAnyone = true;
        const d = Math.hypot(player.pos.x - gd.group.position.x, player.pos.z - gd.group.position.z);
        nearestSeer = Math.min(nearestSeer, d);
        // trespassing in plain sight builds heat fast
        if (zone) CBZ.addHeat((gd.corrupt ? 8 : 18) * dt);
        if ((g.witnessReportT || 0) > 0 && !gd.corrupt) CBZ.addHeat(8 * dt);
        // already wanted + spotted → this guard joins the hunt
        if ((g.detection > 18 || (g.witnessReportT || 0) > 0) && !gd.corrupt) {
          storeLastKnown(10, { type: "visual" }, gd);
          gd.hunt = 3.0; gd.alert = 1.0; gd.investigate = null;
        }
      }
      if (CBZ.updateGuardFlashlight) CBZ.updateGuardFlashlight(gd, dt);
    }

    // ---- SEARCHLIGHTS ARE SENSORS (JAIL_SEARCHLIGHT_DETECT) ----
    // standing in a sweeping beam pours on heat and radios your position to
    // the nearest guards — the same investigate plumbing witness reports use.
    // Crouching shrinks the catch radius (litBySearchlight) AND halves the
    // burn if you're still caught. No pressure while hauled/cuffed/spawning.
    if (CBZ.CONFIG && CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT && g.mode === "escape" &&
        g.invuln <= 0 && !player.dead &&
        (!player.captureState || player.captureState === "normal") &&
        CBZ.litBySearchlight && CBZ.litBySearchlight(player.pos, player.crouch)) {
      CBZ.addHeat((player.crouch ? 16 : 30) * dt);
      if (!litNow && CBZ.flashHint) CBZ.flashHint("💡 SEARCHLIGHT — you're lit up!", 1.5);
      litNow = true;
      if (litPingT <= 0) {
        litPingT = 3.0;
        dispatchSearch(10, { type: "searchlight" }, { data: { name: "the tower" } }, null);
      }
    } else litNow = false;
    if (litPingT > 0) litPingT -= dt;

    const csum = CBZ.caseSummary && CBZ.caseSummary();
    if (csum && csum.heat > 18 && csum.lastKnown && (!g.lastKnown || g.lastKnown.t <= 0) && (g.caseSearchCD || 0) <= 0) {
      g.caseSearchCD = csum.weak ? 9.0 : 6.0;
      dispatchSearch(
        Math.max(8, Math.min(18, csum.heat * (csum.weak ? 0.26 : 0.36))),
        { type: csum.type, heardOnly: csum.heardOnly, lastKnown: csum.lastKnown },
        { data: { name: csum.source || "case file" } },
        null
      );
      g.witnessReportT = Math.max(g.witnessReportT || 0, csum.weak ? 2.5 : 4.0);
    }

    // heat slowly cools whenever you're not actively making it worse
    const caseHeat = csum ? csum.heat : ((g.caseFile && g.caseFile.heat) || 0);
    const cooling = (!zone && g.detection <= 60) ? Math.max(4.5, 10 - Math.min(4.5, caseHeat / 18)) : 4;
    CBZ.addHeat(-cooling * dt);

    // ---- HUD: relabel as WANTED ----
    // CITY: #detectWrap/#vignette are display:none!important (css/city.css) —
    // the city runs its own wanted HUD. All the state decay above still ran;
    // skip only the dead DOM writes + the wantedBreakdown()/label string
    // building (measured: fresh boxShadow string every frame for a hidden el).
    if (g.mode === "city") return;
    el.bar.style.width = g.detection.toFixed(1) + "%";
    const trace = CBZ.wantedBreakdown ? CBZ.wantedBreakdown() : null;
    const caseWho = trace && trace.source ? trace.source : (csum && csum.source ? csum.source : "");
    const caseLabel = trace && trace.mode === "corrupt" ? "Bent file" : (csum && csum.weak ? "Weak tip" : "Case");
    let col = "#3ad17a", label = "Clear";
    if (g.detection >= 70) { col = "#ff3b3b"; label = caseWho ? `HUNTED: ${caseWho}` : "HUNTED!"; }
    else if (g.detection >= 35) { col = "#ffb020"; label = (trace && trace.mode !== "clear") ? trace.label : ((g.witnessReportT || 0) > 0 || (csum && csum.heat > 18) ? `${caseLabel}: ${caseWho || "witness"}` : "Wanted"); }
    else if ((g.lastKnown && g.lastKnown.t > 0) || ((g.witnessReportT || 0) > 0 && g.detection > 5)) {
      col = "#ffb020";
      label = (trace && trace.mode !== "clear") ? trace.label : (g.lastKnown && g.lastKnown.source ? `Searching: ${g.lastKnown.source}` : "Searching");
    }
    else if (csum && csum.heat > 10) { col = "#ffe14d"; label = (trace && trace.mode !== "clear") ? trace.label : `${caseLabel}: ${caseWho || csum.type}`; }
    else if (g.detection > 5) { col = "#ffe14d"; label = (trace && trace.mode !== "clear") ? trace.label : "Watched"; }
    else if (zone) { col = "#ffe14d"; label = (trace && trace.mode !== "clear") ? trace.label : "Trespassing"; }
    el.bar.style.background = col;
    el.dstate.textContent = label;

    const vig = g.detection > 60 ? (g.detection - 60) / 40 : 0;
    el.vignette.style.boxShadow = `inset 0 0 200px 40px rgba(220,30,40,${(vig * 0.7).toFixed(2)})`;
  }

  CBZ.updateDetection = updateDetection;
  CBZ.onUpdate(30, updateDetection);
})();
