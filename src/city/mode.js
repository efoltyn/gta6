/* ============================================================
   city/mode.js — the CITY (GTA-style) game mode.

   Owns the shared CBZ.city namespace (money / respect / kills / the
   player-as-actor), chains CBZ.floorAt onto the flat city ground, runs
   stamina, and registers the mode descriptor (build / reset /
   objective). Sibling city/* modules augment CBZ.city with the wanted
   system, careers, shops, peds, cops, vehicles, death and HUD.

   It reuses the entire engine: the character rig, procedural animation,
   movement, vertical physics (enterable buildings), and the third-person
   camera — exactly like survival mode does.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // the player presented as a uniform "actor" so combat/peds treat it like an NPC
  const playerActor = {
    isPlayer: true,
    get pos() { return CBZ.player.pos; },
    get group() { return CBZ.playerChar.group; },
    get hp() { return CBZ.player.hp; },
    set hp(v) { CBZ.player.hp = v; },
    get dead() { return CBZ.player.dead; },
  };

  let baseFloor = null;     // the floorAt that existed before the city wrapped it

  // CONSERVATIVE urgency filter: a note that matches stays LOUD on the centre
  // flash; everything else routes to the quiet left feed. Tuned to keep genuine
  // danger/health/heat warnings prominent (car on fire, starving, wanted, a hit
  // squad, getting busted, an active deadline) while demoting ambient chatter.
  const NOTE_URGENT = /⚠|on fire|burning|starv|hungry|wanted|busted|jail|cops?|police|hit squad|drive-?by|hostile|warn|danger|surrender|bleeding|critical|dying|deadline|escape|robbed|alarm|shootout|ambush/i;

  // FOURTH-WALL FILTER (owner directive): no prose is allowed to hover in the
  // world. Ambient NARRATION toasts —
  // a stranger "saw that", "reported you", a "Traffic stop nearby", a rival gang
  // "moving into" a district, a soldier who "defected"/"seized control", a
  // bouncer barking at someone ELSE in the line, chapter-rank flavor — all break
  // immersion. Because EVERY origin file funnels through city.note(), we drop
  // these categories at this single chokepoint so no per-file edits are needed.
  // Tuned to suppress only AMBIENT narration: player-triggered feedback (Bought/
  // Sold/Equipped/Looted/Job accepted/heat/money) and URGENT danger still pass.
  // NOTE: this MUST run before the NOTE_URGENT test — "reported you" etc. embed
  // "police"/"cops", which NOTE_URGENT would otherwise promote to a centre flash.
  const NOTE_FOURTH_WALL = new RegExp([
    // --- witnesses / snitching (peds.js, jewelry.js) ---
    "saw that", "reported you", "pointed you out", "Reported:", "🗣️",
    "👀.*(saw|spun around|made)", "is a narc", "rival-affiliated",
    // --- traffic flavor (vehicles.js) ---
    "Traffic stop", "ticketed", "fleeing the police", "running from (the )?police",
    // --- gang movement / ambient gang life (turf.js, gangs.js) ---
    "is moving into", "defected", "seized (control of|a block|a turf)", "earned .*(pip|rank|stripe)",
    // --- buyers / dealing ambience that just narrates NPC intent (careers.js) ---
    "coming to score", "(buyer|buyers).*(coming|is coming|are coming)",
    "is a regular now", "Word on the street",
    // --- bouncer barks about OTHER guests in the line (club.js) ---
    "bouncer waves a sharp-dressed guest", "turned away at the rope",
    // --- shopkeeper / store ambience (citystaff.js, companies.js feed direct) ---
    "Line out the door",
  ].join("|"), "i");

  // CATEGORY throttle: ambient chatter (witnesses snitching, traffic stops,
  // service dispatch) embeds a UNIQUE ped name each time, so the exact-string
  // de-dup never catches the flood. Bucket each non-urgent note into a category
  // and rate-limit per bucket — flavor survives, the spam dies. cooldowns in ms.
  const NOTE_CAT_CD = { witness: 4500, traffic: 8000, dispatch: 6000, loot: 1500, _default: 1200 };

  // KEYBIND/CONTROL-LEGEND filter (PHONE_NOTIS_V2): "[E] Pay …", "[1-5] piece,
  // LMB place", "press [Z]" are interface mechanics — a real phone never pushes
  // them. They are dropped from the campaign handset at this chokepoint (the
  // interact/hint surfaces own that job).
  const NOTE_KEYBIND = /\[[A-Za-z0-9/\- ]{1,7}\]|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b|\b(?:press|click|tap|hold)\s+(?:(?:the|a)\s+)?(?:[A-Z0-9]|key|button|screen|mouse|trigger)\b/i;

  // A phone is not a replacement for every old toast. Only information that a
  // real contact, bank, dispatcher or newsroom would actually send belongs in
  // it. Moment-to-moment mechanics stay visual/audible (the pickup sound, the
  // weapon in-hand, a guard animation, the cash counter changing) instead of
  // becoming a backlog of "Picked up", "Blocked" and "Equipped" messages.
  const NOTE_PHONE_IMPORTANT = new RegExp([
    // money that affects an account/obligation, not every loose-cash pickup
    "bank", "deposit", "withdr(?:aw|ew)", "account", "loan", "mortgage",
    "payment", "payout", "payroll", "refund", "transfer", "wired",
    "foreclos", "rent due", "tax bill", "insurance",
    // assignments and direct threats
    "contract (?:accepted|complete|completed|failed|blown|paid)",
    "assignment", "dispatch", "bounty", "hit squad", "ambush",
    // public-safety/city news
    "wanted", "police", "swat", "airstrike", "lockdown", "raid",
    "gang war", "civil war", "coup", "reconquest", "partition",
    "warlord", "earthquake", "storm warning", "terror", "shootout",
    // durable world-state changes
    "property", "deed", "home (?:bought|sold|lost)", "business (?:bought|sold)",
  ].join("|"), "i");
  const NOTE_PHONE_MECHANICAL = /\b(?:picked up|recovered|looted|equipped|blocked|winded|guard (?:broken|recovered)|armor gone|wide open|caught him|finished|executed|reloading|dry|combo|headshot|kill ?streak)\b/i;
  const NOTE_PHONE_META = /\b(?:NPC|HUD|UI|reticle|crosshair|respawn(?:ing)?|game over|tutorial|keybind|hotbar|controller|keyboard|mouse|frame ?rate|FPS|first[- ]person|third[- ]person)\b/i;

  function phoneWorthy(msg, opts, headline) {
    const s = String(msg == null ? "" : msg).trim();
    if (!s || NOTE_KEYBIND.test(s) || NOTE_PHONE_META.test(s) || NOTE_FOURTH_WALL.test(s)) return false;
    opts = opts || null;
    // An explicitly named in-world source/app is an authored communication.
    // Generic compatibility labels are not real senders and get classified.
    const from = opts && opts.from != null ? String(opts.from).trim() : "";
    const realSender = from && !/^(?:status|alert|system|objective|messages?)$/i.test(from);
    if (realSender || (opts && opts.app && !/^(?:system|status)$/i.test(String(opts.app)))) return true;
    if (NOTE_PHONE_MECHANICAL.test(s)) return false;
    if (NOTE_PHONE_IMPORTANT.test(s)) return true;
    // big() is the authored headline channel. Keep genuine headlines, but not
    // combat-mechanic shouts that happened to use it historically.
    return !!headline;
  }
  CBZ.cityPhoneWorthy = phoneWorthy;
  function noteCategory(msg) {
    if (/saw that|reported you|Reported:|👀|🗣️/i.test(msg)) return "witness";
    if (/Traffic stop|🚓|🎫|ticketed|fleeing the police|🚨/i.test(msg)) return "traffic";
    if (/dispatched|🚒|🚑/i.test(msg)) return "dispatch";
    if (/Picked up|Looted|\+\$|cash/i.test(msg)) return "loot";
    return "_default";
  }

  function routeLegacyCityPhone(msg, opts, urgent) {
    if (typeof CBZ.cityPhoneNotify !== "function") return null;
    const s = String(msg || "");
    const supplied = opts || null;
    let app = supplied && supplied.app;
    let from = supplied && supplied.from;
    if (!app || !from) {
      if (/bank|deposit|withdr(?:aw|ew)|account|loan|mortgage|payment|payroll|transfer|wired|foreclos|insurance/i.test(s)) {
        app = app || "bank"; from = from || "Meridian Trust";
      } else if (/contract|assignment|dispatch|bounty|hit squad|ambush/i.test(s)) {
        app = app || "missions"; from = from || "Dispatch";
      } else if (/wanted|police|swat|manhunt|lockdown|raid|shootout/i.test(s)) {
        app = app || "news"; from = from || "Scanner";
      } else {
        app = app || "news"; from = from || "City Desk";
      }
    }
    return CBZ.cityPhoneNotify({ app: app, from: from, text: s, priority: urgent ? 2 : 0 });
  }

  const city = {
    built: false,
    arena: null,
    playerActor,
    stats: { topMoney: 0, topKills: 0 },

    floorAt(x, z) { return (g.mode === "city" && city.arena) ? city.arena.groundHeightAt(x, z) : 0; },

    // ---- money ----
    addCash(n) { g.cash = Math.max(0, (g.cash || 0) + n); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); return g.cash; },
    canAfford(n) { return (g.cash || 0) >= n; },
    spend(n) { if ((g.cash || 0) < n) return false; g.cash -= n; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); return true; },

    // ---- respect (street cred) ----
    addRespect(n) { g.respect = Math.max(0, (g.respect || 0) + n); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); },

    // ---- kills (leaderboard) ----
    // Respect is earned UP the ladder (sizeup.js): pass the victim and the
    // street pays out by THEIR level vs yours — dropping a boss makes a name,
    // stomping a level-1 nobody earns nothing. No victim → the old flat +2.
    addKill(victim) {
      g.kills = (g.kills || 0) + 1;
      const r = CBZ.cityKillRespect ? CBZ.cityKillRespect(victim) : 2;
      if (r > 0) city.addRespect(r); else if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },

    // Legacy callers still use note(), but city prose now has one destination:
    // an in-world sender/app on the phone. Sounds, animation and the minimal
    // numeric/icon HUD carry immediate mechanics; nothing writes a centre hint,
    // toast or left-side feed.
    note(msg, sec, opts) {
      if (!msg) return;
      const force = !!(opts && opts.urgent);
      if (!phoneWorthy(msg, opts, false)) return;
      if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) {
        // Campaign information belongs to the player's phone. The closed phone
        // only buzzes; prose never floats over the world.
        if (!CBZ.campaignUI || !CBZ.campaignUI.notify) return;
        if (CBZ.CONFIG && CBZ.CONFIG.PHONE_NOTIS_V2) {
          const s = String(msg);
          // The same 4th-wall drop the ambient path runs below — world
          // narration never reaches the handset either.
          if (NOTE_FOURTH_WALL.test(s) || NOTE_PHONE_META.test(s)) return;
          // Keybinding/control-legend prose ("[E] Pay …", "LMB place") is UI
          // mechanics, not something a person would text — never a phone push.
          if (NOTE_KEYBIND.test(s)) return;
          // Callers can name the in-world sender/app:
          //   city.note(msg, sec, { from: "Zillow", app: "messages" })
          // Unnamed notes are auto-classified (money → Bank, police →
          // Scanner, …) so no push ever reads as a game-system voice.
          if (opts && (opts.app || opts.from) && CBZ.phoneNotify) {
            CBZ.phoneNotify({ app: opts.app, from: opts.from, text: s, priority: force ? 2 : 0, meta: { source: "city.note" } });
          } else {
            CBZ.campaignUI.notify("auto", opts && opts.from, s, { source: "city.note", urgent: force });
          }
          return;
        }
        CBZ.campaignUI.notify("personal", "FIELD PHONE", String(msg));
        return;
      }
      // FOURTH-WALL DROP: neither the world nor the handset accepts these.
      if (NOTE_FOURTH_WALL.test(msg) || NOTE_PHONE_META.test(msg) || NOTE_KEYBIND.test(msg)) return;
      const now = (CBZ.now != null ? CBZ.now : performance.now());   // ms
      const urgent = force || NOTE_URGENT.test(msg);
      // ---- category throttle BEFORE the phone ----
      // Witness/traffic/dispatch chatter carries a unique ped name each time, so
      // the exact-string de-dup can't see the repeat. Gate by category cooldown
      // and, when we drop a flooded note, ask the feed to bump a "(xN)" counter
      // on the matching row instead of letting it stack new rows.
      const cat = noteCategory(msg);
      const cd = NOTE_CAT_CD[cat] || NOTE_CAT_CD._default;
      const catT = (city._catT || (city._catT = {}));
      if ((now - (catT[cat] || -9999)) < cd) return;
      catT[cat] = now;
      // de-dup fallback: drop an identical message seen within ~1.2s. Only the
      // _default bucket relies on this now; the others are already cooled above.
      if (cat === "_default" && msg === city._lastNote && (now - (city._lastNoteT || -9999)) < 1200) return;
      city._lastNote = msg; city._lastNoteT = now;
      routeLegacyCityPhone(msg, opts, urgent);
    },
    big(msg) {
      if (!phoneWorthy(msg, null, true)) return;
      const s = String(msg);
      const bankish = /[+\-]?\$\s?[\d,]|\bPAID\b|\bDEPOSIT|\bPAYOUT|\bLOAN\b|\bMORTGAGE\b/i.test(s);
      const scannerish = /wanted|police|swat|manhunt|busted|surrender|curfew|lockdown|airstrike/i.test(s);
      if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) {
        if (!CBZ.campaignUI || !CBZ.campaignUI.notify) return;
        if (CBZ.CONFIG && CBZ.CONFIG.PHONE_NOTIS_V2 && CBZ.phoneNotify) {
          // Headline channel → the phone's News app (City Desk), except money
          // headlines, which read as Bank pushes ("$X received"), and control
          // legends, which are UI mechanics and never a push at all.
          if (NOTE_KEYBIND.test(s)) return;
          // police-flavored headlines read from the Scanner app, not the paper
          CBZ.phoneNotify(bankish
            ? { app: "bank", text: s, meta: { source: "city.big" } }
            : { app: "news", from: scannerish ? "Scanner" : null, text: s, priority: 1, meta: { source: "city.big" } });
          return;
        }
        CBZ.campaignUI.notify("news", "CITY DESK", String(msg));
        return;
      }
      if (typeof CBZ.cityPhoneNotify === "function") {
        CBZ.cityPhoneNotify(bankish
          ? { app: "bank", from: "Liberty Bank", text: s }
          : { app: "news", from: scannerish ? "Scanner" : "City Desk", text: s });
      }
    },

    forEachActor(fn) {
      if (!CBZ.player.dead) fn(playerActor);
      const p = CBZ.cityPeds; for (let i = 0; i < p.length; i++) if (!p[i].dead) fn(p[i]);
      const c = CBZ.cityCops; for (let i = 0; i < c.length; i++) if (!c[i].dead) fn(c[i]);
    },
  };
  CBZ.city = city;

  function build() {
    if (city.built) return;
    const colStart = CBZ.colliders ? CBZ.colliders.length : 0;
    city.arena = CBZ.buildCity();
    // CITY COLLIDER STAMP: the airport rect (x -370..290, z -280..40) — and
    // potentially other city content — OVERLAPS the prison arena's coordinate
    // space around the origin. The meshes hide on mode switch but these AABBs
    // stayed live, so jail rooms had invisible force fields (parked airliners,
    // jet-bridge props) once the campaign started building the city before
    // prison. Stamp everything the city build registered; the shared collide
    // resolver skips stamped boxes outside city mode.
    if (CBZ.colliders) {
      for (let i = colStart; i < CBZ.colliders.length; i++) {
        const c = CBZ.colliders[i];
        if (c && typeof c === "object") c._city = true;
      }
    }
    baseFloor = CBZ.floorAt || null;
    // _city marks this wrapper so reset()'s reinstall check below never captures
    // it back into baseFloor. Without the marker, reset() set baseFloor to this
    // very function and every non-city floorAt call recursed to a stack overflow
    // (the prison leg after a city visit crashed the update loop every frame:
    // mouse-look still ran but WASD no longer moved the player).
    const cityFloor = function (x, z) { return g.mode === "city" ? city.arena.groundHeightAt(x, z) : (baseFloor && baseFloor !== cityFloor ? baseFloor(x, z) : 0); };
    cityFloor._city = true;
    CBZ.floorAt = cityFloor;
    city.built = true;
  }
  city.build = build;

  // ---- lighting override: re-aim the sun + shadow box onto the far-off city
  //      (daynight.js @2 and survival's override @93 both run first; we sit
  //      after them at @94 and take over whenever city mode is active). ----
  let cityShadow = false;
  // REAL NIGHTS (bug fix): this override used to pin the city sun to noon
  // (fixed 1.05 / 0.95 / 0xfff4e0) so the neon, lamps and camp fires shipped
  // but night never actually ARRIVED. Scale by CBZ.dayness (daynight.js @2)
  // instead — we still re-aim the sun onto the far-off city, but intensity
  // and colour now ride the same cycle as the sky. Fog COLOUR is left to
  // daynight (set @2, never touched here) so the horizon stays seamless.
  const _sunNight = new window.THREE.Color(0x6f86c0);   // daynight's night sun tone
  const _sunDay = new window.THREE.Color(0xfff4e0);     // daynight's day sun tone
  const _sunDusk = new window.THREE.Color(0xff8a3a);    // daynight's dusk push
  const _sunC = new window.THREE.Color();
  CBZ.onAlways(94, function () {
    if (g.mode !== "city") { cityShadow = false; return; }
    const A = city.arena; if (!A) return;
    // The life-game map now extends across a bridge onto a second island.
    // Follow the player so shadows stay useful in either district.
    const focus = CBZ.player && CBZ.player.pos ? CBZ.player.pos : A.center;
    const k = CBZ.dayness != null ? CBZ.dayness : 1;       // 0 night .. 1 noon
    const dusk = CBZ.duskness || 0;
    if (CBZ.sun) {
      CBZ.sun.position.set(focus.x + 70, 150, focus.z - 50);
      CBZ.sun.intensity = 0.16 + (1.05 - 0.16) * k;
      _sunC.copy(_sunNight).lerp(_sunDay, k);
      if (dusk > 0) _sunC.lerp(_sunDusk, dusk * 0.7);      // same warm push daynight gives
      CBZ.sun.color.copy(_sunC);
    }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(focus.x, 4, focus.z);
    if (CBZ.hemi) { CBZ.hemi.intensity = 0.38 + (0.95 - 0.38) * k; }
    // Fog is atmospheric depth over the REAL coast, terrain and buildings.
    // It no longer meets or hides a painted skyline ring. The range rides the
    // quality tier and farcull starts only after full fog dissolution.
    // Aircraft are explicitly an aerial sightseeing mode. Keeping the normal
    // street-level fog/cull envelope while the player is 70m up made whole
    // districts disappear outside a small bubble — the "Truman Show" effect
    // in the flight screenshot. Expand only while an aircraft owns the player;
    // ground play keeps the normal quality-tier budget.
    const airborne = !!(CBZ.player && CBZ.player._aircraft && CBZ.player.pos && CBZ.player.pos.y > 24);
    if (CBZ.scene.fog) {
      // A 1.8km fog wall is inside the authored Mercy range and painted dry
      // land into a uniform cyan sheet. Aircraft need continental visibility;
      // static detail still obeys farcull/LOD, so this mostly reveals the one
      // country mesh, one ocean mesh and the landmark terrain draws.
      const ff = airborne ? Math.max(CBZ.cityFogFar || 1000, 4200) : (CBZ.cityFogFar || 1000);
      CBZ.scene.fog.near = Math.max(90, Math.round(ff * 0.16)); CBZ.scene.fog.far = ff;
    }
    if (CBZ.camera) {
      const ff = airborne ? Math.max(CBZ.cityFogFar || 1000, 4200) : (CBZ.cityFogFar || 1000);
      // Distant landmarks may request projection room without widening city
      // fog or the full-detail cull bubble. Mount Mercy is a single terrain
      // draw; keeping it through the airfield view has negligible scene cost.
      const landmarkFar = CBZ.cityDistantLandmarkFar || 0;
      const wantFar = airborne ? Math.max(7000, ff + 900, landmarkFar) : Math.max(1400, ff + 180, landmarkFar);
      // A 0.1m near plane paired with a 2800m flight far plane throws away
      // most depth precision. At altitude the 0.42m land/sea separation then
      // quantises to the same value and water wins over valid ground. Nothing
      // in the chase camera lives within half a metre, so tighten the flight
      // frustum while retaining the close first-person near plane on foot.
      const wantNear = airborne ? 0.75 : 0.1;
      if (CBZ.camera.far !== wantFar || CBZ.camera.near !== wantNear) {
        CBZ.camera.near = wantNear;
        CBZ.camera.far = wantFar;
        CBZ.camera.updateProjectionMatrix();
      }
    }
    if (!cityShadow && CBZ.sun && CBZ.sun.shadow) {
      cityShadow = true;
      const sc = 190, cam = CBZ.sun.shadow.camera;
      cam.left = -sc; cam.right = sc; cam.top = sc; cam.bottom = -sc; cam.far = 500;
      if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
    }
  });

  // ---- stamina (SHIFT sprint, same as survival) ----
  CBZ.onUpdate(31, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player, S = CBZ.CITY;
    if (P.stamina === undefined) P.stamina = S.staminaMax;
    if (P.sprint) P.stamina = Math.max(0, P.stamina - S.staminaDrain * dt);
    else P.stamina = Math.min(S.staminaMax, P.stamina + S.staminaRegen * dt);
  });

  // ---- ROOFTOP SPAWN: you wake on a building roof, never the street. Broke
  //      (a fresh start) drops you on a low climbable roof; the more money
  //      you've got, the taller the tower you wake up on. Roofs are standable
  //      platforms (city/buildings.js), so we just place you on the slab. ----
  function pickSpawnRoof(cash) {
    // lots live on the ARENA (city.arena), not on this mode object — the old
    // `city.lots` was always undefined, so this returned null every run and the
    // rooftop spawn never happened (you always fell back to the street corner).
    const lots = city.arena && city.arena.lots;
    if (!lots) return null;
    const roofs = [];
    for (const lot of lots) {
      const b = lot.building;
      if (!b || !b.storeys || !b.hasStairs || lot.kind === "park") continue;
      // spawn on the CENTRE of the solid roof slab (b.roofCx/Cz), not the lot
      // centre — the lot centre sits over the open -x stairwell strip.
      roofs.push({ x: b.roofCx != null ? b.roofCx : lot.cx, z: b.roofCz != null ? b.roofCz : lot.cz, storeys: b.storeys, y: (b.h || b.storeys * 4) + 0.05, w: lot.w || 8 });
    }
    if (!roofs.length) return null;
    roofs.sort((a, b) => a.storeys - b.storeys);
    const motels = roofs.filter((r) => r.storeys <= 2);
    const wealth = Math.max(0, Math.min(1, (cash || 0) / 40000));   // ~$40k = top of the skyline
    const pick = (wealth < 0.06 && motels.length)
      ? motels[(Math.random() * motels.length) | 0]
      : roofs[Math.min(roofs.length - 1, Math.round(wealth * (roofs.length - 1)))];
    // pick.x/z is already the centre of the solid roof slab (clear of the -x
    // stairwell), so spawn dead-centre on the roof — no edge/corner offset
    return { x: pick.x, y: pick.y, z: pick.z };
  }

  // Resolve + place the configured city spawn only after buildCity has run:
  // island_airport.js owns the real geometry and publishes this safe anchor.
  // Keeping the config symbolic avoids duplicating airport coordinates here.
  function preferredAirportSpawn(A) {
    if (!CBZ.CITY || CBZ.CITY.playerSpawn !== "airport") return null;
    const s = A && A.airportSpawn;
    return s && Number.isFinite(s.x) && Number.isFinite(s.z) ? s : null;
  }
  function placePreferredCitySpawn(A, persistRespawn) {
    const s = preferredAirportSpawn(A), P = CBZ.player;
    if (!s || !P || !P.pos) return false;
    const y = Number.isFinite(s.y) ? s.y : (A && A.groundHeightAt ? A.groundHeightAt(s.x, s.z) : 0);
    P.pos.set(s.x, y, s.z); P.vy = 0; P.grounded = true;
    const ch = CBZ.playerChar && CBZ.playerChar.group;
    if (ch) {
      ch.position.copy(P.pos);
      if (Number.isFinite(s.yaw)) ch.rotation.y = s.yaw;
    }
    if (CBZ.cam && Number.isFinite(s.yaw)) CBZ.cam.yaw = s.yaw + Math.PI;
    // An owned home remains an intentional respawn choice. Without one, make
    // the airport the actual WASTED/respawn anchor as well as the entry point.
    if (persistRespawn && !g.cityHome) {
      g.citySpawnPoint = { x: s.x, z: s.z };
      if (g.cityWorld && typeof g.cityWorld === "object") {
        g.cityWorld.spawnPoint = { x: s.x, z: s.z };
        g.cityWorld.lastPos = { x: s.x, y: y, z: s.z };
      }
    }
    return true;
  }

  // Campaign observation gate. Geometry is always built, but the rooftop
  // prologue cannot observe street life hundreds of metres below it and lasts
  // only until the forced prison handoff. Keep the expensive live layers cold
  // for that beat. A future campaign director may replace this hook with a
  // finer per-scene policy; true means the named layer is currently observed.
  if (!CBZ.cityCampaignObservationGate) {
    CBZ.cityCampaignObservationGate = function () {
      if (!(CBZ.cityCampaignActive && CBZ.cityCampaignActive())) return true;
      const c = g.cityCampaign || g.cityCampaignPending;
      if (!c || !c.phase) return false;
      // campaign.js checkpoints the prison phase before wanted.js's bust overlay
      // finishes switching modes. Keep the street cold through that handoff too;
      // otherwise the full roster would hydrate for the overlay's final seconds
      // only to be torn down immediately on entering prison.
      return c.phase !== "prologue_drop" && c.phase.indexOf("prison_") !== 0;
    };
  }

  function campaignLayerObserved(layer) {
    if (!(CBZ.cityCampaignActive && CBZ.cityCampaignActive())) return true;
    if (!CBZ.cityCampaignObservationGate) return true;
    try { return CBZ.cityCampaignObservationGate(layer) !== false; }
    catch (e) { return true; }
  }

  // Peds and crowd own their own deferred rehydration loops. Traffic's public
  // surface is intentionally smaller, so mode.js keeps its one pending bit and
  // invokes the normal canonical spawner if a scene opens observation without
  // crossing a mode-reset boundary.
  let campaignTrafficDeferred = false;
  if (CBZ.onUpdate) CBZ.onUpdate(0.6, function () {
    if (!campaignTrafficDeferred || g.mode !== "city") return;
    if (!campaignLayerObserved("traffic")) return;
    if (CBZ.net && CBZ.net.noSim()) { campaignTrafficDeferred = false; return; }
    campaignTrafficDeferred = false;
    if (CBZ.spawnCityTraffic) CBZ.spawnCityTraffic((CBZ.CITY && CBZ.CITY.traffic) || 0);
  });

  CBZ.registerMode("city", {
    id: "city",
    label: "City",
    objective: "Make money any way you can — hustle, steal, deal, or go legit. Obey the lights or run them. Cops escalate to 5 stars; get cuffed and you're off to jail.",
    build,
    reset(game) {
      build();
      const A = city.arena;
      const campaignMode = !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
      // Collapse the city's thousands of static decoration boxes into a handful
      // of merged meshes. Runs ONCE (guarded per-root) — after buildCity built
      // the root but BEFORE spawnCityPeds/Traffic add dynamic rigs to it. The
      // load-time batch pass (core/batch.js) can't reach the city: it's built
      // lazily, long after the page-load event that triggers that pass.
      if (CBZ.batchStaticUnder) CBZ.batchStaticUnder(A.root);
      // Freeze matrix recompute for everything provably static under the root
      // (core/staticfreeze.js) — after the batch pass (its merged output is
      // already frozen), before actors spawn (they arrive with live matrices).
      if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(A.root);
      A.root.visible = true;
      if (A.reset) A.reset();
      if (CBZ.fx) CBZ.fx.clear();
      if (CBZ.clearGore) CBZ.clearGore();
      // re-install the floor wrapper in case survival rebuilt CBZ.floorAt after us
      if (!CBZ.floorAt || !CBZ.floorAt._city) {
        baseFloor = (CBZ.floorAt && CBZ.floorAt._city) ? baseFloor : CBZ.floorAt;
        const f = function (x, z) { return g.mode === "city" ? A.groundHeightAt(x, z) : (baseFloor && baseFloor !== f ? baseFloor(x, z) : 0); };
        f._city = true; CBZ.floorAt = f;
      }

      // fresh stats for this life
      game.cash = (CBZ.CITY.econ && CBZ.CITY.econ.startCash) || 0;
      game.wanted = 0; game.heat = 0; game.hunger = 100; game.tired = 0;
      game.respect = 0; game.kills = 0; game.busted = false; game.career = null;
      game.elapsed = 0; game.invuln = 0;
      game.cityInv = {}; game.cityMeleeWeapon = null; game.cityBank = 0;
      game.cityActivity = null;
      // start unarmed in the ONE engine gun system; fresh mags. Buying/looting a
      // gun unlocks it in fpsmode (systems/fpsmode.js), which drives city gunplay.
      if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
      // TEST LOADOUT: spawn with an RPG + a rifle + a sidearm so weapon switching
      // (number keys 1-9) and the rocket/helicopter systems are testable from the
      // first second. Toggle CBZ.CITY_TEST_LOADOUT=false to ship a clean start.
      if (!campaignMode && CBZ.CITY_TEST_LOADOUT !== false && CBZ.unlockWeapon) {
        CBZ.unlockWeapon("sidearm", { select: false });
        CBZ.unlockWeapon("carbine", { select: false });
        CBZ.unlockWeapon("bazooka", { select: true });
      } else if (campaignMode && CBZ.unlockWeapon) {
        // Story starts as a professional hit, not a weapon sandbox. One sidearm
        // is enough; later dossiers can grant mission-specific equipment.
        CBZ.unlockWeapon("sidearm", { select: true });
      }
      if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
      // top the test loadout's reserves right up (fpsResetWeapons set base mags)
      if (!campaignMode && CBZ.CITY_TEST_LOADOUT !== false && CBZ.fpsAddAmmo) {
        CBZ.fpsAddAmmo(20, "bazooka"); CBZ.fpsAddAmmo(300, "carbine"); CBZ.fpsAddAmmo(120, "sidearm");
      } else if (campaignMode && CBZ.fpsAddAmmo) {
        CBZ.fpsAddAmmo(48, "sidearm");
      }
      if (CBZ.cityWorldBeginRun) CBZ.cityWorldBeginRun(game);

      // THIRD-PERSON by default (the jail follow camera); [V] toggles FP. The
      // death replay flips to a 3rd-person orbit.
      CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
      CBZ.cityCam.fp = false; CBZ.cityCam.death = null;

      // clear any stale HQ / hit waypoint so it never bleeds into the new run
      // (defensive — cityGangsReset also clears it, but ownership/order may shift).
      if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) CBZ.fullMap.clearWaypoint("city");

      // reset the new sub-systems BEFORE repopulating
      if (CBZ.cityGangsReset) CBZ.cityGangsReset();
      if (CBZ.cityFamilyReset) CBZ.cityFamilyReset();   // households re-cast after peds spawn
      if (CBZ.cityFamilyTreeReset) CBZ.cityFamilyTreeReset(); // W6: fresh run starts with no kinship edges
      if (CBZ.polityReset) CBZ.polityReset(); // P1: fresh run rebuilds the jurisdiction roster + worldDay=0
      if (CBZ.relationsReset) CBZ.relationsReset(); // X6: fresh run reseeds the affinity matrix
      if (CBZ.cityBirthsReset) CBZ.cityBirthsReset();     // W11: fresh cadence timer for the birth tick
      if (CBZ.cityMarriageReset) CBZ.cityMarriageReset(); // W13: fresh run starts with zero marriage strain
      if (CBZ.citySocialReset) CBZ.citySocialReset();
      if (CBZ.cityResetOutfit) CBZ.cityResetOutfit();   // clear worn clothes (drip) on a new run
      game.cityDripRewarded = {};                        // re-earn drip respect on a fresh run
      if (CBZ.cityClubReset) CBZ.cityClubReset();        // tear down the velvet-club line/bouncer
      if (CBZ.cityRealEstateReset) CBZ.cityRealEstateReset();
      if (CBZ.cityZillowReset) CBZ.cityZillowReset();
      if (CBZ.cityAdBoardsReset) CBZ.cityAdBoardsReset();  // skyline starts neutral with the books
      if (CBZ.cityRoofLootReset) CBZ.cityRoofLootReset();  // roofs restock with the fresh run
      if (CBZ.cityVehiclesReset) CBZ.cityVehiclesReset();
      if (CBZ.cityGlassReset) CBZ.cityGlassReset();   // re-glaze every shattered window

      // spawn population (spawnCityPeds also spawns gangs + seeds families).
      // Multiplayer GUEST: the sim host owns peds/cops/traffic — we render its
      // snapshots as puppets (src/net/networld.js), so nothing spawns locally.
      const netGuest = CBZ.net && CBZ.net.noSim();
      const observePeds = campaignLayerObserved("peds");
      const observeCrowd = campaignLayerObserved("crowd");
      const observeTraffic = campaignLayerObserved("traffic");
      if (!netGuest && observePeds && CBZ.spawnCityPeds) CBZ.spawnCityPeds(CBZ.CITY.peds);
      else if (!netGuest && !observePeds) {
        // Cancels an in-flight sliced spawn as well as clearing a prior roster.
        // The peds module rehydrates automatically if observation opens without
        // a mode reset; the normal prison->city return also takes the full path.
        if (CBZ.cityDeferPedPopulation) CBZ.cityDeferPedPopulation();
        else if (CBZ.clearCityPeds) CBZ.clearCityPeds();
      }
      // the instanced ambient crowd is COSMETIC and stays local on guests too
      // (crowd.js skips promotion-to-real-peds when net.noSim())
      if (CBZ.spawnCityCrowd) CBZ.spawnCityCrowd(observeCrowd ? (CBZ.CITY.crowd != null ? CBZ.CITY.crowd : 280) : 0);
      if (CBZ.clearCityCops) CBZ.clearCityCops();
      if (!netGuest && CBZ.spawnCityTraffic) {
        campaignTrafficDeferred = !observeTraffic;
        CBZ.spawnCityTraffic(observeTraffic ? CBZ.CITY.traffic : 0);
      } else {
        campaignTrafficDeferred = false;
      }
      if (CBZ.cityWantedReset) CBZ.cityWantedReset();
      // ESCAPED CONVICT: you didn't get released — you BROKE OUT. The city should
      // not greet you clean. After cityWantedReset() zeroed the slate, stamp a
      // 3★ floor + matching heat so the manhunt is already on the instant you
      // hit the street (wanted.js holds it ≥3 while g.escapedConvict is set; cops
      // bias toward you). g.escapedFromJail marks THIS run as a jailbreak entry;
      // g.escapedConvict is NOT cleared here — wanted.js owns lifting it via
      // CBZ.cityClearConvict(). Guarded: only when the flag is set.
      if (game.escapedConvict) {
        game.escapedFromJail = true;
        const T = (CBZ.CITY && CBZ.CITY.starHeat) || [0, 300, 650, 1100, 3200, 12000];
        game.heat = Math.max(game.heat || 0, (T[3] || 1100) + 5);
        game.wanted = 3;                       // wanted.js holds this ≥3 while escapedConvict
        game.cityCrimeLabel = "Escaped Convict";
        // (g.cityCopTarget is recomputed each tick by wanted.js maintain() off g.wanted)
        // jail rep → city rep: carry the two jail gang standings onto two city
        // gangs so who you ran with inside still means something out here. Guarded:
        // CBZ.cityGangs is an ARRAY of live city gangs; skip if APIs/gangs absent.
        if (typeof CBZ.gangStanding === "function" && Array.isArray(CBZ.cityGangs) && CBZ.cityGangAddStanding) {
          const cityGangs = CBZ.cityGangs;
          for (let gi = 0; gi < 2 && gi < cityGangs.length; gi++) {
            const js = CBZ.gangStanding(gi) | 0;            // jail standing -100..100
            if (js && cityGangs[gi]) CBZ.cityGangAddStanding(cityGangs[gi].id, Math.max(-100, Math.min(100, js)));
          }
        }
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
      if (CBZ.cityClearAircraft) CBZ.cityClearAircraft();
      if (CBZ.cityClearPlayerAir) CBZ.cityClearPlayerAir();
      if (CBZ.cityCareersReset) CBZ.cityCareersReset();
      if (CBZ.cityEmpireReset) CBZ.cityEmpireReset();
      if (CBZ.cityLeaderboardReset) CBZ.cityLeaderboardReset();
      if (CBZ.cityPromotionReset) CBZ.cityPromotionReset();

      // place the player — on a rooftop (wealth-scaled), falling back to the
      // street spawn only if no buildings exist yet.
      // ESCAPED CONVICT (owner: "you should be at the jail door with a wanted
      // level, not just spawn into the world"): a jailbreak entry starts ON THE
      // STREET at the law's intake door — CBZ.cityPoliceStation() (the City
      // Hall/bank stand-in every custody flow already uses; there is no
      // dedicated jail building in city coordinates) — stepped a couple of
      // metres out the door along its outward normal. The 3★ manhunt was
      // already stamped above; cityAddStars is guard-called on top (a newer
      // wanted API may own the stamp — the inline heat floor stays the
      // fallback either way, so stars are ≥3 with or without it).
      const P = CBZ.player;
      const airportSpawn = preferredAirportSpawn(A);
      const jailbreakEntry = !!game.escapedConvict;
      let placedAtGate = false, gateX = 0, gateZ = 0;      // gate coords saved for the post-origin re-assert
      if (!airportSpawn && jailbreakEntry && CBZ.cityPoliceStation) {
        const st = CBZ.cityPoliceStation();
        const d = st && st.lot && st.lot.building && st.lot.building.door;
        if (st) {
          const nx = d && d.nx != null ? d.nx : 0, nz = d && d.nz != null ? d.nz : 1;
          const nl = Math.hypot(nx, nz) || 1;
          gateX = st.x + (nx / nl) * 2.4; gateZ = st.z + (nz / nl) * 2.4;
          P.pos.set(gateX, 0, gateZ);
          placedAtGate = true;
          if (CBZ.cityAddStars) { try { CBZ.cityAddStars(3, "jailbreak"); } catch (e) {} }
        }
      }
      if (!placedAtGate) {
        if (airportSpawn) P.pos.set(airportSpawn.x, airportSpawn.y || 0, airportSpawn.z);
        else {
          const roof = pickSpawnRoof(game.cash || 0);
          if (roof) P.pos.set(roof.x, roof.y, roof.z);
          else { const sp = A.spawn; P.pos.set(sp.x, 0, sp.z); }
        }
      }
      P.vy = 0; P.grounded = true; P.maxHp = 200; P.hp = 200; P._hurtT = 0; P.dead = false; P.ko = 0; P.stun = 0;
      P.driving = false; P._vehicle = null; P._death = null;
      P.captureState = "normal"; P.captureT = 0;
      P.stamina = CBZ.CITY.staminaMax; P.sprint = false; P.crouch = false;
      if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
      if (CBZ.playerChar.cuffed) CBZ.playerChar.cuffed = false;
      CBZ.playerChar.group.visible = true;
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
      CBZ.playerChar.group.scale.y = 1;
      // spawn pitch: near-level CITY_TP default, NOT a steep look-down — the
      // armed-3PS look target scales pitch by ~12m of aim lead, so 0.4 here
      // meant "stare at the ceiling" until the player dragged the mouse down.
      if (CBZ.cam) { CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI; CBZ.cam.pitch = CBZ.CITY_TP ? CBZ.CITY_TP.PITCH : 0.06; }
      if (CBZ.resetZoom) CBZ.resetZoom();
      if (CBZ.cityDeathReset) CBZ.cityDeathReset();
      // ORIGIN: grants + ledger selection land here. The legacy one-time scene
      // may temporarily reposition a fresh character, and a returning one may
      // restore lastPos; the explicit airport preference is reapplied below and
      // cancels only that origin staging. Campaign missions wrap reset later and
      // can still own authored positions. Without a configured preference, the
      // original intro/return behavior remains intact.
      const originResult = CBZ.cityOriginApply ? CBZ.cityOriginApply(game) : null;
      // JAILBREAK OVERRIDE-GUARD: cityOriginApply above RE-POSITIONS the player
      // and may rewind the manhunt from its persistent ledger. Re-assert the
      // wanted state after origin whether this build uses the legacy jail-door
      // spawn or the configured airport spawn.
      if (placedAtGate || (airportSpawn && jailbreakEntry)) {
        if (placedAtGate) P.pos.set(gateX, 0, gateZ);
        game.escapedConvict = true; game.escapedFromJail = true;
        const HT = (CBZ.CITY && CBZ.CITY.starHeat) || [0, 300, 650, 1100, 3200, 12000];
        game.heat = Math.max(game.heat || 0, (HT[3] || 1100) + 5);
        if ((game.wanted | 0) < 3) game.wanted = 3;
        game.cityCrimeLabel = "Escaped Convict";
        if (originResult) originResult.introActive = false;
        if (CBZ.cityAddStars) { try { CBZ.cityAddStars(3, "jailbreak"); } catch (e) {} }
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
      // Returning characters restore lastPos; a first character gets one-time
      // origin staging (exec crash, barfly toss, tenant flat). The airport
      // preference is the sandbox default for everyone ELSE — it must NOT
      // cancel a live origin intro (that used to wipe the exec laptop beat
      // and drop a suited millionaire at the runway with cash still intact).
      // Campaign missions wrap this reset later and remain free to own a
      // required set-piece position such as the prologue helipad.
      if (airportSpawn && !(originResult && originResult.introActive)) {
        placePreferredCitySpawn(A, true);
      }
      // CITY defaults to FIRST-PERSON (the jail's fpsmode); [V] toggles to 3rd-person.
      if (campaignMode) {
        // The campaign is authored and verified around the shoulder camera;
        // first-person remains an explicit [V] choice, never the story default.
        if (CBZ.setFPS) CBZ.setFPS(false);
      } else if (!(originResult && originResult.introActive)) {
        if (CBZ.setFPS) CBZ.setFPS(true);
      }
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
    winStats(game) {
      return [
        { label: "Cash", value: "$" + (game.cash || 0) },
        { label: "Kills", value: game.kills || 0 },
        { label: "Respect", value: game.respect || 0 },
      ];
    },
  });
})();
