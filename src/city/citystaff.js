/* ============================================================
   city/citystaff.js — VISIBLE city life, TIED TO THE COMPANIES that own the
   buildings: people WAITING IN LINE at trending stores and STAFF standing
   around the offices their employer runs. Together with companies.js this is
   one feature — the firms in companies.js own the real estate; the people here
   are those firms' customers (queues) and employees (office staff):

     • a store gets a queue ONLY if a company manages it; the line is LONGER
       when that company is booming (a big portfolio reads as a "trending" store)
     • an office's visible headcount SCALES with how much real estate its
       company manages (a property empire keeps more staff on site)
     • CBZ.cityStaff.atLot(lot) → { company, role, count } so other systems can
       ask "who works/queues here and for whom"

   WHY a standalone decorative layer: the "real" walking crowd + its shared
   navigation brain (crowd.js / peds.js / citynav.js) is owned by a separate
   in-flight wave. To add the VISIBLE, company-linked queues/workers NOW without
   colliding, this file owns its OWN figures end-to-end — it reads companies.js
   (CBZ.cityCompanies) but never touches the crowd/ped/nav systems. Draw-call
   cheap (TWO InstancedMeshes for the whole city), static but for a gentle idle
   sway + a slow queue shuffle, and it shuts at night (stores closed). When the
   nav wave lands, real peds can replace these in place.
   ============================================================ */
