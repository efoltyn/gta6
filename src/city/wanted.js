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

  // cop response per star (read by police.js maintain() as g.cityCopTarget).
  // Steeper at the top: the now-RARE 5★ floods the streets with heavy units so it
  // FEELS overwhelming — a brutal crescendo to match the much harder wanted climb.
  const COP_TARGET = [0, 2, 4, 8, 12, 20];
  let lastCrimeT = 0, busting = false;
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
    "kidnapping":        { stars: 3, label: "Kidnapping" },
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
    return { stars: 0, label: "Disturbance" };   // unknown type fallback — NOT a chargeable crime
  }

  // the ONLY thing that raises your stars: a crime gets REPORTED (a witness calls
  // it in, or a cop sees it). If you're MASKED, nobody can ID you → no stars.
  function report(sev, opts) {
    opts = opts || {};
    if (g.cityMasked) return;                        // shiesty/bandana on → unidentified
    // (CUT: "🎭 A masked suspect was reported — not ID'd as you." — you can't
    // hear a stranger's phone call. The mask's [T] toggle line already taught
    // the mechanic; the stars not climbing IS the feedback.)
    const T = CBZ.CITY.starHeat;
    const info = crimeInfo(opts.type, sev);
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
    const charge = Math.max(1, sev || 1) * K * (sameEvent ? 0.25 : 1);
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
    g.cityCopTarget = COP_TARGET[Math.min(5, g.wanted | 0)];
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  });

  CBZ.cityCrime = crime;
  CBZ.cityBust = bust;
  CBZ.cityWantedReset = function () { g.heat = 0; g.wanted = 0; g.busted = false; busting = false; lastCrimeT = 0; g.cityLastKnown = null; g.cityCopTarget = 0; g.cityMurders = 0; g.cityCopKills = 0; g.cityMasked = false; g.cityCrimeLabel = null; g.cityBounty = 0; };

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
    g.cityMurders = 0; g.cityCopKills = 0; g.cityCrimeLabel = null;
    g.cityBounty = 0;                       // the price on your head dies with you
    g.kills = 0;                            // body count infamy resets (assets untouched)
    g.respect = 0;                          // street respect resets
    g.cityCrew = 0;                         // your crew scatters when you go down
    g.cityMembership = null;                // borrowed gang colors lapse (a founded g.playerGang is an asset → kept)
    g.cityHolstered = false;               // back to default stance on respawn
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
