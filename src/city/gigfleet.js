/* ============================================================
   city/gigfleet.js — THE COMPANY ↔ STREET GLUE for gig businesses.

   wealth.js owns the gig COMPANIES (RapidGig Courier 📦, Downtown Cab Co. 🚕,
   Harbor Freight 🚢) — the buyable fronts with the two-stream WORKERS + REP
   model and the passive faucet. This file is the thin GLUE that makes those
   companies VISIBLE and KEEPS THEM ALIVE on the street:

     • FLEET — for each gig company you own, spawn one livery car per HIRED
       DRIVER (wealth.js workerCount), so a 4-driver courier company puts 4
       branded cars rolling through traffic. The cars delegate to the NPC-driver
       system (giglife.js / CBZ.cityMakeCar + npcDriver) when present, else fall
       back to ordinary AI traffic cars wearing the company livery. Fleet size
       re-syncs whenever you hire (wealth.js calls CBZ.cityGigFleet.sync).

     • REP HOOK — when the PLAYER completes an active gig (CBZ.cityGig, built by a
       sibling agent), we bump the matching company's brand REP back up
       (wealth.js bizRep decays without engagement). This closes the WHY loop:
       a company is a passive front, but you must personally keep the brand alive
       or the faucet chokes. Feature-detected — works with or without cityGig.

     • SMUGGLE BUST RISK — the smuggle fleet carries real heat: an active smuggle
       gig that the player runs (or a driver caught while you're hot) can add
       wanted stars, mirroring wealth.js's lab/raid pressure. Fully gated so it
       never fires without the company owned + a real gig completion event.

   PRESERVES wealth.js's businesses/tick/persistence — this file never touches
   g.cash raw, never duplicates the faucet; it only spawns/cleans cars and routes
   rep bumps through CBZ.cityWealth.bumpRep + CBZ.city.addCash / cityHudDirty.

   Exposes: CBZ.cityGigFleet { sync, syncAll, count, status, collect,
   onGigComplete, companies, REP_PER_GIG }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function rng() { return (CBZ.cityEcon && CBZ.cityEcon.rng) ? CBZ.cityEcon.rng() : Math.random(); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function W() { return CBZ.cityWealth || null; }   // the gig surface (may load after us)

  // tuning ---------------------------------------------------------------------
  const REP_PER_GIG = 0.34;     // each completed player gig restores this much brand rep
  const SMUGGLE_HEAT = 2;       // stars a player smuggle run can draw if you're already hot
  const SPAWN_FAR = 70;         // don't pop fleet cars right on top of the player
  const RESYNC_EVERY = 6;       // seconds between idle fleet upkeep sweeps

  // per-company LIVERY (reuse the existing car-livery vocabulary in vehicles.js;
  // "taxi" is a real painted livery, the others fall back to a tinted body so a
  // fleet car still reads as branded even without a bespoke skin).
  const LIVERY = {
    delivery:  { name: "RapidGig Courier", color: 0xe8732a, body: "van",   livery: "delivery", designStyle: "van",   value: 16000, s: 1.05 },
    rideshare: { name: "Downtown Cab",     color: 0xf2c43d, body: "sedan", livery: "taxi",     designStyle: "cab",   value: 12000, s: 1.0 },
    smuggle:   { name: "Harbor Freight",   color: 0x2f4a5a, body: "van",   livery: "freight",  designStyle: "van",   value: 22000, s: 1.12 },
  };
  // map a gig company id → the cityGig job kind(s) that count toward its brand.
  // Tolerant: a sibling cityGig might report "uber"/"rideshare"/"fare" etc.
  const GIG_KIND = {
    delivery:  ["delivery", "courier", "parcel", "package", "deliver"],
    rideshare: ["rideshare", "taxi", "uber", "fare", "cab", "ride"],
    smuggle:   ["smuggle", "freight", "contraband", "run", "smuggling"],
  };
  const COMPANIES = ["delivery", "rideshare", "smuggle"];

  // live fleet handles, per company id → [carRefs]
  const fleet = {};
  for (const id of COMPANIES) fleet[id] = [];

  // ---- feature detection -----------------------------------------------------
  function gigSurface() { const w = W(); return w && w.isGig ? w : null; }
  function owns(id) { const w = W(); return !!(w && w.owns && w.owns(id)); }
  function workerCount(id) { const w = W(); return w && w.workerCount ? (w.workerCount(id) | 0) : 0; }
  function canSpawnCars() { return !!(CBZ.cityMakeCar && CBZ.city && CBZ.city.arena && g.mode === "city"); }
  // a sibling NPC-driver system (giglife.js) may expose a richer spawn that gives
  // the car a working gig-driver AI; prefer it when present.
  function npcDriverSpawn() {
    if (CBZ.cityGigDriver && CBZ.cityGigDriver.spawn) return CBZ.cityGigDriver.spawn;     // giglife.js preferred hook
    if (CBZ.cityMakeGigDriver) return CBZ.cityMakeGigDriver;
    return null;
  }

  // ---- spawn one livery car for a company, slotted into traffic --------------
  function pickRoadSeat() {
    const A = CBZ.city.arena, P = CBZ.player;
    if (!A || !A.roads || !A.roads.length || !P) return null;
    let r = null, x = 0, z = 0, along = 0, dirSign = 1, lane = 0, laneIdx = 0, heading = 0, tries = 0;
    do {
      r = A.roads[(rng() * A.roads.length) | 0];
      if (!r) return null;
      along = (rng() - 0.5) * (r.len || 40) * 0.8;
      dirSign = rng() < 0.5 ? 1 : -1;
      // ROAD-AWARE lane pick via CBZ.roadLanes: a fleet car on a 3+3 highway
      // targets the real lane count/centres (past the median), not the global-2
      // guess. Guard-called fallback keeps the old global math.
      if (CBZ.roadLaneCenter) {
        laneIdx = (rng() * CBZ.roadLanesPerDir(r)) | 0;
        lane = CBZ.roadLaneCenter(r, dirSign, laneIdx);
      } else {
        const traf = (CBZ.CITY && CBZ.CITY.traf) || {};
        const lpd = Math.max(1, (traf.lanesPerDir != null ? traf.lanesPerDir : 2) | 0);
        const lw = traf.laneW != null ? traf.laneW : 3.6;
        laneIdx = (rng() * lpd) | 0;
        lane = dirSign * lw * (laneIdx + 0.5);
      }
      x = r.vertical ? r.x + lane : r.x + along;
      z = r.vertical ? r.z + along : r.z + lane;
      heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      tries++;
    } while (tries < 10 && Math.hypot(x - P.pos.x, z - P.pos.z) < SPAWN_FAR);
    return { r, x, z, heading, lane, laneIdx, dirSign };
  }

  function spawnFleetCar(id) {
    if (!canSpawnCars()) return null;
    const model = LIVERY[id]; if (!model) return null;
    const seat = pickRoadSeat(); if (!seat) return null;

    // delegate to the NPC gig-driver system if it exists (it owns AI + livery)
    const spawn = npcDriverSpawn();
    let c = null;
    if (spawn) {
      try { c = spawn({ company: id, model, x: seat.x, z: seat.z, heading: seat.heading, vertical: seat.r.vertical, road: seat.r }); } catch (e) { c = null; }
    }
    // fallback: an ordinary AI traffic car wearing the livery, slotted exactly
    // like spawnCityTraffic / armored.js so the existing traffic AI drives it.
    if (!c) {
      c = CBZ.cityMakeCar(seat.x, seat.z, seat.heading, seat.r.vertical, model, 0.28);
      if (!c) return null;
      c.road = seat.r; c.lane = seat.lane; c.laneIdx = seat.laneIdx; c.dirSign = seat.dirSign;
      const cruise = (CBZ.CITY && CBZ.CITY.traf && CBZ.CITY.traf.cruise) || [7, 12];
      c.baseV = cruise[0] + rng() * (cruise[1] - cruise[0]);
      c.v = c.baseV * 0.6;
    }
    c.gigCompany = id;              // tag so we recognise + reap our own fleet
    c.gigFleet = true;
    fleet[id].push(c);
    return c;
  }

  // drop a fleet car cleanly from the car system + our handle list.
  function reapCar(id, c) {
    if (!c) return;
    try { if (c.group && c.group.parent) c.group.parent.remove(c.group); } catch (e) {}
    if (CBZ.cityCars) { const i = CBZ.cityCars.indexOf(c); if (i >= 0) CBZ.cityCars.splice(i, 1); }
    const arr = fleet[id]; const j = arr.indexOf(c); if (j >= 0) arr.splice(j, 1);
  }

  // prune dead/destroyed/orphaned handles so count() reflects reality.
  function prune(id) {
    const arr = fleet[id];
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i];
      const gone = !c || c.dead || c._reap || (CBZ.cityCars && CBZ.cityCars.indexOf(c) < 0);
      if (gone) arr.splice(i, 1);
    }
  }

  // ---- SYNC: reconcile live fleet-car count with hired-driver count ----------
  function sync(id) {
    if (!gigSurface() || !LIVERY[id]) return;
    prune(id);
    if (!owns(id)) {                 // not owned (sold/never bought) → no cars
      while (fleet[id].length) reapCar(id, fleet[id][fleet[id].length - 1]);
      return;
    }
    if (!canSpawnCars()) return;     // can't spawn right now; retry on the upkeep sweep
    const want = workerCount(id);
    // spawn up toward `want` (a few per sweep so a big hire doesn't pop in a burst)
    let made = 0;
    while (fleet[id].length < want && made < 2) { if (!spawnFleetCar(id)) break; made++; }
    // too many (driver fired / save loaded smaller) → reap the surplus
    while (fleet[id].length > want) reapCar(id, fleet[id][fleet[id].length - 1]);
  }
  function syncAll() { for (const id of COMPANIES) sync(id); }
  function count(id) { if (id) { prune(id); return fleet[id].length; } let n = 0; for (const k of COMPANIES) { prune(k); n += fleet[k].length; } return n; }

  // ---- REP HOOK: a completed player gig revives the matching company brand ---
  // `kind`  — the gig job kind reported by cityGig (string), or a company id.
  // `info`  — optional { pay, company, busted } so we can show a richer note.
  function classify(kind) {
    if (!kind) return null;
    const k = ("" + kind).toLowerCase();
    if (LIVERY[k]) return k;                       // already a company id
    for (const id of COMPANIES) { if ((GIG_KIND[id] || []).some((w) => k.indexOf(w) >= 0)) return id; }
    return null;
  }
  function onGigComplete(kind, info) {
    info = info || {};
    const id = classify(info.company || kind);
    if (!id) return;
    const w = gigSurface(); if (!w || !w.bumpRep) return;
    if (!owns(id)) return;                          // only YOUR company's brand benefits
    const amt = info.rep != null ? info.rep : REP_PER_GIG;
    const r = w.bumpRep(id, amt);
    const pct = Math.round((r == null ? 0 : r) * 100);
    big("" + (LIVERY[id].name) + " brand revived — " + pct + "%");
    note("Running " + (kind || "gigs") + " keeps your fleet's reputation (and passive rate) alive.", 2.6);
    // SMUGGLE BUST RISK: a smuggle run while you're hot draws extra heat, like the
    // lab/raid pressure in wealth.js. Only fires for the smuggle company.
    if (id === "smuggle" && (info.busted || (g.wanted | 0) >= 1 && rng() < 0.4)) {
      const stars = Math.min(5, (g.wanted | 0) + SMUGGLE_HEAT);
      if (CBZ.cityForceStars) CBZ.cityForceStars(stars); else g.wanted = stars;
      note("The freight run drew the law — heat up.", 2.4);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- COLLECT / STATUS passthroughs (convenience for HUD / phone / sibling) -
  // collect: defer to wealth.js's collectAll (THE faucet) — we never re-pay.
  function collect() { const w = W(); if (w && w.collectAll) w.collectAll(); }
  function status(id) {
    const w = gigSurface();
    if (id) {
      if (!w || !LIVERY[id]) return null;
      return { id, name: LIVERY[id].name, owned: owns(id), workers: workerCount(id), cars: count(id), rep: w.bizRep ? w.bizRep(id) : 1, rate: w.bizRate ? w.bizRate(id) : 0 };
    }
    return COMPANIES.map((c) => status(c)).filter(Boolean);
  }

  // ---- idle upkeep: keep fleet sized, retry spawns that couldn't fire yet ----
  let sweepT = 2;
  CBZ.onUpdate(41.5, function (dt) {          // just after wealth.js's faucet (41)
    if (g.mode !== "city") {
      // left the city → drop all live fleet cars so nothing leaks across modes
      for (const id of COMPANIES) while (fleet[id].length) reapCar(id, fleet[id][fleet[id].length - 1]);
      return;
    }
    if (!gigSurface()) return;                // wealth.js not ready yet
    sweepT -= dt;
    if (sweepT > 0) return;
    sweepT = RESYNC_EVERY;
    syncAll();
  });

  // listen for a sibling cityGig completion event if it dispatches one (loose
  // coupling: cityGig may instead call CBZ.cityGigFleet.onGigComplete directly).
  try {
    addEventListener("cbz-gig-complete", function (ev) {
      const d = (ev && ev.detail) || {};
      onGigComplete(d.kind || d.company, d);
    });
  } catch (e) {}

  // reset on new-game / mode reset (mirrors cityWealthReset's intent).
  const prevReset = CBZ.cityWealthReset;
  CBZ.cityWealthReset = function () {
    if (prevReset) try { prevReset(); } catch (e) {}
    for (const id of COMPANIES) while (fleet[id].length) reapCar(id, fleet[id][fleet[id].length - 1]);
  };

  // ---- public surface --------------------------------------------------------
  CBZ.cityGigFleet = {
    sync, syncAll, count, status, collect, onGigComplete,
    companies: COMPANIES.slice(), LIVERY, GIG_KIND, REP_PER_GIG,
  };
})();
