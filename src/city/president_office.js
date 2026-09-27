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
   blinks and the handset rattles in its cradle. Walk up and "Answer the
   phone": the handset comes up to your ear and the caller talks. Callers are
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
   department, the day). "Open the folder" lays it open flat, the camera
   leans down over your shoulder and the page is the text: a typed memo,
   FROM / TO / SUBJECT, a body that quotes the current state, and a
   recommendation. "Sign it" inks your signature and a stamp onto the page,
   runs the order and drops the folder in the out-tray. "Send it back"
   stamps it RETURNED. If the order cannot run, a yellow note on the page
   says why and signing is not offered. Folders left unsigned at the end
   of the day are their own consequence.

   THE TV. A wall-mounted set on the side wall, in view of the chair, shows
   a live news broadcast painted onto a canvas: channel bug, clock, a
   studio with an anchor, a lower third, a scrolling ticker, and every so
   often an approval poll read off the real seat ("Approval 46%, down 3").
   It reports what actually happens (orders, attacks, raids, speeches,
   protests, lockdowns, your decisions). Other files push stories through
   CBZ.presidentOffice.news(). Only breaking items reach the phone's news
   app, and not more than once a minute.

   PEOPLE WALK IN. The Chief of Staff (a named, persistent person) walks in
   from the doorway, stops in front of the desk and talks to you: the day's
   schedule in words, missed calls, what the folders you ignored cost. When
   an attack is armed at the gate a military aide walks in; after a bad
   news cycle the press secretary does. A secretary stands at her desk
   outside the office door and has a word for you when you pass.

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

   PUBLIC: CBZ.presidentOffice = { offer, news, ringing, deskPoint, audit }.
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
  const TV_W = 512, TV_H = 288;
  const TV_HZ = 4;                 // repaint ceiling
  const TV_NEAR = 25;              // metres: beyond this the canvas is left alone
  const AIDE_TALK_R = 4.2;
  const DESK_TOP = 0.74;           // furniture.js bossDesk: worktop top above the floor
  const THRONE_BACK = 1.12;        // bossDesk: throne centre behind the desk centre (D/2 + 0.52)

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
    tv: null, tvTex: null, tvCanvas: null, tvWorld: null,
    tray: null,
  };

  function layout(rec) {
    const lm = rec.landmarks, A = rec.approach;
    const dl = toLocal(rec, lm.presidentialDesk.x, lm.presidentialDesk.z);
    const portal = lm.arrivalPortal ? toLocal(rec, lm.arrivalPortal.x, lm.arrivalPortal.z) : { x: 0, z: Math.min(7, Math.max(5.8, A.depth * 0.22)) };
    const dep = A.depth, half = A.span / 2;
    // TV: on the credenza wall (lateral -span/2 = local +x), past the second
    // credenza and short of the sconce by the desk, in front of the chair.
    const lo = portal.z + 7.4 + 0.98 + 1.0 + 0.25;
    const hi = dep - 3.4 - 0.35 - 1.0;
    let tvZ = Math.max(lo, Math.min(hi, dep - 7.5));
    if (lo > hi) tvZ = hi;
    return {
      desk: { x: dl.x, z: dl.z },
      portalZ: portal.z,
      dep: dep, half: half,
      tv: { x: half, z: tvZ, y: 1.95 },
      // desk-frame positions (x = reader's right, z = toward the chair).
      // interior_programs.js still draws two placeholder boxes on this desk:
      // a black box (0.48 x 0.28, 0.03..0.17 over the top) with a brass bar
      // on it at lateral -0.82, and a brass slab (0.62 x 0.42, 0.055..0.105)
      // at +0.82. That file is not ours, so the real objects SWALLOW them:
      // the phone's console is built over the black box and the brass bar
      // becomes its handset rest; the day's folders sit in a brass-lined
      // tray whose floor is the old slab.
      phone: { x: 0.82, z: 0.0 },
      pile: { x: -0.82, z: 0.0 },
      tray: { x: 0.40, z: 0.33 },
      open: { x: 0.0, z: 0.26 },
      // people
      aideSpawn: { x: 0, z: 1.0 },
      aideStand: { x: 0, z: dl.z - 2.05 },
      secDesk: { x: -Math.min(3.4, half - 1.4), z: Math.max(1.4, portal.z - 2.0) },
      secPost: { x: -Math.min(4.25, half - 0.6), z: Math.max(1.4, portal.z - 2.0) },
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
    if (ROOM.tvTex) { try { ROOM.tvTex.dispose(); } catch (e) {} }
    ROOM.rec = null; ROOM.builtFor = null; ROOM.key = ""; ROOM.frame = null; ROOM.desk = null;
    ROOM.phone = null; ROOM.handset = null; ROOM.lamp = null; ROOM.tv = null; ROOM.tvTex = null; ROOM.tvCanvas = null;
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
    desk.position.set(L.desk.x, DESK_TOP, L.desk.z);
    grp.add(desk);
    ROOM.desk = desk;

    buildPhone(desk, L.phone);
    buildInTray(desk, L.pile);
    buildTray(desk, L.tray);
    buildTV(grp, L.tv);
    buildSecretaryDesk(grp, L);
    grp.updateMatrixWorld(true);
    const tvw = new THREE.Vector3(L.tv.x - 0.33, L.tv.y, L.tv.z);
    grp.localToWorld(tvw);
    ROOM.tvWorld = { x: tvw.x, y: tvw.y, z: tvw.z };
    layoutFolders();
    paintTVNow();
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
  function buildTV(grp, at) {
    const tv = new THREE.Group();
    tv.position.set(at.x, at.y, at.z);
    grp.add(tv);
    // wall bracket (hidden behind the set), then the set, then the glass
    box(tv, -0.14, 0, 0, 0.24, 0.32, 0.42, 0x2c2f33);
    box(tv, -0.29, 0, 0, 0.06, 1.16, 2.04, 0x0d0e10);                  // body, 0.26..0.32 off the wall
    box(tv, -0.305, -0.555, 0, 0.035, 0.05, 2.04, 0x16181b);           // chin
    const cv = makeCanvas(TV_W, TV_H);
    const tex = canvasTex(cv);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 1.08), new THREE.MeshBasicMaterial({ map: tex }));
    scr.position.set(-0.3225, 0.02, 0);
    scr.rotation.y = -Math.PI / 2;        // faces into the room (local -x)
    tv.add(scr);
    // a tiny standby LED under the glass
    box(tv, -0.324, -0.545, 0.9, 0.004, 0.012, 0.02, 0x66ff88, { emissive: 0x33ff66, ei: 0.8 });
    ROOM.tv = tv; ROOM.tvTex = tex; ROOM.tvCanvas = cv;
  }

  // ---- the secretary's desk, outside the door -----------------------------
  function buildSecretaryDesk(grp, L) {
    const d = new THREE.Group();
    d.position.set(L.secDesk.x, 0, L.secDesk.z);
    grp.add(d);
    const WOOD = 0x4a2f1d;
    box(d, 0, 0.36, 0, 0.62, 0.72, 1.35, WOOD);                          // modesty body (desk runs along the depth)
    box(d, 0, 0.745, 0, 0.72, 0.05, 1.45, 0x5b3b25);                     // top
    // her side is local -x (she stands between the desk and the wall)
    box(d, -0.12, 0.795, -0.35, 0.30, 0.05, 0.36, 0x1b1e23);             // her phone console
    box(d, -0.12, 0.776, 0.25, 0.26, 0.012, 0.34, 0xece8dc);             // a pad of paper
    box(d, 0.20, 0.95, 0.45, 0.05, 0.36, 0.05, 0x8d7a4f);                // lamp stem
    box(d, 0.20, 1.18, 0.45, 0.22, 0.10, 0.22, 0xe8d9a8, { emissive: 0xffd28a, ei: 0.55 });
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
  function offer(matter) {
    if (!seated()) return null;
    const m = normalize(matter);
    if (!m) return null;
    if (openIds()[m.id]) return m.id;
    let via = m.via;
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
    const UI = CBZ.campaignUI;
    if (!UI || !UI.say) { ignore(m, source); if (onDone) onDone(null); return; }
    let pr = null;
    try { pr = UI.say(who, line, choices); } catch (e) { pr = null; }
    if (!pr || !pr.then) { ignore(m, source); if (onDone) onDone(null); return; }
    pr.then(function (pick) {
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
        try { UI.say(who, clean(reply)); } catch (e) {}
        const tok = ++SAY_TOKEN;
        M.later.push({ at: CLOCK + 3.4, fn: function () { if (tok === SAY_TOKEN) clearSay(); } });
      }
      if (onDone) onDone(pick);
    });
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
    ped._presOffice = true;
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
        AIDE.phase = "talk"; AIDE.talking = true;
        const m = AIDE.m;
        if (CBZ.citySay) { try { CBZ.citySay(p, m.greet || (m.who.role === "chief" ? "Mr. President." : "Sir."), "#e8e2cf", 2.4); } catch (e) {} }
        converse(m, "aide", function () {
          AIDE.talking = false;
          M.later.push({ at: CLOCK + 2.6, fn: function () {
            if (!AIDE.ped || AIDE.phase !== "talk") return;
            AIDE.phase = "leave"; AIDE.t = 0; AIDE.stuck = 0; AIDE.lastD = Infinity;
            walkTo(AIDE.ped, AIDE.spawnW.x, AIDE.spawnW.z);
          } });
        });
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
    const w = toWorld(rec, L.secPost.x, L.secPost.z);
    const look = toWorld(rec, 0, L.secPost.z);
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(w.x, w.z, {
        job: "secretary", archetype: "professional", gender: "f", armed: false, aggr: 0.02, wealth: 0.55,
        pin: true, floorY: rec.floorY, face: Math.atan2(look.x - w.x, look.z - w.z), src: "presoffice:secretary",
      });
    } catch (e) { ped = null; }
    if (!ped) return;
    ped.name = person("secretary").name; ped.nameKnown = true; ped.organization = "state";
    SEC.ped = ped;
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
    let line;
    const live = liveFolders();
    if (!seated()) line = "Can I help you?";
    else if (M.ringing) line = "Your line's ringing, sir.";
    else if (M.missed.length) line = speaker(M.missed[M.missed.length - 1].who, false) + " tried to reach you, sir.";
    else if (live) line = live === 1 ? "There's one folder waiting on your desk." : "There are " + live + " folders on your desk, sir.";
    else { const hr = hour(); line = hr < 12 ? "Good morning, Mr. President." : hr < 18 ? "Good afternoon, Mr. President." : "Working late, sir?"; }
    if (CBZ.citySay) { try { CBZ.citySay(p, line, "#e8e2cf", 3.0); } catch (e) {} }
  }

  // ============================================================
  //  §8  THE NEWS. A painted broadcast on the office TV.
  // ============================================================
  const TV = {
    stories: [], cur: null, curAt: 0, breakingUntil: 0, pollUntil: 0, nextPoll: 20,
    pollPrev: null, pollShown: null, lastPaint: -1, dirty: true, lastPhone: -1e9, tick: 0,
  };
  function news(headline, opts) {
    opts = opts || {};
    const h = clean(headline);
    if (!h) return false;
    for (let i = TV.stories.length - 1; i >= 0 && i >= TV.stories.length - 4; i--) {
      if (TV.stories[i].h.toUpperCase() === h.toUpperCase() && CLOCK - TV.stories[i].t < 8) return false;   // the same story twice in a breath
    }
    const s = { h: h, sub: clean(opts.sub || ""), kind: opts.kind === "breaking" ? "breaking" : "story", cat: clean(opts.cat || ""), t: CLOCK, day: day() };
    TV.stories.push(s);
    if (TV.stories.length > 12) TV.stories.shift();
    if (s.kind === "breaking") {
      TV.cur = s; TV.curAt = CLOCK; TV.breakingUntil = CLOCK + 20;
      if (!opts.quiet && CLOCK - TV.lastPhone > 60 && CBZ.phoneNotify) {
        TV.lastPhone = CLOCK;
        try { CBZ.phoneNotify({ app: "news", from: "News One", text: h, priority: 1 }); } catch (e) {}
      }
    } else if (!TV.cur || CLOCK > TV.breakingUntil) { TV.cur = s; TV.curAt = CLOCK; }
    if (opts.poll) { TV.pollUntil = CLOCK + 8; TV.nextPoll = CLOCK + 40; TV.pollShown = pollNow(); }
    paintTVNow();
    return true;
  }
  // one paint right now, no frame loop needed (build, every story, harness)
  function paintTVNow() {
    if (!ROOM.tvCanvas) { TV.dirty = true; return; }
    TV.lastPaint = CLOCK; TV.dirty = false;
    try { paintTV(ROOM.tvCanvas.getContext("2d")); ROOM.tvTex.needsUpdate = true; } catch (e) {}
  }
  function rotateStory() {
    if (CLOCK < TV.breakingUntil) return;
    if (TV.cur && CLOCK - TV.curAt < 9) return;
    const recent = TV.stories.slice(-6);
    if (!recent.length) { TV.cur = fillerStory(); TV.curAt = CLOCK; return; }
    const i = TV.cur ? recent.indexOf(TV.cur) : -1;
    TV.cur = recent[(i + 1 + recent.length) % recent.length];
    if (TV.cur.kind === "breaking" && CLOCK - TV.cur.t > 60) TV.cur = { h: TV.cur.h, sub: TV.cur.sub, kind: "story", cat: TV.cur.cat, t: TV.cur.t };
    TV.curAt = CLOCK;
  }
  function fillerStory() {
    const s = status();
    if (s && s.seat) return { h: "Day " + s.day + " of the new administration", sub: "The President at work in the West Wing", kind: "story", cat: "POLITICS" };
    if (s && s.country) return { h: "Quiet day in the capital", sub: s.country, kind: "story", cat: "NATION" };
    return { h: "Quiet day in the capital", sub: "", kind: "story", cat: "NATION" };
  }
  function tvShouldPaint(rec) {
    const Pp = player(), w = ROOM.tvWorld;
    if (!Pp || !Pp.pos || !w) return false;
    if (Math.abs(Pp.pos.y - w.y) > 3.5) return false;
    return Math.hypot(Pp.pos.x - w.x, Pp.pos.z - w.z) < TV_NEAR;
  }
  function pollNow() {
    const s = status();
    if (!s || !s.seat) return null;
    const ap = Math.round(s.approval || 0);
    const prev = TV.pollPrev == null ? ap : TV.pollPrev;
    TV.pollPrev = ap;
    return { ap: ap, d: ap - prev, treasury: s.treasury || 0 };
  }
  function tickTV(dt) {
    if (!ROOM.tvCanvas) return;
    rotateStory();
    if (CLOCK >= TV.nextPoll && seated()) {
      TV.nextPoll = CLOCK + 45;
      TV.pollUntil = CLOCK + 8;
      TV.pollShown = pollNow();
    }
    if (!tvShouldPaint(ROOM.rec)) return;
    if (CLOCK - TV.lastPaint < 1 / TV_HZ && !TV.dirty) return;
    TV.lastPaint = CLOCK; TV.dirty = false;
    paintTV(ROOM.tvCanvas.getContext("2d"));
    ROOM.tvTex.needsUpdate = true;
  }
  function paintTV(c) {
    const W = TV_W, H = TV_H, t = CLOCK;
    // the studio: deep blue set, a lit backdrop panel and a skyline strip
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1d3d"); bg.addColorStop(1, "#06101f");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(90,140,220,.14)";
    for (let i = 0; i < 9; i++) c.fillRect(20 + i * 56, 26, 34, 150);
    c.fillStyle = "rgba(255,255,255,.05)";
    c.beginPath(); c.arc(150, 100, 86, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(160,200,255,.12)"; c.lineWidth = 1;
    for (let i = -3; i <= 3; i++) { c.beginPath(); c.ellipse(150, 100, 86, Math.abs(i) * 14 + 4, 0, 0, Math.PI * 2); c.stroke(); }
    // skyline silhouette behind the desk
    c.fillStyle = "#0f2446";
    for (let i = 0; i < 16; i++) { const bh = 20 + ((i * 37) % 50); c.fillRect(i * 32, 176 - bh, 28, bh); }
    drawAnchor(c, 150, t);
    // the news desk
    const dk = c.createLinearGradient(0, 178, 0, 240);
    dk.addColorStop(0, "#1a2f55"); dk.addColorStop(1, "#0a1428");
    c.fillStyle = dk; c.fillRect(40, 182, 230, 58);
    c.fillStyle = "#c0392b"; c.fillRect(40, 182, 230, 4);
    // the right-hand graphic: a poll, or the story's topic card
    drawSideGraphic(c, t);
    // channel bug + clock
    c.fillStyle = "#c0392b"; c.fillRect(12, 10, 86, 24);
    c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText("NEWS ONE", 18, 23);
    c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(100, 10, 40, 24);
    c.fillStyle = "#ff4d3d"; c.beginPath(); c.arc(110, 22, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.font = "bold 12px Arial, sans-serif"; c.fillText("LIVE", 117, 23);
    const hr = hour(), hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
    c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(W - 70, 10, 58, 24);
    c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif"; c.textAlign = "center";
    c.fillText((hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm, W - 41, 23);
    // lower third
    const s = TV.cur || fillerStory();
    const brk = s.kind === "breaking" && t < TV.breakingUntil;
    c.textAlign = "left";
    if (brk) {
      c.fillStyle = (Math.floor(t * 2) % 2) ? "#e0301e" : "#c0271a";
      c.fillRect(0, 200, 112, 26);
      c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif"; c.fillText("BREAKING", 12, 214);
    } else if (s.cat) {
      c.fillStyle = "#1d4f9c"; c.fillRect(0, 200, 112, 26);
      c.fillStyle = "#fff"; c.font = "bold 13px Arial, sans-serif"; c.fillText(s.cat.slice(0, 12).toUpperCase(), 12, 214);
    }
    c.fillStyle = "rgba(245,245,245,.96)"; c.fillRect(0, 226, W, 32);
    c.fillStyle = "#101010"; c.font = "bold 19px Arial, sans-serif";
    fitText(c, s.h.toUpperCase(), 12, 243, W - 24, 19);
    // ticker
    c.fillStyle = "#0a0f19"; c.fillRect(0, 258, W, 30);
    c.fillStyle = "#f4c542"; c.fillRect(0, 258, 58, 30);
    c.fillStyle = "#0a0f19"; c.font = "bold 12px Arial, sans-serif"; c.fillText("LATEST", 8, 274);
    const items = tickerItems();
    const txt = items.join("     ");
    c.save(); c.beginPath(); c.rect(60, 258, W - 60, 30); c.clip();
    c.fillStyle = "#e9eef5"; c.font = "14px Arial, sans-serif";
    const tw = Math.max(200, c.measureText(txt + "     ").width);
    const off = (t * 55) % tw;
    c.fillText(txt, 66 - off, 274);
    c.fillText(txt, 66 - off + tw, 274);
    c.restore();
  }
  function fitText(c, s, x, y, maxW, size) {
    let sz = size;
    c.font = "bold " + sz + "px Arial, sans-serif";
    while (c.measureText(s).width > maxW && sz > 11) { sz--; c.font = "bold " + sz + "px Arial, sans-serif"; }
    if (c.measureText(s).width > maxW) { while (s.length > 4 && c.measureText(s + "...").width > maxW) s = s.slice(0, -1); s += "..."; }
    c.fillText(s, x, y);
  }
  function tickerItems() {
    const out = [];
    const st = status();
    if (st && st.seat) {
      out.push("Approval " + Math.round(st.approval || 0) + "%");
      out.push("Treasury " + money(st.treasury));
      if (st.wall && st.wall.ordered) out.push("Saltlands wall " + st.wall.built + " of " + st.wall.total + " sections");
      if (st.election && st.election.voteDay != null && st.election.voteDay >= st.day) out.push("Election on day " + st.election.voteDay);
      if (st.threat && st.threat.members > 0) out.push("Security services on alert");
    }
    for (let i = TV.stories.length - 1; i >= 0 && out.length < 9; i--) out.push(TV.stories[i].h);
    if (!out.length) out.push("Markets steady", "Mild weather across the capital");
    return out;
  }
  function drawAnchor(c, cx, t) {
    // body: a dark suit, white collar, a tie; head with a slight nod while talking
    const nod = Math.sin(t * 1.7) * 1.2, talk = (Math.floor(t * 6) % 3) ? 1 : 0;
    c.fillStyle = "#1b1f2a";
    c.beginPath();
    c.moveTo(cx - 62, 186); c.lineTo(cx - 50, 146); c.quadraticCurveTo(cx, 132, cx + 50, 146); c.lineTo(cx + 62, 186); c.closePath(); c.fill();
    c.fillStyle = "#f2f2f2";
    c.beginPath(); c.moveTo(cx - 13, 140); c.lineTo(cx, 166); c.lineTo(cx + 13, 140); c.closePath(); c.fill();
    c.fillStyle = "#8e2430";
    c.beginPath(); c.moveTo(cx - 4, 146); c.lineTo(cx + 4, 146); c.lineTo(cx + 6, 172); c.lineTo(cx, 178); c.lineTo(cx - 6, 172); c.closePath(); c.fill();
    c.fillStyle = "#c79a7a";                                 // neck
    c.fillRect(cx - 9, 124 + nod, 18, 18);
    c.beginPath(); c.ellipse(cx, 104 + nod, 21, 26, 0, 0, Math.PI * 2); c.fill();   // head
    c.fillStyle = "#3a2a1f";                                 // hair
    c.beginPath(); c.ellipse(cx, 88 + nod, 22, 13, 0, Math.PI, Math.PI * 2); c.fill();
    c.fillRect(cx - 22, 86 + nod, 5, 14); c.fillRect(cx + 17, 86 + nod, 5, 14);
    c.fillStyle = "#2a1d16";                                 // eyes, brows
    c.fillRect(cx - 10, 101 + nod, 5, 3); c.fillRect(cx + 5, 101 + nod, 5, 3);
    c.fillRect(cx - 11, 96 + nod, 7, 2); c.fillRect(cx + 4, 96 + nod, 7, 2);
    c.fillStyle = "#7d3b34";                                 // mouth
    c.fillRect(cx - 6, 116 + nod, 12, 2 + talk * 2);
  }
  function drawSideGraphic(c, t) {
    const x = 300, y = 44, w = 196, h = 138;
    c.fillStyle = "rgba(8,18,36,.85)"; c.fillRect(x, y, w, h);
    c.strokeStyle = "rgba(160,200,255,.35)"; c.lineWidth = 2; c.strokeRect(x, y, w, h);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    if (t < TV.pollUntil && TV.pollShown) {
      const p = TV.pollShown;
      c.fillStyle = "#9fc4ff"; c.font = "bold 14px Arial, sans-serif"; c.fillText("NEW POLL", x + 12, y + 24);
      c.fillStyle = "#fff"; c.font = "bold 16px Arial, sans-serif"; c.fillText("APPROVAL", x + 12, y + 48);
      c.font = "bold 44px Arial, sans-serif"; c.fillText(p.ap + "%", x + 12, y + 96);
      const dtxt = p.d === 0 ? "NO CHANGE" : (p.d < 0 ? "DOWN " + (-p.d) : "UP " + p.d);
      c.fillStyle = p.d < 0 ? "#ff6b5b" : (p.d > 0 ? "#6be38a" : "#cfd8e6");
      c.font = "bold 16px Arial, sans-serif"; c.fillText(dtxt, x + 118, y + 90);
      c.fillStyle = "rgba(255,255,255,.15)"; c.fillRect(x + 12, y + 110, w - 24, 12);
      c.fillStyle = p.ap < 35 ? "#e0473a" : (p.ap < 50 ? "#f4c542" : "#4fb46b");
      c.fillRect(x + 12, y + 110, (w - 24) * Math.max(0, Math.min(1, p.ap / 100)), 12);
      return;
    }
    const s = TV.cur || fillerStory();
    const st = status();
    c.fillStyle = "#9fc4ff"; c.font = "bold 13px Arial, sans-serif";
    c.fillText((s.cat || "TODAY").toUpperCase(), x + 12, y + 24);
    c.fillStyle = "#fff"; c.font = "bold 17px Arial, sans-serif";
    let yy = wrap(c, s.h, x + 12, y + 50, w - 24, 20, 3);
    if (s.sub) { c.fillStyle = "#cfd8e6"; c.font = "13px Arial, sans-serif"; wrap(c, s.sub, x + 12, yy + 4, w - 24, 16, 2); }
    else if (st && st.seat && /TREASURY|ECONOMY|TAX/.test((s.cat || "").toUpperCase())) {
      c.fillStyle = "#6be38a"; c.font = "bold 18px Arial, sans-serif"; c.fillText("Treasury " + money(st.treasury), x + 12, yy + 14);
    }
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
      line: "Sir, the treasury is down to " + money(s.treasury) + ". Every order you give draws on it. I need a tax rise.",
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
      greet: "Sir, a moment.",
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
    M.chiefDay = day();
    const s = S();
    const bits = [];
    if (first) bits.push("Mr. President. Welcome to your office. The phone on your desk is how the cabinet reaches you, and the folders are today's business.");
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
      SPAWN.pending = true; SPAWN.until = CLOCK + 30; SPAWN.relocs = 0; SPAWN.settle = 0;
      M.phoneQ.length = 0; M.aideQ.length = 0; M.missed.length = 0; M.flags = {};
      M.morningDay = day(); M.chiefDay = day();      // the welcome below IS today's visit
      M.approvalMorning = null;
      // the headline itself arrives through presidency.js's big() -> news()
      TV.pollPrev = null;
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
  const SPAWN = { pending: false, until: 0, relocs: 0, settle: 0, sessionChecked: false, lastReloc: -1e9 };
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
        SPAWN.pending = true; SPAWN.until = CLOCK + 20; SPAWN.relocs = 0; SPAWN.settle = 0;
        if (M.morningDay !== day()) { M.morningDay = day(); M.later.push({ at: CLOCK + 5, fn: function () { chiefVisit(false); } }); }
      }
    }
    if (!SPAWN.pending) return;
    if (CLOCK > SPAWN.until) { SPAWN.pending = false; return; }
    if (!rec || !Pp || !Pp.pos || Pp.dead || Pp.driving) return;
    SPAWN.sessionChecked = true;
    const dp = deskPoint();
    const at = Math.abs(Pp.pos.y - rec.floorY) < 1.2 && Math.hypot(Pp.pos.x - dp.x, Pp.pos.z - dp.z) < 1.6;
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
  function wireZones() {
    if (zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesWired = true;
    CBZ.interactions.registerZone({
      id: "presoffice-phone", kind: "presphone", radius: 2.3, prio: 15,
      find: function (px, pz) {
        if (!M.ringing || !ROOM.phone || !ROOM.rec) return null;
        const w = phoneWorld();
        if (!w || !yGate(ROOM.rec.floorY)) return null;
        const dx = w.x - px, dz = w.z - pz;
        return dx * dx + dz * dz < 2.3 * 2.3 ? { x: w.x, y: w.y, z: w.z, kind: "presphone" } : null;
      },
      options: [{
        id: "presoffice-answer", slot: "e", prio: 20, campaignSafe: true,
        label: "Answer the phone",
        canShow: function () { return !!M.ringing; },
        onSelect: function () { answer(); },
      }],
    });
    CBZ.interactions.registerZone({
      id: "presoffice-folders", kind: "presfolder", radius: 2.2, prio: 14,
      find: function (px, pz) {
        if (!ROOM.desk || !ROOM.rec || !ROOM.L) return null;
        if (!READ.f && !topFolder()) return null;
        if (READ.closing) return null;
        if (!yGate(ROOM.rec.floorY)) return null;
        const L = ROOM.L;
        const w = READ.f ? deskWorld(L.open.x, 0.01, L.open.z) : deskWorld(L.pile.x, PILE_Y, L.pile.z);
        if (!w) return null;
        const dx = w.x - px, dz = w.z - pz;
        return dx * dx + dz * dz < 2.2 * 2.2 ? { x: w.x, y: w.y, z: w.z, kind: "presfolder" } : null;
      },
      options: [{
        id: "presoffice-folder-e", slot: "e", prio: 20, campaignSafe: true,
        label: function () {
          if (!READ.f) return "Open the folder";
          return READ.f.blocked ? "Close the folder" : "Sign it";
        },
        onSelect: function () {
          if (!READ.f) { openFolder(topFolder()); return; }
          if (READ.f.blocked) shutFolder(); else signFolder();
        },
      }, {
        id: "presoffice-folder-i", slot: "i", prio: 20, campaignSafe: true,
        label: "Send it back",
        canShow: function () { return !!READ.f && READ.f.state === "open"; },
        onSelect: function () { returnFolder(); },
      }],
    });
    if (CBZ.interactions.describe) {
      try {
        CBZ.interactions.describe("presphone", function () { return { label: "Desk phone", note: M.ringing ? "ringing" : "" }; });
        CBZ.interactions.describe("presfolder", function () { return { label: READ.f ? READ.f.m.memo.subject : "Briefing folders", note: "" }; });
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
    tickTV(dt);
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
      aide: AIDE.phase, folders: M.folders.map(function (f) { return { id: f.m.id, topic: f.m.topic, state: f.state, blocked: !!f.blocked }; }),
      reading: !!READ.f, stories: TV.stories.length, headline: TV.cur ? TV.cur.h : null,
      secretary: !!SEC.ped, decisions: M.decisions, missed: M.missed.length, spawnPending: SPAWN.pending,
      desk: deskPoint(),
    };
  }
  CBZ.presidentOffice = {
    offer: offer,
    news: news,
    ringing: function () { return !!M.ringing; },
    deskPoint: deskPoint,
    audit: audit,
    // harness hooks only
    _M: M, _room: ROOM, _answer: answer, _open: function () { openFolder(topFolder()); }, _sign: signFolder,
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
      paintTVNow();
      // the glass faces into the room: +lateral of the approach frame
      return { x: w.x, y: w.y, z: w.z, nx: r.approach.tx, nz: r.approach.tz, w: 1.92, h: 1.08 };
    },
  };
})();
