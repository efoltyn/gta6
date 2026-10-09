/* ============================================================
   city/president_office.js — THE PRESIDENT'S OFFICE IS THE GAME.

   OWNER: "Look at the room they spawn in and make the assets and things in
   that room more meaningful." / "I hate a popup that says 'the wall' and
   then a 'read wall' button to press. Stop breaking the fourth wall."

   So the presidency is run from one room, and everything in that room is a
   way the country reaches you. There is no menu, no mission list and no
   strip of numbers on the screen. What replaced them:

   YOU START AT YOUR DESK. When you are sworn in you are seated in the chair
   behind the desk in the President's Office (upper floor of the West Wing),
   facing the door. interior_programs.js built the room; this file only
   reads its landmarks and adds the working objects on top.

   THE PHONE RINGS. A proper desk phone sits where the old placeholder box
   was: base, handset, a row of line buttons and a red lamp. When somebody
   needs a decision it rings (a synthesized two-tone trill), the lamp
   blinks and the handset rattles in its cradle. E on it is Answer: the
   handset comes up to your ear and the caller talks. When it is quiet, E
   on it is Call: you ring whoever has business waiting for you. Callers are
   the people who run the state for you: the General, the Bureau Director,
   the Treasury Secretary, the Police Commissioner, a foreign ambassador,
   the party whip, the Chief of Staff. What they say is read off the world
   at the moment they call (the cell, approval, the treasury, the wall, the
   last attack), and the two answers you get are real orders
   (CBZ.presidency.press) or real consequences. If the order cannot run,
   the caller tells you why in his own words and you only get the answer
   that is actually available. Let it ring 25 seconds and the caller does
   what he does without you; the Chief of Staff tells you about it later.

   THE FOLDERS ARE THE AGENDA. Each morning two or three folders are on
   the desk: red for security, blue for the economy, green for the people,
   each with a printed cover label (the classification stamp, the
   department, the day). E on the desk is Sign: the top folder opens flat,
   the camera leans down over your shoulder and the page is the text (a
   typed memo, FROM / TO / SUBJECT, a body that quotes the current state, a
   recommendation); E again inks your signature and a stamp onto the page,
   runs the order and drops the folder in the out-tray. Send back (on the
   wheel) stamps it RETURNED. Hold E is Govern: you sit down behind the
   desk and the day comes to you. If the order cannot run, a yellow note on the page
   says why and signing is not offered. Folders left unsigned at the end
   of the day are their own consequence.

   THE TV. A wall-mounted set on the side wall, in view of the chair, is
   one of the game's NEWS ONE sets (city/newsroom.js owns the channel, the
   canvas and the set). This file writes the presidency's moments into it
   (orders, attacks, raids, speeches, protests, lockdowns, your decisions);
   other files may still call CBZ.presidentOffice.news(). Only breaking
   items reach the phone's news app, and not more than once a minute.

   PEOPLE WALK IN. The Chief of Staff (a named, persistent person) walks in
   from the doorway, stops in front of the desk and talks to you: the day's
   schedule in words, missed calls, what the folders you ignored cost. When
   an attack is armed at the gate a military aide walks in; after a bad
   news cycle the press secretary does. A secretary stands by her desk in
   the outer office and has a word for you when you pass.

   THE MATTERS ENGINE. Everything above is a delivery channel for one
   object, the matter (see offer() below). The world generates matters
   (the daily agenda, reactions to events), other files may offer their
   own, and every decision is emitted on the presidency bus as "decision"
   {source, topic, choice, order} so the TV and anything else can react.
   Pacing: one ringing call at a time, 40 s of quiet between calls, two or
   three folders a day, aides only when it cannot wait.

   When the player is not the President nothing rings and nothing is
   delivered; the office is still a furnished room with the TV on.

   This file retired president_agenda.js (the Chief of Staff mission list,
   the podium and press corps on the perron, the West Wing general) and
   president_hud.js (the approval/treasury/threat strip). The general's
   threat briefing lives on as the General's phone call and security memo.

   PUBLIC: CBZ.presidentOffice = { offer, news, dayLine, ringing, cellCall, deskPoint, audit }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game || (CBZ.game = {});

  // ---------------------------------------------------------------- tuning
  const RING_SECS = 25;            // unanswered after this: the caller acts alone
  const CALL_GAP = 40;             // quiet seconds between calls
  const RING_PERIOD = 3.4;         // one trill burst every n seconds
  const FOLDERS_MAX = 3;
  const AIDE_TALK_R = 4.2;
  const DESK_TOP = 0.76;           // interior_programs.js's Resolute desk (the room publishes rec.deskTop)
  const THRONE_BACK = 1.12;        // the chair's centre behind the desk centre, along the frame

  // ---------------------------------------------------------------- seams
  let CLOCK = 0;                   // real seconds of city play, this file's clock
  function P() { return CBZ.presidency || null; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function hour() { try { return CBZ.citySunHour ? +CBZ.citySunHour() : 12; } catch (e) { return 12; } }
  function status() {
    const p = P();
    if (!p || typeof p.status !== "function") return null;
    try { return p.status() || null; } catch (e) { return null; }
  }
  function seated() { const s = status(); return !!(s && s.seat); }
  function seatH() {
    const p = P();
    if (!p || typeof p.seat !== "function") return null;
    try { return p.seat() || null; } catch (e) { return null; }
  }
  let _btns = null, _btnsAt = -1;
  function btn(key) {
    if (!key) return { ok: true, why: "" };
    const p = P();
    if (!p || typeof p.buttons !== "function") return { ok: false, why: "" };
    if (!_btns || CLOCK - _btnsAt > 0.4) {
      try { _btns = p.buttons() || []; } catch (e) { _btns = []; }
      _btnsAt = CLOCK;
    }
    for (let i = 0; i < _btns.length; i++) if (_btns[i] && _btns[i].key === key) return _btns[i];
    return { ok: false, why: "" };
  }
  function press(key) {
    const p = P();
    if (!p || typeof p.press !== "function") return { ok: false, why: "" };
    _btns = null;
    try { return p.press(key) || { ok: false, why: "" }; } catch (e) { return { ok: false, why: "" }; }
  }
  function emit(evt, payload) { const p = P(); if (p && p.emit) { try { p.emit(evt, payload); } catch (e) {} } }
  function shock(n) {
    const h = seatH();
    if (!h || !CBZ.approvalShock || !isFinite(n) || !n) return;
    try { CBZ.approvalShock(h.id, n); } catch (e) {}
  }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : (((a * 12.9898 + b * 78.233 + salt * 0.1) * 43758.5453) % 1 + 1) % 1; }
  function strHash(s) { s = String(s || ""); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffff; return h; }
  function money(n) { return "$" + Math.round(+n || 0).toLocaleString("en-US"); }
  // Signage law: no em dashes, no middle dots, plain words.
  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[·•—–]\s*/g, ", ")
      .replace(/…/g, "...")
      .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
  }
  function player() { return CBZ.player || null; }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function inCity() { return g.mode === "city"; }
  function mat(hex, o) {
    if (CBZ.cmat) { try { return CBZ.cmat(hex, o); } catch (e) {} }
    return new THREE.MeshLambertMaterial({ color: hex, emissive: (o && o.emissive) || 0, emissiveIntensity: (o && o.ei) || 1 });
  }
  function geo(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function box(parent, x, y, z, w, h, d, hex, o) {
    const m = new THREE.Mesh(geo(w, h, d), mat(hex, o));
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function canvasTex(cv) {
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;     // match core/renderer.js
    t.anisotropy = 4;
    return t;
  }
  function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function planeFlat(w, d, tex, lit) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      lit ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;           // lying flat; the page's top edge points AWAY from the reader
    return m;
  }
  function disposeMesh(m) {
    if (!m) return;
    m.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.geometry && !o.geometry._shared && o.geometry.type === "PlaneGeometry") o.geometry.dispose();
      const mm = o.material;
      if (mm && !mm._shared && mm.map) mm.dispose();
    });
    if (m.parent) m.parent.remove(m);
  }

  // ============================================================
  //  §1  THE CAST. The lead's presidency.cabinet() names the real ledger
  //  people; without it the names are seeded off the seat so the same man
  //  calls every time.
  // ============================================================
  const FIRST = ["Marcus", "Elena", "Victor", "Ruth", "Daniel", "Irene", "Tomas", "Helen", "Adrian", "Clara", "Simon", "Nadia", "Leon", "Vera", "Oscar", "Miriam"];
  const LAST = ["Hale", "Varga", "Okafor", "Lindqvist", "Moreau", "Castell", "Brandt", "Whitlock", "Serrano", "Adair", "Kovac", "Delacroix", "Ashford", "Reyes", "Maddox", "Novak"];
  const ROLE_TITLE = {
    chief: "Chief of Staff", general: "General", bureau: "Director", police: "Commissioner",
    treasury: "Secretary", whip: "", press: "Press Secretary", aide: "Major", secretary: "",
  };
  function seededName(role) {
    const h = seatH();
    const k = strHash((h ? h.id : "republic") + ":" + role);
    return FIRST[k % FIRST.length] + " " + LAST[(k >> 5) % LAST.length];
  }
  function person(role) {
    // the press secretary is the one at her desk (city/president_staff.js)
    const PS = CBZ.presidentStaff;
    if (role === "press" && PS && PS.person) {
      try { const r = PS.person("press"); if (r && r.name) return { name: String(r.name), sid: r.sid || null, role: role }; } catch (e) {}
    }
    const p = P();
    if (p && typeof p.cabinet === "function") {
      try {
        const c = p.cabinet() || {};
        const r = c[role];
        if (r && r.name) return { name: String(r.name), sid: r.sid || null, role: role };
      } catch (e) {}
    }
    return { name: seededName(role), sid: null, role: role };
  }
  function surname(n) { const a = String(n || "").split(" "); return a[a.length - 1]; }
  // what a person is called when he speaks
  function speaker(who, phone) {
    const t = ROLE_TITLE[who.role];
    let s;
    if (who.role === "chief") s = who.name + ", Chief of Staff";
    else if (who.role === "press") s = who.name + ", Press Secretary";
    else if (who.role === "whip") s = who.name + ", Party Whip";
    else if (who.role === "foreign") s = who.name;
    else if (t) s = t + " " + surname(who.name);
    else s = who.name;
    return phone ? s + " (on the line)" : s;
  }

  // ============================================================
  //  §2  THE ROOM. Read interior_programs' published record for the
  //  office; everything this file draws hangs off its landmarks.
  //
  //  Frame: one Group at the room's entry, rotated so local +Z runs INTO the
  //  room (toward the seal wall) and local +X is the right hand of a man
  //  seated at the desk looking at the door. A point at (depth D, lateral L)
  //  in the approach frame is local (x = -L, z = D).
  // ============================================================
  let _roomRec = null, _roomAt = -1;
  function office() {
    if (_roomRec && CLOCK - _roomAt < 1.0) return _roomRec;
    _roomAt = CLOCK;
    _roomRec = null;
    if (!CBZ.presidentInteriorRooms) return null;
    let list = [];
    try { list = CBZ.presidentInteriorRooms() || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.key === "ovaloffice" && r.approach && r.landmarks && r.landmarks.presidentialDesk) { _roomRec = r; break; }
    }
    return _roomRec;
  }
  function toLocal(rec, wx, wz) {
    const A = rec.approach, dx = wx - A.x, dz = wz - A.z;
    return { x: -(dx * A.tx + dz * A.tz), z: dx * A.nx + dz * A.nz };
  }
  function toWorld(rec, lx, lz) {
    const A = rec.approach, L = -lx;
    return { x: A.x + A.nx * lz + A.tx * L, z: A.z + A.nz * lz + A.tz * L };
  }
  function faceDoor(rec) { return Math.atan2(-rec.approach.nx, -rec.approach.nz); }
  function inOffice(rec, py) {
    rec = rec || office();
    const Pp = player();
    if (!rec || !Pp || !Pp.pos) return false;
    if (Math.abs(Pp.pos.y - rec.floorY) > 2.2) return false;
    const l = toLocal(rec, Pp.pos.x, Pp.pos.z);
    return l.z > -0.5 && l.z < rec.approach.depth + 0.5 && Math.abs(l.x) < rec.approach.span / 2 + 0.5;
  }
  function nearOffice(rec, r) {
    const Pp = player();
    if (!rec || !Pp || !Pp.pos || Math.abs(Pp.pos.y - rec.floorY) > 3.0) return false;
    const d = rec.landmarks.presidentialDesk;
    return Math.hypot(Pp.pos.x - d.x, Pp.pos.z - d.z) < r;
  }

  const ROOM = {
    rec: null, builtFor: null, key: "", root: null, frame: null, desk: null,
    L: null,              // local layout (see layout())
    phone: null, handset: null, lampOn: null, lampOff: null, lamp: null,
    tv: null, tvWorld: null,
    tray: null,
  };

  function layout(rec) {
    const lm = rec.landmarks, A = rec.approach;
    const dl = toLocal(rec, lm.presidentialDesk.x, lm.presidentialDesk.z);
    const portal = lm.arrivalPortal ? toLocal(rec, lm.arrivalPortal.x, lm.arrivalPortal.z) : { x: 0, z: Math.min(7, Math.max(5.8, A.depth * 0.22)) };
    const dep = A.depth, half = A.span / 2;
    // THE TELEVISION hangs where the room says (its tv / tvBack landmarks: a
    // point on the wall and one behind it); a room that names none gets it
    // on the side wall level with the desk
    let tv = { x: half, z: Math.max(1.0, dl.z - 3.0), y: 1.95, yaw: 0 };
    if (lm.tv && lm.tvBack) {
      const a = toLocal(rec, lm.tv.x, lm.tv.z), b = toLocal(rec, lm.tvBack.x, lm.tvBack.z);
      const ux = a.x - b.x, uz = a.z - b.z, ul = Math.hypot(ux, uz) || 1;
      tv = { x: a.x, z: a.z, y: 1.95, yaw: Math.atan2(uz / ul, -ux / ul) };
    }
    const spawn = lm.staffDoor ? toLocal(rec, lm.staffDoor.x, lm.staffDoor.z) : { x: 0, z: 1.0 };
    return {
      desk: { x: dl.x, z: dl.z },
      portalZ: portal.z,
      dep: dep, half: half,
      tv: tv,
      // desk-frame positions (x = reader's right, z = toward the chair), on
      // the Resolute desk's 1.83 x 1.2 top: the phone at the right hand, the
      // day's folders at the left, the out-tray by the phone
      phone: { x: 0.60, z: -0.08 },
      pile: { x: -0.56, z: -0.04 },
      tray: { x: 0.60, z: 0.36 },
      open: { x: 0.0, z: 0.26 },
      // people: they come in at the office's staff door and stop in front of the desk
      aideSpawn: spawn,
      aideStand: { x: dl.x, z: dl.z - 2.05 },
      // the secretary's post: the room's (outside the office door), in world coords
      secPostW: lm.secretaryPost ? { x: lm.secretaryPost.x, z: lm.secretaryPost.z } : toWorld(rec, -Math.min(4.25, half - 0.6), Math.max(1.4, portal.z - 2.0)),
      secLookW: lm.arrivalPortal ? { x: lm.arrivalPortal.x, z: lm.arrivalPortal.z } : toWorld(rec, 0, portal.z),
    };
  }

  function teardownRoom() {
    releaseAide(true);
    releaseSecretary();
    endReading(true);
    if (ROOM.root) {
      disposeMesh(ROOM.root);
      ROOM.root = null;
    }
    for (let i = 0; i < M.folders.length; i++) M.folders[i].mesh = null;
    ROOM.rec = null; ROOM.builtFor = null; ROOM.key = ""; ROOM.frame = null; ROOM.desk = null;
    ROOM.phone = null; ROOM.handset = null; ROOM.lamp = null; ROOM.tv = null;
    ROOM.tray = null; ROOM.L = null; ROOM.tvWorld = null;
    ROOM.handsetHome = null;
  }

  function buildRoom(rec) {
    const root = arenaRoot();
    if (!root || !rec) return false;
    teardownRoom();
    const L = layout(rec);
    const grp = new THREE.Group();
    grp.name = "president-office";
    grp.userData.transient = true;      // core/batch.js: never merge, this group is ours
    grp.userData.dynamic = true;        // farcull: an authored set is never culled
    grp.position.set(rec.approach.x, rec.floorY, rec.approach.z);
    grp.rotation.y = Math.atan2(rec.approach.nx, rec.approach.nz);
    root.add(grp);
    ROOM.root = grp; ROOM.frame = grp; ROOM.rec = rec; ROOM.L = L;
    ROOM.builtFor = CBZ.govComplexes;
    ROOM.key = roomKey(rec);

    // the desk frame: origin on the worktop centre
    const desk = new THREE.Group();
    desk.position.set(L.desk.x, rec.deskTop || DESK_TOP, L.desk.z);
    grp.add(desk);
    ROOM.desk = desk;

    buildPhone(desk, L.phone);
    buildInTray(desk, L.pile);
    buildTray(desk, L.tray);
    buildTV(grp, L.tv);
    grp.updateMatrixWorld(true);
    if (ROOM.tv) {
      const tvw = new THREE.Vector3(0, 0, 0);
      ROOM.tv.localToWorld(tvw);
      ROOM.tvWorld = { x: tvw.x, y: tvw.y, z: tvw.z };
    }
    layoutFolders();
    if (CBZ.news) CBZ.news.paintNow();
    return true;
  }
  function roomKey(rec) { return Math.round(rec.approach.x * 10) + ":" + Math.round(rec.approach.z * 10) + ":" + Math.round(rec.floorY * 10); }

  // ---- the phone ----------------------------------------------------------
  const INK = 0x1b1e23, INK2 = 0x2a2e35;
  // The handset rests on the old brass bar (0.38 x 0.10, top 0.26 over the
  // desk, 3 cm toward the door). HS_Y is its resting centre.
  const HS_Y = 0.288, HS_Z = -0.03;
  function buildPhone(desk, at) {
    const ph = new THREE.Group();
    ph.position.set(at.x, 0, at.z);
    desk.add(ph);
    // the console: a squared secure-line set, 1 cm proud of the old box on
    // every side so none of its faces is ever coplanar with ours
    box(ph, 0, 0.0925, 0, 0.50, 0.185, 0.30, INK);
    box(ph, 0, 0.004, 0, 0.52, 0.008, 0.32, 0x101215);                  // felt foot, a shadow line on the wood
    box(ph, 0, 0.12, 0.1505, 0.46, 0.09, 0.002, 0x24282e);              // a darker front fascia
    // the keypad, on the top face in front of the handset rest
    const pad = new THREE.Group();
    pad.position.set(0, 0.185, 0.085);
    ph.add(pad);
    box(pad, 0, 0.006, 0, 0.44, 0.012, 0.10, INK2);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)             // dial keys
      box(pad, -0.17 + c * 0.028, 0.014, -0.028 + r * 0.026, 0.020, 0.005, 0.018, 0xd9dad6);
    for (let i = 0; i < 6; i++)                                         // the line buttons, one per office
      box(pad, -0.045 + i * 0.034, 0.014, -0.022, 0.026, 0.006, 0.020, i === 0 ? 0xc9b37a : 0x8a9099);
    for (let i = 0; i < 6; i++)                                         // their paper name strips
      box(pad, -0.045 + i * 0.034, 0.0125, 0.012, 0.028, 0.002, 0.018, 0xe8e2cf);
    ROOM.lampOff = mat(0x4a1512);
    ROOM.lampOn = mat(0xff3322, { emissive: 0xff2210, ei: 1.0 });
    ROOM.lamp = box(pad, 0.185, 0.015, -0.02, 0.018, 0.008, 0.018, 0x4a1512);
    ROOM.lamp.material = ROOM.lampOff;
    const hs = buildHandset();
    hs.position.set(0, HS_Y, HS_Z);
    ph.add(hs);
    ROOM.phone = ph; ROOM.handset = hs;
    ROOM.handsetHome = { parent: ph, x: 0, y: HS_Y, z: HS_Z };
  }
  function buildHandset() {
    const hs = new THREE.Group();
    box(hs, 0, 0, 0, 0.19, 0.028, 0.042, INK);                          // the grip
    for (const s of [-1, 1]) box(hs, s * 0.092, -0.010, 0, 0.052, 0.034, 0.058, INK);   // ear + mouth cups
    return hs;
  }

  // ---- the in-tray: the day's folders, over the old brass slab --------------
  const PILE_Y = 0.106;                  // the slab's top (0.105) plus a millimetre
  function buildInTray(desk, at) {
    const t = new THREE.Group();
    t.position.set(at.x, 0, at.z);
    desk.add(t);
    const W = 0.66, D = 0.46, H = 0.13, WOOD = 0x3b2618;
    // four walls to the desk top: the slab's floating underside is inside them
    box(t, -W / 2 + 0.006, H / 2, 0, 0.012, H, D, WOOD);
    box(t, W / 2 - 0.006, H / 2, 0, 0.012, H, D, WOOD);
    box(t, 0, H / 2, -D / 2 + 0.006, W - 0.024, H, 0.012, WOOD);
    box(t, 0, H / 2, D / 2 - 0.006, W - 0.024, H, 0.012, WOOD);
    box(t, 0, H + 0.004, D / 2 - 0.006, W, 0.008, 0.016, 0x8a6a2e);   // brass edge on the lip you reach over
  }

  // ---- the out-tray -------------------------------------------------------
  function buildTray(desk, at) {
    const t = new THREE.Group();
    t.position.set(at.x, 0, at.z);
    desk.add(t);
    const W = 0.27, D = 0.34, WOOD = 0x3b2618;
    box(t, 0, 0.006, 0, W, 0.012, D, WOOD);
    box(t, -W / 2 + 0.006, 0.028, 0, 0.012, 0.044, D, WOOD);
    box(t, W / 2 - 0.006, 0.028, 0, 0.012, 0.044, D, WOOD);
    box(t, 0, 0.028, -D / 2 + 0.006, W - 0.024, 0.044, 0.012, WOOD);
    box(t, 0, 0.018, D / 2 - 0.006, W - 0.024, 0.024, 0.012, WOOD);    // low front lip, so you see what is in it
    ROOM.tray = t;
  }

  // ---- the television -----------------------------------------------------
  // THE ONE SET (city/newsroom.js tvSet): a 2 m wall-hung panel on its
  // bracket. `at` is the wall point; the old set faced the room along its
  // local -x, so the group turns a further -90 degrees to face +z that way.
  function buildTV(grp, at) {
    const N = CBZ.news;
    if (!N || !N.tvSet) return;
    const tv = N.tvSet({ w: 1.92, mount: "wall" });
    const d = tv.userData.tv.depth;
    const yaw = (at.yaw || 0) - Math.PI / 2;
    tv.position.set(at.x + Math.sin(yaw) * d, at.y, at.z + Math.cos(yaw) * d);
    tv.rotation.y = yaw;
    grp.add(tv);
    ROOM.tv = tv;
  }

  // ============================================================
  //  §3  PAPER. Canvas painters for the folder cover, the routing slip and
  //  the memo. Painted once per change, never per frame.
  // ============================================================
  const KIND = {
    security: { cover: 0x7a1f1f, css: "#7a1f1f", stamp: "EYES ONLY", tab: "SECURITY" },
    economy:  { cover: 0x1f3d6e, css: "#1f3d6e", stamp: "CONFIDENTIAL", tab: "ECONOMY" },
    people:   { cover: 0x2a5a36, css: "#2a5a36", stamp: "FOR ACTION", tab: "THE PEOPLE" },
  };
  function kindOf(m) { return KIND[m.kind] ? m.kind : "people"; }
  function wrap(ctx, text, x, y, maxW, lh, maxLines) {
    const words = String(text || "").split(/\s+/);
    let line = "", n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y); y += lh; n++; line = words[i];
        if (maxLines && n >= maxLines) return y;
      } else line = test;
    }
    if (line) { ctx.fillText(line, x, y); y += lh; }
    return y;
  }
  function stampBox(ctx, text, cx, cy, rot, color, size) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.font = "bold " + size + "px 'Courier New', monospace";
    const w = ctx.measureText(text).width + size * 0.9, h = size * 1.5;
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }
  function paintCover(f) {
    const m = f.m, K = KIND[kindOf(m)];
    const cv = f.coverCv || (f.coverCv = makeCanvas(256, 340));
    const c = cv.getContext("2d");
    c.fillStyle = K.css; c.fillRect(0, 0, 256, 340);
    // cloth grain
    c.globalAlpha = 0.08; c.fillStyle = "#000";
    for (let y = 0; y < 340; y += 3) c.fillRect(0, y, 256, 1);
    c.globalAlpha = 1;
    // the typed label
    c.fillStyle = "#efe9d8"; c.fillRect(34, 40, 188, 104);
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 2; c.strokeRect(34, 40, 188, 104);
    c.fillStyle = "#1c1c1c"; c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "bold 15px 'Courier New', monospace";
    wrap(c, clean(m.memo.dept || m.who.role).toUpperCase(), 44, 62, 170, 17, 2);
    c.font = "14px 'Courier New', monospace";
    c.fillText("DAY " + f.day, 44, 100);
    c.font = "bold 13px 'Courier New', monospace";
    wrap(c, clean(m.memo.subject).toUpperCase(), 44, 120, 170, 15, 2);
    stampBox(c, K.stamp, 128, 232, -0.12, "#e8d9b0", 22);
    if (f.state === "signed") stampBox(c, "SIGNED", 128, 296, 0.08, "#f2f2f2", 18);
    if (f.state === "returned") stampBox(c, "RETURNED", 128, 296, 0.08, "#f2f2f2", 18);
    if (f.coverTex) f.coverTex.needsUpdate = true; else f.coverTex = canvasTex(cv);
  }
  function paintSlip(f) {
    const m = f.m, K = KIND[kindOf(m)];
    const cv = f.slipCv || (f.slipCv = makeCanvas(256, 340));
    const c = cv.getContext("2d");
    c.fillStyle = "#e9e3d2"; c.fillRect(0, 0, 256, 340);
    c.fillStyle = K.css; c.fillRect(0, 0, 256, 10);
    c.fillStyle = "#222"; c.textAlign = "left";
    c.font = "bold 16px 'Courier New', monospace";
    c.fillText("ROUTING SLIP", 22, 44);
    c.font = "13px 'Courier New', monospace";
    const rows = [["FROM", m.memo.dept || ""], ["TO", "The President"], ["DAY", String(f.day)], ["FILE", K.tab]];
    let y = 78;
    for (let i = 0; i < rows.length; i++) {
      c.fillText(rows[i][0], 22, y);
      c.fillText(clean(rows[i][1]).slice(0, 20), 88, y);
      c.strokeStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.moveTo(86, y + 5); c.lineTo(236, y + 5); c.stroke();
      y += 30;
    }
    c.fillText("ACTION", 22, y + 12);
    const acts = ["Signature", "Comment", "File"];
    for (let i = 0; i < acts.length; i++) {
      const yy = y + 40 + i * 26;
      c.strokeStyle = "#333"; c.lineWidth = 1.5; c.strokeRect(24, yy - 12, 14, 14);
      if (i === 0) { c.beginPath(); c.moveTo(26, yy - 5); c.lineTo(31, yy); c.lineTo(38, yy - 12); c.stroke(); }
      c.fillText(acts[i], 48, yy);
    }
    stampBox(c, K.stamp, 128, 312, -0.05, "#a3261d", 17);
    if (f.slipTex) f.slipTex.needsUpdate = true; else f.slipTex = canvasTex(cv);
  }
  const MW = 512, MH = 683;
  function paintMemo(f) {
    const m = f.m, K = KIND[kindOf(m)];
    const cv = f.memoCv || (f.memoCv = makeCanvas(MW, MH));
    const c = cv.getContext("2d");
    c.fillStyle = "#f6f3ea"; c.fillRect(0, 0, MW, MH);
    c.fillStyle = "rgba(0,0,0,.035)";                  // faint paper tooth
    for (let y = 0; y < MH; y += 4) c.fillRect(0, y, MW, 1);
    c.fillStyle = "#1a1a1a"; c.textAlign = "center";
    c.font = "bold 26px 'Courier New', monospace";
    c.fillText("MEMORANDUM", MW / 2, 50);
    c.font = "bold 15px 'Courier New', monospace";
    c.fillStyle = "#a3261d";
    c.fillText(K.stamp, MW / 2, 74);
    c.fillStyle = "#1a1a1a"; c.textAlign = "left";
    c.font = "19px 'Courier New', monospace";
    const hdr = [
      ["FROM:", speaker(m.who, false) + ", " + (m.memo.dept || "")],
      ["TO:", "The President"],
      ["DATE:", "Day " + f.day],
      ["SUBJECT:", m.memo.subject],
    ];
    let y = 112;
    for (let i = 0; i < hdr.length; i++) {
      c.font = "bold 19px 'Courier New', monospace";
      c.fillText(hdr[i][0], 28, y);
      c.font = "19px 'Courier New', monospace";
      y = wrap(c, clean(hdr[i][1]), 138, y, MW - 160, 23, 2) + 4;
    }
    c.strokeStyle = "#1a1a1a"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(28, y); c.lineTo(MW - 28, y); c.stroke();
    y += 32;
    c.font = "19px 'Courier New', monospace";
    const body = m.memo.body || [];
    for (let i = 0; i < body.length && y < 500; i++) y = wrap(c, clean(body[i]), 28, y, MW - 56, 24, 4) + 8;
    y += 6;
    c.font = "bold 19px 'Courier New', monospace";
    c.fillText("RECOMMENDATION:", 28, y); y += 25;
    c.font = "19px 'Courier New', monospace";
    y = wrap(c, clean(m.memo.rec || m.yes.label), 28, y, MW - 56, 24, 3);
    // the signature block
    const sy = MH - 70;
    c.strokeStyle = "#333"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(28, sy); c.lineTo(290, sy); c.stroke();
    c.font = "15px 'Courier New', monospace"; c.fillStyle = "#333";
    c.fillText("Signed, the President", 28, sy + 22);
    if (f.blocked && (f.state === "closed" || f.state === "open")) {
      // a yellow note stuck on the page: why this cannot be signed today
      c.save();
      c.translate(360, 560); c.rotate(0.05);
      c.fillStyle = "#f3e27a"; c.fillRect(-120, -70, 240, 140);
      c.fillStyle = "rgba(0,0,0,.12)"; c.fillRect(-120, 62, 240, 8);
      c.fillStyle = "#2b2b6b"; c.font = "italic 17px Georgia, serif"; c.textAlign = "left";
      wrap(c, clean(f.blocked), -108, -40, 216, 21, 5);
      c.restore();
    }
    if (f.state === "signed") {
      signature(c, 44, sy - 12, strHash(m.id));
      stampBox(c, f.failed ? "NOT EXECUTED" : "APPROVED", 380, sy - 40, -0.18, "#b0241b", 30);
      if (f.failed) {
        c.save(); c.fillStyle = "#b0241b"; c.font = "italic 16px Georgia, serif";
        wrap(c, clean(f.failed), 300, sy + 6, 190, 18, 3); c.restore();
      }
    } else if (f.state === "returned") {
      stampBox(c, "RETURNED", 380, sy - 40, -0.18, "#1d3f8a", 30);
    }
    if (f.memoTex) f.memoTex.needsUpdate = true; else f.memoTex = canvasTex(cv);
  }
  // a fast, confident scrawl in blue-black ink, the same hand every time
  function signature(c, x, y, seed) {
    let s = seed || 1;
    function r() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    c.save();
    c.strokeStyle = "#1c2a6b"; c.lineWidth = 3.2; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(x, y);
    let px = x, py = y;
    for (let i = 0; i < 9; i++) {
      const nx = px + 18 + r() * 16, ny = y + (r() - 0.5) * 30;
      c.bezierCurveTo(px + 6, py - 26 * r(), nx - 8, ny + 26 * r(), nx, ny);
      px = nx; py = ny;
    }
    c.stroke();
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(x - 6, y + 12); c.quadraticCurveTo(x + 110, y + 24, px + 16, y + 4); c.stroke();
    c.restore();
  }

  // ---- folder meshes --------------------------------------------------------
  const FW = 0.235, FD = 0.31, FT = 0.012;
  function closedMesh(f) {
    if (!f.coverTex) paintCover(f);
    const grp = new THREE.Group();
    box(grp, 0, FT / 2, 0, FW, FT, FD, KIND[kindOf(f.m)].cover);
    // the paper inside, a pale edge on the open side
    box(grp, -0.002, FT / 2, 0, FW - 0.008, FT - 0.005, FD - 0.006, 0xeeeae0);
    const lab = planeFlat(FW - 0.01, FD - 0.01, f.coverTex, true);
    lab.position.y = FT + 0.002;
    grp.add(lab);
    return grp;
  }
  function openMesh(f) {
    if (!f.memoTex) paintMemo(f);
    if (!f.slipTex) paintSlip(f);
    const grp = new THREE.Group();
    box(grp, 0, 0.002, 0, FW * 2, 0.004, FD, KIND[kindOf(f.m)].cover);           // the spread cover
    box(grp, FW / 2, 0.0055, 0, FW - 0.012, 0.003, FD - 0.012, 0xeeeae0);         // the stack of pages
    const slip = planeFlat(FW - 0.02, FD - 0.02, f.slipTex, true);
    slip.position.set(-FW / 2, 0.0065, 0);
    grp.add(slip);
    const page = planeFlat(FW - 0.014, FD - 0.014, f.memoTex, true);
    page.position.set(FW / 2, 0.0095, 0);
    grp.add(page);
    return grp;
  }
  function layoutFolders() {
    if (!ROOM.desk || !ROOM.L) return;
    for (let i = 0; i < M.folders.length; i++) {
      const f = M.folders[i];
      if (f.mesh) { disposeMesh(f.mesh); f.mesh = null; }
    }
    const L = ROOM.L;
    let pileN = 0, trayN = 0;
    // pile: most urgent on top (security, economy, people), so the order you
    // open them in is the order they are stacked in
    const order = M.folders.slice().sort(function (a, b) { return rank(b) - rank(a); });
    for (let i = 0; i < order.length; i++) {
      const f = order[i];
      if (f.state === "open") {
        const m = openMesh(f);
        m.position.set(L.open.x, 0.0, L.open.z);
        ROOM.desk.add(m); f.mesh = m;
      } else if (f.state === "closed") {
        const m = closedMesh(f);
        const j = (h01(i, strHash(f.m.id), 311) - 0.5) * 0.12;
        m.position.set(L.pile.x + j * 0.3, PILE_Y + pileN * (FT + 0.001), L.pile.z + j * 0.2);
        m.rotation.y = j;
        ROOM.desk.add(m); f.mesh = m; pileN++;
      } else if (f.state === "signed" || f.state === "returned") {
        const m = closedMesh(f);
        m.position.set(L.tray.x, 0.012 + trayN * (FT + 0.001), L.tray.z);
        m.rotation.y = (h01(trayN, 7, 97) - 0.5) * 0.08;
        m.scale.set(0.98, 1, 0.98);                 // inside the tray lips
        ROOM.desk.add(m); f.mesh = m; trayN++;
      }
    }
  }
  function rank(f) { const k = kindOf(f.m); return k === "security" ? 3 : k === "economy" ? 2 : 1; }
  function deskWorld(lx, ly, lz) {
    if (!ROOM.desk) return null;
    const v = new THREE.Vector3(lx, ly, lz);
    ROOM.desk.updateMatrixWorld(true);
    ROOM.desk.localToWorld(v);
    return v;
  }

  // ============================================================
  //  §4  THE MATTERS ENGINE.
  //
  //  offer(matter) — matter = {
  //    id, who:{name, role}, via:"phone"|"aide"|"folder"|"any", topic,
  //    line,                      what the person says (phone/aide)
  //    memo?: {dept, subject, body:[...], rec}   what the page says (folder)
  //    kind?: "security"|"economy"|"people"        folder colour
  //    yes: {label, order?, run?(result), reply?}, no: {label, run?(), reply?},
  //    expires (seconds), ifIgnored?(), missedLine?, cant?(why)
  //  }
  // ============================================================
  const M = {
    seq: 0, phoneQ: [], ringing: null, ringT: 0, nextBurst: 0, onCall: null, lastCallEnd: -1e9,
    holdUntil: 0, missed: [], folders: [], folderDay: -1, aideQ: [], later: [],
    flags: {}, counts: { attacks: 0, protests: 0 }, morningDay: -1, approvalMorning: null,
    decisions: 0, wired: false,
  };

  function normalize(m) {
    if (!m || !m.who || !(m.line || m.memo)) return null;
    m.id = m.id || ("matter" + (++M.seq));
    m.topic = m.topic || "matter";
    m.via = m.via || "any";
    m.expires = (m.expires > 0) ? m.expires : 150;
    m.born = CLOCK;
    m.yes = m.yes || { label: "Do it." };
    m.no = m.no || { label: "Not now." };
    m.who = { name: String(m.who.name || "An aide"), role: m.who.role || "aide" };
    if (!m.kind) m.kind = /wall|cell|attack|raid|curfew|surge|martial|guard|crackdown|security|emergency/.test(m.topic) ? "security"
      : /tax|treasury|budget|police|economy|aid/.test(m.topic) ? "economy" : "people";
    if (!m.memo) m.memo = { dept: m.who.role, subject: m.topic, body: [m.line], rec: m.yes.label };
    if (!m.line) m.line = (m.memo.body || []).join(" ");
    return m;
  }
  function openIds() {
    const s = {};
    for (let i = 0; i < M.phoneQ.length; i++) s[M.phoneQ[i].id] = 1;
    for (let i = 0; i < M.aideQ.length; i++) s[M.aideQ[i].id] = 1;
    for (let i = 0; i < M.folders.length; i++) if (M.folders[i].state === "closed" || M.folders[i].state === "open") s[M.folders[i].m.id] = 1;
    if (M.ringing) s[M.ringing.id] = 1;
    if (M.onCall) s[M.onCall.id] = 1;
    if (AIDE.m) s[AIDE.m.id] = 1;
    return s;
  }
  function liveFolders() { let n = 0; for (let i = 0; i < M.folders.length; i++) if (M.folders[i].state === "closed" || M.folders[i].state === "open") n++; return n; }
  // WHO SITS IN THE CHAIRS DECIDES WHAT REACHES YOU (city/president_staff.js):
  // an empty chair calls nobody; without a Chief nobody makes up folders, so
  // it all comes down the phone; a loyal Chief screens (two folders at most,
  // nobody sour gets through); a good one lets everything in.
  function staffSays(m) {
    const PS = CBZ.presidentStaff;
    if (!PS || !PS.vacant) return { ok: true };
    const role = m.who.role;
    try {
      if (/^(chief|general|bureau|police|treasury|press)$/.test(role) && PS.vacant(role)) return { ok: false };
      const style = PS.chiefStyle ? PS.chiefStyle() : "normal";
      if (style === "none") return { ok: true, phone: m.via === "folder" || m.via === "any" };
      if (style === "screen" && !m.urgent) {
        if (PS.loyalty && /^(general|bureau|police|treasury)$/.test(role) && PS.loyalty(role) < 40) return { ok: false };
        if (m.via !== "phone" && liveFolders() >= 2) return { ok: false };
      }
    } catch (e) {}
    return { ok: true };
  }
  function offer(matter) {
    if (!seated()) return null;
    const m = normalize(matter);
    if (!m) return null;
    if (openIds()[m.id]) return m.id;
    const gate = staffSays(m);
    if (!gate.ok) return null;
    let via = gate.phone ? "phone" : m.via;
    if (via === "any") via = (m.urgent || m.expires < 60) ? "aide" : (liveFolders() < FOLDERS_MAX ? "folder" : "phone");
    if (via === "folder" && M.folders.length >= FOLDERS_MAX + 1) via = "phone";
    m.channel = via;
    if (via === "folder") addFolder(m);
    else if (via === "aide") M.aideQ.push(m);
    else M.phoneQ.push(m);
    return m.id;
  }

  // one decision, whatever channel carried it
  function decide(m, choice, source) {
    let r = { ok: true, why: "" };
    if (choice === "yes") {
      if (m.yes.order) r = press(m.yes.order);
      if (m.yes.run) { try { m.yes.run(r); } catch (e) {} }
    } else if (choice === "no") {
      if (m.no.run) { try { m.no.run(); } catch (e) {} }
    }
    M.decisions++;
    // the one political model hears the answer you gave the person who asked
    const PM = CBZ.politics;
    if (PM && typeof PM.act === "function") {
      try { PM.act("decision", { target: null, by: "president", ideology: null, institution: null, topic: m.topic, choice: choice, order: choice === "yes" ? (m.yes.order || null) : null, who: m.who.role }); } catch (e) {}
    }
    emit("decision", { source: source, topic: m.topic, choice: choice, order: choice === "yes" ? (m.yes.order || null) : null, ok: !!r.ok, who: m.who.name, id: m.id });
    return r;
  }
  function ignore(m, source) {
    if (m.ifIgnored) { try { m.ifIgnored(); } catch (e) {} }
    emit("decision", { source: source, topic: m.topic, choice: "ignored", order: null, who: m.who.name, id: m.id });
    if (source !== "folder" && m.topic !== "schedule") M.missed.push(m);
    if (M.missed.length > 4) M.missed.shift();
  }
  // "the caller says why, in his own words"
  const CANT = {
    general: "One problem, sir.", bureau: "Not yet, sir.", treasury: "I have to be straight with you.",
    police: "My hands are tied, sir.", chief: "It won't go through today.", whip: "Here's the trouble.",
    press: "We can't, not today.", foreign: "I understand it may not be possible.", aide: "Sir, there's a problem.",
  };
  function cantLine(m, why) {
    if (m.cant) { try { return clean(m.cant(why)); } catch (e) {} }
    why = clean(why);
    if (!why) return "It can't be done today.";
    return (CANT[m.who.role] || "There's a snag.") + " " + why;
  }

  // talk to a person (phone or face to face) and resolve the matter
  function converse(m, source, onDone) {
    ++SAY_TOKEN;                         // a pending "clear the last reply" must not eat this conversation
    const phone = source === "phone";
    const who = speaker(m.who, phone);
    const gate = m.yes.order ? btn(m.yes.order) : { ok: true };
    let line = clean(m.line), choices;
    if (gate.ok) choices = [{ id: "yes", label: clean(m.yes.label) }, { id: "no", label: clean(m.no.label) }];
    else { line += " " + cantLine(m, gate.why); choices = [{ id: "no", label: clean(m.no.label) }]; }
    // who is talking, in the world: the voice on the line, or the aide at the desk
    const by = phone ? "phone" : (AIDE.ped && !AIDE.ped.dead ? AIDE.ped : null);
    // the answers ride on the man who asked, or on the handset in your hand
    // (campaign_ui.js pins them in the verb registry: E, hold E, the wheel)
    const meta = by === "phone" ? { phone: true, at: phoneWorld() } : { actor: by };
    const UI = CBZ.campaignUI;
    if (!UI || !UI.say || !by) { ignore(m, source); if (onDone) onDone(null); return; }
    const tok0 = SAY_TOKEN;
    const ask = function (last) {
      if (tok0 !== SAY_TOKEN) return;          // another conversation took over
      let pr = null;
      try { pr = UI.say(who, last, choices, meta); } catch (e) { pr = null; }
      if (!pr || !pr.then) { ignore(m, source); if (onDone) onDone(null); return; }
      pr.then(answered);
    };
    // he says it in breaths; the last one lands on the reply buttons
    if (CBZ.sayThen) CBZ.sayThen(by, line, ask); else ask(line);
    function answered(pick) {
      let reply = null;
      if (pick === "yes") {
        const r = decide(m, "yes", source);
        reply = r.ok ? (m.yes.reply || "Understood. It's done.") : cantLine(m, r.why);
      } else if (pick === "no") {
        decide(m, "no", source);
        reply = m.no.reply || "Understood, sir.";
      } else {
        ignore(m, source);
      }
      if (reply) {
        try { UI.say(who, clean(reply), meta); } catch (e) {}
        const tok = ++SAY_TOKEN;
        M.later.push({ at: CLOCK + 3.4, fn: function () { if (tok === SAY_TOKEN) clearSay(); } });
      }
      if (onDone) onDone(pick);
    }
  }
  let SAY_TOKEN = 0;
  function clearSay() { const UI = CBZ.campaignUI; if (UI && UI.clearDialogue) { try { UI.clearDialogue(); } catch (e) {} } }

  // ============================================================
  //  §5  THE PHONE.
  // ============================================================
  function phoneWorld() {
    if (!ROOM.phone) return null;
    const v = new THREE.Vector3();
    ROOM.phone.getWorldPosition(v);
    return v;
  }
  function tickPhone(dt) {
    // queue upkeep: a matter that waited past its life is decided without you
    for (let i = M.phoneQ.length - 1; i >= 0; i--) {
      const m = M.phoneQ[i];
      if (CLOCK - m.born > m.expires) { M.phoneQ.splice(i, 1); ignore(m, "phone"); }
    }
    const rec = ROOM.rec;
    if (M.ringing) {
      M.ringT += dt;
      if (M.ringT > RING_SECS) {
        const m = M.ringing;
        M.ringing = null; M.lastCallEnd = CLOCK;
        ignore(m, "phone");
      } else if (CLOCK >= M.nextBurst) {
        M.nextBurst = CLOCK + RING_PERIOD;
        ringBurst();
      }
    } else if (!M.onCall && M.phoneQ.length && rec && ROOM.phone && CLOCK - M.lastCallEnd >= CALL_GAP &&
               CLOCK >= M.holdUntil && inOffice(rec) && !READ.f && !AIDE.talking) {
      M.ringing = M.phoneQ.shift();
      M.ringT = 0; M.nextBurst = CLOCK + 0.2;
    }
    // the lamp and the rattle
    const on = !!M.ringing && (Math.floor(CLOCK * 2.5) % 2 === 0);
    if (ROOM.lamp) ROOM.lamp.material = (on || M.onCall) ? ROOM.lampOn : ROOM.lampOff;
    const hs = ROOM.handset;
    if (hs && hs.parent === ROOM.phone) {
      const burst = M.ringing && ((CLOCK - (M.nextBurst - RING_PERIOD)) < 1.1);
      if (burst) {
        hs.position.y = HS_Y + Math.abs(Math.sin(CLOCK * 55)) * 0.004;
        hs.rotation.z = Math.sin(CLOCK * 47) * 0.035;
      } else { hs.position.y = HS_Y; hs.rotation.z = 0; }
    }
    if (M.onCall && hs && hs.parent !== ROOM.phone) earHandset(hs);
  }
  function answer() {
    const m = M.ringing;
    if (!m) return;
    M.ringing = null; M.onCall = m;
    if (CBZ.sfx) { try { CBZ.sfx("switch", { vol: 0.5 }); } catch (e) {} }
    liftHandset();
    converse(m, "phone", function () {
      M.later.push({ at: CLOCK + 3.0, fn: function () { hangUp(); } });
    });
  }
  // THE PHONE IN YOUR POCKET (city/phone.js). Away from the desk, the call
  // that is waiting rings the President's own phone instead: the same matter,
  // the same decide(), the same "he says why". In the office the desk keeps it.
  function cellCall() {
    if (!seated() || M.ringing || M.onCall || !M.phoneQ.length) return null;
    if (CLOCK - M.lastCallEnd < CALL_GAP) return null;
    const rec = ROOM.rec || office();
    if (rec && inOffice(rec)) return null;
    const m = M.phoneQ.shift();
    const gate = m.yes.order ? btn(m.yes.order) : { ok: true };
    let line = clean(m.line);
    const choices = gate.ok ? [{ id: "yes", label: clean(m.yes.label) }, { id: "no", label: clean(m.no.label) }]
      : [{ id: "no", label: clean(m.no.label) }];
    if (!gate.ok) line += " " + cantLine(m, gate.why);
    let done = false;
    return {
      id: m.id, name: m.who.name, role: m.who.role, title: speaker(m.who, false), line: line, choices: choices,
      answer: function (pick) {
        if (done) return null;
        done = true; M.lastCallEnd = CLOCK;
        if (pick === "yes") {
          const r = decide(m, "yes", "cell");
          return clean(r.ok ? (m.yes.reply || "Understood. It's done.") : cantLine(m, r.why));
        }
        decide(m, "no", "cell");
        return clean(m.no.reply || "Understood, sir.");
      },
      ignore: function () { if (done) return; done = true; M.lastCallEnd = CLOCK; ignore(m, "phone"); },
    };
  }
  function hangUp() {
    M.onCall = null; M.lastCallEnd = CLOCK;
    const hs = ROOM.handset, home = ROOM.handsetHome;
    if (hs && home && home.parent) {
      if (hs.parent) hs.parent.remove(hs);
      home.parent.add(hs);
      hs.position.set(home.x, home.y, home.z);
      hs.rotation.set(0, 0, 0);
      if (CBZ.sfx) { try { CBZ.sfx("switch", { vol: 0.4 }); } catch (e) {} }
    }
  }
  function liftHandset() {
    const hs = ROOM.handset, root = ROOM.root;
    if (!hs || !root) return;
    if (hs.parent) hs.parent.remove(hs);
    root.add(hs);
    earHandset(hs);
  }
  const _ear = new THREE.Vector3();
  function earHandset(hs) {
    const Pp = player(), ch = CBZ.playerChar;
    if (!Pp || !Pp.pos || !ROOM.root) return;
    const yaw = (ch && ch.group) ? ch.group.rotation.y : 0;
    const sit = !!(ch && ch.sitting);
    const base = (ch && ch.group) ? ch.group.position : Pp.pos;
    // right side of the head, a hand's width off the cheek
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    _ear.set(base.x + rx * 0.13 + Math.sin(yaw) * 0.04, base.y + (sit ? 1.18 : 1.58), base.z + rz * 0.13 + Math.cos(yaw) * 0.04);
    ROOM.root.updateMatrixWorld(true);
    ROOM.root.worldToLocal(_ear);
    hs.position.copy(_ear);
    hs.rotation.set(0, yaw - ROOM.root.rotation.y - Math.PI / 2, -1.1);   // grip along the jaw, mouthpiece low and forward
  }

  // A desk phone's electronic trill, synthesized: two tones alternating at
  // 20 Hz for a second, loud near the desk and gone at the far end of the
  // floor. No bank cue fits; audio.js exposes its context for exactly this.
  function ringBurst() {
    const ctx = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
    if (!ctx || ctx.state !== "running") return;
    const Pp = player(), w = phoneWorld();
    if (!Pp || !Pp.pos || !w) return;
    if (Math.abs(Pp.pos.y - w.y) > 3.5) return;
    const d = Math.hypot(Pp.pos.x - w.x, Pp.pos.z - w.z);
    const vol = 0.085 * Math.max(0, 1 - d / 34);
    if (vol < 0.004) return;
    try {
      const t = ctx.currentTime + 0.02;
      const osc = ctx.createOscillator(), gn = ctx.createGain(), lp = ctx.createBiquadFilter();
      osc.type = "square";
      lp.type = "lowpass"; lp.frequency.value = 3200;
      for (let i = 0; i < 20; i++) osc.frequency.setValueAtTime(i % 2 ? 1320 : 1060, t + i * 0.05);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      gn.gain.setValueAtTime(vol, t + 0.96);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.02);
      osc.connect(lp); lp.connect(gn); gn.connect(ctx.destination);
      osc.start(t); osc.stop(t + 1.05);
    } catch (e) {}
  }

  // ============================================================
  //  §6  THE FOLDERS.
  // ============================================================
  function addFolder(m) {
    const f = { m: m, state: "closed", day: day(), mesh: null, blocked: null, failed: null };
    M.folders.push(f);
    refreshBlocked(f);
    paintCover(f);
    layoutFolders();
    return f;
  }
  function refreshBlocked(f) {
    const was = f.blocked;
    if (f.state !== "closed" && f.state !== "open") return;
    const gate = f.m.yes.order ? btn(f.m.yes.order) : { ok: true };
    f.blocked = gate.ok ? null : (cantLine(f.m, gate.why));
    if (was !== f.blocked && f.memoCv) paintMemo(f);
  }
  function topFolder() {
    let best = null;
    for (let i = 0; i < M.folders.length; i++) {
      const f = M.folders[i];
      if (f.state !== "closed") continue;
      if (!best || rank(f) > rank(best)) best = f;
    }
    return best;
  }
  function openFolder(f) {
    if (!f || READ.f) return;
    refreshBlocked(f);
    f.state = "open";
    paintMemo(f);
    layoutFolders();
    if (CBZ.sfx) { try { CBZ.sfx("pickup", { vol: 0.35 }); } catch (e) {} }
    startReading(f);
  }
  function signFolder() {
    const f = READ.f;
    if (!f || f.state !== "open") return;
    refreshBlocked(f);
    if (f.blocked) return;
    const r = decide(f.m, "yes", "folder");
    f.state = "signed";
    f.failed = r.ok ? null : (r.why ? cantLine(f.m, r.why) : "The order did not go through.");
    paintMemo(f);
    if (CBZ.sfx) { try { CBZ.sfx("key", { vol: 0.35 }); } catch (e) {} }
    closeLater(f);
  }
  function returnFolder() {
    const f = READ.f;
    if (!f || f.state !== "open") return;
    decide(f.m, "no", "folder");
    f.state = "returned";
    paintMemo(f);
    closeLater(f);
  }
  function shutFolder() {       // close it back onto the pile, undecided
    const f = READ.f;
    if (!f) return;
    f.state = "closed";
    endReading(false);
    layoutFolders();
  }
  function closeLater(f) {
    READ.closing = true;
    M.later.push({ at: CLOCK + 1.5, fn: function () {
      if (READ.f === f) endReading(false);
      paintCover(f);
      layoutFolders();
    } });
  }
  // the day's close: whatever was never signed is its own consequence
  function closeFolderDay() {
    const keep = [];
    for (let i = 0; i < M.folders.length; i++) {
      const f = M.folders[i];
      if (f.state === "closed" || f.state === "open") {
        if (READ.f === f) endReading(true);
        ignore(f.m, "folder");
        M.flags.unsigned = (M.flags.unsigned | 0) + 1;
      }
      if (f.mesh) { disposeMesh(f.mesh); f.mesh = null; }
      for (const k of ["coverTex", "slipTex", "memoTex"]) if (f[k]) { try { f[k].dispose(); } catch (e) {} }
    }
    M.folders = keep;
    layoutFolders();
  }

  // ---- reading: the camera leans over the page ------------------------------
  const READ = { f: null, t: 0, fpsWas: false, closing: false };
  function startReading(f) {
    READ.f = f; READ.t = 0; READ.closing = false;
    const L = ROOM.L;
    const page = deskWorld(L.open.x + 0.06, 0.01, L.open.z);
    const eye = deskWorld(L.open.x + 0.06, 0.45, L.open.z + 0.21);
    if (!page || !eye || !CBZ.cinePlay) return;     // no director: the page is still on the desk to be read
    let busy = false;
    try { busy = CBZ.cineBusy && CBZ.cineBusy(); } catch (e) {}
    if (busy) return;
    READ.fpsWas = !!(CBZ.fpsActive && CBZ.fpsActive());
    READ.cine = CBZ.cinePlay([{ cam: { pos: { x: eye.x, y: eye.y, z: eye.z }, look: { x: page.x, y: page.y, z: page.z } }, dur: 1e9 }],
      {}, function () {
        READ.cine = false;
        if (READ.fpsWas && CBZ.setFPS) { try { CBZ.setFPS(true); } catch (e) {} }
        // the scene ended from outside (death, mode change): put the folder down
        if (READ.f && READ.f.state === "open") { READ.f.state = "closed"; READ.f = null; layoutFolders(); }
      });
  }
  function endReading(quiet) {
    const f = READ.f;
    READ.f = null; READ.closing = false;
    if (READ.cine && CBZ.cineAbort) { READ.cine = false; try { CBZ.cineAbort(); } catch (e) {} }
    if (f && f.state === "open" && quiet) f.state = "closed";
  }

  // ============================================================
  //  §7  PEOPLE WHO WALK IN, and the secretary at the door.
  // ============================================================
  const AIDE = { ped: null, m: null, phase: null, t: 0, stuck: 0, lastD: Infinity, talking: false, spawnW: null, standW: null };
  const AIDE_JOB = {
    chief: { job: "chief of staff", archetype: "professional" },
    aide: { job: "military aide", archetype: "military" },
    general: { job: "military general", archetype: "military" },
    press: { job: "press secretary", archetype: "professional" },
  };
  function unpost(ped) {
    if (!ped || ped.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); return; } catch (e) {} }
    try {
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      const a = CBZ.cityPeds; if (a) { const i = a.indexOf(ped); if (i >= 0) a.splice(i, 1); }
    } catch (e) {}
  }
  function walkTo(p, x, z) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null;
    p.path = [{ x: x, z: z }]; p.finalGoal = { x: x, z: z };
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = "walk"; p.pause = 0;
  }
  function holdAt(p, face) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (face != null && p.group) p.group.rotation.y = face;
  }
  function place(p, x, z) {
    if (!p || !p.pos) return;
    p.pos.x = x; p.pos.z = z;
    if (p.group) { p.group.position.x = x; p.group.position.z = z; }
    if (p.target && p.target.set) p.target.set(x, 0, z);
  }
  function sendAide(m) {
    const rec = ROOM.rec, L = ROOM.L;
    if (!rec || !L || !CBZ.cityPostNpc) return false;
    const sp = toWorld(rec, L.aideSpawn.x, L.aideSpawn.z);
    const st = toWorld(rec, L.aideStand.x, L.aideStand.z);
    const J = AIDE_JOB[m.who.role] || AIDE_JOB.chief;
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(sp.x, sp.z, {
        job: J.job, archetype: J.archetype, armed: false, aggr: 0.02, wealth: 0.75,
        floorY: rec.floorY, face: Math.atan2(st.x - sp.x, st.z - sp.z), src: "presoffice:aide",
      });
    } catch (e) { ped = null; }
    if (!ped) return false;
    ped.name = m.who.name; ped.nameKnown = true; ped.organization = "state";
    ped._presOffice = true; ped._iOnly = true;
    // he came to see you: look at him (or tap him) and he says it now,
    // without waiting for him to reach the desk. No Talk verb: it is his line.
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      CBZ.interactions.registerFor(ped, { id: "pv-aide-hear", speak: true, speakCD: 4, prio: 30, campaignSafe: true, forceYes: true,
        label: "Talk",
        canShow: function () { return AIDE.ped === ped && !ped.dead && (AIDE.phase === "wait" || AIDE.phase === "enter") && !M.onCall && !READ.f; },
        onSelect: function () { aideTalk(); } });
    }
    AIDE.ped = ped; AIDE.m = m; AIDE.phase = "enter"; AIDE.t = 0; AIDE.stuck = 0; AIDE.lastD = Infinity;
    AIDE.spawnW = sp; AIDE.standW = st; AIDE.talking = false;
    walkTo(ped, st.x, st.z);
    return true;
  }
  function releaseAide(now) {
    if (AIDE.ped) unpost(AIDE.ped);
    if (AIDE.m && AIDE.phase !== "leave" && now) {
      // a person who never got to say it goes back in the queue
      M.aideQ.unshift(AIDE.m);
    }
    AIDE.ped = null; AIDE.m = null; AIDE.phase = null; AIDE.talking = false;
  }
  function tickAide(dt) {
    for (let i = M.aideQ.length - 1; i >= 0; i--) {
      const m = M.aideQ[i];
      if (CLOCK - m.born > m.expires) { M.aideQ.splice(i, 1); ignore(m, "aide"); }
    }
    const rec = ROOM.rec;
    if (!AIDE.ped) {
      if (M.aideQ.length && rec && inOffice(rec) && !READ.f && !M.onCall) {
        // urgent first
        M.aideQ.sort(function (a, b) { return (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0); });
        const m = M.aideQ.shift();
        if (!sendAide(m)) M.aideQ.unshift(m);
      }
      return;
    }
    const p = AIDE.ped;
    if (p.dead) { const m = AIDE.m; AIDE.ped = null; AIDE.m = null; AIDE.phase = null; if (m) ignore(m, "aide"); return; }
    AIDE.t += dt;
    const Pp = player();
    if (AIDE.phase === "enter") {
      const d = Math.hypot(p.pos.x - AIDE.standW.x, p.pos.z - AIDE.standW.z);
      if (d < 0.7) { AIDE.phase = "wait"; AIDE.t = 0; holdAt(p, faceTo(p, Pp)); return; }
      AIDE.stuck += dt;
      if (AIDE.lastD - d > 0.8) { AIDE.lastD = d; AIDE.stuck = 0; }
      if (AIDE.stuck > 7) { place(p, AIDE.standW.x, AIDE.standW.z); AIDE.stuck = 0; }
      if (p.state !== "walk") walkTo(p, AIDE.standW.x, AIDE.standW.z);
    } else if (AIDE.phase === "wait") {
      if (Pp && Pp.pos && p.group) p.group.rotation.y = faceTo(p, Pp);
      const near = Pp && Pp.pos && Math.abs(Pp.pos.y - rec.floorY) < 2.2 &&
        Math.hypot(Pp.pos.x - p.pos.x, Pp.pos.z - p.pos.z) < AIDE_TALK_R;
      if (near && !M.onCall && !READ.f) {
        aideTalk();
      } else if (AIDE.t > Math.max(40, AIDE.m.expires) || !inOffice(rec)) {
        // he waited; you were not there. What he came to say still happens.
        if (!inOffice(rec) && AIDE.t < 12) return;
        const m = AIDE.m;
        AIDE.m = null;
        ignore(m, "aide");
        AIDE.phase = "leave"; AIDE.t = 0;
        walkTo(p, AIDE.spawnW.x, AIDE.spawnW.z);
      }
    } else if (AIDE.phase === "leave") {
      const d = Math.hypot(p.pos.x - AIDE.spawnW.x, p.pos.z - AIDE.spawnW.z);
      AIDE.stuck += dt;
      if (AIDE.lastD - d > 0.8) { AIDE.lastD = d; AIDE.stuck = 0; }
      if (d < 1.0 || AIDE.t > 25 || AIDE.stuck > 7) { AIDE.m = null; unpost(p); AIDE.ped = null; AIDE.phase = null; }
      else if (p.state !== "walk") walkTo(p, AIDE.spawnW.x, AIDE.spawnW.z);
    }
  }
  // he says what he came to say; your answer rides on him (campaign_ui.js)
  function aideTalk() {
    if (!AIDE.ped || !AIDE.m || (AIDE.phase !== "wait" && AIDE.phase !== "enter")) return false;
    AIDE.phase = "talk"; AIDE.talking = true;
    holdAt(AIDE.ped, faceTo(AIDE.ped, player()));
    converse(AIDE.m, "aide", function () {
      AIDE.talking = false;
      M.later.push({ at: CLOCK + 2.6, fn: function () {
        if (!AIDE.ped || AIDE.phase !== "talk") return;
        AIDE.phase = "leave"; AIDE.t = 0; AIDE.stuck = 0; AIDE.lastD = Infinity;
        walkTo(AIDE.ped, AIDE.spawnW.x, AIDE.spawnW.z);
      } });
    });
    return true;
  }
  function faceTo(p, Pp) {
    if (!Pp || !Pp.pos || !p || !p.pos) return p && p.group ? p.group.rotation.y : 0;
    return Math.atan2(Pp.pos.x - p.pos.x, Pp.pos.z - p.pos.z);
  }

  // ---- the secretary -------------------------------------------------------
  const SEC = { ped: null, dead: false, lastLine: -1e9, tries: 0 };
  function postSecretary() {
    if (SEC.ped || SEC.dead || !ROOM.rec || !ROOM.L || !CBZ.cityPostNpc) return;
    if (++SEC.tries > 40) return;
    const rec = ROOM.rec, L = ROOM.L;
    const w = L.secPostW, look = L.secLookW;
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(w.x, w.z, {
        job: "secretary", archetype: "professional", gender: "f", armed: false, aggr: 0.02, wealth: 0.55,
        pin: true, floorY: rec.floorY, face: Math.atan2(look.x - w.x, look.z - w.z), src: "presoffice:secretary",
      });
    } catch (e) { ped = null; }
    if (!ped) return;
    ped.name = person("secretary").name; ped.nameKnown = true; ped.organization = "state";
    ped._iOnly = true;
    SEC.ped = ped;
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      // what is waiting for you, in one line, as you come up to her desk
      CBZ.interactions.registerFor(ped, { id: "pv-sec-talk", speak: true, prio: 30, campaignSafe: true, forceYes: true,
        label: "Talk", canShow: function () { return !ped.dead; },
        onSelect: function () { SEC.lastLine = CLOCK; if (CBZ.citySay) { try { CBZ.citySay(ped, secLine(), "#e8e2cf", 3.0); } catch (e) {} } } });
      // a call you missed: she puts the caller back on your line
      CBZ.interactions.registerFor(ped, { id: "pv-sec-call-back", hold: true, prio: 28, campaignSafe: true, forceYes: true,
        label: "Call back", canShow: function () { return !ped.dead && seated() && M.missed.length > 0 && !M.ringing && !M.onCall; },
        onSelect: function () {
          const m = M.missed.pop();
          if (!m) return;
          m.born = CLOCK; m.expires = Math.max(90, m.expires || 0);
          M.phoneQ.unshift(m);
          M.lastCallEnd = -1e9; M.holdUntil = 0;
          if (CBZ.citySay) { try { CBZ.citySay(ped, "Putting " + surname(m.who.name) + " through, sir.", "#e8e2cf", 2.6); } catch (e) {} }
        } });
    }
  }
  function secLine() {
    const live = liveFolders();
    if (!seated()) return "Can I help you?";
    if (M.ringing) return "Your line's ringing, sir.";
    if (M.missed.length) return speaker(M.missed[M.missed.length - 1].who, false) + " tried to reach you, sir.";
    if (live) return live === 1 ? "There's one folder waiting on your desk." : "There are " + live + " folders on your desk, sir.";
    const hr = hour();
    return hr < 12 ? "Good morning, Mr. President." : hr < 18 ? "Good afternoon, Mr. President." : "Working late, sir?";
  }
  function releaseSecretary() { if (SEC.ped) unpost(SEC.ped); SEC.ped = null; SEC.tries = 0; }
  function tickSecretary() {
    const p = SEC.ped;
    if (!p) return;
    if (p.dead) { SEC.dead = true; SEC.ped = null; return; }
    const Pp = player();
    if (!Pp || !Pp.pos || CLOCK - SEC.lastLine < 50) return;
    if (Math.abs(Pp.pos.y - p.pos.y) > 2 || Math.hypot(Pp.pos.x - p.pos.x, Pp.pos.z - p.pos.z) > 3.4) return;
    SEC.lastLine = CLOCK;
    if (CBZ.citySay) { try { CBZ.citySay(p, secLine(), "#e8e2cf", 3.0); } catch (e) {} }
  }

  // ============================================================
  //  §8  THE NEWS. The office TV is a NEWS ONE set like every other TV in
  //  the game: city/newsroom.js owns the stories, the canvas and the set.
  //  This file only writes the presidency's own headlines into it.
  // ============================================================
  function news(headline, opts) {
    opts = opts || {};
    const N = CBZ.news;
    if (!N || !N.push) return false;
    return N.push(clean(headline), {
      sub: opts.sub || "", cat: opts.cat || "", kind: opts.kind,
      look: opts.poll ? "poll" : null, phone: !opts.quiet,
    });
  }

  const ORDER_NEWS = {
    address: ["The President addresses the nation", "POLITICS"],
    emergency: ["State of emergency declared", "SECURITY"],
    crackdown: ["Troops break up a private army", "SECURITY"],
    wall: ["Work begins on the Saltlands wall", "BORDER"],
    bureau: ["Bureau agents move on a terror cell", "SECURITY"],
    pardon: ["The President signs a pardon", "JUSTICE"],
    fascism: ["The President proclaims one state", "POLITICS"],
    communism: ["The state takes control of the market", "ECONOMY"],
    crown: ["The President takes the crown", "POLITICS"],
    curfew: ["Night curfew ordered in the capital", "SECURITY"],
    surge: ["Police surge ordered", "SECURITY"],
    martial: ["Soldiers deployed on city streets", "SECURITY"],
    guard: ["The President's protection is doubled", "SECURITY"],
    police: ["New money for the police", "ECONOMY"],
    taxup: ["Taxes go up", "ECONOMY"],
    taxdown: ["Taxes cut", "ECONOMY"],
    amnesty: ["General amnesty declared", "JUSTICE"],
  };

  // ============================================================
  //  §9  THE WORLD WRITES MATTERS. Every line reads the state as it is.
  // ============================================================
  function whoOf(role) { const p = person(role); return { name: p.name, role: role }; }
  function foreignCaller() {
    const h = seatH();
    const mine = h ? h.id : "republic";
    const NAMES = { republic: "the Republic", veridia: "Veridia", kesh: "Kesh", solara: "Solara", mbeya: "the Mbeya Federation" };
    const ids = ["veridia", "kesh", "solara", "mbeya", "republic"].filter(function (x) { return x !== mine; });
    let best = ids[0], bv = 0;
    if (CBZ.relations && CBZ.relations.get) {
      for (let i = 0; i < ids.length; i++) {
        let v = 0; try { v = CBZ.relations.get(mine, ids[i]); } catch (e) {}
        if (Math.abs(v) >= Math.abs(bv)) { bv = v; best = ids[i]; }
      }
    } else best = ids[strHash(mine + day()) % ids.length];
    let nm = NAMES[best] || best;
    if (CBZ.polity && CBZ.polity.get) { try { const r = CBZ.polity.get(best); if (r && r.name) nm = r.name; } catch (e) {} }
    return { id: best, mine: mine, name: nm, rel: bv };
  }
  function rel(kind, mag, who) {
    if (!CBZ.relations || !CBZ.relations.event || !who) return;
    try { CBZ.relations.event(who.mine, who.id, kind, mag); } catch (e) {}
  }
  function S() { return status() || {}; }
  function th() { return (status() || {}).threat || { members: 0, supply: 0, intel: false, armed: false }; }
  function attacksLine() {
    const n = M.counts.attacks;
    return n ? (n === 1 ? "There has been one attack this term." : "There have been " + n + " attacks this term.") : "No attack has reached us yet.";
  }

  // ---- the daily folders --------------------------------------------------
  function secFolder(d) {
    const T = th(), s = S();
    const out = [];
    if (s.wall && !s.wall.ordered && btn("wall").ok) out.push({
      id: "f:wall:" + d, topic: "wall", kind: "security", who: whoOf("general"),
      memo: { dept: "Border Protection", subject: "A wall on the Saltlands line",
        body: ["The cell is supplied by runs across the Saltlands frontier. Nothing on that line stops them.",
          "Their supply stands at " + (T.supply | 0) + " of 9. " + attacksLine(),
          "Construction is paid from the treasury, section by section, until the line is closed."],
        rec: "Order construction of the wall." },
      yes: { label: "Sign it", order: "wall" }, no: { label: "Send it back" },
      ifIgnored: function () { news("Border chiefs say the frontier is wide open", { cat: "BORDER" }); },
    });
    if ((M.counts.attacks > 0 || M.counts.protests > 0) && btn("curfew").ok) out.push({
      id: "f:curfew:" + d, topic: "curfew", kind: "security", who: whoOf("police"),
      memo: { dept: "Metropolitan Police", subject: "A night curfew",
        body: [attacksLine() + (M.counts.protests ? " Protests have reached the streets " + M.counts.protests + " times." : ""),
          "A curfew clears the streets after dark. It applies to everyone, you included.",
          "Expect complaints. Expect fewer bodies."],
        rec: "Impose a night curfew in the capital." },
      yes: { label: "Sign it", order: "curfew" }, no: { label: "Send it back" },
    });
    if (T.armed || T.members > 0) {
      if (btn("surge").ok) out.push({
        id: "f:surge:" + d, topic: "surge", kind: "security", who: whoOf("police"),
        memo: { dept: "Metropolitan Police", subject: "Police to the Mansion gate",
          body: ["The cell has " + T.members + " people we can name" + (T.intel ? " and a safehouse we know." : ", and we do not know where they sleep."),
            T.armed ? "They are moving. The target is " + (T.target || "not known") + "." : "They have not moved yet. They will.",
            "A surge puts extra officers where the threat is."],
          rec: "Surge the police." },
        yes: { label: "Sign it", order: "surge" }, no: { label: "Send it back" },
      });
    }
    if (btn("guard").ok) out.push({
      id: "f:guard:" + d, topic: "guard", kind: "security", who: whoOf("aide"),
      memo: { dept: "Protective Detail", subject: "The size of your detail",
        body: ["Your detail is sized for a quiet term. " + attacksLine(),
          T.members > 0 ? "The cell counts " + T.members + " members and the gate is on their list." : "The cell has no names on the board today.",
          "More agents cost money every day they stand next to you."],
        rec: "Enlarge the President's detail." },
      yes: { label: "Sign it", order: "guard" }, no: { label: "Send it back" },
    });
    if (M.counts.attacks >= 2 && (s.emergency || 0) < 50 && btn("emergency").ok) out.push({
      id: "f:emergency:" + d, topic: "emergency", kind: "security", who: whoOf("general"),
      memo: { dept: "General Staff", subject: "Emergency powers",
        body: [attacksLine(), "Emergency powers stand at " + Math.round(s.emergency || 0) + "%.",
          "A declaration lets us move without asking. The republic will remember who signed it."],
        rec: "Declare a state of emergency." },
      yes: { label: "Sign it", order: "emergency" }, no: { label: "Send it back" },
    });
    return pickOf(out, d, 1);
  }
  function ecoFolder(d) {
    const s = S(), out = [];
    const tr = s.treasury || 0, ap = Math.round(s.approval || 0);
    if (tr < 8000 && btn("taxup").ok) out.push({
      id: "f:taxup:" + d, topic: "taxup", kind: "economy", who: whoOf("treasury"),
      memo: { dept: "The Treasury", subject: "Raising taxes",
        body: ["The treasury holds " + money(tr) + ". A single Bureau raid costs $6,000.",
          "Every standing order draws on that account daily.",
          "Approval is " + ap + "%. A tax rise will cost some of it."],
        rec: "Raise the tax rate." },
      yes: { label: "Sign it", order: "taxup" }, no: { label: "Send it back" },
      ifIgnored: function () { news("Treasury warns the state is running dry", { cat: "ECONOMY" }); },
    });
    if (ap < 45 && tr > 20000 && btn("taxdown").ok) out.push({
      id: "f:taxdown:" + d, topic: "taxdown", kind: "economy", who: whoOf("treasury"),
      memo: { dept: "The Treasury", subject: "A tax cut",
        body: ["Approval is " + ap + "%. The treasury holds " + money(tr) + ".",
          "We can afford to give some of it back.", "A cut is popular now and expensive later."],
        rec: "Cut the tax rate." },
      yes: { label: "Sign it", order: "taxdown" }, no: { label: "Send it back" },
    });
    if (btn("police").ok) out.push({
      id: "f:police:" + d, topic: "police", kind: "economy", who: whoOf("police"),
      memo: { dept: "Metropolitan Police", subject: "Funding the force",
        body: ["The force is stretched. " + attacksLine(),
          "The treasury holds " + money(tr) + ".",
          "Money for the police puts more officers on the street for good."],
        rec: "Fund the police." },
      yes: { label: "Sign it", order: "police" }, no: { label: "Send it back" },
    });
    if (!out.length && btn("taxup").ok) out.push({
      id: "f:taxup2:" + d, topic: "taxup", kind: "economy", who: whoOf("treasury"),
      memo: { dept: "The Treasury", subject: "The tax rate",
        body: ["The treasury holds " + money(tr) + ".", "Approval is " + ap + "%.", "A modest rise keeps the orders funded."],
        rec: "Raise the tax rate." },
      yes: { label: "Sign it", order: "taxup" }, no: { label: "Send it back" },
    });
    return pickOf(out, d, 2);
  }
  function peopleFolder(d) {
    const s = S(), out = [];
    const ap = Math.round(s.approval || 0);
    if (btn("address").ok && (ap < 55 || (s.scandal || 0) > 20)) out.push({
      id: "f:address:" + d, topic: "address", kind: "people", who: whoOf("press"),
      memo: { dept: "Press Office", subject: "An address to the nation",
        body: ["Approval is " + ap + "%." + ((s.scandal || 0) > 20 ? " The papers have a story and they are not letting go." : ""),
          attacksLine(), "Airtime costs $2,000. A country in crisis listens; a calm one shrugs."],
        rec: "Address the nation tonight." },
      yes: { label: "Sign it", order: "address" }, no: { label: "Send it back" },
    });
    if (btn("amnesty").ok) out.push({
      id: "f:amnesty:" + d, topic: "amnesty", kind: "people", who: whoOf("chief"),
      memo: { dept: "Office of the Attorney General", subject: "A general amnesty",
        body: ["The courts are full of small cases.", "An amnesty clears warrants across the country.",
          "Approval is " + ap + "%. Some will call it mercy. Some will call it weakness."],
        rec: "Declare a general amnesty." },
      yes: { label: "Sign it", order: "amnesty" }, no: { label: "Send it back" },
    });
    if (btn("pardon").ok) out.push({
      id: "f:pardon:" + d, topic: "pardon", kind: "people", who: whoOf("chief"),
      memo: { dept: "Office of the Pardon Attorney", subject: "The warrants in your name",
        body: ["There are open warrants that name you.", "A pardon closes them. It will be reported.",
          "Your approval is " + ap + "%."],
        rec: "Sign the pardon." },
      yes: { label: "Sign it", order: "pardon" }, no: { label: "Send it back" },
    });
    return pickOf(out, d, 3);
  }
  function pickOf(list, d, salt) {
    if (!list.length) return null;
    return list[Math.floor(h01(d * 7.13, salt, 5501) * list.length) % list.length];
  }
  function issueFolders(d) {
    if (M.folderDay === d) return;
    closeFolderDay();
    M.folderDay = d;
    if (!seated()) return;
    const n = h01(d * 3.3, 11, 7717) < 0.45 ? 3 : 2;
    const gens = [secFolder, ecoFolder, peopleFolder];
    const got = [];
    for (let i = 0; i < gens.length; i++) { let m = null; try { m = gens[i](d); } catch (e) { m = null; } if (m) got.push(m); }
    // 2 or 3: drop the least urgent when the day is a two-folder day
    while (got.length > n) got.pop();
    for (let i = 0; i < got.length; i++) { got[i].via = "folder"; got[i].expires = 1e9; offer(got[i]); }
  }

  // ---- reactions: calls and visits ------------------------------------------
  function generalCall(e) {
    const who = whoOf("general");
    const T = th();
    const at = (e && (e.at || (e.where && e.where.name))) || "the market";
    const martialOk = btn("martial").ok;
    const key = martialOk ? "martial" : "surge";
    return offer({
      id: "p:attack:" + day() + ":" + M.counts.attacks, via: "phone", topic: key, who: who, expires: 120,
      line: "Mr. President. The attack at " + at + " is over. " + (T.members > 0 ? T.members + " of them still walk free. " : "") +
        (martialOk ? "I want soldiers on the streets tonight, on your order." : "I want the police surged where they struck, on your order."),
      yes: { label: martialOk ? "Put them on the streets." : "Surge the police.", order: key, reply: "Yes, sir. They move within the hour." },
      no: { label: "Not yet. Hold them.", reply: "Understood. We hold." },
      ifIgnored: function () { news("General says the army waited for orders that never came", { cat: "SECURITY" }); shock(-1); },
      missedLine: "The General called after the attack. Nobody picked up, so the army sat on its hands.",
    });
  }
  function bureauCall() {
    const T = th();
    return offer({
      id: "p:raid:" + day(), via: "phone", topic: "bureau", who: whoOf("bureau"), expires: 150,
      line: "Sir, we have the safehouse. " + T.members + (T.members === 1 ? " member" : " members") + " of the cell, supply at " + (T.supply | 0) +
        ". My agents can go in tonight. A raid costs six thousand.",
      yes: { label: "Go in.", order: "bureau", reply: "Agents are moving. I'll call when it's done." },
      no: { label: "Keep watching them.", reply: "We'll keep eyes on it. They move house often." },
      ifIgnored: function () { news("Bureau sources say a raid was ready and never ordered", { cat: "SECURITY" }); },
      missedLine: "The Bureau Director had the safehouse and wanted your word. He never got it.",
    });
  }
  function commissionerCall(e) {
    const size = e && e.size ? e.size : 0;
    return offer({
      id: "p:protest:" + day(), via: "phone", topic: "curfew", who: whoOf("police"), expires: 120,
      line: "Mr. President, " + (size ? "there are about " + size + " people" : "there's a crowd") + " in the streets and it's getting dark. " +
        "A curfew would clear them by nightfall.",
      yes: { label: "Impose the curfew.", order: "curfew", reply: "The order goes out now." },
      no: { label: "Let them march.", reply: "We'll keep our distance and keep the peace." },
      ifIgnored: function () { news("Protesters hold the streets into the night", { cat: "THE PEOPLE" }); },
      missedLine: "The Commissioner wanted a curfew for the protest. You didn't take the call.",
    });
  }
  function treasuryCall() {
    const s = S();
    return offer({
      id: "p:tax:" + day(), via: "phone", topic: "taxup", who: whoOf("treasury"), expires: 150,
      line: "Sir, the treasury is down to " + money(s.treasury) + ". I need a tax rise.",
      yes: { label: "Raise them.", order: "taxup", reply: "Thank you. It won't be popular." },
      no: { label: "Find it somewhere else.", reply: "There is nowhere else, sir. But understood." },
      ifIgnored: function () { news("Treasury warns the state is running dry", { cat: "ECONOMY" }); },
      missedLine: "The Treasury Secretary called about the money. The account is still empty.",
    });
  }
  function whipCall() {
    const s = S();
    return offer({
      id: "p:whip:" + day(), via: "phone", topic: "address", who: whoOf("whip"), expires: 150,
      line: "Mr. President, you're at " + Math.round(s.approval || 0) + "%. The party is getting nervous. You need to go on air and talk to them.",
      yes: { label: "Book the airtime.", order: "address", reply: "Good. Keep it short and look them in the eye." },
      no: { label: "Not yet.", reply: "Then the party will start talking without you." },
      ifIgnored: function () { news("Party figures question the President's silence", { cat: "POLITICS" }); shock(-1); },
      missedLine: "The party whip called about the numbers. He'll be talking to the papers instead.",
    });
  }
  function campaignCall() {
    const s = S(), E = s.election || {};
    const pol = E.polling != null ? Math.round(E.polling) + "%" : Math.round(s.approval || 0) + "%";
    return offer({
      id: "p:election:" + E.voteDay, via: "phone", topic: "address", who: whoOf("whip"), expires: 150,
      line: "Sir, the country votes on day " + E.voteDay + ". We're polling at " + pol + ". One more address before the vote could move it.",
      yes: { label: "Put me on air.", order: "address", reply: "I'll tell the networks." },
      no: { label: "My record speaks.", reply: "I hope it's loud, sir." },
    });
  }
  function ambassadorWall() {
    const f = foreignCaller();
    return offer({
      id: "p:foreign:wall", via: "phone", topic: "foreign", who: { name: "The ambassador of " + f.name, role: "foreign" }, expires: 150,
      line: "Mr. President, my government has seen your wall on the Saltlands line. Our traders use those crossings. We ask that they stay open.",
      yes: { label: "The wall stands.", run: function () { rel("border", 8, f); shock(1); }, reply: "Then I will report that to my government." },
      no: { label: "The crossings stay open.", run: function () { rel("trade", 6, f); }, reply: "Thank you. That will be remembered." },
      ifIgnored: function () { rel("insult", 4, f); news(f.name + " complains the President would not take its call", { cat: "WORLD" }); },
      missedLine: "The ambassador of " + f.name + " called about the wall. Being ignored will cost us with them.",
    });
  }
  function ambassadorAid() {
    const f = foreignCaller();
    return offer({
      id: "p:foreign:aid:" + day(), via: "phone", topic: "aid", who: { name: "The ambassador of " + f.name, role: "foreign" }, expires: 120,
      line: "Mr. President, we saw the news. My government offers help: money for the victims and for your police. Five thousand, today.",
      yes: { label: "We accept, with thanks.", run: function () { const h = seatH(); if (h && h.rec) h.rec.treasury = (h.rec.treasury || 0) + 5000; rel("aid", 6, f); news(f.name + " sends aid after the attack", { cat: "WORLD" }); }, reply: "It will be wired within the hour." },
      no: { label: "We can look after ourselves.", run: function () { rel("insult", 3, f); }, reply: "As you wish." },
    });
  }
  function armedAide(e) {
    const T = th();
    return offer({
      id: "a:armed:" + day(), via: "aide", urgent: true, topic: "surge", who: whoOf("aide"), expires: 45,
      line: "Sir, the detail wants you away from the windows. We have word the cell is moving" + (T.target ? " on " + T.target : "") + ". Police at the gate would help.",
      yes: { label: "Put police on the gate.", order: "surge", reply: "Right away. Please stay inside, sir." },
      no: { label: "I'm staying at my desk.", reply: "Then we'll stand in the doorway." },
    });
  }
  function pressAide(drop) {
    const s = S();
    return offer({
      id: "a:press:" + day(), via: "aide", urgent: true, topic: "address", who: whoOf("press"), expires: 120,
      line: "Sir, it's been a bad news day. You're down " + drop + " points, " + Math.round(s.approval || 0) + "% now. The networks will give you ten minutes tonight.",
      yes: { label: "I'll take them.", order: "address", reply: "I'll draft something. Nothing long." },
      no: { label: "Let it blow over.", reply: "It won't. But it's your call." },
    });
  }
  function scheduleWords() {
    const PP = CBZ.presidentPublic;
    let list = null;
    if (PP && typeof PP.schedule === "function") { try { list = PP.schedule(); } catch (e) { list = null; } }
    else { const p = P(); if (p && typeof p.schedule === "function") { try { list = p.schedule(); } catch (e) { list = null; } } }
    if (!Array.isArray(list) || !list.length) return "";
    const nowT = CBZ.dayTime ? CBZ.dayTime() : 0;
    const parts = [];
    for (let i = 0; i < list.length && parts.length < 2; i++) {
      const a = list[i];
      if (!a || a.t1 != null && a.t1 < nowT) continue;
      const hr = a.hour0 != null ? a.hour0 : ((((a.t0 % 1) + 1) % 1) * 24 + 6) % 24;   // phase 0 of the day clock is 06:00
      const place = a.place && a.place.name ? a.place.name : "the city";
      const verb = a.kind === "speech" ? "you speak at " : a.kind === "motorcade" ? "the motorcade to " : "a visit to ";
      parts.push(hourWords(hr) + ", " + verb + place + ".");
    }
    return parts.join(" ");
  }
  function hourWords(h) {
    const hh = Math.round(h) % 24;
    if (hh === 12) return "Noon";
    if (hh === 0) return "Midnight";
    const W = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven"];
    return W[hh % 12] + (hh < 12 ? " in the morning" : hh < 18 ? " this afternoon" : " tonight");
  }
  function chiefVisit(first) {
    if (!first && M.chiefDay === day()) return null;
    // no Chief of Staff, nobody walks in with the day
    if (CBZ.presidentStaff && CBZ.presidentStaff.vacant && CBZ.presidentStaff.vacant("chief")) return null;
    M.chiefDay = day();
    const s = S();
    const bits = [];
    if (first) bits.push("Welcome, Mr. President. Today's business is on your desk.");
    else bits.push("Good morning, Mr. President.");
    const sch = scheduleWords();
    if (sch) bits.push(sch);
    if (M.missed.length) {
      const m = M.missed[M.missed.length - 1];
      bits.push(m.missedLine || (speaker(m.who, false) + " tried to reach you and went ahead without you."));
      M.missed.length = 0;
    }
    if (M.flags.unsigned) { bits.push(M.flags.unsigned === 1 ? "One folder went unsigned yesterday. It's been noticed." : M.flags.unsigned + " folders went unsigned yesterday. It's been noticed."); M.flags.unsigned = 0; }
    const live = liveFolders();
    if (!first && live) bits.push(live + (live === 1 ? " folder" : " folders") + " on your desk.");
    if (s.election && s.election.voteDay != null && s.election.voteDay - s.day <= 2 && s.election.voteDay >= s.day) bits.push("The vote is on day " + s.election.voteDay + ".");
    return offer({
      id: "a:chief:" + day() + (first ? ":first" : ""), via: "aide", urgent: true, topic: "schedule", who: whoOf("chief"), expires: 200,
      line: bits.join(" "),
      yes: { label: "Let's get to work.", reply: "I'll be down the hall." },
      no: { label: "Hold my calls for a while.", run: function () { M.holdUntil = CLOCK + 75; }, reply: "Nobody gets through for a few minutes." },
    });
  }

  // the bus
  function wire() {
    const p = P();
    if (M.wired || !p || typeof p.on !== "function") return;
    M.wired = true;
    const on = function (evt, fn) { try { p.on(evt, fn); } catch (e) {} };
    on("sworn", function (e) {
      SPAWN.pending = true; SPAWN.until = CLOCK + 30; SPAWN.relocs = 0; SPAWN.settle = 0; SPAWN.sat = false;
      M.phoneQ.length = 0; M.aideQ.length = 0; M.missed.length = 0; M.flags = {};
      M.morningDay = day(); M.chiefDay = day();      // the welcome below IS today's visit
      M.approvalMorning = null;
      // the headline itself arrives through presidency.js's big() -> news()
      M.later.push({ at: CLOCK + 1.0, fn: function () { if (M.folderDay !== day()) issueFolders(day()); } });
      M.later.push({ at: CLOCK + 6.0, fn: function () { chiefVisit(true); } });
      M.lastCallEnd = CLOCK;       // first call no sooner than CALL_GAP after taking office
    });
    on("order", function (e) {
      if (!e || !e.ok) return;
      const n = ORDER_NEWS[e.key];
      if (n) news(n[0], { cat: n[1], poll: e.key === "address" });
      _btns = null;
    });
    on("attack-armed", function (e) {
      if (e && e.eta != null && seated()) armedAide(e);
    });
    on("attack", function (e) {
      e = e || {};
      M.counts.attacks++;
      news("Attack at " + (e.at || "the market"), { kind: "breaking", cat: "SECURITY", sub: e.real ? "Gunmen opened fire" : "Casualties reported" });
      if (!seated()) return;
      M.later.push({ at: CLOCK + 12, fn: function () { generalCall(e); } });
      if (h01(day(), M.counts.attacks, 881) < 0.5) M.later.push({ at: CLOCK + 70, fn: ambassadorAid });
    });
    on("raid", function (e) {
      if (!e || e.phase) return;
      news(e.won ? "Bureau raid breaks a terror cell" : "Bureau raid goes wrong", { kind: e.won ? "story" : "breaking", cat: "SECURITY" });
    });
    on("impeach", function () { news("Articles of impeachment filed against the President", { kind: "breaking", cat: "POLITICS" }); });
    on("campaign", function (e) { news("The race is on" + (e && e.challenger ? ": " + e.challenger + " challenges the President" : ""), { cat: "ELECTION", poll: true }); });
    on("reelected", function () { news("The President wins a second term", { kind: "breaking", cat: "ELECTION", poll: true }); });
    on("defeated", function () { news("The President loses the election", { kind: "breaking", cat: "ELECTION" }); });
    on("arrest", function (e) { news((e && e.title) || "The President is under arrest", { kind: "breaking", cat: "POLITICS" }); });
    on("speech", function (e) {
      e = e || {};
      const n = e.crowd | 0;
      news(n ? "A crowd of " + n + " hears the President" : "The President speaks", {
        cat: "POLITICS", poll: true,
        sub: (e.protesters | 0) ? (e.protesters | 0) + " protesters in the crowd" : "",
      });
    });
    on("protest", function (e) {
      e = e || {};
      if (e.phase && e.phase !== "start") return;
      M.counts.protests++;
      news((e.size ? e.size + " protesters" : "Protesters") + " march on the capital", { cat: "THE PEOPLE" });
      if (seated()) commissionerCall(e);
    });
    on("security", function (e) {
      if (e && e.level === "evac") news("Security alert at the Executive Mansion", { kind: "breaking", cat: "SECURITY" });
    });
    on("assassinated", function (e) {
      e = e || {};
      const v = e.victim && e.victim.name ? e.victim.name : "The President";
      news(v + " assassinated", { kind: "breaking", cat: "NATION", sub: e.successor && e.successor.name ? e.successor.name + " takes the oath" : "" });
    });
    on("lockdown", function (e) { if (e && e.active) news("The capital is in lockdown", { kind: "breaking", cat: "SECURITY", sub: e.reason ? clean(e.reason) : "" }); });
    on("succession", function (e) {
      const n = e && e.successor && e.successor.name ? e.successor.name : null;
      news(n ? n + " takes the oath of office" : "A new head of state takes the oath", { kind: "breaking", cat: "NATION" });
    });
    on("cabinet-death", function (e) {
      e = e || {};
      const n = e.name || (e.person && e.person.name);
      if (n) news(n + " killed", { kind: "breaking", cat: "NATION", sub: e.role ? clean(e.role) : "" });
    });
    on("appearance", function (e) {
      if (!e || e.phase !== "start") return;
      const pl = e.place && e.place.name ? e.place.name : "the city";
      news("The President appears at " + pl, { cat: "POLITICS" });
    });
    on("decision", function (e) {
      // what the office decided out loud; ignored matters report themselves
      if (!e || e.choice !== "no" || e.source === "phone") return;
      if (e.topic === "wall") news("The President shelves the border wall", { cat: "BORDER" });
    });
  }

  // periodic world checks (every 2 s)
  let checkAcc = 0;
  function worldChecks() {
    if (!seated()) return;
    const s = S(), T = s.threat || {}, d = day();
    if (M.approvalMorning == null) M.approvalMorning = Math.round(s.approval || 0);
    if (T.intel && T.members > 0 && btn("bureau").ok && M.flags.raidDay !== d) { M.flags.raidDay = d; bureauCall(); }
    if ((s.approval || 0) < 35 && M.flags.whipDay !== d && btn("address").ok) { M.flags.whipDay = d; whipCall(); }
    const E = s.election || {};
    if (E.voteDay != null && E.voteDay - d >= 1 && E.voteDay - d <= 2 && M.flags.electionCall !== E.voteDay && btn("address").ok) {
      M.flags.electionCall = E.voteDay; campaignCall();
    }
    if ((s.treasury || 0) < 6000 && (M.flags.taxDay == null || d - M.flags.taxDay >= 2) && btn("taxup").ok) { M.flags.taxDay = d; treasuryCall(); }
    if (s.wall && s.wall.ordered && !M.flags.wallCall) { M.flags.wallCall = true; M.later.push({ at: CLOCK + 50, fn: ambassadorWall }); }
    const drop = (M.approvalMorning | 0) - Math.round(s.approval || 0);
    if (drop >= 5 && M.flags.pressDay !== d && btn("address").ok) { M.flags.pressDay = d; pressAide(drop); }
    // the Chief of Staff's morning walk-in: the first time you are in the office each day
    if (M.morningDay !== d && ROOM.rec && inOffice(ROOM.rec)) { M.morningDay = d; chiefVisit(false); }
    for (let i = 0; i < M.folders.length; i++) if (M.folders[i].state === "closed") refreshBlocked(M.folders[i]);
  }

  // ============================================================
  //  §10  YOU START AT YOUR DESK.
  // ============================================================
  const SPAWN = { pending: false, sat: false, until: 0, relocs: 0, settle: 0, sessionChecked: false, lastReloc: -1e9 };
  function deskPoint() {
    const rec = office();
    if (!rec) return null;
    const d = rec.landmarks.presidentialDesk, A = rec.approach;
    return { x: d.x + A.nx * THRONE_BACK, y: rec.floorY, z: d.z + A.nz * THRONE_BACK, heading: faceDoor(rec) };
  }
  function relocateToDesk(rec) {
    const Pp = player(), dp = deskPoint();
    if (!Pp || !Pp.pos || !dp || Pp.dead || Pp.driving) return false;
    if (CBZ.propStand && (Pp._propSeat || Pp._propBed)) { try { CBZ.propStand(Pp, { instant: true }); } catch (e) {} }
    // stand at the chair, then take it
    const A = rec.approach;
    const standX = dp.x - A.nx * 0.25, standZ = dp.z - A.nz * 0.25;
    Pp.pos.set(standX, rec.floorY + 0.02, standZ);
    Pp.vy = 0; Pp.grounded = true;
    if (Pp._phys) { Pp._phys.air = false; Pp._phys.vx = Pp._phys.vz = Pp._phys.vy = 0; }
    const ch = CBZ.playerChar;
    if (ch && ch.group) { ch.group.position.copy(Pp.pos); ch.group.rotation.y = dp.heading; }
    if (CBZ.cam) { CBZ.cam.yaw = dp.heading + Math.PI; CBZ.cam.pitch = 0.16; }
    let sat = false;
    if (CBZ.propNearestSeat && CBZ.propSit) {
      try {
        const seat = CBZ.propNearestSeat(dp.x, dp.z, 0.9, rec.floorY);
        if (seat) sat = !!CBZ.propSit(Pp, seat, { instant: true });
      } catch (e) { sat = false; }
    }
    SPAWN.lastReloc = CLOCK;
    return true;
  }
  function tickSpawn(dt) {
    const Pp = player();
    const rec = office();
    // a loaded game where you already hold the seat, standing on your own
    // grounds: the first time the office exists this session, you are at it.
    if (!SPAWN.sessionChecked && rec && seated() && Pp && Pp.pos) {
      SPAWN.sessionChecked = true;
      const site = (P() && P().site) ? (function () { try { return P().site(); } catch (e) { return null; } })() : null;
      const R = site && site.rect;
      if (R && Pp.pos.x > R.minX - 20 && Pp.pos.x < R.maxX + 20 && Pp.pos.z > R.minZ - 20 && Pp.pos.z < R.maxZ + 20) {
        SPAWN.pending = true; SPAWN.until = CLOCK + 20; SPAWN.relocs = 0; SPAWN.settle = 0; SPAWN.sat = false;
        if (M.morningDay !== day()) { M.morningDay = day(); M.later.push({ at: CLOCK + 5, fn: function () { chiefVisit(false); } }); }
      }
    }
    if (!SPAWN.pending) return;
    if (CLOCK > SPAWN.until) { SPAWN.pending = false; return; }
    if (!rec || !Pp || !Pp.pos || Pp.dead || Pp.driving) return;
    SPAWN.sessionChecked = true;
    const dp = deskPoint();
    const at = Math.abs(Pp.pos.y - rec.floorY) < 1.2 && Math.hypot(Pp.pos.x - dp.x, Pp.pos.z - dp.z) < 1.6;
    // HE GOT UP. Once he has sat in the chair, standing out of it or walking
    // is the player's own choice and the spawn is over. (This used to yank a
    // President who stood up and walked out of the office inside the 20-30 s
    // window back into the chair, up to five times: leave the floor, or go
    // 30 m, and you were at the desk again. Owner: "I literally can't get
    // out of the fucking Oval Office.")
    if (at && Pp._propSeat) SPAWN.sat = true;
    if (SPAWN.sat && (!Pp._propSeat || (Pp.speed || 0) > 0.1)) { SPAWN.pending = false; return; }
    if (at) {
      SPAWN.settle += dt;
      if (SPAWN.settle > 3.0) SPAWN.pending = false;       // he is at his desk and staying there
      return;
    }
    SPAWN.settle = 0;
    // someone else (the origin, the swear-in) put the body elsewhere after us:
    // put it back, a few times, then trust whoever moved it.
    if (SPAWN.relocs >= 5) { SPAWN.pending = false; return; }
    if (CLOCK - SPAWN.lastReloc < 0.4) return;
    if (SPAWN.relocs > 0 && CLOCK - SPAWN.lastReloc > 4) {
      // four seconds after we seated him he walked off on his own: his choice
      const far = Math.hypot(Pp.pos.x - dp.x, Pp.pos.z - dp.z);
      if (far < 30 && Math.abs(Pp.pos.y - rec.floorY) < 1.2) { SPAWN.pending = false; return; }
    }
    SPAWN.relocs++;
    relocateToDesk(rec);
  }

  // ============================================================
  //  §11  INTERACTIONS — verbs on the objects.
  // ============================================================
  let zonesWired = false;
  function yGate(y) { const Pp = player(); return !(Pp && Pp.pos && isFinite(y) && Math.abs(Pp.pos.y - y) > 2.2); }
  // THE PHONE: E is Answer while it rings. Otherwise E is Call: you ring the
  // office with something waiting for you (the first call in the queue), or
  // the one whose business is most pressing today. Whoever it is, it is the
  // same conversation a ringing call would have been.
  function placeCall() {
    if (M.ringing) { answer(); return; }
    if (M.onCall || READ.f || AIDE.talking) return;
    let m = M.phoneQ.length ? M.phoneQ.shift() : null;
    if (!m) {
      const T = th(), st0 = S();
      const gen = (T.members > 0 && T.intel) ? bureauCall : ((st0.treasury | 0) < 4000 ? treasuryCall : whipCall);
      let id = null;
      try { id = gen(); } catch (e) { id = null; }
      for (let i = 0; i < M.phoneQ.length; i++) if (M.phoneQ[i].id === id) { m = M.phoneQ.splice(i, 1)[0]; break; }
    }
    if (!m) return;
    M.onCall = m;
    if (CBZ.sfx) { try { CBZ.sfx("switch", { vol: 0.5 }); } catch (e) {} }
    liftHandset();
    converse(m, "phone", function () { M.later.push({ at: CLOCK + 3.0, fn: function () { hangUp(); } }); });
  }
  // GOVERN: the heavier verb on the desk. You sit down behind it and the day
  // comes to you: today's folders on the desk if they are not there yet, and
  // the Chief of Staff with the day in words if you have not had it.
  function govern() {
    const rec = ROOM.rec;
    if (!rec) return;
    relocateToDesk(rec);
    if (!seated()) return;
    if (M.folderDay !== day()) issueFolders(day());
    if (M.chiefDay !== day() && !AIDE.ped) chiefVisit(false);
  }
  function wireZones() {
    if (zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesWired = true;
    CBZ.interactions.registerZone({
      id: "presoffice-phone", kind: "presphone", radius: 2.3, prio: 15,
      find: function (px, pz) {
        if (!ROOM.phone || !ROOM.rec || M.onCall) return null;
        const w = phoneWorld();
        if (!w || !yGate(ROOM.rec.floorY)) return null;
        const dx = w.x - px, dz = w.z - pz;
        return dx * dx + dz * dz < 2.3 * 2.3 ? { x: w.x, y: w.y, z: w.z, kind: "presphone" } : null;
      },
      options: [{
        id: "presoffice-answer", slot: "e", prio: 22, campaignSafe: true,
        label: "Answer",
        canShow: function () { return !!M.ringing; },
        onSelect: function () { answer(); },
      }, {
        id: "presoffice-call", slot: "e", prio: 20, campaignSafe: true,
        label: "Call",
        canShow: function () { return !M.ringing && seated() && !READ.f && !AIDE.talking; },
        onSelect: function () { placeCall(); },
      }, {
        // the wheel: dial anyone yourself, through the one directory
        // (city/phone_apps.js Calls: the cabinet, the press secretary,
        // foreign leaders; "I need your resignation" lives there)
        id: "presoffice-dial", prio: 12, campaignSafe: true,
        label: "Dial",
        canShow: function () { return !M.ringing && !M.onCall && seated() && !READ.f && !!CBZ.phoneOpen; },
        onSelect: function () { try { CBZ.phoneOpen("calls"); } catch (e) {} },
      }],
    });
    // THE DESK: E is Sign (the top folder opens under your hand; E again signs
    // it), hold E is Govern, and the wheel adds Send back
    CBZ.interactions.registerZone({
      id: "presoffice-desk", kind: "presdesk", radius: 2.2, prio: 14,
      find: function (px, pz) {
        if (!ROOM.desk || !ROOM.rec || !ROOM.L || READ.closing) return null;
        if (!yGate(ROOM.rec.floorY)) return null;
        const L = ROOM.L;
        const w = READ.f ? deskWorld(L.open.x, 0.01, L.open.z) : deskWorld(L.pile.x, PILE_Y, L.pile.z);
        if (!w) return null;
        const dx = w.x - px, dz = w.z - pz;
        return dx * dx + dz * dz < 2.2 * 2.2 ? { x: w.x, y: w.y, z: w.z, kind: "presdesk" } : null;
      },
      options: [{
        id: "presoffice-sign", slot: "e", prio: 20, campaignSafe: true,
        label: function () { return READ.f && READ.f.blocked ? "Close" : "Sign"; },
        canShow: function () { return READ.f ? READ.f.state === "open" : !!topFolder(); },
        onSelect: function () {
          if (!READ.f) { openFolder(topFolder()); return; }
          if (READ.f.blocked) shutFolder(); else signFolder();
        },
      }, {
        id: "presoffice-govern", hold: true, prio: 18, campaignSafe: true,
        label: "Govern",
        canShow: function () { return seated() && !READ.f; },
        onSelect: function () { govern(); },
      }, {
        id: "presoffice-send-back", prio: 10, campaignSafe: true,
        // a bill's "no" is a Veto (city/politics.js puts noVerb on its folders)
        label: function () { return (READ.f && READ.f.m && READ.f.m.noVerb) || "Send back"; },
        canShow: function () { return !!READ.f && READ.f.state === "open"; },
        onSelect: function () { returnFolder(); },
      }],
    });
    if (CBZ.interactions.describe) {
      try {
        CBZ.interactions.describe("presphone", function () { return { label: "", note: "" }; });
        CBZ.interactions.describe("presdesk", function () { return { label: "", note: "" }; });
      } catch (e) {}
    }
  }

  // ============================================================
  //  §12  THE TICK.
  // ============================================================
  function tickLater() {
    for (let i = M.later.length - 1; i >= 0; i--) {
      const L = M.later[i];
      if (CLOCK >= L.at) { M.later.splice(i, 1); try { L.fn(); } catch (e) {} }
    }
  }
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (d) {
      try {
        if (!seated()) { closeFolderDay(); M.folderDay = d; return; }
        M.approvalMorning = null;
        issueFolders(d);
      } catch (e) {}
    });
  }
  let wasCity = false;
  if (CBZ.onUpdate) CBZ.onUpdate(38.785, function (dt) {
    if (!inCity()) {
      if (wasCity) {
        // the world is gone: our peds and meshes with it
        wasCity = false;
        AIDE.ped = null; AIDE.m = null; AIDE.phase = null; SEC.ped = null; SEC.dead = false;
        M.ringing = null; M.onCall = null; READ.f = null;
        ROOM.root = null; ROOM.rec = null; ROOM.builtFor = null;
      }
      return;
    }
    wasCity = true;
    if (g.state !== "playing") return;
    dt = Math.min(0.1, dt || 0);
    CLOCK += dt;
    wire();
    wireZones();

    // the room: build once the office exists; rebuild when the world does
    const rec = office();
    const root = arenaRoot();
    if (rec && root) {
      if (!ROOM.root || ROOM.root.parent !== root || ROOM.builtFor !== CBZ.govComplexes || ROOM.key !== roomKey(rec)) buildRoom(rec);
      else ROOM.rec = rec;
    } else if (ROOM.root && (!rec || !root)) teardownRoom();
    if (!ROOM.root) return;

    tickSpawn(dt);
    tickLater();
    tickPhone(dt);
    tickAide(dt);
    if (nearOffice(ROOM.rec, 40)) { postSecretary(); tickSecretary(); }
    if (READ.f) {
      READ.t += dt;
      // a folder left open for a minute goes back on the pile
      if (READ.t > 75 && !READ.closing) shutFolder();
    }
    checkAcc += dt;
    if (checkAcc >= 2) {
      checkAcc = 0;
      if (seated() && M.folderDay !== day()) issueFolders(day());
      worldChecks();
      if (!seated()) {
        // no President in this chair: nothing rings, nobody walks in
        if (M.phoneQ.length || M.aideQ.length || M.ringing) { M.phoneQ.length = 0; M.aideQ.length = 0; M.ringing = null; }
      }
    }
  });

  // ============================================================
  //  §13  PUBLIC.
  // ============================================================
  function audit() {
    return {
      built: !!ROOM.root, office: !!office(), inOffice: !!(ROOM.rec && inOffice(ROOM.rec)),
      ringing: !!M.ringing, onCall: !!M.onCall, phoneQueue: M.phoneQ.length, aideQueue: M.aideQ.length,
      aide: AIDE.phase, aideRole: AIDE.m && AIDE.m.who ? AIDE.m.who.role : null, folders: M.folders.map(function (f) { return { id: f.m.id, topic: f.m.topic, state: f.state, blocked: !!f.blocked }; }),
      reading: !!READ.f, stories: CBZ.news ? CBZ.news.stories().length : 0, headline: CBZ.news ? CBZ.news.current().h : null,
      secretary: !!SEC.ped, decisions: M.decisions, missed: M.missed.length, spawnPending: SPAWN.pending,
      desk: deskPoint(),
    };
  }
  // the day in one short sentence, for whoever on the staff you ask
  // (president_staff.js: Talk on the Chief of Staff; a good Chief leads with
  // who on the staff is unhappy)
  function dayLine() {
    if (M.ringing) return "Your line's ringing, sir.";
    if (M.missed.length) { const m = M.missed[M.missed.length - 1]; return clean(m.missedLine || (speaker(m.who, false) + " tried to reach you.")); }
    const live = liveFolders();
    if (live) return live === 1 ? "There's a folder on your desk, sir." : live + " folders on your desk, sir.";
    const sch = scheduleWords();
    if (sch) return sch;
    return "Nothing that can't wait, sir.";
  }
  CBZ.presidentOffice = {
    offer: offer,
    news: news,
    dayLine: dayLine,
    ringing: function () { return !!M.ringing; },
    cellCall: cellCall,
    deskPoint: deskPoint,
    audit: audit,
    // harness hooks only
    _M: M, _room: ROOM, _answer: answer, _call: placeCall, _open: function () { openFolder(topFolder()); }, _sign: signFolder,
    _return: returnFolder, _issue: function (d) { M.folderDay = -1; issueFolders(d == null ? day() : d); },
    _relocate: function () { const r = office(); return r ? relocateToDesk(r) : false; }, _chief: chiefVisit,
    // ---- capture hooks (rAF frozen, stepSim ticks, no input) ----
    _placeAtDesk: function () {
      const r = office();
      if (!r) return null;
      if (!ROOM.root && arenaRoot()) buildRoom(r);
      relocateToDesk(r);
      SPAWN.pending = false;
      return deskPoint();
    },
    _ringNow: function (role) {
      const GEN = {
        general: function () { return generalCall({ at: "the market" }); }, bureau: bureauCall, treasury: treasuryCall,
        police: function () { return commissionerCall({}); }, whip: whipCall, foreign: ambassadorWall, aid: ambassadorAid,
      };
      const gen = GEN[role || "general"] || GEN.general;
      let id = null;
      try { id = gen(); } catch (e) { id = null; }
      let k = -1;
      for (let i = 0; i < M.phoneQ.length; i++) if (M.phoneQ[i].id === id) k = i;
      if (k < 0) return (M.ringing && M.ringing.id === id) ? id : false;
      const m = M.phoneQ.splice(k, 1)[0];
      if (M.ringing) M.phoneQ.unshift(M.ringing);
      M.ringing = m; M.ringT = 0; M.nextBurst = CLOCK + 0.2;
      if (ROOM.lamp) ROOM.lamp.material = ROOM.lampOn;
      return m.id;
    },
    _openFolder: function (i) {
      if (!liveFolders()) { M.folderDay = -1; issueFolders(day()); }
      const list = M.folders.filter(function (f) { return f.state === "closed"; }).sort(function (a, b) { return rank(b) - rank(a); });
      const f = list[(i | 0)] || list[0];
      if (!f) return null;
      if (READ.f) shutFolder();
      openFolder(f);
      return f.m.id;
    },
    _tv: function () {
      const r = ROOM.rec, w = ROOM.tvWorld;
      if (!r || !w) return null;
      if (CBZ.news) CBZ.news.paintNow();
      // the glass faces into the room: the set's own +z, wherever the room hung it
      const dir = new THREE.Vector3(0, 0, 1);
      if (ROOM.tv) { ROOM.tv.updateMatrixWorld(true); dir.transformDirection(ROOM.tv.matrixWorld); }
      return { x: w.x, y: w.y, z: w.z, nx: dir.x, nz: dir.z, w: 1.92, h: 1.08 };
    },
  };
})();
