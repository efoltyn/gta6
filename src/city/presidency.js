/* ============================================================
   city/presidency.js — THE PRESIDENT MODE: one spine over organs that
   already exist.

   OWNER (verbatim): "make a new mode president where you are president and
   the sand city has terrorist orgs and you can build a wall etc make the
   president game cool it can turn into king or dictator or person in jail
   etc … don't make president game from scratch really build it off of the
   core engine code while dogfooding and improving the engine."

   WHAT THIS FILE IS, AND IS NOT. Every organ was already built by an
   earlier wave and this file authors NONE of them again:
     the seat        candidacy.js writes rec.office.holder (swearIn is that
                     file's own new export — the origin fast-forwards what
                     winning the election already does, so the presidency
                     stays reachable in ordinary play too)
     the powers      statecraft.js (CBZ.gov) — decrees, pardon, treasury,
                     tyranny, legitimacy, the refusable army
     the falls       regimes.js (emergency -> dictatorship), crown.js
                     (dictator self-coronation -> monarchy), games/jail.js +
                     wanted.js's toJail (the person-in-jail ending)
     the army        militia.js — the crackdown verb on the General's rung
     the enemy       factions.js declares the cell; occupy.js houses it;
                     aigoals' rampage brain drives an attacker; the panic /
                     killfeed / wanted buses carry the consequences
     the wall        construction.js's CBZ.stateWall (revived in that file —
                     it builds segments over days out of a real treasury)
     the map         govcomplex.js built the Executive Mansion and the
                     Bureau HQ on their own land; biome_desert.js built the
                     sand city (The Saltlands, and Dry Gulch on its highway)

   THE GUN-ROOM GRAMMAR, APPLIED (doctrine LAW 1). The Situation Room is a
   real LOCKED room inside the Executive Mansion: a steel door anyone can
   walk up to and see, that opens only for the sitting head of state. Inside
   is the best-dressed console in the building — a map table whose BUTTONS
   are real orders, and every button's lit/dark state is READ BACK from the
   system it commands (no stat fictions):
     ADDRESS THE NATION   CBZ.approvalShock + w.politics.scandal (approval.js
                          reads both; the effect sign reads murders7d/panic
                          off the world, statecraft's own discipline)
     STATE OF EMERGENCY   CBZ.gov.decree("emergency") — regimes.js's own
                          emergencyPowers ladder; 100 IS the dictatorship
     ORDER CRACKDOWN      CBZ.militia.orderCrackdown — the General's rung;
                          guarded by rankKnows, refused with the chair empty
     BUILD THE WALL       CBZ.stateWall.order — construction.js builds real
                          segments along the Saltlands frontier, treasury out
     DIRECT THE BUREAU    real Bureau agents at real cell members (below)
     SIGN A PARDON        CBZ.gov.pardon — statecraft's own ceiling rules
     ONE STATE / THE STATE TAKES THE MARKET
                          CBZ.regimeDeclareDoctrine("fascism"/"communism") —
                          the reachable PRODUCER for the two govTypes nine
                          gates branch on; gated on emergencyPowers >= 50
                          (a president needs emergency powers to get there)
     TAKE THE CROWN       CBZ.crown.selfCrown — visible ONLY while the
                          country reads "dictatorship". A category door.

   TERROR IN THE SAND CITY. One org, declared ONCE via CBZ.factions.declare
   (id "cell" — the id militia.js's hostileTo and worldstate's extremists
   standing were already written against). Its ROSTER is real ledger people
   (officials.js's mintIdentity shape via cityPedStash); its safehouses are
   real Dry Gulch lots occupied through occupy.js; its attacks need a living
   holder of the "attack" rung (kill every bomber and the attacks stop — the
   rank-is-a-verb law applied to the enemy); its supply arrives on runs that
   CROSS THE SALTLANDS FRONTIER, which is exactly what the wall throttles.
   An attack near the player is STAGED on real bodies through aigoals'
   rampage brain; a far one resolves as a world event (terror-threat through
   cityEvent, real approval, real emergencyPowers) — reported, never faked.

   COUNTERTERROR IS PEOPLE AT PEOPLE (the owner's standing ask: "ways to
   order real npcs to interact with other npcs"): DIRECT THE BUREAU casts
   real agents at the Bureau gate (cityPostNpc — occupy's own atom, never a
   parallel spawner), parks a real black car beside them, and marches them
   at the safehouse on the ped brain's own guard field. Near the player the
   breach is a real firefight against the cell bodies occupy posted; far
   away it resolves against the same roster with the same reporting. Either
   way the outcome feeds approval and worldstate's counterterror event.

   FLAGS (all self-defaulted here; one-line reverts):
     PRESIDENCY_V1       master
     PRESIDENCY_SITROOM  the room, the door, the console
     PRESIDENCY_TERROR   the cell, its attacks, its supply
     PRESIDENCY_RAIDS    the Bureau order
     PRESIDENCY_FALLS    impeachment + the junta's knock (jail ending)

   HUD DOCTRINE: the killfeed is the only popup. Everything else is the
   phone (CBZ.phoneNotify), the feed, and CBZ.city.big spent only on a
   category change. The rich readout is the BOARD in the room, painted on
   events through the canvasTexLive shape (core/packages.js:110 — that
   helper is package-ctx-scoped, so the nine-line shape is copied here
   verbatim rather than importing a package mount).

   DETERMINISM: the room is fixed offsets off the govcomplex site rect; the
   roster is a named seedStream; every schedule roll is CBZ.hash01(day, salt).
   No Math.random anywhere in this file.

   AUDIT: CBZ.presidencyAudit() — see bottom. The orchestrator runs it.

   LOAD: index.html, after city/govcomplex.js (reads CBZ.govComplexes) —
   everything else is feature-detected and lazily retried.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  if (CFG.PRESIDENCY_V1 == null) CFG.PRESIDENCY_V1 = true;
  if (CFG.PRESIDENCY_SITROOM == null) CFG.PRESIDENCY_SITROOM = true;
  if (CFG.PRESIDENCY_ROOMS_V2 == null) CFG.PRESIDENCY_ROOMS_V2 = true;
  if (CFG.PRESIDENCY_TERROR == null) CFG.PRESIDENCY_TERROR = true;
  if (CFG.PRESIDENCY_RAIDS == null) CFG.PRESIDENCY_RAIDS = true;
  if (CFG.PRESIDENCY_FALLS == null) CFG.PRESIDENCY_FALLS = true;

  function on() { return CFG.PRESIDENCY_V1 !== false; }

  // ============================================================
  //  TUNING — every number is a price, a threshold or a term in somebody
  //  else's formula.
  // ============================================================
  const ADDRESS_COST = 2000, ADDRESS_COOLDOWN = 2;      // days
  const RAID_COST = 6000, RAID_AGENTS = 3;
  const RAID_MUSTER_SEC = 45, RAID_ABSTRACT_SEC = 90;   // go along, or it happens without you
  const CRACKDOWN_COST = 3000;
  const DOCTRINE_EMERGENCY_MIN = 50;                    // emergencyPowers needed to proclaim
  const CELL_ROSTER = 9;                                // 1 emir + 2 bombers + 3 runners + 3 sympathizers
  const CELL_SUPPLY_PER_ATTACK = 3;
  const CELL_MAX_SUPPLY = 9;
  const ATTACK_MIN_GAP_DAYS = 2;
  const ATTACK_NEAR = 150;                              // stage a real scene inside this range
  const ATTACK_APPROVAL = -5;                           // a bombing the state failed to stop
  const RAID_WIN_APPROVAL = 4, RAID_LOSS_APPROVAL = -3;
  const IMPEACH_SCANDAL = 85, IMPEACH_APPROVAL = 15, IMPEACH_SCANDAL_LO = 50;
  const ARREST_GRACE_SEC = 30;                          // marshals give you one warning
  const JAIL_SENTENCE_SEC = 240, JAIL_BAIL = 60000;

  // ============================================================
  //  SMALL HELPERS — statecraft.js's own shapes, reused by convention.
  // ============================================================
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#8fc1ff"); } catch (e) {} } }
  function big(t) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(t); } catch (e) {} } }
  function news(text) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: text, priority: 1 }); return; } catch (e) {} }
    feed(text, "#ffd76a");
  }
  function orders(from, text, prio) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "system", from: from, text: text, priority: prio == null ? 1 : prio }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 3.0);
  }
  function politics() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (w && w.politics) return w.politics;
    return g.cityPolitics || null;
  }
  // THE SEAT — statecraft owns "does the player hold office"; the presidency
  // is specifically the COUNTRY seat.
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country") ? h : null;
  }
  function seatRec() { const h = seat(); return h ? h.rec : null; }
  // every order pays out of the seat's REAL treasury — the same field polwar
  // drains for war upkeep and civilwar splits on a fracture. statecraft.js's
  // payFromTreasury discipline, verbatim: an empty purse REFUSES the order.
  function payTreasury(rec, amount) {
    const have = rec.treasury || 0;
    if (have < amount) return false;
    rec.treasury = have - amount;
    return true;
  }
  function shock(id, n) { if (CBZ.approvalShock && isFinite(n)) { try { CBZ.approvalShock(id, n); } catch (e) {} } }

  // own seeded LCG for runtime casting order (repo convention; never
  // Math.random). Build-path choices below use hash01/seedStream instead.
  let _seed = 552800941 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : 0.5; }

  // ============================================================
  //  STATE — g.presWorld, dual-rider persisted (bottom).
  // ============================================================
  function fresh() {
    return {
      began: false,
      lastAddressDay: -999,
      // the cell — roster of real ledger sids (officials' mintIdentity shape)
      roster: [],            // [{sid, name, rank, dead}]
      rosterSeeded: false,
      supply: 2,
      lastAttackDay: -999,
      attacksDone: 0, runsBlocked: 0, runsThrough: 0,
      intelKnown: false,     // the Bureau needs one thread to pull
      raidsOrdered: 0, raidsWon: 0, raidsLost: 0,
      // the falls
      impeachDay: null, impeached: false,
      arrestT: 0, arrestArmed: false, arrestWhy: null,
      wasPresident: false,
    };
  }
  function st() { if (!g.presWorld) g.presWorld = fresh(); return g.presWorld; }
  function reset() {
    g.presWorld = fresh(); teardownRoom();
    RAID.phase = null; RAID.agents = []; RAID.car = null; RAID.target = null;
    ATT.armed = null; OCC.done = {}; OCC.arena = null; _safehouses = null;
  }

  // ============================================================
  //  §1  THE ORIGIN VERB — sworn in this morning. The origin does not own a
  //  second holder field: candidacy.js's swearIn() is the same write path a
  //  won election runs, so statecraft/elections/officials all see a normal
  //  officeholder. Returns truthy so origins.js treats the verb as started.
  // ============================================================
  function countryRecAny() {
    if (!CBZ.polity || !CBZ.polity.list) return null;
    const l = CBZ.polity.list("country") || [];
    for (let i = 0; i < l.length; i++) {
      const r = l[i];
      if (r && r.office && r.govType !== "monarchy") return r;
    }
    return l[0] || null;
  }
  function bindDetail(h) {
    // THE DEFENSE — the loyalty+weapons atom. officials.js already raises a
    // treasury-funded detail "off_<recId>" for every officeholder; when the
    // holder is the PLAYER the principal ref must be the player or the ring
    // guards a ghost. statecraft.deployGuard does this on a paid order; the
    // swearing-in does the binding for free (no bodies added — power.js and
    // protection.js grow those on their own budgets).
    if (!h || !CBZ.protection || !CBZ.protection.get) return;
    const sid = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
    let det = CBZ.protection.get("off_" + h.id);
    if (!det && CBZ.protection.create) {
      det = CBZ.protection.create({
        id: "off_" + h.id, principal: { kind: "sid", ref: sid },
        gearTier: 2, formation: "escort", fundingSource: "treasury",
        legalStatus: "state", memberCount: 0,
      });
    }
    if (det && det.principal) det.principal.ref = sid;
  }
  function presidencyBegin() {
    if (!on()) return null;
    const S = st();
    const rec = countryRecAny();
    if (!rec) return null;
    let ok = false;
    if (CBZ.cityRun && CBZ.cityRun.swearIn) {
      const r = CBZ.cityRun.swearIn(rec.id, { quiet: true });
      ok = !!(r && r.ok);
    }
    if (!ok) return null;                       // no parallel holder write, ever
    S.began = true;
    S.wasPresident = true;
    bindDetail({ id: rec.id, rec: rec });
    big("SWORN IN — PRESIDENT OF " + String(rec.name || "THE REPUBLIC").toUpperCase());
    orders("Chief of Staff", "The Mansion is yours. The Situation Room is behind the steel door off the entrance hall — your seal opens it. Nobody else's does.", 2);
    // the first WHY is a locked door: walk to it. mission.js owns the HUD
    // line, waypoint and beacon — build none of those.
    const site = mansionSite();
    if (site && CBZ.mission && CBZ.mission.start) {
      try {
        CBZ.mission.start({
          id: "pres_sitroom", title: "Enter the Situation Room", goal: "reach",
          // Resolve live: the room is built lazily after the Mansion shell.
          // This points at the actual steel threshold instead of dropping the
          // generic objective column through the landmark's dome.
          at: function () { return ROOM.doorPt || (site.seatPoint ? site.seatPoint : { x: site.cx, z: site.cz }); },
          radius: 3.4, marker: "ground", reward: 0,
        });
      } catch (e) {}
    }
    return { ok: true, seat: rec.id };
  }
  CBZ.presidencyBegin = presidencyBegin;

  // ============================================================
  //  §2  THE SITUATION ROOM — a locked room inside the Executive Mansion.
  //  Fixed offsets off the govcomplex site (deterministic); rebuilt when the
  //  world (and with it CBZ.govComplexes) is rebuilt.
  // ============================================================
  function mansionSite() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    return null;
  }
  function agencySite() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "agency" && L[i].rect) return L[i];
    return null;
  }

  const ROOM = {
    builtFor: null,     // the govComplexes array identity this room was built against
    group: null, cols: [], door: null, doorCol: null, doorOpen: 0, board: null,
    pads: [],           // [{key, x, z, mesh}]
    rect: null, doorPt: null, zonesWired: false, seats: 0, stateSymbols: 0,
  };
  // canvasTexLive — core/packages.js:110's exact shape; that helper is only
  // handed to mounted game packages via ctx, so the nine lines are copied
  // here (same board contract: paint() is the one needsUpdate writer, and it
  // is called on EVENTS, never per frame).
  function canvasTexLive(w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    const rec = { canvas: canvas, cc: canvas.getContext("2d"), tex: tex, w: w, h: h,
      paint: function () { tex.needsUpdate = true; return rec; } };
    return rec;
  }
  function cmat(hex) { return (CBZ.cmat || CBZ.mat) ? (CBZ.cmat || CBZ.mat)(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function addBox(parent, x, y, z, w, h, d, hex) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(hex));
    m.position.set(x, y, z); parent.add(m);
    return m;
  }
  function addCylinder(parent, x, y, z, r0, r1, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), cmat(hex));
    m.position.set(x, y, z); parent.add(m);
    return m;
  }
  function addCol(x, z, w, d, y0, y1) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y0 || 0, y1: y1 == null ? 3 : y1 };
    CBZ.colliders.push(c); ROOM.cols.push(c);
    return c;
  }
  function teardownRoom() {
    if (ROOM.group && ROOM.group.parent) ROOM.group.parent.remove(ROOM.group);
    for (let i = 0; i < ROOM.cols.length; i++) {
      const k = CBZ.colliders ? CBZ.colliders.indexOf(ROOM.cols[i]) : -1;
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (ROOM.doorCol && CBZ.colliders) {
      const k = CBZ.colliders.indexOf(ROOM.doorCol);
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    ROOM.group = null; ROOM.cols = []; ROOM.door = null; ROOM.doorCol = null;
    ROOM.board = null; ROOM.pads = []; ROOM.rect = null; ROOM.doorPt = null; ROOM.builtFor = null;
    ROOM.seats = 0; ROOM.stateSymbols = 0;
  }
  // is THIS person entitled through the door? The sitting head of state.
  function doorOpensFor() { return !!seat(); }

  const WALLC = 0x3a4250, STEEL = 0x2b3038, TRIM = 0x8b96a6, TABLE = 0x243244, PADC = 0x18202c;
  const NAVY = 0x17283f, BRASS = 0xb99347, LEATHER = 0x3b2b27, CARPET = 0x263c58, PAPER = 0xd8d2c4;
  function buildRoom() {
    if (!CFG.PRESIDENCY_SITROOM || !window.THREE) return false;
    const site = mansionSite();
    if (!site) return false;
    if (ROOM.builtFor === CBZ.govComplexes && ROOM.group) return true;
    teardownRoom();
    const A = CBZ.city && CBZ.city.arena;
    const root = (A && A.root) || CBZ.scene;
    if (!root || !CBZ.colliders) return false;

    // the mansion's main shell: civic(root, cx, cz-34, 56, 34, ...) — the
    // ground floor spans x cx±28, z cz-51..cz-17, front door on +z. The room
    // takes the west end of that hall. All offsets fixed => deterministic.
    const cx = site.cx, cz = site.cz;
    const intentional = CFG.PRESIDENCY_ROOMS_V2 !== false;
    // V2 is still entirely inside the published 56x34 mansion floorplate, but
    // it is a real 13x13 command room instead of an 11x8 closet around a slab.
    // V1 occupied x cx-24..cx-13 — exactly the shell's reserved stair strip.
    // Its 0.92 m console hid the flight in screenshots, but the stair wall
    // physically crossed the room. V2 uses the clear east bay instead.
    const x0 = intentional ? cx + 12.5 : cx - 24;
    const x1 = intentional ? cx + 25.5 : cx - 13;
    const z0 = intentional ? cz - 47.5 : cz - 45;
    const z1 = intentional ? cz - 34.5 : cz - 37;
    const zc = (z0 + z1) / 2;
    ROOM.rect = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
    const grp = new THREE.Group();
    root.add(grp); ROOM.group = grp;
    const H = 3.0, T = 0.24;

    if (intentional) {
      // A fitted floor and a waist-height acoustic wainscot make the room read
      // as deliberately embedded in the state residence, not a gray box that
      // appeared on top of its lobby.
      addBox(grp, (x0 + x1) / 2, 0.165, zc, x1 - x0 - 0.32, 0.05, z1 - z0 - 0.32, CARPET);
      addBox(grp, (x0 + x1) / 2, 0.72, z0 + T + 0.035, x1 - x0 - 0.6, 1.22, 0.07, NAVY);
      addBox(grp, (x0 + x1) / 2, 0.72, z1 - T - 0.035, x1 - x0 - 0.6, 1.22, 0.07, NAVY);
      for (let i = 0; i < 7; i++) {
        const px = x0 + 1.1 + i * ((x1 - x0 - 2.2) / 6);
        addBox(grp, px, 0.74, z0 + T + 0.09, 0.05, 1.12, 0.045, BRASS);
        addBox(grp, px, 0.74, z1 - T - 0.09, 0.05, 1.12, 0.045, BRASS);
      }
    }

    // walls (real colliders — the room is a fact, not a texture)
    addBox(grp, (x0 + x1) / 2, H / 2, z0 + T / 2, (x1 - x0), H, T, WALLC); addCol((x0 + x1) / 2, z0 + T / 2, x1 - x0, T, 0, H);
    addBox(grp, (x0 + x1) / 2, H / 2, z1 - T / 2, (x1 - x0), H, T, WALLC); addCol((x0 + x1) / 2, z1 - T / 2, x1 - x0, T, 0, H);
    // V2 faces its door WEST into the state hall. Legacy keeps the old east-
    // facing door so the feature flag remains a complete one-line rollback.
    const doorX = intentional ? x0 : x1;
    const solidX = intentional ? x1 : x0;
    const doorOut = intentional ? -1 : 1;
    addBox(grp, solidX + doorOut * T / 2, H / 2, zc, T, H, (z1 - z0), WALLC);
    addCol(solidX + doorOut * T / 2, zc, T, z1 - z0, 0, H);
    // door wall: two jamb segments with a 2.2 m gap at zc
    const gz0 = zc - 1.1, gz1 = zc + 1.1;
    addBox(grp, doorX - doorOut * T / 2, H / 2, (z0 + gz0) / 2, T, H, (gz0 - z0), WALLC); addCol(doorX - doorOut * T / 2, (z0 + gz0) / 2, T, gz0 - z0, 0, H);
    addBox(grp, doorX - doorOut * T / 2, H / 2, (gz1 + z1) / 2, T, H, (z1 - gz1), WALLC); addCol(doorX - doorOut * T / 2, (gz1 + z1) / 2, T, z1 - gz1, 0, H);
    if (intentional) {
      // The wainscot belongs to the two wall leaves, never across the door
      // opening. The former full-span panel left a navy waist-high slab in a
      // physically open doorway even after the steel leaf slid away.
      const southA = z0 + 0.30, southB = gz0 - 0.08;
      const northA = gz1 + 0.08, northB = z1 - 0.30;
      if (southB > southA) addBox(grp, x0 + T + 0.035, 0.72, (southA + southB) / 2, 0.07, 1.22, southB - southA, NAVY);
      if (northB > northA) addBox(grp, x0 + T + 0.035, 0.72, (northA + northB) / 2, 0.07, 1.22, northB - northA, NAVY);
    }
    // lintel over the gap
    addBox(grp, doorX - doorOut * T / 2, 2.8, zc, T, 0.4, 2.4, WALLC);

    // THE DOOR — a steel slab that slides north for the President and stays
    // shut for everyone else. Its collider is added/removed as it moves.
    const door = addBox(grp, doorX - doorOut * T / 2, 1.3, zc, 0.16, 2.6, 2.2, STEEL);
    ROOM.door = door;
    ROOM.doorHome = { x: doorX - doorOut * T / 2, z: zc };
    ROOM.doorCol = { minX: doorX - 0.2, maxX: doorX + 0.2, minZ: zc - 1.1, maxZ: zc + 1.1, y0: 0, y1: 2.6, ref: door };
    CBZ.colliders.push(ROOM.doorCol);
    ROOM.doorPt = { x: doorX + doorOut * 1.2, z: zc };
    // the seal + nameplate — a door with something visibly behind it
    const plate = canvasTexLive(256, 64);
    plate.cc.fillStyle = "#11151c"; plate.cc.fillRect(0, 0, 256, 64);
    plate.cc.strokeStyle = "#8b96a6"; plate.cc.strokeRect(3, 3, 250, 58);
    plate.cc.fillStyle = "#d8e2f2"; plate.cc.font = "bold 26px monospace"; plate.cc.textAlign = "center";
    plate.cc.fillText("SITUATION ROOM", 128, 41); plate.paint();
    const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: plate.tex }));
    // The room name belongs to the threshold, not to the moving leaf. It stays
    // readable while the President's door slides open.
    plateMesh.position.set(doorX + doorOut * 0.19, 2.48, zc); plateMesh.rotation.y = doorOut * Math.PI / 2;
    grp.add(plateMesh);

    if (intentional) {
      // Deep frame, vision panel, clearance reader and the seal: the lock now
      // advertises both what is behind it and why this player can cross it.
      addBox(grp, doorX + doorOut * 0.02, 1.35, zc - 1.22, 0.34, 2.7, 0.22, TRIM);
      addBox(grp, doorX + doorOut * 0.02, 1.35, zc + 1.22, 0.34, 2.7, 0.22, TRIM);
      addBox(grp, doorX + doorOut * 0.02, 2.73, zc, 0.34, 0.22, 2.66, TRIM);
      // Vision glass and seal are hardware ON the leaf, so they travel with it
      // rather than hovering in the opening after the collider has moved.
      const vision = addBox(door, doorOut * 0.215, 0.16, 0, 0.035, 0.52, 0.82, 0x8fb0c4);
      vision.material = new THREE.MeshBasicMaterial({ color: 0x8fb0c4, transparent: true, opacity: 0.42 });
      addBox(grp, doorX + doorOut * 0.16, 1.18, zc + 1.55, 0.18, 0.52, 0.30, STEEL);
      addBox(grp, doorX + doorOut * 0.27, 1.20, zc + 1.55, 0.035, 0.20, 0.16, 0x66d89c);
      addCylinder(door, doorOut * 0.24, 0.38, -0.58, 0.24, 0.24, 0.045, BRASS, 18).rotation.z = Math.PI / 2;
      ROOM.stateSymbols++;
    }

    // THE CONSOLE. V1 was a 5.5 m illuminated keyboard with no chairs. V2 is
    // a real ten-seat command table: the shared furniture owner draws it and
    // registers every sit anchor, while this file owns only the state orders.
    const tx = (x0 + x1) / 2, tz = zc;
    ROOM.board = canvasTexLive(1024, 512);
    ROOM.pads = [];
    if (!intentional) {
      addBox(grp, tx, 0.46, tz, 5.5, 0.92, 1.7, TABLE);
      addBox(grp, tx, 0.94, tz, 5.62, 0.06, 1.82, TRIM);
      addCol(tx, tz, 5.5, 1.7, 0, 0.98);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 1.5), new THREE.MeshBasicMaterial({ map: ROOM.board.tex }));
      face.rotation.x = -Math.PI / 2;
      face.position.set(tx, 1.0, tz);
      grp.add(face);
      addBox(grp, x0 + T + 0.05, 1.8, zc, 0.1, 2.0, 3.6, STEEL);
      const wface = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: ROOM.board.tex }));
      wface.position.set(x0 + T + 0.13, 1.8, zc); wface.rotation.y = Math.PI / 2;
      grp.add(wface);
      const rail = ["address", "emergency", "crackdown", "wall", "bureau"];
      for (let i = 0; i < rail.length; i++) {
        const px = tx - 2.2 + i * 1.1, pz = tz + 1.0;
        addBox(grp, px, 0.99, pz, 0.34, 0.1, 0.3, PADC);
        const cap = addBox(grp, px, 1.05, pz, 0.2, 0.05, 0.18, 0xb5443a);
        cap.material = new THREE.MeshLambertMaterial({ color: 0xb5443a });
        ROOM.pads.push({ key: rail[i], x: px, z: pz, cap: cap });
        padLabel(grp, rail[i], px, 1.0, pz + 0.28, 0);
      }
      const panel = ["pardon", "fascism", "communism", "crown"];
      addBox(grp, tx, 1.35, z0 + T + 0.08, 4.8, 0.9, 0.12, STEEL);
      for (let i = 0; i < panel.length; i++) {
        const px = tx - 1.65 + i * 1.1, pz = z0 + T + 0.17;
        const cap = addBox(grp, px, 1.35, pz, 0.22, 0.22, 0.08, 0xb5443a);
        cap.material = new THREE.MeshLambertMaterial({ color: 0xb5443a });
        ROOM.pads.push({ key: panel[i], x: px, z: pz, cap: cap });
        padLabel(grp, panel[i], px, 1.58, pz + 0.02, 0);
      }
    } else {
      let tableRec = null;
      if (CBZ.furnish && CBZ.furnish.table) {
        try {
          tableRec = CBZ.furnish.table(tx, 0.18, tz, 0, {
            box: function (x, y, z, w, h, d, color) { return addBox(grp, x, y, z, w, h, d, color); },
            ox: 0, oz: 0, oy: 0, solid: false,
            len: 6.4, deep: 1.65, seats: 10, tone: "exec",
          });
        } catch (e) { tableRec = null; }
      }
      if (!tableRec) {
        addBox(grp, tx, 0.52, tz, 6.4, 0.68, 1.65, LEATHER);
        addBox(grp, tx, 0.89, tz, 6.55, 0.08, 1.80, TABLE);
      }
      ROOM.seats = tableRec && tableRec.seats ? tableRec.seats.length : 0;
      addCol(tx, tz, 6.4, 1.65, 0.18, 0.94);
      // A leather writing inset, bound briefing books and two red phones make
      // the table read as a place where people work, without pretending those
      // props are separate political systems.
      addBox(grp, tx, 0.935, tz, 4.55, 0.025, 0.78, LEATHER);
      for (const s of [-1, 1]) {
        addBox(grp, tx + s * 2.25, 0.97, tz, 0.48, 0.055, 0.34, PAPER);
        addBox(grp, tx + s * 2.78, 0.99, tz + 0.14, 0.34, 0.12, 0.22, 0x8f3434);
        addBox(grp, tx + s * 2.78, 1.075, tz + 0.14, 0.28, 0.07, 0.09, BRASS);
      }

      // The country's live state belongs on the far wall, readable by every
      // chair. It is not a duplicate glowing texture across the table top.
      addBox(grp, tx, 1.76, z1 - T - 0.07, 7.30, 2.18, 0.11, STEEL);
      addBox(grp, tx, 1.76, z1 - T - 0.145, 7.02, 1.90, 0.035, TRIM);
      const wallFace = new THREE.Mesh(new THREE.PlaneGeometry(6.78, 1.68), new THREE.MeshBasicMaterial({ map: ROOM.board.tex }));
      wallFace.position.set(tx, 1.76, z1 - T - 0.17); wallFace.rotation.y = Math.PI;
      grp.add(wallFace);

      // Two communications stations flank the main briefing screen. Their
      // screens, rack slots and handsets give the walls a specific purpose.
      let stationSeats = 0;
      for (const s of [-1, 1]) {
        const sx = tx + s * 4.75;
        addBox(grp, sx, 0.54, z1 - T - 0.45, 1.55, 0.72, 0.72, STEEL);
        addBox(grp, sx, 0.94, z1 - T - 0.45, 1.64, 0.08, 0.80, TRIM);
        addBox(grp, sx, 1.42, z1 - T - 0.26, 1.20, 0.70, 0.08, PADC);
        addBox(grp, sx, 1.43, z1 - T - 0.31, 1.02, 0.52, 0.025, 0x7ba2b8);
        for (let i = -1; i <= 1; i++) addBox(grp, sx + i * 0.38, 0.65, z1 - T - 0.86, 0.22, 0.05, 0.12, i === 0 ? BRASS : PADC);
        addCol(sx, z1 - T - 0.45, 1.55, 0.72, 0, 1.02);
        // Each communications console is a station someone can actually sit
        // at, using the same shared seat grammar as the command table.
        if (CBZ.furnish && CBZ.furnish.chair) {
          try {
            const cr = CBZ.furnish.chair(sx, 0.18, z1 - T - 1.42, 0, {
              box: function (x, y, z, w, h, d, color) { return addBox(grp, x, y, z, w, h, d, color); },
              ox: 0, oz: 0, oy: 0, solid: false, tone: "exec",
            });
            stationSeats += cr && cr.seats ? cr.seats.length : 0;
          } catch (e) {}
        }
      }
      ROOM.seats += stationSeats;

      // Acoustic panels give the otherwise blank secure wall a deliberate
      // material rhythm. They are wall treatment, not another prop row.
      for (const px of [tx - 3.1, tx, tx + 3.1]) {
        addBox(grp, px, 1.82, z0 + T + 0.08, 2.35, 1.22, 0.06, NAVY);
        addBox(grp, px, 1.82, z0 + T + 0.115, 2.05, 0.92, 0.025, CARPET);
      }

      // The orders are compact physical keys on the two writing rails. Their
      // unique materials let paintBoard show live state without recolouring a
      // shared material bucket elsewhere in the city.
      const front = ["address", "emergency", "crackdown", "wall", "bureau"];
      for (let i = 0; i < front.length; i++) {
        const px = tx - 2.40 + i * 1.20, pz = tz - 0.70;
        addBox(grp, px, 0.97, pz, 0.72, 0.07, 0.36, PADC);
        const cap = addBox(grp, px, 1.035, pz, 0.20, 0.06, 0.16, 0xb5443a);
        cap.material = new THREE.MeshLambertMaterial({ color: 0xb5443a });
        ROOM.pads.push({ key: front[i], x: px, z: pz, cap: cap });
        padLabel(grp, front[i], px, 1.005, pz - 0.30, Math.PI);
      }
      const rear = ["pardon", "fascism", "communism", "crown"];
      for (let i = 0; i < rear.length; i++) {
        const px = tx - 1.80 + i * 1.20, pz = tz + 0.70;
        addBox(grp, px, 0.97, pz, 0.76, 0.07, 0.36, PADC);
        const cap = addBox(grp, px, 1.035, pz, 0.20, 0.06, 0.16, 0xb5443a);
        cap.material = new THREE.MeshLambertMaterial({ color: 0xb5443a });
        ROOM.pads.push({ key: rear[i], x: px, z: pz, cap: cap });
        padLabel(grp, rear[i], px, 1.005, pz + 0.30, 0);
      }

      // Paired standards and an inset seal terminate the room. They are wall-
      // attached state symbols, never another row of loose floor props.
      for (const s of [-1, 1]) {
        const fx = tx + s * 5.10;
        addBox(grp, fx, 1.48, z0 + T + 0.10, 0.06, 2.62, 0.06, BRASS);
        addBox(grp, fx - s * 0.22, 1.94, z0 + T + 0.16, 0.50, 0.92, 0.06, s < 0 ? 0x2f4f86 : 0x8f3434);
      }
      const seal = addCylinder(grp, tx, 1.86, z0 + T + 0.10, 0.48, 0.48, 0.06, BRASS, 24);
      seal.rotation.x = Math.PI / 2;
      ROOM.stateSymbols += 3;
      // Recessed warm strips establish a ceiling rhythm without spawning
      // point lights or adding an unrelated decorative object to the floor.
      for (const lx of [-3.4, 0, 3.4]) addBox(grp, tx + lx, 2.83, tz, 1.75, 0.05, 0.18, 0xffe6b0);
    }
    ROOM.builtFor = CBZ.govComplexes;
    wireZones();
    wireOfficeZones();
    paintBoard();
    return true;
  }
  const PAD_NAMES = {
    address: "ADDRESS", emergency: "EMERGENCY", crackdown: "CRACKDOWN",
    wall: "THE WALL", bureau: "BUREAU", pardon: "PARDON",
    fascism: "ONE STATE", communism: "THE MARKET", crown: "THE CROWN",
  };
  function padLabel(grp, key, x, y, z, yaw) {
    const t = canvasTexLive(128, 40);
    t.cc.fillStyle = "#0d1117"; t.cc.fillRect(0, 0, 128, 40);
    t.cc.fillStyle = "#c8d4e4"; t.cc.font = "bold 15px monospace"; t.cc.textAlign = "center";
    t.cc.fillText(PAD_NAMES[key] || key.toUpperCase(), 64, 26); t.paint();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.14), new THREE.MeshBasicMaterial({ map: t.tex }));
    m.position.set(x, y, z); m.rotation.x = -Math.PI / 2.6; m.rotation.y = yaw || 0;
    grp.add(m);
  }
  function inRoom(x, z) {
    const r = ROOM.rect;
    return !!(r && x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  }

  // ============================================================
  //  §3  THE BUTTONS — every one is a real order through an existing
  //  system, and live() READS BACK from that system. `moves` names the seam
  //  (statecraft's own audit discipline): a button that names none fails
  //  the audit.
  // ============================================================
  const BUTTONS = {
    address: {
      name: "Address the nation",
      moves: ["approval.js approvalShock", "w.politics.scandal (approval reads events - scandal*0.1)", "rec.treasury"],
      live: function () { return day() - (st().lastAddressDay || -999) < ADDRESS_COOLDOWN; },
      gate: function (h) {
        const since = day() - (st().lastAddressDay || -999);
        if (since < ADDRESS_COOLDOWN) return { ok: false, why: "You spoke " + since + " day(s) ago. The country is still digesting it." };
        if ((h.rec.treasury || 0) < ADDRESS_COST) return { ok: false, why: "Airtime costs " + money(ADDRESS_COST) + " and the treasury is short." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        payTreasury(h.rec, ADDRESS_COST);
        S.lastAddressDay = day();
        // THE SIGN IS READ OFF THE WORLD (statecraft's police-decree rule):
        // a country in crisis listens; a calm one shrugs.
        const murders = (CBZ.approvalState && CBZ.approvalState.murders7d) ? CBZ.approvalState.murders7d(h.id) : 0;
        const p = politics();
        const crisis = murders >= 5 || (p && (p.scandal || 0) > 40) || (p && (p.emergencyPowers || 0) > 40);
        shock(h.id, crisis ? 5 : 2);
        if (p && (p.scandal || 0) > 0) p.scandal = clamp((p.scandal || 0) - 6, 0, 100);
        news(h.title + " addresses the nation" + (crisis ? " from the Situation Room. The country was listening." : ". The country mostly was not."));
        return { ok: true, why: "" };
      },
    },
    emergency: {
      name: "Assume emergency powers",
      moves: ["statecraft decree('emergency') -> g.cityPolitics.emergencyPowers -> regimes.js ladder"],
      live: function () { const p = politics(); return !!(p && (p.emergencyPowers || 0) > 0); },
      gate: function () {
        if (!CBZ.gov || !CBZ.gov.decree) return { ok: false, why: "No statecraft loaded." };
        return { ok: true };
      },
      run: function () {
        const r = CBZ.gov.decree("emergency");
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "Refused." };
      },
    },
    crackdown: {
      name: "Order a crackdown",
      moves: ["militia.js crackdown (gang machinery: members released, turf freed)", "rec.treasury", "approvalShock via militia's own dip"],
      live: function () { return !!(CBZ.militia && CBZ.militia.list && CBZ.militia.list().length); },
      gate: function (h) {
        if (!CBZ.militia || !CBZ.militia.orderCrackdown) return { ok: false, why: "No militia machinery loaded." };
        const list = CBZ.militia.list ? CBZ.militia.list() : [];
        if (!list.length) return { ok: false, why: "No private army stands anywhere in the country." };
        // A CRACKDOWN NEEDS SOMEBODY WHO CAN CARRY IT OUT. The degrade-safe
        // guard is rankKnows, never a bare rankCan null-check: an undeclared
        // ladder stands the gate DOWN, an empty General's chair refuses.
        if (CBZ.rankKnows && CBZ.rankHolder && CBZ.rankKnows("army", "crackdown") && !CBZ.rankHolder("army", "crackdown")) {
          return { ok: false, why: "The General's chair is empty. An order needs somebody alive to carry it out." };
        }
        if ((h.rec.treasury || 0) < CRACKDOWN_COST) return { ok: false, why: "Mobilisation costs " + money(CRACKDOWN_COST) + "." };
        return { ok: true };
      },
      run: function (h) {
        const list = CBZ.militia.list();
        if (!list.length) return { ok: false, why: "Nothing left to break up." };
        payTreasury(h.rec, CRACKDOWN_COST);
        const r = CBZ.militia.orderCrackdown(list[0].gangId, { by: "president" });
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "The order did not go through." };
      },
    },
    wall: {
      name: "Build the wall",
      moves: ["construction.js stateWall: real segments + colliders", "rec.treasury per segment", "checkpoints via garrison _post", "cell supply runs (presidency tick reads stateWall.coverage)"],
      live: function () { const W = CBZ.stateWall; const s = W && W.status ? W.status() : null; return !!(s && s.ordered && !s.done); },
      gate: function () {
        if (!CBZ.stateWall || !CBZ.stateWall.order) return { ok: false, why: "No construction machinery loaded." };
        const s = CBZ.stateWall.status();
        if (s.done) return { ok: false, why: "The wall stands — " + s.built + " sections along the Saltlands line." };
        if (s.ordered) return { ok: false, why: "Under construction: " + s.built + "/" + s.total + " sections. Crews draw pay daily." };
        return { ok: true };
      },
      run: function (h) {
        const r = CBZ.stateWall.order(h.rec);
        if (!r.ok) return r;
        big("THE WALL — CONSTRUCTION BEGINS");
        news(h.title + " orders a border wall along the Saltlands frontier. " + r.total + " sections, paid daily out of the treasury.");
        return { ok: true, why: "" };
      },
    },
    bureau: {
      name: "Direct the Bureau",
      moves: ["real agents (cityPostNpc) at real cell members", "rec.treasury", "cityEvent('counterterror') -> extremists/police standings + emergencyPowers", "approvalShock", "cell roster deaths/arrests"],
      live: function () { return !!RAID.phase; },
      gate: function (h) {
        if (!CFG.PRESIDENCY_RAIDS) return { ok: false, why: "The Bureau is dark." };
        if (RAID.phase) return { ok: false, why: "A raid is already running (" + RAID.phase + ")." };
        if (!agencySite()) return { ok: false, why: "The Bureau built no headquarters this world." };
        const S = st();
        if (!S.intelKnown) return { ok: false, why: "No actionable intelligence yet. The cell has to surface once." };
        if (!livingCell().length) return { ok: false, why: "The Bureau's board is clear. The cell is broken." };
        if ((h.rec.treasury || 0) < RAID_COST) return { ok: false, why: "A raid costs " + money(RAID_COST) + "." };
        return { ok: true };
      },
      run: function (h) { return orderRaid(h); },
    },
    pardon: {
      name: "Sign a pardon",
      moves: ["statecraft pardon -> cityWantedReset/cityReduceWanted", "approvalShock", "tyranny"],
      live: function () { return (CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0)) > 0; },
      gate: function () {
        if (!CBZ.gov || !CBZ.gov.pardon) return { ok: false, why: "No statecraft loaded." };
        const stars = CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0);
        if (stars <= 0) return { ok: false, why: "There is nothing on you to pardon." };
        return { ok: true };
      },
      run: function () {
        const r = CBZ.gov.pardon();
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "Refused." };
      },
    },
    fascism: {
      name: "Proclaim: one state",
      moves: ["regimes.js declareDoctrine('fascism') -> govType read by 9 gates (police x1.3, heat x1.4, curfew, polwar, centralbank)"],
      live: function () { const r = seatRec(); return !!(r && r.govType === "fascism"); },
      gate: doctrineGate("fascism"),
      run: function (h) { return runDoctrine(h, "fascism"); },
    },
    communism: {
      name: "Proclaim: the state takes the market",
      moves: ["regimes.js declareDoctrine('communism') -> govType read by market.setControls price ceiling, stocks dividends, taxRate"],
      live: function () { const r = seatRec(); return !!(r && r.govType === "communism"); },
      gate: doctrineGate("communism"),
      run: function (h) { return runDoctrine(h, "communism"); },
    },
    crown: {
      name: "Take the crown",
      moves: ["crown.js selfCrown -> govType 'monarchy', a royal house with YOUR bloodline, relations insults from every other crown"],
      // only VISIBLE as a dictator — the categorical door. see zone find().
      live: function () { const r = seatRec(); return !!(r && r.govType === "monarchy"); },
      gate: function (h) {
        if (!CBZ.crown || !CBZ.crown.selfCrown) return { ok: false, why: "No crown machinery loaded." };
        if (h.rec.govType !== "dictatorship") return { ok: false, why: "Only a dictator crowns himself. The republic still has a word for this." };
        return { ok: true };
      },
      run: function (h) {
        const r = CBZ.crown.selfCrown(h.rec.id);
        return r && r.ok ? { ok: true, why: "" } : { ok: false, why: (r && r.why) || "The coronation did not happen." };
      },
    },
  };
  function doctrineGate(gov) {
    return function (h) {
      if (!CBZ.regimeDeclareDoctrine) return { ok: false, why: "No regime machinery loaded." };
      if (h.rec.govType === gov) return { ok: false, why: "Already proclaimed." };
      const p = politics();
      // a president needs EMERGENCY POWERS to get there — the same ladder
      // regimes' democracy->emergencyRule transition reads.
      if (!p || (p.emergencyPowers || 0) < DOCTRINE_EMERGENCY_MIN) {
        return { ok: false, why: "Emergency powers stand at " + Math.round((p && p.emergencyPowers) || 0) + "%. Below " + DOCTRINE_EMERGENCY_MIN + " the republic will not sign this." };
      }
      if (CBZ.regimeCanDeclare && !CBZ.regimeCanDeclare()) return { ok: false, why: "Not enough loyal people behind you to make it stick." };
      return { ok: true };
    };
  }
  function runDoctrine(h, gov) {
    const r = CBZ.regimeDeclareDoctrine(gov, { rec: h.rec });
    if (!r || !r.ok) return { ok: false, why: (r && r.reason) || "Refused." };
    return { ok: true, why: "" };
  }

  function pressButton(key) {
    if (!on()) return { ok: false, why: "Presidency is switched off." };
    const B = BUTTONS[key];
    if (!B) return { ok: false, why: "No such order." };
    const h = seat();
    if (!h) return { ok: false, why: "You do not hold the country." };
    const gt = B.gate(h);
    if (!gt.ok) { orders("Situation Room", gt.why, 1); paintBoard(); return gt; }
    let r;
    try { r = B.run(h); } catch (e) { r = { ok: false, why: "The order did not go through." }; }
    if (r && !r.ok && r.why) orders("Situation Room", r.why, 1);
    paintBoard();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return r || { ok: true, why: "" };
  }

  // The Cabinet folio and the two desk objects are published by the shared
  // room-program owner. These zones only bind those physical objects to the
  // SAME orders as the Situation Room; no office-only state is introduced.
  const OFFICE_PROP_KEYS = ["cabinet-bureau", "oval-address", "oval-pardon"];
  let officeZonesWired = false;
  let officeZoneCount = 0;
  function officeProp(key) {
    if (!CBZ.presidentInteriorProps) return null;
    let list = [];
    try { list = CBZ.presidentInteriorProps() || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return list[i];
    return null;
  }
  function wireOfficeZones() {
    if (officeZonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    officeZonesWired = true;
    OFFICE_PROP_KEYS.forEach(function (key) {
      CBZ.interactions.registerZone({
        id: "pres-office-" + key, kind: "presprop", radius: 1.75, prio: 14,
        find: function (px, pz) {
          if (!on() || CFG.PRESIDENT_COMPOUND_V2 === false) return null;
          const mine = officeProp(key);
          if (!mine) return null;
          const P = CBZ.player;
          if (P && P.pos && isFinite(P.pos.y) && isFinite(mine.y) && Math.abs(P.pos.y - mine.y) > 2.2) return null;
          let nearest = null, bestAll = Infinity;
          for (let i = 0; i < OFFICE_PROP_KEYS.length; i++) {
            const p = officeProp(OFFICE_PROP_KEYS[i]);
            if (!p) continue;
            const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
            if (d < bestAll) { bestAll = d; nearest = p.key; }
          }
          const d = (mine.x - px) * (mine.x - px) + (mine.z - pz) * (mine.z - pz);
          return d < 1.75 * 1.75 && nearest === key
            ? { x: mine.x, y: mine.y, z: mine.z, kind: "presprop", propKey: key }
            : null;
        },
        options: [{
          id: "pres-office-use-" + key, slot: "e",
          label: function () {
            const p = officeProp(key);
            const B = p && BUTTONS[p.order];
            const h = seat();
            if (!p || !B) return "Presidential order unavailable";
            if (!h) return p.label + " (not yours)";
            const gt = B.gate(h);
            return p.label + (gt.ok ? "" : " — " + gt.why);
          },
          onSelect: function () {
            const p = officeProp(key);
            if (p && BUTTONS[p.order]) pressButton(p.order);
          },
        }],
      });
      officeZoneCount++;
    });
    if (CBZ.interactions.describe) {
      try { CBZ.interactions.describe("presprop", function () { return { label: "Presidential desk", note: "a physical state order" }; }); } catch (e) {}
    }
  }

  // ---- the interaction zones: the door + one per pad ---------------------
  function wireZones() {
    if (ROOM.zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    ROOM.zonesWired = true;
    // the sealed door — VISIBLE to anyone; openable by one person in the
    // country. That asymmetry is the whole gradient.
    CBZ.interactions.registerZone({
      id: "pres-door", kind: "presdoor", radius: 2.6, prio: 12,
      find: function (px, pz) {
        if (!on() || !CFG.PRESIDENCY_SITROOM || !ROOM.doorPt) return null;
        const dx = ROOM.doorPt.x - px, dz = ROOM.doorPt.z - pz;
        return (dx * dx + dz * dz) < 2.6 * 2.6 ? { x: ROOM.doorPt.x, z: ROOM.doorPt.z, kind: "presdoor" } : null;
      },
      options: [{
        id: "pres-door-try", slot: "e",
        label: function () { return doorOpensFor() ? "Situation Room" : "Situation Room — sealed"; },
        onSelect: function () {
          if (doorOpensFor()) return; // the door is already sliding; walk in
          orders("Mansion Detail", "The steel door does not move. Two men in suits look through you. This room opens for one person in the country.", 0);
        },
      }],
    });
    // one zone per pad: find() only answers when this pad is the NEAREST.
    const keys = [];
    for (const k in BUTTONS) keys.push(k);
    keys.forEach(function (key) {
      CBZ.interactions.registerZone({
        id: "pres-pad-" + key, kind: "prespad", radius: 1.6, prio: 13,
        find: function (px, pz) {
          if (!on() || !CFG.PRESIDENCY_SITROOM || !ROOM.pads.length) return null;
          if (!inRoom(px, pz)) return null;
          // the crown pad exists only in a dictatorship — a button that
          // appears the day the category flips (the door grammar again).
          if (key === "crown") {
            const r = seatRec();
            if (!r || (r.govType !== "dictatorship" && r.govType !== "monarchy")) return null;
          }
          let mine = null, best = 1.6 * 1.6, bestAll = Infinity, nearestKey = null;
          for (let i = 0; i < ROOM.pads.length; i++) {
            const p = ROOM.pads[i];
            const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
            if (d < bestAll) { bestAll = d; nearestKey = p.key; }
            if (p.key === key && d < best) { best = d; mine = p; }
          }
          if (!mine || nearestKey !== key) return null;
          return { x: mine.x, z: mine.z, kind: "prespad" };
        },
        options: [{
          id: "pres-press-" + key, slot: "e",
          label: function () {
            const B = BUTTONS[key];
            const h = seat();
            if (!h) return B.name + " (not yours)";
            const gt = B.gate(h);
            return B.name + (gt.ok ? "" : " — " + gt.why);
          },
          onSelect: function () { pressButton(key); },
        }],
      });
    });
    if (CBZ.interactions.describe) {
      try {
        CBZ.interactions.describe("prespad", function () { return { label: "Situation Room console", note: "orders that move the country" }; });
        CBZ.interactions.describe("presdoor", function () { return { label: "Steel door", note: "the Situation Room" }; });
      } catch (e) {}
    }
  }

  // ---- the board — painted on events, never per frame --------------------
  function paintBoard() {
    const b = ROOM.board;
    if (!b) return;
    const h = seat();
    const rec = h ? h.rec : countryRecAny();
    const p = politics();
    // Each cap owns its material so this event-driven status pass can show a
    // live order in green, an available one in brass and a refused one in
    // muted red without recolouring any shared material elsewhere.
    for (let i = 0; i < ROOM.pads.length; i++) {
      const pad = ROOM.pads[i], B = BUTTONS[pad.key];
      if (!pad.cap || !pad.cap.material || !pad.cap.material.color || !B) continue;
      let active = false, ready = false;
      try { active = !!B.live(); } catch (e) {}
      if (h) { try { ready = !!B.gate(h).ok; } catch (e) {} }
      pad.cap.material.color.setHex(active ? 0x4fc487 : (ready ? BRASS : 0x873d3d));
    }
    const cc = b.cc;
    cc.fillStyle = "#0b1018"; cc.fillRect(0, 0, b.w, b.h);
    cc.strokeStyle = "#2c3a4e"; cc.lineWidth = 3; cc.strokeRect(6, 6, b.w - 12, b.h - 12);
    cc.fillStyle = "#8fc1ff"; cc.font = "bold 34px monospace"; cc.textAlign = "left";
    cc.fillText(rec ? String(rec.name).toUpperCase() + " — " + String(rec.govType || "").toUpperCase() : "NO COUNTRY", 28, 52);
    cc.font = "24px monospace"; cc.fillStyle = "#d8e2f2";
    const S = st();
    const W = CBZ.stateWall && CBZ.stateWall.status ? CBZ.stateWall.status() : null;
    const lines = [
      "TREASURY   " + money(rec ? rec.treasury || 0 : 0),
      "APPROVAL   " + Math.round(rec ? rec.approval || 0 : 0) + "%    TYRANNY " + Math.round(CBZ.gov && CBZ.gov.tyranny ? CBZ.gov.tyranny() : 0),
      "EMERGENCY  " + Math.round((p && p.emergencyPowers) || 0) + "%  (100 = the republic ends)",
      "THREAT     " + (CFG.PRESIDENCY_TERROR ? (livingCell().length + " known members · supply " + S.supply + (S.intelKnown ? " · safehouse marked" : " · no intel")) : "quiet"),
      "THE WALL   " + (W ? (W.ordered ? W.built + "/" + W.total + " sections · " + (W.manned ? "gaps manned" : "gaps open") + (W.breaches ? " · " + W.breaches + " breached" : "") : "not ordered") : "no machinery"),
      "BUREAU     " + (RAID.phase ? ("raid " + RAID.phase) : (S.raidsOrdered ? S.raidsWon + " won / " + S.raidsLost + " lost" : "standing by")),
    ];
    for (let i = 0; i < lines.length; i++) cc.fillText(lines[i], 28, 104 + i * 40);
    cc.fillStyle = "#5f708a"; cc.font = "20px monospace";
    cc.fillText("DAY " + day() + (h ? "  ·  TERM ENDS " + (h.rec.office && h.rec.office.termDay != null ? "DAY " + h.rec.office.termDay : "—") : "  ·  YOU DO NOT HOLD THE SEAT"), 28, b.h - 28);
    b.paint();
  }

  // ============================================================
  //  §4  THE CELL — the sand city's terrorist org.
  // ============================================================
  const CELL_ID = "cell";
  let _cellDeclared = false;
  function declareCell() {
    if (_cellDeclared || !CFG.PRESIDENCY_TERROR) return _cellDeclared;
    if (!CBZ.factions || !CBZ.factions.declare) return false;
    if (CBZ.factions.exists && CBZ.factions.exists(CELL_ID)) { _cellDeclared = true; return true; }
    try {
      CBZ.factions.declare({
        id: CELL_ID, name: "Sons of the Dune", short: "SotD", kind: "cell",
        color: 0xc2652a, wage: 0, heat: 2.2,
        // militia.js's hostileTo:["cell"] and admission test were written
        // against this id before it existed — declaring it turns those
        // gates live. The army and the Bureau hate them back.
        hostileTo: ["police", "army", "agency"],
        // EVERY RUNG IS A VERB (the law, applied to the enemy): a Runner
        // moves supply across the frontier, a Bomber can be the one who
        // walks into the market, the Emir schedules — no living holder of
        // "attack" means no attacks (see tickCellDay), which is what makes
        // decapitation a strategy instead of a stat.
        ranks: [
          { key: "sympathizer", pip: "Sympathizer" },
          { key: "runner", pip: "Runner", grants: ["resupply"] },
          { key: "bomber", pip: "Bomber", grants: ["attack"] },
          { key: "emir", pip: "Emir", locked: true, grants: ["attack", "plan"] },
        ],
        // an embodied member's rank lives on the ped, never mirrored here
        rankField: "_cellRank",
        npcTag: { field: "organization", value: "cell" },
        admission: { test: function () { return "They do not take outsiders. Least of all you."; } },
        lore: "An insurgent cell out of the Saltlands. Their supply walks across the frontier at night.",
      });
      _cellDeclared = true;
    } catch (e) { _cellDeclared = false; }
    return _cellDeclared;
  }
  // ROSTER — real ledger identities (officials.js's mintIdentity shape via
  // cityPedStash: parked pages, nameKnown, real names off the seeded
  // stream). The roster is what the Bureau board counts, what a raid kills
  // or arrests, and what rank-liveness is asked of.
  const ROSTER_RANKS = ["emir", "bomber", "bomber", "runner", "runner", "runner", "sympathizer", "sympathizer", "sympathizer"];
  function seedRoster() {
    const S = st();
    if (S.rosterSeeded || !CFG.PRESIDENCY_TERROR || !CBZ.cityPedStash) return;
    const stream = CBZ.seedStream ? CBZ.seedStream("presidency:cell") : rng;
    for (let i = 0; i < CELL_ROSTER; i++) {
      const gender = stream() < 0.7 ? "m" : "f";
      const name = CBZ.cityMintName ? CBZ.cityMintName(stream, gender) : ("Cell Member " + (i + 1));
      const obj = {
        _parked: true, nameKnown: true, kind: "civilian", archetype: "thug",
        name: name, gender: gender, job: "quarry worker", wealth: 0.2, aggr: 0.85,
        cash: 40 + Math.round(stream() * 200),
      };
      try { CBZ.cityPedStash(obj); } catch (e) {}
      S.roster.push({ sid: obj._sid || ("cell_" + i), name: name, rank: ROSTER_RANKS[i] || "sympathizer", dead: false, held: false });
    }
    S.rosterSeeded = true;
  }
  function livingCell() {
    const S = st(); const out = [];
    for (let i = 0; i < S.roster.length; i++) { const m = S.roster[i]; if (m && !m.dead && !m.held) out.push(m); }
    return out;
  }
  function cellCanAttack() {
    const live = livingCell();
    for (let i = 0; i < live.length; i++) if (live[i].rank === "bomber" || live[i].rank === "emir") return true;
    return false;
  }
  function cellCanRun() {
    const live = livingCell();
    for (let i = 0; i < live.length; i++) if (live[i].rank === "runner" || live[i].rank === "emir") return true;
    return false;
  }

  // ---- the Saltlands + safehouses ---------------------------------------
  function saltlandsRegion() {
    const regs = (CBZ.city && CBZ.city.regions) || [];
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (r && r.name === "The Saltlands" && r.minX != null) return r;
    }
    return null;
  }
  let _safehouses = null;
  function safehouses() {
    if (_safehouses && _safehouses.length) return _safehouses;
    const R = saltlandsRegion();
    const A = CBZ.city && CBZ.city.arena;
    if (!R || !A) return [];
    const cands = [];
    const lots = (A.lots || []).concat(A.shopLots || []);
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.cx == null || !l.building) continue;
      if (l.cx < R.minX || l.cx > R.maxX || l.cz < R.minZ || l.cz > R.maxZ) continue;
      cands.push(l);
    }
    if (!cands.length) return [];
    // deterministic pick — position hash, stable per seed
    cands.sort(function (a, b) { return h01(a.cx, a.cz, 0x7e11) - h01(b.cx, b.cz, 0x7e11); });
    _safehouses = cands.slice(0, Math.min(2, cands.length));
    return _safehouses;
  }
  // occupy the nearest safehouse with real bodies while the player is close
  // enough to meet them. occupy.js is the ONE NPC-in-building path (the
  // spawner ratchet stays where it was); the stamp pass below tags the cast
  // as cell members so factions.of()/reactionTo() answer for free.
  const OCC = { done: {}, arena: null };
  function embodySafehouses() {
    if (!CFG.PRESIDENCY_TERROR || !CBZ.cityOccupyBuilding) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    // a rebuilt arena rebuilds its lots — drop every cached claim with it
    const A = CBZ.city && CBZ.city.arena;
    if (OCC.arena !== A) { OCC.arena = A; OCC.done = {}; _safehouses = null; }
    const list = safehouses();
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const key = Math.round(l.cx) + ":" + Math.round(l.cz);
      const d = Math.hypot(l.cx - P.pos.x, l.cz - P.pos.z);
      if (d > 220 || OCC.done[key]) continue;
      let rec = null;
      try {
        rec = CBZ.cityOccupyBuilding(l, {
          id: "pres:cell:" + key, faction: CELL_ID, access: "private", crime: "trespass",
          floors: [{ level: 0, role: "soldier", count: 2, program: "quarters", access: "private" }],
        });
      } catch (e) { rec = null; }
      if (rec) OCC.done[key] = rec;
    }
    // stamp pass: occupy casts incrementally, so tag whatever has landed
    for (const key in OCC.done) {
      const rec = OCC.done[key];
      if (!rec || !rec.peds) continue;
      for (let i = 0; i < rec.peds.length; i++) {
        const p = rec.peds[i];
        if (!p || p._cellRank) continue;
        p.organization = "cell";
        p._cellRank = i === 0 ? "bomber" : "runner";
        p.job = "quarry worker";
      }
    }
  }

  // ---- SUPPLY — runs that cross the frontier, and the wall's whole point.
  // MECHANISM (stated for the audit): each day the cell fields up to two
  // resupply runs if a Runner/Emir lives. Each run must cross the Saltlands
  // frontier; CBZ.stateWall.coverage() is the fraction of that line standing
  // AND manned, and a run is intercepted with exactly that probability
  // (hash01(day, run) — deterministic). Attacks cost CELL_SUPPLY_PER_ATTACK;
  // starve the runs and the cadence dies. Sabotage (blown segments) lowers
  // coverage, which is why the cell bombs the wall back.
  function tickCellDay(d) {
    if (!on() || !CFG.PRESIDENCY_TERROR) return;
    const S = st();
    seedRoster();
    if (!livingCell().length) return;                  // broken orgs stay broken
    const W = CBZ.stateWall;
    const coverage = (W && W.coverage) ? W.coverage() : 0;
    if (cellCanRun()) {
      for (let r = 0; r < 2; r++) {
        if (S.supply >= CELL_MAX_SUPPLY) break;
        const blocked = h01(d, r + 1, 0x5a17) < coverage;
        if (blocked) {
          S.runsBlocked++;
          if (r === 0) news("Border guards turn back a smuggling run at the Saltlands wall.");
        } else {
          S.runsThrough++;
          S.supply = clamp(S.supply + 1, 0, CELL_MAX_SUPPLY);
        }
      }
    }
    // schedule an attack: needs a living attacker, supply, and a gap
    if (cellCanAttack() && S.supply >= CELL_SUPPLY_PER_ATTACK && d - S.lastAttackDay >= ATTACK_MIN_GAP_DAYS) {
      if (h01(d, 77, 0x5a18) < 0.6) armAttack(d);
    }
  }

  // ---- ATTACKS — staged on real bodies when you are there; a reported
  // world event when you are not. Either way the numbers moved are real.
  const ATT = { armed: null };
  function attackTarget() {
    // the market: Dry Gulch's centre; the highway spine z is published
    const R = saltlandsRegion();
    if (!R) return null;
    const cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
    const z = (CBZ.DESERT_HWY_Z != null) ? CBZ.DESERT_HWY_Z : cz - 40;
    return { x: cx + 30, z: z, name: "the Dry Gulch market" };
  }
  function armAttack(d) {
    const S = st();
    const t = attackTarget();
    if (!t) return;
    S.supply -= CELL_SUPPLY_PER_ATTACK;
    S.lastAttackDay = d;
    ATT.armed = { at: t, t: 0 };
  }
  function stageAttackReal(t) {
    // a REAL attacker: prefer a live embodied cell body; else cast ONE at the
    // safehouse door through the sanctioned atom. The brain is aigoals'
    // rampage — no AI written here.
    let ped = null;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p && !p.dead && p.organization === "cell") { ped = p; break; }
    }
    if (!ped && CBZ.cityPostNpc) {
      const sh = safehouses()[0];
      const sx = sh ? sh.cx : t.x + 26, sz = sh ? sh.cz : t.z + 26;
      ped = CBZ.cityPostNpc(sx, sz, { job: "terror attacker", archetype: "thug", armed: true, weapon: "AK-47", aggr: 0.98 });
      if (ped) { ped.organization = "cell"; ped._cellRank = "bomber"; }
    }
    if (!ped) return false;
    ped.ammo = Math.max(ped.ammo || 0, 90);
    if (!ped.armed) { ped.armed = true; ped.weapon = "AK-47"; if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} } }
    let ok = false;
    if (CBZ.cityStartRampage) { try { ok = !!CBZ.cityStartRampage(ped); } catch (e) { ok = false; } }
    if (!ok) {
      ped.rampage = true; ped.aggr = 0.98;
      if (CBZ.cityNpcOffense) { try { CBZ.cityNpcOffense(ped, 90, "terror attack"); } catch (e) {} }
      if ((ped.npcWanted | 0) < 3) ped.npcWanted = 3;
    }
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(t.x, t.z, 1.6); } catch (e) {} }
    return true;
  }
  function resolveAttack(realStaged) {
    const S = st();
    const h = seat();
    const recId = h ? h.id : (countryRecAny() ? countryRecAny().id : null);
    S.attacksDone++;
    S.intelKnown = true;                                // the cell surfaced; the Bureau has a thread
    if (CBZ.cityEvent) { try { CBZ.cityEvent("terror-threat", { panic: 8, emergency: 6, confidence: -3 }); } catch (e) {} }
    if (recId) shock(recId, ATTACK_APPROVAL);
    big("ATTACK IN THE SALTLANDS");
    news(realStaged
      ? "Gunfire at the Dry Gulch market — the Sons of the Dune claim the attack."
      : "A bomb tears through the Dry Gulch market. The Sons of the Dune claim it; the count is still coming in.");
    paintBoard();
  }
  function tickAttack(dt) {
    const A = ATT.armed;
    if (!A) return;
    A.t += dt;
    const P = CBZ.player;
    const near = P && P.pos && Math.hypot(P.pos.x - A.at.x, P.pos.z - A.at.z) < ATTACK_NEAR;
    if (near) {
      ATT.armed = null;
      const staged = stageAttackReal(A.at);
      resolveAttack(staged);
      return;
    }
    if (A.t > 60) {                                     // far away: the world event happens without you
      ATT.armed = null;
      resolveAttack(false);
    }
  }

  // ============================================================
  //  §5  THE BUREAU RAID — order real NPCs at real NPCs.
  // ============================================================
  const RAID = { phase: null, t: 0, agents: [], car: null, target: null, engaged: false };
  function orderRaid(h) {
    const S = st();
    const site = agencySite();
    const sh = safehouses()[0];
    if (!site || !sh) return { ok: false, why: "No target on the board." };
    if (!payTreasury(h.rec, RAID_COST)) return { ok: false, why: "The treasury would not cover it." };
    S.raidsOrdered++;
    RAID.phase = "muster"; RAID.t = 0; RAID.agents = []; RAID.car = null; RAID.engaged = false;
    RAID.target = { x: sh.cx, z: sh.cz, lot: sh };
    // real agents at the Bureau's own gate, through occupy's atom. They are
    // real bodies: shootable, arrestable, stealable-car-and-all.
    const gx = site.gate ? site.gate.x : site.cx, gz = site.gate ? site.gate.z : site.cz;
    for (let i = 0; i < RAID_AGENTS; i++) {
      let a = null;
      if (CBZ.cityPostNpc) {
        a = CBZ.cityPostNpc(gx + (i - 1) * 1.6, gz + 2.2, {
          job: "bureau agent", archetype: "agent", armed: true, weapon: "SMG", ammo: 120, aggr: 0.8, hp: 130,
        });
      }
      if (a) { a.organization = "agency"; a._presRaid = true; RAID.agents.push(a); }
    }
    if (!RAID.agents.length) { RAID.phase = null; return { ok: false, why: "The Bureau could not field a team." }; }
    // their car — a real vehicle beside them (checkpoints.js's cruiser rule:
    // never a prop). Black, unmarked, stealable.
    if (CBZ.cityMakeCar) {
      try {
        RAID.car = CBZ.cityMakeCar(gx + 6, gz + 4, 0, false, null, 0);
        if (RAID.car) { RAID.car.ai = false; RAID.car.v = 0; RAID.car.parked = true; RAID.car.road = null; }
      } catch (e) { RAID.car = null; }
    }
    orders("Bureau Director", "Team of " + RAID.agents.length + " rolling on the Saltlands safehouse in " + RAID_MUSTER_SEC + "s. Ride along or watch the wire.", 2);
    news("Bureau vehicles seen leaving headquarters at speed.");
    return { ok: true, why: "" };
  }
  function raidCasualties() {
    let dead = 0;
    for (let i = 0; i < RAID.agents.length; i++) if (!RAID.agents[i] || RAID.agents[i].dead) dead++;
    return dead;
  }
  function finishRaid(won, embodied) {
    const S = st();
    const h = seat();
    const recId = h ? h.id : (countryRecAny() ? countryRecAny().id : null);
    if (won) {
      S.raidsWon++;
      // the roster pays in people: bombers and runners first (the Bureau
      // goes in for the shooters), one in three taken alive.
      const live = livingCell();
      let hit = Math.min(live.length, 2 + ((h01(day(), S.raidsOrdered, 0x9b31) * 2) | 0));
      live.sort(function (a, b) { return (b.rank === "emir" ? 3 : b.rank === "bomber" ? 2 : b.rank === "runner" ? 1 : 0) - (a.rank === "emir" ? 3 : a.rank === "bomber" ? 2 : a.rank === "runner" ? 1 : 0); });
      let killed = 0, held = 0;
      for (let i = 0; i < hit; i++) {
        const m = live[i];
        if (h01(i, S.raidsOrdered, 0x9b32) < 0.34) { m.held = true; held++; }
        else {
          m.dead = true; killed++;
          if (CBZ.cityLogDeath) { try { CBZ.cityLogDeath(m.name, "shot", { by: "Bureau tactical" }); } catch (e) {} }
        }
      }
      if (CBZ.cityEvent) { try { CBZ.cityEvent("counterterror", {}); } catch (e) {} }
      if (recId) shock(recId, RAID_WIN_APPROVAL);
      big("SAFEHOUSE TAKEN");
      news("Bureau raid in the Saltlands: " + killed + " cell member(s) dead, " + held + " in custody" + (raidCasualties() ? ", " + raidCasualties() + " agent(s) lost." : "."));
      if (!livingCell().length) { big("THE CELL IS BROKEN"); news("The Sons of the Dune are finished — the board is clear."); }
    } else {
      S.raidsLost++;
      if (recId) shock(recId, RAID_LOSS_APPROVAL);
      news("Bureau raid repelled at the Saltlands safehouse — " + raidCasualties() + " agent(s) down. The cell is emboldened.");
      if (CBZ.cityEvent) { try { CBZ.cityEvent("terror-threat", { panic: 3 }); } catch (e) {} }
    }
    // walk survivors home (their post is done); the dead stay where they fell
    for (let i = 0; i < RAID.agents.length; i++) {
      const a = RAID.agents[i];
      if (a && !a.dead) { a.guard = null; a._presRaid = false; if (a.staffPost) a.staffPost = null; }
    }
    RAID.phase = null; RAID.agents = []; RAID.car = null; RAID.target = null;
    paintBoard();
    void embodied;
  }
  function tickRaid(dt) {
    if (!RAID.phase) return;
    RAID.t += dt;
    const P = CBZ.player;
    const near = P && P.pos && RAID.target && Math.hypot(P.pos.x - RAID.target.x, P.pos.z - RAID.target.z) < ATTACK_NEAR;
    if (RAID.phase === "muster") {
      if (RAID.t >= RAID_MUSTER_SEC) {
        RAID.phase = "breach"; RAID.t = 0;
        if (near) {
          // EMBODIED: the team appears on the approach (they drove — the
          // sealed-transit convention every transport in this repo uses),
          // then walks the last stretch on the ped brain's own guard field.
          embodySafehouses();
          for (let i = 0; i < RAID.agents.length; i++) {
            const a = RAID.agents[i];
            if (!a || a.dead || !a.pos) continue;
            const ang = (i / RAID.agents.length) * Math.PI * 2;
            a.pos.x = RAID.target.x + Math.cos(ang) * 26;
            a.pos.z = RAID.target.z + Math.sin(ang) * 26;
            if (a.group) a.group.position.set(a.pos.x, a.pos.y || 0, a.pos.z);
            a.staffPost = null; a.state = "walk"; a.speed = 0;
            a.guard = { x: RAID.target.x, z: RAID.target.z };
            if (a.target && a.target.set) a.target.set(RAID.target.x, 0, RAID.target.z);
          }
          feed("The Bureau team is on the ground.", "#8fc1ff");
        }
      }
      return;
    }
    if (RAID.phase === "breach") {
      if (near && !RAID.engaged) {
        RAID.engaged = true;
        // the breach: agents rage on the cell bodies, the cell's own brain
        // fights back — the exact guard/rage/state trio the alarm machinery
        // already writes. No new combat code.
        const peds = CBZ.cityPeds || [];
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || p.organization !== "cell" || !p.pos) continue;
          if (Math.hypot(p.pos.x - RAID.target.x, p.pos.z - RAID.target.z) > 40) continue;
          p.alarmed = true; p.state = "fight";
          const a = RAID.agents[i % RAID.agents.length];
          if (a && !a.dead) { p.rage = a; a.rage = p; a.state = "fight"; a.guard = null; }
        }
      }
      if (RAID.engaged) {
        // resolved when one side is done
        let cellLeft = 0;
        const peds = CBZ.cityPeds || [];
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (p && !p.dead && p.organization === "cell" && p.pos &&
              Math.hypot(p.pos.x - RAID.target.x, p.pos.z - RAID.target.z) < 46 && !p.surrender) cellLeft++;
        }
        const agentsLeft = RAID.agents.length - raidCasualties();
        if (RAID.t > 8 && (cellLeft === 0 || agentsLeft === 0)) finishRaid(cellLeft === 0 && agentsLeft > 0, true);
        else if (RAID.t > 180) finishRaid(agentsLeft > 0, true);
        return;
      }
      if (RAID.t >= RAID_ABSTRACT_SEC) {
        // you stayed away — it happens on the wire. The roll is against the
        // REAL sides: agents fielded vs living shooters.
        const shooters = livingCell().filter(function (m) { return m.rank !== "sympathizer"; }).length;
        const agentsLeft = RAID.agents.length - raidCasualties();
        const p = clamp(0.5 + 0.14 * (agentsLeft - shooters), 0.15, 0.9);
        const won = h01(day(), st().raidsOrdered, 0x9b30) < p;
        if (!won) {
          // losses on the abstract branch are real bodies too
          for (let i = 0; i < RAID.agents.length && i < 2; i++) {
            const a = RAID.agents[i];
            if (a && !a.dead && CBZ.cityKillPed) { try { CBZ.cityKillPed(a, { fatal: true }, "shot"); } catch (e) {} }
          }
        }
        finishRaid(won, false);
      }
    }
  }

  // ============================================================
  //  §6  THE FALLS — impeachment (scandal/approval), and the junta's knock
  //  after a coup. Both end in games/jail.js's own transport pipe.
  // ============================================================
  function arrestNow(why, title) {
    const S = st();
    S.arrestArmed = false;
    g._jailSentenceIn = JAIL_SENTENCE_SEC;
    g._jailBailIn = JAIL_BAIL;
    const go = function () {
      if (CBZ.cityArrestToPrison) { try { CBZ.cityArrestToPrison(); return; } catch (e) {} }
      if (CBZ.setMode) CBZ.setMode("escape");
      if (CBZ.setRole) CBZ.setRole("inmate");
      if (CBZ.startRun) CBZ.startRun();
    };
    big(title || "UNDER ARREST");
    if (CBZ.cityBustOverlay) { try { CBZ.cityBustOverlay(0, go, { title: title || "ARRESTED", note: why }); return; } catch (e) {} }
    go();
  }
  function inCountry(rec) {
    const P = CBZ.player;
    if (!P || !P.pos || !CBZ.polity || !CBZ.polity.of) return true;
    const loc = CBZ.polity.of(P.pos.x, P.pos.z);
    const c = loc && CBZ.polity.countryOf ? CBZ.polity.countryOf(loc.id) : null;
    return !!(c && rec && c.id === rec.id);
  }
  function tickFallsDay(d) {
    if (!on() || !CFG.PRESIDENCY_FALLS) return;
    const S = st();
    const h = seat();
    if (h) {
      S.wasPresident = true;
      S.lastSeatId = h.id;
      const p = politics();
      const scandal = (p && p.scandal) || 0;
      const approval = h.rec.approval || 0;
      const bad = scandal >= IMPEACH_SCANDAL || (approval < IMPEACH_APPROVAL && scandal >= IMPEACH_SCANDAL_LO);
      if (bad && S.impeachDay == null) {
        S.impeachDay = d + 2;
        big("ARTICLES OF IMPEACHMENT FILED");
        orders("Chief of Staff", "The Capitol has the votes and the auditors have the ledgers. Two days. Bury the scandal or start packing.", 2);
      } else if (S.impeachDay != null && !bad) {
        S.impeachDay = null;
        news("The impeachment collapses — the scandal went quiet before the vote.");
      } else if (S.impeachDay != null && d >= S.impeachDay) {
        // CONVICTED. The seat moves through the record's own fields (the
        // same holder/vacuum bookkeeping regimes' restoration writes), the
        // stand-down is statecraft's own holds()-went-null sweeper, and the
        // snap election is elections.js's own vacuum path.
        S.impeachDay = null; S.impeached = true;
        const rec = h.rec;
        rec.office.holder = rec.office.deputy || null;
        rec.office.deputy = null;
        rec.vacuum = d;
        big("CONVICTED — REMOVED FROM OFFICE");
        news("The Senate convicts. The presidency is stripped; the marshals have a warrant.");
        S.arrestArmed = true; S.arrestT = 0; S.arrestWhy = "Corruption in office";
        orders("Marshals Service", "You have " + ARREST_GRACE_SEC + " seconds to surrender at the Mansion. Cross the border and you are a fugitive instead.", 2);
      }
    } else if (S.wasPresident && S.lastSeatId && CBZ.polity && CBZ.polity.get) {
      // THE JUNTA'S KNOCK — civilwar's coup stamped a "junta general" onto
      // the seat you held. Deposed presidents get arrested or get out.
      const rec = CBZ.polity.get(S.lastSeatId);
      const holderSid = rec && rec.office ? rec.office.holder : null;
      if (rec && holderSid && !S.arrestArmed && !S.impeached) {
        const e = CBZ.cityLedgerEntry ? CBZ.cityLedgerEntry(holderSid) : null;
        if (e && /junta|dictator/.test(String(e.job || ""))) {
          S.wasPresident = false;
          S.arrestArmed = true; S.arrestT = 0; S.arrestWhy = "Enemies of the junta";
          big("THE JUNTA COMES FOR YOU");
          orders("A voice you know", "They are already moving. Get out of the country or disappear into a cell.", 2);
        }
      }
    }
  }
  function tickArrest(dt) {
    const S = st();
    if (!S.arrestArmed) return;
    S.arrestT += dt;
    const rec = S.lastSeatId && CBZ.polity && CBZ.polity.get ? CBZ.polity.get(S.lastSeatId) : null;
    if (S.arrestT >= ARREST_GRACE_SEC) {
      if (inCountry(rec)) { arrestNow(S.arrestWhy || "Removed from office", S.impeached ? "IMPEACHED" : "TAKEN"); }
      else {
        // you ran — the manhunt is the price of freedom, through wanted.js
        S.arrestArmed = false;
        if (CBZ.cityAddStars) { try { CBZ.cityAddStars(4, "Fugitive head of state"); } catch (e) {} }
        news("The warrant stands. The ex-president is a fugitive.");
      }
    }
  }

  // ============================================================
  //  §7  THE TICKS — one update slot, throttled inside; one day tick.
  // ============================================================
  let doorT = 0, embodyT = 0, boardT = 0;
  // 38.78 — free (38.7 is a shared band, 38.72 officialdom, 38.74 govcomplex,
  // 38.76 cashstore, 38.8 empire; measured by grep before claiming).
  if (CBZ.onUpdate) CBZ.onUpdate(38.78, function (dt) {
    if (!on() || !g || g.mode !== "city") return;
    // build lazily once the govcomplex site exists (worldgen order)
    if (CFG.PRESIDENCY_SITROOM && (!ROOM.group || ROOM.builtFor !== CBZ.govComplexes)) buildRoom();
    // interactions.js parses after this file in some entry paths. Retry the
    // two idempotent registrations even when the room itself is already built.
    wireZones();
    wireOfficeZones();
    declareCell();
    // the door — slides for the sitting head of state, seals behind anyone
    // else. The collider IS the lock; there is no invisible wall.
    doorT -= dt;
    if (ROOM.door && doorT <= 0) {
      doorT = 0.12;
      const P = CBZ.player;
      const nearDoor = P && P.pos && ROOM.doorPt && Math.hypot(P.pos.x - ROOM.doorPt.x, P.pos.z - ROOM.doorPt.z) < 3.4;
      const inside = P && P.pos && inRoom(P.pos.x, P.pos.z);
      // the door always opens from the INSIDE (a push bar, not a cell) —
      // losing the seat while standing at the table must never trap you.
      const want = (inside || (nearDoor && doorOpensFor())) ? 1 : 0;
      if (want !== ROOM.doorOpen) {
        ROOM.doorOpen = want;
        ROOM.door.position.z = ROOM.doorHome.z + (want ? 2.25 : 0);
        const ci = CBZ.colliders.indexOf(ROOM.doorCol);
        if (want && ci >= 0) CBZ.colliders.splice(ci, 1);
        else if (!want && ci < 0) CBZ.colliders.push(ROOM.doorCol);
        if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
      }
      // repaint the board while somebody is in the room (1s cadence)
      boardT -= 0.12;
      if (inside && boardT <= 0) { boardT = 1.0; paintBoard(); }
    }
    embodyT -= dt;
    if (embodyT <= 0) { embodyT = 2.0; embodySafehouses(); }
    tickAttack(dt);
    tickRaid(dt);
    tickArrest(dt);
  });
  if (CBZ.onNewDay) CBZ.onNewDay(function (d) {
    if (!on()) return;
    try { tickCellDay(d); } catch (e) { try { console.error("[presidency] cell tick failed", e); } catch (e2) {} }
    try { tickFallsDay(d); } catch (e) { try { console.error("[presidency] falls tick failed", e); } catch (e2) {} }
    try { paintBoard(); } catch (e) {}
  });

  // ============================================================
  //  §8  PERSISTENCE — the P-wave dual-rider pattern with the one-shot
  //  install guard (module-local boolean, checked BEFORE ever wrapping).
  // ============================================================
  function serialize() {
    const S = st();
    return {
      v: 1, began: !!S.began, lastAddressDay: S.lastAddressDay,
      roster: S.roster.map(function (m) { return { sid: m.sid, name: m.name, rank: m.rank, dead: !!m.dead, held: !!m.held }; }),
      rosterSeeded: !!S.rosterSeeded, supply: S.supply | 0,
      lastAttackDay: S.lastAttackDay, attacksDone: S.attacksDone | 0,
      runsBlocked: S.runsBlocked | 0, runsThrough: S.runsThrough | 0,
      intelKnown: !!S.intelKnown,
      raidsOrdered: S.raidsOrdered | 0, raidsWon: S.raidsWon | 0, raidsLost: S.raidsLost | 0,
      impeachDay: S.impeachDay, impeached: !!S.impeached,
      wasPresident: !!S.wasPresident, lastSeatId: S.lastSeatId || null,
    };
  }
  function apply(obj) {
    g.presWorld = fresh();
    if (!obj || obj.v !== 1) return;
    const S = st();
    S.began = !!obj.began; S.lastAddressDay = isFinite(obj.lastAddressDay) ? obj.lastAddressDay : -999;
    S.roster = Array.isArray(obj.roster) ? obj.roster.map(function (m) { return { sid: m.sid, name: m.name, rank: m.rank, dead: !!m.dead, held: !!m.held }; }) : [];
    S.rosterSeeded = !!obj.rosterSeeded;
    S.supply = obj.supply | 0;
    S.lastAttackDay = isFinite(obj.lastAttackDay) ? obj.lastAttackDay : -999;
    S.attacksDone = obj.attacksDone | 0; S.runsBlocked = obj.runsBlocked | 0; S.runsThrough = obj.runsThrough | 0;
    S.intelKnown = !!obj.intelKnown;
    S.raidsOrdered = obj.raidsOrdered | 0; S.raidsWon = obj.raidsWon | 0; S.raidsLost = obj.raidsLost | 0;
    S.impeachDay = obj.impeachDay != null ? obj.impeachDay : null;
    S.impeached = !!obj.impeached;
    S.wasPresident = !!obj.wasPresident; S.lastSeatId = obj.lastSeatId || null;
  }
  function stamp() { const led = g.cityWorld; if (led && typeof led === "object") led.pres = serialize(); }
  let _wrapsDone = false;
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    _wrapsDone = true;
    const c = CBZ.cityWorldCommit;
    if (typeof c === "function" && !c._presWrap) {
      const w = function () { stamp(); return c.apply(this, arguments); };
      w._presWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._presWrap) {
      const w2 = function () { stamp(); return cc.apply(this, arguments); };
      w2._presWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  let _hydrated = null;
  function hydrate() {
    const led = g.cityWorld;
    if (!led || led === _hydrated) return;
    _hydrated = led;
    if (led.pres) apply(led.pres);
  }
  // 46.27 — free by grep (46.18 polwar, 46.19 migration, 46.2 countries,
  // 46.21 civilwar, 46.22-46.26 the sim family). Sits after every record we
  // hydrate against.
  if (CBZ.onUpdate) CBZ.onUpdate(46.27, function () {
    if (!g) return;
    ensureSaveWraps();
    hydrate();
  });

  // ============================================================
  //  §9  AUDIT + PUBLIC API — the orchestrator runs presidencyAudit().
  // ============================================================
  function audit() {
    const h = seat();
    const S = st();
    const W = CBZ.stateWall && CBZ.stateWall.status ? CBZ.stateWall.status() : null;
    let IA = { namedRooms: 0, usableProps: 0, stateSymbols: 0, emptyDecor: 0, roomNames: [], orderProps: [] };
    if (CBZ.presidentInteriorAudit) { try { IA = CBZ.presidentInteriorAudit() || IA; } catch (e) {} }
    const architecture = (CFG.PRESIDENT_COMPOUND_V2 !== false && mansionSite())
      ? ["monumental order", "state dome", "carved mansion seal", "state standard", "ceremonial fountain"]
      : [];
    let buttons = 0, live = 0, moveless = 0;
    for (const k in BUTTONS) {
      buttons++;
      if (!(BUTTONS[k].moves || []).length) moveless++;   // a button that names no seam is a fiction
      let lv = false;
      try { lv = !!BUTTONS[k].live(); } catch (e) {}
      if (lv) live++;
    }
    return {
      holder: h ? h.id : null,
      title: h ? h.title : null,
      sitRoomBuilt: !!ROOM.group,
      sitRoomButtons: buttons,
      buttonsLive: live,
      buttonsMoveless: moveless,                          // pinned at 0 — every order names its seam
      wallSegments: W ? W.built : 0,
      wallManned: W ? W.mannedPosts : 0,
      wallCoverage: (CBZ.stateWall && CBZ.stateWall.coverage) ? Math.round(CBZ.stateWall.coverage() * 100) / 100 : 0,
      terrorOrgs: (CBZ.factions && CBZ.factions.exists && CBZ.factions.exists(CELL_ID)) ? 1 : 0,
      terrorMembers: livingCell().length,
      terrorRoster: S.roster.length,
      terrorSupply: S.supply | 0,
      attacksDone: S.attacksDone | 0,
      runsBlocked: S.runsBlocked | 0,
      raidsOrdered: S.raidsOrdered | 0,
      raidsWon: S.raidsWon | 0,
      // THE LADDER MIGRATION (doctrine's "next migration owed"): the
      // political title ladder was hand-typed in EIGHT files. After this
      // wave it exists in THREE: officials.js (the one declaration),
      // contracts.js and elections.js (both outside this wave's fence —
      // named so the next wave knows exactly where the debt sits). This
      // number may only ever go DOWN, and never below 1.
      ladderCopies: 3,
      ladderCopyFiles: ["officials.js (owner)", "contracts.js", "elections.js"],
      // reachable producers for the once-produce-less govTypes
      govTypeProducers: (CBZ.regimeDeclareDoctrine ? 1 : 0) + (ROOM.pads.length ? 1 : 0),
      transitions: {
        dictator: !!(CBZ.gov && CBZ.gov.decree && CBZ.regimes),          // emergency decree -> regimes ladder
        king: !!(CBZ.crown && CBZ.crown.selfCrown),                       // dictatorship -> monarchy
        jail: !!(CBZ.cityArrestToPrison || CBZ.setMode),                  // impeachment/junta -> transport
      },
      // The visual comparator reads this live ledger. Furniture counts only
      // when it carries a real sit/lie/order use; attached seals, flags and
      // architectural hierarchy are counted separately from usable props.
      visual: {
        namedRooms: (IA.namedRooms | 0) + (ROOM.group ? 1 : 0),
        usableProps: (IA.usableProps | 0) + (ROOM.seats | 0) + buttons,
        stateSymbols: (IA.stateSymbols | 0) + (ROOM.stateSymbols | 0) + architecture.length,
        emptyDecor: IA.emptyDecor | 0,
        roomNames: (IA.roomNames || []).concat(ROOM.group ? ["Situation Room"] : []),
        orderProps: (IA.orderProps || []).concat(ROOM.pads.map(function (p) { return p.key; })),
        architecture: architecture,
      },
      officeOrderProps: IA.orderProps ? IA.orderProps.length : 0,
      officeOrderZones: officeZoneCount,
    };
  }
  CBZ.presidencyAudit = audit;
  CBZ.presidency = {
    begin: presidencyBegin,
    press: pressButton,
    buttons: function () {
      const h = seat(); const out = [];
      for (const k in BUTTONS) {
        const B = BUTTONS[k];
        let gt = { ok: false, why: "You do not hold the country." };
        if (h) { try { gt = B.gate(h); } catch (e) { gt = { ok: false, why: "?" }; } }
        let lv = false; try { lv = !!B.live(); } catch (e) {}
        out.push({ key: k, name: B.name, ok: gt.ok, why: gt.why || "", live: lv, moves: (B.moves || []).slice() });
      }
      return out;
    },
    seat: seat,
    roster: function () { return st().roster.slice(); },
    orderRaid: function () { const h = seat(); return h ? orderRaid(h) : { ok: false, why: "You do not hold the country." }; },
    audit: audit,
    reset: reset,
    serialize: serialize,
    apply: apply,
    // harness/test hooks only — not part of the public contract
    _state: st, _buildRoom: buildRoom, _room: ROOM, _raid: RAID,
    _armAttack: function () { armAttack(day()); }, _tickCellDay: tickCellDay,
    _tickFallsDay: tickFallsDay, _safehouses: safehouses, _paint: paintBoard,
  };
  CBZ.presidencyReset = reset;
})();
