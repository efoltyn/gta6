/* ============================================================
   city/citystaff.js — THE PEOPLE WHO WORK AT A PLACE (CBZ.cityStaffPost:
   declared posts, real bodies minted near you), and which company a lot's
   people work for (CBZ.cityStaff.atLot).

   WHAT USED TO BE HERE AND IS GONE (2026-11-22). This file opened with a
   "standalone decorative layer": up to 180 box-and-head figures in two
   InstancedMeshes, standing in queues out of store doors and in clusters
   outside offices, swaying, with a "front desk clerk" box inside office
   doors. You could not talk to them, rob them, hurt them or walk through
   them (you walked through them). The owner: "many stores have different
   character models that are fake, not interactable characters. Just make it
   real." A queue of boxes is not a customer and a box at a desk is not a
   receptionist, so they are deleted, not dressed up. The real people at a
   shop are its vendor (peds.js, city/keepers.js) and the crowd that walks
   in and out of it; an office's front desk is a real posted receptionist
   below (venue "frontdesk"), a whole person on the roster.
   ============================================================ */
(function () {
  if (!window.CBZ || !window.THREE) return;
  const CBZ = window.CBZ;

  const OFFICE_KINDS = { security: 1, realtor: 1 };
  let arenaRef = null, buildCool = 0;

  function kindOf(lot) { return lot.kind || (lot.building && lot.building.shop && lot.building.shop.kind) || null; }
  function companyOf(lot) { return (CBZ.cityCompanies && CBZ.cityCompanies.objOfLot) ? CBZ.cityCompanies.objOfLot(lot) : (lot && lot._company) || null; }
  // a lot's people, counted off the bodies that are really there
  function headcount(lot) {
    let n = 0;
    const b = lot && lot.building;
    if (b && b.vendor && !b.vendor.dead) n++;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      if (p.lot === lot && p.ped && !p.ped.dead) n++;
    }
    return n;
  }

  // FRONT DESKS: one receptionist just inside every company-run office door.
  // Declared once per arena (data only; the post tick mints the body near you).
  function build(arena) {
    if (!CBZ.cityStaffPost || !CBZ.interiorDoorPost) return false;
    CBZ.cityStaffVenue("frontdesk", { stations: 0, note: "a receptionist inside every company office door" });
    let n = 0;
    for (const lot of arena.lots || []) {
      const b = lot.building;
      if (!b || !b.localDoor || lot.demolished) continue;
      if (!OFFICE_KINDS[kindOf(lot)]) continue;
      // the first clear spot just inside the door, a step to one side of the
      // walk in (the fit-out may have a desk or a plant where the first try lands)
      let at = null;
      for (const inD of [2.6, 3.4, 1.9, 4.2]) {
        for (const lat of [1.1, -1.1, 1.9, -1.9, 0]) { at = CBZ.interiorDoorPost(b, inD, lat); if (at) break; }
        if (at) break;
      }
      if (!at) continue;
      const post = CBZ.cityStaffPost({
        venue: "frontdesk", id: "frontdesk:" + Math.round(lot.cx) + "," + Math.round(lot.cz),
        job: "receptionist", archetype: "worker", x: at.x, z: at.z, face: at.face + Math.PI,
        pose: "table", opts: { wealth: 0.45, aggr: 0.1 }, near: 120, far: 200,
      });
      if (post) { post.lot = lot; n++; }
    }
    CBZ.cityStaffStations("frontdesk", n);
    arenaRef = arena;
    return true;
  }

  CBZ.cityStaff = {
    count: function () { let n = 0; for (let i = 0; i < posts.length; i++) if (posts[i].ped && !posts[i].ped.dead) n++; return n; },
    atLot: function (lot) {
      const co = companyOf(lot);
      const n = headcount(lot);
      if (!co && !n) return null;
      return { company: co ? co.name : null, role: OFFICE_KINDS[kindOf(lot)] ? "staff" : "shop", count: n };
    },
    reset: function () { arenaRef = null; },
  };
  CBZ.cityStaffReset = function () { CBZ.cityStaff.reset(); clearPosts(); };

  /* ==========================================================================
     §  EVERY PLACE HAS THE PEOPLE WHO WORK THERE — CBZ.cityStaffPost.

     OWNER (2026-07-27, verbatim): "roles can be greatly expanded... every place
     should have the people who work there."

     A roles pass gave the city a real taxonomy and then LISTED the venues that
     have the buildings and not the people. The list was long and every entry
     was the same shape: geometry that implies a job (a lifeguard chair, a
     cashier cage, a fuel dock, a pushback tug, a ski lift) standing empty. A
     venue with no staff is a stage set.

     WHAT THIS REPLACES — the four things each of those venues would otherwise
     have written by hand, and which airside.js, casino.js and boatyard.js had
     all skipped precisely BECAUSE they are four things and not one:

       (1) minting the body            -> CBZ.cityPostNpc (occupy.js's atom)
       (2) putting it in the furniture -> CBZ.propSit/propSleep (propuse.js)
       (3) NOT paying 16 draw calls for a body nobody is standing next to
       (4) reaping it, and knowing not to re-mint one that was SHOT

     (3) is the reason this is a block and not a loop of cityPostNpc calls. A
     full rig is ~16 draw calls and is the biggest GPU cost in this game; there
     are ~40 of these jobs across the world and the player can only ever be at
     ONE venue. So a post is DECLARED at build time (pure data, no body) and a
     body is minted only inside `near` and given back beyond `far`. The default
     `near` is 170 m, which is deliberate arithmetic, not taste: peds.js's
     render LOD hides every rig past 95 m (VIS_D2) and config.js's
     npcTransitionSafe auto-allows any placement past 150 m — so a body minted
     at 170 m is BOTH invisible and un-spawn-watchable by construction, and by
     the time you are close enough to see the venue it has always been staffed.
     Nobody ever watches a worker appear.

     (4) is the honest half: these are ordinary CBZ.cityPeds. They die through
     killfeed.js's bus, they aim, they surrender at gunpoint, interactions.js
     offers the normal ped verbs on them. If you kill the croupier the table
     stays empty — `lost` counts it and this file will not quietly mint a
     replacement, because a replacement would make the murder a no-op. A body
     merely SWEPT (a mode change clears CBZ.cityPeds) is re-manned, exactly the
     distinction govcomplex.js draws for its officeholders.

     ADOPTION IS ONE CALL and it is degrade-safe: no cityPostNpc, no body, the
     venue is exactly as empty as it was before, nothing throws.

         CBZ.cityStaffVenue("marina", { stations: 13 });
         CBZ.cityStaffPost({ venue: "marina", x: qx, z: qz, face: f,
                             job: "harbourmaster" });

     `adopt` is the contracts.js law applied here — bind to the body the world
     ALREADY runs rather than minting a duplicate (boatyard.js's broker is
     marina.js's broker). `attach` is the seam for a body that belongs in a
     moving thing: the caller does its own npcLife.attach and we never touch
     the transform (airside.js's tug drivers).

     RATCHET: CBZ.venueStaffAudit().unstaffed — declared STATIONS minus the
     posts and bodies that can fill them, summed over every venue. It is a
     property of the code, not of play (a killed worker counts in `lost`, never
     here), so it may only ever go DOWN.
     ========================================================================== */
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // one-line revert: no venue ever mints a worker, exactly as before this file.
  if (CFG.VENUE_STAFF == null) CFG.VENUE_STAFF = true;
  // citywide ceiling on bodies THIS system owns (occupy.js's OCCUPY_MAX_PEDS
  // plays the same role for occupied buildings). One venue cannot eat the world.
  if (CFG.VENUE_STAFF_MAX == null) CFG.VENUE_STAFF_MAX = 40;

  const posts = [];                    // every declared job in the world
  const venues = Object.create(null);  // id -> { stations, note, census }
  let liveBodies = 0;

  function staffOn() { return CFG.VENUE_STAFF !== false; }
  function playerPos() { const P = CBZ.player; return (P && P.pos) ? P.pos : null; }

  function dropPost(p, reason) {
    const ped = p.ped;
    const wasAdopted = p.adopted;
    p.ped = null; p.adopted = false;
    if (!ped) return;
    if (!wasAdopted) liveBodies = Math.max(0, liveBodies - 1);
    // A `release` that returns TRUE has taken the body over — the caller wants
    // it left standing in the world (a tug driver whose tug was just stolen
    // must be thrown out ALIVE, not deleted in front of the thief). Anything
    // else and we clean up the body we minted.
    let kept = false;
    if (p.release) { try { kept = p.release(ped, reason) === true; } catch (e) { kept = false; } }
    if (wasAdopted || kept) return;    // never destroy a body we do not own
    // A LIVING WORKER WHOSE JOB ENDED WALKS OFF (the shift is over, the turf
    // was lost, the venue was re-declared under him). He gets up, walks out
    // and systems/leave.js takes him off the world when nobody can see him;
    // he used to blink out at his counter on the hour.
    if (WALK_OUT[reason] && CBZ.leave && ped.pos && !ped.dead && ped.group && ped.group.parent) {
      try { if (ped._propSeat || ped._propBed) { if (CBZ.propStand) CBZ.propStand(ped); } } catch (e) {}
      try { if (ped._npcAttached && CBZ.cityUnseat) CBZ.cityUnseat(ped, { state: "walk" }); } catch (e) {}
      if (CBZ.leave.go(ped, { tag: "venue:" + (p.venue || "?") + ":" + reason, remove: unpostBody })) return;
    }
    unpostBody(ped);
  }
  const WALK_OUT = { gone: 1, rebuild: 1 };
  function unpostBody(ped) {
    try { if (ped._propSeat || ped._propBed) { if (CBZ.propStand) CBZ.propStand(ped, { instant: true }); } } catch (e) {}
    try { if (ped._npcAttached && CBZ.cityUnseat) CBZ.cityUnseat(ped, { state: "walk" }); } catch (e) {}
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); } catch (e) {} }
  }
  function clearPosts() {
    for (let i = posts.length - 1; i >= 0; i--) dropPost(posts[i], "reset");
    posts.length = 0;
    for (const k in venues) delete venues[k];
    liveBodies = 0;
  }
  function clearVenue(id) {
    for (let i = posts.length - 1; i >= 0; i--) {
      if (posts[i].venue !== id) continue;
      dropPost(posts[i], "rebuild");
      posts.splice(i, 1);
    }
  }

  // Declare what the GEOMETRY implies. `stations` is the honest count of jobs
  // the place has — the lifeguard chair, both stall counters, every felt table.
  // Calling it also CLEARS this venue's previous posts, so a world rebuild
  // re-declaring its venue can never inherit ghosts from the last arena.
  CBZ.cityStaffVenue = function (id, spec) {
    if (!id) return null;
    clearVenue(id);
    const v = venues[id] || (venues[id] = {});
    v.stations = (spec && spec.stations != null) ? (spec.stations | 0) : 0;
    v.note = (spec && spec.note) || null;
    v.census = (spec && typeof spec.census === "function") ? spec.census : null;
    return v;
  };

  // Declare ONE job. Data only — the tick below mints and reaps the body.
  CBZ.cityStaffPost = function (spec) {
    if (!spec || spec.x == null || spec.z == null) return null;
    const venue = spec.venue || "world";
    if (!venues[venue]) venues[venue] = { stations: 0, note: null, census: null };
    const p = {
      venue: venue, id: spec.id || (venue + ":" + (posts.length | 0)),
      x: +spec.x, z: +spec.z, face: spec.face || 0,
      job: spec.job || null, archetype: spec.archetype || null,
      opts: spec.opts || null,
      seat: spec.seat || null, bed: spec.bed || null,
      attach: spec.attach || null, release: spec.release || null,
      adopt: spec.adopt || null, alive: spec.alive || null, after: spec.after || null,
      // a job that MOVES (the driver of a service vehicle on its loop): the
      // post asks the caller where its station is right now instead of holding
      // a stale build-time coordinate.
      at: spec.at || null,
      pose: spec.pose || null,
      near: spec.near != null ? +spec.near : 170,
      far: spec.far != null ? +spec.far : 320,
      ped: null, adopted: false, lost: false, fails: 0,
    };
    posts.push(p);
    return p;
  };
  // Update a venue's station count WITHOUT clearing it — for a venue that only
  // learns how many jobs it has while it is walking its own lots (the casino
  // dress pass finds its tables one building at a time).
  CBZ.cityStaffStations = function (id, n) {
    const v = venues[id] || (venues[id] = { stations: 0, note: null, census: null });
    v.stations = n | 0;
    return v.stations;
  };
  // The live post list. Deliberately the ONLY accessor: a venue that wants its
  // own worker holds the record cityStaffPost handed back (boatyard.js does),
  // so there is no lookup-by-id helper here to go stale — a second way to ask
  // the same question is how two answers start disagreeing.
  CBZ.cityStaffPosts = function () { return posts; };

  function resolveRec(v) { return (typeof v === "function") ? v() : v; }
  // where this job IS right now — authored coords for a fixed station, the
  // caller's live answer for one that moves.
  function postAt(p) {
    if (p.at) { try { const q = p.at(p); if (q && q.x != null) { p.x = +q.x; p.z = +q.z; } } catch (e) {} }
    return p;
  }

  function man(p) {
    // (a) BIND TO THE WORLD FIRST. contracts.js's law: never spawn a body the
    //     simulation already runs. boatyard's broker IS marina's broker.
    if (p.adopt) {
      let a = null;
      try { a = p.adopt(); } catch (e) { a = null; }
      if (a && !a.dead) {
        p.ped = a; p.adopted = true;
        if (p.job && !a.job) a.job = p.job;
        if (p.after) { try { p.after(a); } catch (e) {} }
        return true;
      }
    }
    if (liveBodies >= (CFG.VENUE_STAFF_MAX | 0)) return false;
    if (!CBZ.cityPostNpc) return false;
    if (CBZ.citySpawnDraining) return false;
    // Belt and braces: at the default `near` this is always true (170 > the
    // guard's 150 m auto-allow), but a venue that asks for a short leash still
    // gets the shared "never let the player see a spawn" contract.
    if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(p.x, p.z)) return false;

    // PIN ONLY WHAT STANDS. peds.js's posted-staff brain roots a body at its
    // slot and returns from move() BEFORE the seated branch, so pinning a body
    // we are about to hand to propSit/npcLife.attach would fight the seat and
    // win — which is why the two things in this repo that already do this right
    // (island_airport's gate lounge and police.js's helicopter crew) both post
    // UNPINNED and let the seat own the body.
    //
    // The test is "will this body ACTUALLY be seated", not "was a seat asked
    // for": with propuse.js absent the seat never happens, and an unpinned body
    // with no seat and no post brain simply wanders off its station.
    const seat = resolveRec(p.seat), bed = resolveRec(p.bed);
    const willSeat = !!(p.attach || (bed && CBZ.propSleep) || (seat && CBZ.propSit));
    const o = { pin: !willSeat, face: p.face, src: "staff:" + p.venue, job: p.job, aggr: 0.12, armed: false };
    if (p.archetype) o.archetype = p.archetype;
    if (p.opts) for (const k in p.opts) o[k] = p.opts[k];
    let ped = null;
    try { ped = CBZ.cityPostNpc(p.x, p.z, o); } catch (e) { ped = null; }
    if (!ped) { p.fails++; return false; }
    ped._venueStaff = p.venue;
    if (p.job) ped.job = p.job;               // TRUTHFUL job: the Lv.N pill reads it
    if (p.pose && CBZ.setCharPose && ped.char) { try { CBZ.setCharPose(ped.char, p.pose); } catch (e) {} }

    // (b) put them IN the furniture / the machine they work.
    let placed = true;
    if (p.attach) {
      try { placed = !!p.attach(ped); } catch (e) { placed = false; }
    } else if (bed && CBZ.propSleep) {
      placed = !!CBZ.propSleep(ped, bed, { instant: true });
    } else if (seat && CBZ.propSit) {
      placed = !!CBZ.propSit(ped, seat, { instant: true });
    }
    if (!placed) { if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); } catch (e) {} } p.fails++; return false; }

    p.ped = ped; p.adopted = false; liveBodies++;
    if (p.after) { try { p.after(ped); } catch (e) {} }
    return true;
  }

  // 41.86 — immediately behind this file's own instanced layer (41.8) and
  // after peds.js's brain (34) / npclife's seat re-assert (33.8), so a body we
  // hand to a seat this frame is already being held by the time we look again.
  let staffAcc = 0, tradesWired = false;
  CBZ.onUpdate(41.86, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!tradesWired) tradesWired = wireTrades();
    if (!staffOn() || !posts.length) return;
    staffAcc += dt || 0;
    if (staffAcc < 0.45) return;                 // ~2 Hz: nobody can tell, and it is free
    staffAcc = 0;
    const P = playerPos();
    if (!P) return;
    const roster = CBZ.cityPeds;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      // the thing this job is attached to went away (a stolen tug, a demolished
      // stand): the post goes with it, and it is not a "lost" body.
      if (p.alive) { let ok = true; try { ok = !!p.alive(p); } catch (e) { ok = false; } if (!ok) { dropPost(p, "gone"); continue; } }
      const ped = p.ped;
      if (ped) {
        // SHOT stays vacant. SWEPT comes back. That is the whole difference
        // between a consequence and a bug.
        if (ped.dead) { p.lost = true; dropPost(p, "dead"); continue; }
        // (asleep on the phone budget, peds.js `_dormant`, is not swept: still his)
        if (roster && !ped._dormant && roster.indexOf(ped) < 0) { dropPost(p, "swept"); continue; }
        if (ped.player || ped.driving) continue;   // somebody else owns this body now
        const dx = ped.pos ? ped.pos.x - P.x : p.x - P.x, dz = ped.pos ? ped.pos.z - P.z : p.z - P.z;
        // past his post's range, and out of sight (fitout's 48 m is indoors,
        // in plain view down a corridor): never taken away while seen
        if (dx * dx + dz * dz > p.far * p.far && (!CBZ.leave || !ped.pos || CBZ.leave.unseen(ped.pos))) dropPost(p, "far");
        continue;
      }
      if (p.lost) continue;
      postAt(p);
      const dx = p.x - P.x, dz = p.z - P.z;
      if (dx * dx + dz * dz > p.near * p.near) continue;
      man(p);
    }
  });

  /* --------------------------------------------------------------------------
     A JOB WITH NO WORKPLACE IS A LABEL. aigoals.js's CITY_JOBS is the ONE job
     table (a shift, a wage, a lot kind or a work-anchor kind); CLAUDE.md's own
     census counts ~120 job strings the world casts that it has never heard of,
     and casting forty more waterfront/airside/casino workers would have made
     that number worse rather than better. So every trade this wave deals is
     REGISTERED into that table — additively, guarded, and only for keys the
     table does not already own, so aigoals.js keeps every number it authored.

     It runs on the first tick rather than at parse: this file loads BEFORE
     aigoals.js (index.html 876 vs 880), so `CBZ.cityJobs` does not exist yet
     while we are parsing. Both derived tables are written, because aigoals
     derives JOB_KINDS once at parse and would otherwise never see these rows —
     and an anchor job's `lots` is legitimately `[]` there, which is aigoals'
     own convention for "routes to a work-anchor, not a storefront".
     -------------------------------------------------------------------------- */
  const TRADES = {
    // --- the water: marina, boatyard, hardstand, fuel dock
    "dockhand":            { class: "trade",   anchor: "marina", hours: [6, 18], pay: 12 },
    "deckhand":            { class: "trade",   anchor: "marina", hours: [7, 19], pay: 12 },
    "yard hand":           { class: "trade",   anchor: "marina", hours: [7, 17], pay: 11 },
    "boat mechanic":       { class: "trade",   anchor: "marina", hours: [8, 18], pay: 16 },
    "yacht captain":       { class: "service", anchor: "marina", hours: [8, 20], pay: 28 },
    "harbourmaster":       { class: "law",     anchor: "marina", hours: [7, 19], pay: 19 },
    "yacht broker":        { class: "service", anchor: "marina", hours: [9, 18], pay: 22 },
    "fuel attendant":      { class: "trade",   anchor: "marina", hours: [7, 19], pay: 11 },
    "fisherman":           { class: "trade",   anchor: "fishing", hours: [5, 17], pay: 10 },
    // --- the airfield (island_airport.js already registers the "terminal" anchor)
    "baggage handler":     { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 13 },
    "ramp agent":          { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 14 },
    "aircraft marshaller": { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 15 },
    "refueller":           { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 15 },
    "catering driver":     { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 13 },
    "pushback driver":     { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 16 },
    // the tower cab is manned round the clock — an airfield without a
    // controller is the "dumb empty prop" the owner reported.
    "air traffic controller": { class: "service", anchor: "terminal", hours: [0, 24], pay: 31 },
    "airfield driver":     { class: "trade",   anchor: "terminal", hours: [5, 23], pay: 15 },
    // --- the casino floor (a real storefront exists: lot.kind "casino")
    "croupier":            { class: "service", lots: ["casino"], hours: [16, 4], pay: 17 },
    "cage cashier":        { class: "service", lots: ["casino"], hours: [12, 4], pay: 15 },
    "pit boss":            { class: "law",     lots: ["casino"], hours: [16, 4], pay: 24 },
    // the count room behind the cage (city/bank.js's CBZ.cityVaultRoom). The
    // drop is counted round the clock in a real house, which is also why he is
    // the one body who is always standing next to that door.
    "count clerk":         { class: "service", lots: ["casino"], hours: [0, 24], pay: 16 },
    // --- the banking hall (2026-08-02 vault wave). aigoals.js already casts
    // "office worker"/"accountant"/"security guard" INTO bank lots, but nobody
    // in this game had ever worked a teller window, and the officer who can
    // legally open a vault did not exist as a role at all — which is exactly
    // the "~120 jobs the world casts that CITY_JOBS has never heard of" the
    // Block Law census counts. Three rows, three real posts, three real verbs.
    "bank teller":         { class: "service", lots: ["bank"], hours: [9, 17], pay: 15 },
    "bank manager":        { class: "service", lots: ["bank"], hours: [8, 18], pay: 27 },
    // a vault guard is posted, not patrolling, and the door is never unwatched.
    "vault guard":         { class: "law",     lots: ["bank"], hours: [0, 24], pay: 17 },
    // --- the beach
    "lifeguard":           { class: "law",     anchor: "beach", hours: [8, 19], pay: 14 },
    // --- the mountain (biome_snow.js already registers the "slope" anchor)
    "ski patrol":          { class: "law",     anchor: "slope", hours: [8, 17], pay: 15, patrol: true },
    "lift operator":       { class: "trade",   anchor: "slope", hours: [8, 17], pay: 11 },
    // --- the household. A mansion with nobody in it but guards is a stage set.
    "housekeeper":         { class: "service", anchor: "estate", hours: [7, 19], pay: 12 },
    "estate cook":         { class: "service", anchor: "estate", hours: [6, 20], pay: 14 },
    "groundskeeper":       { class: "trade",   anchor: "estate", hours: [7, 17], pay: 11 },
    "chauffeur":           { class: "service", anchor: "estate", hours: [6, 23], pay: 15 },
    "nanny":               { class: "service", anchor: "estate", hours: [7, 19], pay: 12 },
    "butler":              { class: "service", anchor: "estate", hours: [7, 22], pay: 18 },
  };
  function wireTrades() {
    const J = CBZ.cityJobs, K = CBZ.cityJobKinds;
    if (!J || !K) return false;
    for (const k in TRADES) {
      if (J[k]) continue;                       // aigoals owns it — never overwrite
      J[k] = TRADES[k];
      K[k] = TRADES[k].lots || [];
    }
    return true;
  }
  CBZ.cityStaffTrades = TRADES;

  /* --------------------------------------------------------------------------
     CBZ.venueStaffAudit() — THE RATCHET (CLAUDE.md BLOCK LAW #5).

     Per venue: how many jobs the GEOMETRY implies (`stations`), how many are
     declared (`posts` + whatever the venue mans itself, `census`), and how many
     bodies are standing in them RIGHT NOW (`manned`).

       unstaffed  — stations with nothing declared that could ever fill them.
                    THE PIN. It does not move when you shoot somebody, so it is
                    a property of the code and may only ever go DOWN.
       lost       — posts whose holder was killed. Evidence, never a pin: a
                    murdered croupier is the system working.
       roleless   — a staffed body with no truthful `job` string, which is the
                    "Lv.N <shrug>" bug reappearing. Should read 0.
       manned/dormant — printed beside `unstaffed` so a "fix" that declares
                    posts and never mans one cannot pass.
     -------------------------------------------------------------------------- */
  CBZ.venueStaffAudit = function () {
    const out = {
      venues: Object.create(null), stations: 0, posts: 0, census: 0,
      manned: 0, dormant: 0, unstaffed: 0, lost: 0, roleless: 0, adopted: 0,
      failed: 0, live: liveBodies, cap: CFG.VENUE_STAFF_MAX | 0,
      tradesWired: tradesWired, enabled: staffOn(),
    };
    for (const id in venues) {
      const v = venues[id];
      let n = 0;
      if (v.census) { try { n = v.census() | 0; } catch (e) { n = 0; } }
      out.venues[id] = { stations: v.stations | 0, posts: 0, census: n, manned: 0, lost: 0, note: v.note || undefined };
      out.census += n;
    }
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const V = out.venues[p.venue] || (out.venues[p.venue] = { stations: 0, posts: 0, census: 0, manned: 0, lost: 0 });
      V.posts++; out.posts++;
      if (p.fails) out.failed += p.fails;
      if (p.lost) { V.lost++; out.lost++; }
      if (p.ped && !p.ped.dead) {
        V.manned++; out.manned++;
        if (p.adopted) out.adopted++;
        if (!p.ped.job || !String(p.ped.job).trim()) out.roleless++;
      } else if (!p.lost) out.dormant++;
    }
    for (const id in out.venues) {
      const V = out.venues[id];
      const fillable = (V.posts | 0) + (V.census | 0);
      V.unstaffed = Math.max(0, (V.stations | 0) - fillable);
      out.stations += V.stations | 0;
      out.unstaffed += V.unstaffed;
    }
    return out;
  };

  CBZ.onUpdate(41.8, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !arena.lots || arena === arenaRef) return;
    buildCool -= dt; if (buildCool > 0) return; buildCool = 1.0;
    try { build(arena); } catch (e) { console.error("[citystaff frontdesk]", e); }
  });
})();
