/* ============================================================
   city/wanted.js — the 5-star WANTED system, RDR2-style: you don't get
   stars for the ACT, you get them when a WITNESS REPORTS it.

   • Commit a crime → nearby people (and cops) become WITNESSES and
     remember it. After a beat of panic a witness phones it in — THAT is
     what raises your stars. Silence every witness before they call and
     you stay clean. A cop who sees it radios in immediately.
   • Stars scale with the worst thing reported (a mugging is one star, a
     murder several). Killing a cop is an automatic 5 stars.
   • Heat bleeds off when you break line of sight and lay low; at zero the
     cops give up. Getting CUFFED routes you to the prison ESCAPE game.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const COP_TARGET = [0, 2, 4, 7, 10, 14];
  let lastCrimeT = 0, busting = false;

  function starsFromHeat(h) {
    const T = CBZ.CITY.starHeat;
    let s = 0;
    for (let i = 1; i < T.length; i++) if (h >= T[i]) s = i;
    return s;
  }

  // RDR2-style: every crime has a real NAME and a star TIER. Your stars are the
  // WORST single thing you're wanted for — not a stack of petty heat. Killing
  // escalates by body count. Killing a cop is an automatic 5.
  const CRIME = {
    "speed":             { stars: 1, label: "Reckless Driving" },
    "reckless":          { stars: 1, label: "Reckless Driving" },
    "theft":             { stars: 1, label: "Petty Theft" },
    "pickpocket":        { stars: 1, label: "Pickpocketing" },
    "extortion":         { stars: 1, label: "Extortion" },
    "assault":           { stars: 1, label: "Assault" },
    "mugging":           { stars: 1, label: "Mugging" },
    "lying-to-police":   { stars: 1, label: "Obstruction" },
    "shots-fired":       { stars: 2, label: "Discharging a Firearm" },
    "gta":               { stars: 2, label: "Grand Theft Auto" },
    "vehicular-assault": { stars: 2, label: "Vehicular Assault" },
    "armed-robbery":     { stars: 2, label: "Armed Robbery" },
    "robbery":           { stars: 2, label: "Robbery" },
    "burglary":          { stars: 2, label: "Burglary" },
    "kidnapping":        { stars: 3, label: "Kidnapping" },
    "assault-officer":   { stars: 3, label: "Assaulting an Officer" },
    "murder":            { stars: 3, label: "Murder", kill: true },
    "vehicular homicide":{ stars: 3, label: "Vehicular Manslaughter", kill: true },
    "vehicular-homicide":{ stars: 3, label: "Vehicular Manslaughter", kill: true },
    "terrorism":         { stars: 5, label: "Terrorism" },
    "_copkill":          { stars: 5, label: "Cop Killer" },
  };
  function crimeInfo(type, sev) {
    const c = CRIME[type];
    if (c) return c;
    return { stars: (sev || 0) >= 150 ? 2 : 1, label: "Disturbance" };   // unknown type fallback
  }

  // the ONLY thing that raises your stars: a crime gets REPORTED (a witness calls
  // it in, or a cop sees it). If you're MASKED, nobody can ID you → no stars.
  function report(sev, opts) {
    opts = opts || {};
    if (g.cityMasked) {                              // shiesty/bandana on → unidentified
      if (CBZ.city && CBZ.city.note) CBZ.city.note("🎭 A masked suspect was reported — not ID'd as you.", 1.4);
      return;
    }
    const info = crimeInfo(opts.type, sev);
    let target = info.stars;
    // 5★ is meant to be RARE + earned — it scrambles the gunship + airstrikes, so it
    // must be REALLY hard to reach. A single killing (even a cop) tops out at 4★;
    // only a sustained SPREE gets you to 5★. Terrorism stays an instant 5★ (it's a
    // deliberate mass-casualty act). Cops weigh 5× a civilian toward the spree.
    if (opts.type === "_copkill" || info.kill) {
      if (opts.type === "_copkill") g.cityCopKills = (g.cityCopKills || 0) + 1;
      else g.cityMurders = (g.cityMurders || 0) + 1;
      const spree = (g.cityMurders || 0) + (g.cityCopKills || 0) * 5;
      target = spree >= 15 ? 5 : (spree >= 4 ? 4 : 3);
    }
    lastCrimeT = CBZ.now;
    g.cityLastKnown = { x: opts.x != null ? opts.x : CBZ.player.pos.x, z: opts.z != null ? opts.z : CBZ.player.pos.z, t: CBZ.now };
    const prev = g.wanted | 0;
    const want = Math.max(prev, Math.min(5, target));
    // sit the heat at the floor of that star tier (so the cops respond now and it
    // decays back DOWN over time) instead of stacking petty crimes up to 5.
    g.heat = Math.max(g.heat || 0, CBZ.CITY.starHeat[want] + 20);
    g.wanted = starsFromHeat(g.heat);
    g.cityCrimeLabel = info.label;
    if (g.wanted > prev) CBZ.city && CBZ.city.big("★".repeat(g.wanted) + " WANTED · " + info.label);
    else if (CBZ.city && CBZ.city.note) CBZ.city.note("Reported: " + info.label, 1.3);
    if (CBZ.cityEvent) CBZ.cityEvent("crime-reported", { crime: info.label, severity: sev, panic: Math.min(8, want * 1.4), wantedPeak: g.wanted }, { silent: true, noWanted: true });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityReport = report;

  function forceStars(n) {
    n = Math.min(5, n);
    g.heat = Math.max(g.heat || 0, CBZ.CITY.starHeat[n] + 5);
    const prev = g.wanted | 0; g.wanted = starsFromHeat(g.heat);
    lastCrimeT = CBZ.now; g.cityLastKnown = { x: CBZ.player.pos.x, z: CBZ.player.pos.z, t: CBZ.now };
    if (g.wanted > prev) { CBZ.city && CBZ.city.big("★".repeat(g.wanted) + " WANTED"); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityForceStars = forceStars;
  CBZ.cityCopKilled = function () { report(9999, { type: "_copkill", x: CBZ.player.pos.x, z: CBZ.player.pos.z }); };

  // does a LIVE cop actually SEE the crime happen? close enough AND a clear line of
  // sight (no building between them) — a cop behind a wall can't ID you, so no
  // instant report. This is the only "instant" star path that isn't face-to-face.
  function copWitness(x, z) {
    const cops = CBZ.cityCops;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (c.dead) continue;
      if (Math.hypot(c.pos.x - x, c.pos.z - z) >= 30) continue;
      // ray from the officer's eyeline to the crime spot; if a wall blocks it, they
      // didn't see it (cheap — only runs the instant a crime is committed).
      if (!CBZ.clearLineOfFire || CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.5, c.pos.z, x, 1.0, z)) return true;
    }
    return false;
  }

  // you committed a crime. This does NOT raise stars by itself — it tags
  // witnesses, who CALL IT IN after a beat of panic (→ report()). A cop who sees
  // it radios immediately; opts.instant reports now (used for face-to-face acts).
  function crime(amount, opts) {
    opts = opts || {};
    const x = opts.x != null ? opts.x : CBZ.player.pos.x;
    const z = opts.z != null ? opts.z : CBZ.player.pos.z;
    if (CBZ.cityEvent) CBZ.cityEvent("crime", { crime: (CRIME[opts.type] && CRIME[opts.type].label) || opts.type || "crime", severity: amount, x, z, panic: Math.min(5, amount / 40) }, { silent: true, noWanted: true });
    if (opts.instant) { report(amount, opts); return; }
    if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(x, z, amount, opts.type);   // witnesses remember WHAT they saw
    if (copWitness(x, z)) report(amount, opts);
  }

  function addHeat(n) { g.heat = Math.max(0, (g.heat || 0) + n); g.wanted = starsFromHeat(g.heat); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  function clearWanted() { g.heat = 0; g.wanted = 0; g.cityMurders = 0; g.cityCopKills = 0; g.cityCrimeLabel = null; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }

  // ---- DISGUISE: pull a mask up and witnesses can't ID you (no stars). [T] ----
  addEventListener("keydown", function (e) {
    if (e.repeat || g.mode !== "city" || g.state !== "playing") return;
    if ((e.key || "").toLowerCase() !== "t") return;
    e.preventDefault();
    g.cityMasked = !g.cityMasked;
    if (CBZ.city && CBZ.city.note) CBZ.city.note(g.cityMasked ? "🎭 Mask up — witnesses can't ID you." : "Mask off — your face is showing.", 1.8);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });
  // talk your stars DOWN by `levels` (a bought alibi) without fully clearing them
  CBZ.cityReduceWanted = function (levels) {
    const to = Math.max(0, (g.wanted | 0) - (levels || 1));
    g.heat = to === 0 ? 0 : (CBZ.CITY.starHeat[to] + 1);
    g.wanted = starsFromHeat(g.heat);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };

  // ---- BUST: cuffed by police → off to the jail (escape) game ----
  function bust(opts) {
    if (busting || g.busted) return;
    opts = opts || {};
    busting = true; g.busted = true;
   
    CBZ.city && CBZ.city.big(opts.peaceful ? "SURRENDERED" : "BUSTED");
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    // cooperating (hands up) costs you less than getting dragged in violently
    const frac = opts.peaceful ? 0.25 : 0.5;
    const lost = Math.round((g.cash || 0) * frac);
    if (lost > 0) { g.cash -= lost; }
    if (CBZ.cityEvent) CBZ.cityEvent("arrest", { lost, peaceful: !!opts.peaceful, debt: opts.peaceful ? 0 : 25 }, { noWanted: true });
    if (CBZ.cityBustOverlay) CBZ.cityBustOverlay(lost, toJail);
    else toJail();
  }
  function toJail() {
    busting = false;
    if (CBZ.setMode) CBZ.setMode("escape");
    if (CBZ.setRole) CBZ.setRole("inmate");
    if (CBZ.startRun) CBZ.startRun();
  }

  // ---- per-frame: decay heat when you lose the cops ----
  CBZ.onUpdate(33, function (dt) {
    if (g.mode !== "city") return;
    const sinceCrime = CBZ.now - lastCrimeT;
    let seen = false;
    const cops = CBZ.cityCops;
    for (let i = 0; i < cops.length; i++) { if (!cops[i].dead && cops[i].sees) { seen = true; break; } }
    if (!seen && sinceCrime > 3000 && (g.heat || 0) > 0) {   // 3s grace (CBZ.now is ms) before heat bleeds — not 3ms
      const rate = CBZ.CITY.heatDecay * (g.wanted >= 4 ? 0.6 : 1);
      g.heat = Math.max(0, g.heat - rate * dt);
      g.wanted = starsFromHeat(g.heat);
      if (g.heat <= 0) { g.cityMurders = 0; g.cityCopKills = 0; g.cityCrimeLabel = null; }   // cleared → fresh slate
    }
    g.cityCopTarget = COP_TARGET[Math.min(5, g.wanted | 0)];
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  CBZ.cityCrime = crime;
  CBZ.cityBust = bust;
  CBZ.cityWantedReset = function () { g.heat = 0; g.wanted = 0; g.busted = false; busting = false; lastCrimeT = 0; g.cityLastKnown = null; g.cityCopTarget = 0; g.cityMurders = 0; g.cityCopKills = 0; g.cityMasked = false; g.cityCrimeLabel = null; };
  function augment() { if (CBZ.city) { CBZ.city.crime = crime; CBZ.city.report = report; CBZ.city.addHeat = addHeat; CBZ.city.clearWanted = clearWanted; CBZ.city.stars = function () { return g.wanted | 0; }; } }
  if (CBZ.city) augment(); else { const iv = setInterval(function () { if (CBZ.city) { augment(); clearInterval(iv); } }, 0); }
})();
