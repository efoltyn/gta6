/* ============================================================
   city/hitman_m_army.js — THE PROTECTED MAN. (authored jobs "army", "column")

   OWNER: "A hitman mission where the guy has 30 suited-up guards, or army
   uniforms from the NPC War game: a whole mini army protecting him."

   Two marks on one machine. Lucian Varkas's men wear the detail's black suit
   (outfits.js casts job "close protection" as it, shades and earpiece).
   Colonel Idris Maro's wear a real army's issue from NPC War's country table
   (battle/core/countries.js, on this page now), which is entities/combatkit.js:
   the same kit, on the same rig, that NPC War dresses its infantry in.

   THIRTY MEN, organised the way a detail is, never a crowd:
     the ring    six close-protection men and the detail leader. They walk
                 with him on the detail brain (city/brain_protection.js through
                 CBZ.protection.guardRing): body man at his shoulder, point,
                 flanks, tail, a wall and an evacuation when it goes loud.
     the cars    three, a driver in each. He rides rear right in the middle
                 one. The column runs the road graph (systems/roadgraph.js) on
                 the motorcade's own car and seat parts (CBZ.motorcade.kit).
     two teams   ten at his residence, ten where he does business: a pair on
                 the door, men on the corners, two on a roof, a pair walking
                 the block. The town team moves to the restaurant ahead of him.
   HIS DAY runs on the city clock: residence, the meeting, lunch a walk away,
   home; the same again in the afternoon. The cars move him between sites; the
   meeting and the restaurant he walks, with the ring round him.
   THEY ARE PROFESSIONALS. A radio check goes round the posts every minute and
   a post that does not answer is an attack. A body a man can see is an
   attack. A shot is heard (a suppressed one only close) and placed roughly:
   the ring covers him and takes him to the car, the column leaves, the
   nearest men run for where it came from, the roof men turn their rifles on
   it. Someone standing too long, or with glass on them, is looked at, walked
   up to, told to move, and remembered. Their own clothes off one of their
   dead let you through the posts, but the ring and the dead man's partner
   know every face.
   WAYS IN, none of them easy: the long shot in the half minute he is in the
   open between the car and the door or on the walk to lunch; the suit; the
   column on its route, slow at the corners, glass above the armour; the roof.

   Registered with CBZ.hitmanJobs (city/hitman.js). No panel, no objective.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game || !CBZ.hitmanJobs || !CBZ.hitmanJobs.add) return;
  const g = CBZ.game;

  const CAST = {
    army: {
      id: "army", order: 30, codename: "ENTOURAGE", name: "Lucian Varkas", dress: "suit", pay: 60000,
      role: "Financier. Three cartels and one government bank with him.",
      men: "men in dark suits", weapon: "SMG", roofWeapon: "Sniper",
      call: [
        "It's Nico. This one is not like the others.",
        "Lucian Varkas. He moves money for people who bury their accountants.",
        "He does not cross a pavement alone. Thirty men. Suits, earpieces, a car in front and a car behind.",
        "The client is paying for the trouble. It's at your door. Read all of it before you go near him.",
      ],
      brief: [
        "Varkas launders for three cartels and a finance ministry. One of them wants the books closed.",
        "Thirty men, on a rota. Six never leave his side. The rest hold the place before he arrives.",
        "He keeps a day. Watch a whole one before you choose a minute of it.",
      ],
    },
    column: {
      id: "column", order: 50, codename: "COLUMN", name: "Colonel Idris Maro", dress: "uniform", pay: 75000,
      role: "Commander of a private brigade. Wanted in two countries.",
      men: "soldiers in foreign issue", weapon: "AK-47", roofWeapon: "Sniper",
      call: [
        "Nico. You remember the banker with the thirty suits.",
        "This one brought soldiers. Colonel Idris Maro. He lost a war and kept the brigade.",
        "Thirty of them in uniform, in the middle of the city, and the police look the other way.",
        "Same as before. The paper is at your door. They are not the same men, so do not assume.",
      ],
      brief: [
        "Maro commanded a brigade for a government that no longer exists. He sells it by the month now.",
        "Thirty of his own soldiers, in their own army's issue. Rifles, plates, helmets.",
        "He keeps a soldier's day. It is the same every day, which is the only weak thing about him.",
      ],
    },
  };
  const SCHED = [{ h: 7, leg: "home" }, { h: 9, leg: "meet" }, { h: 12, leg: "eat" }, { h: 14, leg: "home" }, { h: 16, leg: "meet" }, { h: 18.5, leg: "eat" }, { h: 20.5, leg: "home" }];
  const RELIEF = [11, 13, 17, 19.5];
  const LEG_LABEL = { home: "The residence", meet: "The meeting", eat: "The table" };

  /* ---------------- small reads ---------------- */
  function P() { return CBZ.player || null; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function A() { return CBZ.city && CBZ.city.arena; }
  function floorY(x, z) { try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function distP(x, z) { const p = P(); return p && p.pos ? d2(p.pos.x, p.pos.z, x, z) : Infinity; }
  function hour() { const h = CBZ.cityHour ? CBZ.cityHour() : 12; return isFinite(h) ? h : 12; }
  function absHour() { return (CBZ.dayCount ? (CBZ.dayCount() | 0) : 0) * 24 + hour(); }
  function hhmm(h) { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function h01(a, b) { return CBZ.hash01 ? CBZ.hash01(a | 0, b | 0, (CBZ.WORLD_SEED | 0) ^ 0x51a) : ((Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1 + 1) % 1; }
  function los(ax, ay, az, bx, by, bz) {
    if (!CBZ.clearLineOfFire) return true;
    try { return !!CBZ.clearLineOfFire(ax, ay, az, bx, by, bz); } catch (e) { return true; }
  }
  function eyeLos(q, x, y, z) { return los(q.pos.x, (q.pos.y || 0) + 1.6, q.pos.z, x, y, z); }
  function bark(ped, line, secs) { if (ped && !ped.dead && CBZ.citySay) { try { CBZ.citySay(ped, line, "#e8e2d4", secs || 2.6); } catch (e) {} } }
  function glass() {
    try { if (CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()) return true; } catch (e) {}
    try { return !!(CBZ.fpsScoped && CBZ.fpsScoped()); } catch (e) { return false; }
  }
  const _dir = new THREE.Vector3(), _v = new THREE.Vector3();
  function camSees(x, y, z, range, cosMin) {
    const cam = CBZ.camera; if (!cam || !cam.getWorldDirection) return false;
    cam.getWorldDirection(_dir);
    _v.set(x - cam.position.x, y - cam.position.y, z - cam.position.z);
    const d = _v.length(); if (d > range || d < 0.01) return false;
    return (_v.dot(_dir) / d) >= cosMin;
  }
  function seesPed(p) {
    if (!p || !p.pos || (p.group && !p.group.visible)) return false;
    return glass() ? camSees(p.pos.x, p.pos.y + 1.5, p.pos.z, 420, 0.994) : camSees(p.pos.x, p.pos.y + 1.5, p.pos.z, 60, 0.86);
  }
  function unseen(x, z) {
    if (distP(x, z) < 26) return false;
    if (CBZ.npcTransitionSafe) { try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: 26, maxDistance: 1e6 }); } catch (e) {} }
    return distP(x, z) > 90;
  }
  function kit() { return CBZ.motorcade && CBZ.motorcade.kit ? CBZ.motorcade.kit : null; }
  function mcMath() { return CBZ.motorcade && CBZ.motorcade._math ? CBZ.motorcade._math : null; }

  /* ---------------- bodies ---------------- */
  function walkTo(p, x, z, run) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null; p._navOk = true;          // (routed round walls: city/pednav.js)
    const goal = { x: x, z: z };
    p.path = [goal]; p.finalGoal = goal;
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = run ? "flee" : "walk"; p.pause = 0;
  }
  function go(p, x, z, run) {
    const fg = p && p.finalGoal;
    if (!fg || Math.abs(fg.x - x) > 0.6 || Math.abs(fg.z - z) > 0.6 || (p.state !== "walk" && p.state !== "flee") || (run && p.state !== "flee")) walkTo(p, x, z, run);
  }
  function holdAt(p, faceYaw) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (faceYaw != null && p.group) p.group.rotation.y = faceYaw;
  }
  function faceTo(p, x, z) { if (p && p.group && p.pos) p.group.rotation.y = Math.atan2(x - p.pos.x, z - p.pos.z); }
  function place(p, x, z, y) {
    if (!p || !p.pos) return;
    p.pos.set(x, y != null ? y : floorY(x, z), z);
    if (p.group) p.group.position.copy(p.pos);
    if (p.target && p.target.set) p.target.set(x, 0, z);
  }
  function seated(q) { return !!(q && q.inCar); }
  function hostile(J, q) {
    if (!q || q.dead || (q.ko || 0) > 0) return;
    const pa = PA(); if (!pa) return;
    if (q._hm && q._hm.role === "roof") { q._hm.hot = true; return; }       // he stays on his roof and shoots from it
    if (seated(q)) { const K = kit(); if (K) { try { K.unseat(q, q.pos.x + 2, q.pos.z); } catch (e) {} } }
    q.staffPost = null; q.controlled = false; if (q._hm) q._hm.act = "fight";
    q.rage = pa; q.state = "fight"; q.pause = 0; q.path = null; q.moveOrder = null;
    q.aggr = Math.max(q.aggr || 0, 0.95); q.fear = 0;
    if (q.armed && q.ammo != null && q.ammo < 20) q.ammo = 90;
  }
  function removeNow(p) {
    if (!p || p.dead) return;
    if (CBZ.cityUnpostNpc) { try { if (CBZ.cityUnpostNpc(p)) return; } catch (e) {} }
    if (p.group && p.group.parent) p.group.parent.remove(p.group);
    const L = CBZ.cityPeds || []; const i = L.indexOf(p); if (i >= 0) L.splice(i, 1);
  }
  function dismiss(p, hard) {
    if (!p) return;
    p._campaignTarget = false; p._hitMark = false;
    if (p.dead) return;                                              // a body stays where it fell
    if (seated(p)) { const K = kit(); if (K) { try { K.unseat(p, p.pos.x + 2, p.pos.z); } catch (e) {} } }
    if (CBZ.cityFloorPed && p._occupyY) { try { CBZ.cityFloorPed(p, 0); } catch (e) {} }
    if (!hard && CBZ.leave && CBZ.leave.go && p.group && p.group.parent) { p.rage = null; p.staffPost = null; p.controlled = false; CBZ.leave.go(p, { tag: "hitman:army", remove: removeNow }); }
    else { if (CBZ.leave && CBZ.leave.cancel) { try { CBZ.leave.cancel(p); } catch (e) {} } removeNow(p); }
  }

  /* ---------------- notes ---------------- */
  function note(J, line) {
    const N = (J.S.notes = J.S.notes || []);
    if (N.length && N[N.length - 1].indexOf(line) >= 0) return;
    N.push(hhmm(hour()) + "  " + line);
    if (N.length > 10) N.splice(0, N.length - 10);
    J.rev++;
  }
  function once(J, key, line) { const K = (J.S.known = J.S.known || {}); if (K[key]) return false; K[key] = 1; if (line) note(J, line); J.rev++; return true; }

  /* ================================================================
     PLACES: three real buildings, and where men stand at each
     ================================================================ */
  function doorOf(l) { return l && l.building && l.building.door; }
  function outward(lot) {
    const d = doorOf(lot); if (!d) return { x: 0, z: 1 };
    const ox = d.x - lot.cx, oz = d.z - lot.cz, m = Math.hypot(ox, oz);
    return m < 0.01 ? { x: -(d.nx || 0), z: -(d.nz || -1) } : { x: ox / m, z: oz / m };
  }
  function lotName(lot) {
    const b = lot && lot.building;
    if (b && b.name) { const n = String(b.name).trim(); return n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase(); }
    const K = { bank: "the bank", office: "the office block", tower: "the tower", food: "the diner", club: "the club", casino: "the casino", cityhall: "City Hall", courthouse: "the courthouse", federal: "the federal building", bar: "the bar", lodge: "the lodge", home: "the house" };
    return (lot && K[lot.kind]) || "the building";
  }
  function lotKey(l) { return l ? (Math.round(l.cx) + ":" + Math.round(l.cz)) : null; }
  function allLots() {
    const AR = A(); if (!AR) return [];
    const src = (AR.lots || []).concat(AR.shopLots || []), out = [];
    for (let i = 0; i < src.length; i++) {
      const l = src[i];
      if (!l || out.indexOf(l) >= 0 || !doorOf(l) || l.demolished || l.kind === "player" || l.kind === "park" || !l.building || !isFinite(l.cx)) continue;
      out.push(l);
    }
    return out;
  }
  function indoors(x, z) { try { return !!(CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(x, z)); } catch (e) { return false; } }
  function stepsOf(lot) { const d = doorOf(lot), o = outward(lot); return { x: d.x + o.x * 3.2, z: d.z + o.z * 3.2 }; }
  // a way to WALK between two doors: straight, or round one corner, with a clear line each leg
  function walkRoute(a, b) {
    const ay = floorY(a.x, a.z) + 1, by = floorY(b.x, b.z) + 1;
    if (los(a.x, ay, a.z, b.x, by, b.z)) return [b];
    const C = [{ x: a.x, z: b.z }, { x: b.x, z: a.z }];
    for (let i = 0; i < C.length; i++) {
      const c = C[i], cy = floorY(c.x, c.z) + 1;
      if (!indoors(c.x, c.z) && los(a.x, ay, a.z, c.x, cy, c.z) && los(c.x, cy, c.z, b.x, by, b.z)) return [c, b];
    }
    return null;
  }
  function pickVenues(J) {
    const L = allLots(), S = J.S;
    S.venues = S.venues || {};
    const byKey = function (k) { if (!k) return null; for (let i = 0; i < L.length; i++) if (lotKey(L[i]) === k) return L[i]; return null; };
    let home = byKey(S.venues.home), meet = byKey(S.venues.meet), eat = byKey(S.venues.eat);
    if (home && meet && eat) return { home: home, meet: meet, eat: eat };
    const rm = CBZ.hmRoom && CBZ.hmRoom.ensure ? CBZ.hmRoom.ensure() : null;
    const clearOfRoom = function (l) { return !rm || !rm.center || d2(l.cx, l.cz, rm.center.x, rm.center.z) > 48; };
    const salt = J.cast.order;
    const first = function (kinds, ok) {
      for (let k = 0; k < kinds.length; k++) {
        const c = L.filter(function (l) { return l.kind === kinds[k] && clearOfRoom(l) && (!ok || ok(l)); });
        if (c.length) return c;
      }
      return [];
    };
    const mc = first(["cityhall", "courthouse", "federal", "bank", "casino", "tower", "office"]);
    if (!mc.length) return null;
    meet = mc[Math.min(mc.length - 1, (h01(salt, 1) * mc.length) | 0)];
    const ms = stepsOf(meet);
    // lunch: near enough to walk, and a way to walk it if the block allows one
    let ec = L.filter(function (l) { return l !== meet && (l.kind === "food" || l.kind === "bar" || l.kind === "club") && d2(l.cx, l.cz, meet.cx, meet.cz) > 22 && d2(l.cx, l.cz, meet.cx, meet.cz) < 270; });
    if (!ec.length) ec = L.filter(function (l) { return l !== meet && d2(l.cx, l.cz, meet.cx, meet.cz) > 22 && d2(l.cx, l.cz, meet.cx, meet.cz) < 140; });
    if (!ec.length) return null;
    ec.sort(function (a, b) {
      const wa = walkRoute(ms, stepsOf(a)) ? 0 : 400, wb = walkRoute(ms, stepsOf(b)) ? 0 : 400;
      return (wa + d2(a.cx, a.cz, meet.cx, meet.cz)) - (wb + d2(b.cx, b.cz, meet.cx, meet.cz));
    });
    eat = ec[0];
    let hc = first(["tower", "lodge", "casino", "bank", "office", "home"], function (l) { return l !== meet && l !== eat && d2(l.cx, l.cz, meet.cx, meet.cz) > 90; });
    if (!hc.length) hc = L.filter(function (l) { return l !== meet && l !== eat && d2(l.cx, l.cz, meet.cx, meet.cz) > 70; });
    if (!hc.length) return null;
    hc.sort(function (a, b) { return d2(b.cx, b.cz, meet.cx, meet.cz) - d2(a.cx, a.cz, meet.cx, meet.cz); });
    home = hc[Math.min(hc.length - 1, (h01(salt, 2) * Math.min(3, hc.length)) | 0)];
    S.venues = { home: lotKey(home), meet: lotKey(meet), eat: lotKey(eat) };
    return { home: home, meet: meet, eat: eat };
  }
  const COMPASS = function (dx, dz) { return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "East" : "West") : (dz > 0 ? "South" : "North"); };
  function siteOf(key, lot) {
    const d = doorOf(lot), o = outward(lot), sx = -o.z, sz = o.x, b = lot.building;
    const cx = b.ox != null ? b.ox : lot.cx, cz = b.oz != null ? b.oz : lot.cz;
    const hw = (b.w || lot.w || 16) / 2, hd = (b.d || lot.d || 16) / 2;
    const face = Math.atan2(o.x, o.z);
    const S = { key: key, lot: lot, name: lotName(lot), door: d, o: o, face: face, cx: cx, cz: cz, hw: hw, hd: hd,
      steps: { x: d.x + o.x * 3.2, z: d.z + o.z * 3.2 }, inside: { x: d.x + o.x * 1.1, z: d.z + o.z * 1.1 } };
    let kerb = null;
    try { kerb = CBZ.hmFallout && CBZ.hmFallout.kerbNear ? CBZ.hmFallout.kerbNear(d.x + o.x * 6, d.z + o.z * 6, 60) : null; } catch (e) { kerb = null; }
    S.kerb = kerb || { x: d.x + o.x * 11, z: d.z + o.z * 11, h: face + Math.PI / 2 };
    // the door pair, the corners (only where a man can really stand), the kerb line
    S.doorPosts = [-1, 1].map(function (s, i) { return { x: d.x + o.x * 1.4 + sx * s * 2.5, z: d.z + o.z * 1.4 + sz * s * 2.5, face: face, call: "Door " + (i ? "two" : "one") }; });
    S.corners = [];
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (c) {
      const x = cx + c[0] * (hw + 2.4), z = cz + c[1] * (hd + 2.4);
      if (indoors(x, z)) return;
      S.corners.push({ x: x, z: z, face: Math.atan2(c[0], c[1]), call: (c[1] > 0 ? "South" : "North") + "-" + (c[0] > 0 ? "east" : "west") + " corner" });
    });
    for (let k = 0; S.corners.length < 4 && k < 4; k++) {
      const s = (k % 2 ? 1 : -1) * (7 + (k >> 1) * 7);
      S.corners.push({ x: S.kerb.x + sx * s - o.x * 1.6, z: S.kerb.z + sz * s - o.z * 1.6, face: face, call: "Kerb " + (k + 1) });
    }
    S.loop = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (c) { return { x: cx + c[0] * (hw + 6.5), z: cz + c[1] * (hd + 6.5) }; })
      .filter(function (q) { return !indoors(q.x, q.z); });
    if (S.loop.length < 2) S.loop = [{ x: S.kerb.x + sx * 14, z: S.kerb.z + sz * 14 }, { x: S.kerb.x - sx * 14, z: S.kerb.z - sz * 14 }];
    // roofs: low ones with a view of the steps (his own building's, or a neighbour's)
    S.roofs = [];
    const L = allLots().filter(function (l) { const h = l.building.h || 0; return h >= 4.5 && h <= 30 && d2(l.cx, l.cz, S.steps.x, S.steps.z) < 80; });
    L.sort(function (a, b2) { return d2(a.cx, a.cz, S.steps.x, S.steps.z) - d2(b2.cx, b2.cz, S.steps.x, S.steps.z); });
    for (let i = 0; i < L.length && S.roofs.length < 2; i++) {
      const l = L[i], lb = l.building, lx = lb.ox != null ? lb.ox : l.cx, lz = lb.oz != null ? lb.oz : l.cz;
      const w2 = (lb.w || l.w || 14) / 2 - 1.3, d3 = (lb.d || l.d || 14) / 2 - 1.3;
      let ex = lx + clamp(S.steps.x - lx, -w2, w2), ez = lz + clamp(S.steps.z - lz, -d3, d3);
      if (l === lot) { ex = clamp(d.x - o.x * 1.4, lx - w2, lx + w2); ez = clamp(d.z - o.z * 1.4, lz - d3, lz + d3); }
      const y = floorY(doorOf(l).x, doorOf(l).z) + lb.h;
      const f = l === lot ? face : Math.atan2(S.steps.x - ex, S.steps.z - ez);
      S.roofs.push({ x: ex, z: ez, y: y, face: f, call: "High " + (S.roofs.length ? "two" : "one"), lot: l });
    }
    return S;
  }

  /* ================================================================
     THE DETAIL: thirty bodies with places
     ================================================================ */
  function uniformRec(J, loadout) {
    let cat = null;
    try { cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null; } catch (e) { cat = null; }
    const b = cat && cat.soldier; if (!b) return null;
    const r = Object.assign({}, b, { name: "Field Uniform", nation: J.nation, kit: loadout || "rifleman" });
    r.colors = Object.assign({}, b.colors);
    return r;
  }
  // which army's issue a uniformed detail wears: a real one from NPC War's table
  function pickNation(J) {
    const C = CBZ.countries;
    let ids = ["veridia", "solara", "mbeya", "junta"];                // combatkit's own, when the table is not on the page
    if (C && C.list) {
      const real = C.list().filter(function (r) { return r.kind === "state" && r.kit && r.kit.camo && r.kit.plates && r.kit.camo !== "ocp"; }).map(function (r) { return r.id; });
      if (real.length) ids = real;
    }
    return ids[Math.min(ids.length - 1, (h01(J.cast.order, 9) * ids.length) | 0)];
  }
  function body(J, x, z, o) {
    if (!CBZ.cityPostNpc) return null;
    o = o || {};
    const uni = J.cast.dress === "uniform";
    let p = null;
    try {
      p = CBZ.cityPostNpc(x, z, {
        job: "close protection", kind: "security", archetype: "professional", gender: "m",
        armed: true, weapon: o.weapon || J.cast.weapon, aggr: 0.85, hp: o.hp || 170, wealth: 0.5,
        src: "hitman:army", face: o.face, pin: !!o.pin, floorY: o.y,
      });
    } catch (e) { p = null; }
    if (!p) return null;
    p._hmArmy = J.id; p._campaignTarget = true; p._vipGuard = true; p._iOnly = true; p._lodOk = true;
    p.maxHp = Math.max(p.maxHp || 0, o.hp || 170); p.ammo = 120;
    p._hm = { team: o.team, role: o.role, post: o.post || null, call: (o.post && o.post.call) || o.call || "", act: null, sus: 0, lookT: 0, lookYaw: null };
    if (uni) { const rec = uniformRec(J, o.loadout); if (rec) { p._wornOutfit = rec; if (CBZ.cityRedressPed) { try { CBZ.cityRedressPed(p); } catch (e) {} } } }
    if (!o.pin) { p.controlled = true; p.state = "idle"; p.pause = 1; }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    J.all.push(p);
    return p;
  }
  function teamOf(J, key) { return J.all.filter(function (q) { return q._hm.team === key; }); }
  function alive(q) { return q && !q.dead && !((q.ko || 0) > 0); }

  // the roster is built a few bodies a tick, never thirty rigs in one frame
  function queueRoster(J) {
    const Q = [], uni = J.cast.dress === "uniform";
    const site = J.sites[J.M.leg], st = site.steps;
    // the man
    Q.push(function () {
      let p = null;
      try {
        p = CBZ.cityPostNpc(st.x, st.z, { job: uni ? "close protection" : "banker", kind: "civilian", archetype: "official", gender: "m", name: J.cast.name,
          armed: uni, weapon: uni ? "Pistol" : null, aggr: 0.2, hp: 110, wealth: 0.95, src: "hitman:army", face: site.face });
      } catch (e) { p = null; }
      if (!p) { J.why = "no body for the mark"; return; }
      p.name = J.cast.name; p.nameKnown = true; p._hmArmy = J.id; p._hitMark = true; p._campaignTarget = true; p.controlled = true; p._navOk = true;   // (the man himself is drawn at any range: one rig)
      // his men's issue, a chest rig and no helmet: the beret is how you pick him out
      if (uni) { const rec = uniformRec(J, "militia"); if (rec) { rec.hat = "beret"; rec.cap = true; rec.capColor = 0x6d1f1f; p._wornOutfit = rec; if (CBZ.cityRedressPed) { try { CBZ.cityRedressPed(p); } catch (e) {} } } }
      holdAt(p, site.face);
      J.mark = p;
      try { J.photo = CBZ.cityMugshot ? (CBZ.cityMugshot({ ped: p }) || "") : ""; } catch (e) { J.photo = ""; }
      J.rev++;
    });
    // the ring and its leader
    for (let i = 0; i < 7; i++) (function (i) {
      Q.push(function () {
        const a = i / 7 * Math.PI * 2;
        const q = body(J, st.x + Math.cos(a) * 2.6, st.z + Math.sin(a) * 2.6, { team: "ring", role: i === 6 ? "leader" : "ring", hp: 190, face: a, loadout: i === 6 ? "officer" : "rifleman", call: i === 6 ? "Lead" : "" });
        if (!q) return;
        if (i === 6) J.leader = q; else J.ring.push(q);
      });
    })(i);
    // the cars and the men who stay in them
    Q.push(function () { stageCars(J, site); });
    // two teams of ten
    ["home", "town"].forEach(function (tk) {
      const S = tk === "home" ? J.sites.home : (J.M.leg === "eat" ? J.sites.eat : J.sites.meet);
      const fixed = tk === "home" ? J.sites.home : J.sites.meet;
      S.doorPosts.forEach(function (post) { Q.push(function () { body(J, post.x, post.z, { team: tk, role: "door", post: post, pin: true, face: post.face }); }); });
      const cs = S.corners.slice(0, 4);
      cs.forEach(function (post) { Q.push(function () { body(J, post.x, post.z, { team: tk, role: "corner", post: post, pin: true, face: post.face }); }); });
      // the roof men stay on the roofs over the meeting (or the residence)
      for (let i = 0; i < 2; i++) (function (i) {
        const post = fixed.roofs[i] || null;
        Q.push(function () {
          if (post) body(J, post.x, post.z, { team: tk, role: "roof", post: post, pin: true, face: post.face, y: post.y, weapon: J.cast.roofWeapon, loadout: "marksman" });
          else { const k = fixed.corners[(i + 2) % fixed.corners.length]; const e = { x: k.x + (i ? 2 : -2), z: k.z + 2, face: k.face, call: "Kerb " + (5 + i) }; body(J, e.x, e.z, { team: tk, role: "corner", post: e, pin: true, face: e.face }); }
        });
      })(i);
      for (let i = 0; i < 2; i++) (function (i) {
        Q.push(function () { const w = S.loop[0]; const q = body(J, w.x + i * 1.4, w.z + i * 1.4, { team: tk, role: "rover", call: "Rover" }); if (q) { q._hm.loopAt = 0; q._hm.second = !!i; q._hm.site = S.key; } });
      })(i);
    });
    Q.push(function () {
      // partners: the door pair know each other, the rovers know each other
      ["home", "town"].forEach(function (tk) {
        ["door", "rover", "roof"].forEach(function (r) { const two = teamOf(J, tk).filter(function (q) { return q._hm.role === r; }); if (two.length === 2) { two[0]._hm.buddy = two[1]; two[1]._hm.buddy = two[0]; } });
      });
      J.staged = true; J.rev++;
    });
    J.Q = Q;
  }

  /* ================================================================
     THE CARS
     ================================================================ */
  const OFFS = [9.6, 0, -9.6];
  const SEATS = { driver: "driver", front: "shotgun", rr: "rearR", rl: "rearL" };
  function carSide(c, right, fwd) { const h = c.heading || 0; return { x: c.pos.x - Math.cos(h) * right + Math.sin(h) * (fwd || 0), z: c.pos.z + Math.sin(h) * right + Math.cos(h) * (fwd || 0) }; }
  function stageCars(J, site) {
    const K = kit(); if (!K) { J.why = "no car kit"; return; }
    const k = site.kerb, h = k.h || 0;
    J.cars = [];
    for (let i = 0; i < 3; i++) {
      const x = k.x + Math.sin(h) * OFFS[i], z = k.z + Math.cos(h) * OFFS[i];
      let c = null;
      try { c = K.spawnCar("detail", x, z, h); } catch (e) { c = null; }
      if (!c) continue;
      c._hmArmy = J.id; c.name = i === 1 ? "Principal Car" : "Escort Car";
      K.poseCar(c, { x: x, z: z, h: h }, 0);
      const drv = body(J, x - Math.cos(h) * 2.2, z + Math.sin(h) * 2.2, { team: "car", role: "driver", weapon: "Pistol", call: "Car " + (i + 1) });
      if (drv) { if (!K.seatIn(drv, c, SEATS.driver)) holdAt(drv, h); }
      J.cars.push({ car: c, off: OFFS[i], driver: drv, i: i });
    }
    J.carsAt = site.key;
  }
  function carOk(J) { const K = kit(); return !!(K && J.cars.length === 3 && J.cars.every(function (f) { return f.car && !f.car.dead && !f.car.player && K.carLive(f.car); })); }
  // who rides where: [car index, seat, side (right +), forward]
  function seatPlan(J) {
    const R = J.ring, out = [];
    if (J.mark) out.push([J.mark, 1, SEATS.rr, 2.1, -0.6]);
    if (R[0]) out.push([R[0], 1, SEATS.rl, -2.1, -0.6]);
    if (J.leader) out.push([J.leader, 1, SEATS.front, 2.1, 0.8]);
    if (R[1]) out.push([R[1], 0, SEATS.front, 2.1, 0.8]);
    if (R[2]) out.push([R[2], 0, SEATS.rl, -2.1, -0.6]);
    if (R[3]) out.push([R[3], 0, SEATS.rr, 2.1, -0.6]);
    if (R[4]) out.push([R[4], 2, SEATS.front, 2.1, 0.8]);
    if (R[5]) out.push([R[5], 2, SEATS.rl, -2.1, -0.6]);
    return out;
  }
  function startTrip(J, to, evac) {
    const K = kit(), M = mcMath(); if (!K || !M || !carOk(J)) return false;
    const pc = J.cars[1].car, dest = J.sites[to].kerb;
    let R = null;
    try { R = K.roadRoute({ x: pc.pos.x, z: pc.pos.z }, { x: dest.x, z: dest.z }); } catch (e) { R = null; }
    if (!R || !R.pts || R.pts.length < 2) return false;
    let P0 = null;
    try { P0 = M.makePath(R.pts, R.radii, null); } catch (e) { P0 = null; }
    if (!P0 || !(P0.len > 30)) return false;
    let s0 = 0;
    try { s0 = M.projectS(P0, pc.pos.x, pc.pos.z); } catch (e) { s0 = 0; }
    s0 = clamp(s0, 10, Math.max(10, P0.len - 30));
    // the road leads off behind them: the rear car leads, and they swing round
    const q0 = M.pathAt(P0, s0), ch = pc.heading || 0;
    if (Math.sin(q0.h) * Math.sin(ch) + Math.cos(q0.h) * Math.cos(ch) < 0) { const o = J.cars[0].off; J.cars[0].off = J.cars[2].off; J.cars[2].off = o; }
    J.trip = { P: P0, s: s0, v: 0, to: to, evac: !!evac, blend: unseen(pc.pos.x, pc.pos.z) ? 0.01 : 2.4, blendT: 2.4, blocked: 0,
      from: J.cars.map(function (f) { return { x: f.car.pos.x, z: f.car.pos.z, h: f.car.heading || 0 }; }) };
    J.S.route = R.pts.filter(function (q, i) { return i % 3 === 0 || i === R.pts.length - 1; }).slice(0, 12).map(function (q) { return [Math.round(q.x), Math.round(q.z)]; });
    return true;
  }
  function lerpAng(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
  // is something in the lane in front of the lead car
  function laneBlocked(J, T) {
    const M = mcMath(), lead = M.pathAt(T.P, Math.min(T.P.len, T.s + OFFS[0] + 3));
    const fx = Math.sin(lead.h), fz = Math.cos(lead.h);
    const hit = function (x, z, r) { const dx = x - lead.x, dz = z - lead.z, f = dx * fx + dz * fz; return f > 0 && f < 13 && Math.abs(dx * fz - dz * fx) < r; };
    const pl = P();
    if (pl && pl.pos && !pl.driving && hit(pl.pos.x, pl.pos.z, 1.6)) return true;
    const C = CBZ.cityCars || [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!c || !c.pos || c._hmArmy === J.id) continue;
      if (Math.abs(c.pos.x - lead.x) > 16 || Math.abs(c.pos.z - lead.z) > 16) continue;
      if (hit(c.pos.x, c.pos.z, 2.1) && Math.abs(c.v || 0) < 4) return true;
    }
    return false;
  }
  function frameCars(J, dt) {
    const T = J.trip, K = kit(), M = mcMath();
    if (!T || !K || !M) return;
    if (!carOk(J)) { J.trip = null; return; }
    const end = T.P.len - 10.2;
    const cruise = T.evac ? 17 : 10.5, brake = T.evac ? 5 : 3.2;
    let vt = Math.min(cruise, M.capAt(T.P, Math.min(T.P.len, T.s + OFFS[0]), T.evac), Math.sqrt(2 * brake * Math.max(0, end - T.s)));
    if (T.s > end) vt = 0;
    T.probe = (T.probe || 0) - dt;
    if (T.probe <= 0) { T.probe = 0.25; T.block = !T.push && laneBlocked(J, T); }
    if (T.block) { vt = 0; T.blocked += dt; } else if (T.v > 2) T.blocked = 0;
    T.v += clamp(vt - T.v, -brake * 1.6 * dt, (T.evac ? 4 : 2.2) * dt);
    if (T.v < 0) T.v = 0;
    if (T.blend > 0) { T.blend = Math.max(0, T.blend - dt); T.v = Math.min(T.v, 1.5); }
    T.s = Math.min(end, T.s + T.v * dt);
    const k = T.blend > 0 ? 1 - T.blend / T.blendT : 1, e = k * k * (3 - 2 * k);
    for (let i = 0; i < J.cars.length; i++) {
      const q = M.pathAt(T.P, clamp(T.s + J.cars[i].off, 0, T.P.len));
      if (e < 1) { const f = T.from[i]; K.poseCar(J.cars[i].car, { x: f.x + (q.x - f.x) * e, z: f.z + (q.z - f.z) * e, h: lerpAng(f.h, q.h, e) }, T.v); }
      else K.poseCar(J.cars[i].car, q, T.v);
    }
    if (T.s >= end - 0.05 && T.v < 0.5) { J.carsAt = T.to; J.trip = null; J.arrived = T.to; }
  }

  /* ================================================================
     HIS DAY: dwell, to the cars, the road, out of the cars, the walk
     ================================================================ */
  function legNow() {
    const h = hour();
    let cur = SCHED[SCHED.length - 1].leg;
    for (let i = 0; i < SCHED.length; i++) if (h >= SCHED[i].h) cur = SCHED[i].leg;
    return cur;
  }
  function legFrom(key) { return SCHED.filter(function (e) { return e.leg === key; }).map(function (e) { return hhmm(e.h); }); }
  function townMovers(J) { return teamOf(J, "town").filter(function (q) { return alive(q) && (q._hm.role === "door" || q._hm.role === "corner" || q._hm.role === "rover") && q._hm.act !== "fight" && q._hm.act !== "respond"; }); }
  // the town team goes where he is going, ahead of him
  function moveTown(J, key) {
    const S = J.sites[key]; if (!S) return;
    const M = townMovers(J);
    let di = 0, ci = 0;
    for (let i = 0; i < M.length; i++) {
      const q = M[i];
      if (q._hm.role === "rover") { q._hm.site = key; q._hm.loopAt = 0; continue; }
      const post = q._hm.role === "door" ? S.doorPosts[di++ % S.doorPosts.length] : S.corners[ci++ % S.corners.length];
      q._hm.post = post; q._hm.call = post.call; q._hm.act = "move";
      q.staffPost = null; q.controlled = true;
    }
  }
  function depart(J, to) {
    const M = J.M, from = M.leg;
    M.next = to; M.t = 0;
    const a = J.sites[from], b = J.sites[to];
    const walk = (from === "meet" && to === "eat") || (from === "eat" && to === "meet") ? walkRoute(a.steps, b.steps) : null;
    if (to === "meet" || to === "eat") moveTown(J, to);
    // the walk: the cars go round to the next kerb without him
    if (walk && J.alert.level < 2) { M.phase = "walk"; M.route = walk.slice(); M.lead = 9; if (carOk(J)) startTrip(J, to, false); return; }
    if (carOk(J)) { M.phase = "tocars"; return; }
    // no cars to take him (lost, or left behind): he walks it, the long way
    M.phase = "walk"; M.route = [b.steps]; M.lead = 0;
  }
  function arrive(J, key) {
    const M = J.M;
    M.leg = key; M.phase = "dwell"; M.t = 0; M.route = null; M.cut = false; M.run = false;
    if (!J.S.legs) J.S.legs = {};
  }
  function tickParty(J, dt) {
    const p = J.mark, M = J.M, K = kit();
    if (!p || p.dead || (p.ko || 0) > 0) return;
    M.t += dt;
    const site = J.sites[M.leg];
    const hot = J.alert.level >= 2;
    if (M.phase === "dwell") {
      const st = hot ? site.inside : site.steps;
      if (d2(p.pos.x, p.pos.z, st.x, st.z) > 1.5) go(p, st.x, st.z, hot);
      else if (p.state !== "idle") holdAt(p, site.face);
      if (hot) return;
      // moved along early (somebody was watching): home, and he stays there a while
      if (M.cut) { M.cut = false; if (M.leg !== "home") { J.S.holdUntil = absHour() + 1.5; depart(J, "home"); return; } }
      const want = J.S.holdUntil > absHour() ? M.leg : legNow();
      if (want !== M.leg) depart(J, want);
      return;
    }
    if (M.phase === "walk") {
      if (M.lead > 0) { M.lead -= dt; if (p.state !== "idle") holdAt(p, site.face); return; }      // the town team goes first
      const w = M.route && M.route[0];
      if (!w) { arrive(J, M.next); return; }
      if (d2(p.pos.x, p.pos.z, w.x, w.z) < 1.6) { M.route.shift(); return; }
      go(p, w.x, w.z, hot || M.run);
      return;
    }
    if (M.phase === "tocars") {
      if (!carOk(J) || !K) { M.phase = "walk"; M.route = [J.sites[M.next].steps]; M.lead = 0; return; }
      const plan = seatPlan(J);
      let markIn = seated(p), all = true;
      for (let i = 0; i < plan.length; i++) {
        const r = plan[i], q = r[0];
        if (!alive(q) || seated(q) || q.rage || (q._hm && (q._hm.act === "fight" || q._hm.act === "respond"))) continue;   // a man in the fight stays in it
        // he gets in from whichever side of the car he is standing on (a man
        // sent round a parked car to its street side walks into its bumper)
        const c = J.cars[r[1]].car, sA = carSide(c, r[3], r[4]), sB = carSide(c, -r[3], r[4]);
        const side = d2(q.pos.x, q.pos.z, sA.x, sA.z) <= d2(q.pos.x, q.pos.z, sB.x, sB.z) + 0.5 ? sA : sB;
        const d = d2(q.pos.x, q.pos.z, side.x, side.z);
        const late = M.t > 16 && (q === p || M.t > 22);
        if (d < 1.7 || late) {
          // the ring is in before he is, except the body man, who follows him in
          if (q === p || markIn || late) { if (K.seatIn(q, c, r[2])) { if (q === p) markIn = true; continue; } }
        }
        // the ring walks him to his door and only then peels off to its own cars
        if (q === p) go(p, side.x, side.z, hot || M.run);
        else if (markIn || d2(p.pos.x, p.pos.z, J.cars[1].car.pos.x, J.cars[1].car.pos.z) < 6) { q._hm.act = "board"; go(q, side.x, side.z, true); }
        all = false;
      }
      // under fire the car does not wait for anybody but him
      if (markIn && !M.inT) M.inT = M.t;
      if (markIn && (all || M.t > 24 || (hot && M.t - M.inT > 3.5))) {
        M.inT = 0;
        for (let i = 0; i < plan.length; i++) if (plan[i][0]._hm && plan[i][0]._hm.act === "board") plan[i][0]._hm.act = null;
        if (startTrip(J, M.next, hot)) { M.phase = "rolling"; M.t = 0; once(J, "convoy", null); }
        else { for (let i = 0; i < plan.length; i++) if (seated(plan[i][0])) { const s = carSide(J.cars[plan[i][1]].car, plan[i][3], plan[i][4]); try { K.unseat(plan[i][0], s.x, s.z); } catch (e) {} plan[i][0].controlled = true; } M.phase = "walk"; M.route = [J.sites[M.next].steps]; M.lead = 0; }
      }
      return;
    }
    if (M.phase === "rolling") {
      if (J.trip) { if (J.trip.blocked > 6 && J.alert.level < 1) alert(J, 1, "blocked", null, false); if (J.trip.blocked > 22) J.trip.push = true; return; }
      M.phase = "alight"; M.t = 0;
      return;
    }
    if (M.phase === "alight") {
      const plan = seatPlan(J);
      for (let i = 0; i < plan.length; i++) {
        const r = plan[i], q = r[0];
        if (!q || !seated(q)) continue;
        if (q === p && M.t < 1.6) continue;                           // the ring is out before he is
        const s = carSide(J.cars[r[1]].car, r[3], r[4]);
        try { K.unseat(q, s.x, s.z); } catch (e) {}
        if (!q.dead) { q.controlled = true; q.state = "idle"; q.pause = 0.3; }
      }
      if (M.t > 2.2) { M.phase = "walk"; M.route = [J.sites[M.next].steps]; M.lead = 0; }
    }
  }
  const PS = { posture: "normal", threat: null, hostile: false, at: { x: 0, z: 0 }, reason: null };
  function frame(J, dt) {
    if (!J.staged) return;
    frameCars(J, dt);
    const p = J.mark;
    // the ring: on the detail brain while they are on their feet round him
    if (p && !p.dead && !seated(p) && CBZ.protection && CBZ.protection.guardRing) {
      const ring = [];
      for (let i = 0; i < J.ring.length; i++) { const q = J.ring[i]; if (alive(q) && !seated(q) && !q.rage && q._hm.act !== "board" && q._hm.act !== "respond") ring.push(q); }
      if (alive(J.leader) && !seated(J.leader) && !J.leader.rage && J.leader._hm.act !== "board") ring.push(J.leader);
      if (ring.length) {
        const AL = J.alert, pl = P();
        PS.posture = AL.level >= 2 ? "evac" : (AL.level >= 1 || J.cordon > 0 ? "alert" : "normal");
        PS.hostile = !!(AL.level >= 2 && AL.known);
        PS.threat = PS.hostile || J.cordon > 0 ? PA() : null;
        PS.reason = AL.level >= 2 ? "gunfire" : null;
        if (AL.at) { PS.at.x = AL.at.x; PS.at.z = AL.at.z; } else if (pl && pl.pos) { PS.at.x = pl.pos.x; PS.at.z = pl.pos.z; }
        try { CBZ.protection.guardRing(p, dt, PS, ring); } catch (e) {}
      }
    }
    // posted men watch their sectors (the static scan of the detail brain)
    const DB = CBZ.detailBrain;
    if (DB && DB.sniper) {
      const pa = PA(), AL = J.alert;
      for (let i = 0; i < J.all.length; i++) {
        const q = J.all[i], H = q._hm;
        if (!alive(q) || !q.staffPost || !H.post) continue;
        if (q.group && !q.group.visible) continue;
        const tgt = H.hot || H.act === "look" || (AL.level >= 2 && AL.known && H.role === "roof") ? pa : null;
        try { DB.sniper(q, H.post, dt, tgt); } catch (e) {}
      }
    }
  }

  /* ================================================================
     THE POSTS: men who stand, men who walk the block, relief
     ================================================================ */
  function tickPosts(J, dt) {
    const AL = J.alert;
    for (let i = 0; i < J.all.length; i++) {
      const q = J.all[i], H = q._hm;
      if (!alive(q) || seated(q) || q.rage || H.team === "ring" || H.team === "car") continue;
      if (H.act === "fight" || H.act === "respond" || H.act === "come") continue;
      if (H.role === "rover") {
        const S = J.sites[H.site] || J.sites.home, L = S.loop;
        const w = L[H.loopAt % L.length];
        const lead = H.second ? H.buddy : null;
        if (lead && alive(lead) && !lead.rage) {
          // the second man keeps two paces behind the first
          const dx = lead.pos.x - q.pos.x, dz = lead.pos.z - q.pos.z, d = Math.hypot(dx, dz);
          if (d > 2.6) go(q, lead.pos.x - dx / d * 1.8, lead.pos.z - dz / d * 1.8, d > 14);
          else if (q.state !== "idle") holdAt(q, null);
          continue;
        }
        if (d2(q.pos.x, q.pos.z, w.x, w.z) < 2) { H.loopAt++; H.pauseT = 2 + Math.random() * 5; holdAt(q, null); }
        else if ((H.pauseT = (H.pauseT || 0) - dt) <= 0) go(q, w.x, w.z, AL.level >= 1);
        continue;
      }
      const post = H.post; if (!post) continue;
      // a man off his post walks back to it and is pinned again
      const d = d2(q.pos.x, q.pos.z, post.x, post.z);
      if (!q.staffPost) {
        if (H.role === "roof") { q.staffPost = { x: post.x, z: post.z, face: post.face }; continue; }
        if (d > 1.4) { go(q, post.x, post.z, H.act === "move" || AL.level >= 1); }
        else { holdAt(q, post.face); q.controlled = false; q.staffPost = { x: post.x, z: post.z, face: post.face }; H.act = null; post._stopped = false; }
      }
    }
  }
  // the relief: the pair that walks the block takes the door, the door pair walks
  function tickRelief(J, dt) {
    if (J.relief > 0) {
      J.relief -= dt;
      if (J.relief <= 0) J.all.forEach(function (q) { if (q._hm.role === "roof") q._hm.off = false; });
      return;
    }
    const h = hour();
    for (let i = 0; i < RELIEF.length; i++) {
      if (h < RELIEF[i] || h > RELIEF[i] + 0.2 || J.reliefDone === RELIEF[i] + ":" + (absHour() / 24 | 0)) continue;
      J.reliefDone = RELIEF[i] + ":" + (absHour() / 24 | 0);
      if (J.alert.level >= 1) return;
      J.relief = 42;
      const tk = J.M.leg === "home" ? "home" : "town";
      const T = teamOf(J, tk).filter(alive);
      const doors = T.filter(function (q) { return q._hm.role === "door"; }), rov = T.filter(function (q) { return q._hm.role === "rover"; });
      if (doors.length === 2 && rov.length === 2) {
        for (let k = 0; k < 2; k++) {
          const dq = doors[k], rq = rov[k];
          rq._hm.role = "door"; rq._hm.post = dq._hm.post; rq._hm.call = dq._hm.call; rq._hm.act = "move"; rq.staffPost = null; rq.controlled = true;
          dq._hm.role = "rover"; dq._hm.site = rov[k]._hm.site || J.M.leg; dq._hm.loopAt = k; dq._hm.second = !!k; dq._hm.post = null; dq._hm.call = "Rover"; dq.staffPost = null; dq.controlled = true;
        }
        doors[0]._hm.buddy = doors[1]; doors[1]._hm.buddy = doors[0]; rov[0]._hm.buddy = rov[1]; rov[1]._hm.buddy = rov[0];
        bark(rov[0], "Relief. You're off the door.", 2.4);
      }
      // the roof men come off the glass while the pairs change over
      J.all.forEach(function (q) { if (q._hm.role === "roof" && q._hm.team === tk) q._hm.off = true; });
      if (J.mark && distP(J.mark.pos.x, J.mark.pos.z) < 260) J.reliefSeenT = 6;
      return;
    }
  }
  // the radio check: every post in turn. A post that does not answer is an attack.
  function tickRadio(J, dt) {
    const R = J.radio, AL = J.alert;
    if (AL.level >= 2 || J.dead || !alive(J.leader)) { R.t = 30; R.list = null; return; }
    if (!R.list) {
      R.t -= dt;
      if (R.t > 0 || J.relief > 0) return;
      const tk = J.M.leg === "home" ? "home" : "town";
      R.list = teamOf(J, tk).filter(function (q) { return q._hm.role !== "rover" || !q._hm.second; });
      R.i = 0; R.gap = 1.1; R.miss = null;
      bark(J.leader, "Radio check.", 1.8);
      if (CBZ.sfxAt && distP(J.leader.pos.x, J.leader.pos.z) < 30) { try { CBZ.sfxAt("switch", J.leader.pos.x, J.leader.pos.z, { vol: 0.5 }); } catch (e) {} }
      return;
    }
    R.gap -= dt;
    if (R.gap > 0) return;
    if (R.miss) {
      if (R.miss.asked) { const q = R.miss.q; R.list = null; R.t = 50; alert(J, 2, "no answer", { x: q.pos.x, z: q.pos.z }, false); note(J, "They missed a man on the radio. It took them under a minute."); return; }
      R.miss.asked = true; R.gap = 2.6; bark(J.leader, R.miss.q._hm.call + ". " + R.miss.q._hm.call + ", report.", 2.4);
      return;
    }
    const q = R.list[R.i++];
    if (!q) { R.list = null; R.t = 48 + Math.random() * 14; return; }
    R.gap = 0.9;
    if (alive(q)) { bark(q, (q._hm.call || "Post") + ", clear.", 1.6); return; }
    // a dead man's post, answered by whoever is standing on it in his clothes
    const w = g.cityWornOutfit, pl = P();
    if (trusted(J) && w && w._hmOwner === q.name && q._hm.post && pl && pl.pos && d2(pl.pos.x, pl.pos.z, q._hm.post.x, q._hm.post.z) < 5) { once(J, "answered", "Answered the radio for him. They did not notice."); return; }
    R.miss = { q: q, asked: false }; R.gap = 2.2;
  }

  /* ================================================================
     ALERT: what they do when something is wrong
     ================================================================ */
  function alert(J, level, why, at, known) {
    const AL = J.alert;
    const up = level > AL.level;
    if (up) AL.level = level;
    AL.t = 0; AL.why = why;
    if (at) AL.at = { x: at.x, z: at.z };
    if (known) { AL.known = true; J.made = true; }
    if (level >= 2) {
      J.alarm = true;
      J.S.holdUntil = absHour() + 2;                                  // he does not go back to his day for a while
      if (up || !AL.evac) startEvac(J);
      sendResponders(J);
      if (up && alive(J.leader)) bark(J.leader, why === "body" || why === "no answer" ? "Man down. Move him. Now." : "Contact! Cover him! Get him to the car!", 2.6);
    }
    J.rev++;
  }
  function startEvac(J) {
    const AL = J.alert, M = J.M, p = J.mark;
    AL.evac = true;
    if (!p || p.dead) return;
    if (M.phase === "rolling") { if (J.trip) { J.trip.evac = true; J.trip.push = true; } return; }
    if (M.phase === "tocars" || M.phase === "alight") { M.run = true; if (M.phase === "alight") { M.phase = "tocars"; M.t = 0; M.next = M.leg === "home" ? "meet" : "home"; } return; }
    // to the cars if they are here and close, else inside against the door
    const to = M.leg === "home" ? "meet" : "home";
    if (carOk(J) && J.carsAt === M.leg && d2(p.pos.x, p.pos.z, J.cars[1].car.pos.x, J.cars[1].car.pos.z) < 70) { M.next = to; M.phase = "tocars"; M.t = 0; M.run = true; }
    else if (M.phase === "walk") { M.run = true; }
  }
  function sendResponders(J) {
    const AL = J.alert; if (!AL.at) return;
    const pool = J.all.filter(function (q) { const H = q._hm; return alive(q) && !seated(q) && !q.rage && H.team !== "ring" && H.team !== "car" && H.role !== "roof" && H.act !== "respond" && d2(q.pos.x, q.pos.z, AL.at.x, AL.at.z) < 260; });
    pool.sort(function (a, b) { return d2(a.pos.x, a.pos.z, AL.at.x, AL.at.z) - d2(b.pos.x, b.pos.z, AL.at.x, AL.at.z); });
    const have = J.all.filter(function (q) { return alive(q) && q._hm.act === "respond"; }).length;
    for (let i = 0; i < pool.length && have + i < 7; i++) {
      const q = pool[i];
      q._hm.act = "respond"; q.staffPost = null; q.controlled = true;
      walkTo(q, AL.at.x + (i % 3 - 1) * 3.5, AL.at.z + ((i / 3) | 0) * 3.5 - 2, true);
    }
  }
  function tickAlert(J, dt) {
    const AL = J.alert, pl = P(), pa = PA();
    AL.t += dt;
    const fighting = J.all.some(function (q) { return alive(q) && q.rage; });
    if (AL.level >= 2) {
      if (AL.t > 75 && !fighting) {
        AL.level = 1; AL.evac = false; AL.t = 0;
        J.all.forEach(function (q) { if (q._hm.act === "respond") { q._hm.act = q._hm.post ? "move" : null; } q._hm.hot = false; });
        if (alive(J.leader)) bark(J.leader, "Stand down to yellow. Eyes open.", 2.4);
      }
    } else if (AL.level === 1 && AL.t > 200) { AL.level = 0; AL.known = false; }
    if (AL.level < 2 || !pl || !pl.pos) return;
    const px = pl.pos.x, py = (pl.pos.y || 0) + 1.25, pz = pl.pos.z;
    const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    const high = (pl.pos.y || 0) - floorY(px, pz) > 2.2;
    const dis = trusted(J);
    let seenBy = null;
    for (let i = 0; i < J.all.length; i++) {
      const q = J.all[i], H = q._hm;
      if (!alive(q) || seated(q)) continue;
      const d = d2(q.pos.x, q.pos.z, px, pz);
      if (H.role === "roof") {
        // the roof men: a rifle on whoever it is, when they know who
        if (!AL.known || H.off || d > 240 || !eyeLos(q, px, py, pz)) { H.aimT = 0; continue; }
        H.aimT = (H.aimT || 0) + dt;
        if (CBZ.actorAimAt) { try { CBZ.actorAimAt(q, pa, dt); } catch (e) {} }
        if (H.aimT > 1.2 && (H.fireT = (H.fireT || 0) - dt) <= 0) { H.fireT = 2.3 + Math.random() * 0.9; if (CBZ.protection && CBZ.protection.longShot) { try { CBZ.protection.longShot(q, pa, d); } catch (e) {} } }
        continue;
      }
      if (H.act !== "respond" && H.team !== "ring" && !(AL.known && d < 60)) continue;
      if (q.rage) continue;
      if (d < 60 && eyeLos(q, px, py, pz)) {
        // is this the one? A gun in his hand, on a roof by where it came from, or standing where the shot was
        const near = AL.at ? d2(px, pz, AL.at.x, AL.at.z) : 1e9;
        if (!dis && (AL.known || armed || (high && near < 40) || near < 12)) { seenBy = q; }
        else if (dis && armed && d < 30) { seenBy = q; }
      }
      if (H.act === "respond" && AL.at) {
        if (d2(q.pos.x, q.pos.z, AL.at.x, AL.at.z) < 5) { if (q.state !== "idle") holdAt(q, null); H.lookT = (H.lookT || 0) - dt; if (H.lookT <= 0) { H.lookT = 1.5 + Math.random() * 2; if (q.group) q.group.rotation.y += (Math.random() - 0.5) * 2.4; } }
        else go(q, AL.at.x + ((i % 3) - 1) * 3, AL.at.z + ((i % 2) ? 2 : -2), true);
      }
    }
    if (seenBy) {
      if (!AL.known) { bark(seenBy, armed ? "There! Gun!" : "That's him!", 2); }
      if (dis) { try { if (CBZ.cityDisguiseBlow) CBZ.cityDisguiseBlow(seenBy, "He's not one of us!"); } catch (e) {} }
      AL.known = true; J.made = true; AL.at = { x: px, z: pz }; AL.t = Math.min(AL.t, 20);
      for (let i = 0; i < J.all.length; i++) {
        const q = J.all[i], H = q._hm;
        if (!alive(q) || q.rage || H.team === "car") continue;
        const d = d2(q.pos.x, q.pos.z, px, pz);
        if (H.role === "roof") { H.hot = true; continue; }
        if (H.team === "ring" && !J.dead) continue;                    // the ring stays on him (the brain sends its nearest two)
        if ((H.act === "respond" || d < 70) && (d < 45 ? eyeLos(q, px, py, pz) || d < 20 : H.act === "respond")) hostile(J, q);
      }
    }
  }

  /* ================================================================
     SENSES: watching, a gun, a face they do not know, a body
     ================================================================ */
  function trusted(J) { try { return !!(CBZ.cityDisguiseTrust && CBZ.cityDisguiseTrust("detail:" + J.id)); } catch (e) { return false; } }
  function stamp(J) {
    // (only once the strip is finished: outfits.js marks the body taken the
    // moment the 2.4 s strip starts, while the old clothes are still worn)
    if ((g.cityOutfitChanging || 0) > 0) return;
    const w = g.cityWornOutfit; if (!w || w._hmArmyStamp) return;
    const pl = P(); if (!pl || !pl.pos) return;
    for (let i = 0; i < J.all.length; i++) {
      const b = J.all[i];
      if (!b.dead || !b._clothesTaken || b._hmStripped || d2(b.pos.x, b.pos.z, pl.pos.x, pl.pos.z) > 9) continue;
      b._hmStripped = true;
      w._hmArmyStamp = J.id;
      w._claimOrg = "detail:" + J.id; w._claimRole = "Detail"; w._claimArms = "gun";
      w._hmTeam = b._hm.team; w._hmOwner = b.name; w._hmBuddy = b._hm.buddy || null;
      note(J, "In one of their " + (J.cast.dress === "suit" ? "suits" : "uniforms") + ". The posts will not look twice. The six round him know every face.");
      J.rev++;
      return;
    }
  }
  function tickSenses(J, dt) {
    const pl = P(); if (!pl || !pl.pos) return;
    const AL = J.alert, m = J.mark;
    const px = pl.pos.x, pz = pl.pos.z, py = (pl.pos.y || 0) + 1.25;
    const dis = trusted(J), w = g.cityWornOutfit;
    const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    const gl = glass();
    const dMark = m && !m.dead ? d2(px, pz, m.pos.x, m.pos.z) : 1e9;
    J.stillT = J.speed < 0.7 ? J.stillT + dt : 0;
    const lensOn = gl && m && !m.dead && camSees(m.pos.x, m.pos.y + 1.4, m.pos.z, 400, 0.985);
    const loiter = !pl.driving && J.stillT > 5 && dMark < 60;
    if (J.cordon > 0) J.cordon -= dt;
    let comers = 0;
    for (let i = 0; i < J.all.length; i++) {
      const q = J.all[i], H = q._hm;
      if (!alive(q) || seated(q) || q.rage || H.act === "fight" || H.act === "respond") { continue; }
      const dx = px - q.pos.x, dz = pz - q.pos.z, d = Math.hypot(dx, dz);
      const roof = H.role === "roof";
      const range = roof ? 175 : 62;
      let sees = false;
      if (d < range && !(roof && H.off)) {
        const yaw = q.group ? q.group.rotation.y : 0;
        const dot = d > 0.1 ? (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d : 1;
        if ((d < 3.5 || dot > (roof ? 0.45 : 0.15) || H.act === "look" || H.act === "come") && eyeLos(q, px, py, pz)) sees = true;
      }
      if (!sees) {
        H.sus = Math.max(0, H.sus - dt * 0.05);
        if ((H.act === "look" || H.act === "come") && H.sus < 0.15) { if (H.act === "come") { H.act = H.post ? "move" : null; } else H.act = null; H.asked = false; H.warned = false; }
        else if (H.act === "come" && H.last) go(q, H.last.x, H.last.z);
        continue;
      }
      H.last = { x: px, z: pz };
      // a gun in the open is not a question
      if (armed && !dis && d < 46 && !pl.driving) { if (J.t > (J.gunT || 0)) { J.gunT = J.t + 8; bark(q, "Gun! Gun!", 1.6); } alert(J, 2, "weapon", { x: px, z: pz }, true); return; }
      let rate = 0;
      if (dis) {
        // their own clothes: the posts do not look twice. The ring, the leader and the dead man's partner do.
        const knows = H.team === "ring" || q === w._hmBuddy;
        // (slow enough to read: he looks, he asks, he asks the lead, then it is gone)
        if (knows) rate = d < 6 ? 0.16 : d < 12 ? 0.06 : d < 22 ? 0.015 : 0;
        else rate = d < 2.2 ? 0.035 : 0;
        if (dMark < 6 && H.team === "ring") rate += 0.08;              // a post man has no business at his shoulder
        if (armed && d < 20) rate += 0.02;
      } else {
        if (lensOn) rate = roof ? 0.085 : d < 40 ? 0.12 : 0;           // a lens flashes a long way to a man watching roofs
        else if (loiter) rate = d < 25 ? 0.05 : 0.02;
        if (J.made && d < 45) rate = Math.max(rate, 0.16);             // they know this face already
        if (dMark < 9 && H.team === "ring") { rate += 0.14; J.cordon = 1.5; }
        if (AL.level >= 1) rate *= 1.8;
      }
      if (rate <= 0) { H.sus = Math.max(0, H.sus - dt * 0.04); continue; }
      H.sus = Math.min(1.1, H.sus + rate * dt);
      const s = H.sus;
      if (s < 0.3) continue;
      if (!H.act) { H.act = "look"; once(J, "looked", dis ? "One of the six looked at me twice." : "One of them has seen me standing here."); }
      if (H.team === "ring" || q.controlled) faceTo(q, px, pz);
      if (s >= 0.6 && H.act === "look") {
        if (roof) { bark(q, "Glass. " + COMPASS(dx, dz) + " side, " + (py - 1.25 - floorY(px, pz) > 2.5 ? "high." : "street level."), 2.4); H.sus = 0.6; H.called = (H.called || 0) + 1; nearestFree(J, q, px, pz); if (H.called >= 2) made(J, q, px, pz); }
        else if (H.team === "ring") { if (!H.asked && J.t > (J.lineT || 0)) { H.asked = true; J.lineT = J.t + 2.5; bark(q, dis ? "You. Why are you off your post?" : "Sir. Step back.", 2.2); } }
        else if (comers < 2) { H.act = "come"; q.staffPost = null; q.controlled = true; bark(q, dis ? "Hey. Which team are you on?" : "You have been standing there a while. Move along.", 2.6); once(J, "came", "One of them walked over and told me to move."); }
      }
      if (H.act === "come") {
        comers++;
        if (d > 2.8) { if (!q.finalGoal || d2(q.finalGoal.x, q.finalGoal.z, px, pz) > 2.5 || q.state !== "walk") walkTo(q, px, pz); }
        else if (q.state !== "idle") holdAt(q, null);
      }
      if (s >= 0.85 && !H.warned) { H.warned = true; bark(q, dis ? "Where is " + (w._hmOwner ? String(w._hmOwner).split(" ")[0] : "he") + "? Lead, I have a face I don't know." : "I will not ask again.", 2.6); }
      if (s >= 1) {
        if (dis) { try { if (CBZ.cityDisguiseBlow) CBZ.cityDisguiseBlow(q, "That is not " + (w._hmOwner ? String(w._hmOwner).split(" ")[0] : "him") + "!"); } catch (e) {} note(J, "They know the clothes are not mine."); alert(J, 2, "impostor", { x: px, z: pz }, true); return; }
        made(J, q, px, pz); H.sus = 0.7; H.warned = false;
      }
    }
    // a body a living man can see
    for (let i = 0; i < J.all.length; i++) {
      const b = J.all[i];
      if (!b.dead || b._hmFound) continue;
      for (let k = 0; k < J.all.length; k++) {
        const q = J.all[k];
        if (!alive(q) || seated(q) || q === b) continue;
        const d = d2(q.pos.x, q.pos.z, b.pos.x, b.pos.z);
        if (d > 18 || Math.abs((q.pos.y || 0) - (b.pos.y || 0)) > 3.5 || !eyeLos(q, b.pos.x, (b.pos.y || 0) + 0.4, b.pos.z)) continue;
        b._hmFound = true;
        bark(q, "Man down! " + (b._hm.call || "Post") + " is down!", 2.6);
        if (AL.level < 2) note(J, "They found the body.");
        alert(J, 2, "body", { x: b.pos.x, z: b.pos.z }, false);
        break;
      }
    }
    // the man himself, hit and not dead
    if (m && !m.dead && m.hp != null && m.maxHp != null && m.hp < m.maxHp - 1 && !J.hurt) { J.hurt = true; alert(J, 2, "hit", AL.at, false); }
  }
  // they have a face now: the nearest free man walks him off, and the principal is moved along
  function made(J, q, px, pz) {
    if (!J.made) { J.made = true; note(J, "They have my face now. They moved him along early."); }
    bark(q, "Lead, surveillance. One, " + COMPASS(px - q.pos.x, pz - q.pos.z) + " side.", 2.6);
    if (J.alert.level < 1) alert(J, 1, "surveillance", { x: px, z: pz }, false);
    if (J.M.phase === "dwell" && J.M.t > 20) J.M.cut = true;
  }
  function nearestFree(J, from, px, pz) {
    let best = null, bd = 90;
    for (let i = 0; i < J.all.length; i++) {
      const q = J.all[i], H = q._hm;
      if (!alive(q) || seated(q) || q.rage || H.act || H.team === "ring" || H.team === "car" || H.role === "roof") continue;
      const d = d2(q.pos.x, q.pos.z, px, pz);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) { best._hm.act = "come"; best._hm.sus = Math.max(best._hm.sus, 0.62); best._hm.last = { x: px, z: pz }; best.staffPost = null; best.controlled = true; walkTo(best, px, pz); }
    void from;
  }

  /* ================================================================
     THE JOB
     ================================================================ */
  function onShot(J, x, z, loud) {
    if (!J.staged) return;
    J.lastShot = { x: x, z: z, loud: loud, t: J.t };
    const hear = loud ? 320 : 30;
    let heard = false, near = 1e9;
    for (let i = 0; i < J.all.length; i++) { const q = J.all[i]; if (!alive(q)) continue; const d = d2(q.pos.x, q.pos.z, x, z); if (d < near) near = d; if (d < hear) heard = true; }
    if (!heard) return;
    // placed roughly: the further the shot, the wider the guess; a second shot narrows it
    const err = Math.min(38, near * (J.alert.level >= 2 ? 0.07 : 0.14));
    alert(J, 2, "shots", { x: x + (Math.random() - 0.5) * err, z: z + (Math.random() - 0.5) * err }, false);
  }
  function onKill(J, ped, imp) {
    if (!ped || ped === J.mark || ped._hmArmy !== J.id) return;
    // a man who drops where his partner can see him drop
    const seen = J.all.some(function (q) { return alive(q) && !seated(q) && q !== ped && d2(q.pos.x, q.pos.z, ped.pos.x, ped.pos.z) < 26 && eyeLos(q, ped.pos.x, (ped.pos.y || 0) + 1, ped.pos.z); });
    if (!seen) return;
    ped._hmFound = true;
    let at = { x: ped.pos.x, z: ped.pos.z };
    const ls = J.lastShot;
    if (ls && J.t - ls.t < 4 && !ls.loud && imp && isFinite(imp.fromX)) {
      // no report, but they saw which way he fell: a bearing, and a bad guess at the range
      const dx = imp.fromX - ped.pos.x, dz = imp.fromZ - ped.pos.z, d = Math.hypot(dx, dz) || 1, r = Math.min(d, 40 + Math.random() * 50);
      at = { x: ped.pos.x + dx / d * r + (Math.random() - 0.5) * 20, z: ped.pos.z + dz / d * r + (Math.random() - 0.5) * 20 };
    } else if (J.alert.at && J.alert.level >= 2) at = null;
    alert(J, 2, "man down", at, false);
  }
  function onDead(J, inc) {
    J.dead = true;
    note(J, (J.cast.name.split(" ").slice(-1)[0]) + " is dead.");
    const m = J.mark, ls = J.lastShot;
    let at = J.alert.at;
    if (ls && J.t - ls.t < 6 && ls.loud) { const far = d2(ls.x, ls.z, m.pos.x, m.pos.z), err = Math.min(30, far * 0.1); at = { x: ls.x + (Math.random() - 0.5) * err, z: ls.z + (Math.random() - 0.5) * err }; }
    alert(J, 2, "principal down", at, false);
    J.alert.t = -45;                                                  // they hunt longer for the man who did it
    if (alive(J.leader)) bark(J.leader, "Principal is down! Find him! Find the shooter!", 3);
    // the ring has nobody left to stand round
    J.ring.forEach(function (q, i) { if (alive(q) && i > 1) q._hm.team = "hunt"; });
    sendResponders(J);
    void inc;
  }
  function tick(J, dt) {
    J.t += dt;
    const pl = P();
    if (pl && pl.pos) {
      if (J.pp) { const v = d2(pl.pos.x, pl.pos.z, J.pp.x, J.pp.z) / Math.max(0.05, dt); J.speed = J.speed * 0.5 + v * 0.5; }
      J.pp = { x: pl.pos.x, z: pl.pos.z };
    }
    // build the roster a few bodies at a time
    if (J.Q && J.Q.length) { if (!CBZ.citySpawnDraining) for (let n = 0; n < 3 && J.Q.length; n++) { try { J.Q.shift()(); } catch (e) { J.why = "roster: " + (e && e.message); } } return; }
    if (!J.staged || !J.mark) return;
    stamp(J);
    tickParty(J, dt);
    tickPosts(J, dt);
    tickRelief(J, dt);
    tickRadio(J, dt);
    tickSenses(J, dt);
    tickAlert(J, dt);
    // what he has seen for himself goes in the folder
    const m = J.mark, S = J.S;
    S.legs = S.legs || {};
    if (!m.dead && seesPed(m)) {
      J.idT = (J.idT || 0) + dt;
      if (J.idT > 0.6 && once(J, "id", "That is him. " + (J.cast.dress === "suit" ? "Grey man in the middle of the black suits." : "The beret, in the middle of the helmets."))) J.identified = true;
      if (J.M.phase === "dwell" && !S.legs[J.M.leg]) { S.legs[J.M.leg] = 1; note(J, LEG_LABEL[J.M.leg] + ": " + J.sites[J.M.leg].name + "."); }
      if (J.M.phase === "walk" && J.M.route && (J.M.next === "eat" || J.M.next === "meet") && !seated(m)) once(J, "walk", "He walks between " + J.sites.meet.name + " and " + J.sites.eat.name + ". In the open, the six round him.");
      if ((J.M.phase === "tocars" || J.M.phase === "alight")) once(J, "door", "Between the car and the door he is in the open for about ten seconds. He rides rear right, middle car.");
    }
    if (J.trip && J.cars[1] && seesPed({ pos: J.cars[1].car.pos, group: J.cars[1].car.group })) once(J, "route", "Watched the column on the road. Three cars. It slows right down for the corners.");
    if (J.reliefSeenT > 0) { J.reliefSeenT -= dt; const r = J.all.filter(function (q) { return q._hm.role === "roof" && q._hm.off && seesPed(q); })[0]; if (r) once(J, "relief", "The roof men come off the glass while the door changes over. " + RELIEF.map(hhmm).join(", ") + ". Under a minute."); }
    let n = S.count | 0;
    if ((J.cntT = (J.cntT || 0) - dt) <= 0) {
      J.cntT = 1;
      for (let i = 0; i < J.all.length; i++) { const q = J.all[i]; if (!q._hmSeen && !q.dead && !seated(q) && seesPed(q)) { q._hmSeen = true; n++; if (q._hm.role === "roof") once(J, "roof", "Men on the roofs. " + (J.cast.dress === "suit" ? "Rifles." : "Marksmen.")); } }
      if (n !== (S.count | 0)) { S.count = n; J.rev++; }
    }
  }
  function pinAt(J) {
    if (J.dead || !J.sites) return null;
    const s = J.sites[J.S.legs && J.S.legs.meet ? "meet" : "home"];
    return { x: s.steps.x, z: s.steps.z, label: J.cast.name.split(" ").slice(-1)[0], key: s.key };
  }
  function end(J, hard) {
    const K = kit();
    for (let i = 0; i < J.all.length; i++) dismiss(J.all[i], hard);
    if (J.mark) dismiss(J.mark, hard);
    for (let i = 0; i < J.cars.length; i++) { const c = J.cars[i].car; if (c && !c.player && K) { if (hard || unseen(c.pos.x, c.pos.z)) { try { K.removeCar(c); } catch (e) {} } else c._hmArmy = null; } }
    J.cars = []; J.trip = null; J.all = []; J.ring = []; J.staged = false; J.Q = null;
    if (CBZ.detailBrain && CBZ.detailBrain.drop && J.mark) { try { CBZ.detailBrain.drop("ring:" + (J.mark._sid || J.mark.name || "p")); } catch (e) {} }
    if (LIVE === J) LIVE = null;
  }

  /* ================================================================
     PAPER
     ================================================================ */
  function file(J) {
    const c = J.cast, S = J.S, K = S.known || {}, legs = S.legs || {};
    const sur = c.name.split(" ").slice(-1)[0];
    const routine = ["home", "meet", "eat"].map(function (k) {
      const s = J.sites[k];
      const detail = k === "home" ? "On the steps of " + s.name + " with the six. The cars wait at the kerb."
        : k === "meet" ? "Does business on the steps of " + s.name + ". The town team holds the block before he gets there."
        : "Eats at " + s.name + ". He walks it from the meeting when the street allows, the ring round him.";
      return { label: LEG_LABEL[k], dur: "from " + legFrom(k).join(" and "), detail: detail, seen: k === "home" || !!legs[k], now: !J.dead && J.M.leg === k && J.M.phase === "dwell" && !!legs[k] };
    });
    const n = S.count | 0;
    const approaches = [
      { label: "From a distance", detail: "He is in the open between the car and the door, and on the walk to lunch. Roof men watch the high ground. A lens held on them gets seen.", known: !!(K.door || K.walk) },
      { label: "Their clothes", detail: "A " + (c.dress === "suit" ? "suit" : "uniform") + " off one of them walks through the posts. The six round him and the dead man's partner know every face. The radio goes round the posts every minute.", known: !!K.came || !!S.count },
      { label: "The road", detail: "Three cars, the same road each time. He rides rear right in the middle one. It is armoured below the glass. It slows right down for the corners.", known: !!K.route },
      { label: "The roof", detail: "Two of them on a roof at each place. They come off the glass when the door changes over: " + RELIEF.map(hhmm).join(", ") + ".", known: !!K.relief || !!K.roof },
      { label: "After", detail: "They put him in the car and the rest come for whoever fired. Be somewhere else before they have a direction.", known: true },
    ];
    return {
      codename: c.codename, opLabel: "", classification: "PRIVATE", header: sur.toUpperCase(),
      status: J.dead ? "DONE" : "OPEN",
      subject: { name: c.name, role: c.role, photo: J.photo || "", note: c.dress === "suit" ? "Never alone. Dark suits round him." : "Never alone. Soldiers round him." },
      identified: J.identified ? true : false,
      brief: c.brief,
      facts: [
        { k: "RESIDENCE", v: J.sites.home.name },
        { k: "DETAIL", v: "Thirty " + c.men + ". " + (c.dress === "suit" ? "Submachine guns under the jackets." : "Rifles, plates, helmets.") },
        { k: "FEE", v: money(c.pay) + ". Half again if nobody knows it was you." },
      ],
      routine: routine,
      security: [
        { label: "Close", detail: "Six and a leader, round him wherever he stands.", seen: n > 0 },
        { label: "Sites", detail: "Ten at the residence, ten in town: door, corners, roof, a pair walking the block.", seen: n > 6 },
        { label: "Counted", detail: n + " of thirty seen", seen: n > 0 },
      ],
      approaches: approaches,
      kit: g.cityWornOutfit && g.cityWornOutfit._hmArmyStamp === J.id ? ["One of their " + (c.dress === "suit" ? "suits" : "uniforms")] : [],
      notes: (S.notes || []).slice(-8),
      map: { places: ["home", "meet", "eat"].map(function (k) { return { x: J.sites[k].steps.x, z: J.sites[k].steps.z, label: k === "home" || legs[k] ? (k === "home" ? "home" : k === "meet" ? "meets" : "eats") : "?" }; }) },
      stamp: J.dead ? "PAID" : null,
      footer: J.dead ? "" : "Nothing on this page you did not see yourself, except where he sleeps.",
    };
  }
  const BOARD = {};
  function cached(id, key, make) {
    const c = BOARD[id];
    if (c && c.key === key) return c.canvas;
    let cv = null; try { cv = make(c ? c.canvas : null); } catch (e) { cv = null; }
    BOARD[id] = { key: key, canvas: cv };
    return cv;
  }
  function board(J) {
    const K = CBZ.hmPaper, R = CBZ.hmRoom; if (!K) return null;
    const redraw = { onRedraw: function () { if (R && R.board && R.board.refresh) R.board.refresh(); } };
    const c = J.cast, S = J.S, legs = S.legs || {}, sur = c.name.split(" ").slice(-1)[0];
    const items = [];
    const pol = cached(J.id + "pol", !!J.photo + ":" + J.dead, function (re) { return K.polaroid({ photo: J.photo || null, caption: sur, crossed: !!J.dead }, Object.assign({ canvas: re }, redraw)); });
    if (pol) items.push({ id: "live", canvas: pol, w: 0.24, h: 0.288, x: -0.64, y: 0.08, rot: -0.04, pin: "red", links: ["map"] });
    const places = ["home", "meet", "eat"].map(function (k) { return { x: J.sites[k].steps.x, z: J.sites[k].steps.z, label: k === "home" || legs[k] ? (k === "home" ? "home" : k === "meet" ? "meets" : "eats") : "?" }; });
    const mp = cached(J.id + "map", places.map(function (p) { return p.label + (p.x | 0); }).join(","), function (re) { return K.map({ places: places }, { canvas: re }); });
    if (mp) items.push({ id: "map", canvas: mp, w: 0.46, h: 0.46, x: -0.06, y: 0.02, rot: 0.02, pin: "red" });
    const cards = [
      ["Home " + legFrom("home")[0], "Meets " + legFrom("meet").join(", "), "Eats " + legFrom("eat").join(", ")],
      [(S.count | 0) + " of 30 counted", "Radio every minute", "Relief " + RELIEF.map(hhmm).slice(0, 2).join(", ")],
    ];
    for (let i = 0; i < cards.length; i++) {
      const cv = cached(J.id + "card" + i, cards[i].join("|"), function (re) { return K.note({ lines: cards[i], hand: true, tone: i ? "yellow" : "index" }, { canvas: re }); });
      if (cv) items.push({ id: "card" + i, canvas: cv, w: 0.24, h: 0.156, x: 0.58, y: 0.24 - i * 0.24, rot: (i ? 0.04 : -0.03), pin: "red", links: i ? [] : ["map"] });
    }
    return items;
  }

  let LIVE = null;
  function make(cast, S) {
    const J = {
      id: cast.id, cast: cast, S: S, name: cast.name, role: cast.role.split(".")[0], pay: cast.pay, weight: "someone", cause: "shot", alarm: false,
      kills: { civ: 0, guard: 0 }, mark: null, t: 0, rev: 0, speed: 0, pp: null, stillT: 0, cordon: 0, lastShot: null,
      all: [], ring: [], leader: null, cars: [], carsAt: null, trip: null, staged: false, Q: null,
      alert: { level: 0, t: 0, why: null, at: null, known: false, evac: false }, radio: { t: 35, list: null, i: 0, gap: 0, miss: null },
      relief: 0, made: false, dead: false, identified: false, photo: "", nation: null,
    };
    const V = pickVenues(J);
    if (!V) return null;
    J.nation = cast.dress === "uniform" ? (S.nation || (S.nation = pickNation(J))) : null;
    J.sites = { home: siteOf("home", V.home), meet: siteOf("meet", V.meet), eat: siteOf("eat", V.eat) };
    J.M = { leg: legNow(), phase: "dwell", t: 0, next: null, route: null, lead: 0, cut: false, run: false };
    queueRoster(J);
    J.file = function () { return file(J); };
    J.board = function () { return board(J); };
    J.boardKey = function () { return [J.rev, J.dead, !!J.photo].join(":"); };
    J.tick = function (dt) { tick(J, dt); };
    J.frame = function (dt) { frame(J, dt); };
    J.pinAt = function () { return pinAt(J); };
    J.isGuard = function (p) { return !!(p && p._hmArmy === J.id && p !== J.mark); };
    J.onKill = function (ped, imp) { onKill(J, ped, imp || {}); };
    J.onDead = function (inc) { onDead(J, inc); };
    J.onShot = function (x, z, loud) { onShot(J, x, z, loud); };
    J.place = function () { return J.sites[J.M.leg] ? J.sites[J.M.leg].name : undefined; };
    J.end = function (hard) { end(J, hard); };
    LIVE = J;
    return J;
  }
  Object.keys(CAST).forEach(function (k) {
    const c = CAST[k];
    CBZ.hitmanJobs.add({
      id: c.id, order: c.order, from: "Nico",
      call: c.call.map(function (l) { return { by: "phone", line: l }; }),
      when: function () { return allLots().length > 12 && !!kit(); },
      make: function (S) { return make(c, S); },
    });
  });

  // probes: the live staging, and the beats driven by hand
  CBZ.hmArmy = {
    live: function () { return LIVE; },
    alert: function (level, known) { const pl = P(); if (LIVE && pl) alert(LIVE, level == null ? 2 : level, "shots", { x: pl.pos.x, z: pl.pos.z }, !!known); return LIVE ? LIVE.alert.level : null; },
    depart: function (to) { if (!LIVE) return false; depart(LIVE, to); return LIVE.M.phase; },
    relief: function () { if (!LIVE) return false; LIVE.reliefDone = null; const h = hour(); RELIEF.unshift(h); tickRelief(LIVE, 0.2); RELIEF.shift(); return LIVE.relief; },
    radio: function () { if (LIVE) LIVE.radio.t = 0; return true; },
    audit: function () {
      const J = LIVE; if (!J) return null;
      const m = J.mark, by = {};
      J.all.forEach(function (q) { const k = q._hm.team + ":" + q._hm.role + (q.dead ? ":dead" : ""); by[k] = (by[k] | 0) + 1; });
      return {
        id: J.id, staged: J.staged, queue: J.Q ? J.Q.length : 0, n: J.all.length, by: by, nation: J.nation,
        sites: J.sites ? { home: J.sites.home.name, meet: J.sites.meet.name, eat: J.sites.eat.name, roofs: [J.sites.home.roofs.length, J.sites.meet.roofs.length], walk: !!walkRoute(J.sites.meet.steps, J.sites.eat.steps), dHomeMeet: Math.round(d2(J.sites.home.cx, J.sites.home.cz, J.sites.meet.cx, J.sites.meet.cz)), dMeetEat: Math.round(d2(J.sites.meet.cx, J.sites.meet.cz, J.sites.eat.cx, J.sites.eat.cz)) } : null,
        M: { leg: J.M.leg, phase: J.M.phase, next: J.M.next, t: Math.round(J.M.t) },
        mark: m ? { at: [Math.round(m.pos.x), Math.round(m.pos.z)], dead: !!m.dead, inCar: seated(m), state: m.state, hp: m.hp } : null,
        cars: J.cars.map(function (f) { return [Math.round(f.car.pos.x), Math.round(f.car.pos.z), +(f.car.v || 0).toFixed(1)]; }), carsAt: J.carsAt,
        trip: J.trip ? { s: Math.round(J.trip.s), len: Math.round(J.trip.P.len), v: +J.trip.v.toFixed(1), to: J.trip.to, evac: J.trip.evac, blocked: +J.trip.blocked.toFixed(1) } : null,
        alert: { level: J.alert.level, why: J.alert.why, known: J.alert.known, evac: J.alert.evac, t: Math.round(J.alert.t), at: J.alert.at ? [Math.round(J.alert.at.x), Math.round(J.alert.at.z)] : null },
        acts: J.all.filter(function (q) { return q._hm.act || q.rage || q._hm.sus > 0.05; }).map(function (q) { return (q._hm.team + "/" + q._hm.role + ":" + (q.rage ? "RAGE" : q._hm.act || "") + ":" + q._hm.sus.toFixed(2)); }).slice(0, 14),
        made: J.made, relief: Math.round(J.relief), trusted: trusted(J), notes: (J.S.notes || []).slice(-5), why: J.why || null,
      };
    },
  };
})();
