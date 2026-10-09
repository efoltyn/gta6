/* ============================================================
   city/warroom.js — THE COMMANDER IN CHIEF. A President goes to war, buys
   the aircraft and the weapons, and orders them flown.

   OWNER: "MAKE IT SO PRESIDENT CAN GO TO WAR AND ORDER AIRSTRIKE AND IF
   THEY HAVE NUKES ORDER NUKE" · "EVERY BOMB PAYLOAD NEEDS A SPECIFIC PLANE,
   AND THAT NEEDS TO BE BOUGHT IF NOT ALREADY HAD. ... YOU CAN BECOME
   PRESIDENT OF A SMALLER COUNTRY, GET NUKES, AND GET A B2, AND THEN ORDER A
   NUKE STRIKE." · "THE BUNKER BUSTER, WHICH IS NEEDED TO ASSASSINATE ANYONE
   IN A BUNKER ... GIVES B2 AND REAL BUNKER BUSTER PAYLOAD MEANING".

   THE TABLE IS city/arsenal_data.js (CBZ.ARSENAL): which aircraft carries
   which payload, prices, delivery days, who owns what on day one, bunker
   hardness. This file gates and runs orders OFF that table — no if-chains
   per weapon. A payload is { carriers, flight, aircraft, each, kind, store }:
     strike  strike jets      -> playerair.js CBZ.cityStrikeFlight
     nuke    B-52 or B-2      -> strategic.js CBZ.strategicSortie (kind nuke)
     bunker  B-2 only, 2 MOPs -> strategic.js CBZ.strategicSortie (kind buster)
   Counts live on polwar.js's military record (planes/heavy/b2/warheads/mops,
   saved with it). A BOMBER IS A PHYSICAL THING: the sortie flies a parked
   record off its own pad, so a stolen or destroyed bomber cannot be ordered.

   AIR STATIONS. Every nation's aircraft park at its air station: a tarmac
   apron found on open ground near its capital (or Fort Brandt), or a
   concrete pier off the coast when an island capital has no room. Bought
   aircraft are DELIVERED there after their days and appear parked; the
   republic's own B-2 and B-52 are the two already on the Fort Brandt apron.

   BUNKERS (city/bunkers.js builds them; same door, shell, roof, breach):
   every head of state has one by his capital (the republic's is the Fort
   Brandt Deep Shelter); the Sons of the Dune have a dug-out in the Saltlands
   (known once the Bureau has intel — presidency.js's own flag). A leader goes
   underground when war comes, or when a strike is ordered on his country.
   Inside, he survives jets and survives a nuke unless it lands within the
   bunker's direct-hit radius; only GBU-57s from a B-2 open the roof, and a
   head of state's roof takes two in the same hole. A breach kills the man
   inside through officials.js's own succession (deputy sworn in, or a
   vacuum) and caves the mound in. A President can order his own bunker
   built; an AI leader rebuilds a breached one when he can afford to.

   BUYING is a WHEEL on the General in the Situation Room (presidency.js):
   Buy jet / Buy B-52 / Buy B-2 / Buy warhead / Buy MOP / Build bunker. Each
   is one verb; the General answers in one line. A first warhead is the big
   move: every nation sours on you and you are sanctioned for a week.

   THE WAR HAPPENS IN THE WORLD: while your country is at war and you stand
   on its soil, enemy jets bomb a block near you; a nuclear-armed enemy you
   nuke answers with its own bomber, from its own air station.

   EVENTS on presidency.js's bus (CBZ.presidency.on), each with `text`:
     war-declared, war-ended (polwar.js) · airstrike-ordered, airstrike ·
     nuke-launched, nuke · aircraft-bought, aircraft-delivered ·
     warhead-bought, mop-bought · sanctions · bunker-built, bunker-strike ·
     leader-killed

   PUBLIC: CBZ.warroom (see the bottom). LOAD: after presidency.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.warroom) return;
  const g = CBZ.game || (CBZ.game = {});
  const THREE = window.THREE;

  const RAID_FIRST = [45, 75];   // s after war reaches you before the first raid
  const RAID_GAP = [140, 230];   // s between raids
  const RETALIATE_S = 40;        // s from their country burning to their bomber rolling
  const NUKE_MATCH_R = 1600;     // m: a detonation this close to an ordered aimpoint is that order
  const STATION = { w: 170, d: 80 };
  const BOMBER_SLOTS = [-62, 0, 62], JET_SLOTS = [-72, -36, 0, 36, 72];

  let CLOCK = 0;
  const PEND = [];               // ordered nukes in the air: {x,z,attacker,target,label,byPlayer,t}
  const RAID = { t: null, n: 0, foe: null };
  let RET = null;                // {foe, us, at}
  const FB = { ped: null, mesh: null, down: null };   // the football: carrier, the case, a case set down (THE FOOTBALL below)
  const PARK = Object.create(null);    // nation -> { built, jet:[recs], heavy:[recs], b2:[recs], meshes:[] }
  const OUT = Object.create(null);     // nation -> strike jets in the air

  // ---------------------------------------------------------------- helpers
  function A() { return CBZ.ARSENAL || null; }
  function PW() { return CBZ.polwar || null; }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : 0.5; }
  function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function emit(evt, payload) {
    const P = CBZ.presidency;
    if (P && typeof P.emit === "function") { try { P.emit(evt, payload); } catch (e) {} }
  }
  function W() {                               // the saved world (rides polwar's blob)
    const pw = PW();
    const S = pw && pw.arsenalState ? pw.arsenalState() : (g._warroomFallback || (g._warroomFallback = {}));
    if (!S.deliveries) S.deliveries = [];
    if (!S.stations) S.stations = {};
    if (!S.bunkers) S.bunkers = {};
    if (!S.alerts) S.alerts = {};
    if (!S.sanctions) S.sanctions = {};
    if (!S.building) S.building = [];
    return S;
  }
  function polGet(id) { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; }
  function nameOf(id) {
    if (id === "cell") return "the Sons of the Dune";
    const r = id ? polGet(id) : null;
    if (r && r.name) return r.name;
    // never a raw key in a headline: "kesh_rebels_1" reads "Kesh Rebels"
    return id ? String(id).split(/[_\-]+/).filter(function (w) { return w && !/^\d+$/.test(w); })
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ") || null : null;
  }
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country" && h.rec) ? h : null;
  }
  function nation() { const h = seat(); return h ? h.id : null; }
  function enemyOf(id) {
    const pw = PW(); if (!id || !pw || !pw.activeWarFor) return null;
    const w = pw.activeWarFor(id);
    if (!w || w.ended) return null;
    return w.sides[0] === id ? w.sides[1] : w.sides[0];
  }
  function enemy() { return enemyOf(nation()); }
  function milOf(id) { const pw = PW(); return (id && pw && pw.militaryOf) ? pw.militaryOf(id) : null; }
  function count(id, key) {
    const m = milOf(id), T = A(); if (!m || !T) return 0;
    const def = T.aircraft[key] || T.stores[key];
    return def ? (m[def.field] | 0) : 0;
  }
  function warheads(id) { return count(id || nation(), "warhead"); }
  function shock(id, n) { if (CBZ.approvalShock && id) { try { CBZ.approvalShock(id, n); } catch (e) {} } }
  // THE ACT (city/politics.js): what the country feels about a war, a
  // strike, a bomb on its own soil is one row of the act table. No act
  // table loaded (a headless harness), the old flat shock stands in.
  function polAct(kind, o, fallback) {
    const Po = CBZ.politics;
    if (Po && Po.act && Po.owns && Po.owns(nation())) { try { Po.act(kind, o || {}); return true; } catch (e) {} }
    if (fallback) fallback();
    return false;
  }
  function scandal(n) {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const p = (w && w.politics) || g.cityPolitics;
    if (p) p.scandal = Math.max(0, Math.min(100, (p.scandal || 0) + n));
  }
  function capFirst(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function line(path, key) { const L = A() && A().lines; const v = L && L[path]; return v && typeof v === "object" ? (v[key] || "") : (v || ""); }

  // WHOSE GROUND IS THIS. A city/base rect first (polity.of), then a state's
  // rect (the republic's mainland is one), then nobody's — open sea.
  function inRect(r, x, z) { return r && Math.abs(x - r.cx) <= r.hx && Math.abs(z - r.cz) <= r.hz; }
  function placeAt(x, z) {
    const P = CBZ.polity; if (!P) return null;
    let rec = null;
    try { rec = P.of ? P.of(x, z) : null; } catch (e) { rec = null; }
    if (!rec && P.list) {
      const st = P.list("state") || [];
      for (let i = 0; i < st.length; i++) if (inRect(st[i].rect, x, z)) { rec = st[i]; break; }
    }
    return rec;
  }
  function nationAt(x, z) {
    const rec = placeAt(x, z);
    if (!rec) return null;
    const c = CBZ.polity.countryOf ? CBZ.polity.countryOf(rec.id) : null;
    return c ? c.id : null;
  }
  function placeName(x, z) { const r = placeAt(x, z); return r ? r.name : null; }

  function capitalPoint(id) {
    const pw = PW(); if (!pw) return null;
    const cap = pw.capitalOf ? pw.capitalOf(id) : null;
    if (cap) { const r = polGet(cap.id); return { x: cap.cx, z: cap.cz, name: (r && r.name) || nameOf(id), id: cap.id, rect: r && r.rect }; }
    const a = pw.anchorOf ? pw.anchorOf(id) : null;
    return a ? { x: a.x, z: a.z, name: nameOf(id), id: null, rect: null } : null;
  }
  // where a head of state LIVES: the Executive Mansion for the republic's,
  // the capital for everyone else's
  function residence(id) {
    if (id === "cell") {
      const h = CBZ.presidency && CBZ.presidency.cellHome ? CBZ.presidency.cellHome() : null;
      return h ? { x: h.x, z: h.z, name: h.name || "the Saltlands" } : null;
    }
    if (id === "republic" && CBZ.presidency && CBZ.presidency.site) {
      const s = CBZ.presidency.site();
      if (s && isFinite(s.cx)) return { x: s.cx, z: s.cz, name: "the Executive Mansion" };
    }
    return capitalPoint(id);
  }
  function waypoint() {
    try {
      const w = CBZ.fullMap && CBZ.fullMap.waypoint && CBZ.fullMap.waypoint();
      return (w && isFinite(w.x) && isFinite(w.z)) ? w : null;
    } catch (e) { return null; }
  }
  function aimPoint() {
    const P = CBZ.player;
    if (!P || !P.pos) return null;
    const y = (CBZ.cam && CBZ.cam.yaw) || 0;
    const x = P.pos.x - Math.sin(y) * 140, z = P.pos.z - Math.cos(y) * 140;
    return { x: x, z: z, label: placeName(x, z) || "the mark", nation: nationAt(x, z), src: "aim" };
  }
  // THE TARGET: the map's mark, else (at war) the enemy capital, else (only
  // when the caller allows it) where you are looking.
  function target(opts) {
    opts = opts || {};
    const wp = waypoint();
    if (wp) return { x: wp.x, z: wp.z, label: placeName(wp.x, wp.z) || wp.label || "the mark", nation: nationAt(wp.x, wp.z), src: "map" };
    const foe = enemyOf(opts.nation || nation());
    if (foe) {
      const c = capitalPoint(foe);
      if (c) return { x: c.x, z: c.z, label: c.name, nation: foe, src: "war" };
    }
    return opts.aim ? aimPoint() : null;
  }
  function mostHostile(us) {
    if (!CBZ.polity || !CBZ.polity.list) return null;
    const l = CBZ.polity.list("country") || [];
    let best = null, bv = Infinity;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c || c.id === us) continue;
      const v = CBZ.relations && CBZ.relations.get ? (CBZ.relations.get(us, c.id) || 0) : 0;
      if (v < bv) { bv = v; best = c.id; }
    }
    return best ? { id: best, rel: bv } : null;
  }
  function channelBusy() {
    if (PEND.length) return true;
    try { const s = CBZ.strategicSortieState ? CBZ.strategicSortieState() : null; return !!(s && s.channelBusy); }
    catch (e) { return false; }
  }
  function payload(tgt, attacker, extra) {
    const o = {
      x: Math.round(tgt.x), z: Math.round(tgt.z), label: tgt.label || null, place: tgt.label || null,
      nation: tgt.nation || null, nationName: nameOf(tgt.nation), target: tgt.nation || null,
      attacker: attacker || null, attackerName: nameOf(attacker), day: day(),
    };
    if (extra) for (const k in extra) o[k] = extra[k];
    return o;
  }
  function alert(id, days) {
    if (!id) return;
    const S = W();
    S.alerts[id] = Math.max(S.alerts[id] || -1, day() + (days || 3));
  }
  function goToWar(us, foe) {
    const pw = PW();
    if (!foe || foe === us || !pw || !pw.declareWar || enemyOf(us) || enemyOf(foe)) return false;
    try { if (pw.declareWar(us, foe, { byPlayer: us === nation() })) { RAID.t = null; return true; } } catch (e) {}
    return false;
  }

  // ================================================================ AIR STATIONS
  // A place to park a fleet: open ground near the capital that no collider,
  // other station or bunker covers, inside the nation's own land; failing
  // that, a pier off the coast (an island capital is wall to wall town).
  function rectFree(r) {
    const C = CBZ.colliders || [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c || c.minX == null || (c.y0 != null && c.y0 > 4)) continue;
      if (c.maxX > r.minX && c.minX < r.maxX && c.maxZ > r.minZ && c.minZ < r.maxZ) return false;
    }
    const S = W();
    for (const k in S.stations) { const s = S.stations[k]; if (Math.abs(s.x - (r.minX + r.maxX) / 2) < (s.w + r.maxX - r.minX) / 2 && Math.abs(s.z - (r.minZ + r.maxZ) / 2) < (s.d + r.maxZ - r.minZ) / 2) return false; }
    for (const k in S.bunkers) { const b = S.bunkers[k]; if (Math.abs(b.cx - (r.minX + r.maxX) / 2) < (b.w + 16 + r.maxX - r.minX) / 2 && Math.abs(b.cz - (r.minZ + r.maxZ) / 2) < (b.d + 16 + r.maxZ - r.minZ) / 2) return false; }
    // a planned city's lots are built land even where its tile (and so its
    // colliders) is not streamed in yet: an apron never lands on a block
    const MC = (CBZ.metroCities || []).concat(CBZ.metroCountryside ? [CBZ.metroCountryside] : []);
    for (let m = 0; m < MC.length; m++) {
      const P = MC[m] && MC[m].plan, B = P && P.bounds;
      if (!P || !P.bldgs) continue;
      if (B && (r.maxX < B.minX - 200 || r.minX > B.maxX + 200 || r.maxZ < B.minZ - 200 || r.minZ > B.maxZ + 200)) continue;
      for (let i = 0; i < P.bldgs.length; i++) {
        const b = P.bldgs[i], h = Math.max(b.w, b.d) / 2 + 4;
        if (b.x + h > r.minX && b.x - h < r.maxX && b.z + h > r.minZ && b.z - h < r.maxZ) return false;
      }
    }
    return true;
  }
  function findSite(anchor, w, d, owner, opts) {
    opts = opts || {};
    const inside = opts.inside || function (x, z) { return nationAt(x, z) === owner; };
    for (let r = opts.r0 || 60; r <= (opts.r1 || 320); r += 16) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + h01(r, k, 0x5a7) * 0.3;
        const cx = anchor.x + Math.sin(a) * r, cz = anchor.z + Math.cos(a) * r;
        const rr = { minX: cx - w / 2 - 4, maxX: cx + w / 2 + 4, minZ: cz - d / 2 - 4, maxZ: cz + d / 2 + 4 };
        if (!inside(rr.minX, rr.minZ) || !inside(rr.maxX, rr.minZ) || !inside(rr.minX, rr.maxZ) || !inside(rr.maxX, rr.maxZ) || !inside(cx, cz)) continue;
        if (rectFree(rr)) return { x: Math.round(cx), z: Math.round(cz), pier: false };
      }
    }
    // THE PIER: straight out to sea, away from the middle of the world, past
    // the edge of the place the anchor stands in
    const rect = opts.rect || null;
    let dx = anchor.x, dz = anchor.z, l = Math.hypot(dx, dz);
    if (!(l > 1)) { dx = 1; dz = 0; l = 1; }
    dx /= l; dz /= l;
    const half = rect ? Math.abs(dx) * rect.hx + Math.abs(dz) * rect.hz : 120;
    const reach = half + 14 + (Math.abs(dx) * w + Math.abs(dz) * d) / 2;
    return { x: Math.round(anchor.x + dx * reach), z: Math.round(anchor.z + dz * reach), pier: true };
  }
  function stationAnchor(id) {
    if (id === "republic") { const fb = polGet("fortbrandt"); if (fb && fb.rect) return { x: fb.rect.cx, z: fb.rect.cz, rect: fb.rect }; }
    const c = capitalPoint(id);
    return c ? { x: c.x, z: c.z, rect: c.rect } : null;
  }
  function stationOf(id) {
    const S = W();
    if (S.stations[id]) return S.stations[id];
    const an = stationAnchor(id);
    if (!an) return null;
    const site = findSite(an, STATION.w, STATION.d, id, { rect: an.rect, r0: 80, r1: 360 });
    S.stations[id] = { x: site.x, z: site.z, w: STATION.w, d: STATION.d, pier: !!site.pier };
    return S.stations[id];
  }

  function mat(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function slab(root, cx, cz, w, d, y0, y1, hex) {
    const geo = CBZ.boxGeom ? CBZ.boxGeom(w, y1 - y0, d) : new THREE.BoxGeometry(w, y1 - y0, d);
    const m = new THREE.Mesh(geo, mat(hex));
    m.position.set(cx, (y0 + y1) / 2, cz);
    m.receiveShadow = true;
    root.add(m);
    return m;
  }
  // the ground a station or bunker stands on: tarmac on land, a concrete
  // pier (with a walkable top) at sea
  function groundFor(root, s, w, d, list) {
    if (s.pier) {
      list.push(slab(root, s.x, s.z, w + 12, d + 12, -7, 0.1, 0x7d8085));
      list.push(slab(root, s.x, s.z, w + 13, d + 13, -0.4, -0.1, 0x5f6267));       // the splash course
      (CBZ.platforms = CBZ.platforms || []).push({ minX: s.x - (w + 12) / 2, maxX: s.x + (w + 12) / 2, minZ: s.z - (d + 12) / 2, maxZ: s.z + (d + 12) / 2, top: 0.1, _warroom: true });
      return 0.1;
    }
    list.push(slab(root, s.x, s.z, w, d, 0.0, 0.05, 0x3a3e43));
    return 0;
  }
  function buildStation(id) {
    const P = PARK[id] || (PARK[id] = { built: false, jet: [], heavy: [], b2: [], meshes: [], top: 0 });
    if (P.built || !THREE) return P;
    const ar = CBZ.city && CBZ.city.arena, root = (ar && ar.root) || CBZ.scene;
    const s = stationOf(id);
    if (!root || !s) return P;
    P.top = groundFor(root, s, s.w, s.d, P.meshes);
    // painted taxi line and stands
    P.meshes.push(slab(root, s.x, s.z - 6, s.w - 10, 0.5, P.top, P.top + 0.06, 0xd8b23a));
    P.built = true;
    return P;
  }
  // the republic's own two bombers are the ones parked at Fort Brandt
  function nativeBombers(id, type) {
    if (id !== "republic") return [];
    let r = null;
    if (type === "b2") r = CBZ.strategicB2Rec ? CBZ.strategicB2Rec() : null;
    else if (type === "heavy") {
      const L = CBZ.cityMilitaryVehicles || [];
      for (let i = 0; i < L.length; i++) if (L[i] && L[i].model && L[i].model.name === "Heavy Bomber") { r = L[i]; break; }
    }
    if (!r) return [];
    r.ownCrew = true;            // the air force has its crews; a trooper on the base still takes the seat
    r.owner = r.owner || "republic";
    return [r];
  }
  function makeAirframe(type) {
    try {
      if (type === "b2") { const m = CBZ.strategicModels && CBZ.strategicModels.b2 ? CBZ.strategicModels.b2() : null; return m ? { group: m.group, footW: m.dims.span, footL: m.dims.length, height: m.dims.height, colW: 9.2, colL: m.dims.length, dims: m.dims, name: "B-2 SPIRIT" } : null; }
      const M = CBZ.milModels;
      const fn = M && (type === "heavy" ? M.bomber : M.jet);
      const m = fn ? fn() : null;
      return m ? { group: m.group, footW: m.footW, footL: m.footL, height: m.height, colW: m.colliderW || Math.min(6, m.footW), colL: m.colliderL || m.footL, dims: m.aircraftDims, name: type === "heavy" ? "B-52 Bomber" : "Strike Jet" } : null;
    } catch (e) { return null; }
  }
  function parkAirframe(id, type, slot) {
    const P = buildStation(id), s = stationOf(id);
    const ar = CBZ.city && CBZ.city.arena, root = (ar && ar.root) || CBZ.scene;
    if (!P.built || !root) return null;
    const made = makeAirframe(type);
    if (!made) return null;
    const bomberRow = type !== "jet";
    const x = s.x + (bomberRow ? BOMBER_SLOTS[slot] : JET_SLOTS[slot]);
    const z = s.z + (bomberRow ? 14 : -26);
    made.group.position.set(x, P.top, z);
    made.group.rotation.y = 0;
    made.group.userData.milKind = "plane";
    made.group.userData.milName = made.name;
    made.group.userData.dynamic = true;
    if (made.dims) made.group.userData.aircraftDims = made.dims;
    root.add(made.group);
    const solid = { minX: x - made.colW / 2, maxX: x + made.colW / 2, minZ: z - made.colL / 2, maxZ: z + made.colL / 2, y0: P.top, y1: P.top + (made.height || 4), ref: made.group };
    if (CBZ.colliders) CBZ.colliders.push(solid);
    const rec = {
      group: made.group, pos: made.group.position, heading: 0, kind: "plane", model: { name: made.name },
      collider: solid, colliderW: made.colW, colliderL: made.colL, footW: made.footW, footL: made.footL,
      aircraftDims: made.dims, modelYawOffset: 0, groundOffset: 0, taken: false, hot: true,
      b2: type === "b2", ownCrew: true, owner: id, airType: type, slot: slot,
    };
    if (bomberRow && CBZ.cityRegisterMilitaryVehicle) { try { CBZ.cityRegisterMilitaryVehicle(rec); } catch (e) {} }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return rec;
  }
  function dropAirframe(rec) {
    if (!rec) return;
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    const i = CBZ.colliders && rec.collider ? CBZ.colliders.indexOf(rec.collider) : -1;
    if (i >= 0) CBZ.colliders.splice(i, 1);
    const L = CBZ.cityMilitaryVehicles, j = L ? L.indexOf(rec) : -1;
    if (j >= 0) L.splice(j, 1);
  }
  // keep each station's parked fleet equal to what the nation OWNS
  function syncFleet(id) {
    const m = milOf(id);
    if (!m || !THREE) return;
    const wantJets = Math.max(0, Math.min(JET_SLOTS.length, (m.planes | 0) - (OUT[id] | 0)));
    const nh = nativeBombers(id, "heavy").length, nb = nativeBombers(id, "b2").length;
    const wantHeavy = Math.max(0, (m.heavy | 0) - nh), wantB2 = Math.max(0, (m.b2 | 0) - nb);
    if (!wantJets && !wantHeavy && !wantB2 && !PARK[id]) return;   // nothing to park: build nothing
    const P = buildStation(id);
    if (!P.built) return;
    // the lost go first (a downed bomber's record stays `lost`)
    for (const t of ["heavy", "b2"]) P[t] = P[t].filter(function (r) { if (r.lost) { dropAirframe(r); return false; } return true; });
    const used = {};
    for (const t of ["heavy", "b2"]) for (const r of P[t]) used[r.slot] = true;
    for (const [t, want] of [["heavy", wantHeavy], ["b2", wantB2]]) {
      while (P[t].length > want) dropAirframe(P[t].pop());
      while (P[t].length < want) {
        let slot = -1;
        for (let k = 0; k < BOMBER_SLOTS.length; k++) if (!used[k]) { slot = k; break; }
        if (slot < 0) break;                                       // the apron is full
        const r = parkAirframe(id, t, slot);
        if (!r) break;
        used[slot] = true;
        P[t].push(r);
      }
    }
    while (P.jet.length > wantJets) dropAirframe(P.jet.pop());
    while (P.jet.length < wantJets) { const r = parkAirframe(id, "jet", P.jet.length); if (!r) break; P.jet.push(r); }
  }
  function bombersOf(id, type) {
    const P = PARK[id];
    const own = P ? P[type] || [] : [];
    return nativeBombers(id, type).concat(own);
  }
  function freeCarrier(id, payloadKey) {
    const T = A(), pl = T && T.payloads[payloadKey];
    if (!pl) return null;
    for (let i = 0; i < pl.carriers.length; i++) {
      const t = pl.carriers[i];
      if (t === "jet") continue;
      if (count(id, t) <= 0) continue;
      const L = bombersOf(id, t);
      for (let k = 0; k < L.length; k++) {
        const ok = CBZ.strategicBomberAvailable ? CBZ.strategicBomberAvailable(L[k]) : !(L[k].taken || L[k]._aiActive);
        if (ok) return { rec: L[k], type: t };
      }
    }
    return null;
  }
  function carriersOwned(id, payloadKey) {
    const T = A(), pl = T && T.payloads[payloadKey];
    if (!pl) return 0;
    let n = 0;
    for (let i = 0; i < pl.carriers.length; i++) n += count(id, pl.carriers[i]);
    return n;
  }

  // ================================================================ ORDERS
  // ONE GATE FOR EVERY PAYLOAD, read off the table: the carrier, the store,
  // the target. `why` is always the General's one line.
  function gate(payloadKey, opts) {
    opts = opts || {};
    const T = A(), pl = T && T.payloads[payloadKey];
    const us = opts.nation || nation();
    if (!us) return { ok: false, why: "You do not hold the country." };
    if (!pl) return { ok: false, why: "We can't do that." };
    if (carriersOwned(us, payloadKey) <= 0) return { ok: false, why: line("noCarrier", payloadKey) };
    if (pl.store && count(us, pl.store) <= 0) return { ok: false, why: line("noStore", payloadKey) };
    let carrier = null;
    if (pl.flight === "jets") {
      if (!CBZ.cityStrikeFlight) return { ok: false, why: line("noCarrier", payloadKey) };
      if ((count(us, "jet") - (OUT[us] | 0)) <= 0) return { ok: false, why: "Our jets are already in the air, sir." };
    } else {
      carrier = freeCarrier(us, payloadKey);
      if (!carrier) return { ok: false, why: line("busy") };
      if (pl.kind === "nuke" && channelBusy()) return { ok: false, why: "One weapon at a time, sir." };
    }
    let tgt = null;
    if (payloadKey === "bunker") {
      const b = bunkerTarget(Object.assign({}, opts, { nation: us }));
      if (!b) return { ok: false, why: line("noBunker") };
      // the cell's dug-out is on our own soil but it is not our country we are bombing
      tgt = { x: b.interior.cx, z: b.interior.cz, label: b.name, nation: b.owner === "cell" ? null : b.owner, bunker: b };
    } else {
      tgt = opts.target || target({ aim: !!opts.aim, nation: us });
      if (!tgt) return { ok: false, why: line("noTarget") };
    }
    return { ok: true, us: us, pl: pl, carrier: carrier, tgt: tgt };
  }
  function hasMeans(payloadKey, id) {
    id = id || nation();
    const T = A(), pl = T && T.payloads[payloadKey];
    if (!id || !pl) return false;
    if (pl.store && count(id, pl.store) <= 0) return false;
    if (pl.flight === "jets") return count(id, "jet") > 0;
    return !!freeCarrier(id, payloadKey);
  }
  // what a nation that cannot fly a payload is missing, in one line (or "")
  function missingLine(payloadKey, id) {
    id = id || nation();
    const T = A(), pl = T && T.payloads[payloadKey];
    if (!id || !pl) return "";
    const hasStore = !pl.store || count(id, pl.store) > 0;
    const hasCarrier = carriersOwned(id, payloadKey) > 0;
    if (hasStore && !hasCarrier) return payloadKey === "nuke" ? "We have warheads and nothing to carry them, sir." : line("noCarrier", payloadKey);
    if (!hasStore && hasCarrier && payloadKey === "nuke") return "The bombers are ready. We have no warheads, sir.";
    return "";
  }

  function order(payloadKey, opts) {
    opts = opts || {};
    const gt = gate(payloadKey, opts);
    if (!gt.ok) return gt;
    const us = gt.us, pl = gt.pl, tgt = gt.tgt;
    const byPlayer = us === nation();
    const foe = tgt.nation && tgt.nation !== us ? tgt.nation : null;
    const m = milOf(us);
    let res = null;
    if (pl.flight === "jets") {
      const jets = Math.max(1, Math.min(pl.aircraft, count(us, "jet") - (OUT[us] | 0)));
      const st = stationOf(us);
      OUT[us] = (OUT[us] | 0) + jets;
      const f = CBZ.cityStrikeFlight({
        x: tgt.x, z: tgt.z, jets: jets, bombs: pl.each, kind: pl.kind,
        from: st ? { x: st.x, z: st.z } : null, by: null, byPlayer: false, stateAct: true,
        side: byPlayer ? "ours" : "enemy", label: tgt.label, data: { warroom: us },
        onImpact: function (im, fl, n) {
          exposedCheck(im.x, im.z, "bomb", us);
          if (n !== 1) return;
          let hit = null;
          if (foe && PW() && PW().strikeOn) { try { hit = PW().strikeOn(foe, us, 1); } catch (e) {} }
          emit("airstrike", payload(tgt, us, {
            byPlayer: byPlayer, jets: jets, bombs: jets * pl.each, killed: hit ? hit.soldiers : 0,
            text: nameOf(us) + " airstrike hits " + (tgt.label || nameOf(foe) || "the target"),
          }));
        },
        onDone: function () { OUT[us] = Math.max(0, (OUT[us] | 0) - jets); },
      });
      if (!f) { OUT[us] = Math.max(0, (OUT[us] | 0) - jets); return { ok: false, why: "Nothing can get airborne right now, sir." }; }
      res = { line: (jets > 1 ? "Two jets" : "One jet") + " wheels up for " + (tgt.label || "the mark") + "." };
      emit("airstrike-ordered", payload(tgt, us, { byPlayer: byPlayer, jets: jets, bombs: jets * pl.each, text: nameOf(us) + " orders an airstrike on " + (tgt.label || "a target") }));
    } else {
      const storeDef = pl.store ? (A().stores[pl.store]) : null;
      const n = storeDef ? Math.max(1, Math.min(pl.each, m[storeDef.field] | 0)) : pl.each;
      const carrier = gt.carrier;
      const r = CBZ.strategicSortie ? CBZ.strategicSortie({
        x: tgt.x, z: tgt.z, kind: pl.kind, count: n, bomber: carrier.rec, label: tgt.label,
        by: null, byPlayer: false, stateAct: true,
        onEnd: function (o) {
          if (!o.crashed) return;
          // a bomber that went down is gone from the fleet
          const def = A().aircraft[carrier.type];
          if (def && m[def.field] > 0) m[def.field]--;
        },
      }) : null;
      if (!r || !r.ok) return { ok: false, why: (r && r.why) || line("noCarrier", payloadKey) };
      if (storeDef) m[storeDef.field] = Math.max(0, (m[storeDef.field] | 0) - n);
      const carrierName = A().aircraft[carrier.type].name;
      if (pl.kind === "nuke") {
        PEND.push({ x: tgt.x, z: tgt.z, attacker: us, target: tgt.nation, label: tgt.label, byPlayer: byPlayer, t: CLOCK });
        emit("nuke-launched", payload(tgt, us, { byPlayer: byPlayer, carrier: carrierName, text: nameOf(us) + " launches a nuclear weapon at " + (tgt.label || "a target") }));
        res = { line: "The " + (carrier.type === "b2" ? "B-2" : "B-52") + " is rolling." };
      } else {
        emit("bunker-strike-ordered", payload(tgt, us, { byPlayer: byPlayer, carrier: carrierName, mops: n, text: nameOf(us) + " sends a B-2 against " + (tgt.label || "a bunker") }));
        res = { line: "The B-2 is rolling. " + (n > 1 ? "Two" : "One") + " in the same hole." };
      }
    }
    // striking a foreign country you are not at war with IS going to war; and
    // its leader goes underground the moment the order is given
    if (foe) { goToWar(us, foe); alert(foe, 3); }
    if (tgt.bunker && tgt.bunker.owner) alert(tgt.bunker.owner, 3);
    // the country's verdict: a strike abroad is a strike on that country; a
    // strike on your own soil is the act everyone hates (a nuke is priced
    // when it goes off, onNuke below)
    if (byPlayer && pl.kind !== "nuke") {
      if (tgt.nation === us) polAct("strike-own", { by: "self" }, function () { shock(us, -12); scandal(15); });
      else if (foe) polAct("strike", { target: foe, by: "army" });
    }
    return { ok: true, why: "", line: res.line };
  }

  // ---------------------------------------------------------------- WAR
  function warFoe(us) {
    const wp = waypoint();
    if (wp) { const n = nationAt(wp.x, wp.z); if (n && n !== us) return n; }
    const h = mostHostile(us);
    return h ? h.id : null;
  }
  function canWar(opts) {
    const us = nation(), pw = PW();
    if (!us) return { ok: false, why: "You do not hold the country." };
    if (!pw || !pw.declareWar) return { ok: false, why: "The army is not answering." };
    const cur = enemyOf(us);
    if (cur) return { ok: false, why: "We are already at war with " + nameOf(cur) + "." };
    // opts.foe: a named country (the phone's post / call names who)
    const want = opts && opts.foe && opts.foe !== us && polGet(opts.foe) ? opts.foe : null;
    const foe = want || warFoe(us);
    if (!foe) return { ok: false, why: "There is nobody to fight." };
    if (enemyOf(foe)) return { ok: false, why: nameOf(foe) + " is tied up in another war." };
    const rec = polGet(us);
    if (rec && rec.govType === "anarchism") return { ok: false, why: "There is no army left to send." };
    return { ok: true, foe: foe, name: nameOf(foe) };
  }
  function war(opts) {
    const gt = canWar(opts);
    if (!gt.ok) return gt;
    const us = nation();
    // CONGRESS AUTHORISES IT (city/politics.js gate): a republic's war needs the votes
    const Po = CBZ.politics;
    if (Po && Po.gate) { const v = Po.gate("war"); if (!v.ok) return v; }
    // the rally polwar/relations shock on their own is the act's to price
    const went = Po && Po.during && Po.owns && Po.owns(us) ? Po.during(function () { return goToWar(us, gt.foe); }) : goToWar(us, gt.foe);
    if (!went) return { ok: false, why: "The order did not go through." };
    polAct("war", { target: gt.foe, by: "self" }, function () { shock(us, 3); });   // the flag goes up
    return { ok: true, why: "", line: "Then it's war with " + gt.name + "." };
  }
  function canPeace() {
    const us = nation();
    if (!us) return { ok: false, why: "You do not hold the country." };
    const foe = enemyOf(us);
    if (!foe) return { ok: false, why: "We are not at war." };
    return { ok: true, foe: foe };
  }
  function peace() {
    const gt = canPeace();
    if (!gt.ok) return gt;
    const us = nation();
    const r = PW().makePeace ? PW().makePeace(us) : null;
    if (!r) return { ok: false, why: "They will not take the call." };
    RAID.t = null;
    polAct("peace", { target: gt.foe, by: "self" });
    return { ok: true, why: "", line: r.loser === us ? "They'll take the terms. It will cost us." : nameOf(gt.foe) + " has signed. It's over." };
  }

  // ================================================================ BUYING
  function buyDef(key) { const T = A(); return T ? (T.aircraft[key] || T.stores[key] || null) : null; }
  function canBuy(key, id) {
    id = id || nation();
    const def = buyDef(key), rec = polGet(id);
    if (!id || !rec) return { ok: false, why: "You do not hold the country." };
    if (!def) return { ok: false, why: "We can't buy that." };
    if ((rec.treasury || 0) < def.price) return { ok: false, why: line("broke") + " " + money(def.price) + "." };
    return { ok: true, def: def, rec: rec };
  }
  function buy(key, id) {
    id = id || nation();
    const gt = canBuy(key, id);
    if (!gt.ok) return gt;
    const def = gt.def, rec = gt.rec, S = W();
    // a country that has never had the bomb and has none on order is GOING nuclear
    const first = key === "warhead" && count(id, "warhead") <= 0 && !S.deliveries.some(function (d) { return d.nation === id && d.key === "warhead"; });
    rec.treasury = (rec.treasury || 0) - def.price;
    const due = day() + def.days;
    S.deliveries.push({ nation: id, key: key, due: due });
    const nm = nameOf(id);
    if (key === "warhead") {
      // THE BIG MOVE. Every other nation sours; a country going nuclear for
      // the first time is sanctioned on top.
      if (CBZ.relations && CBZ.relations.event && CBZ.polity) {
        const l = CBZ.polity.list("country") || [];
        for (let i = 0; i < l.length; i++) if (l[i].id !== id) CBZ.relations.event(l[i].id, id, "insult", def.relations + (first ? def.firstRelations : 0));
      }
      if (first) {
        S.sanctions[id] = { until: day() + def.sanctionDays, perDay: def.sanctionPerDay };
        emit("sanctions", { nation: id, nationName: nm, until: S.sanctions[id].until, day: day(), text: "The world sanctions " + nm + " over its bomb" });
      }
      emit("warhead-bought", { nation: id, nationName: nm, first: first, price: def.price, due: due, day: day(),
        text: first ? nm + " goes nuclear" : nm + " buys another nuclear warhead" });
      return { ok: true, line: first ? "It begins. " + def.days + " days, and the world will know, sir." : "Another warhead. " + def.days + " days, sir." };
    }
    const isAir = !!(A().aircraft[key]);
    emit(isAir ? "aircraft-bought" : key + "-bought", { nation: id, nationName: nm, item: def.name, key: key, price: def.price, due: due, day: day(),
      text: nm + " buys a " + def.name });
    return { ok: true, line: "The " + def.name + " will be here in " + def.days + " day" + (def.days === 1 ? "" : "s") + ", sir." };
  }
  function tickDeliveries() {
    const S = W(), d = day();
    for (let i = S.deliveries.length - 1; i >= 0; i--) {
      const o = S.deliveries[i];
      if (d < o.due) continue;
      S.deliveries.splice(i, 1);
      const def = buyDef(o.key), m = milOf(o.nation);
      if (!def || !m) continue;
      m[def.field] = (m[def.field] | 0) + 1;
      if (A().aircraft[o.key]) {
        syncFleet(o.nation);
        const st = stationOf(o.nation);
        emit("aircraft-delivered", { nation: o.nation, nationName: nameOf(o.nation), item: def.name, key: o.key, day: d,
          x: st ? st.x : null, z: st ? st.z : null, text: nameOf(o.nation) + " takes delivery of a " + def.name });
      }
    }
  }
  function tickSanctions() {
    const S = W(), d = day();
    for (const id in S.sanctions) {
      const s = S.sanctions[id];
      if (d > s.until) { delete S.sanctions[id]; continue; }
      if (s.lastDay === d) continue;
      s.lastDay = d;
      const rec = polGet(id);
      if (rec) rec.treasury = Math.max(0, (rec.treasury || 0) - Math.round((rec.treasury || 0) * s.perDay));
    }
  }

  // ================================================================ BUNKERS
  function liveBunker(id) {
    const L = CBZ.strategicBunkers || [];
    for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  // the bunker a leader would run to (intact first)
  function bunkerOf(owner) {
    const L = CBZ.strategicBunkers || [];
    let any = null;
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (b.owner !== owner) continue;
      if (!b.breached) return b;
      any = any || b;
    }
    return any;
  }
  function known(b) {
    if (!b || !b.owner) return false;
    if (b.owner !== "cell") return true;                   // a head of state's bunker is no secret
    const st = CBZ.presidency && CBZ.presidency.status ? CBZ.presidency.status() : null;
    return !!(st && st.threat && st.threat.intel);
  }
  // which bunker a "Strike bunker" order is about: the known one nearest the
  // map mark, else the enemy leader's, else the cell's once intel has it
  function bunkerTarget(opts) {
    opts = opts || {};
    const us = opts.nation || nation();
    const L = CBZ.strategicBunkers || [];
    const ok = function (b) { return b && !b.breached && b.owner && b.owner !== us && known(b); };
    const wp = waypoint();
    if (wp) {
      let best = null, bd = 400;
      for (let i = 0; i < L.length; i++) {
        if (!ok(L[i])) continue;
        const d = Math.hypot(L[i].interior.cx - wp.x, L[i].interior.cz - wp.z);
        if (d < bd) { bd = d; best = L[i]; }
      }
      if (best) return best;
    }
    const foe = enemyOf(us);
    if (foe) { const b = bunkerOf(foe); if (ok(b)) return b; }
    const c = bunkerOf("cell");
    return ok(c) ? c : null;
  }
  function bunkerSiteFor(owner, kind) {
    const T = A(), B = T.bunkers[kind];
    if (owner === "cell") {
      const home = residence("cell");
      const R = CBZ.presidency && CBZ.presidency.cellRegion ? CBZ.presidency.cellRegion() : null;
      if (!home) return null;
      const inside = R ? function (x, z) { return x > R.minX && x < R.maxX && z > R.minZ && z < R.maxZ; } : function () { return true; };
      const s = findSite(home, B.w, B.d, owner, { inside: inside, r0: 50, r1: 420 });
      return s.pier ? null : s;                              // a cell digs in the sand, never off a pier
    }
    const home = residence(owner);
    if (!home) return null;
    const cap = capitalPoint(owner);
    return findSite(home, B.w, B.d, owner, { rect: cap && cap.rect, r0: 70, r1: 300 });
  }
  // S.bunkers is keyed by the OWNER's slot ("lead_kesh", "cell_dugout"); the
  // spec's `id` carries a generation, because a rebuilt bunker is a new
  // building next to the crater of the old one.
  function baseKey(owner) { return owner === "cell" ? "cell_dugout" : "lead_" + owner; }
  function bunkerSpec(owner, kind, gen) {
    const T = A(), B = T.bunkers[kind], S = W(), key = baseKey(owner);
    if (S.bunkers[key]) return S.bunkers[key];
    const site = bunkerSiteFor(owner, kind);
    if (!site) return null;
    gen = gen | 0;
    S.bunkers[key] = { id: gen ? key + "_g" + gen : key, gen: gen, owner: owner, kind: kind, cx: site.x, cz: site.z, w: B.w, d: B.d, roofCE: B.roofCE, pier: !!site.pier, breached: false, builtDay: day() };
    return S.bunkers[key];
  }
  function specById(id) {
    const S = W();
    for (const k in S.bunkers) if (S.bunkers[k].id === id) return S.bunkers[k];
    return null;
  }
  const BUILT = Object.create(null);         // spec id -> the meshes under it (pier)
  function materialize(spec) {
    let rec = liveBunker(spec.id);
    if (rec) return rec;
    if (!CBZ.strategicBuildBunker || !THREE) return null;
    const ar = CBZ.city && CBZ.city.arena, root = (ar && ar.root) || CBZ.scene;
    let top = 0;
    if (spec.pier && root && !BUILT[spec.id]) { BUILT[spec.id] = []; top = groundFor(root, { x: spec.cx, z: spec.cz, pier: true }, spec.w + 6, spec.d + 10, BUILT[spec.id]); }
    else if (spec.pier) top = 0.1;
    const desert = spec.owner === "cell";
    rec = CBZ.strategicBuildBunker({
      id: spec.id, name: spec.owner === "cell" ? "the Sons of the Dune bunker" : "the " + ((capitalPoint(spec.owner) || {}).name || nameOf(spec.owner)) + " bunker",
      cx: spec.cx, cz: spec.cz, w: spec.w, d: spec.d, tier: spec.kind, roofCE: spec.roofCE, owner: spec.owner,
      floorY: top, grade0: top, theme: desert ? "desert" : null,
      grade: desert && CBZ.desertTerrainHeightAt ? CBZ.desertTerrainHeightAt : null,
    });
    // a crater stays a crater across a reload (restore: no news, no deaths)
    if (rec && spec.breached && CBZ.strategicBunkerBreach) { try { CBZ.strategicBunkerBreach(rec, { penCE: Infinity, restore: true }); } catch (e) {} }
    if (rec) rec.wornCE = spec.wornCE || 0;
    return rec;
  }
  // the regions a slice actually built (core/slice.js): only bunkers and
  // stations for places that exist in this world get built
  function placeBuilt(owner) {
    if (owner === "cell") return !!(CBZ.presidency && CBZ.presidency.cellHome && CBZ.presidency.cellHome());
    if (owner === "republic") return true;
    const cap = capitalPoint(owner);
    if (!cap) return false;
    const A2 = CBZ.city && CBZ.city.arena, regs = (A2 && A2.regions) || [];
    if (!regs.length) return true;                          // headless: no region ledger to ask
    for (let i = 0; i < regs.length; i++) if (regs[i] && regs[i].name === cap.name) return true;
    return false;
  }
  function ensureBunkers() {
    const T = A(); if (!T || !CBZ.polity) return;
    const S = W();
    // the republic's head of state goes to the Fort Brandt Deep Shelter
    const brandt = liveBunker("brandt");
    if (brandt && !brandt.owner) { brandt.owner = "republic"; brandt.roofCE = Math.max(brandt.roofCE || 0, T.bunkers.leader.roofCE); }
    const l = CBZ.polity.list("country") || [];
    for (let i = 0; i < l.length; i++) {
      const id = l[i].id;
      if (id === "republic" || !placeBuilt(id) || !T.start[id]) continue;   // rebel fragments dig their own later
      const spec = bunkerSpec(id, "leader");
      if (spec) materialize(spec);
    }
    if (placeBuilt("cell")) { const spec = bunkerSpec("cell", "terror"); if (spec) materialize(spec); }
    // every saved bunker exists again after a city rebuild
    for (const k in S.bunkers) materialize(S.bunkers[k]);
  }
  function canBuildBunker(id) {
    id = id || nation();
    const T = A(), rec = polGet(id);
    if (!id || !rec) return { ok: false, why: "You do not hold the country." };
    const S = W();
    if (S.building.some(function (b) { return b.owner === id; })) return { ok: false, why: "The engineers are already digging, sir." };
    const mine = S.bunkers[baseKey(id)];
    if (mine && !mine.breached) return { ok: false, why: "You have a bunker, sir." };
    if ((rec.treasury || 0) < T.bunkers.build.price) return { ok: false, why: line("broke") + " " + money(T.bunkers.build.price) + "." };
    return { ok: true, rec: rec };
  }
  function buildBunker(id) {
    id = id || nation();
    const gt = canBuildBunker(id);
    if (!gt.ok) return gt;
    const T = A();
    gt.rec.treasury -= T.bunkers.build.price;
    W().building.push({ owner: id, due: day() + T.bunkers.build.days });
    return { ok: true, line: "The engineers start tomorrow. " + T.bunkers.build.days + " days, sir." };
  }
  function tickBuilding() {
    const S = W(), d = day(), T = A();
    for (let i = S.building.length - 1; i >= 0; i--) {
      const o = S.building[i];
      if (d < o.due) continue;
      S.building.splice(i, 1);
      const kind = o.owner === "cell" ? "terror" : "leader";
      const key = baseKey(o.owner), old = S.bunkers[key];
      if (old && !old.breached) continue;                    // it already stands
      // a breached predecessor stays a crater in the world; the new bunker is
      // the next generation, on its own ground beside it
      delete S.bunkers[key];
      const spec = bunkerSpec(o.owner, kind, old ? (old.gen | 0) + 1 : 0);
      if (!spec) continue;
      if (!materialize(spec)) continue;
      emit("bunker-built", { owner: o.owner, nation: o.owner === "cell" ? null : o.owner, nationName: nameOf(o.owner), x: Math.round(spec.cx), z: Math.round(spec.cz), day: d,
        text: o.owner === "cell" ? "The Sons of the Dune dig a new bunker" : nameOf(o.owner) + " builds a bunker for its leader" });
    }
    // AN AI LEADER REBUILDS what he can afford; the cell digs again for free
    const days = T.bunkers.aiRebuildDays;
    for (const k in S.bunkers) {
      const sp = S.bunkers[k];
      if (!sp.breached || d - (sp.breachDay || d) < days) continue;
      if (sp.owner === nation() || S.building.some(function (b) { return b.owner === sp.owner; })) continue;
      const rec = sp.owner === "cell" ? null : polGet(sp.owner);
      if (rec && (rec.treasury || 0) < T.bunkers.build.price) continue;
      if (rec) rec.treasury -= T.bunkers.build.price;
      S.building.push({ owner: sp.owner, due: d + T.bunkers.build.days });
    }
  }

  // ================================================================ LEADERS
  // A leader is in his bunker while his country is at war or under an alert
  // (a strike ordered on it). The cell's emir never comes out.
  function sheltered(owner) {
    const b = bunkerOf(owner);
    if (!b || b.breached) return false;
    if (owner === "cell") return true;
    return !!enemyOf(owner) || (W().alerts[owner] | 0) >= day();
  }
  function leaderOf(owner) {
    if (owner === "cell") {
      const L = CBZ.presidency && CBZ.presidency.cellLeader ? CBZ.presidency.cellLeader() : null;
      return L ? { sid: L.sid, name: realName(L.name, L.sid), title: "Emir" } : null;
    }
    const rec = polGet(owner);
    const sid = rec && rec.office ? rec.office.holder : null;
    const PS = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
    if (!sid || sid === PS) return null;                      // the player's body answers for itself
    let name = null, title = "President";
    if (CBZ.officials && CBZ.officials.identityOf) { try { const i = CBZ.officials.identityOf(sid); name = i && i.name; } catch (e) {} }
    if (CBZ.officials && CBZ.officials.titleFor) { try { title = CBZ.officials.titleFor(rec) || title; } catch (e) {} }
    return { sid: sid, name: realName(name, sid), title: title };
  }
  // A NAME IS A NAME, NEVER A KEY. The ledger answers "Someone" for a sid it
  // cannot read, and a raw sid ("veridia_pres") must never reach a headline:
  // either a person's name or nothing (the text then says the office).
  function realName(name, sid) {
    if (!name || typeof name !== "string") return null;
    const n = name.trim();
    if (!n || n === sid || /^someone$/i.test(n) || /^[a-z0-9]+(_[a-z0-9]+)+$/i.test(n) || !/\s/.test(n) && /\d/.test(n)) return null;
    return n;
  }
  // "Republic of Veridia" -> "Veridia" for a headline
  function shortName(id) {
    const n = nameOf(id) || "";
    return n.replace(/^(the\s+)?(republic|kingdom|federation|state|union|empire)\s+of\s+/i, "").replace(/\s+(federation|republic|kingdom)$/i, "") || n;
  }
  function leaderHeadline(owner, L, cause) {
    const how = cause === "bunker-buster" ? "bunker strike" : cause === "nuke" ? "nuclear strike" : "airstrike";
    if (owner === "cell") return (L.name ? "Terror leader " + L.name : "The terror cell's leader") + " killed in " + how;
    const who = L.name ? L.title + " " + L.name + " of " + shortName(owner) : shortName(owner) + "'s " + String(L.title || "leader").toLowerCase();
    return who + " killed in " + how;
  }
  function killLeader(owner, cause, at, by) {
    const L = leaderOf(owner);
    if (!L) return false;
    if (owner === "cell") {
      if (CBZ.presidency && CBZ.presidency.cellKill) { try { CBZ.presidency.cellKill(L.sid, cause); } catch (e) {} }
    } else {
      // a body in reach dies on the kill bus (officials' wrap runs the
      // succession); a leader 2 km away in a bunker dies on the ledger
      const cur = CBZ.presidency && CBZ.presidency.current ? CBZ.presidency.current() : null;
      const ped = cur && cur.kind === "npc" && cur.sid === L.sid ? cur.ped : null;
      if (ped && !ped.dead && CBZ.cityKillPed) { try { CBZ.cityKillPed(ped, { byPlayer: false, explosive: true }, cause); } catch (e) {} }
      else if (CBZ.officials && CBZ.officials.killOfficial) { try { CBZ.officials.killOfficial(L.sid, { stateAct: true, name: L.name || undefined }); } catch (e) {} }
    }
    if (by && owner !== "cell" && PW() && PW().strikeOn) { try { PW().strikeOn(owner, by, 3); } catch (e) {} }
    const where = owner === "cell" ? "the Sons of the Dune" : nameOf(owner);
    emit("leader-killed", {
      owner: owner, nation: owner === "cell" ? null : owner, nationName: owner === "cell" ? null : nameOf(owner),
      leader: L.name, title: L.title, cause: cause, attacker: by || null, attackerName: nameOf(by), day: day(),
      x: at ? Math.round(at.x) : null, z: at ? Math.round(at.z) : null,
      text: leaderHeadline(owner, L, cause),
      where: where,
    });
    return true;
  }
  // a bomb or a nuke out in the open: a leader who did NOT go underground dies
  // to it if it lands close enough to where he lives
  function exposedCheck(x, z, kind, by) {
    const T = A(); if (!T || !CBZ.polity) return;
    const R = T.leaderExposedR[kind] || 0;
    const owners = (CBZ.polity.list("country") || []).map(function (c) { return c.id; }).concat(["cell"]);
    for (let i = 0; i < owners.length; i++) {
      const o = owners[i];
      if (o === by) continue;
      const home = residence(o);
      if (!home) continue;
      const d = Math.hypot(home.x - x, home.z - z);
      if (sheltered(o)) {
        // UNDERGROUND: only a nuke on top of the bunker reaches him
        if (kind !== "nuke") continue;
        const b = bunkerOf(o);
        const direct = b ? (T.bunkers[b.tier] || T.bunkers.leader).directR : 0;
        // the breach tap kills the man inside (once), and reports it
        if (b && Math.hypot(b.interior.cx - x, b.interior.cz - z) < direct && CBZ.strategicBunkerBreach) {
          try { CBZ.strategicBunkerBreach(b, { penCE: Infinity, report: true, attacker: by }); } catch (e) {}
        }
        continue;
      }
      if (d < R) killLeader(o, kind === "nuke" ? "nuke" : "airstrike", { x: x, z: z }, by);
    }
  }
  // EVERY breach of an owned bunker is news, and kills whoever is inside
  function installBreachTap() {
    const fn = CBZ.strategicBunkerBreach;
    if (typeof fn !== "function" || fn._warroomTap) return;
    const w = function (b, opts) {
      const was = !!(b && b.breached);
      const inside = b && b.owner ? sheltered(b.owner) : false;
      const v = fn.apply(this, arguments);
      if (!b || !b.owner || was || (opts && opts.restore)) return v;
      const sp = specById(b.id);
      if (sp) sp.wornCE = b.wornCE || 0;
      const by = (opts && opts.attacker) || lastBunkerAttacker(b);
      const finite = opts && isFinite(opts.penCE);
      if (v && v.verdict === "breach") {
        if (sp) { sp.breached = true; sp.breachDay = day(); }
        if (finite || (opts && opts.report)) {
          emit("bunker-strike", { owner: b.owner, nation: b.owner === "cell" ? null : b.owner, nationName: nameOf(b.owner), verdict: "breach",
            label: b.name, place: b.name, attacker: by, attackerName: nameOf(by), x: Math.round(b.interior.cx), z: Math.round(b.interior.cz), day: day(),
            text: "Bunker busters destroy " + b.name });
        }
        if (inside) killLeader(b.owner, "bunker-buster", { x: b.interior.cx, z: b.interior.cz }, by);
      } else if (finite && v) {
        emit("bunker-strike", { owner: b.owner, nation: b.owner === "cell" ? null : b.owner, nationName: nameOf(b.owner), verdict: v.verdict,
          label: b.name, place: b.name, attacker: by, attackerName: nameOf(by), x: Math.round(b.interior.cx), z: Math.round(b.interior.cz), day: day(),
          text: capFirst(v.verdict === "crack" ? b.name + " cracked but holding" : b.name + " survives a strike") });
      }
      return v;
    };
    w._warroomTap = true;
    CBZ.strategicBunkerBreach = w;
  }
  const _lastBunker = Object.create(null);
  function lastBunkerAttacker(b) { const r = _lastBunker[b.id]; return r && CLOCK - r.t < 120 ? r.by : null; }

  function bunkerStrike(opts) {
    opts = opts || {};
    const gt = gate("bunker", opts);
    if (gt.ok && gt.tgt.bunker) _lastBunker[gt.tgt.bunker.id] = { by: gt.us, t: CLOCK };
    return order("bunker", opts);
  }

  // ================================================================ DETONATIONS
  function onNuke(x, z) {
    let p = null, bi = -1, bd = NUKE_MATCH_R;
    for (let i = 0; i < PEND.length; i++) {
      const d = Math.hypot(PEND[i].x - x, PEND[i].z - z);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) { p = PEND[bi]; PEND.splice(bi, 1); }
    const where = nationAt(x, z);
    const tgt = { x: x, z: z, label: (p && p.label) || placeName(x, z) || "open country", nation: where };
    const attacker = p ? p.attacker : null;
    emit("nuke", payload(tgt, attacker, { byPlayer: !!(p && p.byPlayer), text: "Nuclear detonation over " + tgt.label }));
    exposedCheck(x, z, "nuke", attacker);
    let r = null;
    if (attacker && where && attacker !== where && PW() && PW().nuclearStrike) {
      try { r = PW().nuclearStrike(where, attacker); } catch (e) { r = null; }
    }
    if (attacker && where === attacker && attacker === nation()) polAct("nuke-own", { by: "self" }, function () { shock(attacker, -40); scandal(40); });
    else if (attacker && where && attacker === nation() && p && p.byPlayer) polAct("nuke", { target: where, by: "army" });
    // A COUNTRY WITH ITS OWN WARHEADS AND A BOMBER ANSWERS.
    const us = nation();
    if (r && r.canAnswer && attacker === us && !RET && carriersOwned(where, "nuke") > 0) {
      RET = { foe: where, us: us, at: CLOCK + RETALIATE_S };
      sayNear("They have the bomb. They'll answer.");
    }
  }
  function installDetonateTap() {
    const det = CBZ.detonate;
    if (typeof det !== "function" || det._warroomTap) return;
    const w = function (x, y, z, kind) {
      const out = det.apply(this, arguments);
      if (kind === "nuke") { try { onNuke(x, z); } catch (e) {} }
      return out;
    };
    w._warroomTap = true;
    CBZ.detonate = w;
    if (CBZ.impact && CBZ.impact.detonate === det) CBZ.impact.detonate = w;
  }
  installDetonateTap();
  installBreachTap();

  function retaliationTarget(us) {
    const l = CBZ.polity && CBZ.polity.list ? (CBZ.polity.list("city") || []) : [];
    const P = CBZ.player;
    const px = P && P.pos ? P.pos.x : 0, pz = P && P.pos ? P.pos.z : 0;
    let best = null, bd = Infinity, far = null, fd = -1;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c || !c.rect) continue;
      const co = CBZ.polity.countryOf ? CBZ.polity.countryOf(c.id) : null;
      if (!co || co.id !== us) continue;
      const d = Math.hypot(c.rect.cx - px, c.rect.cz - pz);
      // near enough to watch, far enough to live: the nearest city past 1.2 km
      if (d >= 1200 && d < bd) { bd = d; best = c; }
      if (d > fd) { fd = d; far = c; }
    }
    const c = best || far;
    return c ? { x: c.rect.cx, z: c.rect.cz, label: c.name, nation: us } : null;
  }
  function tickRetaliation() {
    if (!RET || CLOCK < RET.at) return;
    if (channelBusy()) { RET.at = CLOCK + 5; return; }
    const R = RET; RET = null;
    const tgt = retaliationTarget(R.us);
    if (!tgt) return;
    const r = order("nuke", { nation: R.foe, target: tgt });
    if (r.ok) {
      if (CBZ.sfxAt) { try { CBZ.sfxAt("siren", tgt.x, tgt.z, { volume: 0.5 }); } catch (e) {} }
      sayNear("They've launched. One weapon, for " + tgt.label + ".");
    }
  }

  // ================================================================ ENEMY RAIDS
  function raidPoint(us, P) {
    for (let k = 0; k < 8; k++) {
      const a = h01(RAID.n, k, 911) * Math.PI * 2;
      const d = 190 + 130 * h01(k, RAID.n, 913);
      const x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d;
      if (nationAt(x, z) === us) return { x: x, z: z, label: placeName(x, z) || "the city", nation: us };
    }
    // a small town: somewhere inside the place you are standing in, clear of you
    const home = placeAt(P.pos.x, P.pos.z), r = home && home.rect;
    if (r) {
      for (let k = 0; k < 8; k++) {
        const x = r.cx + (h01(RAID.n, k, 915) * 2 - 1) * r.hx * 0.9;
        const z = r.cz + (h01(k, RAID.n, 917) * 2 - 1) * r.hz * 0.9;
        if (Math.hypot(x - P.pos.x, z - P.pos.z) >= 110) return { x: x, z: z, label: home.name || "the city", nation: us };
      }
    }
    return null;
  }
  function tickRaids() {
    const us = nation();
    const foe = us ? enemyOf(us) : null;
    if (!foe) { RAID.t = null; return; }
    if (RAID.foe !== foe) { RAID.foe = foe; RAID.t = null; }
    const P = CBZ.player;
    if (!P || P.dead || !P.pos || nationAt(P.pos.x, P.pos.z) !== us) return;
    if (count(foe, "jet") - (OUT[foe] | 0) <= 0) return;      // their jets, counted
    if (RAID.t == null) RAID.t = RAID_FIRST[0] + (RAID_FIRST[1] - RAID_FIRST[0]) * h01(day(), RAID.n, 907);
    RAID.t -= 1;
    if (RAID.t > 0) return;
    RAID.t = RAID_GAP[0] + (RAID_GAP[1] - RAID_GAP[0]) * h01(RAID.n, day(), 909);
    const tgt = raidPoint(us, P);
    if (!tgt) return;
    RAID.n++;
    const r = order("strike", { nation: foe, target: tgt });
    if (r.ok) sayNear("Jets. Get down.");
  }

  // ================================================================ THE FOOTBALL
  function sayNear(text) {
    const p = FB.ped, P = CBZ.player;
    if (p && !p.dead && p.pos && P && P.pos && Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 14 && CBZ.citySay) {
      try { if (CBZ.citySay(p, text, "#dfe7ff", 3)) return; } catch (e) {}
    }
    if (CBZ.speech && CBZ.speech.phone) { try { CBZ.speech.phone(text, { secs: 3 }); } catch (e) {} }
  }
  function aideSay(p, r) {
    const t = r && r.ok ? (r.line || "Yes, sir.") : String((r && r.why) || "Not now.");
    if (CBZ.citySay) { try { CBZ.citySay(p, t, "#dfe7ff", 3); } catch (e) {} }
  }
  function briefcase() {
    if (!THREE) return null;
    const grp = new THREE.Group();
    grp.name = "nuclear-football";
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); grp.add(b); return b; };
    const leather = mat(0x17181b), brass = mat(0xb08a3e);
    // built in the HAND socket's frame: -y runs down the forearm past the
    // fist, so the handle sits in the grip and the case hangs below it,
    // edge-down by his leg, swinging with his arm
    box(0.12, 0.34, 0.46, 0, -0.22, 0, leather);      // the case
    box(0.035, 0.04, 0.14, 0, -0.03, 0, leather);     // handle, in the fist
    box(0.03, 0.035, 0.02, 0, -0.06, 0.06, leather);  // handle posts
    box(0.03, 0.035, 0.02, 0, -0.06, -0.06, leather);
    box(0.125, 0.03, 0.05, 0, -0.1, 0.15, brass);     // the two latches
    box(0.125, 0.03, 0.05, 0, -0.1, -0.15, brass);
    return grp;
  }
  /* THE MAN WITH THE FOOTBALL IS NOT A SHOOTER.
     OWNER: "they still hold a briefcase when they hold the gun. It's stupid."
     The case rode the carrier's left hand socket and nothing told the gun
     discipline he was carrying it: in a fight the brain made him a shield or
     an engager like any agent, the discipline drew his gun, the two-hand
     pose took both hands, and the case stayed welded in the left fist through
     the grip. The real aide (a military officer, not a protective agent)
     does not draw: he keeps the case and stays on the President.
       · the carrier wears `_carries` (one field, read by
         CBZ.gunDiscipline, systems/actorweapons.js, and by the detail brain,
         city/brain_protection.js): he never draws, is never picked to engage,
         and in cover/evac rides behind the President, away from the threat;
       · the ONE way his hands come free is a real one: he is ordered to
         attack, or he is somehow shooting ("order" / "fired" reach the
         discipline). Then `_carries.release` SETS THE CASE DOWN at his feet
         as a real object before his gun comes out, never both in one hand.
         Killed, the case falls where he fell;
       · a case on the ground is picked back up by the first living member of
         the detail who walks within reach of it with his gun away (or, if
         nobody does, the backup football comes up with the next aide after
         FB_REISSUE seconds), so the case never teleports between hands;
       · the carrier is STICKY: once a man has it he keeps it until he is
         dead or out of the detail. It used to be re-picked every second from
         the roster order, and a rig swap (near/far) dropped and rebuilt it. */
  const FB_REACH = 1.6;          // m: close enough to pick a set-down case up
  const FB_REISSUE = 30;         // s a case may lie unclaimed before the backup comes up
  function detachCarrier() {
    const p = FB.ped;
    if (p && p._carries && p._carries.what === "football") p._carries = null;
    FB.ped = null;
  }
  function dropFootball() {
    if (FB.mesh && FB.mesh.parent) FB.mesh.parent.remove(FB.mesh);
    if (FB.down && FB.down.mesh && FB.down.mesh.parent) FB.down.mesh.parent.remove(FB.down.mesh);
    FB.mesh = null; FB.down = null;
    detachCarrier();
  }
  // THE CASE GOES DOWN: off his hand onto the ground under it, lying on its
  // broad side, a real thing in the world (never a case in a shooting hand)
  function setDownFootball(why) {
    const p = FB.ped, m = FB.mesh;
    detachCarrier();
    FB.mesh = null;
    if (!m) return;
    const root = (p && p.group && p.group.parent) || (m.parent && m.parent.parent) || CBZ.scene;
    const w = new THREE.Vector3();
    if (m.parent) { m.parent.updateWorldMatrix(true, false); m.getWorldPosition(w); m.parent.remove(m); }
    else if (p && p.pos) w.set(p.pos.x, p.pos.y || 0, p.pos.z);
    let y = 0;
    try { y = CBZ.groundAt ? CBZ.groundAt(w.x, w.z, w.y + 0.5) : (CBZ.floorAt ? CBZ.floorAt(w.x, w.z) : 0); } catch (e) { y = 0; }
    if (!isFinite(y)) y = p && p.pos ? (p.pos.y || 0) : 0;
    if (!root) return;
    // the case is built hanging in a fist: its 0.12 m thickness on local x,
    // centred 0.22 below the handle. Lie it on that broad side.
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    const holder = new THREE.Group();
    holder.name = "nuclear-football-down";
    holder.position.set(w.x, y, w.z);
    holder.rotation.y = p && p.group ? p.group.rotation.y : 0;
    m.rotation.z = Math.PI / 2;                    // local x (thickness) -> world up
    m.position.set(-0.22, 0.06, 0);                // case centre over the spot, resting on the ground
    holder.add(m);
    root.add(holder);
    FB.down = { mesh: holder, x: w.x, z: w.z, t: CLOCK, why: why || "" };
  }
  function giveFootball(p, hand) {
    FB.ped = p;
    p._carries = { what: "football", release: function (why) { if (FB.ped === p) setDownFootball(why); } };
    wireFootball(p);
    if (FB.down) {                                  // he picks up the one on the ground
      const held = FB.down.mesh.children[0] || null;
      if (FB.down.mesh.parent) FB.down.mesh.parent.remove(FB.down.mesh);
      FB.down = null;
      FB.mesh = held;
      if (FB.mesh) { FB.mesh.position.set(0, 0, 0); FB.mesh.rotation.set(0, 0, 0); }
    }
    if (!FB.mesh) FB.mesh = briefcase();
    if (FB.mesh && hand) hand.add(FB.mesh);
    else if (FB.mesh && FB.mesh.parent) FB.mesh.parent.remove(FB.mesh);
  }
  function wireFootball(p) {
    if (p._footballWired || !CBZ.interactions || !CBZ.interactions.registerFor) return;
    p._footballWired = true;
    CBZ.interactions.registerFor(p, {
      id: "football-strike", slot: "e", prio: 46, campaignSafe: true, label: "Order airstrike",
      canShow: function () { return FB.ped === p && !p.dead && !!nation(); },
      onSelect: function () { aideSay(p, order("strike", { aim: true })); },
    });
    CBZ.interactions.registerFor(p, {
      id: "football-nuke", hold: true, prio: 45, campaignSafe: true, label: "Order nuke",
      // only while the country has BOTH a bomber on its pad and a warhead
      canShow: function () { return FB.ped === p && !p.dead && hasMeans("nuke"); },
      onSelect: function () { aideSay(p, order("nuke")); },
    });
    CBZ.interactions.registerFor(p, {
      id: "football-bunker", prio: 30, campaignSafe: true, label: "Strike bunker",
      canShow: function () { return FB.ped === p && !p.dead && !!nation() && !!bunkerTarget(); },
      onSelect: function () { aideSay(p, bunkerStrike()); },
    });
  }
  // may this man take the case? hands free: alive, a rig, gun away, not fighting
  function freeHands(q) {
    if (!q || q.dead || !q.group || q.rage || q.state === "fight") return false;
    if (CBZ.gunDiscipline && CBZ.gunDiscipline.drawn(q)) return false;
    return !(q._carries && q._carries.what !== "football");
  }
  function tickFootball() {
    const us = nation();
    let refs = [];
    if (us && CBZ.protection && CBZ.protection.get) {
      let det = null;
      try { det = CBZ.protection.get("off_" + us); } catch (e) { det = null; }
      refs = (det && det.memberPedRefs) || [];
    }
    if (!us || !refs.length) { if (FB.ped || FB.mesh || FB.down) dropFootball(); return; }
    const p = FB.ped;
    // the carrier fell or left the detail: the case goes down where he was
    if (p && (p.dead || refs.indexOf(p) < 0)) setDownFootball(p.dead ? "killed" : "left");
    if (FB.ped) {
      // CARRIED, in his LEFT hand (the gun hand stays free), never strapped to
      // the hip: it rides the hand socket, so it swings with the arm. A rig
      // swap (near/far) only moves the same case to the new hand.
      const hand = FB.ped.char && FB.ped.char.sockets ? FB.ped.char.sockets.leftHand : null;
      if (FB.mesh && FB.mesh.parent !== hand) {
        if (FB.mesh.parent) FB.mesh.parent.remove(FB.mesh);
        if (hand) hand.add(FB.mesh);
      }
      return;
    }
    // nobody has it: a case on the ground goes to the first free hand in reach
    if (FB.down) {
      for (let i = 0; i < refs.length; i++) {
        const q = refs[i];
        if (!freeHands(q) || !q.pos) continue;
        if (Math.hypot(q.pos.x - FB.down.x, q.pos.z - FB.down.z) > FB_REACH) continue;
        giveFootball(q, q.char && q.char.sockets ? q.char.sockets.leftHand : null);
        return;
      }
      if (CLOCK - FB.down.t < FB_REISSUE) return;
      if (FB.down.mesh && FB.down.mesh.parent) FB.down.mesh.parent.remove(FB.down.mesh);
      FB.down = null;                                // the backup football
    }
    // first issue: a member who is not the shift leader (he runs the detail)
    let want = null;
    for (let i = 0; i < refs.length && !want; i++) { const q = refs[i]; if (freeHands(q) && q._protRole !== "shift-leader") want = q; }
    for (let i = 0; i < refs.length && !want; i++) { const q = refs[i]; if (freeHands(q)) want = q; }
    if (want) giveFootball(want, want.char && want.char.sockets ? want.char.sockets.leftHand : null);
  }

  // ================================================================ THE TICK
  // the bus: a war puts both leaders underground
  let _busWired = false;
  function wireBus() {
    if (_busWired || !CBZ.presidency || !CBZ.presidency.on) return;
    _busWired = true;
    CBZ.presidency.on("war-declared", function (p) { if (p) { alert(p.attacker, 3); alert(p.defender, 3); } });
  }
  let _acc = 0, _fleetT = 0;
  function tickSecond() {
    installDetonateTap();
    installBreachTap();
    wireBus();
    for (let i = PEND.length - 1; i >= 0; i--) if (CLOCK - PEND[i].t > 120) PEND.splice(i, 1);
    tickDeliveries();
    tickSanctions();
    tickBuilding();
    if ((_fleetT -= 1) <= 0) {
      _fleetT = 5;
      try { ensureBunkers(); } catch (e) {}
      if (CBZ.polity && CBZ.polity.list) {
        const l = CBZ.polity.list("country") || [];
        for (let i = 0; i < l.length; i++) { if (placeBuilt(l[i].id)) { try { syncFleet(l[i].id); } catch (e) {} } }
      }
    }
    try { tickFootball(); } catch (e) {}
    try { tickRaids(); } catch (e) {}
    try { tickRetaliation(); } catch (e) {}
  }
  CBZ.onUpdate && CBZ.onUpdate(46.4, function (dt) {
    if (g.mode !== "city") {
      if (PEND.length || RET || FB.ped) { PEND.length = 0; RET = null; RAID.t = null; dropFootball(); }
      return;
    }
    if (g.state !== "playing") return;
    CLOCK += dt;
    _acc += dt;
    if (_acc < 1) return;
    _acc = 0;
    tickSecond();
  });

  function fleet(id) {
    id = id || nation();
    return { jet: count(id, "jet"), heavy: count(id, "heavy"), b2: count(id, "b2"), warhead: count(id, "warhead"), mop: count(id, "mop") };
  }
  function status() {
    const us = nation();
    const foe = enemyOf(us);
    return {
      nation: us, nationName: nameOf(us), enemy: foe, enemyName: nameOf(foe), fleet: fleet(us),
      treasury: us && polGet(us) ? Math.round(polGet(us).treasury || 0) : 0,
      deliveries: W().deliveries.filter(function (d) { return d.nation === us; }).map(function (d) { return { key: d.key, due: d.due }; }),
      target: target(), raidIn: RAID.t, inFlight: PEND.length, retaliation: RET ? Math.max(0, RET.at - CLOCK) : null,
      football: !!FB.ped, sheltered: us ? sheltered(us) : false,
      bunkerTarget: (function () { const b = bunkerTarget(); return b ? { id: b.id, owner: b.owner, name: b.name } : null; })(),
      station: us ? W().stations[us] || null : null,
    };
  }

  CBZ.warroom = {
    nation: nation, enemy: enemy, warheads: warheads, target: target, nationAt: nationAt, fleet: fleet,
    canWar: canWar, war: war, canPeace: canPeace, peace: peace,
    // the payload table's orders
    can: gate, order: order, hasMeans: hasMeans, missingLine: missingLine,
    canStrike: function (o) { return gate("strike", o); }, strike: function (o) { return order("strike", o); },
    canNuke: function (o) { return gate("nuke", o); }, nuke: function (o) { return order("nuke", o); },
    canBunker: function (o) { return gate("bunker", o); }, bunkerStrike: bunkerStrike, bunkerTarget: bunkerTarget,
    // procurement
    canBuy: canBuy, buy: buy, buyables: function () {
      const T = A(); if (!T) return [];
      return Object.keys(T.aircraft).concat(Object.keys(T.stores)).map(function (k) { const d = buyDef(k); return { key: k, label: d.label, price: d.price, days: d.days }; });
    },
    canBuildBunker: canBuildBunker, buildBunker: buildBunker,
    // leaders + bunkers
    sheltered: sheltered, bunkerOf: bunkerOf, leaderOf: leaderOf, station: stationOf, bombersOf: bombersOf,
    status: status,
    audit: function () {
      return Object.assign(status(), {
        detonateTapped: !!(CBZ.detonate && CBZ.detonate._warroomTap),
        breachTapped: !!(CBZ.strategicBunkerBreach && CBZ.strategicBunkerBreach._warroomTap),
        bunkers: (CBZ.strategicBunkers || []).filter(function (b) { return b.owner; }).map(function (b) { return { id: b.id, owner: b.owner, breached: !!b.breached, roofCE: b.roofCE, wornCE: b.wornCE || 0 }; }),
        pending: PEND.map(function (p) { return { x: Math.round(p.x), z: Math.round(p.z), attacker: p.attacker, target: p.target }; }),
      });
    },
    _tick: tickSecond, _syncFleet: syncFleet, _ensureBunkers: ensureBunkers,
  };
})();
