/* ============================================================
   city/racecareer.js — THE LADDER OF LOCKED PLACES at Diamond Speedway.

   WHY (the keycard story, owner 2026-07-28): the owner ran for the jail
   keycard relentlessly because it opened a LOCKED door to a better-crafted
   room with a categorical reward inside. So the racing career is not a quest
   chain — it is a row of DOORS you can see through and cannot open yet:

     ROOKIE      you may race. The paddock gate refuses you BY NAME.
     REGULAR     the paddock gate slides open (one Diamond start earns it).
     CONTENDER   BAY 12's roller door lifts: your own pit bay, with a CREW
                 that takes ORDERS (real staffed bodies who visibly work).
     STAR        you may call PINK SLIPS on any named driver — beat him and
                 you own HIS actual liveried machine; lose and yours is his.
     APEX        the champion's garage — the best-made room on the island,
                 glass-fronted so the unicorn car (one per world) is visible
                 from the racing line on day one — opens its one door.

   Doors beat markers: every rung is enforced by REAL geometry (colliders +
   sliding leaves), every refusal names the price, and craft is spent
   ASYMMETRICALLY on the one room that matters (the champion's garage).

   WHAT THIS FILE REUSES (engine-systems law — reuse, never re-invent):
     · CBZ.factions.declare        — the ONE org/rank layer. Every rung
                                     grants a VERB (paddock/pitbay+crew/
                                     pinkslip/champgarage); verbless rungs
                                     are 0 BY CONSTRUCTION.
     · worldstate race records     — rank is DERIVED from the durable race
                                     ledger (cityEvent "race-finish"), so
                                     there is no parallel career store.
     · CBZ.speedwayPlaces/Frame/…  — the venue's own published geometry.
     · CBZ.cityStaffVenue/Post     — the crew are ordinary staffed bodies
                                     (killfeed deaths, gunpoint hands-up).
     · CBZ.setCharPose("tend")     — the existing working-hands pose row;
                                     no new animation system.
     · CBZ.raceDrivers/raceKit/raceHud — the one driving brain, one scorer,
                                     one race UI (no new objective UI; the
                                     objective-UI ratchet only goes DOWN).
     · CBZ.cityRestoreCarMods      — the modshop pipeline IS the race tune.
     · the one wallet (CBZ.city.spend/addCash) for every charge and payout.

   Flags (all declared here, one-line reverts):
     RACE_LADDER    — org + doors + places + refusals (everything).
     RACE_PINKSLIP  — the Star verb and the car-transfer duel.
     RACE_CREW      — bay-12 crew posts + orders.
     RACE_TROPHIES  — physical cups on the bay shelf + plaque reader.

   Audit: CBZ.raceAudit() — counts that prove the systems exist.
   Determinism: all build-time placement is pure derivation off the venue's
   published frame (no rng draws, no Math.random in any build path);
   runtime race logic follows racedrivers.js's per-race Math.random rule.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  if (!g) return;

  const CFG = CBZ.CONFIG = CBZ.CONFIG || {};
  if (CFG.RACE_LADDER == null) CFG.RACE_LADDER = true;
  if (CFG.RACE_PINKSLIP == null) CFG.RACE_PINKSLIP = true;
  if (CFG.RACE_CREW == null) CFG.RACE_CREW = true;
  if (CFG.RACE_TROPHIES == null) CFG.RACE_TROPHIES = true;

  const ORG = "racing";
  const mat = CBZ.cmat || CBZ.mat || function (c, o) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: c },
      o && o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei || 0.5 } : {}));
  };
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2.4); }
  function big(t) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(t); return; } catch (e) {} } note(t, 4.0); }
  function fmt$(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  // ============================================================
  //  §1  THE LEAGUE — one factions.declare. EVERY rung grants a VERB.
  //  Rungs above Rookie are `locked` so factions' credit machinery never
  //  auto-grants them: promotion is EARNED through the durable race ledger
  //  (worldstate records), synced by the maintainer below. No parallel
  //  career store exists — the ledger IS the career.
  // ============================================================
  let declared = false;
  function declareLeague() {
    if (declared || !CFG.RACE_LADDER) return;
    if (!CBZ.factions || !CBZ.factions.declare) return;
    if (CBZ.factions.def && CBZ.factions.def(ORG)) { declared = true; return; }
    CBZ.factions.declare({
      id: ORG, name: "Diamond Racing League", short: "League", kind: "sport",
      color: 0xffd451, wage: 0, heat: 1,
      ranks: [
        { pip: "Rookie",    grants: ["race"],             lvl: 8,
          unlock: "You may take a Diamond Speedway grid slot." },
        { pip: "Regular",   grants: ["paddock"],          lvl: 16, locked: true,
          unlock: "The paddock gate opens for you." },
        { pip: "Contender", grants: ["pitbay", "crew"],   lvl: 28, locked: true,
          unlock: "BAY 12 is yours, and a crew that takes orders." },
        { pip: "Star",      grants: ["pinkslip"],         lvl: 44, locked: true,
          unlock: "Call PINK SLIPS on any named driver." },
        { pip: "APEX",      grants: ["champgarage"],      lvl: 68, locked: true,
          unlock: "The champion's garage door knows one key: yours." },
      ],
      admission: {},
      lore: "Racing fame is a power gradient: dominate, then convert.",
    });
    declared = true;
  }

  // ---- the durable ledger (worldstate) — rank derives from THIS -----------
  function raceRec(kind) {
    let w = null;
    try { w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : (g && g.cityWorld) || null; }
    catch (e) { w = (g && g.cityWorld) || null; }
    return (w && w.records && w.records.races && w.records.races[kind]) || {};
  }
  function stats() {
    const kinds = ["legal", "apex", "street", "pinkslip"];
    const out = { starts: 0, wins: 0, podiums: 0, titles: 0 };
    for (let i = 0; i < kinds.length; i++) {
      const r = raceRec(kinds[i]);
      out.starts += r.starts | 0; out.wins += r.wins | 0;
      out.podiums += r.podiums | 0;
    }
    out.titles = raceRec("apex").titles | 0;
    return out;
  }
  // the rung the ledger has EARNED (0..4). Each row names its own price —
  // the same numbers every locked door quotes in its refusal line.
  const NEED = [
    null,
    { text: "one Diamond start",                 ok: (s) => s.starts >= 1 },
    { text: "a podium (or four starts)",         ok: (s) => s.podiums >= 1 || s.starts >= 4 },
    { text: "a win and two podiums",             ok: (s) => s.wins >= 1 && s.podiums >= 2 },
    { text: "the APEX Night title",              ok: (s) => s.titles >= 1 },
  ];
  function deservedTier(s) {
    let d = 0;
    for (let i = 1; i < NEED.length; i++) { if (NEED[i].ok(s)) d = i; else break; }
    return d;
  }
  function myTier() {
    if (!CBZ.factions || !CBZ.factions.tier) return -1;
    return CBZ.factions.tier(ORG);
  }
  // MAY THE PLAYER pass this door? Degrade-safe per the factions law: the
  // guard is rankKnows, never a bare rankCan — an undeclared org (flag off,
  // factions absent) must OPEN every door, not slam it.
  function can(verb) {
    if (!CFG.RACE_LADDER) return true;
    if (!CBZ.rankKnows || !CBZ.rankKnows(ORG, verb)) return true;
    return !!(CBZ.rankCan && CBZ.rankCan(null, ORG, verb));
  }
  // membership: the racer origin signs you at the door; anyone else is
  // licensed the moment the ledger shows a start (you raced — you're in).
  function syncMembership() {
    if (!declared || !CBZ.factions) return;
    const F = CBZ.factions;
    if (F.isMember && F.isMember(ORG)) return;
    const s = stats();
    if (g.cityOrigin === "racer" || s.starts >= 1) {
      if (F.join) F.join(ORG, s.starts >= 1 ? "raced" : "origin", { force: true });
    }
  }
  function syncRank() {
    if (!declared || !CBZ.factions || !CBZ.factions.promote) return;
    if (!(CBZ.factions.isMember && CBZ.factions.isMember(ORG))) return;
    const F = CBZ.factions.def ? CBZ.factions.def(ORG) : null;
    if (!F || !F.ranks) return;
    const s = stats();
    const want = deservedTier(s);
    let guard = F.ranks.length;
    while (guard-- > 0) {
      const t = myTier();
      if (t < 0 || t >= want) break;
      const next = F.ranks[t + 1];
      if (!next || !CBZ.factions.promote(ORG, next.key)) break;
    }
  }

  // ============================================================
  //  §2  THE PLACES — geometry, all derived off the venue's own exports.
  //  Built by a deferred one-shot (the island's parkRoot pattern): the
  //  landmass builder runs before CBZ.city.arena exists, so anything that
  //  needs the arena root waits for it. Pure derivation — no rng draws.
  // ============================================================
  const PL = { built: false, root: null, count: 0 };
  const DOORS = [];        // { id, verb, meshes[], colliders[], locked, k, kind, x, z, why(), openN }
  let SHELF = null;        // { x, z, y, tx, tz, group }  (bay-12 trophy shelf)
  let MARKS = null;        // { x, z, r }                 (bay-12 service marks)
  let CHAMP = null;        // { x, z, yaw, padX, padZ, display, group, minted }
  let BAY = null;          // { x, z, tm }
  const CREW = { posts: [], declaredPosts: false, order: null, run: 0 };

  function frame(t) { return CBZ.speedwayFrame ? CBZ.speedwayFrame(t) : null; }
  function places() { return CBZ.speedwayPlaces ? CBZ.speedwayPlaces() : null; }

  function addSolid(list, cx, cz, w, d, y0, y1) {
    const c = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0: y0 || 0, y1: y1 == null ? 3 : y1 };
    CBZ.colliders.push(c);
    if (list) list.push(c);
    return c;
  }
  function dropSolids(list) {
    for (let i = 0; i < list.length; i++) {
      const k = CBZ.colliders.indexOf(list[i]);
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    list.length = 0;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function box(parent, m, x, y, z, w, h, d, yaw) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    if (yaw) mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.raceLadder = true;          // batching law: userData spares it
    parent.add(mesh);
    return mesh;
  }
  function label(parent, text, x, y, z, sx, sy, color) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#ffd451" });
    if (!s) return null;
    s.scale.set(sx || 8, sy || 2, 1);
    s.position.set(x, y, z);
    parent.add(s);
    return s;
  }

  // ---- door registry -------------------------------------------------------
  function declareDoor(id, verb, x, z, why) {
    const d = { id: id, verb: verb, meshes: [], colliders: [], locked: true, k: 0,
                x: x, z: z, why: why, openN: 0, noteT: 0 };
    DOORS.push(d);
    return d;
  }
  function doorByVerb(v) { for (let i = 0; i < DOORS.length; i++) if (DOORS[i].verb === v) return DOORS[i]; return null; }

  // ============================================================
  //  §2a  THE PADDOCK GATE (verb: paddock) — two sliding steel leaves in the
  //  paddock fence's own gap. Locked, they close the ONLY opening; open,
  //  they park along the fence line. A steward works the reader post.
  // ============================================================
  function buildPaddockGate(root, P) {
    const G = P.paddock.gate;
    const half = G.half;
    const steel = mat(0x2a2f38), dark = mat(0x1b1f26), gold = mat(0xd9b23a);
    const grp = new THREE.Group(); grp.name = "race-paddock-gate"; root.add(grp);
    // piers
    box(grp, dark, G.x - half - 0.8, 1.6, G.z, 1.4, 3.2, 1.4);
    box(grp, dark, G.x + half + 0.8, 1.6, G.z, 1.4, 3.2, 1.4);
    addSolid(null, G.x - half - 0.8, G.z, 1.4, 1.4, 0, 3.2);
    addSolid(null, G.x + half + 0.8, G.z, 1.4, 1.4, 0, 3.2);
    // beam + name
    box(grp, steel, G.x, 3.35, G.z, half * 2 + 2.6, 0.5, 0.7);
    label(grp, "PADDOCK · LICENSE HOLDERS", G.x, 4.4, G.z, 14, 2.6, "#ffd451");
    // card reader post (the promise of a key)
    box(grp, dark, G.x + half * 0.5, 0.65, G.z - 1.6, 0.22, 1.3, 0.22);
    box(grp, gold, G.x + half * 0.5, 1.28, G.z - 1.6, 0.3, 0.26, 0.12);
    const d = declareDoor("paddock-gate", "paddock", G.x, G.z, function () {
      const s = stats();
      return "Gate steward: “License holders only. " +
        (s.starts >= 1 ? "Your rank's coming through, hold on.”" :
          "Run one race. Diamond or the streets, and this gate learns your name.”");
    });
    // two sliding leaves (chain-mesh look: frame + crossbars)
    for (const sgn of [-1, 1]) {
      const leafW = half;
      const leaf = new THREE.Group();
      leaf.position.set(G.x + sgn * half * 0.5, 0, G.z);
      leaf.userData.raceLadder = true;
      grp.add(leaf);
      box(leaf, steel, 0, 1.25, 0, leafW, 2.5, 0.14);
      box(leaf, dark, 0, 2.42, 0, leafW, 0.16, 0.2);
      box(leaf, dark, 0, 0.12, 0, leafW, 0.16, 0.2);
      leaf._sgn = sgn; leaf._x0 = G.x + sgn * half * 0.5; leaf._slide = leafW;
      d.meshes.push(leaf);
      d.colliders.push(addSolid(null, G.x + sgn * half * 0.5, G.z, leafW, 0.5, 0, 2.5));
    }
    // the steward — a real staffed body at the reader
    if (CBZ.cityStaffVenue && CBZ.cityStaffPost) {
      CBZ.cityStaffVenue("raceladder", { stations: 1, note: "paddock gate steward" });
      CBZ.cityStaffPost({
        venue: "raceladder", id: "raceladder:gate", job: "gate steward",
        archetype: "security", x: G.x + half * 0.5 + 1.2, z: G.z - 2.0,
        face: Math.PI, pose: "foldarms", opts: { wealth: 0.3, aggr: 0.1 },
      });
    }
    PL.count++;
    return d;
  }

  // ============================================================
  //  §2b  BAY 12 (verbs: pitbay + crew) — the last pit box, nearest the pit
  //  exit, sealed by a RESERVED roller door until Contender. Inside: painted
  //  service marks (the car comes TO the crew — real pit-stop choreography),
  //  the trophy shelf, and three crew stations.
  // ============================================================
  function buildBay12(root, P) {
    const pit = P.pit;
    const tm = pit.t0 + (pit.t1 - pit.t0) * (11.5 / 12);
    const fm = frame(tm); if (!fm) return;
    const Ln = CBZ.speedwayTrackLen ? CBZ.speedwayTrackLen() : 1400;
    const bayLen = (pit.t1 - pit.t0) / 12 * Ln;
    const GF = pit.garageFront, GD = pit.garageDepth, GH = 7.4, Y = 0.10;
    function at(u, along) {
      return { x: fm.x + fm.nx * u + fm.tx * (along || 0), z: fm.z + fm.nz * u + fm.tz * (along || 0) };
    }
    const grp = new THREE.Group(); grp.name = "race-bay12"; root.add(grp);
    const gold = mat(0xd9b23a), dark = mat(0x1b1f26), steel = mat(0x39424c);
    const lineM = mat(0xf0c419);

    // RESERVED roller door across the bay mouth (just inside the venue's own
    // part-raised door), plus its collider while locked.
    const dm = at(GF - 0.55, 0);
    const d = declareDoor("bay12-door", "pitbay", dm.x, dm.z, function () {
      const s = stats();
      return "BAY 12 · RESERVED FOR CONTENDERS. A podium at Diamond lifts this door. (" +
        s.podiums + " podium" + (s.podiums === 1 ? "" : "s") + ", " + s.starts + " starts)";
    });
    const doorMesh = box(grp, steel, dm.x, Y + (GH - 1.0) / 2, dm.z, 0.18, GH - 1.0, bayLen - 1.6, fm.heading);
    doorMesh._y0 = doorMesh.position.y; doorMesh._lift = GH - 2.4;
    d.meshes.push(doorMesh);
    d.colliders.push(addSolid(null, dm.x, dm.z,
      Math.abs(fm.tx) * (bayLen - 1.6) + Math.abs(fm.nx) * 0.6,
      Math.abs(fm.tz) * (bayLen - 1.6) + Math.abs(fm.nz) * 0.6, 0, GH - 1.0));
    label(grp, "BAY 12", dm.x, GH + 0.8, dm.z, 5, 1.6, "#ffd451");

    // service marks: the painted box the car must stand on for crew work.
    // box(w, h, d, yaw) with yaw = fm.heading puts local +X ACROSS the track
    // (the u direction) and local +Z ALONG it — the venue's own basis.
    const mk = at(-46, 0);
    MARKS = { x: mk.x, z: mk.z, r: 7 };
    for (const [du, da, w, dd] of [[0, -1.45, 5.6, 0.16], [0, 1.45, 5.6, 0.16], [-2.85, 0, 0.16, 2.74], [2.85, 0, 0.16, 2.74]]) {
      const p = at(-46 + du, da);
      box(grp, lineM, p.x, Y + 0.03, p.z, w, 0.03, dd, fm.heading);
    }

    // the trophy shelf, on the back wall of YOUR bay (long axis along track)
    const sh = at(-52.6, -3.2);
    box(grp, dark, sh.x, 1.0, sh.z, 0.24, 2.0, 2.6, fm.heading);
    box(grp, gold, sh.x, 1.16, sh.z, 0.34, 0.06, 2.8, fm.heading);
    box(grp, gold, sh.x, 1.82, sh.z, 0.34, 0.06, 2.8, fm.heading);
    addSolid(null, sh.x, sh.z, 1.2, 1.2, 0, 2.1);
    SHELF = { x: sh.x, z: sh.z, y: 1.2, tx: fm.tx, tz: fm.tz, group: grp };

    BAY = { x: mk.x, z: mk.z, tm: tm, fm: fm, at: at, Y: Y };
    PL.count++;
    return d;
  }

  // crew stations are declared only once the rung is HELD — a locked bay has
  // no crew, which is exactly what makes earning it read as a change.
  function declareCrewPosts() {
    if (CREW.declaredPosts || !CFG.RACE_CREW || !BAY) return;
    if (!CBZ.cityStaffVenue || !CBZ.cityStaffPost) return;
    if (!can("crew")) return;
    CREW.declaredPosts = true;
    CBZ.cityStaffVenue("racecrew", { stations: 3, note: "your bay-12 pit crew" });
    const at = BAY.at, fm = BAY.fm;
    const spots = [
      { id: "racecrew:chief", job: "crew chief", u: -49.8, a: 3.6, pose: "foldarms", tag: "chief" },
      { id: "racecrew:m1", job: "race mechanic", u: -44.0, a: -2.1, pose: null, tag: "mech" },
      { id: "racecrew:m2", job: "race mechanic", u: -48.0, a: 2.1, pose: null, tag: "mech" },
    ];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i], p = at(s.u, s.a);
      const face = Math.atan2(MARKS.x - p.x, MARKS.z - p.z);   // face the marks
      const post = CBZ.cityStaffPost({
        venue: "racecrew", id: s.id, job: s.job, archetype: "worker",
        x: p.x, z: p.z, face: face, pose: s.pose,
        opts: { wealth: 0.3, aggr: 0.08, floorY: 0.12 },
        after: (function (tag) { return function (ped) { ped._raceCrew = tag; }; })(s.tag),
      });
      if (post) CREW.posts.push(post);
    }
  }

  // ============================================================
  //  §2c  THE CHAMPION'S GARAGE (verb: champgarage) — THE GUN ROOM.
  //  Glass-fronted so the unicorn is visible from the racing line from day
  //  one; one glass door; the interior gets the whole craft budget.
  // ============================================================
  function buildChampGarage(root) {
    const tG = 0.108;                       // just past the pit exit, inside
    const f = frame(tG); if (!f) return;
    const u = -47;
    const gx = f.x + f.nx * u, gz = f.z + f.nz * u;
    const yaw = Math.atan2(f.nx, f.nz);     // local +Z faces the track
    const grp = new THREE.Group();
    grp.name = "race-champ-garage";
    grp.position.set(gx, 0, gz);
    grp.rotation.y = yaw;
    grp.userData.raceLadder = true;
    root.add(grp);
    const W2 = 10, D2 = 6.5, H = 6.2;       // half-width (along track), half-depth
    const dark = mat(0x14161c), gold = mat(0xd9b23a, { emissive: 0xd9b23a, ei: 0.22 });
    const marble = mat(0x23262e), carpet = mat(0x7a1420);
    const glass = new THREE.MeshPhongMaterial({
      color: 0x9fd4ea, emissive: 0x0f2a38, emissiveIntensity: 0.25,
      transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false,
    });
    const warm = mat(0xffe6a8, { emissive: 0xffd98a, ei: 0.85 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    function wpt(lx, lz) { return { x: gx + lx * c + lz * s, z: gz - lx * s + lz * c }; }
    function wsolid(lx, lz, w, d, y0, y1) {
      const ax = Math.abs(c) * w / 2 + Math.abs(s) * d / 2;
      const az = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;
      const p = wpt(lx, lz);
      return { c: addSolid(null, p.x, p.z, ax * 2, az * 2, y0, y1) };
    }
    // shell: floor, back, sides, roof, gold trim, parapet
    box(grp, marble, 0, 0.03, 0, W2 * 2, 0.06, D2 * 2);
    box(grp, dark, 0, H / 2, -D2, W2 * 2, H, 0.35);
    box(grp, dark, -W2, H / 2, 0, 0.35, H, D2 * 2);
    box(grp, dark, W2, H / 2, 0, 0.35, H, D2 * 2);
    box(grp, dark, 0, H + 0.15, 0, W2 * 2 + 0.9, 0.3, D2 * 2 + 0.9);
    box(grp, gold, 0, H - 0.35, D2 + 0.12, W2 * 2 + 0.6, 0.28, 0.1);
    box(grp, gold, 0, H + 0.42, 0, W2 * 2 + 1.1, 0.24, D2 * 2 + 1.1);
    wsolid(0, -D2, W2 * 2, 0.5, 0, H);
    wsolid(-W2, 0, 0.5, D2 * 2, 0, H);
    wsolid(W2, 0, 0.5, D2 * 2, 0, H);
    // GLASS FRONT: two fixed panes flanking the one glass door
    const doorW = 5.2, paneW = (W2 * 2 - doorW) / 2;
    box(grp, glass, -(doorW / 2 + paneW / 2), H / 2, D2, paneW, H - 0.4, 0.1);
    box(grp, glass, (doorW / 2 + paneW / 2), H / 2, D2, paneW, H - 0.4, 0.1);
    wsolid(-(doorW / 2 + paneW / 2), D2, paneW, 0.4, 0, H);
    wsolid((doorW / 2 + paneW / 2), D2, paneW, 0.4, 0, H);
    // gold mullions
    box(grp, gold, -doorW / 2, H / 2, D2 + 0.06, 0.18, H, 0.18);
    box(grp, gold, doorW / 2, H / 2, D2 + 0.06, 0.18, H, 0.18);
    // THE DOOR — glass, locked, and you can see the car through it
    const pd = wpt(0, D2);
    const d = declareDoor("champ-door", "champgarage", pd.x, pd.z, function () {
      const s2 = stats();
      return "THE CHAMPION'S GARAGE, one key exists: the APEX Night title. (" +
        (s2.titles > 0 ? "It knows your name." : "Titles: 0.") + ")";
    });
    const doorMesh = box(grp, glass, 0, (H - 0.6) / 2, D2, doorW, H - 0.6, 0.12);
    box(grp, gold, 0, 0.2, D2 + 0.08, doorW, 0.12, 0.08);   // gold sill
    doorMesh._y0 = doorMesh.position.y; doorMesh._lift = H - 1.0;
    d.meshes.push(doorMesh);
    d.colliders.push(wsolid(0, D2, doorW, 0.4, 0, H).c);
    label(grp, "THE CHAMPION'S GARAGE", 0, H + 1.7, D2 - 0.5, 15, 3.0, "#ffd451");

    // interior craft (the asymmetric budget): carpet, pedestal, ropes,
    // champions wall, plinth cups, uplights
    box(grp, carpet, 0, 0.075, (D2 - 1.6) / 2 - 0.8, 2.6, 0.05, D2 + 0.8);
    const pedestal = box(grp, gold, 0, 0.1, -1.5, 6.4, 0.14, 6.4);
    void pedestal;
    box(grp, marble, 0, 0.16, -1.5, 5.8, 0.06, 5.8);
    for (const [lx, lz] of [[-3.4, 2.4], [3.4, 2.4], [-3.4, -4.6], [3.4, -4.6]]) {
      box(grp, gold, lx, 0.55, lz, 0.1, 1.1, 0.1);
      box(grp, carpet, lx > 0 ? lx - 1.7 : lx + 1.7, 1.02, lz, 3.2, 0.05, 0.05);
    }
    // champions wall: the lineage you are trying to join (fixed history —
    // deterministic content, same every world)
    const LEGENDS = ["E. HALVORSEN '38", "R. CALLOWAY '41", "M. OKONKWO '44",
      "J. PRICE '47", "S. VOLKOV '51", "A. DUMONT '55"];
    for (let i = 0; i < LEGENDS.length; i++) {
      const lx = -W2 + 1.8 + i * ((W2 * 2 - 3.6) / (LEGENDS.length - 1));
      box(grp, gold, lx, 3.2, -D2 + 0.35, 1.5, 1.0, 0.08);
      label(grp, LEGENDS[i], lx, 3.2, -D2 + 0.55, 3.2, 0.8, "#ffe9a8");
    }
    // two plinth cups (the house's own silver)
    for (const lx of [-7.6, 7.6]) {
      box(grp, marble, lx, 0.55, -4.6, 1.0, 1.1, 1.0);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.18, 0.8, 10), gold);
      cup.position.set(lx, 1.55, -4.6); cup.userData.raceLadder = true; grp.add(cup);
      wsolid(lx, -4.6, 1.1, 1.1, 0, 1.7);
    }
    // light: roof soffits + floor uplights aimed at the pedestal
    for (const lx of [-4.5, 0, 4.5]) box(grp, warm, lx, H - 0.5, -0.5, 1.6, 0.1, 1.6);
    for (const lx of [-2.2, 2.2]) box(grp, warm, lx, 0.1, 1.6, 0.4, 0.08, 0.4);

    // THE UNICORN — visible through the glass from day one
    const model = unicornModel();
    let display = null;
    if (model && CBZ.cityBuildPlayerCarVisual) {
      try {
        const style = (CBZ.cityInferCarStyle && CBZ.cityInferCarStyle(model)) || model.detailStyle || "aventador";
        display = CBZ.cityBuildPlayerCarVisual(style, 0xd9b23a,
          { number: 1, base: 0xd9b23a, accent: 0x14161c });
      } catch (e) { display = null; }
    }
    if (display) {
      display.position.set(0, 0.2, -1.5);
      display.userData.raceLadder = true;
      grp.add(display);
    }
    const pad = wpt(0, -1.5);
    CHAMP = { x: gx, z: gz, yaw: yaw, padX: pad.x, padZ: pad.z, display: display, group: grp, minted: false };
    // the pedestal is solid until the car is real
    CHAMP.padSolid = wsolid(0, -1.5, 6.0, 6.0, 0, 1.2).c;
    PL.count++;
    return d;
  }

  function unicornModel() {
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    let best = null;
    for (let i = 0; i < CARS.length; i++) {
      const c2 = CARS[i];
      if (!best || (c2.value | 0) > (best.value | 0)) best = c2;
    }
    if (!best) return null;
    return Object.assign({}, best, {
      name: "Aurum GT-1", color: 0xd9b23a, rarity: 1,
      value: Math.max(220000, (best.value | 0) * 2),
    });
  }
  // one per world: the display visual becomes a REAL owned machine the day
  // the door opens. Categorical, not numeric — nobody else has one.
  function mintUnicorn() {
    if (!CHAMP || CHAMP.minted || !can("champgarage")) return;
    if (!CBZ.cityMakeCar || !CBZ.cityCars) return;
    for (let i = 0; i < CBZ.cityCars.length; i++) if (CBZ.cityCars[i] && CBZ.cityCars[i]._unicorn) { CHAMP.minted = true; return; }
    const model = unicornModel(); if (!model) return;
    let car = null;
    try { car = CBZ.cityMakeCar(CHAMP.padX, CHAMP.padZ, CHAMP.yaw, false, model, 0.3); } catch (e) { car = null; }
    if (!car) return;
    car.owned = true; car.ai = false; car._unicorn = true;
    if (CBZ.cityApplyRaceLivery) {
      try { CBZ.cityApplyRaceLivery(car.group, { number: 1, base: 0xd9b23a, accent: 0x14161c }); } catch (e) {}
    }
    if (CHAMP.display) {
      if (CHAMP.display.parent) CHAMP.display.parent.remove(CHAMP.display);
      CHAMP.display = null;
    }
    if (CHAMP.padSolid) {
      const k = CBZ.colliders.indexOf(CHAMP.padSolid);
      if (k >= 0) CBZ.colliders.splice(k, 1);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      CHAMP.padSolid = null;
    }
    CHAMP.minted = true;
    big("THE AURUM GT-1 IS YOURS · ONE EXISTS.");
    note("The champion's garage hands over its only key. The Aurum GT-1 sits on the pad.", 5.0);
  }

  // ============================================================
  //  §3  DOOR STATE — access sync + refusals + slide animation.
  // ============================================================
  function syncDoors(dt) {
    const P = CBZ.player;
    for (let i = 0; i < DOORS.length; i++) {
      const d = DOORS[i];
      const open = can(d.verb);
      if (open === d.locked) {              // state flip
        d.locked = !open;
        if (open) {
          dropSolids(d.colliders);
          d.openN++;
          if (d.verb === "paddock") note("The paddock gate reads your license, it slides open.", 3.2);
          if (d.verb === "pitbay") note("BAY 12's shutter lifts. Your name is over the door.", 3.2);
          if (d.verb === "champgarage") note("The champion's garage glass parts for you.", 3.2);
        }
      }
      // slide animation toward target
      const target = d.locked ? 0 : 1;
      if (d.k !== target) {
        d.k += (target - d.k) * Math.min(1, (dt || 0.016) * 1.6);
        if (Math.abs(d.k - target) < 0.01) d.k = target;
        for (let m = 0; m < d.meshes.length; m++) {
          const mesh = d.meshes[m];
          if (mesh._slide != null) {         // paddock leaf: slide along its sign
            mesh.position.x = mesh._x0 + mesh._sgn * mesh._slide * d.k;
          } else if (mesh._lift != null) {   // roller/glass door: lift
            mesh.position.y = mesh._y0 + mesh._lift * d.k;
          }
        }
      }
      // the REFUSAL — the door answers you when you stand at it locked
      if (d.locked && P && P.pos) {
        const dx = P.pos.x - d.x, dz = P.pos.z - d.z;
        if (dx * dx + dz * dz < 100) {
          d.noteT -= dt || 0;
          if (d.noteT <= 0) { d.noteT = 10; note(d.why(), 4.2); }
        } else if (d.noteT > 0.5) d.noteT = 0.5;
      }
    }
  }

  // ============================================================
  //  §4  TROPHIES ARE PHYSICAL — cups minted onto the bay-12 shelf from the
  //  durable ledger (one per win/title, capped by shelf length), plus the
  //  plaque reader. Rebuilt whenever the ledger changes.
  // ============================================================
  const TROPHY = { cups: 0, key: "", group: null };
  const cupGeo = new THREE.CylinderGeometry(0.16, 0.07, 0.34, 8);
  cupGeo._shared = true;
  const cupBaseGeo = new THREE.BoxGeometry(0.2, 0.08, 0.2);
  cupBaseGeo._shared = true;
  const CUP_MATS = {
    gold: mat(0xd9b23a, { emissive: 0xd9b23a, ei: 0.25 }),
    silver: mat(0xc9d0d8, { emissive: 0xc9d0d8, ei: 0.12 }),
    chrome: mat(0x9fe0e8, { emissive: 0x9fe0e8, ei: 0.12 }),
    bronze: mat(0xb0703a, { emissive: 0xb0703a, ei: 0.12 }),
  };
  function trophyRows() {
    return [
      { kind: "gold", n: raceRec("apex").titles | 0, what: "APEX title" },
      { kind: "silver", n: (raceRec("legal").wins | 0) + (raceRec("apex").wins | 0), what: "Diamond win" },
      { kind: "chrome", n: raceRec("pinkslip").wins | 0, what: "pink slip taken" },
      { kind: "bronze", n: raceRec("street").wins | 0, what: "street win" },
    ];
  }
  function syncTrophies() {
    if (!CFG.RACE_TROPHIES || !SHELF) return;
    const rows = trophyRows();
    const key = rows.map(function (r) { return r.n; }).join(",");
    if (key === TROPHY.key) return;
    TROPHY.key = key;
    if (TROPHY.group && TROPHY.group.parent) TROPHY.group.parent.remove(TROPHY.group);
    const grp = new THREE.Group();
    grp.userData.raceLadder = true;
    SHELF.group.add(grp);
    TROPHY.group = grp;
    let placed = 0, total = 0;
    const CAP = 10;
    for (let r = 0; r < rows.length; r++) {
      total += rows[r].n;
      for (let i = 0; i < rows[r].n && placed < CAP; i++, placed++) {
        const level = placed < 5 ? 0 : 1;                     // two planks
        const slot = placed % 5;
        const off = (slot - 2) * 0.5;
        const x = SHELF.x + SHELF.tx * off, z = SHELF.z + SHELF.tz * off;
        const y = (level === 0 ? 1.19 : 1.85);
        const base = new THREE.Mesh(cupBaseGeo, CUP_MATS[rows[r].kind]);
        base.position.set(x, y + 0.04, z); base.userData.raceLadder = true; grp.add(base);
        const cup = new THREE.Mesh(cupGeo, CUP_MATS[rows[r].kind]);
        cup.position.set(x, y + 0.26, z); cup.userData.raceLadder = true; grp.add(cup);
      }
    }
    TROPHY.cups = total;
  }
  function plaqueText() {
    const rows = trophyRows();
    const bits = [];
    for (let i = 0; i < rows.length; i++) if (rows[i].n > 0) bits.push(rows[i].n + "× " + rows[i].what + (rows[i].n > 1 ? "s" : ""));
    if (!bits.length) return "The shelf is bare. Every cup up here gets a plaque.";
    return "Plaques: " + bits.join(" · ") + ".";
  }

  // ============================================================
  //  §5  CREW ORDERS — the Contender's verb. The car comes TO the crew
  //  (roll onto the marks); an order makes real bodies visibly work on it
  //  ("tend" — the existing working-hands pose row), then the effect lands.
  // ============================================================
  function crewBodies() {
    const out = [];
    for (let i = 0; i < CREW.posts.length; i++) {
      const ped = CREW.posts[i].ped;
      if (ped && !ped.dead) out.push(ped);
    }
    return out;
  }
  function carOnMarks() {
    if (!MARKS) return null;
    const P = CBZ.player;
    let best = null, bd = MARKS.r * MARKS.r;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.owned) continue;
      const dx = c.pos.x - MARKS.x, dz = c.pos.z - MARKS.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = c; }
    }
    // your current ride wins ties
    if (P && P._vehicle && !P._vehicle.dead) {
      const c = P._vehicle;
      const dx = c.pos.x - MARKS.x, dz = c.pos.z - MARKS.z;
      if (dx * dx + dz * dz < MARKS.r * MARKS.r) best = c;
    }
    return best;
  }
  function startOrder(kind, cost, apply, sayLine) {
    if (CREW.order) { note("The crew is mid-job, let them finish.", 1.8); return; }
    const car = carOnMarks();
    if (!car) { note("Crew chief: “Roll it onto the marks first.”", 2.2); return; }
    if (cost > 0 && !(CBZ.city && CBZ.city.spend && CBZ.city.spend(cost))) {
      note("That work runs " + fmt$(cost) + " · you're short.", 2.0); return;
    }
    CREW.order = { kind: kind, t: 7.0, car: car, apply: apply };
    CREW.run++;
    const bodies = crewBodies();
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (p._raceCrew === "chief") {
        if (CBZ.citySay) CBZ.citySay(p, sayLine || "“On it. Wheels off!”", "#ffe9a8", 2.4);
        continue;
      }
      // face the car and get the hands in it — the existing pose row, never
      // a new animation system.
      if (p.staffPost) p.staffPost.face = Math.atan2(car.pos.x - p.pos.x, car.pos.z - p.pos.z);
      if (CBZ.setCharPose && p.char) CBZ.setCharPose(p.char, "tend");
    }
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
  }
  function tickOrder(dt) {
    const o = CREW.order;
    if (!o) return;
    o.t -= dt || 0;
    if (o.t > 0) return;
    CREW.order = null;
    const bodies = crewBodies();
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (p._raceCrew === "mech" && CBZ.setCharPose && p.char) CBZ.setCharPose(p.char, null);
      if (p.staffPost && MARKS) p.staffPost.face = Math.atan2(MARKS.x - p.pos.x, MARKS.z - p.pos.z);
    }
    try { o.apply(o.car); } catch (e) {}
  }
  function nextTuneTier(car) { return Math.min(3, ((car && car.mods && car.mods.perf) | 0) + 1); }
  const TUNE_PRICE = { 1: 4200, 2: 9500, 3: 17000 };
  function crewInteractions(I) {
    const showChief = function (p) {
      return !!(CFG.RACE_CREW && p && p._raceCrew === "chief" && !p.dead && can("crew"));
    };
    I.register("ped:civ", {
      id: "crew-order-service", slot: "e", prio: 7,
      canShow: showChief,
      label: function () { return "Order: full service ($260)"; },
      onSelect: function () {
        startOrder("service", 260, function (car) {
          car.engineHp = 100; car._smoking = false;
          if (car.hp != null && car.maxHp != null) car.hp = car.maxHp;
          note("Crew chief: “She'll run like the day she was built.”", 2.6);
        }, "“Full service. Fuel, rubber, the lot.”");
      },
    });
    I.register("ped:civ", {
      id: "crew-order-tune", slot: "f", prio: 7,
      canShow: function (p) {
        if (!showChief(p)) return false;
        const car = carOnMarks();
        return !!car && nextTuneTier(car) <= 3 && (((car.mods && car.mods.perf) | 0) < 3);
      },
      label: function () {
        const car = carOnMarks();
        const t = car ? nextTuneTier(car) : 1;
        return "Order: race tune Stage " + t + " (" + fmt$(TUNE_PRICE[t] || 0) + ")";
      },
      onSelect: function () {
        const car = carOnMarks(); if (!car) { note("Crew chief: “Roll it onto the marks first.”", 2.2); return; }
        const t = nextTuneTier(car);
        startOrder("tune", TUNE_PRICE[t] || 0, function (c2) {
          // the modshop pipeline IS the tune — feel + gear torque + visuals.
          if (CBZ.cityRestoreCarMods) {
            const mods = Object.assign({}, c2.mods || {}, { perf: t });
            CBZ.cityRestoreCarMods(c2, { mods: mods });
          }
          note("Crew chief: “Stage " + t + ". Mind the throttle now.”", 2.6);
        }, "“Stage " + t + " build. Cams, map, the works.”");
      },
    });
    I.register("ped:civ", {
      id: "crew-order-livery", slot: "g", prio: 7,
      canShow: function (p) {
        if (!showChief(p)) return false;
        const car = carOnMarks();
        return !!car && !car._leagueLivery;
      },
      label: function () { return "Order: league livery, #99 ($400)"; },
      onSelect: function () {
        startOrder("livery", 400, function (c2) {
          if (CBZ.cityApplyRaceLivery && c2.group) {
            try {
              CBZ.cityApplyRaceLivery(c2.group, {
                number: 99, base: c2.color != null ? c2.color : 0x9aa4b2, accent: 0xffd451,
              });
              c2._leagueLivery = true;
            } catch (e) {}
          }
          note("Your number is on the doors. The street knows who's driving.", 2.6);
        }, "“Number 99 on the doors. Make it mean something.”");
      },
    });
  }

  // ============================================================
  //  §6  PINK SLIPS — the Star verb. Beat a NAMED rival one-on-one at
  //  Diamond and you win the ACTUAL machine he drove (his livery on your
  //  key ring — categorical). Lose, bail, or wreck, and yours is his.
  // ============================================================
  const PS = {
    active: false, phase: "idle", m: null, racer: null, kit: null,
    countT: 0, laps: 2, playerLastT: 0, playerLaps: 0, playerTotal: 0,
    transfers: 0, starts: 0, myCar: null,
  };
  function psCourse() {
    return (CBZ.raceKit && CBZ.raceKit.course && CBZ.raceKit.course("speedway")) || CBZ.speedwayCourse || null;
  }
  function psCarName(racer) {
    if (CBZ.raceDrivers && CBZ.raceDrivers.modelForStyle) {
      const m = CBZ.raceDrivers.modelForStyle(racer.homeStyle || "muscle", racer.teamColor);
      if (m && m.name) return m.name;
    }
    return "machine";
  }
  function psStart(racer) {
    if (PS.active) return;
    if (!CFG.RACE_PINKSLIP || !can("pinkslip")) return;
    const P = CBZ.player;
    const C = psCourse();
    if (!C || !CBZ.raceDrivers || !CBZ.raceKit) { note("The duel needs the Diamond oval.", 2.2); return; }
    if (CBZ.speedwayRaceState && CBZ.speedwayRaceState().active) { note("The oval is live, wait for the flag.", 2.2); return; }
    if (CBZ.cityStreetRacing && CBZ.cityStreetRacing.state && CBZ.cityStreetRacing.state().active) { note("Finish the street race first.", 2.2); return; }
    const car = P && P.driving ? P._vehicle : null;
    if (!car || car.dead) { note("Pink slips means YOUR car on the line. Drive one you own to him.", 2.6); return; }
    if (!car.owned || car._loaner) { note("He laughs: “That's not yours to stake.” Bring a car you OWN.", 2.8); return; }
    // grid the two of you
    const rSlot = C.gridSlot(0), pSlot = C.gridSlot(1);
    const m = CBZ.raceDrivers.spawn({
      x: rSlot.x, z: rSlot.z, heading: rSlot.heading,
      style: racer.homeStyle || "muscle", color: racer.teamColor,
      livery: (CBZ.cityRacing && CBZ.cityRacing.liveryFor) ? CBZ.cityRacing.liveryFor(racer)
        : { number: racer.number, base: racer.teamColor, accent: racer.accent },
      name: racer.name, number: racer.number,
      skill: Math.min(0.98, (racer.skill || 0.8) + 0.02),
      aggr: 0.7, consistency: 0.6 + (racer.skill || 0.8) * 0.35,
      lane0: 2.6, tag: "pinkslip", course: "speedway",
      playerProgress: function () { return PS.playerTotal; },
    });
    if (!m) { note("His transporter's stuck, no duel tonight.", 2.2); return; }
    m.laps = -1; m._racer = racer;
    const py = CBZ.speedwaySurfaceY ? CBZ.speedwaySurfaceY(pSlot.x, pSlot.z) : 0;
    car.pos.x = pSlot.x; car.pos.z = pSlot.z; car.heading = pSlot.heading;
    car.v = 0; car.vx = 0; car.vz = 0;
    car.group.position.set(pSlot.x, py, pSlot.z);
    car.group.rotation.y = pSlot.heading;
    P.pos.set(pSlot.x, py, pSlot.z);
    if (CBZ.cam) { CBZ.cam.yaw = pSlot.heading; CBZ.cam.pitch = 0.12; }
    PS.active = true; PS.phase = "grid"; PS.m = m; PS.racer = racer;
    PS.countT = 3.8; PS.myCar = car; PS.starts++;
    PS.playerLaps = -1; PS.playerTotal = -0.02;
    PS.playerLastT = C.paramAt ? C.paramAt(pSlot.x, pSlot.z) : 0;
    PS.kit = CBZ.raceKit.create({
      course: "speedway", laps: PS.laps,
      entrants: [
        { id: "rival", name: racer.name, number: racer.number, color: racer.teamColor, driver: m,
          progress: function () { return m.laps + m.t; },
          speed: function () { return Math.abs((m.car && m.car.v) || 0); }, lapFloor0: -1 },
        { id: "you", name: "YOU", number: null, color: null, isPlayer: true,
          progress: function () { return PS.playerTotal; },
          speed: function () { const c2 = CBZ.player && CBZ.player._vehicle; return Math.abs((c2 && c2.v) || 0); },
          lapFloor0: -1 },
      ],
    });
    if (CBZ.raceHud) { CBZ.raceHud.show(); CBZ.raceHud.lights(0); }
    big("PINK SLIPS · " + racer.name.toUpperCase());
    note(PS.laps + " laps. His " + psCarName(racer) + " against your ride. Nobody shakes on a maybe.", 3.6);
  }
  function psFinish(win, why) {
    const racer = PS.racer, m = PS.m, myCar = PS.myCar;
    const RD = CBZ.raceDrivers;
    racer.slips = racer.slips || { won: 0, lost: 0 };
    if (win) {
      // THE ACTUAL MACHINE changes hands — not a copy of it.
      const car2 = RD && RD.release ? RD.release(m) : null;
      if (car2 && !car2.dead) {
        car2.owned = true; car2.ai = false; car2._loaner = false;
        car2._pinkslip = racer.number;
        car2.engineHp = 100; car2._smoking = false;
        car2.v = 0; car2.vx = 0; car2.vz = 0;
        PS.transfers++;
        racer.slips.lost++;
        big("YOU TOOK HIS CAR");
        note(racer.name + " signs the slip. His " + psCarName(racer) + " · his number still on the doors, is YOURS, where it stopped.", 5.0);
      } else if (RD) { RD.despawnAll("pinkslip"); }
    } else {
      if (RD) RD.despawnAll("pinkslip");
      racer.slips.won++;
      if (myCar && !myCar.dead) {
        if (CBZ.player && CBZ.player._vehicle === myCar && CBZ.cityExitVehicle) {
          try { CBZ.cityExitVehicle(); } catch (e) {}
        }
        myCar.owned = false; myCar._racerTrophy = racer.number;
        if (CBZ.cityApplyRaceLivery && myCar.group) {
          try {
            CBZ.cityApplyRaceLivery(myCar.group,
              (CBZ.cityRacing && CBZ.cityRacing.liveryFor) ? CBZ.cityRacing.liveryFor(racer)
                : { number: racer.number, base: racer.teamColor, accent: racer.accent });
          } catch (e) {}
        }
        PS.transfers++;
      }
      big("HE TOOK YOUR CAR");
      note(racer.name + ": “" + (why === "bailed" ? "Walk home. I'll drive." : "Sweet ride. MY sweet ride.") + "”, his number is going on your doors.", 5.0);
    }
    if (CBZ.cityEvent) CBZ.cityEvent("race-finish", {
      race: "pinkslip", place: win ? 1 : 2, win: win, dnf: why === "bailed" || why === "wrecked",
      profit: 0, driver: win ? 8 : 2, respect: win ? 10 : 0,
      message: win ? ("Took " + racer.name + "'s car on a pink slip.") : ("Lost the car to " + racer.name + "."),
    });
    if (CBZ.raceHud) {
      CBZ.raceHud.hide();
      CBZ.raceHud.results([
        { pos: 1, name: win ? "YOU" : racer.name, number: win ? null : racer.number, color: win ? null : racer.teamColor, time: "", pts: null, purse: 0, you: win },
        { pos: 2, name: win ? racer.name : "YOU", number: win ? racer.number : null, color: win ? racer.teamColor : null, time: "", pts: null, purse: 0, you: !win },
      ], {
        title: win ? "PINK SLIPS · THE CAR IS YOURS" : "PINK SLIPS · GONE",
        sub: "Diamond Speedway · winner takes the machine",
        foot: win ? "It's parked where it stopped. Drive it home." : "Wins put your name back on a door.",
        touchFoot: win ? "It's parked where it stopped." : "Wins put your name back on a door.",
      });
    }
    PS.active = false; PS.phase = "idle"; PS.m = null; PS.kit = null; PS.myCar = null; PS.racer = null;
  }
  function psTick(dt) {
    if (!PS.active) return;
    const P = CBZ.player, C = psCourse();
    if (!P || !C) { PS.active = false; return; }
    const car = P.driving ? P._vehicle : null;
    if (!car || car.dead) {
      // bailing out of a pink-slip race IS losing it — real stakes.
      psFinish(false, car && car.dead ? "wrecked" : "bailed");
      return;
    }
    if (PS.phase === "grid") {
      PS.countT -= dt;
      const c = PS.countT;
      if (c > 0) { if (CBZ.raceHud) CBZ.raceHud.lights(c > 2.5 ? 1 : c > 1.2 ? 2 : 3); return; }
      PS.phase = "run"; PS.lightsT = 1.4;
      if (CBZ.raceHud) CBZ.raceHud.lights("go");
      if (CBZ.raceDrivers) CBZ.raceDrivers.setState("race", "pinkslip");
      note("GREEN, for keeps!", 1.8);
    }
    if (PS.lightsT > 0) { PS.lightsT -= dt; if (PS.lightsT <= 0 && CBZ.raceHud) CBZ.raceHud.lights(-1); }
    const pt = C.paramAt ? C.paramAt(car.pos.x, car.pos.z) : 0;
    if (PS.playerLastT > 0.85 && pt < 0.15) PS.playerLaps++;
    else if (PS.playerLastT < 0.15 && pt > 0.85) PS.playerLaps--;
    PS.playerLastT = pt;
    PS.playerTotal = PS.playerLaps + pt;
    if (PS.kit) {
      PS.kit.update(dt);
      const cx = PS.kit.playerContext();
      if (cx && CBZ.raceHud) {
        CBZ.raceHud.update({
          pos: cx.row.pos, count: 2,
          lap: Math.max(1, Math.min(PS.laps, PS.playerLaps + 1)), laps: PS.laps,
          lapT: PS.kit.time - cx.row.lapStart, best: cx.row.best,
          gapA: cx.ahead ? { name: cx.ahead.name, s: cx.gapA } : null,
          gapB: cx.behind ? { name: cx.behind.name, s: cx.gapB } : null,
        });
      }
    }
    const rivalTotal = PS.m ? (PS.m.laps + PS.m.t) : -99;
    if (PS.playerTotal >= PS.laps) { psFinish(true, "flag"); return; }
    if (rivalTotal >= PS.laps) { psFinish(false, "flag"); return; }
    if (PS.m && (PS.m.dnf || (PS.m.car && PS.m.car.dead))) { psFinish(true, "rival-wrecked"); return; }
  }
  function pinkSlipInteractions(I) {
    I.register("ped:civ", {
      id: "racer-pinkslip", slot: "g", prio: 5,
      canShow: function (p) {
        return !!(CFG.RACE_PINKSLIP && p && p._racer && !p.dead && can("pinkslip") && !PS.active);
      },
      label: function (p) {
        const r = p._racer;
        return "PINK SLIPS, your car vs his " + psCarName(r);
      },
      onSelect: function (p) { if (p._racer) psStart(p._racer); },
    });
  }

  // ============================================================
  //  §7  ZONES — the shelf plaques and the door explainers (words at the
  //  place, never a new panel).
  // ============================================================
  let zonesDone = false;
  function registerZones(I) {
    if (zonesDone || !I || !I.registerZone) return;
    zonesDone = true;
    I.registerZone({
      id: "zone-race-shelf", kind: "racecase", prio: 5,
      find: function (px, pz) {
        if (!SHELF) return null;
        if (Math.hypot(px - SHELF.x, pz - SHELF.z) > 5) return null;
        if (!SHELF._zt) SHELF._zt = { x: SHELF.x, z: SHELF.z };
        return SHELF._zt;
      },
      options: [{
        id: "race-shelf-read", slot: "e",
        label: function () { return "Read the plaques"; },
        onSelect: function () { note(plaqueText(), 4.6); },
      }],
    });
    I.registerZone({
      id: "zone-race-doors", kind: "racedoor", prio: 4,
      find: function (px, pz) {
        for (let i = 0; i < DOORS.length; i++) {
          const d = DOORS[i];
          if (Math.hypot(px - d.x, pz - d.z) < 8) {
            if (!d._zt) d._zt = { x: d.x, z: d.z, _door: d };
            return d._zt;
          }
        }
        return null;
      },
      options: [{
        id: "race-door-try", slot: "e",
        label: function (t) {
          const d = t && t._door;
          if (!d) return "Try the door";
          return d.locked ? "Try the door. LOCKED" : "Door: open to you";
        },
        onSelect: function (t) {
          const d = t && t._door;
          if (!d) return;
          if (d.locked) {
            const s = stats(), tier = myTier();
            const F = CBZ.factions && CBZ.factions.def ? CBZ.factions.def(ORG) : null;
            const needIdx = F ? (function () {
              for (let i = 0; i < F.ranks.length; i++) if (F.ranks[i].grants.indexOf(d.verb) >= 0) return i;
              return -1;
            })() : -1;
            const price = needIdx > 0 && NEED[needIdx] ? NEED[needIdx].text : "rank";
            note(d.why() + "  [Price: " + price + " · you: " + s.starts + " starts, " + s.podiums +
              " podiums, " + s.wins + " wins, " + s.titles + " titles · rank " + (tier < 0 ? "unlicensed" : tier) + "]", 5.4);
          } else note("It's yours. Walk in.", 1.8);
        },
      }],
    });
    if (I.describe) {
      I.describe("racecase", function () {
        return { label: "Trophy shelf", note: TROPHY.cups + " cups · every one was a race" };
      });
      I.describe("racedoor", function () {
        return { label: "League door", note: "Rank opens it, the door quotes its price" };
      });
    }
  }

  // ============================================================
  //  §8  THE MAINTAINER — one loop: declare → build once → sync rank/doors/
  //  trophies/crew → tick the pink-slip duel. Early-outs keep it ~free.
  // ============================================================
  let slowT = 0, interactionsDone = false;
  CBZ.onUpdate(35.9, function (dt) {
    if (!g || g.mode !== "city") return;
    if (!CFG.RACE_LADDER) return;
    declareLeague();

    // one-shot geometry per arena root — only in a world that actually BUILT
    // the speedway (region test, the same guard games/racing.js uses)
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.root && PL.root !== A.root) {
      PL.root = A.root;                      // one decision per world build
      const regs = (A.regions || (CBZ.city && CBZ.city.regions) || []);
      const hasSpeedway = regs.some(function (r) { return r && (r.biome === "speedway" || /speedway/i.test(r.name || "")); });
      const P = hasSpeedway ? places() : null;
      if (P) {
        DOORS.length = 0; PL.count = 0;
        SHELF = null; MARKS = null; CHAMP = null; BAY = null;
        CREW.posts.length = 0; CREW.declaredPosts = false; CREW.order = null;
        TROPHY.key = ""; TROPHY.group = null;
        try {
          if (P.structures) {
            buildPaddockGate(A.root, P);
            buildBay12(A.root, P);
          }
          buildChampGarage(A.root);
          if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        } catch (e) { /* venue absent (no speedway world) — stays inert */ }
        PL.built = PL.count > 0;
      }
    }

    if (!interactionsDone && CBZ.interactions && CBZ.interactions.register) {
      interactionsDone = true;
      crewInteractions(CBZ.interactions);
      pinkSlipInteractions(CBZ.interactions);
      registerZones(CBZ.interactions);
    }

    // per-frame: doors + duel + crew timer
    syncDoors(dt);
    psTick(dt);
    tickOrder(dt);
    if (CHAMP && CHAMP.display) CHAMP.display.rotation.y += (dt || 0.016) * 0.22;

    // slow lane: rank/membership/trophies/crew declarations
    slowT -= dt || 0;
    if (slowT > 0) return;
    slowT = 1.2;
    syncMembership();
    syncRank();
    syncTrophies();
    declareCrewPosts();
    if (CHAMP && !CHAMP.minted) mintUnicorn();
  });

  // ============================================================
  //  §9  EXPORTS + AUDIT
  // ============================================================
  CBZ.raceLadder = {
    org: ORG,
    tier: myTier,
    can: can,
    stats: stats,
    need: function () { return NEED.slice(1).map(function (n) { return n.text; }); },
    doors: function () {
      return DOORS.map(function (d) { return { id: d.id, verb: d.verb, locked: d.locked, opens: d.openN }; });
    },
    pinkSlip: function () { return { active: PS.active, phase: PS.phase, starts: PS.starts, transfers: PS.transfers }; },
    crew: function () { return { posts: CREW.posts.length, staffed: crewBodies().length, run: CREW.run, order: CREW.order ? CREW.order.kind : null }; },
    startPinkSlip: psStart,               // probe surface
  };

  CBZ.raceAudit = function () {
    const F = CBZ.factions && CBZ.factions.def ? CBZ.factions.def(ORG) : null;
    let rungs = 0, verbed = 0;
    if (F && F.ranks) {
      rungs = F.ranks.length;
      for (let i = 0; i < F.ranks.length; i++) if (F.ranks[i].grants && F.ranks[i].grants.length) verbed++;
    }
    let locked = 0;
    for (let i = 0; i < DOORS.length; i++) if (DOORS[i].locked) locked++;
    const s = stats();
    return {
      rungs: rungs,
      verbedRungs: verbed,
      verblessRungs: rungs - verbed,           // 0 by construction
      doors: DOORS.length,
      lockedDoors: locked,
      placesBuilt: PL.count,
      rivals: (CBZ.cityRacing && CBZ.cityRacing.standings) ? CBZ.cityRacing.standings().length : 0,
      pinkSlipRaces: (raceRec("pinkslip").starts | 0) + PS.starts,
      pinkSlipTransfers: PS.transfers,
      trophies: TROPHY.cups,
      crewOrders: 3,
      crewOrdersRun: CREW.run,
      crewStaffed: crewBodies().length,
      unicornMinted: !!(CHAMP && CHAMP.minted),
      tier: myTier(),
      ledger: s,
      street: (CBZ.cityStreetRacing && CBZ.cityStreetRacing.audit) ? CBZ.cityStreetRacing.audit() : null,
    };
  };
})();
