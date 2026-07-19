/* ============================================================
   city/racing.js — THE RACING SERIES: a real championship the
   speedway actually runs, with famous racers who walk the streets.

   WHY: the speedway island (island_speedway.js) lets you run laps for
   a purse, but a race with no SERIES is just a time-trial — there's no
   field of names, no standings, no rivalry, nothing on the rich list
   that says "this person got rich DRIVING." A championship gives the
   track stakes (you're not beating ghosts, you're beating ranked
   drivers), gives the rich list new blood (a season's purse-winnings
   put racers on the leaderboard), and — because every name is a real
   walkable, killable, robbable NPC strolling the concourse and uptown
   — gives the player someone to actually meet, size up, or take out.

   This file owns ONE source of truth, CBZ.cityRacing:
     • a fixed fictional ROSTER (~12 drivers) with unique numbers,
       team colours (livery), skill, a fast home car, and net worth.
     • championship STANDINGS (F1/NASCAR descending points) that
       island_speedway feeds (awardRace) and leaderboard reads.
     • cityRacing.liveryFor(racer) — the ONE descriptor the livery
       layer (race_livery.js) + the AI field both read, so an
       opponent's number on track matches the name on the board.
     • a per-frame maintainer (order 35.85, right after millionaires)
       that keeps a few named racers walking near the speedway + the
       rich blocks, DRAFTING far civilians (the millionaires pattern)
       so headcount stays flat and nobody morphs in view.

   DRAW-CALL / PERF: zero new geometry of its own — racers are drafted
   existing ped rigs (or capped fresh ones), tagged + re-skinned via
   the same paintFit/stampTag patterns millionaires uses. Deterministic
   LCG, no Math.random.

   Headless-safe: CBZ guard; every cross-module call feature-detected.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const hyp = Math.hypot;

  // ---- deterministic LCG (owner rule: no Math.random) ----------------------
  let _s = 73019;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const ri = (a, b) => a + ((rng() * (b - a + 1)) | 0);
  const pick = (arr) => arr[(rng() * arr.length) | 0];

  // ---- speedway anchor (mirrors island_speedway.js CX/CZ/R) ----------------
  // kept in sync by value; the per-frame maintainer also tries the live region
  // registry first so a moved island still anchors correctly.
  const SPEED = { cx: 470, cz: -330, r: 200 };

  // ============================================================
  //  POINTS — F1/NASCAR-style descending table by finishing order.
  //  Index 0 = winner. Past the table, everyone who finished scores 1.
  // ============================================================
  const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  function pointsForPlace(place /*1-based*/) {
    const idx = (place | 0) - 1;
    if (idx < 0) return 0;
    return idx < POINTS.length ? POINTS[idx] : 1;
  }

  // ============================================================
  //  THE ROSTER — ~12 fictional drivers. number is UNIQUE (assigned
  //  sequentially at build so no two clash). teamColor = livery base,
  //  accent = stripe/number-glow. homeStyle is a FAST detailStyle the
  //  AI field builds the car from. skill 0..1 drives rubber-banding.
  // ============================================================
  const ROSTER_DEF = [
    { name: "Dario Voss",     team: 0xc0392b, accent: 0xf2b133, skill: 0.97, homeStyle: "aventador", purse: 9.0 },
    { name: "Kai Mercer",     team: 0x1b6ec8, accent: 0xeef2f6, skill: 0.94, homeStyle: "ferrari",   purse: 8.2 },
    { name: "Lena Royce",     team: 0x6a2bd6, accent: 0x2ec4d6, skill: 0.92, homeStyle: "porsche",   purse: 7.6 },
    { name: "Tomas Reyes",    team: 0x2ba24a, accent: 0xf2e23a, skill: 0.90, homeStyle: "enzo",      purse: 7.0 },
    { name: "Nico Bishop",    team: 0xd66a2e, accent: 0x101317, skill: 0.88, homeStyle: "muscle",    purse: 6.4 },
    { name: "Aria Stone",     team: 0x14171f, accent: 0xc0392b, skill: 0.86, homeStyle: "veyron",    purse: 5.9 },
    { name: "Marco Valent",   team: 0x2e6e8a, accent: 0xbfe6f2, skill: 0.83, homeStyle: "porsche",   purse: 5.3 },
    { name: "Sasha Kerr",     team: 0xeef2f6, accent: 0x14171f, skill: 0.81, homeStyle: "aventador", purse: 4.8 },
    { name: "Bruno Cole",     team: 0xb03050, accent: 0xf2e23a, skill: 0.78, homeStyle: "muscle",    purse: 4.2 },
    { name: "Yuki Tanaka",    team: 0x1f8a70, accent: 0xeef2f6, skill: 0.76, homeStyle: "ferrari",   purse: 3.7 },
    { name: "Ravi Anand",     team: 0xe0a92e, accent: 0x14171f, skill: 0.73, homeStyle: "enzo",      purse: 3.2 },
    { name: "Erik Holt",      team: 0x4053b8, accent: 0xf2b133, skill: 0.70, homeStyle: "muscle",    purse: 2.7 },
  ];

  // ---- ROOKIE pool — when a racer dies permanently (city/identity.js), the
  // field still needs to hold TARGET field-size for island_speedway's grid, so
  // a fresh zero-stat rookie is built from this pool via makeRacerFromDef (the
  // SAME constructor the launch roster uses). Styles/colors mirror ROSTER_DEF's
  // range so a rookie's car/jacket never looks out of place on the grid.
  const ROOKIE_FIRST = ["Jonas", "Theo", "Mika", "Pia", "Iris", "Dex", "Nadia", "Owen", "Soraya", "Lukas", "Wren", "Ezra", "Talia", "Cole", "Ines"];
  const ROOKIE_LAST = ["Faraday", "Lindqvist", "Okafor", "Brandt", "Salinas", "Hartley", "Moreau", "Asher", "Kowalski", "Pemberton", "Castel", "Drummond"];
  const ROOKIE_STYLES = ["aventador", "ferrari", "porsche", "enzo", "muscle", "veyron"];
  const ROOKIE_TEAMS = [
    { team: 0x8a2be2, accent: 0xeef2f6 }, { team: 0x2e8a5e, accent: 0xf2e23a },
    { team: 0xc77b1f, accent: 0x14171f }, { team: 0x3a3f8a, accent: 0xbfe6f2 },
    { team: 0x7a1f3d, accent: 0xf2b133 }, { team: 0x1f7a7a, accent: 0xeef2f6 },
  ];
  function makeRookieDef() {
    const tc = pick(ROOKIE_TEAMS);
    return {
      name: pick(ROOKIE_FIRST) + " " + pick(ROOKIE_LAST),
      team: tc.team, accent: tc.accent,
      // a rookie is competitive-but-unproven: lower band than the established
      // aces, with a little spread so the field doesn't clone one skill value.
      skill: 0.62 + rng() * 0.12,
      homeStyle: pick(ROOKIE_STYLES),
      purse: 1.2 + rng() * 0.8,   // modest seed net worth — they haven't earned yet
    };
  }

  // single-driver constructor — buildRoster() below and the rookie-promotion
  // path (see promoteRookie near the death-permanence block) both funnel
  // through this ONE place so a freshly-minted driver always has the exact
  // same shape as a launch-roster one (no second copy of the field list to drift).
  function makeRacerFromDef(d, number) {
    return {
      name: d.name, number: number,
      teamColor: d.team, accent: d.accent, skill: d.skill,
      homeStyle: d.homeStyle,
      // championship stats
      points: 0, wins: 0, podiums: 0, raced: 0,
      // purse seed scales their derived net worth (so they read rich)
      purseSeed: d.purse,
      // permanence (city/identity.js, feature-detected): retired === a dead
      // driver kept for history/Hall-of-Fame but pulled from active racing.
      retired: false,
      _identityId: null,
    };
  }

  function buildRoster() {
    const racers = [];
    let nextNum = 1;
    for (let i = 0; i < ROSTER_DEF.length; i++) {
      const number = nextNum++;            // SEQUENTIAL → guaranteed unique 1..N
      racers.push(makeRacerFromDef(ROSTER_DEF[i], number));
    }
    return racers;
  }

  // ============================================================
  //  CBZ.cityRacing — the single source of truth (read by livery,
  //  the AI field, and the leaderboard). Persist nothing else global.
  // ============================================================
  const cityRacing = {
    racers: buildRoster(),
    season: 1, round: 0, ROUNDS: 8,

    // award a race result. resultsArray = finishing order, each entry may be a
    // racer object (our roster) or {racer} / {name} — we match to the roster and
    // apply descending points + bump wins/podiums. The PLAYER (no .racer/.number
    // matching the roster) is simply skipped for points but doesn't shift others.
    awardRace: function (resultsArray) {
      if (!resultsArray || !resultsArray.length) return;
      let place = 0;
      for (let i = 0; i < resultsArray.length; i++) {
        const r = resultsArray[i];
        place++;
        const racer = (r && r.number != null && r.points != null) ? r
          : (r && r.racer) ? r.racer : null;
        if (!racer || racer.points == null) continue;   // player / unknown → no points, keeps place order
        racer.points += pointsForPlace(place);
        racer.raced += 1;
        if (place === 1) racer.wins += 1;
        if (place <= 3) racer.podiums += 1;
      }
    },

    // the championship table: ACTIVE roster (retired/deceased excluded — a
    // permanently-dead driver doesn't race, doesn't show on the live board, and
    // can't be re-cast onto a body) sorted by points desc (ties → more wins,
    // then lower number). Cheap — called by HUD/leaderboard render + the
    // island_speedway AI field builder.
    standings: function () {
      const a = cityRacing.racers.filter(function (r) { return !r.retired; });
      a.sort(function (x, y) {
        if (y.points !== x.points) return y.points - x.points;
        if (y.wins !== x.wins) return y.wins - x.wins;
        return x.number - y.number;
      });
      return a;
    },

    // retired/deceased drivers — kept for a Hall-of-Fame / "Living Rich List"
    // deceased row (leaderboard.js owns the actual rendering; this is just the
    // read-only data source). Sorted most-recently-retired first when history
    // entries are present (city/identity.js stamps killedAt on the linked
    // identity record, which is the real source of truth for the timestamp).
    deceased: function () {
      return cityRacing.racers.filter(function (r) { return !!r.retired; });
    },

    // a racer's STANDING (1-based position in the table) — used for tags/why.
    positionOf: function (racer) {
      const s = cityRacing.standings();
      const idx = s.indexOf(racer);
      return idx < 0 ? s.length : idx + 1;
    },

    // derived PURSE-WINNINGS net worth so a racer climbs the rich list across a
    // season: a base built from their purse seed + a bonus per championship point
    // and a fat bonus per win, optionally scaled by the economy's money so they
    // stay relevant against player inflation. Pure derivation, no stored cash.
    netWorthOf: function (racer) {
      if (!racer) return 0;
      const scale = (CBZ.cityEcon && CBZ.cityEcon.netWorth)
        ? Math.max(1, Math.min(40, (CBZ.cityEcon.netWorth() | 0) / 2500000)) : 1;
      const base = (racer.purseSeed || 3) * 1000000;     // $3M..$9M seed
      const fromPoints = (racer.points || 0) * 120000;   // each point ~ $120k of prize money
      const fromWins = (racer.wins || 0) * 750000;        // a win is a big cheque
      return Math.round((base + fromPoints + fromWins) * scale);
    },

    // advance the calendar one round; wrap the season at ROUNDS.
    bumpRound: function () {
      cityRacing.round += 1;
      if (cityRacing.round >= cityRacing.ROUNDS) {
        cityRacing.round = 0;
        cityRacing.season += 1;
      }
      return cityRacing.round;
    },

    // the ONE livery descriptor the livery layer + AI field both read, so the
    // number on an opponent's car matches its name on the board.
    liveryFor: function (racer) {
      if (!racer) return null;
      return { number: racer.number, scheme: null, base: racer.teamColor, accent: racer.accent };
    },
  };
  CBZ.cityRacing = cityRacing;

  // ============================================================
  //  PERMANENCE — racing.js's wiring into city/identity.js (this wave's new
  //  registry, feature-detected since cross-file load order isn't guaranteed).
  //  Fixes the racing-permanence bug: a killed racer used to just vanish from
  //  R.list (the walking-NPC pool) while the ROSTER ENTRY lived forever, so
  //  nextUnclaimedRacer() kept re-picking the "dead" racer and castRacer()
  //  re-cast it onto a brand-new random body next spawn — an unkillable
  //  immortal driver. Now: death is recorded on the ROSTER entry itself
  //  (retired=true, pulled from standings()/nextUnclaimedRacer()'s pool,
  //  but kept in cityRacing.racers for history) and a fresh zero-stat rookie
  //  is promoted to backfill the field — mirrors gangs.js's succeedBoss()
  //  heir-promotion beat, just rank-less (no bench here, only a clean slate).
  // ============================================================
  function nextRacerNumber() {
    let max = 0;
    for (let i = 0; i < cityRacing.racers.length; i++) {
      const n = cityRacing.racers[i].number | 0;
      if (n > max) max = n;
    }
    return max + 1;
  }

  // promote a fresh rookie into the field so headcount stays constant after a
  // permanent death. Reuses makeRacerFromDef (the SAME constructor buildRoster
  // uses) — no second copy of the racer-shape. Returns the new racer object.
  function promoteRookie() {
    const def = makeRookieDef();
    const racer = makeRacerFromDef(def, nextRacerNumber());
    cityRacing.racers.push(racer);
    return racer;
  }

  // death callback for kind 'racer' — fired by city/identity.js's markDead(),
  // which is in turn called by peds.js's cityKillPed hook (a separate task in
  // this wave) reading the _identityId we stamp in castRacer() below.
  if (CBZ.cityIdentities && CBZ.cityIdentities.onDeathRegister) {
    CBZ.cityIdentities.onDeathRegister("racer", function (rec) {
      // find the roster entry this identity belongs to (stamped at cast time).
      let racer = null;
      for (let i = 0; i < cityRacing.racers.length; i++) {
        if (cityRacing.racers[i]._identityId === rec.id) { racer = cityRacing.racers[i]; break; }
      }
      if (!racer || racer.retired) return;     // unknown id, or already processed (idempotent)
      racer.retired = true;
      const rookie = promoteRookie();
      if (CBZ.cityIdentities.setSuccessor) CBZ.cityIdentities.setSuccessor(rec.id, rookie._identityId);
      const msg = "🏁 Racer #" + racer.number + " (" + racer.name + ") has died — rookie #" + rookie.number + " (" + rookie.name + ") enters the field.";
      if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(msg); } catch (e) { /* */ } }
      else note(msg, 4.0);
    });
  }

  // ============================================================
  //  WALKABLE RACER NPCs — keep ~3-5 named drivers strolling the
  //  speedway concourse + uptown. COPIES the millionaires.js pattern:
  //  draft a far civilian (or cap-limited fresh body), cast it as a
  //  racer, tag it, paint a team jacket, register interactions; release
  //  when it wanders far. All off-screen-gated so nothing morphs in view.
  // ============================================================
  const TARGET_RACERS = 4;       // how many named racers to keep walking
  const MAX_FRESH = 4;           // hard cap on bodies WE create (vs. draft)
  const FAR2 = 150 * 150;        // beyond this → recycle
  const OFFSCREEN2 = 80 * 80;    // never morph / spawn / despawn in view
  const SUITS = [0x1a2230, 0x222a36, 0x14181f, 0x2a2230];

  const R = {
    inited: false, list: [], fresh: 0,
    spawnCD: 2.0, scanCD: 0, claimed: new Set(),
  };
  CBZ.cityRacers = function () { return cityRacing.standings(); };   // roster for the rich list (contract name)

  function arena() { return CBZ.city && CBZ.city.arena; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function camD2(x, z) {
    const c = CBZ.camera; if (!c) return 1e9;
    const dx = x - c.position.x, dz = z - c.position.z;
    return dx * dx + dz * dz;
  }

  // live speedway anchor: prefer the registered region bounds, else the constant.
  function speedAnchor() {
    return { x: SPEED.cx, z: SPEED.cz, r: SPEED.r };
  }
  // a point on the speedway concourse (outer ring, off the racing surface) OR a
  // rich uptown sidewalk — chosen off-screen so a fresh racer never pops in view.
  function racerPoint(A) {
    const a = speedAnchor();
    // 60% of the time aim for the speedway concourse, else the rich blocks.
    if (rng() < 0.6) {
      for (let t = 0; t < 10; t++) {
        const ang = rng() * Math.PI * 2, rr = a.r * 0.82 + rng() * (a.r * 0.12);
        const x = a.x + Math.cos(ang) * rr, z = a.z + Math.sin(ang) * rr;
        if (camD2(x, z) > OFFSCREEN2) return { x: x, z: z, face: rng() * Math.PI * 2 };
      }
    }
    // uptown fallback (reuse the arena's weighted sidewalk if available)
    for (let t = 0; t < 8; t++) {
      const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng)
        : (A.randomSidewalkPoint ? A.randomSidewalkPoint() : null);
      if (!p) break;
      const d = A.districtAt ? A.districtAt(p.x, p.z) : null;
      const rich = !d || d.kind === "core" || d.kind === "commercial" || (d.tier && d.tier >= 1.0);
      if (rich && camD2(p.x, p.z) > OFFSCREEN2) return { x: p.x, z: p.z, face: rng() * Math.PI * 2 };
    }
    return A.randomSidewalkPoint ? A.randomSidewalkPoint() : null;
  }

  // ---- drafting a far civilian (the millionaires guards, plus _milli/_racer so
  // we never double-claim a body another system already cast). ----
  function draftableCiv(p) {
    if (!p || p.dead || p.isPlayer || p.vendor || p.gang || p.kind !== "civilian") return false;
    if (p.controlled || p.companion || p.recruited || p.vagrant || p._crowd || p._parked || p.inCar || p.enterT > 0) return false;
    if (p.vip || p._vipGuard || p._vipStash || p._milli || p._milliGuard || p._racer) return false;
    if ((p.npcWanted | 0) || p.bounty || p.rage || p.surrender || p.reportState || p.approach || p.ko > 0) return false;
    if (p.isFamily || p.protectGang || p._clubLine || p.hostage || p.kidnapped) return false;
    if (camD2(p.pos.x, p.pos.z) < OFFSCREEN2) return false;
    return true;
  }
  function draftBody() {
    const peds = CBZ.cityPeds || [];
    let best = null, bw = -1;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!draftableCiv(p)) continue;
      const w = (p.wealth || 0) + rng() * 0.2;
      if (w > bw) { bw = w; best = p; }
    }
    return best;
  }

  // ---- FIT: paint the torso/legs into a team-colour racing jacket (the
  // millionaires paintFit pattern: isolate-then-tint, with a saved original). ----
  function paintFit(p, hex) {
    const ss = p.char && p.char.skinSlots; if (!ss || hex == null) return;
    const first = (arr) => (arr && arr[0] && arr[0].material && arr[0].material.color) ? arr[0].material.color.getHex() : null;
    if (!p._racerFit0) p._racerFit0 = { torso: first(ss.torso), collar: first(ss.collar), legs: first(ss.legs) };
    if (!p._racerFitIso) {
      const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
      iso(ss.torso); iso(ss.collar); iso(ss.legs); iso(ss.legsLower);
      p._racerFitIso = true;
    }
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    // jacket = team colour on the torso; legs a dark race trouser.
    const legHex = pick(SUITS);
    paint(ss.torso, hex); paint(ss.collar, hex); paint(ss.legs, legHex); paint(ss.legsLower, legHex);
  }
  function restoreFit(p) {
    const f = p._racerFit0; if (!f) return;
    const ss = p.char && p.char.skinSlots; if (!ss) { p._racerFit0 = null; return; }
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    paint(ss.torso, f.torso); paint(ss.collar, f.collar); paint(ss.legs, f.legs); paint(ss.legsLower, f.legs);
    p._racerFit0 = null;
  }

  // ---- the LEVEL/title tag: "Lv.N Racer #NN" reads over the head. Mirrors the
  // millionaires stampTag (keep level.js's _lvlShown/_lvlMat in sync so its sweep
  // doesn't fight us). ----
  function stampTag(p) {
    if (!p || !p.tag || p.dead || !CBZ.makeLabelSprite) return;
    const lv = CBZ.cityLevel ? CBZ.cityLevel(p) : 60;
    const racer = p._racer;
    const want = "Lv." + lv + " Racer #" + (racer ? racer.number : "?");
    if (p._racerTagText === want && p.tag.material === p._racerTagMat) {
      if (CBZ.cityLevel) p._lvlShown = CBZ.cityLevel(p);
      p._lvlMat = p.tag.material;
      return;
    }
    const s = CBZ.makeLabelSprite(want, { color: "#bfe6ff" });
    if (!s) return;
    p.tag.material = s.material;
    p._racerTagMat = s.material; p._racerTagText = want;
    if (CBZ.cityLevel) p._lvlShown = CBZ.cityLevel(p);
    p._lvlMat = p.tag.material;
  }

  // ---- cast a body as a racer NPC: well-off socialite, real loot, team fit ----
  function castRacer(p, racer) {
    p._racer = racer;
    p.archetype = "socialite"; p.job = "pro racer"; p.name = racer.name;
    p.wealth = 0.94; p.aggr = 0.3;                  // famous but not a brawler
    p.cash = ri(4000, 14000);
    p.valuables = ["Richard Mille", "Cash Stack"];  // a driver's watch + cash = loot
    p._drip = null; p._dripKey = null;
    p.baseSpeed = 1.7; p.snitch = 0.3;
    paintFit(p, racer.teamColor);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
    // PERMANENCE: mint (or reuse) a stable identity for this roster entry so a
    // death sticks city-wide. Feature-detected — no cityIdentities loaded (older
    // save / module missing) → falls back to today's exact behavior, no crash.
    if (CBZ.cityIdentities && CBZ.cityIdentities.register) {
      if (!racer._identityId) {
        const rec = CBZ.cityIdentities.register("racer", racer.name, { number: racer.number });
        racer._identityId = rec.id;
      }
      p._identityId = racer._identityId;   // peds.js cityKillPed hook reads this to call markDead
    }
  }
  function releaseRacer(rec) {
    const p = rec.ped;
    if (p && !p.dead) {
      p._racer = null; p._racerTagText = null; p._racerTagMat = null;
      restoreFit(p);
      p.archetype = "resident"; p.state = "walk"; p.path = null; p.pause = 0.4 + rng();
      p._lvlShown = -1; p._lvlMat = null; p._drip = null; p._dripKey = null;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
    }
    if (rec.racer) R.claimed.delete(rec.racer.number);
  }

  // pick the next roster racer to put on the street that ISN'T already walking.
  function nextUnclaimedRacer() {
    // prefer the TOP of the championship (the stars people want to see/take out)
    // — standings() already excludes retired/deceased racers, so a permanently
    // dead driver can never be re-picked here (the racing-permanence fix).
    const s = cityRacing.standings();
    for (let i = 0; i < s.length; i++) {
      if (!R.claimed.has(s[i].number)) return s[i];
    }
    return null;
  }

  function spawnRacer() {
    const A = arena(); if (!A || !A.root || !CBZ.cityPeds) return false;
    const racer = nextUnclaimedRacer(); if (!racer) return false;
    let p = draftBody();
    if (!p) {
      if (R.fresh >= MAX_FRESH || !CBZ.cityMakePed) return false;
      const sp = racerPoint(A);
      if (!sp || camD2(sp.x, sp.z) < OFFSCREEN2) return false;
      try {
        p = CBZ.cityMakePed(sp.x, sp.z, rng, { wealth: 0.92, archetype: "socialite" });
        if (!p) return false;
        A.root.add(p.group); CBZ.cityPeds.push(p); R.fresh++;
        if (sp.face != null && p.group) p.group.rotation.y = sp.face;
      } catch (e) { return false; }
    }
    castRacer(p, racer);
    R.claimed.add(racer.number);
    R.list.push({ ped: p, racer: racer });
    return true;
  }

  // ============================================================
  //  INTERACTIONS — size-up + challenge to a street race.
  // ============================================================
  function isRacer(p) { return !!(p && p._racer && !p.dead); }

  function registerInteractions() {
    const I = CBZ.interactions; if (!I || !I.register) return;
    // size-up: read their championship standing (no gun, harmless).
    I.register("ped:civ", {
      id: "racer-sizeup", slot: "e", prio: 3,
      canShow: (p) => isRacer(p),
      label: "Size up",
      onSelect: (p) => {
        const r = p._racer; if (!r) return;
        const pos = cityRacing.positionOf(r);
        note("🏁 " + r.name + " — P" + pos + " in the championship, " + r.wins + " wins (#" + r.number + ").", 3.0);
      },
    });
    // challenge to a street race → route to the speedway join flow if it exists,
    // else a quick verbal duel taunt (the speedway is where the real race lives).
    I.register("ped:civ", {
      id: "racer-challenge", slot: "f", prio: 4,
      canShow: (p) => isRacer(p),
      label: (p) => "Challenge " + (p._racer ? "#" + p._racer.number : "them") + " to a race",
      onSelect: (p) => {
        const r = p._racer; if (!r) return;
        const PA = CBZ.player;
        if (PA && PA.driving && CBZ.cityStartSpeedwayRace) {
          // they're at the wheel and the track flow is live → drop the green flag.
          note("🏁 " + r.name + " takes the challenge — to the line!", 2.4);
          try { CBZ.cityStartSpeedwayRace(); } catch (e) { /* */ }
        } else {
          note("🏁 \"" + r.name + ": Meet me at the speedway and we'll settle it.\"", 3.0);
        }
      },
    });
  }

  // ============================================================
  //  PER-FRAME — order 35.85 (just after millionaires.js at 35.8).
  // ============================================================
  CBZ.onUpdate(35.85, function (dt) {
    if (g.mode !== "city") return;
    const A = arena(); if (!A || !CBZ.cityPeds || !CBZ.cityPeds.length) return;
    if (CBZ.citySpawnDraining) return;     // wait until the roster is whole

    if (!R.inited) {
      R.inited = true;
      registerInteractions();
    }

    // 1) MAINTAIN the walking-racer population (drop far/dead, top up gradually).
    R.scanCD -= dt;
    if (R.scanCD <= 0) {
      R.scanCD = 0.5;
      for (let i = R.list.length - 1; i >= 0; i--) {
        const rec = R.list[i]; const p = rec.ped;
        const gone = !p || (CBZ.cityPeds.indexOf(p) < 0);
        const dead = p && p.dead;
        if (gone) { if (rec.racer) R.claimed.delete(rec.racer.number); R.list.splice(i, 1); continue; }
        if (dead) {
          // PERMANENCE SAFETY NET: peds.js's cityKillPed hook (a separate task
          // this wave) is the primary path to markDead via p._identityId, but
          // it may fire a frame late or — on a pre-existing save / partial load
          // — not be wired at all. Calling markDead here too is harmless: it's
          // idempotent (city/identity.js no-ops a second call) and guarantees
          // retired gets set the moment we observe the body is gone, so the
          // SAME racer is never silently recycled by nextUnclaimedRacer() one
          // walking-pool slot later. If cityIdentities isn't loaded at all,
          // this whole block is skipped and behavior matches the original
          // (unfixed) recycle path exactly — the documented regression-free
          // fallback for older saves / partial loads.
          if (rec.racer && CBZ.cityIdentities && CBZ.cityIdentities.markDead && rec.racer._identityId) {
            CBZ.cityIdentities.markDead(rec.racer._identityId);
          }
          if (rec.racer) R.claimed.delete(rec.racer.number);
          R.list.splice(i, 1);
          continue;
        }
        const far = camD2(p.pos.x, p.pos.z) > FAR2 && rng() < 0.25;
        if (far && camD2(p.pos.x, p.pos.z) > OFFSCREEN2) {
          releaseRacer(rec); R.list.splice(i, 1);
        }
      }
    }
    R.spawnCD -= dt;
    if (R.spawnCD <= 0) {
      R.spawnCD = 1.4 + rng();
      if (R.list.length < TARGET_RACERS) spawnRacer();
    }

    // 2) keep the tag fresh on any racer near the camera (cheap distance gate).
    for (let i = 0; i < R.list.length; i++) {
      const rec = R.list[i]; const p = rec.ped;
      if (!p || p.dead) continue;
      if (camD2(p.pos.x, p.pos.z) < 70 * 70) stampTag(p);
    }
  });
})();
