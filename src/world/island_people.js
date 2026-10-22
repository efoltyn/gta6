/* ============================================================
   world/island_people.js — THE ISLANDS' PEOPLE ARE GANG CITY'S PEOPLE.

   Owner, 2026-10-22: people who react to the real situation. Gang City's
   street crowd (city/peds.js, one human one brain: CBZ.brain through
   city/brain_city.js, the demand ladder, voice, the I/J/K/L card, robbery,
   the hands, orders as their boss) now lives on the island in force. There
   is no second crowd: the disaster island's survivor bots stay the disaster
   game's, and the archipelago stands these instead (archipelago.js calls
   populate()).

   THE STREET THEY WALK  CBZ.islandPeople.arena() is the island town
       (world/island_town.js CBZ.islandTown.of) with the island's buildings
       as Gang-City lots: every building a door on its street (the inward
       normal the city's lots carry), homes (houses, villas, flats) and
       workplaces (the shops and trades, the bank, City Hall, the offices,
       the hotel and the motel), each with its district. city/peds.js's
       routine reads it exactly as it reads the city: people commute to their
       work in the morning, eat at lunch, go home at night (a closed shop is
       nobody's errand), and go in at the door where nobody sees them go.
   HOW MANY, WHERE  a phone-sized crowd round you, swelling by day and
       thinning at night (the archipelago runs the city's 48-minute day). A
       person is stood out of sight: out of a door (a home in the morning, a
       shop at lunch) or on a pavement, 35-150 m off. He is taken away only
       where nobody can see it: far behind you, gone in at a door while the
       street is thinning, or left on an island that is no longer the one in
       force. The dead stay where they fell until the island goes.
   THE STAFF  post(b, spot, opts) -> post: a worker posted in building b
       (the clerk behind a counter, a teller): a city ped held on his spot
       (ped.staffPost: rooted, faces the counter or whoever the venue says,
       hands up under a gun, robbable, killable). He is stood where nobody is
       looking while his building is open and you are near; at closing he
       walks out of his door and home (CBZ.leave); one who was KILLED stays
       dead (post.lost, g.isleDead: saved, and kept when the island is built
       again) until a week later somebody new has the job.
       world/island_venue.js CBZ.islandVenue.staff is this.
   THE HOURS  every trade keeps its hours on the clock (isOpen(b)); a shop
       front has a roller shutter that comes down at closing once the shop
       is empty and goes up in the morning. A shut shutter is solid and
       locked: "Break in" forces it (the alarm rings: a burglary, for whoever
       saw or heard it).

   API  CBZ.islandPeople = {
          arena()                the people arena of the island in force
          arenaOf(A)             ... of island arena A
          populate(A)            generator: the first of them, out of sight
          post(b, spot, opts)    spot {lx, lz, face} (building frame) or {x, z, face} (world)
                                 opts { job, look(post, ped, dt) -> {x,z}|null, armed }
          unpost(post)
          isOpen(b) / hours(b)   [open, close] in clock hours, null = always open
          spawnAt(x, z, opts)    one of them stood at (x, z) on the island in force
                                 (a loan shark's collectors, city/islandmoney.js)
          despawn(ped)           take one away (call it only where nobody sees)
          drop(A) / leave()      an island goes / the islands are left
          state()
        }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  const SMALL = CBZ.deviceClass === "phone" || CBZ.deviceClass === "tablet";
  const BASE = CBZ.deviceClass === "phone" ? 12 : CBZ.deviceClass === "tablet" ? 16 : 24;
  const RING0 = 35, RING1 = 150;   // where a new person is stood, from you
  const GONE = 230;                // past this and unseen, a person is taken away
  const STAFF_IN = 95, STAFF_OUT = 170;

  function onIsles() { return g.mode === "archipelago"; }
  function active() { const A = CBZ.surv && CBZ.surv.arena; return onIsles() && A && A.island && A.root ? A : null; }
  function under(o, root) {
    for (let p = o; p; p = p.parent) if (p === root) return true;
    return false;
  }
  let _s = 0x15e01e;
  function rnd() { _s = (Math.imul(_s, 1103515245) + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function hour() { return CBZ.cityHour ? CBZ.cityHour() : 12; }
  function unseen(x, y, z) { return CBZ.leave && CBZ.leave.unseen ? CBZ.leave.unseen({ x: x, y: y, z: z }) : true; }
  function groundY(A, x, z) {
    let y = null;
    if (CBZ.groundAt) { try { y = CBZ.groundAt(x, z, 60); } catch (e) { y = null; } }
    if (!Number.isFinite(y) && A && A.groundHeightAt) y = A.groundHeightAt(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  /* ---- THE HOURS ---------------------------------------------------------- */
  const HOURS = {
    bank: [9, 17], loans: [9, 18], cityhall: [9, 17], recruit: [9, 17], office: [8, 18],
    jewelry: [10, 19], suits: [10, 19], eyewear: [9, 18], clothing: [9, 20], phones: [9, 20],
    guns: [9, 20], pawn: [9, 21], usedcars: [9, 19], cardealer: [9, 19],
    cafe: [7, 19], diner: [7, 23], bakery: [6, 18], deli: [8, 20], icecream: [10, 22], grocer: [7, 22],
    butcher: [7, 18], chemist: [8, 21], newsagent: [6, 20], books: [9, 19], florist: [8, 18],
    laundry: [7, 22], barber: [9, 19], hardware: [8, 18], surfshop: [9, 19], diveshop: [8, 18],
    market: [6, 14], shop: [8, 20],
  };
  function hours(b) { return (b && b.use && HOURS[b.use]) || null; }
  function isOpen(b) {
    const H = hours(b);
    if (!H) return true;
    const h = hour();
    return h >= H[0] && h < H[1];
  }

  /* ---- THE STREET AS LOTS ------------------------------------------------- */
  const HOME = { house: 1, villa: 1, apartments: 1 };
  const KIND = {
    cafe: "food", diner: "food", deli: "food", bakery: "food", icecream: "food", grocer: "food", butcher: "food", market: "food",
    hardware: "hardware", works: "hardware", warehouse: "hardware",
    clothing: "clothing", suits: "clothing", eyewear: "clothing", surfshop: "clothing", diveshop: "clothing",
    phones: "electronics", bank: "bank", loans: "bank", cityhall: "cityhall", recruit: "cityhall",
    office: "office", guns: "guns", pawn: "pawn", jewelry: "jewelry", barber: "barber",
    cardealer: "carlot", usedcars: "carlot", hotel: "hotel", motel: "hotel", fuel: "gas",
  };
  // the island plan's districts, as the city's casting reads a district
  const DIST = {
    core: { kind: "core", wealth: 0.7 }, midtown: { kind: "commercial", wealth: 0.55 },
    waterfront: { kind: "commercial", wealth: 0.5 }, industrial: { kind: "industrial", wealth: 0.3 },
    westside: { kind: "projects", wealth: 0.25 }, northside: { kind: "residential", wealth: 0.45 },
    estates: { kind: "residential", wealth: 0.85 }, rural: { kind: "residential", wealth: 0.35 },
  };
  function shim(b) {
    const IV = CBZ.islandVenue;
    if (!b || !b.group || b.ox == null || !IV || !IV.lotFor) return null;
    let L = null;
    try { L = IV.lotFor(b); } catch (e) { L = null; }
    const d = L && L.building && L.building.door;
    if (!d) return null;
    const home = !!HOME[b.use];
    return {
      kind: home ? "home" : (KIND[b.use] || b.use || "shop"), use: b.use || null, name: b.name || null, b: b,
      cx: b.x, cz: b.z, w: b.w, d: b.d, district: DIST[b.district] || DIST.rural, isle: true,
      // the city's lots carry the INWARD normal (venue's lotFor names the outward one)
      building: { door: { x: d.x, z: d.z, nx: -d.nx, nz: -d.nz }, w: b.w, d: b.d, ox: b.ox, oz: b.oz, group: b.group },
      // a building that came down, or a shop that is shut, is nobody's errand
      get demolished() { return !!b.fallen || (!home && !isOpen(b)); },
    };
  }
  function makeArena(A) {
    const T = CBZ.islandTown && CBZ.islandTown.of ? CBZ.islandTown.of(A) : null;
    if (!T) return null;
    const I = A.island || {};
    const recs = (I.buildings || []).concat(I.sites || []);
    const homes = [], work = [], all = [];
    for (const b of recs) {
      if (!b || !b.use || b.use === "police") continue;      // the station is the force's (world/island_police.js)
      const l = shim(b);
      if (!l) continue;
      all.push(l);
      (l.kind === "home" ? homes : work).push(l);
    }
    const P = Object.create(T);
    P.town = T; P.A = A;
    P.lots = null;                    // no open lots (a yard to stroll into): the routine falls to the doors
    P.shopLots = work; P.homeLots = homes; P.all = all;
    P.step = Infinity;                // no signal grid to cross at: a goal is walked straight
    P.districtAt = function (x, z) {
      let best = null, bd = 1e12;
      for (const l of all) { const dd = (l.cx - x) * (l.cx - x) + (l.cz - z) * (l.cz - z); if (dd < bd) { bd = dd; best = l; } }
      return best ? best.district : DIST.rural;
    };
    // the routine's "somewhere on the street": near you, where life is
    P.randomSidewalkPoint = function () {
      const Pl = CBZ.player && CBZ.player.pos;
      let q = T.randomSidewalkPoint();
      if (!Pl) return q;
      for (let k = 0; k < 6 && Math.hypot(q.x - Pl.x, q.z - Pl.z) > 160; k++) q = T.randomSidewalkPoint();
      return q;
    };
    P.weightedSidewalkPoint = function () { return P.randomSidewalkPoint(); };
    return P;
  }
  function arenaOf(A) {
    if (!A || !A.root || !A.island) return null;
    if (A._people && A._people.A === A) return A._people;
    const P = makeArena(A);
    if (P) A._people = P;
    return P;
  }
  function arena() { const A = active(); return A ? arenaOf(A) : null; }

  /* ---- ONE PERSON --------------------------------------------------------- */
  const LIFE = { resident: 1, student: 1, laborer: 1, professional: 1, merchant: 1 };
  function pickBy(list) { return list.length ? list[(rnd() * list.length) | 0] : null; }
  function workFor(PA, ped) {
    const a = ped.archetype;
    const want = a === "professional" ? ["bank", "office", "cityhall"] : a === "laborer" ? ["hardware", "carlot", "gas"]
      : a === "student" ? ["food", "clothing", "electronics", "barber"] : null;
    let pool = want ? PA.shopLots.filter(function (l) { return want.indexOf(l.kind) >= 0; }) : [];
    if (!pool.length) pool = PA.shopLots;
    return pickBy(pool);
  }
  function stand(A, PA, x, z, opts) {
    if (!CBZ.cityMakePed) return null;
    const d = PA.districtAt(x, z);
    const cast = Object.assign(CBZ.cityCastFor ? CBZ.cityCastFor(d, rnd) : {}, opts || {});
    let ped = null;
    try { ped = CBZ.cityMakePed(x, z, rnd, cast); } catch (e) { console.error("[island people]", e); return null; }
    if (!ped) return null;
    if (cast._role) ped._role = cast._role;
    ped._isleRoot = A.root;
    ped.pos.y = (opts && opts._y != null) ? opts._y : groundY(A, x, z);
    // an address and a job on THIS island (the city's housing never leases
    // him a Gang City flat: his digs are already his)
    const home = (opts && opts._homeLot) || pickBy(PA.homeLots);
    if (home) { ped._home = home; ped._digs = home; }
    if (!(opts && opts.staff) && LIFE[ped.archetype]) ped._work = workFor(PA, ped);
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    return ped;
  }
  function despawn(ped) {
    if (!ped) return;
    if (CBZ.leave && CBZ.leave.cancel) CBZ.leave.cancel(ped);
    if (CBZ.cityDespawnPed) CBZ.cityDespawnPed(ped);
    else {
      const i = CBZ.cityPeds.indexOf(ped);
      if (i >= 0) CBZ.cityPeds.splice(i, 1);
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
    }
  }

  /* ---- HOW MANY ----------------------------------------------------------- */
  function hourMul() {
    const h = hour();
    if (h >= 7 && h < 20) return 1;
    if (h >= 20 && h < 23) return 0.6;
    if (h >= 6 && h < 7) return 0.55;
    return 0.25;
  }
  function target() {
    const q = CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel;
    const qm = q <= 0 ? 0.5 : q === 1 ? 0.7 : q === 2 ? 0.85 : 1;
    // the pavement crowd (city/streetlife.js) fills the footways now: these
    // are the town's own walkers on their errands among them, so fewer rigs
    const base = CBZ.streetLife ? Math.round(BASE * 0.7) : BASE;
    return Math.max(3, Math.round(base * qm * hourMul()));
  }
  function isMine(p, root) { return !!(p && p._isleRoot && (!root || p._isleRoot === root)); }
  function free(p) {
    // a body the street is using (a fight, a call, a collar, your crew, a post,
    // a walk out) is not the population's to take away
    return !(p.dead || p.controlled || p.companion || p.recruited || p.restraint || p.staffPost || p._islandPost ||
      p.rage || p.state === "fight" || p.state === "flee" || (p.npcWanted | 0) > 0 || p.reportState || p._leaving ||
      p.inCar || p._npcAttached || p._ladder || p.surrender || (p.ko || 0) > 0);
  }

  // where a new person comes from: a door (home in the morning and at night,
  // a shop's at lunch and in the evening) or the pavement
  function spawnSpot(A, PA, boot) {
    const Pl = CBZ.player && CBZ.player.pos;
    if (!Pl) return null;
    const h = hour();
    const fromDoor = rnd() < 0.6;
    if (fromDoor) {
      const homes = h < 10 || h >= 21;
      const pool = homes ? PA.homeLots : (rnd() < 0.5 ? PA.shopLots.filter(function (l) { return !l.demolished; }) : PA.homeLots);
      for (let t = 0; t < 6 && pool.length; t++) {
        const l = pool[(rnd() * pool.length) | 0];
        const D = l.building.door;
        const dd = Math.hypot(D.x - Pl.x, D.z - Pl.z);
        if (dd < (boot ? 20 : RING0) || dd > RING1) continue;
        const x = D.x - D.nx * 1.4, z = D.z - D.nz * 1.4;            // a step out of the door
        const y = groundY(A, x, z);
        if (!boot && !unseen(x, y, z)) continue;
        return { x: x, z: z, y: y, lot: l, emerge: l.kind === "home" };
      }
    }
    for (let t = 0; t < 8; t++) {
      const q = PA.town.randomSidewalkPoint();
      const dd = Math.hypot(q.x - Pl.x, q.z - Pl.z);
      if (dd < (boot ? 20 : RING0) || dd > RING1) continue;
      const y = groundY(A, q.x, q.z);
      if (!boot && !unseen(q.x, y, q.z)) continue;
      return { x: q.x, z: q.z, y: y };
    }
    return null;
  }
  function spawnOne(A, PA, boot) {
    const s = spawnSpot(A, PA, boot);
    if (!s) return null;
    const opts = { _y: s.y };
    if (s.lot && s.lot.kind === "home") opts._homeLot = s.lot;
    const ped = stand(A, PA, s.x, s.z, opts);
    if (ped && s.emerge) { ped._emerge = true; ped._goalKind = "emerge"; }
    return ped;
  }
  function* populate(A) {
    const PA = arenaOf(A);
    if (!PA) return;
    let n = 0;
    for (const p of CBZ.cityPeds) if (isMine(p, A.root) && !p.dead && !p._islandPost) n++;
    const want = Math.round(target() * 0.7);
    for (let k = 0; k < want * 4 && n < want; k++) {
      if (active() && active() !== A) return;                  // the island changed again
      if (spawnOne(A, PA, g.state !== "playing")) n++;
      yield 0;
    }
  }

  /* ---- THE CROWD'S UPKEEP ------------------------------------------------- */
  let tickT = 0, lastMode = null, clk = 0;
  function upkeep(A, PA) {
    const Pl = CBZ.player && CBZ.player.pos;
    if (!Pl) return;
    const want = target();
    let live = 0;
    const L = CBZ.cityPeds;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      if (!p || !p._isleRoot || p._islandPost) continue;
      if (p._isleRoot !== A.root) {
        // the last island's people go where nobody sees them go (its dead stay
        // with it, and go when it does)
        if (!p.dead && !p._leaving && unseen(p.pos.x, p.pos.y, p.pos.z)) despawn(p);
        continue;
      }
      if (p.dead) continue;
      live++;
      if (!free(p)) continue;
      const d = Math.hypot(p.pos.x - Pl.x, p.pos.z - Pl.z);
      // gone in at a door while the street thins (home at night): he stays in
      if (p.enterT > 0 && (live > want || hourMul() < 1)) { despawn(p); live--; continue; }
      if (d > GONE && unseen(p.pos.x, p.pos.y, p.pos.z)) { despawn(p); live--; }
    }
    if (g.state !== "playing") return;
    if (live < want) spawnOne(A, PA, false);
    if (live < want * 0.5) spawnOne(A, PA, false);
  }

  /* ---- THE STAFF ---------------------------------------------------------- */
  const posts = new Set();
  /* A POST may also be (world/island_civic.js, island_dealers.js,
     island_offices.js): up the building (opts.k, the storey: the mayor at
     his desk, the councillors on the dais), on its own shift (opts.hours
     [on, off] on the clock, wrapping past midnight: the night guard at a
     door the day shuts), only while you are this near (opts.near), cast as
     somebody (opts.archetype: "military" for the recruiting sergeant, "exec"
     for the boss; opts.name), with its own way out at the end of the shift
     (opts.exit {lx, lz, k}: a worker upstairs walks to the stair or the lift
     and goes from there once nobody sees him). post.goTo(x, z, face) walks
     him to a world spot and roots him there (a salesman over to the car
     you are looking at); post.back() walks him home to his post; post.hold
     leaves him to the venue (riding in a car); post.on() his shift is on. */
  function inHours(H) {
    const h = hour(), a = H[0], z = H[1];
    return a <= z ? (h >= a && h < z) : (h >= a || h < z);
  }
  function open(P) { return P.hours ? inHours(P.hours) : isOpen(P.b); }
  function post(b, spot, opts) {
    if (!b || !spot) return null;
    opts = opts || {};
    const IV = CBZ.islandVenue;
    const k = opts.k | 0;
    const F = IV && IV.floor ? IV.floor(b, k) : null;
    let x = spot.x, z = spot.z, face = spot.face || 0;
    if (spot.lx != null && F) { const w = F.toWorld(spot.lx, spot.lz); x = w.x; z = w.z; face = (spot.face || 0) + F.yaw; }
    if (x == null || z == null) return null;
    let exit = null;
    if (opts.exit && F && opts.exit.lx != null) {
      const Fe = (opts.exit.k | 0) === k ? F : IV.floor(b, opts.exit.k | 0);
      const w = Fe.toWorld(opts.exit.lx, opts.exit.lz);
      exit = { x: w.x, z: w.z, y: Fe.y };
    }
    const P = {
      b: b, x: x, z: z, y: F ? F.y : (b.gy || 0), face: face, k: k,
      job: opts.job || "clerk", look: opts.look || null, armed: opts.armed, ped: null, lost: false,
      hours: opts.hours || null, near: opts.near || 0, name: opts.name || null,
      archetype: opts.archetype || (opts.dress && opts.dress.archetype) || null, exit: exit, at: null, hold: false,
      body: function () { const p = P.ped; return p && !p.dead ? p : null; },
      goTo: function (gx, gz, f) { P.at = { x: gx, z: gz, face: f != null ? f : null }; },
      back: function () { P.at = null; },
      on: function () { return open(P); },
    };
    // ONE WHO WAS KILLED STAYS DEAD: across the island going and coming back,
    // and across a saved game (g.isleDead rides world/isles_save.js), until
    // the place has had a week to hire somebody new
    P.key = deadKey(b, P);
    const died = P.key ? deadBook()[P.key] : null;
    if (died != null && dayNum() - died < REHIRE_DAYS) P.lost = true;
    posts.add(P);
    return P;
  }
  const REHIRE_DAYS = 7;
  function deadBook() { return g.isleDead || (g.isleDead = {}); }
  function dayNum() { return CBZ.dayCount ? CBZ.dayCount() : 0; }
  function deadKey(b, P) {
    const I = CBZ.islandVenue && CBZ.islandVenue.island ? CBZ.islandVenue.island(b) : null;
    const iid = I && I.arena && I.arena.id;
    if (!iid) return null;
    return iid + ":" + (b.planId != null ? b.planId : (Math.round(b.ox) + "," + Math.round(b.oz))) + ":" + P.job + ":" + Math.round(P.x) + "," + Math.round(P.z);
  }
  function unpost(P) {
    if (!P) return;
    posts.delete(P);
    const p = P.ped;
    P.ped = null;
    if (p && !p.dead) despawn(p);
  }
  const PACKS = { guns: 1, pawn: 1, jewelry: 1, bank: 1 };
  function mint(P, A, PA) {
    const b = P.b, use = b.use || "";
    const armed = P.armed != null ? !!P.armed : !!PACKS[use];
    const ped = stand(A, PA, P.x, P.z, {
      staff: true, _y: P.y, job: P.job, archetype: P.archetype || "merchant", wealth: 0.55,
      aggr: armed ? 0.5 : 0.3, armed: armed, weapon: armed ? "Pistol" : null,
      cash: 60 + ((rnd() * 160) | 0),
    });
    if (!ped) return null;
    ped.staffPost = { x: P.x, z: P.z, face: P.face };
    ped._islandPost = P;
    ped._venueStaff = use || true;
    ped._work = PA.all.find(function (l) { return l.b === b; }) || null;
    if (armed) { ped.nerve = 0.85; ped.ammo = 30; }
    if (P.name) ped.name = P.name;
    if (ped.group) ped.group.rotation.y = P.face;
    P.ped = ped;
    return ped;
  }
  // a walk the venue asked for: off his spot, along a controlled path (the
  // way systems/leave.js walks a city ped), rooted again where he arrives
  function walkTick(P, p) {
    const want = P.at;
    const tx = want ? want.x : P.x, tz = want ? want.z : P.z;
    const W = p._isleWalk;
    if (!W) {
      const R = p.staffPost;
      if (R && Math.abs(R.x - tx) < 0.05 && Math.abs(R.z - tz) < 0.05) return;     // rooted where he should be
      if (Math.hypot(p.pos.x - tx, p.pos.z - tz) < 0.5) { p.staffPost = { x: tx, z: tz, face: want && want.face != null ? want.face : P.face }; return; }
      p._isleWalk = { x: tx, z: tz };
    } else if (W.x !== tx || W.z !== tz) { W.x = tx; W.z = tz; }
    if (Math.hypot(p.pos.x - tx, p.pos.z - tz) < 0.6) {
      p._isleWalk = null; p.controlled = false; p.path = null; p.finalGoal = null;
      p.staffPost = { x: tx, z: tz, face: want && want.face != null ? want.face : P.face };
      return;
    }
    p.staffPost = null; p.controlled = true;
    p.path = [{ x: tx, z: tz }]; p.finalGoal = { x: tx, z: tz };
    if (p.target && p.target.set) p.target.set(tx, 0, tz);
    p.state = "walk"; p.pause = 0;
  }
  function goHome(P) {
    const p = P.ped;
    P.ped = null;
    if (!p || p.dead) return;
    p._islandPost = null; p._isleWalk = null;
    // a post upstairs: to the stair or the lift, and gone from there unseen
    if (P.exit) {
      if (CBZ.leave && CBZ.leave.go) CBZ.leave.go(p, { route: [{ x: P.exit.x, z: P.exit.z }], remove: despawn, tag: "isle:closing" });
      else despawn(p);
      return;
    }
    const L = P.b && P.b._venueLot ? P.b._venueLot : null;
    const D = L && L.building && L.building.door;
    const route = [];
    if (D) { route.push({ x: D.x - D.nx * 1.0, z: D.z - D.nz * 1.0 }); route.push({ x: D.x, z: D.z, door: true }); route.push({ x: D.x + D.nx * 3, z: D.z + D.nz * 3 }); }
    if (CBZ.leave && CBZ.leave.go) CBZ.leave.go(p, { route: route.length ? route : null, remove: despawn, tag: "isle:closing" });
    else despawn(p);
  }
  function staffTick(A, PA, dt) {
    const Pl = CBZ.player && CBZ.player.pos;
    for (const P of posts) {
      const p = P.ped;
      const here = under(P.b.group, A.root);
      if (p) {
        if (p.dead) { P.lost = true; P.ped = null; if (P.key) deadBook()[P.key] = dayNum(); continue; }
        if (CBZ.cityPeds.indexOf(p) < 0) { P.ped = null; continue; }
        // the venue has him (riding in a car): hands off
        if (P.hold) continue;
        // a man who left his post (he ran, he fought, he was taken) is the
        // street's now: the post waits for him or a new hire
        if (!p.staffPost && !p._isleWalk) { p._islandPost = null; P.ped = null; continue; }
        const d = Pl ? Math.hypot(P.x - Pl.x, P.z - Pl.z) : 0;
        if (!here) { if (unseen(p.pos.x, p.pos.y, p.pos.z)) { despawn(p); P.ped = null; } continue; }
        if (!open(P)) { goHome(P); continue; }
        if (d > (P.near ? P.near + 75 : STAFF_OUT) && unseen(p.pos.x, p.pos.y, p.pos.z)) { despawn(p); P.ped = null; continue; }
        walkTick(P, p);
        if (!p.staffPost) continue;
        let at = null;
        if (P.look) { try { at = P.look(P, p, dt); } catch (e) { at = null; } }
        p.staffPost.face = at ? Math.atan2(at.x - p.pos.x, at.z - p.pos.z) : (P.at && P.at.face != null ? P.at.face : P.face);
        continue;
      }
      if (P.lost || !here || P.b.fallen || !open(P) || g.state !== "playing") continue;
      if (Pl && Math.hypot(P.x - Pl.x, P.z - Pl.z) > (P.near || STAFF_IN)) continue;
      if (!unseen(P.x, P.y, P.z)) continue;
      mint(P, A, PA);
    }
  }

  /* ---- THE CUSTOMERS -------------------------------------------------------
     An open shop near you has somebody in it: one or two people (a few in
     the bank, the café, the town hall) standing at the stock, the counter or
     the window, the way a customer stands, each for a minute or two and then
     out of the door and away (CBZ.leave), and another in their place a while
     later. They are the street's people (cast by district, robbable, hands up
     under a gun), stood on the shop floor where nobody is looking, on a spot
     clear of the keep-outs and of everything the fit-out put down. */
  const CUST_USES = {
    guns: 1, pawn: 1, jewelry: 1, eyewear: 1, clothing: 1, suits: 1, phones: 1, bank: 3, loans: 1, cityhall: 3, recruit: 1,
    cafe: 2, diner: 3, deli: 2, bakery: 2, grocer: 2, chemist: 2, hardware: 1, books: 1, barber: 1, newsagent: 1, florist: 1,
    butcher: 1, icecream: 2, laundry: 1, chandlery: 1, shop: 1, surfshop: 1, diveshop: 1, market: 2,
  };
  const CUST_NEAR = CBZ.deviceClass === "phone" ? 38 : SMALL ? 46 : 58;
  const CUST_CAP = CBZ.deviceClass === "phone" ? 5 : SMALL ? 7 : 11;
  const custs = new Set();
  function hitR(a, r) { return a.x0 < r.x1 && a.x1 > r.x0 && a.z0 < r.z1 && a.z1 > r.z0; }
  // the shop floor's free standing places, building-local (found once)
  function custSpots(b) {
    if (b._custSpots) return b._custSpots;
    const IV = CBZ.islandVenue;
    const out = [];
    b._custSpots = out;
    if (!IV || !IV.floor) return out;
    const F = IV.floor(b, 0), L = F.local, B = F.bounds;
    const cols = [];
    for (const c of b.colliders || []) {
      if (!c || c.minX == null) continue;
      if (c.y1 != null && c.y1 < F.y + 0.1) continue;
      if (c.y0 != null && c.y0 > F.y + 1.7) continue;
      if (c.minX < B.x0 - 0.02 || c.maxX > B.x1 + 0.02 || c.minZ < B.z0 - 0.02 || c.maxZ > B.z1 + 0.02) continue;   // a wall
      cols.push(c);
    }
    const I = b.interior;
    if (I && I.furn) for (const f of I.furn) if (f.L === 0 && !f.cleared && f.cols) for (const c of f.cols) cols.push(c);
    const R = 0.42;
    for (let lz = L.z0 + 0.9; lz <= L.z1 - 0.7; lz += 0.85) {
      for (let lx = L.x0 + 0.7; lx <= L.x1 - 0.7; lx += 0.85) {
        const r = { x0: lx - R, x1: lx + R, z0: lz - R, z1: lz + R };
        let ok = true;
        for (const q of F.keepOut) if (hitR(r, q)) { ok = false; break; }
        if (!ok) continue;
        const w = F.toWorld(lx, lz);
        let near = null, nd = 2.2;
        for (const c of cols) {
          const cx = Math.max(c.minX, Math.min(w.x, c.maxX)), cz = Math.max(c.minZ, Math.min(w.z, c.maxZ));
          const d = Math.hypot(cx - w.x, cz - w.z);
          if (d < R + 0.08) { ok = false; break; }
          if (d < nd) { nd = d; near = { x: cx, z: cz }; }
        }
        if (!ok) continue;
        // a customer stands AT something (a shelf, a case, the counter) when
        // there is something to stand at; else he looks to the back of the shop
        const face = near ? Math.atan2(near.x - w.x, near.z - w.z) : F.yaw + Math.PI;
        out.push({ x: w.x, z: w.z, face: face, at: !!near });
      }
    }
    // the places at the stock first, the middle of the floor last
    out.sort(function (a, c) { return (c.at ? 1 : 0) - (a.at ? 1 : 0) || h01s(a.x, a.z) - h01s(c.x, c.z); });
    return out;
  }
  function h01s(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
  function custLeave(C) {
    custs.delete(C);
    const p = C.ped;
    C.ped = null;
    if (!p || p.dead) return;
    p.staffPost = null; p._islandPost = null;
    const L = C.b._venueLot, D = L && L.building && L.building.door;
    const route = D ? [{ x: D.x - D.nx * 1.0, z: D.z - D.nz * 1.0 }, { x: D.x, z: D.z, door: true }, { x: D.x + D.nx * 3, z: D.z + D.nz * 3 }] : null;
    if (CBZ.leave && CBZ.leave.go) CBZ.leave.go(p, { route: route, remove: despawn, tag: "isle:customer" });
    else despawn(p);
  }
  function custTick(A, PA) {
    const Pl = CBZ.player && CBZ.player.pos;
    if (!Pl) return;
    const now = clk;
    let n = 0;
    for (const C of Array.from(custs)) {
      const p = C.ped;
      if (!p || p.dead || CBZ.cityPeds.indexOf(p) < 0 || !p.staffPost) { custs.delete(C); if (p && !p.dead && p._islandPost === C) p._islandPost = null; continue; }
      const d = Math.hypot(p.pos.x - Pl.x, p.pos.z - Pl.z);
      const here = under(C.b.group, A.root);
      if (!here || (d > CUST_NEAR + 60 && unseen(p.pos.x, p.pos.y, p.pos.z))) { custs.delete(C); despawn(p); continue; }
      if (!isOpen(C.b) || C.b.fallen || now > C.until) { custLeave(C); continue; }
      n++;
    }
    if (g.state !== "playing" || n >= CUST_CAP) return;
    // the nearest open shop short of its people gets one, where nobody sees him come
    let best = null, bd = CUST_NEAR;
    for (const l of PA.shopLots) {
      const b = l.b, want = CUST_USES[b.use];
      if (!want || b.fallen || !isOpen(b) || !b.group || !under(b.group, A.root)) continue;
      const d = Math.hypot(b.x - Pl.x, b.z - Pl.z);
      if (d >= bd) continue;
      let have = 0;
      for (const C of custs) if (C.b === b) have++;
      if (have >= Math.max(1, Math.round(want * hourMul()))) continue;
      if ((b._custNext || 0) > now) continue;
      bd = d; best = b;
    }
    if (!best) return;
    best._custNext = now + 8 + rnd() * 20;
    const spots = custSpots(best);
    if (!spots.length) return;
    const taken = [];
    for (const C of custs) if (C.b === best) taken.push(C.spot);
    for (let t = 0; t < 4; t++) {
      const s = spots[Math.min(spots.length - 1, (rnd() * Math.min(spots.length, 6)) | 0)];
      if (taken.indexOf(s) >= 0) continue;
      const F = CBZ.islandVenue.floor(best, 0);
      if (!unseen(s.x, F.y, s.z)) return;
      const ped = stand(A, PA, s.x, s.z, { staff: true, _y: F.y, cash: 20 + ((rnd() * 120) | 0) });
      if (!ped) return;
      const C = { b: best, spot: s, ped: ped, until: now + 45 + rnd() * 75 };
      ped.staffPost = { x: s.x, z: s.z, face: s.face };
      ped._islandPost = C; ped._customer = best.use;
      if (ped.group) ped.group.rotation.y = s.face;
      custs.add(C);
      return;
    }
  }

  /* ---- THE SHUTTERS ------------------------------------------------------- */
  const shutters = new Set();
  const SHUT_USES = Object.keys(HOURS);
  const STEEL = 0x9aa0a6, HOUSING = 0x6d737a, RAIL = 0x4f555c;
  function shutterFit(b, lot) {
    if (!b || !b.group || !b.interior || b.kind === "tower" || b.kind === "hotel" || b.kind === "carlot" || b.kind === "showroom" || b.ox == null) return null;
    const IB = CBZ.islandBuilding || {}, IV = CBZ.islandVenue;
    const FH = IB.FH || 3.4, DW = IB.DOORW || 1.8;
    const L = lot && lot.building;
    if (!L || !L.lbox || !IV) return null;
    const ld = b.ld || b.d, z = -ld / 2 - 0.06;
    const H = FH - 0.7 + 0.05, W = DW + 0.24;
    const curtain = L.lbox(0, H / 2, z, W, H, 0.05, STEEL, { outside: true });
    const rail = L.lbox(0, 0.04, z - 0.01, W, 0.07, 0.08, RAIL, { outside: true });
    L.lbox(0, H + 0.17, -ld / 2 - 0.17, DW + 0.42, 0.34, 0.34, HOUSING, { outside: true });
    for (const s of [-1, 1]) L.lbox(s * (W / 2 + 0.03), H / 2, z, 0.06, H, 0.1, RAIL, { outside: true });
    const F = IV.floor(b, 0);
    const a = F.toWorld(-W / 2, -ld / 2 - 0.1), c = F.toWorld(W / 2, -ld / 2 + 0.3);
    const col = { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z),
      ref: null, y0: b.gy, y1: b.gy + H, shutter: true };
    const door = L.door;
    const S = { b: b, curtain: curtain, rail: rail, H: H, k: isOpen(b) ? 0 : 1, col: col, colOn: false, forced: false,
      x: door.x, z: door.z, nx: door.nx, nz: door.nz, F: F, wasOpen: isOpen(b) };
    pose(S);
    setCol(S, S.k > 0.7);
    shutters.add(S);
    return function () { setCol(S, false); shutters.delete(S); };
  }
  function pose(S) {
    const k = Math.max(0, Math.min(1, S.k)), h = Math.max(0.001, S.H * k);
    S.curtain.visible = k > 0.002;
    S.curtain.scale.y = h;
    S.curtain.position.y = S.H - h / 2;
    S.rail.position.y = S.H - h + 0.04;
  }
  function setCol(S, on) {
    if (S.colOn === !!on) return;
    S.colOn = !!on;
    const Lc = CBZ.colliders;
    if (!Lc) return;
    const i = Lc.indexOf(S.col);
    if (on && i < 0) Lc.push(S.col);
    else if (!on && i >= 0) Lc.splice(i, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // nobody inside, nobody in the doorway: then it may come down
  function shopEmpty(S) {
    const P = CBZ.player && CBZ.player.pos;
    const I = S.b.interior;
    if (P && I) {
      const q = S.F.toLocal(P.x, P.z);
      if (q.x > I.x0 - 0.5 && q.x < I.x1 + 0.5 && q.z > I.z0 - 1.2 && q.z < I.z1 + 0.5 && Math.abs(P.y - S.F.y) < 2.5) return false;
    }
    if (P && Math.hypot(P.x - S.x, P.z - S.z) < 1.6) return false;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.pos) continue;
      if (Math.abs(p.pos.x - S.x) < 2 && Math.abs(p.pos.z - S.z) < 2) return false;
      if (p._islandPost && p._islandPost.b === S.b) return false;            // the staff is still in
    }
    return true;
  }
  function shutterTick(A, dt, decide) {
    const Pl = CBZ.player && CBZ.player.pos;
    for (const S of shutters) {
      if (!under(S.b.group, A.root)) continue;
      if (decide) {
        const open = isOpen(S.b) && !S.b.fallen;
        if (open && !S.wasOpen) S.forced = false;                           // a new day: the lock is mended
        S.wasOpen = open;
        if (open || S.forced) S.want = 0;
        else if (S.k < 1 && (S.want === 1 || shopEmpty(S))) S.want = 1;
        else if (S.k <= 0.002) S.want = 0;
        // a shut shutter far away is just shut (no animation work)
        if (Pl && Math.hypot(S.x - Pl.x, S.z - Pl.z) > 160 && S.k !== S.want && unseen(S.x, S.F.y, S.z)) { S.k = S.want; pose(S); setCol(S, S.k > 0.7); }
      }
      const w = S.want == null ? S.k : S.want;
      if (S.k !== w) {
        S.k += Math.sign(w - S.k) * Math.min(Math.abs(w - S.k), dt * (S.forced ? 0.45 : 0.55));
        pose(S);
        setCol(S, S.k > 0.7);
      }
    }
  }
  function forceShutter(S) {
    if (!S || S.forced) return;
    S.forced = true; S.want = 0;
    const PA = CBZ.city && CBZ.city.playerActor;
    if (CBZ.sfx) { try { CBZ.sfx("hit"); } catch (e) {} }
    // the alarm rings: whoever is in earshot hears it, whoever saw it calls it in
    if (CBZ.cityGunshot) { try { CBZ.cityGunshot(S.x, S.z, PA, 36, "alarm"); } catch (e) {} }
    if (CBZ.cityCrime) { try { CBZ.cityCrime(70, { x: S.x, z: S.z, type: "burglary" }); } catch (e) {} }
  }
  let wired = false;
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    I.registerZone({
      id: "isle-shutter", kind: "shutter", radius: 2.6, prio: 3, islands: true, driving: false,
      find: function (px, pz) {
        if (!onIsles()) return null;
        let best = null, bd = 2.6;
        for (const S of shutters) {
          if (S.k < 0.9 || S.forced) continue;
          const d = Math.hypot(px - S.x, pz - S.z);
          if (d < bd) { bd = d; best = S; }
        }
        return best ? { x: best.x, z: best.z, shutter: best } : null;
      },
      options: [{
        id: "isle-shutter-force", slot: "e",
        label: "Break in",
        canShow: function (t) { return !!(t && t.shutter && !t.shutter.forced && t.shutter.k >= 0.9); },
        onSelect: function (t) { if (t && t.shutter) forceShutter(t.shutter); },
      }],
    });
    if (I.describe) I.describe("shutter", function (t) { return { label: (t && t.shutter && t.shutter.b.name) || "Closed" }; });
  }
  for (const u of SHUT_USES) if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on(u, shutterFit);

  /* ---- THE TICK ----------------------------------------------------------- */
  CBZ.onUpdate(35.6, function (dt) {
    const m = g.mode;
    if (m !== lastMode) {
      // ARRIVING ON THE ISLANDS: Gang City's roster (it outlives the mode, its
      // root hidden) is not the islands' street; the city stands its own again
      // on the way back (city/mode.js reset -> spawnCityPeds)
      if (m === "archipelago" && CBZ.cityPeds && CBZ.cityPeds.some(function (p) { return p && !p._isleRoot; }) && CBZ.clearCityPeds) {
        try { CBZ.clearCityPeds(); } catch (e) { console.error("[island people: city roster]", e); }
      }
      lastMode = m;
    }
    const A = active();
    if (!A) return;
    wire();
    const PA = arenaOf(A);
    if (!PA) return;
    const d = Math.min(0.1, Math.max(0, dt || 0));
    clk += d;
    tickT -= d;
    const decide = tickT <= 0;
    if (decide) {
      tickT = 0.4;
      if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) return;
      upkeep(A, PA);
      staffTick(A, PA, 0.4);
      custTick(A, PA);
    }
    shutterTick(A, d, decide);
  });

  /* ---- AN ISLAND GOES, THE ISLANDS ARE LEFT ------------------------------- */
  function dropUnder(root) {
    const L = CBZ.cityPeds || [];
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      if (p && p._isleRoot && (!root || p._isleRoot === root)) despawn(p);
    }
    for (const P of posts) if (P.ped && (!root || P.ped._isleRoot === root || !P.ped._isleRoot)) P.ped = null;
    // the guns dropped on it go with it
    const D = CBZ.cityDrops || [];
    for (let i = D.length - 1; i >= 0; i--) {
      const m = D[i] && D[i].mesh;
      if (!m || !under(m, root)) continue;
      if (m.parent) m.parent.remove(m);
      D.splice(i, 1);
    }
  }
  function drop(A) {
    if (!A || !A.root) return;
    dropUnder(A.root);
    for (const S of Array.from(shutters)) if (under(S.b.group, A.root)) { setCol(S, false); shutters.delete(S); }
    A._people = null;
  }
  function leave() {
    const L = CBZ.cityPeds || [];
    for (let i = L.length - 1; i >= 0; i--) if (L[i] && L[i]._isleRoot) despawn(L[i]);
    for (const P of posts) P.ped = null;
    custs.clear();
    const D = CBZ.cityDrops || [];
    if (D.length) {
      for (let i = D.length - 1; i >= 0; i--) {
        const m = D[i] && D[i].mesh;
        // a drop with no parent left, or hung under an island, leaves with the islands
        let isle = false;
        for (let p = m && m.parent; p; p = p.parent) if (p.name === "archipelago") { isle = true; break; }
        if (isle) { if (m.parent) m.parent.remove(m); D.splice(i, 1); }
      }
    }
    for (const S of shutters) setCol(S, false);
    shutters.clear();
  }

  CBZ.islandPeople = {
    arena: arena, arenaOf: arenaOf, populate: populate,
    post: post, unpost: unpost, isOpen: isOpen, hours: hours,
    spawnAt: function (x, z, opts) {
      const A = active(), PA = A ? arenaOf(A) : null;
      if (!A || !PA) return null;
      return stand(A, PA, x, z, Object.assign({ staff: true, _y: groundY(A, x, z) }, opts || {}));
    },
    despawn: despawn,
    drop: drop, leave: leave,
    state: function () {
      const A = active();
      let n = 0, dead = 0, staff = 0;
      for (const p of CBZ.cityPeds || []) {
        if (!p || !p._isleRoot || (A && p._isleRoot !== A.root)) continue;
        if (p.dead) dead++; else if (p._islandPost) staff++; else n++;
      }
      let shut = 0; for (const S of shutters) if (S.k > 0.7) shut++;
      return { people: n, staff: staff, dead: dead, target: target(), hour: +hour().toFixed(1), posts: posts.size,
        shutters: shutters.size, shut: shut, lots: A && A._people ? { homes: A._people.homeLots.length, work: A._people.shopLots.length } : null };
    },
  };
})();