(function () {
  if (!window.CBZ || !window.THREE) return;
  const CBZ = window.CBZ, THREE = window.THREE;

  const CAP = 180;
  const SPACING = 0.85;
  const STORE_KINDS = { clothing: 1, food: 1, electronics: 1, guns: 1, gun: 1, jewelry: 1, pawn: 1, hardware: 1, gym: 1, barber: 1, drugs: 1 };
  const TRENDING = { food: 1, clothing: 1, electronics: 1 };
  const OFFICE_KINDS = { bank: 1, security: 1, cityhall: 1, realtor: 1, airfield: 1, casino: 1 };
  const SKIN = [0xf1c8a0, 0xe0a878, 0xc98a5a, 0x8d5a36, 0x6b4226, 0xf3d2b3];
  const SHIRT = [0x4a6fa5, 0xb44b4b, 0x4caf6e, 0xe0a93b, 0x8a5ec9, 0x3a3f46, 0xc96f9b, 0x3f9c8a, 0xd0d0d6, 0x2f6fed];

  let bodyMesh = null, headMesh = null;
  let slots = [];          // { h, sway, line, idx, lat, fixed, x, z, company, lot }
  let lines = [];          // { ax, az, fx, fz, lx, lz, len, shuffleT, members[], co, dname, lot }
  let byLot = new Map();   // lot -> { company, role, count }
  let count = 0;
  let arenaRef = null, buildCool = 0, swayT = 0, feedT = 25, openF = 1;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
    _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

  function ensureMeshes() {
    if (bodyMesh) return;
    const bg = new THREE.BoxGeometry(0.46, 1.15, 0.28);
    const hg = new THREE.BoxGeometry(0.28, 0.32, 0.28);
    bodyMesh = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial(), CAP);
    headMesh = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial(), CAP);
    bodyMesh.frustumCulled = false; headMesh.frustumCulled = false;
    bodyMesh.castShadow = false; bodyMesh.receiveShadow = false;
    headMesh.castShadow = false; headMesh.receiveShadow = false;
    bodyMesh.count = 0; headMesh.count = 0;
    CBZ.scene.add(bodyMesh); CBZ.scene.add(headMesh);
  }

  function kindOf(lot) { return lot.kind || (lot.building && lot.building.shop && lot.building.shop.kind) || null; }
  function companyOf(lot) { return (CBZ.cityCompanies && CBZ.cityCompanies.objOfLot) ? CBZ.cityCompanies.objOfLot(lot) : (lot && lot._company) || null; }
  function districtName(arena, dq) { const d = arena && arena.districts && arena.districts[dq]; return (d && (d.name || d.kind)) || ("District " + ((dq | 0) + 1)); }

  function place(x, z, heading, line, idx, company, lot) {
    if (count >= CAP) return -1;
    const i = count++;
    slots[i] = { h: heading, sway: Math.random() * 6.28, line: line, idx: idx, lat: 0, fixed: line < 0, x: x, z: z, company: company || null, lot: lot || null };
    _c.setHex(SHIRT[(Math.random() * SHIRT.length) | 0]); bodyMesh.setColorAt(i, _c);
    _c.setHex(SKIN[(Math.random() * SKIN.length) | 0]); headMesh.setColorAt(i, _c);
    return i;
  }

  function build(arena) {
    // UNIFICATION GATE: wait for the company roster, then staff ONLY the
    // buildings a company manages — so every worker/customer is tied to a firm.
    if (!CBZ.cityCompanies || CBZ.cityCompanies.count() < 1) return false;

    const lots = arena.lots || [];
    let stores = [], offices = [];
    for (const lot of lots) {
      const b = lot.building; if (!b || !b.door) continue;
      if (!companyOf(lot)) continue;                 // company-managed only (the cross-link)
      const k = kindOf(lot);
      if (k && STORE_KINDS[k]) stores.push(lot);
      else if (k && OFFICE_KINDS[k]) offices.push(lot);
    }
    if (!stores.length && !offices.length) return false;

    ensureMeshes();
    count = 0; slots = []; lines = []; byLot = new Map();

    // STORE QUEUES — line out from the door, facing it. A store managed by a
    // booming company (big portfolio) is "trending" → a longer line.
    for (const lot of stores) {
      if (count >= CAP) break;
      const co = companyOf(lot);
      const d = lot.building.door;
      const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
      const lx = -uz, lz = ux;
      const k = kindOf(lot);
      const port = co ? co.lots.length : 1;
      const trending = TRENDING[k] || port >= 5;     // company success → a crowd
      const len = trending ? (6 + ((Math.random() * 4) | 0)) : (2 + ((Math.random() * 3) | 0));
      const heading = Math.atan2(-ux, -uz);
      const line = { ax: d.x + ux * 1.3, az: d.z + uz * 1.3, fx: ux, fz: uz, lx: lx, lz: lz,
        len: len, shuffleT: 3 + Math.random() * 5, members: [],
        co: co, dname: districtName(arena, lot.district), lot: lot };
      for (let j = 0; j < len && count < CAP; j++) {
        const i = place(0, 0, heading, lines.length, j, co ? co.name : null, lot);
        if (i >= 0) { slots[i].lat = (j % 2 ? 0.22 : -0.22); line.members.push(i); }
      }
      byLot.set(lot, { company: co ? co.name : null, role: "queue", count: line.members.length });
      lines.push(line);
    }

    // OFFICE STAFF — a cluster outside the entrance; headcount scales with the
    // managing company's real-estate portfolio (a property empire keeps more
    // people on site). These figures are that company's employees.
    //
    // ONE of them isn't decoration: companies.js stages a REAL, killable owner
    // ped (CBZ.cityMakePed, added to CBZ.cityPeds) right outside every
    // company's HQ door — see companies.js's spawnOwner(). At the HQ lot we
    // shave one body off the decorative cluster so the headcount reads right
    // (the owner stands in the spot a decorative figure would have), instead
    // of double-counting a person who's now a real, targetable NPC.
    for (const lot of offices) {
      if (count >= CAP) break;
      const co = companyOf(lot);
      const isHQ = !!(co && co.hq === lot && co.owner);
      const d = lot.building.door;
      const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
      const port = co ? co.lots.length : 1;
      const n = Math.max(0, 2 + Math.min(5, Math.floor(port / 2)) - (isHQ ? 1 : 0));
      let placed = isHQ ? 1 : 0;     // the real owner ped counts toward this lot's headcount too
      // FRONT DESK (CBZ.CONFIG.NPC_SCHEDULES): one clerk INSIDE the entrance,
      // just behind the doorway facing out — offices have teller counters but
      // had zero interior presence ("time at the front desk"). Stores are NOT
      // double-staffed here: every shop already posts a real vendor ped at its
      // vendorSpot (peds.js finishSpawn), so the desk gap was offices only.
      // Placed FIRST so the CAP always favors the desk over cluster bodies;
      // it rides the same openF night-close as every other figure.
      if (CBZ.CONFIG && CBZ.CONFIG.NPC_SCHEDULES && count < CAP) {
        const ci = place(d.x - ux * 2.4, d.z - uz * 2.4, Math.atan2(ux, uz), -1, -1, co ? co.name : null, lot);
        if (ci >= 0) placed++;
      }
      for (let j = 0; j < n && count < CAP; j++) {
        const fx = d.x + ux * (1.4 + Math.random() * 2.2) + (-uz) * (Math.random() - 0.5) * 3.0;
        const fz = d.z + uz * (1.4 + Math.random() * 2.2) + (ux) * (Math.random() - 0.5) * 3.0;
        const i = place(fx, fz, Math.random() * 6.28, -1, -1, co ? co.name : null, lot);
        if (i >= 0) placed++;
      }
      byLot.set(lot, { company: co ? co.name : null, role: "staff", count: placed });
    }

    arenaRef = arena;
    bodyMesh.count = count; headMesh.count = count;
    writeAll();
    return true;
  }

  function slotXZ(s) {
    if (s.fixed) return s;
    const ln = lines[s.line]; if (!ln) return s;
    const t = s.idx * SPACING;
    return { x: ln.ax + ln.fx * t + ln.lx * s.lat, z: ln.az + ln.fz * t + ln.lz * s.lat };
  }

  function writeAll() {
    if (!bodyMesh) return;
    if (openF <= 0.02) { bodyMesh.count = 0; headMesh.count = 0; bodyMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true; return; }
    bodyMesh.count = count; headMesh.count = count;
    const fl = CBZ.floorAt || null;
    for (let i = 0; i < count; i++) {
      const s = slots[i], xz = slotXZ(s), gy = fl ? fl(xz.x, xz.z) : 0, bob = Math.sin(s.sway) * 0.03;
      _e.set(0, s.h, 0); _q.setFromEuler(_e);
      _p.set(xz.x, gy + 0.62 + bob, xz.z); _m.compose(_p, _q, _s); bodyMesh.setMatrixAt(i, _m);
      _p.set(xz.x, gy + 1.35 + bob, xz.z); _m.compose(_p, _q, _s); headMesh.setMatrixAt(i, _m);
    }
    bodyMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
  }

  function shuffle(dt) {
    let moved = false;
    for (const ln of lines) {
      ln.shuffleT -= dt; if (ln.shuffleT > 0) continue;
      ln.shuffleT = 4 + Math.random() * 6;
      for (const si of ln.members) { const s = slots[si]; s.idx = (s.idx - 1 + ln.len) % ln.len; s.lat = (s.idx % 2 ? 0.22 : -0.22); }
      moved = true;
    }
    return moved;
  }

  // may the open/close flip happen NOW without a visible pop? True when no
  // staffed slot sits close to the player inside the camera's forward cone.
  // Runs only when the day/night dial actually wants to flip (rare), so the
  // ≤CAP distance scan is nothing. Flag off → always true (old behavior).
  function flipSafe() {
    if (!CBZ.CONFIG || !CBZ.CONFIG.NPC_SPAWN_HIDE) return true;
    const P = CBZ.player; if (!P || P.dead) return true;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let i = 0; i < count; i++) {
      const xz = slotXZ(slots[i]);
      const rx = xz.x - P.pos.x, rz = xz.z - P.pos.z, d2 = rx * rx + rz * rz;
      if (d2 >= 45 * 45) continue;
      const rd = Math.sqrt(d2) || 1;
      if ((rx / rd) * fx + (rz / rd) * fz >= 0.35) return false;   // close AND on camera
    }
    return true;
  }

  // a rare feed line that makes the company↔queue link VISIBLE in the ticker
  function feedTie() {
    const busy = lines.filter(function (l) { return l.co && l.members.length >= 5; });
    if (!busy.length) return;
    const ln = busy[(Math.random() * busy.length) | 0];
    try { if (CBZ.cityFlavor) CBZ.cityFlavor("Line out the door at " + ln.co.name + "'s store in " + ln.dname, "#bcd0ff"); } catch (e) {}
  }

  CBZ.cityStaff = {
    count: function () { return count; },
    atLot: function (lot) { const e = byLot.get(lot); if (!e) return null; const co = companyOf(lot); return { company: co ? co.name : null, role: e.role, count: e.count }; },
    reset: function () { count = 0; slots = []; lines = []; byLot = new Map(); arenaRef = null; if (bodyMesh) { bodyMesh.count = 0; headMesh.count = 0; } },
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
        if (roster && roster.indexOf(ped) < 0) { dropPost(p, "swept"); continue; }
        if (ped.player || ped.driving) continue;   // somebody else owns this body now
        const dx = ped.pos ? ped.pos.x - P.x : p.x - P.x, dz = ped.pos ? ped.pos.z - P.z : p.z - P.z;
        if (dx * dx + dz * dz > p.far * p.far) dropPost(p, "far");
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
    if (!CBZ.game || CBZ.game.mode !== "city") { if (bodyMesh && bodyMesh.count) { bodyMesh.count = 0; headMesh.count = 0; } return; }
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !arena.lots) return;
    if (arena !== arenaRef || !count) {
      buildCool -= dt; if (buildCool > 0) return; buildCool = 1.0;
      try { build(arena); } catch (e) {}
      return;
    }
    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const want = night < 0.5 ? 1 : 0;
    let dirty = false;
    // SPAWN-IN GUARD (CBZ.CONFIG.NPC_SPAWN_HIDE): the open/close flip rewrites
    // EVERY figure at once — if the player is standing at a staffed lot looking
    // at it, whole queues would blink in (dawn) or vanish (dusk) on camera.
    // Defer the flip while any slot is close AND inside the forward cone; the
    // dial re-tries every tick, so the change lands the moment you look away.
    if (want !== (openF > 0.5 ? 1 : 0) && flipSafe()) { openF = want; dirty = true; }
    if (openF <= 0.02) { if (dirty) writeAll(); return; }
    feedT -= dt; if (feedT <= 0) { feedT = 26 + Math.random() * 12; feedTie(); }
    swayT += dt;
    const sh = shuffle(dt);
    if (swayT >= 0.09 || sh || dirty) {
      swayT = 0;
      for (let i = 0; i < count; i++) slots[i].sway += 0.6 + (i & 3) * 0.05;
      writeAll();
    }
  });
})();
