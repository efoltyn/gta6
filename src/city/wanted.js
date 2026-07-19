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

  // ---- BOUNTY: a live dollar price on the player's head (PROG owns). Default 0,
  // rises in report() with reported-crime severity, resets to 0 on death. Read-only
  // accessor for the HUD/charpanel. (Plain field on g so it serializes with state.)
  if (g.cityBounty == null) g.cityBounty = 0;
  CBZ.cityBounty = function () { return g.cityBounty || 0; };

  // ---- WANTED_STARS_V2 — theft tiers + military jurisdiction (self-defaulted
  // here; config.js is owned by a parallel agent). Master flag off ⇒ every V2
  // behavior below (theft floors, carjack/boost split, military 5★ lane, the
  // base-trespass lockdown, the campaign-HUD star exemption) reverts to legacy.
  if (CBZ.CONFIG && CBZ.CONFIG.WANTED_STARS_V2 == null) CBZ.CONFIG.WANTED_STARS_V2 = true;
  if (CBZ.CONFIG && CBZ.CONFIG.WANTED_MIL_ZONE_GRACE == null) CBZ.CONFIG.WANTED_MIL_ZONE_GRACE = 0;    // base sensors trigger 5★ on entry
  if (CBZ.CONFIG && CBZ.CONFIG.WANTED_MIL_ZONE_INSET == null) CBZ.CONFIG.WANTED_MIL_ZONE_INSET = 8;    // u inset on the base AABB (edge-flicker guard)
  if (CBZ.CONFIG && CBZ.CONFIG.WANTED_THEFT_COOLDOWN == null) CBZ.CONFIG.WANTED_THEFT_COOLDOWN = 2000; // ms double-fire guard per theft type
  function v2() { return !!(CBZ.CONFIG && CBZ.CONFIG.WANTED_STARS_V2); }

  // cop response per star (read by police.js maintain() as g.cityCopTarget).
  // Steeper at the top: the now-RARE 5★ floods the streets with heavy units so it
  // FEELS overwhelming — a brutal crescendo to match the much harder wanted climb.
  const COP_TARGET = [0, 2, 4, 8, 12, 20];
  let lastCrimeT = 0, busting = false, arrestScene = null;
  // V2 module state: the base-trespass lock, the "military hardware just got
  // stolen" stamp (lets forceStars escalate an air theft to a real 5★), and the
  // per-type theft cooldown. All module-local — never serialized.
  let milLock = false, milWarnT = 0, _milTheftT = -1e9, _milHostileT = -1e9, _theftCtx = null, _theftCoolT = {}, _v2Body = null;
  // de-stack multi-witness reports of the SAME act: every ped in earshot of one
  // crime would otherwise call in its OWN full charge (N witnesses → N stacks).
  // A corroborating witness inside this space/time window only adds a small bump.
  let lastReport = { t: -1e9, x: 0, z: 0, stars: 0 };

  function starsFromHeat(h) {
    const T = CBZ.CITY.starHeat;
    let s = 0;
    for (let i = 1; i < T.length; i++) if (h >= T[i]) s = i;
    return s;
  }

  // ---- ESCAPED CONVICT FLOOR: while g.escapedConvict is set (you broke OUT of
  // jail, mode.js stamped it on the city reset), the manhunt cannot end on its
  // own — heat/stars can't bleed below the 3★ band. Only CBZ.cityClearConvict()
  // (a pardon / paying it off / leaving the manhunt behind) lifts it. Cheap; runs
  // off the existing decay tick. Idempotent — re-asserting the floor is harmless.
  function convictFloor() {
    if (!g.escapedConvict) return false;
    const floor = CBZ.CITY.starHeat[3] + 1;
    if ((g.heat || 0) < floor) g.heat = floor;
    if ((g.wanted | 0) < 3) g.wanted = 3;
    if (!g.cityCrimeLabel) g.cityCrimeLabel = "Escaped Convict";
    return true;
  }
  // lift the convict status: clears the flag + lets the heat decay normally again.
  // Stars are NOT zeroed (you may still be hot from a fresh crime) — only the
  // permanent 3★ floor is removed; the next decay tick can carry you back to 0.
  CBZ.cityClearConvict = function () {
    g.escapedConvict = false;
    if (g.cityCrimeLabel === "Escaped Convict") g.cityCrimeLabel = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  CBZ.cityIsConvict = function () { return !!g.escapedConvict; };

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
    "red-light":         { stars: 1, label: "Traffic Violation" },
    "trespass":          { stars: 1, label: "Trespassing" },
    "dealing":           { stars: 1, label: "Drug Dealing" },
    "chop":              { stars: 1, label: "Vehicle Trafficking" },
    "till grab":         { stars: 2, label: "Robbery" },
    "gang-assault":      { stars: 2, label: "Gang Assault" },
    "planting-explosives": { stars: 2, label: "Planting Explosives" },
    "bombing":           { stars: 4, label: "Bombing" },
    "kidnapping":        { stars: 3, label: "Kidnapping" },
    // ---- WANTED_STARS_V2 theft ladder: 1★ boost < 2★ hijack < 3★ cruiser <
    // 4★ aircraft < 5★ military aircraft. `floor` snaps heat to that tier the
    // moment the theft is REPORTED (a single witnessed theft used to charge
    // ~96 heat — below even the 1★ band — so stealing a car NEVER showed a
    // star). `mil` marks the military lane: sensors, not witnesses — a mask
    // doesn't beat radar. Floors/mil are read only while the V2 flag is on.
    "boosting":          { stars: 1, floor: 1, label: "Grand Theft Auto" },
    "carjacking":        { stars: 2, floor: 2, label: "Carjacking" },
    "grand-theft-police":{ stars: 3, floor: 3, label: "Stolen Police Cruiser" },
    "aircraft-hijacking":{ stars: 4, floor: 4, label: "Stolen Aircraft" },
    "grand-theft-military":{ stars: 4, floor: 4, mil: true, label: "Stolen Military Hardware" },
    "store robbery":     { stars: 2, label: "Armed Robbery" },   // shops.js fires this exact type — it was a silent no-op
    "grand-theft-aircraft":{ stars: 4, floor: 5, mil: true, label: "Stolen Military Aircraft" },
    "escaped-convict":   { stars: 3, label: "Escaped Convict" },
    "assault-officer":   { stars: 3, label: "Assaulting an Officer" },
    "murder":            { stars: 3, label: "Murder", kill: true },
    "vehicular homicide":{ stars: 3, label: "Vehicular Manslaughter", kill: true },
    "vehicular-homicide":{ stars: 3, label: "Vehicular Manslaughter", kill: true },
    "terrorism":         { stars: 4, label: "Terrorism" },   // only the SPREE path reaches 5★ now
    "_copkill":          { stars: 5, label: "Cop Killer" },
  };
  function crimeInfo(type, sev) {
    const c = CRIME[type];
    if (c) return c;
    // Unknown identifiers used to disappear silently, so a typo could disable
    // an entire crime/wanted path. Keep production play resilient but make the
    // broken contract visible once per identifier in development and audits.
    crimeInfo._warned = crimeInfo._warned || {};
    if (type && !crimeInfo._warned[type]) {
      crimeInfo._warned[type] = true;
      try { console.warn("[wanted] unknown crime id:", type); } catch (_) {}
    }
    return { stars: 0, label: "Disturbance" };   // unknown type fallback — NOT a chargeable crime
  }
  CBZ.cityCrimeTypes = Object.freeze(Object.keys(CRIME));

  // the ONLY thing that raises your stars: a crime gets REPORTED (a witness calls
  // it in, or a cop sees it). If you're MASKED, nobody can ID you → no stars.
  function report(sev, opts) {
    opts = opts || {};
    const T = CBZ.CITY.starHeat;
    const info = crimeInfo(opts.type, sev);
    // masked (shiesty/bandana) → witnesses can't ID you… EXCEPT the military
    // lane (V2): base sensors and radar track the MACHINE, not your face.
    if (g.cityMasked && !(v2() && info.mil)) return;
    // (CUT: "🎭 A masked suspect was reported — not ID'd as you." — you can't
    // hear a stranger's phone call. The mask's [T] toggle line already taught
    // the mechanic; the stars not climbing IS the feedback.)
    // a non-crime (unknown/"Disturbance") never charges heat or grants a star —
    // and it prints NOTHING ("Disturbance reported" cut: a phone call you
    // can't hear, about nothing, going nowhere). Bail before any heat math.
    if (info.stars <= 0) return;
    const x = opts.x != null ? opts.x : CBZ.player.pos.x;
    const z = opts.z != null ? opts.z : CBZ.player.pos.z;
    let target = info.stars;
    // 5★ is meant to be RARE + earned — it scrambles the gunship + airstrikes, so it
    // must be REALLY hard to reach. A single killing (even a cop) tops out at 4★;
    // only a long, sustained SPREE gets you to 5★, AND only once you've already
    // survived 4★ for a while (heat already at the 4★ floor). Cops weigh 3× a
    // civilian toward the spree (down from 5× — even a cop-kill alone caps at 4★).
    if (opts.type === "_copkill" || info.kill) {
      if (opts.type === "_copkill") g.cityCopKills = (g.cityCopKills || 0) + 1;
      else g.cityMurders = (g.cityMurders || 0) + 1;
      const spree = (g.cityMurders || 0) + (g.cityCopKills || 0) * 3;
      // 5★ requires BOTH a big spree AND that you're already deep at 4★ — never
      // popped from a single act. Otherwise the spree tops out at 4★.
      const fiveOk = spree >= 40 && (g.heat || 0) >= T[4];
      target = fiveOk ? 5 : (spree >= 12 ? 4 : 3);
    }
    lastCrimeT = CBZ.now;
    g.cityLastKnown = { x: x, z: z, t: CBZ.now };
    // is this a second witness corroborating the SAME act (close in space + time,
    // and no worse than the act already on record)? If so its per-crime gain is
    // a fraction — N onlookers to one bump don't stack into a multi-star event.
    const sameEvent = (CBZ.now - lastReport.t < 4000)
      && Math.hypot(x - lastReport.x, z - lastReport.z) < 14
      && target <= lastReport.stars;
    const prev = g.wanted | 0;
    const want = Math.max(prev, Math.min(5, target));
    // ACCUMULATE heat toward the NEXT star instead of snapping to a tier floor —
    // crimes build pressure, so climbing to 4★/5★ is a long grind while petty
    // crime still reaches 1-2★ promptly. K scales the per-crime gain by severity:
    // a single armed robbery (sev 160) ~ a 2★ band, while clawing to 4★ (3200) /
    // 5★ (12000) takes a long string of kills. A non-kill crime can NEVER push
    // heat above the top of its OWN CRIME.stars tier (so a run of muggings can't
    // sneak you to 4★); only a kill/spree carries you into the heavy tiers.
    // petty crimes (1★) barely charge; only real (2★+) acts get the full rate.
    const K = (info.stars >= 2 ? 1.6 : 0.7);
    // a corroborating witness of an act already on record only nudges the heat.
    // P6: fascism/dictatorship charges heat faster (CBZ.regimeHeatMul() ×1.4
    // while the player stands in one — city/regimes.js; guarded, defaults to 1).
    const charge = Math.max(1, sev || 1) * K * (sameEvent ? 0.25 : 1) * (CBZ.regimeHeatMul ? CBZ.regimeHeatMul() : 1);
    const gain = (g.heat || 0) + charge;
    // ceiling: climb toward just under the next star up, but a GRANTED tier must
    // always at least reach its own floor (so a target=5 spree kill can finally
    // cross the 12000 wall into 5★ instead of clamping one shy of it).
    let ceil = Math.max(T[Math.min(5, want)], T[Math.min(5, want + 1)] - 1);
    if (!(opts.type === "_copkill" || info.kill)) {
      // petty crime is capped to its OWN tier band (a run of muggings can't sneak
      // you up to 4★) — but it can still snap to the floor of the tier it earns.
      ceil = Math.min(ceil, Math.max(T[Math.min(5, info.stars)], T[Math.min(5, info.stars + 1)] - 1));
    }
    g.heat = Math.max(g.heat || 0, Math.min(ceil, gain));
    g.wanted = starsFromHeat(g.heat);
    // ---- V2 THEFT FLOOR: a REPORTED theft snaps heat 20% INTO its tier band.
    // Without this, a single witnessed car theft charged ~96 heat — below even
    // the 1★ band — so "stealing a car" never visibly raised the wanted level.
    // 20% in (not the bare threshold+1) so the earned star survives more than
    // one decay tick once you slip out of sight — petty theft still cools off
    // in ~10s of laying low. Floors only fire on a report that already passed
    // the witness/mask gates, so an UNSEEN boost in an empty lot still stays
    // clean (the stealth reward).
    if (v2() && info.floor) {
      const f = Math.min(5, info.floor);
      const pad = ((T[f + 1] || T[5] * 1.4) - T[f]) * 0.2;   // top tier: a synthetic band cap
      g.heat = Math.max(g.heat, T[f] + pad);
      g.wanted = starsFromHeat(g.heat);
    }
    if (v2() && info.mil) _milTheftT = CBZ.now;   // lets forceStars escalate a military AIR theft to 5★
    // any reported crime INSIDE the base wire = hostile incursion — the zone
    // lock (militaryZone below) skips its grace period on a fresh stamp.
    if (v2()) {
      const MB = CBZ._militaryBase;
      if (MB && x > MB.minX && x < MB.maxX && z > MB.minZ && z < MB.maxZ) _milHostileT = CBZ.now;
    }
    // ---- BOUNTY ($ on your head): rises with every REPORTED crime, scaled by how
    // bad the reported act is. Petty (1★) reports add ~$500; a serious act several
    // thousand; a cop-killing spree (target 5) drops a big chunk each report — so a
    // sustained rampage stacks toward ~$50k+. A corroborating same-event witness
    // only nudges it (matches the heat de-stack). Hard cap so it can't run away.
    // Reads as infamy by the level/title read and is zeroed on death.
    {
      const tierPay = [0, 500, 2200, 6000, 14000, 32000];   // per-report base by GRANTED tier (want)
      let pay = tierPay[Math.min(5, Math.max(0, want))];
      // a spree kill (5★ target) or a cop-kill earns its own heavy bump on top.
      if (opts.type === "_copkill") pay += 18000;
      else if (info.kill) pay += 4000;
      pay *= (sameEvent ? 0.2 : 1);                          // de-stack multi-witness
      g.cityBounty = Math.min(250000, Math.max(0, (g.cityBounty || 0) + Math.round(pay)));
    }
    lastReport = { t: CBZ.now, x: x, z: z, stars: target };
    g.cityCrimeLabel = info.label;
    // the centre flash fires ONLY when a star is actually GAINED (that's direct
    // personal danger — the response just got heavier). A same-tier report no
    // longer prints "Reported: <crime>": you can't overhear a witness's call,
    // and the heat ring/star meter already carry the pressure.
    if (g.wanted > prev) CBZ.city && CBZ.city.big("★".repeat(g.wanted) + " WANTED · " + info.label);
    if (CBZ.cityEvent) CBZ.cityEvent("crime-reported", { crime: info.label, severity: sev, panic: Math.min(8, want * 1.4), wantedPeak: g.wanted }, { silent: true, noWanted: true });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityReport = report;

  function forceStars(n) {
    // V2 MILITARY-AIR ESCALATION: militaryvehicles.js boards a machine as
    // cityCrime(type:"grand-theft-military") + cityForceStars(ground?3:4) — the
    // fresh mil-theft stamp plus an AIR-tier (4) force means a military
    // aircraft just left the wire ⇒ the owner-mandated hard 5★. Ground
    // hardware forces 3 and stays at its 4★ report floor; civilian aircraft
    // ("aircraft-hijacking") never stamp, so they cap at 4★ as before.
    if (v2() && n >= 4 && (CBZ.now - _milTheftT) < 800) { _milTheftT = -1e9; raiseStars(5, "Stolen Military Aircraft"); return; }
    // empire raids / wealth heat / heists can crank you to 4★ but NEVER hand a
    // free 5★ — the top star is reserved for an earned spree (see report()).
    n = Math.min(4, n);
    g.heat = Math.max(g.heat || 0, CBZ.CITY.starHeat[n] + 5);
    const prev = g.wanted | 0; g.wanted = starsFromHeat(g.heat);
    lastCrimeT = CBZ.now; g.cityLastKnown = { x: CBZ.player.pos.x, z: CBZ.player.pos.z, t: CBZ.now };
    if (g.wanted > prev) { CBZ.city && CBZ.city.big("★".repeat(g.wanted) + " WANTED"); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityForceStars = forceStars;

  // ---- V2 PUBLIC STAR API (guard-callable by jail escape / minimap / any
  // system agent). raiseStars is the one grant primitive: "ensure at least
  // `tier` stars" as REAL heat (so it decays normally and never lowers
  // anything). Reasons naming the military (case-insensitive "military")
  // may grant the top star — every other caller clamps at 4, preserving the
  // "5★ is earned" law for ordinary scripted grants.
  function raiseStars(tier, reason) {
    const maxTier = (reason && /military/i.test(String(reason))) ? 5 : 4;
    tier = Math.max(0, Math.min(maxTier, tier | 0));
    if (tier <= 0) return g.wanted | 0;
    const prev = g.wanted | 0;
    g.heat = Math.max(g.heat || 0, CBZ.CITY.starHeat[tier] + 5);
    g.wanted = starsFromHeat(g.heat);
    lastCrimeT = CBZ.now;
    if (CBZ.player && CBZ.player.pos) g.cityLastKnown = { x: CBZ.player.pos.x, z: CBZ.player.pos.z, t: CBZ.now };
    if (reason) g.cityCrimeLabel = String(reason);
    g.cityCopTarget = COP_TARGET[Math.min(5, g.wanted | 0)];
    if (g.wanted > prev) CBZ.city && CBZ.city.big("★".repeat(g.wanted) + " WANTED" + (reason ? " · " + reason : ""));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return g.wanted;
  }
  CBZ.cityStars = function () { return g.wanted | 0; };
  CBZ.cityAddStars = function (n, reason) { return raiseStars((g.wanted | 0) + (n == null ? 1 : (n | 0)), reason); };

  // ---- SCRIPTED ARREST SETUP (campaign/director API) -------------------------
  // A scripted beat that must END IN CUFFS (the campaign's rooftop trap) cannot
  // hand-poke g.wanted/g.heat: police.js's arrest-first AI flips to LETHAL force
  // at 4★+ (and legacy flag-off cops shoot from 2★), and any stale fired-upon
  // stamp or spree memory re-escalates the responders. This puts the whole force
  // into a "close in and take them" posture:
  //   • heat is FORCED into the highest still-arrestable band (3★ arrest-first,
  //     2★ legacy) — clamped DOWN too, a prior rampage can't out-rank the script;
  //   • fired-upon stamps + spree counters get a fresh slate (the officers on
  //     this call have no reason to shoot first — yet; shooting one of them
  //     re-stamps fired-upon and lethality returns honestly);
  //   • any stale bust latch is cleared so the scripted CBZ.cityBust always fires.
  // opts: { stars, heat, reason }. Returns the stars actually granted.
  CBZ.cityForceArrestSetup = function (opts) {
    opts = opts || {};
    const T = CBZ.CITY.starHeat;
    // police.js defaults CITY_ARREST_FIRST true; mirror that read here.
    const arrestFirst = !(CBZ.CONFIG && CBZ.CONFIG.CITY_ARREST_FIRST === false);
    const cap = arrestFirst ? 3 : 2;
    const want = Math.max(1, Math.min(cap, opts.stars != null ? (opts.stars | 0) : cap));
    let heat = opts.heat != null ? +opts.heat : T[want] + 5;
    heat = Math.max(T[want] + 1, Math.min(T[Math.min(5, cap + 1)] - 1, heat));
    g.heat = heat;
    g.wanted = starsFromHeat(g.heat);
    g._copsFiredUponT = 0; g._copWoundT = 0;          // arrest posture, not payback
    g.cityMurders = 0; g.cityCopKills = 0;            // spree memory would re-escalate
    g.busted = false; busting = false;                // a stale latch would eat the scripted bust
    lastCrimeT = CBZ.now;
    if (CBZ.player && CBZ.player.pos) g.cityLastKnown = { x: CBZ.player.pos.x, z: CBZ.player.pos.z, t: CBZ.now };
    if (opts.reason) g.cityCrimeLabel = String(opts.reason);
    g.cityCopTarget = COP_TARGET[Math.min(5, g.wanted | 0)];
    CBZ.city && CBZ.city.big("★".repeat(Math.max(1, g.wanted)) + " WANTED" + (opts.reason ? " · " + opts.reason : ""));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return g.wanted;
  };
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
    // ---- V2 THEFT TIERS: vehicles.js fires every player car entry as a flat
    // cityCrime(60, "gta"). The cityEnterVehicle wrap below stamps _theftCtx
    // with what the door ACTUALLY was — a parked boost stays a witnessed 1★
    // misdemeanor, dragging a driver out is a face-to-face 2★ (the victim IS
    // the witness → instant), and a police cruiser is a 3★ (an occupied one
    // radios in immediately). Legacy behavior when the flag is off.
    if (v2() && _theftCtx && opts.type === "gta") {
      const t = _theftCtx; _theftCtx = null;   // consume — one theft, one charge
      opts = Object.assign({}, opts);
      if (t.police) { opts.type = "grand-theft-police"; amount = Math.max(amount, 130); if (t.occupied) opts.instant = true; }
      else if (t.occupied) { opts.type = "carjacking"; amount = Math.max(amount, 120); opts.instant = true; }
      else { opts.type = "boosting"; opts.instant = true; }
    }
    // V2 double-fire guard: a re-fired theft of the same type inside the window
    // (board/eject glitches, double interact) charges nothing.
    if (v2()) {
      const inf = CRIME[opts.type];
      if (inf && inf.floor) {
        if (inf.mil) _milTheftT = CBZ.now;   // stamp BEFORE any gate — radar saw the machine move
        const cd = +CBZ.CONFIG.WANTED_THEFT_COOLDOWN || 0;
        if (CBZ.now - (_theftCoolT[opts.type] || -1e9) < cd) return;
        _theftCoolT[opts.type] = CBZ.now;
      }
    }
    // THE UNIFORM READS (outfits.js): police colors buy trust on the street —
    // civilians don't call the law on "an officer" doing minor work. VIOLENCE
    // in uniform blows the costume, and impersonation makes the charge burn
    // hotter. (A manhunt at 2★+ outranks any costume — copTrust handles that.)
    if (CBZ.cityOutfitCopTrust && CBZ.cityOutfitCopTrust()) {
      if (amount >= 60) {
        if (CBZ.cityOutfitBlow) CBZ.cityOutfitBlow();
        amount = Math.round(amount * (CBZ.cityOutfitHeatMult ? CBZ.cityOutfitHeatMult() : 1.5));
      } else return;   // minor crime in uniform: witnesses saw "police work"
    }
    const x = opts.x != null ? opts.x : CBZ.player.pos.x;
    const z = opts.z != null ? opts.z : CBZ.player.pos.z;
    if (CBZ.cityEvent) CBZ.cityEvent("crime", { crime: (CRIME[opts.type] && CRIME[opts.type].label) || opts.type || "crime", severity: amount, x, z, panic: Math.min(5, amount / 40) }, { silent: true, noWanted: true });
    if (opts.instant) { report(amount, opts); return; }
    if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(x, z, amount, opts.type);   // witnesses remember WHAT they saw
    if (copWitness(x, z)) report(amount, opts);
  }

  // ---- V2: see the door for what it is. vehicles.js (loads after us) owns
  // CBZ.cityEnterVehicle and ejects the driver BEFORE it fires the "gta" crime,
  // so occupancy is unreadable by the time crime() runs. This wrap (the
  // cityKillPlayer lazy-wrap pattern below) captures occupied/police at the
  // door handle and hands it to crime() via _theftCtx. Idempotent, flag-guarded.
  function wrapEnterVehicle() {
    if (typeof CBZ.cityEnterVehicle !== "function") return false;   // not loaded yet → retry
    if (CBZ.cityEnterVehicle._starsWrapped) return true;
    const orig = CBZ.cityEnterVehicle;
    const wrapped = function (car) {
      if (!v2() || !car || car.stolen || car.owned || car.player) return orig.apply(this, arguments);
      _theftCtx = { occupied: !!car.npcDriver, police: !!(car._patrolCar || car.cop || car.police) };
      try { return orig.apply(this, arguments); } finally { _theftCtx = null; }
    };
    // copy EVERY *Wrapped marker forward (the explosion-wrapper law) so other
    // modules' idempotence guards (e.g. modshop's _modPerfWrapped) survive us.
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._starsWrapped = true;
    CBZ.cityEnterVehicle = wrapped;
    return true;
  }
  if (!wrapEnterVehicle()) { const ivEV = setInterval(function () { if (wrapEnterVehicle()) clearInterval(ivEV); }, 0); }

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

  // ============================================================
  //  BOUNTIES_V2 — HITMAN CONTRACTS (owner: "wanted posters that spawn a
  //  mission to find and kill… bounties given to a hitman… some MASSIVE
  //  bounties"). A live BOARD of open contracts on real city NPCs — gang
  //  bosses & lieutenants, corrupt company owners, tycoons, and the world's
  //  own rollBounty fugitives — with an occasional MASSIVE $1M+ contract on
  //  the richest eligible mark (ties into ECONOMY_V2's cityNetWorthOf).
  //
  //  THE TRICK THAT KEEPS THIS SMALL: peds.js ALREADY pays out ped.bounty on
  //  a player kill (cash + "BOUNTY CLAIMED" + respect, clears the bounty,
  //  paid once) AND exempts a bountied ped from crowd recycling AND floats a
  //  ☠ tag over them. So accepting a contract just stamps ped.bounty/
  //  bountyTag on the target and the engine does kill-detection, payout and
  //  keep-alive for free. Completion is read back as "target dead + bounty
  //  cleared" (only a player kill clears it); "dead but bounty intact" means
  //  someone else got them → contract failed. NO cityKillPed wrap needed —
  //  and no double payout, because completion here never calls addCash.
  //
  //  ONE contract active at a time (one unambiguous waypoint, mirrors the
  //  campaign's single-mission model, no competing map pins). The board may
  //  OFFER several. CBZ.bountyFromPoster(poster) is the props-side entry:
  //  interacting with a wanted poster accepts the nearest/best open offer.
  //  The contract record is MODULE-LOCAL, never on g — it holds a live ped
  //  reference (circular three.js graph) that must not enter serialization.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.BOUNTIES_V2 == null) CBZ.CONFIG.BOUNTIES_V2 = true;
  function bountiesOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.BOUNTIES_V2); }
  let contract = null;          // { id, tag, reward, target, targetName, expireT, pingT, lastSeen, massive, _weSetBounty }
  let bountyBoard = [];         // open offers: { id, kind, tag, reward, ref, name, massive, _weSetBounty }
  let bountyCooldown = 0;       // seconds until the board deals again after a close
  let boardT = 0, offerSeq = 1;
  let _bs = 777001;             // local LCG (runtime mission state — never world-build input)
  function brng() { _bs = (_bs * 1103515245 + 12345) & 0x7fffffff; return _bs / 0x7fffffff; }

  function bNotify(text) {
    try {
      if (CBZ.phoneNotify) { CBZ.phoneNotify({ from: "BLKLST", app: "contracts", text: text }); return; }
    } catch (e) {}
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 3);
  }
  function bMoney(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function districtNameAt(x, z) {
    const e = CBZ.cityEcon;
    return (e && e.districtAt && e.districtName) ? e.districtName(e.districtAt(x, z)) : "the city";
  }
  // gigs/jobs own the shared map pin while active — the contract ping yields.
  function waypointBusy() { return !!(g.cityJob || g.cityGig); }
  function contractWaypoint(t) {
    if (waypointBusy()) return;
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) { try { CBZ.fullMap.setWaypoint(t.pos.x, t.pos.z, "🎯 " + (t.name || "MARK")); } catch (e) {} }
  }
  function dropContractWaypoint() {
    if (waypointBusy()) return;   // never clear a gig's pin
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
  }

  // a ped we may put a contract on: live, in the world, not the player's
  // people, not already carrying OUR contract, not a scripted campaign target.
  function contractable(p) {
    if (!p || p.dead || p.isPlayer || p.vendor || p.companion || p.recruited) return false;
    if (p._campaignTarget || p._contractId) return false;
    if (p.protectGang === "player" || p.gang === "player") return false;
    return true;
  }
  function pushOffer(kind, p, reward, tag, massive) {
    if (!p || reward < 1000) return;
    for (let i = 0; i < bountyBoard.length; i++) if (bountyBoard[i].ref === p) return;   // one offer per head
    bountyBoard.push({ id: "bo" + (offerSeq++), kind: kind, tag: tag, reward: Math.round(reward), ref: p, name: p.name || tag, massive: !!massive, _weSetBounty: !(p.bounty > 0) });
    if (massive) {
      const dk = districtNameAt(p.pos.x, p.pos.z);
      if (CBZ.cityFeed) { try { CBZ.cityFeed("🩸 Word on the street: a " + bMoney(reward) + " contract is out on " + (p.name || "a big name") + " (" + dk + ")", "#ff6a5e"); } catch (e) {} }
    }
  }
  // top the board up to 5 open offers from live city sources (throttled ~4s)
  function topUpBoard() {
    // drop stale offers (dead/despawned/claimed heads)
    for (let i = bountyBoard.length - 1; i >= 0; i--) {
      const o = bountyBoard[i];
      if (!o.ref || o.ref.dead || (CBZ.cityPeds && CBZ.cityPeds.indexOf(o.ref) < 0)) bountyBoard.splice(i, 1);
    }
    if (bountyBoard.length >= 5) return;
    const peds = CBZ.cityPeds || [];
    let hasMassive = contract && contract.massive ? 1 : 0;
    for (let i = 0; i < bountyBoard.length; i++) if (bountyBoard[i].massive) hasMassive++;
    // 1) adopt the world's own fugitives (rollBounty peds) — their price IS the reward
    for (let i = 0; i < peds.length && bountyBoard.length < 5; i++) {
      const p = peds[i];
      if (p && p.bounty > 0 && contractable(p)) pushOffer("fugitive", p, p.bounty, p.bountyTag || "WANTED", p.bounty >= 1000000);
    }
    // 2) gang bosses / lieutenants (crime-war contracts)
    const gangs = CBZ.cityGangs || [];
    for (let i = 0; i < gangs.length && bountyBoard.length < 5; i++) {
      const gn = gangs[i];
      if (!gn || gn.isPlayer || gn.absorbed) continue;
      if (gn.boss && contractable(gn.boss) && brng() < 0.35) pushOffer("boss", gn.boss, 80000 + brng() * 170000, "GANG BOSS");
      else if (gn.members) {
        for (let j = 0; j < gn.members.length; j++) {
          const m = gn.members[j];
          if (m && (m.rank === "lt" || m.rank === "enforcer") && contractable(m) && brng() < 0.2) { pushOffer("lt", m, 25000 + brng() * 55000, "LIEUTENANT"); break; }
        }
      }
    }
    // 3) corrupt money: company owners + tycoons — priced off their REAL worth
    //    (ECONOMY_V2), so the MASSIVE contracts land on the ultra-rich.
    for (let i = 0; i < peds.length && bountyBoard.length < 5; i++) {
      const p = peds[i];
      if (!contractable(p)) continue;
      if (p.isCompanyOwner && brng() < 0.25) {
        const nw = CBZ.cityNetWorthOf ? CBZ.cityNetWorthOf(p) : 5e6;
        pushOffer("owner", p, Math.min(500000, Math.max(50000, nw * 0.005)), "CORRUPT EXEC");
      } else if (p._milli && brng() < 0.18) {
        const nw = CBZ.cityNetWorthOf ? CBZ.cityNetWorthOf(p) : 5e6;
        const massive = !hasMassive && nw >= 100e6 && brng() < 0.5;   // the rare ultra-rich head
        if (massive) hasMassive = 1;
        pushOffer("tycoon", p, Math.min(massive ? 5000000 : 2000000, Math.max(50000, nw * (massive ? 0.02 : 0.01))), massive ? "HIGH-VALUE CONTRACT" : "TYCOON", massive);
      }
    }
  }

  function stampTarget(o) {
    const t = o.ref;
    if (!t || t.dead || !contractable(t)) return null;
    if (t.bounty > 0) o._weSetBounty = false;              // adopt a world fugitive's own price
    else { t.bounty = Math.round(o.reward); o._weSetBounty = true; }
    t.bountyTag = o.tag;
    t._contractId = o.id;
    return t;
  }
  function clearOurBounty(c) {
    const t = c && c.target;
    if (t) { if (c._weSetBounty) { t.bounty = 0; t.bountyTag = null; } t._contractId = null; }
  }
  function acceptContract(o) {
    const t = stampTarget(o);
    if (!t) { bNotify("Couldn't get a fix on the target. Check the board again later."); return null; }
    const dk = districtNameAt(t.pos.x, t.pos.z);
    contract = {
      id: o.id, tag: o.tag, reward: (t.bounty | 0) || o.reward, target: t,
      targetName: t.name || o.tag, expireT: CBZ.now + 8 * 60 * 1000, pingT: 12,
      lastSeen: { x: t.pos.x, z: t.pos.z }, massive: !!o.massive, _weSetBounty: o._weSetBounty,
    };
    for (let i = bountyBoard.length - 1; i >= 0; i--) if (bountyBoard[i].id === o.id) bountyBoard.splice(i, 1);
    contractWaypoint(t);
    bNotify("🎯 Contract accepted: " + contract.targetName + " (" + bMoney(contract.reward) + ") — last seen in " + dk + ". The map ping refreshes as they move.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return contract;
  }
  function completeContract() {
    const c = contract; if (!c) return;
    // peds.js already PAID the cash + announced "BOUNTY CLAIMED" — bookkeeping only here.
    if (CBZ.cityFeed) { try { CBZ.cityFeed("🎯 Contract fulfilled: " + c.targetName + " · +" + bMoney(c.reward), "#7ed957"); } catch (e) {} }
    if (CBZ.city) CBZ.city.addRespect(c.reward >= 1000000 ? 20 : 6);
    // CONSEQUENCE: a sanctioned hit on a KNOWN CRIMINAL earns a partial pardon
    // ("the law looks the other way"); murdering a respectable tycoon/exec
    // does NOT — the witnesses saw a murder and you stay hot.
    const sanctioned = /WANTED|FUGITIVE|DANGEROUS|BOSS|LIEUTENANT/i.test(c.tag || "");
    if (sanctioned && CBZ.cityReduceWanted) CBZ.cityReduceWanted(1);
    bNotify("Contract paid: " + bMoney(c.reward) + "." + (sanctioned ? " The law looks the other way this time." : ""));
    dropContractWaypoint();
    contract = null; bountyCooldown = 90;
  }
  function failContract(why) {
    const c = contract; if (!c) return;
    clearOurBounty(c);
    dropContractWaypoint();
    bNotify("Contract failed — " + why + ".");
    if (CBZ.cityFeed) { try { CBZ.cityFeed("❌ Contract failed — " + why, "#ff8a8a"); } catch (e) {} }
    contract = null; bountyCooldown = 60;
  }
  function pingContract(manual) {
    const c = contract, t = c && c.target;
    if (!t || t.dead) return;
    c.lastSeen = { x: t.pos.x, z: t.pos.z };
    contractWaypoint(t);
    if (manual) bNotify("Ping: " + c.targetName + " last seen in " + districtNameAt(t.pos.x, t.pos.z) + ".");
  }
  // the per-frame contract brain — folded into the existing order-33 tick below
  function bountyTick(dt) {
    if (!bountiesOn() || g.mode !== "city") return;
    if (bountyCooldown > 0) bountyCooldown -= dt;
    boardT -= dt;
    if (boardT <= 0) { boardT = 4; try { topUpBoard(); } catch (e) {} }
    const c = contract; if (!c) return;
    const t = c.target;
    if (t && t.dead) {
      // player kill ⇒ peds.js cleared the bounty as it paid; intact ⇒ rival got them
      if ((t.bounty | 0) === 0) completeContract();
      else { t.bounty = 0; t.bountyTag = null; failContract("someone else got to them first"); }
      return;
    }
    if (!t || (CBZ.cityPeds && CBZ.cityPeds.indexOf(t) < 0)) { failContract("the trail went cold"); return; }
    if (CBZ.now >= c.expireT) { failContract("the contract expired"); return; }
    c.pingT -= dt;
    if (c.pingT <= 0) { c.pingT = 12; pingContract(false); }
  }

  // ---- public surface --------------------------------------------------------
  // The props agent wires wanted-poster interaction to this: accept the best
  // open contract (bias: nearest offer to the poster). `poster` may be a lot,
  // a prop record, a position, or nothing at all — read defensively.
  CBZ.bountyFromPoster = function (poster) {
    if (!bountiesOn() || g.mode !== "city") return null;
    if (contract) {
      bNotify("You've already got a live contract — " + contract.targetName + " (" + bMoney(contract.reward) + "). Finish it or let it expire.");
      pingContract(true);
      return contract;
    }
    if (bountyCooldown > 0) { bNotify("The board's quiet right now. Check back soon."); return null; }
    try { topUpBoard(); } catch (e) {}
    if (!bountyBoard.length) { bNotify("Just old paper — nothing active on this one."); return null; }
    const px = (poster && typeof poster.x === "number") ? poster.x : (poster && poster.pos && typeof poster.pos.x === "number") ? poster.pos.x : (CBZ.player ? CBZ.player.pos.x : 0);
    const pz = (poster && typeof poster.z === "number") ? poster.z : (poster && poster.pos && typeof poster.pos.z === "number") ? poster.pos.z : (CBZ.player ? CBZ.player.pos.z : 0);
    // MASSIVE contracts headline the poster; otherwise the biggest purse near it
    let best = null, bs = -1;
    for (let i = 0; i < bountyBoard.length; i++) {
      const o = bountyBoard[i];
      if (!o.ref || o.ref.dead) continue;
      const d = Math.hypot(o.ref.pos.x - px, o.ref.pos.z - pz);
      const s = (o.massive ? 1e9 : 0) + o.reward - d * 20;
      if (s > bs) { bs = s; best = o; }
    }
    return best ? acceptContract(best) : null;
  };
  CBZ.cityContract = function () { return contract; };
  CBZ.cityContracts = function () { return bountyBoard.slice(); };
  CBZ.cityContractPing = function () { if (contract) pingContract(true); };
  CBZ.cityContractAbandon = function () { if (contract) failContract("abandoned"); };

  // ============================================================
  //  V2 MILITARY JURISDICTION — Fort Brandt is a SPECIAL zone (owner: "entering
  //  the military base should make stars go to max"). The base AABB comes from
  //  island_military.js (CBZ._militaryBase). Walk inside the wire and you get a
  //  short spoken grace ("RESTRICTED — TURN BACK"); linger past it (or commit
  //  ANY crime inside — a hostile act skips the grace) and the sensor grid
  //  locks a hard 5★ floor, re-asserted every tick like convictFloor. It
  //  bypasses witnesses AND the mask — radar tracks bodies, not faces. Leave
  //  the zone and a PURE-trespass 5★ demotes to the top of the 4★ band (a
  //  manhunt that decays normally); a GENUINE 5★ (a stolen military aircraft's
  //  higher heat) survives the exit. Busts/scripted arrests always win: the
  //  floor stands down while a bust is in motion.
  // ============================================================
  function releaseMilZone() {
    milLock = false; milWarnT = 0; _milHostileT = -1e9;
    if ((g.wanted | 0) >= 5 && (g.heat || 0) <= CBZ.CITY.starHeat[5] + 2) {   // only the floor was holding it
      g.heat = CBZ.CITY.starHeat[5] - 1;                                      // top of the 4★ band → decays normally
      g.wanted = starsFromHeat(g.heat);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  }
  function militaryZone(dt) {
    if (!v2()) { milLock = false; milWarnT = 0; return; }
    const B = CBZ._militaryBase, P = CBZ.player;
    if (!B || !P || !P.pos || g.state !== "playing" || P.dead || g.busted || busting) {
      if (milLock) releaseMilZone(); else milWarnT = 0;
      return;
    }
    const inset = +CBZ.CONFIG.WANTED_MIL_ZONE_INSET || 0;
    const x = P.pos.x, z = P.pos.z;
    const inside = x > B.minX + inset && x < B.maxX - inset && z > B.minZ + inset && z < B.maxZ - inset;
    if (!inside) { if (milLock) releaseMilZone(); else milWarnT = 0; return; }
    if (!milLock) {
      if (milWarnT === 0 && CBZ.city && CBZ.city.big) CBZ.city.big("⚠ RESTRICTED AREA — TURN BACK");
      milWarnT += dt;
      // a fresh crime reported INSIDE the wire (report() stamps _milHostileT)
      // = hostile incursion, no grace. 10s window: generous enough that a
      // slow frame can't let the stamp lapse before this tick reads it.
      const hostile = (CBZ.now - _milHostileT) < 10000;
      const configuredGrace = Number(CBZ.CONFIG.WANTED_MIL_ZONE_GRACE);
      const grace = Number.isFinite(configuredGrace) ? Math.max(0, configuredGrace) : 0;
      if (milWarnT < grace && !hostile) return;
      milLock = true;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("★★★★★ MILITARY INCURSION");
    }
    // the re-asserted floor (convictFloor pattern): never lowers a higher heat
    if ((g.heat || 0) < CBZ.CITY.starHeat[5] + 1) g.heat = CBZ.CITY.starHeat[5] + 1;
    if ((g.wanted | 0) < 5) g.wanted = 5;
    g.cityCrimeLabel = "Military Incursion";
    lastCrimeT = CBZ.now;   // the grid tracks you — no heat decay inside the wire
  }

  // ---- BUST: cuffed by police → off to the jail (escape) game ----
  // opts.bigLabel / opts.note (city/origins.js, the EXEC fraud arrest): an
  // optional custom big-text + overlay sub-line for a scripted bust that
  // isn't the generic wanted-star cuffing (e.g. "BUSTED — SECURITIES FRAUD").
  // Both default to the existing generic text when omitted — fully backward
  // compatible with every other bust() caller.
  function bust(opts) {
    if (busting || g.busted) return;
    opts = opts || {};
    busting = true; g.busted = true;
    const P = CBZ.player;
    if (P && P.driving && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    if (P) { P._cityArrested = true; P.speed = 0; }
    if (CBZ.playerChar) { CBZ.playerChar.handsUp = true; CBZ.playerChar.cuffed = false; }
    // Prefer the officer who made contact; cooperative/scripted arrests still
    // pick the nearest real officer instead of inventing an invisible captor.
    let cop = opts.cop || null;
    if (!cop && P) {
      let bd = 14;
      for (const c of CBZ.cityCops || []) {
        if (!c || c.dead) continue;
        const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z);
        if (d < bd) { bd = d; cop = c; }
      }
    }
    if (cop) {
      cop._arrestingPlayer = true; cop.curTarget = null; cop.npcTarget = null;
      cop.sees = true; cop.speed = 0; cop.state = "arrest";
    }
    arrestScene = { t: 0, dur: opts.peaceful ? 2.2 : 3.0, opts: opts, cop: cop, finished: false };
  }
  function finishBustScene(sc) {
    if (!sc || sc.finished) return;
    sc.finished = true;
    const opts = sc.opts || {};
    CBZ.city && CBZ.city.big(opts.bigLabel || (opts.peaceful ? "SURRENDERED" : "BUSTED"));
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    // cooperating (hands up) costs you less than getting dragged in violently
    const frac = opts.peaceful ? 0.25 : 0.5;
    const lost = Math.round((g.cash || 0) * frac);
    if (lost > 0) g.cash -= lost;
    if (CBZ.cityEvent) CBZ.cityEvent("arrest", { lost, peaceful: !!opts.peaceful, debt: opts.peaceful ? 0 : 25 }, { noWanted: true });
    if (CBZ.cityBustOverlay) CBZ.cityBustOverlay(lost, toJail, { note: opts.note });
    else toJail();
  }
  CBZ.onUpdate(32.8, function (dt) {
    const sc = arrestScene;
    if (!sc || sc.finished || g.mode !== "city") return;
    sc.t += dt;
    const P = CBZ.player, ch = CBZ.playerChar, c = sc.cop;
    if (P) { P._cityArrested = true; P.speed = 0; }
    if (ch) {
      ch.handsUp = sc.t < 0.75;
      ch.cuffed = sc.t >= 0.62;
      if (CBZ.animChar) CBZ.animChar(ch, 0, dt);
    }
    // The arresting officer remains a physical participant: close the last
    // metre, face the player and hold position while the cuffs go on.
    if (c && !c.dead && P) {
      c._arrestingPlayer = true; c.curTarget = null; c.npcTarget = null; c.speed = 0;
      const dx = P.pos.x - c.pos.x, dz = P.pos.z - c.pos.z;
      if (c.group) c.group.rotation.y = Math.atan2(dx, dz);
    }
    if (sc.t >= sc.dur) finishBustScene(sc);
  });
  function toJail() {
    if (arrestScene && arrestScene.cop) arrestScene.cop._arrestingPlayer = false;
    arrestScene = null;
    if (CBZ.player) CBZ.player._cityArrested = false;
    if (CBZ.playerChar) { CBZ.playerChar.handsUp = false; CBZ.playerChar.cuffed = false; }
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
      // Decay scales with how much heat you're carrying (a flat base + a small
      // fraction of current heat) so the HUGE high tiers bleed in reasonable
      // absolute time instead of taking hours — a hard-won 5★ is STICKY-but-
      // escapable: you must truly lose the heavy units for a sustained stretch
      // (~1.5 min unseen to shed a star at 5★), but it never permanently traps
      // you. A mild high-tier damping keeps the top stars feeling weighty.
      const rate = (CBZ.CITY.heatDecay + (g.heat || 0) * 0.011) * (g.wanted >= 5 ? 0.7 : g.wanted >= 4 ? 0.85 : 1);
      g.heat = Math.max(0, g.heat - rate * dt);
      g.wanted = starsFromHeat(g.heat);
      if (g.heat <= 0) { g.cityMurders = 0; g.cityCopKills = 0; g.cityCrimeLabel = null; }   // cleared → fresh slate
    }
    // an active manhunt for an escaped convict never falls below 3★ on its own
    // (only CBZ.cityClearConvict lifts it). Re-assert AFTER any decay this frame.
    convictFloor();
    // V2 military jurisdiction AFTER the convict floor: inside the wire, the
    // 5★ sensor lock outranks the 3★ convict band. Also stamps the body class
    // css/campaign.css keys on to exempt the star meter from the campaign
    // declutter (flag off → class off → legacy hidden-HUD behavior returns).
    militaryZone(dt);
    if (_v2Body !== v2()) { _v2Body = v2(); try { document.body.classList.toggle("wanted-stars-v2", _v2Body); } catch (e) {} }
    g.cityCopTarget = COP_TARGET[Math.min(5, g.wanted | 0)];
    // BOUNTIES_V2 contract brain rides this same tick (no new update order)
    try { bountyTick(dt); } catch (e) {}
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  CBZ.cityCrime = crime;
  CBZ.cityBust = bust;
  CBZ.cityWantedReset = function () { g.heat = 0; g.wanted = 0; g.busted = false; busting = false; if (arrestScene && arrestScene.cop) arrestScene.cop._arrestingPlayer = false; arrestScene = null; if (CBZ.player) CBZ.player._cityArrested = false; if (CBZ.playerChar) { CBZ.playerChar.handsUp = false; CBZ.playerChar.cuffed = false; } lastCrimeT = 0; g.cityLastKnown = null; g.cityCopTarget = 0; g.cityMurders = 0; g.cityCopKills = 0; g.cityMasked = false; g.cityCrimeLabel = null; g.cityBounty = 0; g._copsFiredUponT = 0; g._copWoundT = 0; milLock = false; milWarnT = 0; _milTheftT = -1e9; _milHostileT = -1e9; _theftCtx = null; _theftCoolT = {}; if (contract) { clearOurBounty(contract); contract = null; } bountyBoard = []; bountyCooldown = 0; boardT = 0; };   // fired-upon stamps (police.js arrest-first) + V2 military lock/theft stamps + hitman contracts die with the run

  // ---- DEATH RESET (PROG owns): on player death, drop the player's STREET INFAMY
  // back toward Lv.1 so the level/title visibly falls and the player re-climbs.
  // We zero ONLY the infamy inputs that feed CBZ.cityPlayerLevel() (level.js):
  // kills, respect, the wanted heat/stars, the bounty, the crew + borrowed-colors
  // membership, and the holster flag. We NEVER touch owned assets (cash, house,
  // cars, guns, jewelry) — net worth still contributes to the level (that's earned
  // and stays). Safe to call repeatedly and only meaningful in city mode.
  // death.js's respawn() already calls cityWantedReset() (heat/stars/bounty); this
  // hook is additionally fired the instant you die (we wrap cityKillPlayer below),
  // and may also be called by any death-flow code directly.
  function infamyResetOnDeath() {
    if (g.mode !== "city") return;
    g.heat = 0; g.wanted = 0; g.cityCopTarget = 0;
    // GTA convention (CITY_WANTED_CLEARS_ON_DEATH): death closes the manhunt —
    // the escaped-convict floor dies with you too (a corpse is as caught as it
    // gets; without this, convictFloor() re-asserted 3★ the frame after the
    // heat wipe and the stars visibly SURVIVED the respawn). Arrest keeps its
    // own funnel (games/jail.js); this is the DEATH path only.
    if (CBZ.CONFIG.CITY_WANTED_CLEARS_ON_DEATH !== false && g.escapedConvict) {
      if (CBZ.cityClearConvict) CBZ.cityClearConvict(); else g.escapedConvict = false;
    }
    milLock = false; milWarnT = 0; _milTheftT = -1e9; _milHostileT = -1e9;   // the sensor lock dies with you (respawn is outside the wire)
    g.cityMurders = 0; g.cityCopKills = 0; g.cityCrimeLabel = null;
    g.cityBounty = 0;                       // the price on your head dies with you
    g.kills = 0;                            // body count infamy resets (assets untouched)
    g.respect = 0;                          // street respect resets
    g.cityCrew = 0;                         // your crew scatters when you go down
    g.cityMembership = null;                // borrowed gang colors lapse (a founded g.playerGang is an asset → kept)
    g.cityHolstered = false;               // back to default stance on respawn
    // a hitman's contract dies with the hitman (the target keeps walking)
    if (contract) { clearOurBounty(contract); dropContractWaypoint(); contract = null; bountyCooldown = 30; }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityInfamyResetOnDeath = infamyResetOnDeath;

  // self-wire the death moment: cityKillPlayer (death.js) is the single WASTED
  // trigger. It loads AFTER us, so wrap it lazily (the heists.js/aircraft.js
  // pattern). Firing the infamy reset AT death (not only at respawn) makes the
  // Lv/Title drop visible immediately on the WASTED screen. Idempotent flag guard
  // means a re-wrap (hot reload) can't double-chain.
  // returns true ONLY when wrapping is DONE (or already done) — so the retry loop
  // keeps polling until cityKillPlayer actually exists (it loads after us).
  function wrapKill() {
    if (typeof CBZ.cityKillPlayer !== "function") return false;   // not loaded yet → retry
    if (CBZ.cityKillPlayer._infamyWrapped) return true;            // already wrapped → stop
    const orig = CBZ.cityKillPlayer;
    const wrapped = function () { try { infamyResetOnDeath(); } catch (e) {} return orig.apply(this, arguments); };
    wrapped._infamyWrapped = true;
    CBZ.cityKillPlayer = wrapped;
    return true;
  }
  if (!wrapKill()) { const iv = setInterval(function () { if (wrapKill()) clearInterval(iv); }, 0); }
  function augment() { if (CBZ.city) { CBZ.city.crime = crime; CBZ.city.report = report; CBZ.city.addHeat = addHeat; CBZ.city.clearWanted = clearWanted; CBZ.city.stars = function () { return g.wanted | 0; }; } }
  if (CBZ.city) augment(); else { const iv = setInterval(function () { if (CBZ.city) { augment(); clearInterval(iv); } }, 0); }
})();
