/* ============================================================
   city/hitman_m_general.js — THE GENERAL. (authored job "general")

   OWNER: "A corrupt general in the existing military base, where you have to
   steal a uniform. There is already logic built to take clothes off a person
   you take out, and that can get you into the military base without
   suspicion, and you can get to a roof with a ladder and get a shot at the
   general."

   Nothing here is a new base or a new disguise system. It is the Fort Brandt
   city/island_military.js already builds (CBZ._militaryBase: its plan, its
   gate, its sixty soldiers), the corpse strip city/outfits.js already has
   (CBZ.cityOutfitSwapWithCorpse stamps a dead soldier's fatigues with the
   claim "army"), and the climbing ladders of systems/climb.js. This file adds
   the people and the rules that make them a job:

     THE MAN      General Aurel Strand lives inside the wire and keeps a day on
                  the city clock: the morning and afternoon parade (he walks
                  the front rank and takes the salute at the reviewing stand),
                  the drive to the guardhouse to look at the gate guard, the
                  flag at retreat, and otherwise his office in headquarters,
                  where he stands at the window when he is on the telephone.
                  An aide and a sergeant walk with him; a driver sits in his car.
     THE UNIFORM  A private who drinks alone in town, two men on a post on the
                  road in, one man walking the outside of the wire. Take one
                  quietly, strip him with the verb the game already has, and
                  the gate nods a soldier through.
     NOT MAGIC    Whether a soldier accepts you is ONE answer, the base's own:
                  city/basewatch.js (CBZ.cityBaseStanding). Every soldier who
                  can see you keeps his own doubt there, and you can watch it:
                  he turns and holds the look, he walks over, he keys his
                  radio, and only then is it an alarm. This file lends it what
                  only the job knows (CBZ.cityBaseLens): the men of the dead
                  man's own company know his face; a private near
                  headquarters gets looked at; a man up the ladder or on a
                  roof. Running, a drawn weapon and glass are the base's.
     THE ROOF     One real ladder (CBZ.ladderKit) is stood against the blind
                  wall of the roof with the best lines to where the general
                  stands. Which roof is worked out from the base's own plan
                  and real lines of fire, never typed in.
     AFTER        The siren, the booms down across both gates, the parade
                  breaks for stand-to (CBZ.cityBaseStandTo: a stranger inside
                  is shot on sight, a uniform looked at hard, harder at the
                  sealed gate), the nearest men run for where the shot came
                  from. A base that finds nobody stands down after a while.
                  There are walk-through gaps in the wire on the sea sides.

   Registered with CBZ.hitmanJobs (city/hitman.js): the burner, the envelope,
   the folder and the dead drop are that file's. No panel, no objective.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game || !CBZ.hitmanJobs || !CBZ.hitmanJobs.add) return;
  const g = CBZ.game;

  const NAME = "General Aurel Strand";
  const ROLE = "Commanding general, Fort Brandt";
  const PAY = 90000;
  const TAG = "hm:general";
  const PRIVATE = { name: "Dale Marsh", rank: "private", unit: "B Company" };

  /* ---------------- small reads ---------------- */
  function P() { return CBZ.player || null; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function A() { return CBZ.city && CBZ.city.arena; }
  function floorY(x, z) { try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function distP(x, z) { const p = P(); return p && p.pos ? d2(p.pos.x, p.pos.z, x, z) : Infinity; }
  function hour() { const h = CBZ.cityHour ? CBZ.cityHour() : 12; return isFinite(h) ? h : 12; }
  function hhmm(h) { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function h01(a, b) { return CBZ.hash01 ? CBZ.hash01(a | 0, b | 0, 0x6e1) : ((Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1 + 1) % 1; }
  function los(ax, ay, az, bx, by, bz) {
    if (!CBZ.clearLineOfFire) return true;
    try { return !!CBZ.clearLineOfFire(ax, ay, az, bx, by, bz); } catch (e) { return true; }
  }
  function bark(ped, line, secs) { if (ped && !ped.dead && CBZ.citySay) { try { CBZ.citySay(ped, line, "#e8e2d4", secs || 2.6); } catch (e) {} } }
  function base() { return CBZ._militaryBase || null; }
  function baseRegion() {
    const R = (A() && A().regions) || [];
    for (let i = 0; i < R.length; i++) if (R[i] && R[i].biome === "military" && R[i].kind === "rect") return R[i];
    return null;
  }
  function inRect(B, x, z, pad) { return x > B.minX - pad && x < B.maxX + pad && z > B.minZ - pad && z < B.maxZ + pad; }
  function bw(B, lx, lz) { return { x: B.center.x + lx, z: B.center.z + lz }; }           // plan-local -> world
  function planOf(B, id) { const L = (B.plan && B.plan.build) || []; for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }
  function shellAt(x, z) {
    const AR = A(), S = AR && AR.root && AR.root.userData ? AR.root.userData.shells : null;
    if (!S) return null;
    for (let i = 0; i < S.length; i++) if (S[i] && d2(S[i].ox, S[i].oz, x, z) < 3) return S[i];
    return null;
  }
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
    return glass() ? camSees(p.pos.x, p.pos.y + 1.5, p.pos.z, 420, 0.994) : camSees(p.pos.x, p.pos.y + 1.5, p.pos.z, 40, 0.86);
  }

  /* ---------------- bodies ---------------- */
  function walkTo(p, x, z, run) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null; p._navOk = true;          // (routed round walls: city/pednav.js)
    const goal = { x: x, z: z };
    p.path = [goal]; p.finalGoal = goal;
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = run ? "flee" : "walk"; p.pause = 0;
  }
  // keep him walking to (x,z): issued again whenever he is not on that errand
  function go(p, x, z, run) {
    const fg = p && p.finalGoal;
    if (!fg || Math.abs(fg.x - x) > 0.6 || Math.abs(fg.z - z) > 0.6 || (p.state !== "walk" && p.state !== "flee")) walkTo(p, x, z, run);
  }
  function holdAt(p, faceYaw) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (faceYaw != null && p.group) p.group.rotation.y = faceYaw;
  }
  function faceTo(p, x, z) { if (p && p.group && p.pos) p.group.rotation.y = Math.atan2(x - p.pos.x, z - p.pos.z); }
  function place(p, x, z) {
    if (!p || !p.pos) return;
    p.pos.set(x, floorY(x, z), z);
    if (p.group) p.group.position.copy(p.pos);
    if (p.target && p.target.set) p.target.set(x, 0, z);
  }
  function hostile(q) {
    if (!q || q.dead || (q.ko || 0) > 0) return;
    const pa = PA(); if (!pa) return;
    q.staffPost = null; q.controlled = false; q._hmCtl = false;
    q.rage = pa; q.state = "fight"; q.pause = 0; q.path = null;
    q.aggr = Math.max(q.aggr || 0, 0.95); q.fear = 0;
    if (q.armed && q.ammo != null && q.ammo < 20) q.ammo = 60;
  }
  function fatigues(over) {
    let cat = null;
    try { cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null; } catch (e) { cat = null; }
    const b = cat && cat.soldier;
    if (!b) return null;
    const r = Object.assign({}, b, over || {});
    r.colors = Object.assign({}, b.colors);
    return r;
  }
  function soldier(name, x, z, o) {
    if (!CBZ.cityPostNpc) return null;
    o = o || {};
    let p = null;
    try {
      p = CBZ.cityPostNpc(x, z, {
        job: "soldier", kind: "civilian", archetype: "professional", gender: "m", name: name,
        armed: o.armed !== false, weapon: o.armed === false ? null : (o.weapon || "AK-47"),
        aggr: o.aggr != null ? o.aggr : 0.5, hp: o.hp || 140, wealth: 0.4, src: "hitman:general", face: o.face,
      });
    } catch (e) { p = null; }
    if (!p) return null;
    p.name = name; p.nameKnown = false;
    p.milRank = o.rank || "private";
    p.organization = "military"; p.organizationLoyalty = 100;
    p._hmGeneral = true; p._hmUnit = o.unit || "";
    p._campaignTarget = true;                                 // the shared "spoken for" stamp
    p._lodOk = true;                                          // drawn by the city's own distance band (city/peds.js)
    p.controlled = true; p.state = "idle"; p.pause = 1;
    if (o.rec) { p._wornOutfit = o.rec; if (CBZ.cityRedressPed) { try { CBZ.cityRedressPed(p); } catch (e) {} } }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    return p;
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
    if (p.dead) return;                                       // a body stays where it fell
    if (!hard && CBZ.leave && CBZ.leave.go && p.group && p.group.parent) { p.rage = null; p.controlled = false; CBZ.leave.go(p, { tag: "hitman:general", remove: removeNow }); }
    else { if (CBZ.leave && CBZ.leave.cancel) { try { CBZ.leave.cancel(p); } catch (e) {} } removeNow(p); }
  }

  /* ---------------- who is a soldier, and whose ---------------- */
  const RANK_N = { recruit: 0, private: 0, corporal: 1, sergeant: 2, lieutenant: 3, captain: 3, general: 5 };
  function rankN(r) { return RANK_N[r] != null ? RANK_N[r] : 0; }
  function soldiers() {
    if (CBZ.militaryPersonnel) { try { return CBZ.militaryPersonnel(); } catch (e) {} }
    const out = [], L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length; i++) { const p = L[i]; if (p && !p.dead && (p.organization === "military" || p.milRank)) out.push(p); }
    return out;
  }
  // the company a man stands in. The men who share it knew him.
  function unitOf(q) {
    if (!q) return "";
    if (q._hmUnit) return q._hmUnit;
    if (q._drill) return "B Company";
    const tag = q._post && q._post.tag ? String(q._post.tag) : "";
    if (tag.indexOf("gate") >= 0) return "the gate guard";
    if (tag.indexOf("watch") >= 0 || tag.indexOf("flag") >= 0 || tag.indexOf("armoury") >= 0 || rankN(q.milRank) >= 3) return "headquarters";
    return "A Company";
  }
  function uniform() { const w = g.cityWornOutfit; return w && w._claimOrg === "army" ? w : null; }
  // the base's one answer (city/basewatch.js): does a soldier accept him
  function standing() {
    if (CBZ.cityBaseStanding) { try { return CBZ.cityBaseStanding(); } catch (e) {} }
    return { standing: "challenged", why: "", level: 0 };
  }
  function inUniform() { if (!uniform()) return false; const s = standing(); return s.standing === "allowed" && s.why === "in uniform"; }

  /* ---------------- notes: his own hand, in the folder ---------------- */
  function note(J, line) {
    const N = (J.S.notes = J.S.notes || []);
    if (N.length && N[N.length - 1].indexOf(line) >= 0) return;
    N.push(hhmm(hour()) + "  " + line);
    if (N.length > 10) N.splice(0, N.length - 10);
    J.rev++;
  }
  function once(J, key, line) { const K = (J.S.known = J.S.known || {}); if (K[key]) return false; K[key] = 1; if (line) note(J, line); J.rev++; return true; }

  /* ================================================================
     TOWN: a private who drinks alone
     ================================================================ */
  function doorOf(l) { return l && l.building && l.building.door; }
  function outward(lot) {
    const d = doorOf(lot); if (!d) return { x: 0, z: 1 };
    const ox = d.x - lot.cx, oz = d.z - lot.cz, m = Math.hypot(ox, oz);
    return m < 0.01 ? { x: d.nx || 0, z: d.nz || 1 } : { x: ox / m, z: oz / m };
  }
  function lotName(lot) {
    const b = lot && lot.building;
    if (b && b.name) { const n = String(b.name).trim(); return n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase(); }
    const K = { bar: "the bar", food: "the diner", club: "the club", casino: "the casino" };
    return (lot && K[lot.kind]) || "the bar";
  }
  function lotKey(l) { return l ? (Math.round(l.cx) + ":" + Math.round(l.cz)) : null; }
  function townLot(J) {
    const AR = A(); if (!AR) return null;
    const L = (AR.lots || []).concat(AR.shopLots || []);
    const seen = [], pool = [];
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!l || seen.indexOf(l) >= 0 || !doorOf(l) || l.demolished) continue;
      seen.push(l);
      if (J.S.bar && lotKey(l) === J.S.bar) return l;
      if (l.kind === "bar" || l.kind === "club" || l.kind === "food") pool.push(l);
    }
    if (!pool.length) return null;
    const rm = CBZ.hmRoom && CBZ.hmRoom.ensure ? CBZ.hmRoom.ensure() : null;
    const cx = rm && rm.center ? rm.center.x : (P() ? P().pos.x : 0), cz = rm && rm.center ? rm.center.z : (P() ? P().pos.z : 0);
    // a bar before a diner, and not next door to his own bed
    pool.sort(function (a, b) {
      const sa = (a.kind === "bar" ? 0 : a.kind === "club" ? 60 : 120) + Math.abs(d2(a.cx, a.cz, cx, cz) - 150);
      const sb = (b.kind === "bar" ? 0 : b.kind === "club" ? 60 : 120) + Math.abs(d2(b.cx, b.cz, cx, cz) - 150);
      return sa - sb;
    });
    J.S.bar = lotKey(pool[0]);
    return pool[0];
  }
  function stageTown(J) {
    if (J.town || J.townTried) return;
    J.townTried = true;
    const lot = townLot(J); if (!lot) return;
    const d = doorOf(lot), o = outward(lot), sx = -o.z, sz = o.x;
    const b = lot.building;
    const cx = b.ox != null ? b.ox : lot.cx, cz = b.oz != null ? b.oz : lot.cz;
    const along = Math.abs(o.x) > 0.5;
    const ext = ((along ? b.w : b.d) || (along ? lot.w : lot.d) || 16) / 2, lat = ((along ? b.d : b.w) || (along ? lot.d : lot.w) || 16) / 2;
    const front = { x: d.x + o.x * 2.4 + sx * 2.2, z: d.z + o.z * 2.4 + sz * 2.2 };
    // the corner of the building he walks to with a cigarette, and round it
    // the blind side wall, if the wall is really open to walk along
    let side = 1;
    const corner = function (s) { return { x: cx + o.x * (ext + 1.7) + sx * s * (lat + 1.7), z: cz + o.z * (ext + 1.7) + sz * s * (lat + 1.7) }; };
    const behind = function (s) { return { x: cx - o.x * ext * 0.3 + sx * s * (lat + 1.7), z: cz - o.z * ext * 0.3 + sz * s * (lat + 1.7) }; };
    const inside = function (q) { try { return !!(CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(q.x, q.z)); } catch (e) { return false; } };
    const open = function (s) { const c = corner(s), k = behind(s); return !inside(c) && !inside(k) && los(c.x, floorY(c.x, c.z) + 1, c.z, k.x, floorY(k.x, k.z) + 1, k.z) && los(front.x, floorY(front.x, front.z) + 1, front.z, c.x, floorY(c.x, c.z) + 1, c.z); };
    let alley = open(1);
    if (!alley && open(-1)) { side = -1; alley = true; }
    const c1 = corner(side), smoke = alley ? behind(side) : c1;
    const rec = fatigues({ kit: null, name: "Fatigues" });
    const p = soldier(PRIVATE.name, front.x, front.z, { rank: PRIVATE.rank, unit: PRIVATE.unit, armed: false, aggr: 0.2, hp: 100, rec: rec, face: Math.atan2(o.x, o.z) });
    if (!p) return;
    p.nameKnown = true;
    J.town = { ped: p, lot: lot, front: front, c1: c1, smoke: smoke, alley: alley, face: Math.atan2(o.x, o.z), phase: "front", t: 8, photo: "" };
    holdAt(p, J.town.face);
    try { J.town.photo = CBZ.cityMugshot ? (CBZ.cityMugshot({ ped: p }) || "") : ""; } catch (e) { J.town.photo = ""; }
    J.rev++;
  }
  /* WHERE HE SMOKES. Not on the verge under the diner's side windows, where
     the cook at her range watched every strip through the glass. A man who
     wants a quiet cigarette goes where nobody can see him and the pavement is
     not right there: every place round the building (its sides and back, by
     the wall and a few paces out) and every alley within fifty metres is
     tried against THE PEOPLE WHO ARE THERE: everybody standing within reach
     of seeing him (the cook at her range, the waitress, the man at the bus
     stop) and every staff post of the places round it, a ray from each to a
     man's chest at the spot (a window lets it through, a wall does not);
     and the pavement within six metres of a carriageway is where people
     walk past. The quiet place nearest the door wins. Asked only with the
     player near enough for the street to be peopled (a far street has no
     one in it to ask about), never typed. */
  function buildingsNear(x, z, r) {
    const AR = A(); if (!AR) return [];
    const L = (AR.lots || []).concat(AR.shopLots || []), out = [], seen = new Set();
    for (let i = 0; i < L.length; i++) {
      const l = L[i], b = l && l.building;
      if (!b || b.park || !(b.w > 0) || !(b.d > 0) || l.demolished || seen.has(b)) continue;
      seen.add(b);
      const ox = isFinite(b.ox) ? b.ox : l.cx, oz = isFinite(b.oz) ? b.oz : l.cz;
      if (Math.abs(ox - x) > r + b.w / 2 || Math.abs(oz - z) > r + b.d / 2) continue;
      out.push({ x0: ox - b.w / 2, x1: ox + b.w / 2, z0: oz - b.d / 2, z1: oz + b.d / 2 });
    }
    return out;
  }
  function inBuilding(B, x, z, pad) { for (let i = 0; i < B.length; i++) { const b = B[i]; if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true; } return false; }
  // the eyes round a place: everybody who could witness (outfits.js's own
  // rule: alive, awake, drawn, not one of yours) and the posts staff stand at
  function watchersNear(x, z, r, skip) {
    const out = [];
    const add = function (a) {
      if (!a || !a.pos || a === skip || a.dead || a.isPlayer || (a.ko || 0) > 0 || a._parked) return;
      if (a.companion || a.recruited || a.controlled || (a.group && !a.group.visible)) return;
      if (Math.abs(a.pos.x - x) > r || Math.abs(a.pos.z - z) > r) return;
      out.push({ x: a.pos.x, y: (a.pos.y || 0) + 1.55, z: a.pos.z });
    };
    const P1 = CBZ.cityPeds || [], P2 = CBZ.cityCops || [];
    for (let i = 0; i < P1.length; i++) add(P1[i]);
    for (let i = 0; i < P2.length; i++) add(P2[i]);
    let SP = null; try { SP = CBZ.cityStaffPosts ? CBZ.cityStaffPosts() : null; } catch (e) { SP = null; }
    if (SP) for (let i = 0; i < SP.length; i++) { const q = SP[i]; if (q && Math.abs(q.x - x) < r && Math.abs(q.z - z) < r) out.push({ x: q.x, y: floorY(q.x, q.z) + 1.55, z: q.z }); }
    return out;
  }
  function seenBy(W, x, z, cap) {
    const y = floorY(x, z) + 1.0;
    let n = 0;
    for (let k = 0; k < W.length; k++) {
      const q = W[k];
      if (Math.abs(q.x - x) > 22 || Math.abs(q.z - z) > 22 || d2(q.x, q.z, x, z) > 22) continue;
      if (los(q.x, q.y, q.z, x, y, z) && ++n >= cap) return n;
    }
    return n;
  }
  function pickSmoke(J, T) {
    const lot = T.lot, b = lot.building;
    const cx = b.ox != null ? b.ox : lot.cx, cz = b.oz != null ? b.oz : lot.cz;
    const B = buildingsNear(cx, cz, 75);
    const W = watchersNear(cx, cz, 75, T.ped);
    const o = outward(lot);
    const C = [];
    const add = function (x, z, kind) {
      if (inBuilding(B, x, z, 0.6)) return;
      try { if (CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(x, z)) return; } catch (e) {}
      const RS = CBZ.roadSegmentAt;
      if (RS && RS(x, z, 1)) return;                                             // standing in the road
      // how near the pavement: on it, beside it, or off it where nobody walks
      const off = !RS ? 0 : RS(x, z, 6) ? 60 : RS(x, z, 10) ? 25 : RS(x, z, 14) ? 8 : 0;
      C.push({ x: x, z: z, kind: kind, cost: off + d2(x, z, T.front.x, T.front.z) / 5 });
    };
    // round the building: its sides and back, by the wall and a few paces out
    const hw = (b.w || 16) / 2, hd = (b.d || 16) / 2;
    const faces = [{ nx: 1, nz: 0, h: hw, s: hd }, { nx: -1, nz: 0, h: hw, s: hd }, { nx: 0, nz: 1, h: hd, s: hw }, { nx: 0, nz: -1, h: hd, s: hw }];
    for (let f = 0; f < faces.length; f++) {
      const F = faces[f];
      if (F.nx * o.x + F.nz * o.z > 0.7) continue;                               // not the street front
      for (let s = -F.s + 1.5; s <= F.s - 1.5; s += 3) for (const off of [1.5, 4.5]) add(cx + F.nx * (F.h + off) - F.nz * s, cz + F.nz * (F.h + off) + F.nx * s, "wall");
    }
    // and the quiet ground near it off the pavement: an alley (a walkable gap
    // between two buildings), a yard, the back of a car park
    for (let gx = -54; gx <= 54; gx += 3) for (let gz = -54; gz <= 54; gz += 3) {
      const x = cx + gx, z = cz + gz;
      const a = CBZ.alleyGapAt ? CBZ.alleyGapAt(x, z) : null;
      if (a && a.inside) continue;
      if (a && a.w <= 9) { add(x, z, "alley"); continue; }
      if (CBZ.roadSegmentAt && !CBZ.roadSegmentAt(x, z, 10)) add(x, z, "yard");
    }
    C.sort(function (a, c) { return a.cost - c.cost; });
    let best = null, fall = null;
    for (let i = 0; i < C.length && i < 200; i++) {
      const c = C[i];
      const n = seenBy(W, c.x, c.z, fall ? fall.n : 99);
      if (n === 0) { best = c; break; }
      if (!fall || n < fall.n) { fall = c; fall.n = n; }
    }
    const pick = best || fall;
    T.picked = true;
    if (!pick) return;
    T.smoke = { x: pick.x, z: pick.z };
    T.quiet = !!best;
    T.where = pick.kind;
    // round the nearer front corner of the building, then to it
    const sx = -o.z, sz = o.x;
    const side = (pick.x - cx) * sx + (pick.z - cz) * sz >= 0 ? 1 : -1;
    const along = Math.abs(o.x) > 0.5;
    const ext = (along ? b.w : b.d) / 2, lat = (along ? b.d : b.w) / 2;
    T.c1 = { x: cx + o.x * (ext + 1.7) + sx * side * (lat + 1.7), z: cz + o.z * (ext + 1.7) + sz * side * (lat + 1.7) };
    // his back to the way he came: whoever follows him in comes up behind him
    T.smokeFace = Math.atan2(pick.x - T.c1.x, pick.z - T.c1.z);
    T.alley = true;
  }
  // he stands by the door, walks off to smoke where nobody is, comes back
  function tickTown(J, dt) {
    const T = J.town; if (!T) return;
    const p = T.ped;
    if (p.dead || (p.ko || 0) > 0) { if (p.dead && once(J, "marshDead", "Marsh is down. His fatigues are on him.")) J.rev++; return; }
    if (p.rage || p.state === "flee" && !T.walking) return;
    T.t -= dt;
    const at = function (pt, r) { return d2(p.pos.x, p.pos.z, pt.x, pt.z) < (r || 1.4); };
    if (T.phase === "front") {
      if (p.state !== "idle") holdAt(p, T.face);
      if (T.t <= 0) {
        if (!T.picked && distP(T.front.x, T.front.z) < 90) { try { pickSmoke(J, T); } catch (e) { T.picked = true; } }
        T.phase = "out1"; T.t = 30; T.walking = true; walkTo(p, T.c1.x, T.c1.z);
      }
    } else if (T.phase === "out1") {
      if (at(T.c1) || T.t <= 0) { T.phase = "out2"; T.t = 30; walkTo(p, T.smoke.x, T.smoke.z); }
      else go(p, T.c1.x, T.c1.z);
    } else if (T.phase === "out2") {
      if (at(T.smoke) || T.t <= 0) { T.phase = "smoke"; T.t = 34; holdAt(p, T.smokeFace != null ? T.smokeFace : T.face + Math.PI); }
      else go(p, T.smoke.x, T.smoke.z);
    } else if (T.phase === "smoke") {
      if (p.state !== "idle") holdAt(p, T.smokeFace != null ? T.smokeFace : T.face + Math.PI);
      if (T.t <= 0) { T.phase = "back1"; T.t = 30; walkTo(p, T.c1.x, T.c1.z); }
    } else if (T.phase === "back1") {
      if (at(T.c1) || T.t <= 0) { T.phase = "back2"; T.t = 30; walkTo(p, T.front.x, T.front.z); }
      else go(p, T.c1.x, T.c1.z);
    } else {
      if (at(T.front) || T.t <= 0) { T.phase = "front"; T.t = 42 + h01(J.t | 0, 7) * 20; T.walking = false; holdAt(p, T.face); }
      else go(p, T.front.x, T.front.z);
    }
    if (!J.S.known || !J.S.known.marshSeen) { if (seesPed(p)) once(J, "marshSeen", "Marsh. Fatigues, no weapon. He walks off " + (T.where === "alley" ? "into the alley" : T.where === "yard" ? "away from the street, round the back" : T.alley ? "round the side of the building" : "to the corner") + " to smoke" + (T.quiet ? ", where nobody can see him." : ".")); }
  }

  /* ================================================================
     THE BASE: what is read off the plan when it is first seen
     ================================================================ */
  function layout(B) {
    const hqP = planOf(B, "hq"), revP = planOf(B, "reviewing");
    const hq = B.hq, hw = (hqP ? hqP.w : 36) / 2, hd = (hqP ? hqP.d : 22) / 2;
    const sh = shellAt(hq.x, hq.z);
    // the door: the face the building's own record says, else the one toward the flag
    let dn = { x: 0, z: B.flag.z >= hq.z ? 1 : -1 }, dl = { x: 0, z: hd * dn.z };
    if (sh && sh.localDoor && isFinite(sh.localDoor.x)) { dl = { x: sh.localDoor.x, z: sh.localDoor.z }; dn = Math.abs(dl.z) >= Math.abs(dl.x) ? { x: 0, z: Math.sign(dl.z) || 1 } : { x: Math.sign(dl.x) || 1, z: 0 }; }
    const door = { x: hq.x + dl.x, z: hq.z + dl.z };
    const sx = -dn.z, sz = dn.x;                                        // along the front wall
    let leaf = null;
    if (sh && sh.doors) for (let i = 0; i < sh.doors.length; i++) { const dr = sh.doors[i]; if (dr && isFinite(dr.wx) && d2(dr.wx, dr.wz, door.x, door.z) < 2.5) leaf = dr; }
    const L = {
      hq: hq, hw: hw, hd: hd, dn: dn, door: door, leaf: leaf,
      doorOut: { x: door.x + dn.x * 2.4, z: door.z + dn.z * 2.4 },
      doorIn: { x: door.x - dn.x * 2.6, z: door.z - dn.z * 2.6 },
      desk: { x: door.x - dn.x * 6.5 + sx * 7, z: door.z - dn.z * 6.5 + sz * 7 },
      window: { x: door.x - dn.x * 1.5 + sx * 7, z: door.z - dn.z * 1.5 + sz * 7 },
      flag: { x: B.flag.x + dn.x * 3.6, z: B.flag.z + dn.z * 3.6 },
    };
    // the reviewing stand: he stands in front of it, facing the ranks
    const rev = revP ? bw(B, revP.x, revP.z) : { x: B.parade.x, z: B.parade.z + 30 };
    const toP = { x: B.parade.x - rev.x, z: B.parade.z - rev.z }, tm = Math.hypot(toP.x, toP.z) || 1;
    // (beside its end nearer the middle of the base, a pace forward of the
    // tiers: on the ranks' side of it he was hidden to his knees from half the base)
    const along = { x: -toP.z / tm, z: toP.x / tm };
    const sgn = (B.center.x - rev.x) * along.x + (B.center.z - rev.z) * along.z >= 0 ? 1 : -1;
    const half = (revP ? Math.max(revP.w, revP.d) : 16) / 2 + 3;
    L.stand = { x: rev.x + along.x * sgn * half + toP.x / tm * 2.4, z: rev.z + along.z * sgn * half + toP.z / tm * 2.4 };
    L.standFace = Math.atan2(toP.x, toP.z);
    // the front of the formation, from the men standing in it
    const men = soldiers().filter(function (q) { return q._drill && q._stationed; });
    if (men.length >= 4) {
      let cx = 0, cz = 0, fx = 0, fz = 0;
      men.forEach(function (q) { cx += q._stationed.x; cz += q._stationed.z; fx += Math.sin(q._stationed.yaw || 0); fz += Math.cos(q._stationed.yaw || 0); });
      cx /= men.length; cz /= men.length;
      const fm = Math.hypot(fx, fz) || 1; fx /= fm; fz /= fm;
      const rx = fz, rz = -fx;
      let fmax = -1e9, rmin = 1e9, rmax = -1e9;
      men.forEach(function (q) { const dx = q._stationed.x - cx, dz = q._stationed.z - cz; fmax = Math.max(fmax, dx * fx + dz * fz); rmin = Math.min(rmin, dx * rx + dz * rz); rmax = Math.max(rmax, dx * rx + dz * rz); });
      L.rankA = { x: cx + fx * (fmax + 2.8) + rx * (rmin - 1), z: cz + fz * (fmax + 2.8) + rz * (rmin - 1) };
      L.rankB = { x: cx + fx * (fmax + 2.8) + rx * (rmax + 1), z: cz + fz * (fmax + 2.8) + rz * (rmax + 1) };
    } else {
      L.rankA = { x: B.parade.x - 9, z: B.parade.z + 9 }; L.rankB = { x: B.parade.x + 9, z: B.parade.z + 9 };
    }
    // the car: beside headquarters, and the two ways it drives (plan roads)
    const R = (B.plan && B.plan.roads) || {};
    const mid = function (r, k) { return r ? (r[k + "0"] + r[k + "1"]) / 2 : 0; };
    const gate = (B.plan.gates || []).filter(function (q) { return q.side === "east"; })[0] || { x: B.gate.x - B.center.x, z: B.gate.z - B.center.z };
    const hx = hq.x - B.center.x, hz = hq.z - B.center.z;                // hq, plan-local
    const xe = hx + hw + 12, zc = mid(R.cross, "z"), xw = mid(R.west, "x"), zm = mid(R.main, "z"), z0 = hz + 4, gx = gate.x - 34;
    const pts = function (arr) { return arr.map(function (q) { return bw(B, q[0], q[1]); }); };
    // THE SHORT WAY TO THE GATE: east down the car park's aisle, across the
    // motor pool's back lane behind the truck row, down its far side and onto
    // the gate road at the plaza. It used to go by the plan's roads only, and
    // the only road from headquarters to the gate road is the WEST road: the
    // car drove 120 m away from the gate first and 500 m round to it.
    const pv = function (id) { const Lp = (B.plan && B.plan.pave) || []; for (let i = 0; i < Lp.length; i++) if (Lp[i].id === id) return Lp[i]; return null; };
    const lot = pv("parking"), mp = pv("motor-pool");
    if (R.main && lot && mp) {
      const zl = (lot.z0 + lot.z1) / 2, za = mp.z0 + 6, xs = mp.x1 - 12;
      L.carHome = bw(B, xe, z0);
      L.carOut = pts([[xe, z0], [lot.x0 - 2, zl], [lot.x1 + 2, zl], [mp.x0 + 2, za], [xs - 6, za], [xs, zm - 14], [gx, zm + 3.5]]);
      L.carBack = pts([[gx, zm + 3.5], [gx + 17, zm + 3.5], [gx + 23, zm], [gx + 17, zm - 3.5], [xs, zm - 14], [xs - 6, za], [mp.x0 + 2, za], [lot.x1 + 2, zl], [lot.x0 - 2, zl], [xe, z0]]);
      L.carAtGate = bw(B, gx, zm + 3.5);
      L.inspect = bw(B, gx + 6, zm - 9);
    } else if (R.cross && R.west && R.main) {
      L.carHome = bw(B, xe, z0);
      L.carOut = pts([[xe, z0], [xe - 4, z0 + 9], [xe - 9, z0], [xe - 9, zc - 3], [xw - 3, zc - 3], [xw - 3, zm + 3.5], [gx, zm + 3.5]]);
      L.carBack = pts([[gx, zm + 3.5], [gx + 17, zm + 3.5], [gx + 23, zm], [gx + 17, zm - 3.5], [xw + 3, zm - 3.5], [xw + 3, zc + 3], [xe, zc + 3], [xe, z0]]);
      L.carAtGate = bw(B, gx, zm + 3.5);
      L.inspect = bw(B, gx + 6, zm - 9);
    }
    return L;
  }

  // WHICH ROOF. Every roofed shell on the plan except headquarters is tried:
  // real lines of fire from its edge to the places he stands, the one that
  // sees the most of them (nearest wins a tie) gets the ladder, on the wall
  // facing away from them.
  function pickRoof(B, L) {
    const spots = [["the reviewing stand", L.stand], ["the front rank", { x: (L.rankA.x + L.rankB.x) / 2, z: (L.rankA.z + L.rankB.z) / 2 }], ["the flag", L.flag], ["the headquarters door", L.doorOut]];
    if (L.inspect) spots.push(["the guardhouse", L.inspect]);
    let best = null;
    const list = (B.plan && B.plan.build) || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id === "hq" || (b.kind !== "building" && b.kind !== "guardhouse")) continue;
      const c = bw(B, b.x, b.z), sh = shellAt(c.x, c.z);
      if (!sh || !sh.roofSlab || !(sh.h > 2)) continue;
      const top = floorY(c.x, c.z) + sh.h;
      const lines = [];
      let near = 1e9;
      for (let k = 0; k < spots.length; k++) {
        const t = spots[k][1];
        const ex = c.x + clamp(t.x - c.x, -sh.w / 2 + 0.9, sh.w / 2 - 0.9), ez = c.z + clamp(t.z - c.z, -sh.d / 2 + 0.9, sh.d / 2 - 0.9);
        const d = d2(ex, ez, t.x, t.z);
        if (d < 40 || d > 260) continue;
        if (!los(ex, top + 1.55, ez, t.x, floorY(t.x, t.z) + 1.5, t.z)) continue;
        lines.push({ what: spots[k][0], d: Math.round(d) });
        if (k < 2) near = Math.min(near, d);
      }
      if (!lines.length || near > 1e8) continue;
      const score = lines.length * 1000 - near;
      if (!best || score > best.score) best = { score: score, b: b, c: c, sh: sh, top: top, lines: lines, name: b.name || b.id };
    }
    if (!best) return null;
    // the blind wall: the face whose normal points most away from where he stands
    const t = L.stand, c = best.c, sh = best.sh;
    const tx = t.x - c.x, tz = t.z - c.z, tm = Math.hypot(tx, tz) || 1;
    const faces = [{ nx: 1, nz: 0, half: sh.w / 2 }, { nx: -1, nz: 0, half: sh.w / 2 }, { nx: 0, nz: 1, half: sh.d / 2 }, { nx: 0, nz: -1, half: sh.d / 2 }];
    faces.sort(function (a, b) { return (a.nx * tx + a.nz * tz) - (b.nx * tx + b.nz * tz); });
    const dl = sh.localDoor || null;
    let f = faces[0];
    // not across its own doorway
    if (dl && Math.abs(dl.x - f.nx * f.half) < 1 && Math.abs(dl.z - f.nz * f.half) < 1) f = faces[1];
    const off = (f.nx ? sh.d : sh.w) * 0.28;                              // off the wall's centre, clear of a centred door
    best.foot = { x: c.x + f.nx * (f.half + 0.14) + (f.nx ? 0 : off), z: c.z + f.nz * (f.half + 0.14) + (f.nz ? 0 : off), nx: f.nx, nz: f.nz };
    best.land = { x: best.foot.x - f.nx * 1.3, z: best.foot.z - f.nz * 1.3 };
    best.side = f.nx > 0 ? "east" : f.nx < 0 ? "west" : f.nz > 0 ? "south" : "north";
    return best;
  }
  const ROOF_NAMES = { firestation: "the fire station", airops: "the air operations block", guardhouse: "the guardhouse", barracks0: "the first barracks block", barracks1: "the second barracks block", barracks2: "the third barracks block", barracks3: "the fourth barracks block" };
  function roofName(R) { return R ? (ROOF_NAMES[R.b.id] || "the low building") : "a roof"; }
  function buildLadder(J) {
    const R = J.roof, AR = A();
    if (!R || !AR || !AR.root || !CBZ.ladderKit || !CBZ.ladderKit.build) return;
    try { if (CBZ.climb && CBZ.climb.removeTag) CBZ.climb.removeTag(TAG); } catch (e) {}
    const y0 = floorY(R.foot.x + R.foot.nx * 0.8, R.foot.z + R.foot.nz * 0.8);
    try {
      J.ladder = CBZ.ladderKit.build(AR.root, {
        x: R.foot.x, z: R.foot.z, nx: R.foot.nx, nz: R.foot.nz, y0: y0, y1: R.top, standoff: 0.14,
        top: { x: R.land.x, z: R.land.z }, name: "roof ladder", tag: TAG, mode: "city",
      });
    } catch (e) { J.ladder = null; }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
  }
  function dropLadder(J) {
    try { if (CBZ.climb && CBZ.climb.removeTag) CBZ.climb.removeTag(TAG); } catch (e) {}
    const m = J.ladder && J.ladder.mesh;
    if (m) { if (m.parent) m.parent.remove(m); if (m.geometry && m.geometry.dispose) m.geometry.dispose(); }
    J.ladder = null;
  }

  /* ================================================================
     STAGING THE BASE (when the player is near enough for it to exist)
     ================================================================ */
  function staffCar(x, z, h) {
    let c = null;
    if (CBZ.cityAddParkedCar) { try { c = CBZ.cityAddParkedCar(x, z, h, { modelName: "Bison Frontier", color: 0x2e3524, force: true }); } catch (e) { c = null; } }
    if (!c) return null;
    if (CBZ.carOccupancyClear) { try { CBZ.carOccupancyClear(c); } catch (e) {} }
    c.ai = false; c.v = 0; c.vx = 0; c.vz = 0; c.baseV = 0; c.road = null; c.parked = true; c.stolen = false;
    c._persist = true; c._hmGeneral = true; c.name = "Staff Car";
    return c;
  }
  function kit() { return CBZ.motorcade && CBZ.motorcade.kit ? CBZ.motorcade.kit : null; }
  function mcMath() { return CBZ.motorcade && CBZ.motorcade._math ? CBZ.motorcade._math : null; }
  // THE POST ON THE ROAD IN: 40 m along whichever route of the world plan
  // (CBZ.worldPlan.routes) starts at the gate apron, a man on each verge,
  // facing the way a stranger comes. Failing that, 100 m along the road graph
  // from the gate toward town (the lane, so one verge). Never typed.
  function roadPost(B) {
    const G = B.gate, WP = CBZ.worldPlan, R = WP && WP.routes;
    const HALF = { road: 5.5, highway: 9, freeway: 13 };
    if (R && R.length) {
      let best = null, bd = 160;
      for (let i = 0; i < R.length; i++) {
        const pts = R[i].pts; if (!pts || pts.length < 2) continue;
        for (let e = 0; e < 2; e++) {
          const p0 = e ? pts[pts.length - 1] : pts[0], p1 = e ? pts[pts.length - 2] : pts[1];
          const d = d2(p0[0], p0[1], G.x, G.z);
          if (d < bd) { bd = d; best = { p0: p0, p1: p1, half: HALF[R[i].kind] || 5.5, name: R[i].name || "" }; }
        }
      }
      if (best) {
        const dx = best.p1[0] - best.p0[0], dz = best.p1[1] - best.p0[1], m = Math.hypot(dx, dz);
        if (m > 50) return { x: best.p0[0] + dx / m * 40, z: best.p0[1] + dz / m * 40, dx: dx / m, dz: dz / m, side: best.half + 2.4, name: best.name };
      }
    }
    const K = kit(), rm = CBZ.hmRoom && CBZ.hmRoom.ensure ? CBZ.hmRoom.ensure() : null;
    if (!K || !rm || !rm.center) return null;
    let pts = null;
    try { const r = K.roadRoute({ x: G.x, z: G.z }, { x: rm.center.x, z: rm.center.z }); pts = r && r.pts; } catch (e) { pts = null; }
    if (!pts || pts.length < 3) return null;
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = d2(a.x, a.z, b.x, b.z);
      if (L > 0.01 && s + L >= 100) { const t = (100 - s) / L; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L, side: 3.6 }; }
      s += L;
    }
    return null;
  }
  // the man on the fence: outside the face the gate is in, from 40 m off the
  // gate to 22 m short of the corner on the longer side
  function fenceWalk(B) {
    const G = B.gate;
    const F = [{ nx: 1, nz: 0, d: Math.abs(G.x - B.maxX) }, { nx: -1, nz: 0, d: Math.abs(G.x - B.minX) }, { nx: 0, nz: 1, d: Math.abs(G.z - B.maxZ) }, { nx: 0, nz: -1, d: Math.abs(G.z - B.minZ) }];
    F.sort(function (a, b) { return a.d - b.d; });
    const f = F[0];
    if (f.nx) {
      const x = f.nx > 0 ? B.maxX + 4.5 : B.minX - 4.5, dir = (G.z - B.minZ) > (B.maxZ - G.z) ? -1 : 1;
      return { a: { x: x, z: G.z + dir * 40 }, b: { x: x, z: dir < 0 ? B.minZ + 22 : B.maxZ - 22 } };
    }
    const z = f.nz > 0 ? B.maxZ + 4.5 : B.minZ - 4.5, dir = (G.x - B.minX) > (B.maxX - G.x) ? -1 : 1;
    return { a: { x: G.x + dir * 40, z: z }, b: { x: dir < 0 ? B.minX + 22 : B.maxX - 22, z: z } };
  }
  function stageBase(J, B) {
    J.baseUp = true;
    const L = (J.L = layout(B));
    J.roof = pickRoof(B, L);
    buildLadder(J);
    // only one general on this base
    soldiers().forEach(function (q) { if (q.milRank === "general" && !q._hmGeneral) q.milRank = "private"; });
    const gen = soldier(NAME, L.desk.x, L.desk.z, { rank: "general", unit: "headquarters", weapon: "Pistol", hp: 120, aggr: 0.3,
      rec: fatigues({ kit: null, hat: "beret", capColor: 0x7a1a1c, name: "Service Fatigues" }) });
    if (!gen) { J.why = "no body for the general"; return; }
    gen.nameKnown = true; gen._hitMark = true; gen._hmStaff = true;
    gen._lodOk = false;                                       // (the man himself is drawn at any range: one rig)
    J.mark = gen;
    const aide = soldier("Captain Ilya Brandt", L.doorIn.x + 1.4, L.doorIn.z, { rank: "captain", unit: "headquarters", weapon: "Pistol", hp: 120, rec: fatigues({ kit: null, name: "Service Fatigues" }) });
    const sgt = soldier("Sergeant Noll", L.doorIn.x - 1.4, L.doorIn.z, { rank: "sergeant", unit: "headquarters", weapon: "AK-47", hp: 170, aggr: 0.9 });
    J.staff = [aide, sgt].filter(Boolean);
    J.staff.forEach(function (q) { q._hmStaff = true; });
    if (L.carHome) {
      const c = staffCar(L.carHome.x, L.carHome.z, 0);
      if (c) {
        const drv = soldier("Corporal Hask", L.carHome.x + 2.2, L.carHome.z, { rank: "corporal", unit: "headquarters", weapon: "Pistol" });
        const K = kit();
        if (drv) { drv._hmStaff = true; if (!(K && K.seatIn(drv, c, "driver"))) { holdAt(drv, 0); } }
        J.car = { car: c, driver: drv, P: null, s: 0, v: 0, at: "home" };
        if (K) K.poseCar(c, { x: L.carHome.x, z: L.carHome.z, h: 0 }, 0);
      }
    }
    // outside the wire: a two-man post on the road in, one man walking the fence
    J.out = [];
    const post = roadPost(B);
    J.roadName = post && post.name ? post.name : "";
    if (post) {
      const face = Math.atan2(post.dx, post.dz), sx = -post.dz, sz = post.dx;
      [[-1, "Corporal Vance Teller", "corporal"], [1, "Private Ode Ramic", "private"]].forEach(function (r) {
        const x = post.x + sx * r[0] * post.side, z = post.z + sz * r[0] * post.side;
        const q = soldier(r[1], x, z, { rank: r[2], unit: "the gate guard", face: face });
        if (q) { q._hmPost = { x: x, z: z, face: face }; holdAt(q, face); J.out.push(q); }
      });
    }
    const fence = fenceWalk(B);
    const w = fence ? soldier("Private Sol Arnett", fence.a.x, fence.a.z, { rank: "private", unit: "A Company" }) : null;
    // (lent to the base's own doubt: he may stop and walk over, city/basewatch.js)
    if (w) { w._hmWalk = { a: fence.a, b: fence.b, to: "b", t: 0 }; w._bwFree = true; J.out.push(w); J.wire = w; }
    if (CBZ.cityBaseLens) CBZ.cityBaseLens(J.lens);
    G_reset(J);
    try { J.photo = CBZ.cityMugshot ? (CBZ.cityMugshot({ ped: gen }) || "") : ""; } catch (e) { J.photo = ""; }
    once(J, "base", "The base. " + (J.roof ? ("A ladder on the " + J.roof.side + " wall of " + roofName(J.roof) + ".") : "No roof with a line that I can see."));
    J.rev++;
  }
  function unstageBase(J, hard) {
    if (!J.baseUp) return;
    J.baseUp = false;
    const K = kit();
    const men = (J.staff || []).concat(J.out || []);
    if (J.car && J.car.driver) men.push(J.car.driver);
    if (J.mark && !J.mark.dead) men.push(J.mark);
    if (!J.dead) J.mark = null;                                // (the pipe must not read a removed man as "swept away")
    for (let i = 0; i < men.length; i++) {
      const q = men[i]; if (!q) continue;
      if (q.inCar && K) { try { K.unseat(q, q.pos.x, q.pos.z); } catch (e) {} }
      dismiss(q, hard);
    }
    if (J.car && J.car.car && !J.car.car.player) { try { if (K) K.removeCar(J.car.car); else if (CBZ.cityScrapCar) CBZ.cityScrapCar(J.car.car); } catch (e) {} }
    J.car = null; J.staff = []; J.out = []; J.wire = null;
    if (CBZ.cityBaseLens) CBZ.cityBaseLens(J.lens, true);
    dropLadder(J);
    liftLock(J);
    // men this file borrowed go back to their own day
    soldiers().forEach(function (q) { relax(q); });
  }

  /* ================================================================
     HIS DAY (the city clock)
     ================================================================ */
  const SCHED = [{ h: 6.5, leg: "parade" }, { h: 10, leg: "gate" }, { h: 13, leg: "parade" }, { h: 16, leg: "gate" }, { h: 17.5, leg: "retreat" }];
  function slotNow() {
    const h = hour();
    let cur = -1;
    for (let i = 0; i < SCHED.length; i++) if (h >= SCHED[i].h && h < SCHED[i].h + 1.4) cur = i;
    return cur;
  }
  function G_reset(J) { J.G = { leg: "office", steps: null, i: 0, t: 0, slot: -2, win: 20 + Math.random() * 20, stuck: 0, lastD: 1e9, seated: false }; }
  function script(J, leg) {
    const L = J.L, S = [];
    const W = function (pt, run) { S.push({ walk: pt, run: !!run }); };
    if (leg === "parade") {
      W(L.doorIn); W(L.doorOut); W(L.rankA); W(L.rankB);
      W(L.stand); S.push({ hold: 46, face: L.standFace, salute: true, id: "stand" });
      W(L.doorOut); W(L.doorIn); W(L.desk);
    } else if (leg === "retreat") {
      W(L.doorIn); W(L.doorOut); W(L.flag);
      S.push({ hold: 58, faceAt: J.B.flag, salute: true, id: "flag" });
      W(L.doorOut); W(L.doorIn); W(L.desk);
    } else if (leg === "gate" && J.car && J.car.car && L.carOut) {
      W(L.doorIn); W(L.doorOut); S.push({ board: true });
      S.push({ drive: "out" }); S.push({ alight: L.carAtGate });
      W(L.inspect); S.push({ hold: 50, faceAt: J.B.gate, id: "gate" });
      S.push({ board: true }); S.push({ drive: "back" }); S.push({ alight: L.carHome });
      W(L.doorOut); W(L.doorIn); W(L.desk);
    } else if (leg === "bolt") {
      // in from wherever he is in the open; already indoors, to the desk away from the window
      const p = J.mark, inside = p && Math.abs(p.pos.x - L.hq.x) < L.hw - 0.5 && Math.abs(p.pos.z - L.hq.z) < L.hd - 0.5;
      if (!inside) { S.push({ walk: L.doorOut, run: true }); S.push({ walk: L.doorIn, run: true }); }
      S.push({ walk: L.desk, run: true });
    }
    return S;
  }
  function startLeg(J, leg) {
    const G = J.G;
    G.leg = leg; G.steps = script(J, leg); G.i = 0; G.t = 0; G.stuck = 0; G.lastD = 1e9; G.entered = false;
    G.legAt = (CBZ.dayCount ? CBZ.dayCount() : 0) * 24 + hour();
    if (!G.steps.length) { G.leg = "office"; G.steps = null; }
  }
  function carSide(c, right) { const h = c.heading || 0; return { x: c.pos.x - Math.cos(h) * right, z: c.pos.z + Math.sin(h) * right }; }
  function tickGeneral(J, dt) {
    const p = J.mark, G = J.G, L = J.L;
    if (!p || p.dead || !G) return;
    if ((p.ko || 0) > 0) return;
    // somebody is shooting: he goes to ground in headquarters and stays there
    // (once per alarm: the desk is where he stays)
    if (J.lock && !J.lock.bolted && !G.seated) { J.lock.bolted = true; startLeg(J, "bolt"); J.S.holdUntil = (CBZ.dayCount ? CBZ.dayCount() : 0) * 24 + hour() + 3; }
    const nowH = (CBZ.dayCount ? CBZ.dayCount() : 0) * 24 + hour();
    if (G.leg === "office") {
      const sl = slotNow();
      if (sl !== G.slot && !J.lock && !(J.S.holdUntil > nowH)) {
        G.slot = sl;
        if (sl >= 0) { startLeg(J, SCHED[sl].leg); return; }
      }
      // at his desk; on the telephone at the window for a spell
      G.win -= dt;
      const tgt = G.atWin ? L.window : L.desk;
      const d = d2(p.pos.x, p.pos.z, tgt.x, tgt.z);
      if (d > 1.3) go(p, tgt.x, tgt.z);
      else if (p.state !== "idle") holdAt(p, Math.atan2(L.dn.x, L.dn.z));
      if (G.win <= 0) { G.atWin = !G.atWin; G.win = G.atWin ? 24 + Math.random() * 10 : 55 + Math.random() * 45; }
      return;
    }
    const st = G.steps[G.i];
    if (!st) { G.leg = "office"; G.steps = null; G.atWin = false; G.win = 40; return; }
    // a leg the clock has left behind (he slept through it: the bed skips
    // hours) is over: back at his desk and the car at home, done only where
    // nobody is looking, never mid-drive
    if (G.leg !== "bolt" && !G.seated && nowH - (G.legAt || nowH) > 2.5 && !seesPed(p) && distP(p.pos.x, p.pos.z) > 60) { toDesk(J); return; }
    G.t += dt;
    // his own front door: buildings.js only swings a door within 40 m of the
    // player, so a man leaving a building nobody is standing at opens it himself
    if (L.leaf && !L.leaf.demolished && d2(p.pos.x, p.pos.z, L.door.x, L.door.z) < 9) { L.leaf.open = true; L.leaf.hold = Math.max(L.leaf.hold || 0, 1.4); }
    if (st.walk) {
      const d = d2(p.pos.x, p.pos.z, st.walk.x, st.walk.z);
      if (d < 1.4) { G.i++; G.t = 0; G.stuck = 0; G.lastD = 1e9; G.entered = false; return; }
      G.entered = true; go(p, st.walk.x, st.walk.z, st.run);
      G.stuck += dt;
      if (G.lastD - d > 0.8) { G.lastD = d; G.stuck = 0; }
      if (G.stuck > 9) {                                        // a man stuck on a door frame is moved only while nobody watches
        G.stuck = 0; G.lastD = 1e9;
        if (!seesPed(p) && distP(p.pos.x, p.pos.z) > 45) { place(p, st.walk.x, st.walk.z); G.i++; G.t = 0; G.entered = false; }
      }
      return;
    }
    if (st.hold) {
      if (!G.entered) {
        G.entered = true;
        holdAt(p, st.face != null ? st.face : null);
        if (st.faceAt) faceTo(p, st.faceAt.x, st.faceAt.z);
        G.holdId = st.id || null;
      }
      if (p.state !== "idle") holdAt(p, null);
      G.salute = !!st.salute;
      if (G.t >= st.hold) { G.i++; G.t = 0; G.entered = false; G.holdId = null; G.salute = false; }
      return;
    }
    const C = J.car, K = kit();
    if (st.board) {
      if (!C || !C.car || C.car.dead || !K) { G.i += 2; G.t = 0; G.entered = false; return; }     // no car: he walks nowhere, the leg is cut short
      const side = carSide(C.car, -2.1);
      const d = d2(p.pos.x, p.pos.z, side.x, side.z);
      if (d > 1.5 && G.t < 40) { go(p, side.x, side.z); return; }
      if (K.seatIn(p, C.car, "rearR")) { G.seated = true; const s = sergeant(J); if (s && !s.inCar && d2(s.pos.x, s.pos.z, C.car.pos.x, C.car.pos.z) < 12) K.seatIn(s, C.car, "shotgun"); }
      G.i++; G.t = 0; G.entered = false;
      return;
    }
    if (st.drive) {
      if (!C || !G.seated) { G.i++; G.t = 0; return; }
      if (!G.entered) {
        G.entered = true;
        const M = mcMath(), pts = st.drive === "out" ? L.carOut : L.carBack;
        C.P = M ? M.makePath(pts, pts.map(function (q, i) { return i === 0 || i === pts.length - 1 ? 0 : 5.5; }), null) : null;
        C.s = 0; C.v = 0; C.at = "road";
      }
      if (!C.P || C.s >= C.P.len - 0.4) { C.v = 0; C.at = st.drive === "out" ? "gate" : "home"; G.i++; G.t = 0; G.entered = false; }
      return;
    }
    if (st.alight) {
      if (G.seated && K && C) {
        const side = carSide(C.car, -1.6);
        try { K.unseat(p, side.x, side.z); } catch (e) {}
        const s = sergeant(J);
        if (s && s.inCar) { const s2 = carSide(C.car, 1.6); try { K.unseat(s, s2.x, s2.z); } catch (e) {} s.controlled = true; }
        p.controlled = true;
        G.seated = false;
      }
      G.i++; G.t = 0; G.entered = false;
    }
  }
  function sergeant(J) { const q = J.staff && J.staff[1]; return q && !q.dead ? q : null; }
  function toDesk(J) {
    const G = J.G, L = J.L, p = J.mark, K = kit(), C = J.car;
    place(p, L.desk.x, L.desk.z); holdAt(p, Math.atan2(L.dn.x, L.dn.z));
    (J.staff || []).forEach(function (q, i) { if (q && !q.dead && !q.inCar && !seesPed(q)) place(q, L.doorIn.x + (i ? -1.4 : 1.4), L.doorIn.z); });
    if (C && C.car && !C.car.dead && !C.car.player && K && L.carHome) { K.poseCar(C.car, { x: L.carHome.x, z: L.carHome.z, h: 0 }, 0); C.P = null; C.v = 0; C.at = "home"; }
    G.leg = "office"; G.steps = null; G.atWin = false; G.win = 40; G.slot = -2; G.holdId = null; G.salute = false;
  }
  const PS = { posture: "normal", threat: null, hostile: false, at: { x: 0, z: 0 }, reason: null };
  function frame(J, dt) {
    if (!J.baseUp) return;
    // the staff car on its rails
    const C = J.car, K = kit(), M = mcMath();
    if (C && C.car && !C.car.dead && C.P && C.at === "road" && K && M && !C.car.player) {
      const left = C.P.len - C.s;
      const vt = Math.min(12.5, M.capAt(C.P, C.s, false), Math.sqrt(2 * 2.6 * Math.max(0, left)));
      C.v += clamp(vt - C.v, -5 * dt, 2.2 * dt);
      C.s = Math.min(C.P.len, C.s + Math.max(0, C.v) * dt);
      K.poseCar(C.car, M.pathAt(C.P, C.s), C.v);
    }
    // the two who walk with him, on the detail brain (city/brain_protection.js)
    const p = J.mark;
    // (the salute: the right arm up and across, the hand at the brim of the beret)
    if (p && !p.dead && J.G && J.G.salute && p.char && p.char.parts && p.char.parts.ra) { p.char.parts.ra.rotation.x = -2.55; p.char.parts.ra.rotation.z = 0.9; }
    if (p && !p.dead && !p.inCar && CBZ.protection && CBZ.protection.guardRing) {
      const ring = (J.staff || []).filter(function (q) { return q && !q.dead && !q.inCar && !q.rage; });
      if (ring.length) {
        const pl = P();
        PS.posture = J.lock ? "evac" : "normal";
        PS.hostile = !!(J.lock && J.blown); PS.threat = PS.hostile ? PA() : null; PS.reason = J.lock ? "gunfire" : null;
        if (pl && pl.pos) { PS.at.x = pl.pos.x; PS.at.z = pl.pos.z; }
        try { CBZ.protection.guardRing(p, dt, PS, ring); } catch (e) {}
      }
    }
  }

  /* ================================================================
     OUTSIDE THE WIRE: the post on the road in, the man on the fence
     ================================================================ */
  function tickOut(J, dt) {
    const pl = P(); if (!pl || !pl.pos) return;
    const tr = inUniform();
    for (let i = 0; i < J.out.length; i++) {
      const q = J.out[i];
      if (!q || q.dead || (q.ko || 0) > 0 || q.rage) continue;
      if (q._bwAct) continue;                                  // the base's doubt has him (city/basewatch.js)
      const W = q._hmWalk;
      if (W) {
        const t = W[W.to], d = d2(q.pos.x, q.pos.z, t.x, t.z);
        W.t -= dt;
        if (d < 1.6) { if (W.t <= 0 && !W.wait) { W.wait = true; W.t = 9 + Math.random() * 8; holdAt(q, null); } if (W.wait && W.t <= 0) { W.wait = false; W.to = W.to === "a" ? "b" : "a"; } }
        else go(q, t.x, t.z);
        continue;
      }
      const post = q._hmPost; if (!post) continue;
      const dp = d2(q.pos.x, q.pos.z, post.x, post.z);
      const d = d2(q.pos.x, q.pos.z, pl.pos.x, pl.pos.z);
      if (dp > 1.6) { go(q, post.x, post.z); continue; }
      if (q.state !== "idle") holdAt(q, post.face);
      // a stranger on foot on the road to the base is told to turn round
      if (!tr && !pl.driving && d < 36 && los(q.pos.x, q.pos.y + 1.6, q.pos.z, pl.pos.x, pl.pos.y + 1.2, pl.pos.z)) {
        faceTo(q, pl.pos.x, pl.pos.z);
        q._hmWarn = (q._hmWarn || 0) + dt;
        // (one of them does the talking)
        const all = function (v) { J.out.forEach(function (o) { if (o._hmPost) o._hmSaid = v; }); };
        if (!q._hmSaid) { all(1); bark(q, "This road is closed. Turn around.", 2.8); once(J, "post", "Two men on a post on the road in. They stop anybody on foot."); }
        else if (q._hmSaid === 1 && d < 16 && q._hmWarn > 4) { all(2); bark(q, "I said turn around. Guardhouse, one on foot at the road post.", 3.2); }
        if (CBZ.cityHasGun && CBZ.cityHasGun() && d < 26) { bark(q, "Gun!", 1.4); J.out.forEach(hostile); }
      } else if (d > 44) { q._hmSaid = 0; q._hmWarn = 0; }
    }
  }

  function gateMen() { return soldiers().filter(function (q) { return q._post && q._post.tag && String(q._post.tag).indexOf("gate") >= 0 && !q.dead; }); }

  /* ================================================================
     WHO ACCEPTS HIM is the base's question (city/basewatch.js: the gate,
     the challenge, every soldier's own doubt, the radio call). This file
     only lends it what the job knows, and listens for the answer.
     ================================================================ */
  function relax(q) {
    if (!q) return;
    if (q._hmCtl && !q._hmGeneral) { q.controlled = false; q._navOk = false; if (!q.dead && !q.rage) { q.state = "idle"; q.pause = 0.6; q.path = null; } }
    q._hmCtl = false;
  }
  function onRoof(J, x, y, z) { const R = J.roof; return !!(R && d2(x, z, R.c.x, R.c.z) < Math.max(R.sh.w, R.sh.d) / 2 + 1 && y > R.top - 0.6); }
  // THE LENS (CBZ.cityBaseLens): the dead man's own company knew his face; a
  // private has no business round headquarters; nobody has business up the
  // ladder or on a roof. The general does not look at privates.
  function lens(J, q, c) {
    if (!J.baseUp || !J.L) return 1;
    if (q === J.mark) return 0;
    const w = c.worn; if (!w || w._claimOrg !== "army") return 1;
    let mul = 1, line = null, blown = null;
    const sur = w._hmOwner ? String(w._hmOwner).split(" ").slice(-1)[0] : "";
    if (w._hmUnit && c.d < 8 && unitOf(q) === w._hmUnit) {
      mul *= 7;
      if (sur) { line = sur + "? That's not... hey. You."; blown = "That's " + sur + "'s name tape. That is not " + sur + "!"; }
    }
    if (rankN(w._hmRank) < 2 && d2(c.x, c.z, J.L.hq.x, J.L.hq.z) < Math.max(J.L.hw, J.L.hd) + 26) mul *= rankN(q.milRank) >= 2 ? 4 : 2.2;
    if (c.climbing || c.y - floorY(c.x, c.z) > 2.2 || onRoof(J, c.x, c.y, c.z)) { mul *= 5; if (!line) line = "You. What are you doing up there?"; }
    return line || blown ? { mul: mul, line: line, blown: blown } : mul;
  }
  // the answer changed under him: the cover is gone, and the base locks down on him
  function watchCover(J) {
    if (!uniform()) { J.inU = false; return; }
    if (inUniform()) {
      if (!J.inU) J.inU = true;
      const pl = P();
      if (J.baseUp && pl && pl.pos && J.B && inRect(J.B, pl.pos.x, pl.pos.z, -8)) once(J, "through", "Through the gate. He looked at the fatigues and not at me.");
      return;
    }
    if (!J.inU || J.blown) return;
    J.inU = false; J.blown = true;
    note(J, "They know. The fatigues are finished.");
    const pl = P();
    if (J.baseUp) lockdown(J, pl && pl.pos ? { x: pl.pos.x, z: pl.pos.z } : null, "intruder", true);
  }
  // "that one, there": the base's ladder jumps to hostile on him
  function blow(J, q, line) {
    if (CBZ.cityBaseBlow) { try { CBZ.cityBaseBlow(q || null, line || "He's not one of ours!", 4); } catch (e) {} }
    else if (CBZ.cityDisguiseBlow) { try { CBZ.cityDisguiseBlow(q || null, line || "He's not one of ours!"); } catch (e) {} }
    watchCover(J);
  }
  function stampUniform(J) {
    const w = uniform(); if (!w || w._hmRank) return;
    const pl = P(); if (!pl || !pl.pos) return;
    let best = null, bd = 9;
    const L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (!b || !b.dead || !b._clothesTaken || !(b.milRank || b.organization === "military")) continue;
      const d = d2(b.pos.x, b.pos.z, pl.pos.x, pl.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    w._hmRank = best ? (best.milRank || "private") : "private";
    w._hmUnit = best ? unitOf(best) : "";
    w._hmOwner = best && best.name ? best.name : "";
    J.blown = false;                                          // a fresh uniform, a fresh face
    const sur = w._hmOwner ? String(w._hmOwner).split(" ").slice(-1)[0] : "a dead man";
    note(J, "In " + sur + "'s fatigues. " + (w._hmUnit ? (w._hmUnit.charAt(0).toUpperCase() + w._hmUnit.slice(1)) + " knows his face." : ""));
    if (rankN(w._hmRank) < 2) note(J, "A " + w._hmRank + ". Keep away from headquarters.");
    J.rev++;
  }
  // a body where a soldier can see it
  function tickBodies(J) {
    if (!J.bodies.length || J.lock) return;
    const L = soldiers();
    for (let k = 0; k < J.bodies.length; k++) {
      const b = J.bodies[k];
      if (b.found || !b.ped || !b.ped.pos) continue;
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        if (!q || q.dead || q.inCar || (q.ko || 0) > 0) continue;
        const d = d2(q.pos.x, q.pos.z, b.ped.pos.x, b.ped.pos.z);
        if (d > 20 || !los(q.pos.x, (q.pos.y || 0) + 1.6, q.pos.z, b.ped.pos.x, (b.ped.pos.y || 0) + 0.4, b.ped.pos.z)) continue;
        b.found = true;
        bark(q, "Man down! Sergeant! Man down!", 2.8);
        note(J, "They found a body.");
        lockdown(J, { x: b.ped.pos.x, z: b.ped.pos.z }, "body", false);
        return;
      }
    }
  }

  /* ================================================================
     LOCKDOWN
     ================================================================ */
  const MATS = {};
  function mat(hex) { if (!MATS[hex]) { MATS[hex] = new THREE.MeshLambertMaterial({ color: hex }); MATS[hex]._shared = true; } return MATS[hex]; }
  function boom(J, x0, z0, x1, z1) {
    const AR = A(); if (!AR || !AR.root) return;
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, gy = floorY(cx, cz);
    const grp = new THREE.Group();
    grp.position.set(cx, gy, cz); grp.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    grp.userData.transient = true;
    const n = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i < n; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len / n, 0.16, 0.16), mat(i % 2 ? 0xe9e6dc : 0xb3242a));
      seg.position.set(-len / 2 + (i + 0.5) * len / n, 1.02, 0); grp.add(seg);
    }
    for (let s = -1; s <= 1; s += 2) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), mat(0x2b2d30)); post.position.set(s * len / 2, 0.55, 0); grp.add(post); }
    AR.root.add(grp);
    const c = { minX: Math.min(x0, x1) - 0.2, maxX: Math.max(x0, x1) + 0.2, minZ: Math.min(z0, z1) - 0.2, maxZ: Math.max(z0, z1) + 0.2, y0: gy, y1: gy + 1.25, ref: grp, _hmGeneral: true };
    if (CBZ.colliderAdd) { try { CBZ.colliderAdd(c); } catch (e) { (CBZ.colliders = CBZ.colliders || []).push(c); } } else (CBZ.colliders = CBZ.colliders || []).push(c);
    J.lock.props.push({ grp: grp, col: c });
  }
  function lockdown(J, at, why, known) {
    const B = J.B; if (!B) return;
    if (J.lock) { if (at) J.lock.at = at; if (known) J.lock.known = true; J.lock.t = Math.min(J.lock.t, 20); if (CBZ.cityBaseStandTo) CBZ.cityBaseStandTo(true, at || J.lock.at); return; }
    J.lock = { t: 0, at: at || null, why: why, known: !!known, props: [], resp: [], sirenT: 0, bolted: false };
    J.alarm = true;
    // the base's own watch stands to with it (city/basewatch.js)
    if (CBZ.cityBaseStandTo) { try { CBZ.cityBaseStandTo(true, at); } catch (e) {} }
    if (CBZ.sfxAt) { try { CBZ.sfxAt("lockdown", B.center.x, B.center.z, { vol: 1 }); } catch (e) {} }
    else if (CBZ.sfx) { try { CBZ.sfx("lockdown"); } catch (e) {} }
    if (CBZ.fortAlert && at) { try { CBZ.fortAlert(at.x, at.z, { level: 2, by: known ? PA() : null }); } catch (e) {} }
    // the booms come down across both gates
    const gates = (B.plan && B.plan.gates) || [];
    for (let i = 0; i < gates.length; i++) {
      const q = gates[i], w = bw(B, q.x, q.z), half = (q.w || 14) / 2 + 0.5;
      if (q.side === "east" || q.side === "west") boom(J, w.x - Math.sign(q.x) * 3, w.z - half, w.x - Math.sign(q.x) * 3, w.z + half);
      else boom(J, w.x - half, w.z - Math.sign(q.z) * 3, w.x + half, w.z - Math.sign(q.z) * 3);
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    // the parade breaks for stand-to: every man to a place facing out
    const L = soldiers();
    let k = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (!q || q.dead || q._hmStaff || q === J.mark || q.inCar || q.rage) continue;
      if (q._drill) {
        q._hmDrill = q._drill; q._hmStation = q._stationed; q._drill = null; q._stationed = null;
        const a = (k++ / 30) * Math.PI * 2, r = 30 + (k % 3) * 9;
        q._hmStand = { x: J.L.hq.x + Math.cos(a) * r, z: J.L.hq.z + Math.sin(a) * r * 0.8, face: Math.atan2(Math.cos(a), Math.sin(a) * 0.8) };
        q._hmCtl = true; walkTo(q, q._hmStand.x, q._hmStand.z, true);
        if (q.char && q.char.parts && q.char.parts.ra) { q.char.parts.ra.rotation.x = 0; q.char.parts.ra.rotation.z = 0; }
      }
    }
    // the nearest free men run for where it came from
    if (at) {
      const free = L.filter(function (q) { return q && !q.dead && !q._hmDrill && !q._stationed && !q._post && !q._hmPost && !q._hmStaff && !q.inCar && q !== J.mark && q.armed; });
      free.sort(function (a, b) { return d2(a.pos.x, a.pos.z, at.x, at.z) - d2(b.pos.x, b.pos.z, at.x, at.z); });
      for (let i = 0; i < Math.min(6, free.length); i++) { const q = free[i]; q._hmCtl = true; q._hmResp = true; walkTo(q, at.x + (i % 3 - 1) * 3, at.z + ((i / 3) | 0) * 3 - 1.5, true); J.lock.resp.push(q); }
    }
    const who = gateMen()[0];
    if (who) bark(who, "Seal the gate! Nobody in, nobody out!", 3);
    J.rev++;
  }
  function tickLock(J, dt) {
    const K = J.lock; if (!K) return;
    K.t += dt;
    const pl = P(), B = J.B;
    K.sirenT -= dt;
    if (K.sirenT <= 0 && K.t < 150) { K.sirenT = 9; if (CBZ.sfxAt) { try { CBZ.sfxAt("lockdown", B.center.x, B.center.z, { vol: 0.8 }); } catch (e) {} } }
    // a truck driven at a boom takes it off its posts
    if (pl && pl.driving && pl.pos && J.speed > 7) {
      for (let i = K.props.length - 1; i >= 0; i--) {
        const c = K.props[i].col;
        if (pl.pos.x > c.minX - 3.5 && pl.pos.x < c.maxX + 3.5 && pl.pos.z > c.minZ - 3.5 && pl.pos.z < c.maxZ + 3.5) {
          const pr = K.props.splice(i, 1)[0];
          if (pr.grp.parent) pr.grp.parent.remove(pr.grp);
          if (CBZ.colliderRemove) { try { CBZ.colliderRemove(pr.col); } catch (e) {} }
          if (CBZ.sfx) { try { CBZ.sfx("glass"); } catch (e) {} }
          once(J, "boom", "Took the boom off its posts.");
          blow(J, null, "He's running the gate!");
        }
      }
    }
    // nobody found, nobody known, the general alive: after four quiet minutes
    // the base stands down (the booms go up, the ranks go back)
    if (K.t > 240 && !J.dead && !J.blown && !K.known) { liftLock(J); note(J, "They stood down. Booms up."); return; }
    const L = soldiers();
    // men at their stand-to places stop and face out
    for (let i = 0; i < L.length; i++) {
      const q = L[i], S = q._hmStand;
      if (!S || q.dead || q.rage) continue;
      if (d2(q.pos.x, q.pos.z, S.x, S.z) < 2 || K.t > 40) { if (q.state !== "idle") holdAt(q, S.face); }
      else go(q, S.x, S.z, true);
    }
    // the ones who ran for the shot look for whoever fired it: a stranger is
    // shot; a uniform is only "him" with a gun out where it came from, or up
    // high above it
    const st = standing(), inU = !!uniform() && st.standing === "allowed" && st.why === "in uniform";
    if (pl && pl.pos && K.at) {
      for (let i = 0; i < K.resp.length; i++) {
        const q = K.resp[i];
        if (!q || q.dead || q.rage) continue;
        const d = d2(q.pos.x, q.pos.z, pl.pos.x, pl.pos.z);
        const here = d2(q.pos.x, q.pos.z, K.at.x, K.at.z) < 7;
        if (here && q.state !== "idle") holdAt(q, null);
        if (d < 45 && los(q.pos.x, (q.pos.y || 0) + 1.6, q.pos.z, pl.pos.x, (pl.pos.y || 0) + 1.25, pl.pos.z)) {
          const near = d2(pl.pos.x, pl.pos.z, K.at.x, K.at.z);
          const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun()) && near < 40;
          const high = (pl.pos.y || 0) - floorY(pl.pos.x, pl.pos.z) > 2.2 && near < 30;
          if (!inU || armed || high) {
            if (inU) blow(J, q, armed ? "There! The one with the rifle!" : "On the roof! That's him!");
            hostile(q);
          }
        }
      }
    }
    // the base's answer is "shoot him": everybody who can see him does
    if (pl && pl.pos && st.standing === "hostile" && inRect(B, pl.pos.x, pl.pos.z, 30) && (K.t % 1) < dt) {
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        if (!q || q.dead || q.rage || !q.armed || q.inCar) continue;
        if (d2(q.pos.x, q.pos.z, pl.pos.x, pl.pos.z) < 55 && los(q.pos.x, (q.pos.y || 0) + 1.6, q.pos.z, pl.pos.x, (pl.pos.y || 0) + 1.25, pl.pos.z)) hostile(q);
      }
    }
  }
  function liftLock(J) {
    const K = J.lock; if (!K) return;
    for (let i = 0; i < K.props.length; i++) {
      const pr = K.props[i];
      if (pr.grp.parent) pr.grp.parent.remove(pr.grp);
      pr.grp.traverse(function (n) { if (n.geometry && n.geometry.dispose) n.geometry.dispose(); });
      if (CBZ.colliderRemove) { try { CBZ.colliderRemove(pr.col); } catch (e) {} }
      else { const C = CBZ.colliders || [], j = C.indexOf(pr.col); if (j >= 0) C.splice(j, 1); }
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    soldiers().forEach(function (q) {
      if (q._hmDrill) { q._drill = q._hmDrill; q._stationed = q._hmStation; q._hmDrill = null; q._hmStation = null; }
      q._hmStand = null; q._hmResp = false;
      relax(q);
    });
    J.lock = null;
    if (CBZ.cityBaseStandTo) { try { CBZ.cityBaseStandTo(false); } catch (e) {} }
  }

  /* ---------------- shots: the base hears a rifle ---------------- */
  function onShot(J, x, z, loud) {
    J.lastShot = { x: x, z: z, loud: loud, t: J.t };
    const B = J.B;
    if (!J.baseUp || !B) return;
    if (!loud) {
      // a suppressed round: only a man close enough to hear the action work
      const L = soldiers();
      for (let i = 0; i < L.length; i++) { const q = L[i]; if (q && !q.dead && d2(q.pos.x, q.pos.z, x, z) < 28) { lockdown(J, { x: x, z: z }, "shots", false); return; } }
      return;
    }
    if (!inRect(B, x, z, 420)) return;
    // a rifle is heard across the whole base; where from, only roughly
    const far = d2(x, z, J.L.hq.x, J.L.hq.z), err = Math.min(40, far * 0.12);
    lockdown(J, { x: x + (Math.random() - 0.5) * err, z: z + (Math.random() - 0.5) * err }, "shots", false);
    note(J, "They heard the shot.");
  }

  /* ================================================================
     THE JOB
     ================================================================ */
  function onKill(J, ped, imp) {
    if (!ped || ped === J.mark) return;
    if ((ped.milRank || ped.organization === "military") && J.baseUp && imp.byPlayer !== false && !imp.attacker && J.B && inRect(J.B, ped.pos.x, ped.pos.z, 160)) J.bodies.push({ ped: ped, found: false });
  }
  function onDead(J, inc) {
    J.dead = true;
    const m = J.mark, pl = P();
    note(J, "Strand is dead.");
    let at = null;
    const ls = J.lastShot;
    if (ls && ls.loud && J.t - ls.t < 6 && pl && pl.pos) { const far = d2(ls.x, ls.z, m.pos.x, m.pos.z), err = Math.min(36, far * 0.12); at = { x: ls.x + (Math.random() - 0.5) * err, z: ls.z + (Math.random() - 0.5) * err }; }
    if (J.B) lockdown(J, at || { x: m.pos.x, z: m.pos.z }, "general", false);
    (J.staff || []).forEach(function (q) { if (q && !q.dead) bark(q, "General's down! Sniper!", 2.6); });
    void inc;
  }
  function tick(J, dt) {
    J.t += dt;
    const pl = P();
    if (pl && pl.pos) {
      if (J.pp) { const v = d2(pl.pos.x, pl.pos.z, J.pp.x, J.pp.z) / Math.max(0.05, dt); J.speed = J.speed * 0.5 + v * 0.5; }
      J.pp = { x: pl.pos.x, z: pl.pos.z };
    }
    stampUniform(J);
    if (!J.town && !J.townTried) stageTown(J);
    tickTown(J, dt);
    const B = base();
    if (!B) return;
    J.B = B;
    const dC = distP(B.center.x, B.center.z);
    if (!J.baseUp) { if (dC < 840 && !J.dead) stageBase(J, B); return; }
    if (dC > 1180) { unstageBase(J, true); return; }
    tickGeneral(J, dt);
    tickOut(J, dt);
    tickBodies(J);
    watchCover(J);
    if (!uniform() && !J.lock) { const st = standing(); if (st.level >= 1 && st.where !== "outside") once(J, "gate", "The gate turned me round. They do not let a face in that they do not know."); }
    tickLock(J, dt);
    // what he has seen for himself
    const m = J.mark;
    if (m && !m.dead && seesPed(m)) {
      J.idT = (J.idT || 0) + dt;
      if (J.idT > 0.6 && once(J, "id", "Saw him. The red beret.")) J.identified = true;
      const hid = J.G && J.G.holdId;
      if (hid && once(J, "hold:" + hid, hid === "stand" ? "He stood at the reviewing stand for most of a minute." : hid === "flag" ? "He stood at the flag and did not move." : "He stood by the guardhouse with the gate guard.")) J.rev++;
    }
    if (J.roof && pl && pl.pos && (pl.pos.y || 0) > J.roof.top - 0.5 && d2(pl.pos.x, pl.pos.z, J.roof.c.x, J.roof.c.z) < Math.max(J.roof.sh.w, J.roof.sh.d) / 2 + 1) {
      once(J, "roof", "On the roof of " + roofName(J.roof) + ". " + J.roof.lines.map(function (l) { return l.d + " m to " + l.what; }).slice(0, 2).join(", ") + ".");
    }
  }
  function pinAt(J) {
    if (J.dead) return null;
    const R = baseRegion();
    if (uniform() && R) { const B = base(); return B ? { x: B.gate.x, z: B.gate.z, label: "Fort Brandt", key: "gate" } : { x: (R.minX + R.maxX) / 2, z: (R.minZ + R.maxZ) / 2, label: "Fort Brandt", key: "base" }; }
    if (J.town && !J.town.ped.dead) return { x: J.town.front.x, z: J.town.front.z, label: "Marsh", key: "marsh" };
    return R ? { x: (R.minX + R.maxX) / 2, z: (R.minZ + R.maxZ) / 2, label: "Fort Brandt", key: "base" } : null;
  }
  function clearOf(J) {
    const B = base(), pl = P();
    return !B || !pl || !pl.pos || !inRect(B, pl.pos.x, pl.pos.z, 90);
  }
  function end(J, hard) {
    unstageBase(J, !!hard);
    if (J.town && J.town.ped) dismiss(J.town.ped, hard);
    J.town = null;
  }

  /* ================================================================
     PAPER: the folder, the cork, a plan somebody inside drew
     ================================================================ */
  function file(J) {
    const w = uniform(), T = J.town, R = J.roof;
    const bar = T ? lotName(T.lot) : "a bar in town";
    const G = J.G, hid = G ? G.leg : "";
    const K = J.S.known || {};
    const routine = [
      { label: "Parade", dur: "06:30 and 13:00", detail: "Walks the front rank, then takes the salute at the reviewing stand. He stands still there for most of a minute.", seen: true, now: hid === "parade" },
      { label: "The gate", dur: "10:00 and 16:00", detail: "Driven down to the guardhouse to look at the gate guard. On foot there about a minute. The car waits for him.", seen: true, now: hid === "gate" },
      { label: "Retreat", dur: "17:30", detail: "At the flagpole in front of headquarters when the flag comes down. He salutes and does not move.", seen: true, now: hid === "retreat" },
      { label: "The office", dur: "the rest of the day", detail: "Headquarters, ground floor. He takes the telephone standing at the window beside the door.", seen: true, now: false },
    ];
    const approaches = [
      { label: "A uniform", detail: "Pvt. " + PRIVATE.name + ", " + PRIVATE.unit + ", drinks alone at " + bar + ". He walks off from the door to smoke. Fatigues from a shop will not do: the gate reads the name tape.", known: true, used: !!w },
      { label: "Other uniforms", detail: "Two men on a post on the road in. One man who walks the outside of the wire beside the gate, alone.", known: true, used: false },
      { label: "Rank", detail: "A private can walk the motor pool and the barracks. Near headquarters a private gets looked at. The dead man's own company knows his face.", known: true, used: false },
      { label: "The roof", detail: R ? ("A ladder on the " + R.side + " wall of " + roofName(R) + ". From the roof: " + R.lines.map(function (l) { return l.what + " at " + l.d + " m"; }).join(", ") + ".") : "One of the low roofs has a ladder up its blind wall, and a line to the parade ground.", known: !!(R && K.base), used: !!K.roof },
      { label: "After", detail: "The gates drop their booms and every uniform is asked its unit. There are gaps a man can walk through in the wire on the sea sides.", known: true, used: false },
    ];
    return {
      codename: "STRAND", opLabel: "", classification: "PRIVATE", header: "STRAND",
      status: J.dead ? "DONE" : "OPEN",
      subject: { name: NAME, role: ROLE, photo: J.photo || "", note: J.photo ? "Red beret. An aide and a sergeant with him." : "No photograph. He does not leave the wire." },
      identified: J.identified ? true : (J.baseUp ? false : undefined),
      brief: [
        "Strand commands Fort Brandt and sells what is in its armoury. The buyer he cheated is paying for this.",
        "He does not leave the base, so you go in. Nobody gets through that gate in his own clothes.",
        "A clerk in headquarters wrote his day down. It is on this page.",
      ],
      facts: [
        { k: "POST", v: "Fort Brandt" + (J.roadName ? ", at the end of " + J.roadName : "") },
        { k: "GATE", v: "A face they do not know is turned round. Push it and they shoot." },
        { k: "FEE", v: money(PAY) + ". Half again if nobody knows it was you." },
      ],
      routine: routine,
      security: [
        { label: "Garrison", detail: "About sixty rifles. Two on the gate, a tower on each corner, a duty officer in front of the parade ground.", seen: true },
        { label: "With him", detail: "An aide and a sergeant. The sergeant is the one who shoots.", seen: true },
      ],
      approaches: approaches,
      kit: w ? [(w._hmRank ? w._hmRank.charAt(0).toUpperCase() + w._hmRank.slice(1) + "'s fatigues" : "Fatigues") + (w._hmOwner ? " (" + w._hmOwner + ")" : "")] : [],
      notes: (J.S.notes || []).slice(-8),
      map: T ? { places: [{ x: T.front.x, z: T.front.z, label: "Marsh" }] } : null,
      stamp: J.dead ? "PAID" : null,
      footer: J.dead ? "" : "Night: nothing. He sleeps in headquarters.",
    };
  }
  // a plan of the base in pencil, from somebody who works there
  function sketch(J, reuse) {
    const B = J.B || base();
    const c = reuse || document.createElement("canvas");
    c.width = 560; c.height = 560;
    const cc = c.getContext("2d");
    cc.fillStyle = "#e9e2cf"; cc.fillRect(0, 0, 560, 560);
    for (let i = 0; i < 900; i++) { cc.fillStyle = i % 2 ? "rgba(90,70,40,.05)" : "rgba(255,250,235,.08)"; cc.fillRect((i * 97) % 560, (i * 53) % 560, 2, 2); }
    cc.strokeStyle = "rgba(120,100,70,.35)"; cc.lineWidth = 1; cc.beginPath(); cc.moveTo(0, 280); cc.lineTo(560, 280); cc.stroke();
    const HAND = '"Bradley Hand","Segoe Print","Noteworthy","Marker Felt","Comic Sans MS",cursive';
    const ink = "rgba(40,44,70,.85)";
    cc.fillStyle = ink; cc.font = "700 26px " + HAND; cc.fillText("Fort Brandt", 26, 40);
    if (!B || !B.plan) { cc.font = "22px " + HAND; cc.fillText("(not seen yet)", 26, 80); return c; }
    const hx = B.plan.hx || 240, hz = B.plan.hz || 250, sc = 236 / Math.max(hx, hz);
    const X = function (lx) { return 280 + lx * sc; }, Z = function (lz) { return 290 + lz * sc; };
    cc.strokeStyle = ink; cc.lineWidth = 2; cc.setLineDash([7, 5]); cc.strokeRect(X(-hx), Z(-hz), 2 * hx * sc, 2 * hz * sc); cc.setLineDash([]);
    const R = B.plan.roads || {};
    cc.fillStyle = "rgba(120,110,90,.28)";
    for (const k in R) { const r = R[k]; if (r && isFinite(r.x0)) cc.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc); }
    const label = function (t, lx, lz, red) { cc.fillStyle = red ? "#9c1c16" : ink; cc.font = (red ? "700 " : "") + "19px " + HAND; cc.fillText(t, X(lx), Z(lz)); };
    (B.plan.build || []).forEach(function (b) {
      if (b.kind === "watchtower" || b.kind === "booth" || b.kind === "radar") return;
      cc.strokeStyle = ink; cc.lineWidth = b.id === "hq" ? 3 : 1.5;
      cc.strokeRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * sc, b.d * sc);
    });
    const hq = planOf(B, "hq");
    if (hq) label("HQ", hq.x - 12, hq.z - hq.d / 2 - 6);
    label("parade", B.parade.x - B.center.x - 26, B.parade.z - B.center.z + 4);
    label("gate", B.gate.x - B.center.x - 42, B.gate.z - B.center.z - 10);
    label("barracks", (B.barracks.x - B.center.x) - 30, (B.barracks.z - B.center.z) + 5);
    // the roof, ringed
    const Rf = J.roof;
    if (Rf) {
      const lx = Rf.c.x - B.center.x, lz = Rf.c.z - B.center.z;
      cc.strokeStyle = "#9c1c16"; cc.lineWidth = 3;
      cc.beginPath(); cc.ellipse(X(lx), Z(lz), Rf.sh.w * sc * 0.75 + 6, Rf.sh.d * sc * 0.75 + 6, 0.1, 0, 6.3); cc.stroke();
      label("ladder, " + Rf.side + " wall", lx - 20, lz + Rf.sh.d / 2 + 22, true);
      const s = J.L.stand;
      cc.setLineDash([4, 5]); cc.lineWidth = 1.6; cc.beginPath(); cc.moveTo(X(lx), Z(lz)); cc.lineTo(X(s.x - B.center.x), Z(s.z - B.center.z)); cc.stroke(); cc.setLineDash([]);
    }
    // the walk-through gaps on the sea sides
    cc.fillStyle = "#9c1c16"; cc.font = "17px " + HAND;
    cc.fillText("gap", X(-hx) + 6, Z(0) + 5); cc.fillText("gap", X(0) - 14, Z(hz) - 8);
    return c;
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
    const items = [], T = J.town;
    const pol = cached("pol", "g" + !!J.photo + J.dead, function (re) { return K.polaroid({ photo: J.photo || null, caption: "Strand", crossed: !!J.dead }, Object.assign({ canvas: re }, redraw)); });
    if (pol) items.push({ id: "live", canvas: pol, w: 0.22, h: 0.264, x: -0.68, y: 0.2, rot: -0.04, pin: "red", links: ["plan"] });
    if (T) {
      const mp = cached("marsh", "m" + !!T.photo + T.ped.dead, function (re) { return K.polaroid({ photo: T.photo || null, caption: "Pvt. Marsh", crossed: !!T.ped.dead }, Object.assign({ canvas: re }, redraw)); });
      if (mp) items.push({ id: "marsh", canvas: mp, w: 0.17, h: 0.204, x: -0.7, y: -0.24, rot: 0.05, pin: "white", links: ["map"] });
      const map = cached("map", "map" + (T.front.x | 0), function (re) { return K.map({ places: [{ x: T.front.x, z: T.front.z, label: "Marsh" }], radius: 150 }, { canvas: re }); });
      if (map) items.push({ id: "map", canvas: map, w: 0.36, h: 0.36, x: -0.32, y: -0.22, rot: 0.03, pin: "red" });
    }
    const pl = cached("plan", "plan" + !!J.B + (J.roof ? J.roof.b.id : ""), function (re) { return sketch(J, re); });
    if (pl) items.push({ id: "plan", canvas: pl, w: 0.46, h: 0.46, x: 0.02, y: 0.2, rot: -0.02, pin: "red" });
    const cards = [
      ["Parade 06:30, 13:00", "Gate 10:00, 16:00", "Flag 17:30"],
      [uniform() ? "In the fatigues" : "Need a uniform", uniform() ? "Walk. Do not run." : "Marsh smokes alone"],
    ];
    for (let i = 0; i < cards.length; i++) {
      const cv = cached("card" + i, cards[i].join("|"), function (re) { return K.note({ lines: cards[i], hand: true, tone: i ? "yellow" : "index" }, { canvas: re }); });
      if (cv) items.push({ id: "card" + i, canvas: cv, w: 0.24, h: 0.156, x: 0.58, y: 0.26 - i * 0.24, rot: (i ? 0.04 : -0.03), pin: "red", links: i ? [] : ["plan"] });
    }
    return items;
  }

  function make(S) {
    const J = {
      S: S, name: NAME, role: ROLE, pay: PAY, weight: "someone", cause: "shot", alarm: false,
      kills: { civ: 0, guard: 0 }, mark: null, t: 0, rev: 0, speed: 0, pp: null, lastShot: null,
      town: null, townTried: false, baseUp: false, B: base(), L: null, roof: null, ladder: null,
      staff: [], out: [], wire: null, car: null, G: null, lock: null, bodies: [], blown: false, dead: false, identified: false, photo: "",
    };
    J.lens = function (q, c) { return lens(J, q, c); };
    J.file = function () { return file(J); };
    J.board = function () { return board(J); };
    J.boardKey = function () { return [J.rev, !!uniform(), J.dead, !!J.photo, J.town ? J.town.ped.dead : ""].join(":"); };
    J.tick = function (dt) { tick(J, dt); };
    J.frame = function (dt) { frame(J, dt); };
    J.pinAt = function () { return pinAt(J); };
    J.isGuard = function (p) { return !!(p && (p.milRank || p.organization === "military")); };
    J.onKill = function (ped, imp) { onKill(J, ped, imp || {}); };
    J.onDead = function (inc) { onDead(J, inc); };
    J.onShot = function (x, z, loud) { onShot(J, x, z, loud); };
    J.clear = function () { return clearOf(J); };
    J.place = function () { return "Fort Brandt"; };
    J.end = function (hard) { end(J, hard); };
    stageTown(J);
    LIVE = J;
    return J;
  }
  let LIVE = null;

  CBZ.hitmanJobs.add({
    id: "general", order: 40, from: "Nico",
    call: [
      { by: "phone", line: "Nico. I have a strange one. Sit down for it." },
      { by: "phone", line: "A general. Aurel Strand. He runs Fort Brandt and he sells what is in the armoury." },
      { by: "phone", line: "He never comes out. So you go in, and nobody goes through that gate in his own clothes." },
      { by: "phone", line: "There is a soldier in the envelope who drinks alone. Start with him." },
    ],
    when: function () { return !!baseRegion(); },
    make: make,
  });

  // probes: the live staging, and the beats driven by hand
  CBZ.hmGeneral = {
    live: function () { return LIVE; },
    lockdown: function () { if (LIVE && LIVE.B) lockdown(LIVE, P() && P().pos ? { x: P().pos.x, z: P().pos.z } : null, "shots", false); return !!(LIVE && LIVE.lock); },
    leg: function (leg) { if (!LIVE || !LIVE.G) return false; startLeg(LIVE, leg); return LIVE.G.leg; },
    sketch: function () { return LIVE ? sketch(LIVE, null) : null; },
    audit: function () {
      const J = LIVE; if (!J) return null;
      const m = J.mark, w = uniform();
      const sus = J.baseUp ? soldiers().filter(function (q) { return (q._bwDoubt || 0) > 0.05; }).map(function (q) { return { n: q.name, r: q.milRank, s: +q._bwDoubt.toFixed(2), act: q._bwAct || null }; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 5) : [];
      return {
        town: J.town ? { name: J.town.ped.name, dead: !!J.town.ped.dead, phase: J.town.phase, alley: J.town.alley, at: [Math.round(J.town.ped.pos.x), Math.round(J.town.ped.pos.z)], bar: lotName(J.town.lot) } : null,
        baseUp: J.baseUp, leg: J.G ? J.G.leg : null, step: J.G ? J.G.i : null, holdId: J.G ? J.G.holdId : null,
        mark: m ? { at: [Math.round(m.pos.x), Math.round(m.pos.z)], dead: !!m.dead, inCar: !!m.inCar, state: m.state } : null,
        roof: J.roof ? { id: J.roof.b.id, side: J.roof.side, top: +J.roof.top.toFixed(1), foot: [Math.round(J.roof.foot.x), Math.round(J.roof.foot.z)], lines: J.roof.lines } : null,
        ladder: !!(J.ladder && J.ladder.ladder), car: J.car ? { at: J.car.at, s: Math.round(J.car.s) } : null,
        uniform: w ? { rank: w._hmRank, unit: w._hmUnit, owner: w._hmOwner, accepted: inUniform() } : null, standing: standing(),
        sus: sus, lock: J.lock ? { t: Math.round(J.lock.t), why: J.lock.why, booms: J.lock.props.length, resp: J.lock.resp.length } : null,
        blown: J.blown, out: J.out.length, notes: (J.S.notes || []).slice(-4), why: J.why || null,
      };
    },
  };
})();
