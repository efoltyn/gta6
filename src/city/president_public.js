/* ============================================================
   city/president_public.js — THE PRESIDENT'S PUBLIC LIFE, IN THE WORLD.

   The President used to have approval as a number and nothing else. This
   file makes power something you can SEE in bodies:

   1. A REAL DIARY. schedule(day) is the President's public programme for
      that calendar day: one or two appearances, deterministic off the world
      seed (CBZ.hash01), so Hitman mode can plan a hit off it and the
      appearance really happens at the time it says. Three kinds:
        speech    - the Mansion balcony most days, sometimes a rally in a
                    real park or on the Capitol plaza
        motorcade - a drive out to a real place and straight back
        visit     - a drive to the Capitol, City Hall, Defence HQ ... a short
                    stay, and back
      A lockdown cancels what is left of the day (cancelled: true).

   2. THE BALCONY. A Truman-style speaking balcony is built here on the
      Mansion's front facade, over the front door, between the two columns
      that flank the doorway: stone deck at the upper floor, a balustrade, two
      corbels under it, a lectern with the seal, two flags, and a BULLETPROOF
      glass screen that goes up in front of the lectern for a speech (a
      losBlocker while it is up, with the balustrade under it). You reach it from the
      state residence upstairs ("Step out"); "Go
      inside" takes you in again.

   3. THE CROWD. For a speech a crowd gathers on the motor court in front of
      the house (or round the rally stage). Its SIZE is the approval rating:
      a handful at 20%, three dozen at 80%. Supporters wave small flags and a
      few hold FOUR MORE YEARS boards; protesters, a bigger share the lower the
      rating and after unpopular orders and attacks, hold signs over their
      heads whose words are what actually happened (NO CURFEW, SOLDIERS OUT,
      WHERE IS THE MONEY ...). They face the balcony and cheer or boo each beat,
      out loud: audio.js crowdVoice, the cheer/boo balance set by approval.

   4. THE SPEECH. When you are the President your Chief of Staff comes to find
      you about 20 seconds before, and you have to physically go. At the
      lectern you give a 3 beat speech; each beat you pick one of two stances
      that fit the moment (read off the real state: attacks, curfew, soldiers,
      treasury, emergency powers) and the crowd answers. Approval moves by how
      well each stance fits. Skip it and the crowd waits, drifts off, and it
      is on the news. An NPC President walks out and does the same by himself.

   5. PROTESTS. When approval is low or after an unpopular order, a protest
      forms OUTSIDE the Mansion gate on the approach road, with signs and
      chanting, for a few minutes. If police or soldiers are deployed a line
      of them stands between it and the gate. A crackdown or soldiers on the
      street breaks it up and people run.

   6. THE STATE ON THE STREET. statecraft.js already puts real troopers at the
      martial-law point and adds real cops to the police pool for a surge. What
      nobody showed was the CURFEW (at night you now meet checkpoints: a
      cruiser, two officers, cones), the surge on YOUR corner (officer pairs
      near you), soldiers where you actually are, and a LOCKDOWN (roadblock on
      the Mansion approach road, soldiers at the gate). All within ~150 m of
      the player, budgeted, and taken down cleanly.

   Budget: every body this file owns counts against one cap (~50). Nothing
   spawns unless the player is near. One CanvasTexture per distinct sign text.
   Idle cost: one cheap check every quarter second.

   PUBLIC: CBZ.presidentPublic = { schedule(day), now(), crowd(), balcony(),
   protests(), evacuate() } plus harness-only _startNow/_speechBeat/_protestNow.
   Bus (CBZ.presidency.emit): "appearance" {kind, phase, place},
   "speech" {crowd, supporters, protesters, approvalDelta},
   "protest" {phase, size, at}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;

  // ============================================================
  //  §0  SMALL THINGS
  // ============================================================
  // THE CLOCK IS THE SKY (CBZ.dayTime, days): appearances are a timetable
  // keyed to the hour — the 8am balcony speech happens at 8am. Durations are
  // stated in REAL seconds and converted with sec(). Memory windows (how long
  // a crackdown is remembered, how long a protest lasts) are GAMEPLAY pace,
  // stated in PACE days (core/daynight.js, 150 real s each) via pace(), so the
  // city's 48-minute sky day does not make the street 19x slower to forget.
  function sec(s) { return s / CBZ.dayCycleSeconds(); }        // real seconds -> dayTime units
  function pace(d) { return sec(d * CBZ.PACE_DAY_SECONDS); }   // pace days -> dayTime units
  function now() { return CBZ.dayTime ? CBZ.dayTime() : 0; }
  function clockHour(t) { const f = ((t % 1) + 1) % 1; return (f * 24 + 6) % 24; } // phase 0 = 06:00
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : ((Math.sin(a * 12.9898 + b * 78.233 + salt) * 43758.5453) % 1 + 1) % 1; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function inCity() { return !!(g && g.mode === "city"); }
  function Pres() { return CBZ.presidency || null; }
  function emit(evt, payload) { const p = Pres(); if (p && p.emit) { try { p.emit(evt, payload); } catch (e) {} } }
  function current() {
    const p = Pres();
    if (p && p.current) { try { return p.current() || { kind: "vacant" }; } catch (e) {} }
    return { kind: "vacant" };
  }
  function site() {
    const p = Pres();
    if (p && p.site) { try { const s = p.site(); if (s) return s; } catch (e) {} }
    const L = CBZ.govComplexes;
    if (Array.isArray(L)) for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    return null;
  }
  function complex(id) {
    const L = CBZ.govComplexes;
    if (Array.isArray(L)) for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id && L[i].rect) return L[i];
    return null;
  }
  function seatId() {
    const p = Pres();
    if (p && p.seat) { try { const h = p.seat(); if (h && h.id) return h.id; } catch (e) {} }
    return null;
  }
  function countryRec() {
    const c = current();
    if (c && c.seatId && CBZ.polity && CBZ.polity.get) { try { const r = CBZ.polity.get(c.seatId); if (r) return r; } catch (e) {} }
    return null;
  }
  function approval() { const r = countryRec(); return r && isFinite(r.approval) ? clamp(r.approval, 0, 100) : 50; }
  function status() {
    const p = Pres();
    if (p && p.status) { try { return p.status() || {}; } catch (e) {} }
    return {};
  }
  function playerPres() { return current().kind === "player"; }
  function shock(delta) { const id = seatId(); if (id && CBZ.approvalShock && isFinite(delta) && delta) { try { CBZ.approvalShock(id, delta); } catch (e) {} } }
  function news(headline, kind) {
    const O = CBZ.presidentOffice;
    if (O && typeof O.news === "function") { try { O.news(headline, { kind: kind || "story" }); } catch (e) {} }
  }
  function say(ped, text, color, secs) { if (ped && !ped.dead && text && CBZ.citySay) { try { CBZ.citySay(ped, text, color || "#e8ecf4", secs || 2.6); } catch (e) {} } }
  function playerPos() { const P = CBZ.player; return P && P.pos ? P.pos : null; }
  function distXZ(a, x, z) { return a ? Math.hypot(a.x - x, a.z - z) : Infinity; }
  function faceTo(px, pz, tx, tz) { return Math.atan2(tx - px, tz - pz); }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function pick(list, a, b, salt) { return list[Math.floor(h01(a, b, salt) * list.length) % list.length]; }
  function rpick(list) { return list[(Math.random() * list.length) | 0]; }   // runtime feel only
  function surname(n) { const p = String(n || "").trim().split(/\s+/); return p[p.length - 1] || ""; }
  function isNight() { const h = CBZ.citySunHour ? CBZ.citySunHour() : clockHour(now()); return h >= 23 || h < 5; }

  // ============================================================
  //  §1  THE BALCONY — geometry derived from the Mansion front the header of
  //  president_regime.js documents: facade plane z = cz-17, doorway columns
  //  at t = +/-5.44 (R 0.42), entablature a thin band 0.34-0.52 m deep from
  //  4.29 up. The deck sits at the upper floor, 3.5 m out, 9.8 m wide.
  // ============================================================
  const B = {
    builtFor: null, group: null, glass: null, shield: null, glassCol: null, cols: [], plats: [],
    deckY: 3.35, floorY: 3.2, facadeZ: 0, cx: 0, stand: null, lect: null, inside: null, door: null,
    zonesWired: false,
  };
  const MAT = {};
  function cm(hex) {
    if (CBZ.cmat) { try { return CBZ.cmat(hex); } catch (e) {} }
    return MAT[hex] || (MAT[hex] = new THREE.MeshLambertMaterial({ color: hex }));
  }
  const GEO = {};
  function boxG(w, h, d) {
    if (CBZ.boxGeom) { try { return CBZ.boxGeom(w, h, d); } catch (e) {} }
    const k = w + ":" + h + ":" + d;
    return GEO[k] || (GEO[k] = new THREE.BoxGeometry(w, h, d));
  }
  function box(parent, x, y, z, w, h, d, mat) {
    const m = new THREE.Mesh(boxG(w, h, d), typeof mat === "number" ? cm(mat) : mat);
    m.position.set(x, y, z); parent.add(m); return m;
  }
  function col(list, minX, maxX, minZ, maxZ, y0, y1) {
    const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0, y1: y1, _city: true };
    if (CBZ.colliders) CBZ.colliders.push(c);
    list.push(c);
    return c;
  }
  function uncol(c) {
    if (!c || !CBZ.colliders) return;
    const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1);
  }
  function dirtyCols() { if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} } }
  function dirtyPlats() { if (CBZ.markPlatformsDirty) { try { CBZ.markPlatformsDirty(); } catch (e) {} } }

  // ---- canvas textures (cached; one per distinct picture/text) ----------
  const TEX = {};
  function canvasTex(key, w, h, paint) {
    if (TEX[key]) return TEX[key];
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const cc = c.getContext("2d");
    try { paint(cc, w, h); } catch (e) {}
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 2;
    TEX[key] = t;
    return t;
  }
  function flagTex() {
    return canvasTex("flag", 128, 84, function (cc, w, h) {
      cc.fillStyle = "#1d3160"; cc.fillRect(0, 0, w, h);
      cc.fillStyle = "#f2efe6"; cc.fillRect(0, h * 0.36, w, h * 0.28);
      cc.fillStyle = "#a8262b"; cc.fillRect(0, h * 0.44, w, h * 0.12);
      cc.fillStyle = "#d8b24a"; star(cc, w * 0.2, h * 0.2, 9, 4);
    });
  }
  function star(cc, x, y, R, r) {
    cc.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
      cc.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    cc.closePath(); cc.fill();
  }
  function sealTex() {
    return canvasTex("seal", 128, 128, function (cc, w, h) {
      cc.clearRect(0, 0, w, h);
      cc.fillStyle = "#1b2a4d"; cc.beginPath(); cc.arc(64, 64, 60, 0, Math.PI * 2); cc.fill();
      cc.strokeStyle = "#d4b05a"; cc.lineWidth = 6; cc.beginPath(); cc.arc(64, 64, 55, 0, Math.PI * 2); cc.stroke();
      cc.lineWidth = 2; cc.beginPath(); cc.arc(64, 64, 45, 0, Math.PI * 2); cc.stroke();
      cc.fillStyle = "#d4b05a"; star(cc, 64, 60, 22, 9);
      // laurel: two arcs of leaves
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 7; i++) {
        const a = Math.PI / 2 + s * (0.35 + i * 0.28);
        cc.beginPath(); cc.ellipse(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, 5, 2.4, a, 0, Math.PI * 2); cc.fill();
      }
    });
  }
  // A SIGN IS A PIECE OF CARD SOMEBODY LETTERED BY HAND. Short plain words.
  function signTex(text, support) {
    const key = "sign:" + (support ? "s:" : "p:") + text;
    return canvasTex(key, 256, 160, function (cc, w, h) {
      cc.fillStyle = support ? "#f4f1e8" : "#efe6cf"; cc.fillRect(0, 0, w, h);
      cc.strokeStyle = support ? "#1d3160" : "#2a2622"; cc.lineWidth = 6; cc.strokeRect(5, 5, w - 10, h - 10);
      cc.fillStyle = support ? "#1d3160" : (text.length % 3 === 0 ? "#b32620" : "#1c1a18");
      cc.textAlign = "center"; cc.textBaseline = "middle";
      const words = text.split(" ");
      let lines = [text];
      if (text.length > 10 && words.length > 1) {
        const half = Math.ceil(words.length / 2);
        lines = [words.slice(0, half).join(" "), words.slice(half).join(" ")];
      }
      const size = lines.length > 1 ? 44 : 52;
      cc.font = "bold " + size + "px Impact, 'Arial Black', sans-serif";
      for (let i = 0; i < lines.length; i++) {
        let s = size;
        while (s > 22 && cc.measureText(lines[i]).width > w - 26) { s -= 3; cc.font = "bold " + s + "px Impact, 'Arial Black', sans-serif"; }
        cc.fillText(lines[i], w / 2, h / 2 + (i - (lines.length - 1) / 2) * (size + 6));
      }
    });
  }
  const SIGN_MATS = {};
  function signMats(text, support) {
    const key = (support ? "s:" : "p:") + text;
    if (SIGN_MATS[key]) return SIGN_MATS[key];
    const face = new THREE.MeshLambertMaterial({ map: signTex(text, support) });
    const edge = cm(0xb99a6a);
    SIGN_MATS[key] = [edge, edge, edge, edge, face, face];
    return SIGN_MATS[key];
  }
  let _flagMat = null, _glassMat = null;
  function flagMat() {
    if (!_flagMat) _flagMat = new THREE.MeshLambertMaterial({ map: flagTex(), side: THREE.DoubleSide });
    return _flagMat;
  }
  function glassMat() {
    if (!_glassMat) {
      _glassMat = new THREE.MeshPhongMaterial({ color: 0xcfe2ea, transparent: true, opacity: 0.2, shininess: 90, depthWrite: false });
      _glassMat._cbzGlass = true; _glassMat._shared = true;
    }
    return _glassMat;
  }

  function residenceFloorY() {
    if (!CBZ.presidentInteriorRooms) return null;
    try {
      const L = CBZ.presidentInteriorRooms() || [];
      for (let i = 0; i < L.length; i++) if (L[i] && L[i].key === "stateresidence" && isFinite(L[i].floorY)) return L[i].floorY;
    } catch (e) {}
    return null;
  }

  function teardownBalcony() {
    if (B.group && B.group.parent) B.group.parent.remove(B.group);
    for (let i = 0; i < B.cols.length; i++) uncol(B.cols[i]);
    if (B.glassCol) uncol(B.glassCol);
    paneBlocks(false);
    for (let i = 0; i < B.plats.length; i++) {
      const k = CBZ.platforms ? CBZ.platforms.indexOf(B.plats[i]) : -1;
      if (k >= 0) CBZ.platforms.splice(k, 1);
    }
    dirtyCols(); dirtyPlats();
    B.group = null; B.glass = null; B.shield = null; B.glassCol = null; B.cols = []; B.plats = []; B.builtFor = null;
  }

  function buildBalcony() {
    const s = site();
    const root = arenaRoot();
    if (!s || !root || !CBZ.colliders) return false;
    if (B.group && B.builtFor === CBZ.govComplexes) return true;
    teardownBalcony();
    const cx = s.cx, cz = s.cz;
    // the family floor and the front as govcomplex.js BUILT them (site.layout):
    // the house now stands at 4.5 m a storey under a colossal order, so the
    // deck is wherever that floor is, and it fits BETWEEN the door-bay
    // columns whatever their radius (a 9.8 m deck clipped the thicker shafts)
    const LY = s.layout || null, O = LY && LY.order;
    const fy = residenceFloorY() != null ? residenceFloorY() : (LY && LY.floorTops && LY.floorTops[1]);
    B.floorY = fy != null && fy > 2.4 && fy < 7.0 ? fy : 3.2;
    B.deckY = B.floorY + 0.15;                       // one threshold step up from the floor inside
    B.facadeZ = LY && isFinite(LY.facadeZ) ? LY.facadeZ : cz - 17;
    B.cx = cx;
    const D = B.deckY, F = B.facadeZ;
    let W = 9.8;
    if (O && O.colsX && O.colsX.length) {
      let inner = Infinity;
      for (let i = 0; i < O.colsX.length; i++) inner = Math.min(inner, Math.abs(O.colsX[i] - cx));
      if (isFinite(inner)) W = Math.min(9.8, 2 * (inner - O.R - 0.12));
    }
    const DEP = 3.5;
    const x0 = cx - W / 2, x1 = cx + W / 2, z0 = F, z1 = F + DEP;
    // the man at the lectern stands 1.65 m off the wall: clear of the 0.52 m
    // cornice band by more than a metre, so no head is ever inside the stone
    B.stand = { x: cx, y: D, z: F + 1.65 };
    B.lect = { x: cx, y: D, z: F + 2.35 };
    B.door = { x: cx, y: D, z: F + 1.05 };
    B.inside = { x: cx, y: B.floorY, z: F - 1.9 };

    const grp = new THREE.Group();
    grp.name = "presidential-balcony";
    root.add(grp);
    B.group = grp;
    const STONE = 0xe6e0d2, STONE_D = 0xcfc7b5, STONE_L = 0xefeae0, BRONZE = 0x6e5a36;

    // the deck: a slab with a moulded edge and a soffit band
    box(grp, cx, D - 0.13, (z0 + z1) / 2, W, 0.26, DEP, STONE);
    box(grp, cx, D - 0.30, z1 - 0.06, W + 0.16, 0.12, 0.2, STONE_D);             // drip moulding
    box(grp, cx, D - 0.30, (z0 + z1) / 2, 0.14, 0.12, DEP - 0.2, STONE_D);        // soffit rib
    box(grp, cx, D + 0.012, (z0 + z1) / 2 + 0.1, W - 0.9, 0.024, DEP - 0.9, 0x6d2a2e); // a runner of carpet

    // two stone corbels, stepped out of the wall like a scroll
    for (const sx of [-1, 1]) {
      const bx = cx + sx * Math.min(3.4, W / 2 - 0.35);   // inside the door bay's columns
      box(grp, bx, D - 1.05, F + 0.26, 0.52, 1.3, 0.52, STONE_D);
      box(grp, bx, D - 0.62, F + 0.62, 0.50, 0.55, 1.2, STONE);
      box(grp, bx, D - 0.38, F + 1.05, 0.48, 0.24, 2.0, STONE_L);
      box(grp, bx, D - 1.72, F + 0.22, 0.34, 0.12, 0.44, STONE);               // the scroll's toe
    }

    // balustrade: plinth, top rail, corner and centre piers, instanced balusters
    const RAIL_H = 1.05;
    box(grp, cx, D + 0.08, z1 - 0.14, W, 0.16, 0.28, STONE_D);
    box(grp, cx, D + RAIL_H - 0.05, z1 - 0.14, W + 0.1, 0.1, 0.34, STONE_L);
    for (const sx of [-1, 1]) {
      const ex = sx < 0 ? x0 + 0.14 : x1 - 0.14;
      box(grp, ex, D + 0.08, (z0 + z1) / 2 + 0.05, 0.28, 0.16, DEP - 0.1, STONE_D);
      box(grp, ex, D + RAIL_H - 0.05, (z0 + z1) / 2 + 0.05, 0.34, 0.1, DEP - 0.1, STONE_L);
    }
    for (const px of [x0 + 0.17, cx - 1.6, cx + 1.6, x1 - 0.17]) box(grp, px, D + RAIL_H / 2, z1 - 0.14, 0.34, RAIL_H, 0.34, STONE);
    for (const sx of [-1, 1]) box(grp, sx < 0 ? x0 + 0.17 : x1 - 0.17, D + RAIL_H / 2, z0 + 0.2, 0.34, RAIL_H, 0.34, STONE);
    const balPts = [];
    for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.3) {
      if (Math.abs(x - (cx - 1.6)) < 0.3 || Math.abs(x - (cx + 1.6)) < 0.3) continue;
      balPts.push([x, z1 - 0.14]);
    }
    for (const sx of [-1, 1]) for (let z = z0 + 0.5; z < z1 - 0.35; z += 0.3) balPts.push([sx < 0 ? x0 + 0.14 : x1 - 0.14, z]);
    const balGeo = new THREE.CylinderGeometry(0.055, 0.08, RAIL_H - 0.26, 8);
    const inst = new THREE.InstancedMesh(balGeo, cm(STONE), balPts.length);
    const M4 = new THREE.Matrix4();
    for (let i = 0; i < balPts.length; i++) {
      M4.makeTranslation(balPts[i][0], D + 0.16 + (RAIL_H - 0.26) / 2, balPts[i][1]);
      inst.setMatrixAt(i, M4);
    }
    inst.instanceMatrix.needsUpdate = true;
    grp.add(inst);

    // the lectern: walnut body, a slanted top, the seal on its face
    const L = B.lect;
    box(grp, L.x, D + 0.56, L.z, 0.64, 1.12, 0.46, 0x3a2a1e);
    box(grp, L.x, D + 0.03, L.z, 0.74, 0.06, 0.54, 0x2a1e16);
    const top = box(grp, L.x, D + 1.14, L.z - 0.02, 0.72, 0.05, 0.54, 0x4a3626);
    top.rotation.x = -0.22;
    const sm = new THREE.MeshLambertMaterial({ map: sealTex(), transparent: true });
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), sm);
    seal.position.set(L.x, D + 0.66, L.z + 0.232);
    grp.add(seal);
    box(grp, L.x, D + 1.2, L.z - 0.14, 0.03, 0.2, 0.03, 0x1a1a1a);             // the microphone stalk
    box(grp, L.x, D + 1.31, L.z - 0.1, 0.05, 0.05, 0.09, 0x111111);

    // two flags on standards behind and either side of the lectern
    for (const sx of [-1, 1]) {
      const px = cx + sx * 1.45, pz = F + 1.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 2.5, 8), cm(BRONZE));
      pole.position.set(px, D + 1.25, pz); grp.add(pole);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), cm(0xc9a24a));
      fin.position.set(px, D + 2.54, pz); grp.add(fin);
      box(grp, px, D + 0.05, pz, 0.32, 0.1, 0.32, BRONZE);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.24), flagMat());
      cloth.position.set(px - sx * 0.43, D + 1.78, pz);
      grp.add(cloth);
      box(grp, px - sx * 0.43, D + 2.42, pz, 0.86, 0.02, 0.02, BRONZE);          // the cross bar
    }

    // the glass: up for a speech, gone the rest of the time. It is
    // BULLETPROOF: while it is up the pane is a losBlocker, the one list both
    // the player's rounds (fpsmode wallDistance) and every NPC's line of fire
    // (city/los.js clearLineOfFire) are traced against, and `bulletproof`
    // stops fpsmode's thin-wall penetration. `mover` hangs any pock on the
    // glass itself, so the marks go away with it.
    const gl = new THREE.Group();
    gl.userData.mover = true;
    const pane = new THREE.Mesh(boxG(2.3, 1.2, 0.035), glassMat());
    pane.position.set(cx, D + RAIL_H + 0.62, z1 - 0.44);
    pane.userData.bulletproof = true;
    gl.add(pane);
    // the stone balustrade under it stops a round too (a steep shot from the
    // lawn crosses the rail, not the glass): an unseen block over the rail
    // in front of the lectern, a blocker only while the glass is up
    const rail = new THREE.Mesh(boxG(2.3, RAIL_H, 0.34), glassMat());
    rail.position.set(cx, D + RAIL_H / 2, z1 - 0.14);
    rail.visible = false;
    rail.userData.bulletproof = true;
    gl.add(rail);
    B.shield = [pane, rail];
    for (const sx of [-1, 1]) box(gl, cx + sx * 1.16, D + RAIL_H + 0.62, z1 - 0.44, 0.05, 1.24, 0.06, 0x2a2e33);
    box(gl, cx, D + RAIL_H + 0.02, z1 - 0.44, 2.36, 0.06, 0.1, 0x2a2e33);
    gl.visible = false;
    grp.add(gl);
    B.glass = gl;
    B.glassColSpec = [cx - 1.18, cx + 1.18, z1 - 0.5, z1 - 0.38, D + RAIL_H, D + RAIL_H + 1.25];

    // solids: three rails, the lectern. The deck is a PLATFORM (physics'
    // one standable-top contract); people below walk under it untouched.
    col(B.cols, x0, x1, z1 - 0.3, z1, D, D + RAIL_H + 0.05);
    col(B.cols, x0, x0 + 0.3, z0, z1, D, D + RAIL_H + 0.05);
    col(B.cols, x1 - 0.3, x1, z0, z1, D, D + RAIL_H + 0.05);
    col(B.cols, L.x - 0.34, L.x + 0.34, L.z - 0.24, L.z + 0.24, D, D + 1.2);
    if (CBZ.platforms) {
      const plat = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: D };
      CBZ.platforms.push(plat); B.plats.push(plat);
    }
    dirtyCols(); dirtyPlats();
    B.builtFor = CBZ.govComplexes;
    return true;
  }
  function paneBlocks(on) {
    const L = CBZ.losBlockers, S = B.shield;
    if (!L || !S) return;
    let changed = false;
    for (let k = 0; k < S.length; k++) {
      const i = L.indexOf(S[k]);
      if (on && i < 0) { L.push(S[k]); changed = true; }
      else if (!on && i >= 0) { L.splice(i, 1); changed = true; }
    }
    if (changed && CBZ.losGridDirty) CBZ.losGridDirty();
  }
  function glassUp(on) {
    if (!B.glass) return;
    B.glass.visible = !!on;
    paneBlocks(!!on);
    if (on && !B.glassCol && B.glassColSpec) {
      const s = B.glassColSpec;
      B.glassCol = { minX: s[0], maxX: s[1], minZ: s[2], maxZ: s[3], y0: s[4], y1: s[5], _city: true };
      CBZ.colliders.push(B.glassCol); dirtyCols();
    } else if (!on && B.glassCol) { uncol(B.glassCol); B.glassCol = null; dirtyCols(); }
  }
  function onBalcony(p) {
    if (!p || !B.group) return false;
    return Math.abs(p.y - B.deckY) < 1.0 && p.z > B.facadeZ - 0.2 && p.z < B.facadeZ + 3.6 && Math.abs(p.x - B.cx) < 5.2;
  }

  // ---- moving people: the player through a short fade, an NPC in place ---
  let fadeEl = null;
  function fade(cb, instant) {
    if (instant || typeof document === "undefined") { try { cb(); } catch (e) {} return; }
    if (!fadeEl) {
      fadeEl = document.createElement("div");
      fadeEl.style.cssText = "position:fixed;inset:0;z-index:65;background:#000;opacity:0;pointer-events:none;transition:opacity .28s ease;";
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = "1";
    setTimeout(function () { try { cb(); } catch (e) {} setTimeout(function () { fadeEl.style.opacity = "0"; }, 220); }, 300);
  }
  function movePlayer(x, y, z, face, instant) {
    const P = CBZ.player; if (!P || !P.pos) return;
    const go = function () {
      P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
      if (P._phys) { P._phys.air = false; P._phys.vx = P._phys.vz = P._phys.vy = 0; }
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      if (face != null) {
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = face;
        if (P.yaw != null) P.yaw = face;
      }
    };
    if (!instant && CBZ.cityLiftRide && CBZ.cityLiftRide(x, y, z, { force: true, busyMs: 900 })) {
      return;
    }
    fade(go, instant);
  }
  // THE NPC PRESIDENT. He is a posted body (govcomplex.js staffSite: pinned,
  // controlled), so his post IS where he is. We move the post, stand him on
  // the right floor (occupy.js's lift), and put it all back afterwards.
  const NPCP = { ped: null, home: null, homeY: 0, away: false };
  function npcTo(ped, x, y, z, face) {
    if (!ped || ped.dead || !ped.pos) return false;
    if (NPCP.ped !== ped || !NPCP.away) {
      NPCP.ped = ped;
      NPCP.home = ped.staffPost ? { x: ped.staffPost.x, z: ped.staffPost.z, face: ped.staffPost.face } : { x: ped.pos.x, z: ped.pos.z, face: ped.group ? ped.group.rotation.y : 0 };
      NPCP.homeY = ped._occupyY || 0;
    }
    NPCP.away = true;
    ped.pos.x = x; ped.pos.z = z;
    if (ped.staffPost) { ped.staffPost.x = x; ped.staffPost.z = z; ped.staffPost.face = face; }
    else ped.staffPost = { x: x, z: z, face: face };
    if (ped.target && ped.target.set) ped.target.set(x, 0, z);
    if (ped.group) ped.group.rotation.y = face;
    if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(ped, y > 0.2 ? y : 0); } catch (e) {} }
    else ped.pos.y = y;
    return true;
  }
  function npcHome() {
    const ped = NPCP.ped;
    if (ped && !ped.dead && NPCP.away && NPCP.home) {
      const h = NPCP.home;
      npcTo(ped, h.x, NPCP.homeY || 0, h.z, h.face);
      if (!(NPCP.homeY > 0.2) && ped.pos) ped.pos.y = CBZ.floorAt ? CBZ.floorAt(h.x, h.z) : 0;
    }
    NPCP.away = false;
  }

  // ============================================================
  //  §2  PLACES — every appearance goes somewhere that exists
  // ============================================================
  const PLACES = { builtFor: null, rallies: [], visits: [] };
  function lotsOf() {
    const A = CBZ.city && CBZ.city.arena;
    const out = [];
    const src = [A && A.lots, A && A.shopLots, CBZ.city && CBZ.city.lots];
    for (let s = 0; s < src.length; s++) {
      const L = src[s]; if (!L) continue;
      for (let i = 0; i < L.length; i++) if (L[i] && L[i].kind === "park" && isFinite(L[i].cx)) out.push(L[i]);
      if (out.length) break;
    }
    return out;
  }
  function buildPlaces() {
    if (PLACES.builtFor === CBZ.govComplexes && PLACES.visits.length) return PLACES;
    const s = site();
    if (!s) return PLACES;
    PLACES.rallies = []; PLACES.visits = [];
    const gx = s.gate ? s.gate.x : s.cx, gz = s.gate ? s.gate.z : s.cz;
    // RALLIES: the Capitol plaza (public ground by design) and the parks
    // nearest the Mansion (open plazas, buildings.js calls them).
    const cap = complex("capitol");
    if (cap && cap.seatPoint && cap.gate) {
      const sp = cap.seatPoint, gt = cap.gate;
      const dx = gt.x - sp.x, dz = gt.z - sp.z, L = Math.hypot(dx, dz) || 1;
      const nx = dx / L, nz = dz / L;
      const st = { x: sp.x + nx * 12, z: sp.z + nz * 12 };
      PLACES.rallies.push({ name: "The Capitol plaza", x: st.x, y: 0, z: st.z, face: Math.atan2(nx, nz), stage: "rally", road: { x: gt.x, z: gt.z } });
    }
    const parks = lotsOf().map(function (l) { return { l: l, d: Math.hypot(l.cx - gx, l.cz - gz) }; });
    parks.sort(function (a, b) { return a.d - b.d || a.l.cx - b.l.cx; });
    for (let i = 0; i < parks.length && i < 3; i++) {
      const l = parks[i].l;
      const dd = (l.d || 24) * 0.22;
      PLACES.rallies.push({ name: (l.building && l.building.name) || "City Park", x: l.cx, y: 0, z: l.cz - dd, face: 0, stage: "rally", road: { x: l.cx, z: l.cz } });
    }
    // VISITS: the other seats of the state, arrived at by their gate
    const VIS = ["capitol", "cityhall", "defence", "governor", "agency"];
    for (let i = 0; i < VIS.length; i++) {
      const c = complex(VIS[i]);
      if (!c || !c.gate) continue;
      PLACES.visits.push({ id: c.id, name: (c.def && c.def.name) || c.name || c.id, x: c.gate.x, y: 0, z: c.gate.z });
    }
    PLACES.builtFor = CBZ.govComplexes;
    return PLACES;
  }
  function balconyPlace() {
    const s = site(); if (!s) return null;
    return { name: "The Mansion balcony", x: s.cx, y: B.group ? B.deckY : 3.35, z: s.cz - 17 + 1.65, stage: "balcony" };
  }
  function homePoint() {
    const s = site(); if (!s) return null;
    return s.gate ? { x: s.gate.x, z: s.gate.z } : { x: s.cx, z: s.cz };
  }

  // ============================================================
  //  §3  THE DIARY — schedule(day). Pure function of (seed, day, world).
  // ============================================================
  const SCHED = { cache: {}, keys: [], builtFor: null };
  const APP = { state: {}, live: null, extra: [], seq: 0 };
  function routeTo(dest) {
    const M = CBZ.motorcade;
    if (M && typeof M.routeTo === "function") {
      try { const r = M.routeTo({ x: dest.x, z: dest.z }); if (Array.isArray(r) && r.length) return r.map(function (p) { return { x: p.x, z: p.z }; }); } catch (e) {}
    }
    return null;
  }
  function baseSchedule(D) {
    if (SCHED.builtFor !== CBZ.govComplexes) { SCHED.cache = {}; SCHED.keys = []; SCHED.builtFor = CBZ.govComplexes; }
    if (SCHED.cache[D]) return SCHED.cache[D];
    const bal = balconyPlace();
    if (!bal) return [];
    const PL = buildPlaces();
    const out = [];
    const two = h01(D, 3, 0x51a7) < 0.45;
    function kindFor(i) {
      const r = h01(D, 11 + i * 7, 0x51a8);
      if (i === 0) return r < 0.62 ? "speech" : r < 0.8 ? "visit" : "motorcade";
      const k0 = out[0] ? out[0].kind : "speech";
      if (k0 === "speech") return r < 0.6 ? "visit" : "motorcade";
      return r < 0.7 ? "speech" : "visit";
    }
    function placeFor(kind, i) {
      if (kind === "speech") {
        const rally = PL.rallies.length && h01(D, 21 + i, 0x51a9) < 0.3;
        return rally ? Object.assign({}, pick(PL.rallies, D, 31 + i, 0x51aa)) : Object.assign({}, bal);
      }
      const pool = kind === "visit" ? PL.visits : PL.visits.concat(PL.rallies);
      if (!pool.length) return null;
      return Object.assign({}, pick(pool, D, 41 + i, 0x51ab));
    }
    function durFor(kind, lo, hi) { return sec(lo + (hi - lo) * h01(D, kind.length, 0x51ac)); }
    let t0, t1;
    const k0 = kindFor(0), p0 = placeFor(k0, 0);
    if (!p0) return [];
    if (!two) {
      t0 = D + 0.08 + 0.18 * h01(D, 5, 0x51ad);                   // 08:00 .. 12:20
      t1 = t0 + durFor(k0, 55, 85);
      out.push(item(D, 0, k0, p0, t0, t1));
    } else {
      // a morning appearance and an afternoon one (the old 150 s day had to
      // cram them back to back at dawn; the 48-minute day has room)
      t0 = D + 0.06 + 0.10 * h01(D, 5, 0x51ad);                   // 07:30 .. 09:50
      t1 = t0 + durFor(k0, 40, 46);
      out.push(item(D, 0, k0, p0, t0, t1));
      const k1 = kindFor(1), p1 = placeFor(k1, 1);
      const s0 = Math.max(t1 + sec(8 + 5 * h01(D, 6, 0x51ae)), D + 0.33 + 0.12 * h01(D, 6, 0x51ae));   // 14:00 .. 16:50
      const e1 = Math.min(s0 + durFor(k1, 40, 46), D + 0.74);      // done before midnight
      if (p1 && e1 - s0 >= sec(38)) out.push(item(D, 1, k1, p1, s0, e1));
    }
    SCHED.cache[D] = out;
    SCHED.keys.push(D);
    while (SCHED.keys.length > 6) delete SCHED.cache[SCHED.keys.shift()];
    return out;
  }
  function item(D, i, kind, place, t0, t1) {
    const it = { id: "pa:" + D + ":" + i, kind: kind, place: place, t0: t0, t1: t1, hour0: +clockHour(t0).toFixed(2) };
    if (kind !== "speech" || place.stage === "rally") {
      const r = routeTo(place);
      if (r) it.route = r;
    }
    return it;
  }
  function lockdown() {
    const p = Pres();
    if (p && p.lockdown) { try { return p.lockdown() || { active: false }; } catch (e) {} }
    return { active: false };
  }
  function isCancelled(it) {
    const s = APP.state[it.id];
    if (s && (s.phase === "cancelled")) return true;
    if (s && (s.phase === "live" || s.phase === "done" || s.phase === "skipped")) return false;
    const L = lockdown();
    if (L.active && (L.until == null || L.until > it.t0) && (L.since == null || L.since < it.t1)) return true;
    if (current().kind === "vacant") return true;
    return false;
  }
  function schedule(day) {
    const D = day == null ? Math.floor(now()) : Math.floor(+day);
    if (!isFinite(D)) return [];
    let base = [];
    try { base = baseSchedule(D); } catch (e) { base = []; }
    const out = [];
    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const o = { id: it.id, kind: it.kind, place: Object.assign({}, it.place), t0: it.t0, t1: it.t1, hour0: it.hour0 };
      if (it.route) o.route = it.route.map(function (p) { return { x: p.x, z: p.z }; });
      if (isCancelled(it)) o.cancelled = true;
      out.push(o);
    }
    return out;
  }

  // ============================================================
  //  §4  CROWD BODIES — posted peds with props and poses
  // ============================================================
  const BUDGET = 50;
  const CROWD = { members: [], slots: [], stage: null, want: 0, tries: 0, drifting: [], supporters: 0, protesters: 0 };
  const PROT = { active: false, at: null, size: 0, anger: 0, until: 0, members: [], police: [], slogans: [], chantT: 0, cooldownUntil: -1, drifting: [], startT: 0, lastEval: 0 };
  const CONS = { items: [], t: 0 };
  function owned() {
    let n = CROWD.members.length + CROWD.drifting.length + PROT.members.length + PROT.police.length + PROT.drifting.length;
    for (let i = 0; i < CONS.items.length; i++) n += CONS.items[i].bodies.length;
    return n;
  }
  function spawnSafe(x, z, force) {
    if (CBZ.citySpawnDraining) return false;
    if (force) return true;
    if (CBZ.npcTransitionSafe) { try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: 14 }); } catch (e) {} }
    return true;
  }
  function unpost(ped) {
    if (!ped || ped.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); return; } catch (e) {} }
    try {
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      const arr = CBZ.cityPeds; if (arr) { const i = arr.indexOf(ped); if (i >= 0) arr.splice(i, 1); }
    } catch (e) {}
  }

  // ---- poses: registered into entities/poses.js's registry -------------
  function dampv(c, t, r, dt) { return c + (t - c) * (1 - Math.exp(-r * dt)); }
  let posesWired = false;
  function wirePoses() {
    if (posesWired || !CBZ.charPoses) return;
    posesWired = true;
    function arms(ch, dt, lx, lz, rx, rz, el, er) {
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra, J = ch.low || {};
      if (la) { la.rotation.x = dampv(la.rotation.x, lx, 12, dt); la.rotation.z = dampv(la.rotation.z, lz, 12, dt); }
      if (ra) { ra.rotation.x = dampv(ra.rotation.x, rx, 12, dt); ra.rotation.z = dampv(ra.rotation.z, rz, 12, dt); }
      if (J.la) J.la.rotation.x = dampv(J.la.rotation.x, Math.min(0, el), 12, dt);
      if (J.ra) J.ra.rotation.x = dampv(J.ra.rotation.x, Math.min(0, er), 12, dt);
    }
    // a board on a stick, both hands up the stick, held over the head
    CBZ.charPoses.pubPlacard = function (ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const hype = (ch._pubHype || 0) > 0;
      if (hype) ch._pubHype -= dt;
      const pump = hype ? Math.sin(ch._pubT * 9) * 0.2 : Math.sin(ch._pubT * 1.4 + (ch._pubPh || 0)) * 0.04;
      arms(ch, dt, -2.72 + pump, -0.2, -2.72 + pump, 0.2, -0.3, -0.3);
      const pr = ch._pubProp;
      if (pr) { pr.position.y = 1.8 + (hype ? Math.max(0, -pump) * 0.5 : 0); pr.rotation.z = pump * 0.25; }
    };
    // a little flag on a stick in the right hand, waved
    CBZ.charPoses.pubFlag = function (ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const hype = (ch._pubHype || 0) > 0;
      if (hype) ch._pubHype -= dt;
      const w = Math.sin(ch._pubT * (hype ? 8 : 2.2) + (ch._pubPh || 0));
      arms(ch, dt, -0.1, ch.armOutZ || 0.08, -2.45 + w * (hype ? 0.3 : 0.08), 0.12, -0.2, -0.25);
      const pr = ch._pubProp;
      if (pr) pr.rotation.z = w * (hype ? 0.35 : 0.1);
    };
    // both arms up in a V, pumping
    CBZ.charPoses.pubCheer = function (ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const p = Math.sin(ch._pubT * 8 + (ch._pubPh || 0)) * 0.25;
      arms(ch, dt, -2.55 + p, 0.45, -2.55 - p, -0.45, -0.25, -0.25);
    };
  }
  function setPose(ped, pose) {
    if (!ped || !ped.char) return;
    wirePoses();
    if (CBZ.setCharPose) { try { CBZ.setCharPose(ped.char, pose || "stand"); return; } catch (e) {} }
    ped.char.pose = pose || null;
  }

  // ---- props (shared geometry, cached materials) -------------------------
  let _stickGeo = null, _boardGeo = null, _smallFlagGeo = null;
  function stickGeo() { return _stickGeo || (_stickGeo = new THREE.CylinderGeometry(0.017, 0.017, 1.0, 6)); }
  function boardGeo() { return _boardGeo || (_boardGeo = new THREE.BoxGeometry(0.82, 0.52, 0.02)); }
  function smallFlagGeo() { return _smallFlagGeo || (_smallFlagGeo = new THREE.PlaneGeometry(0.44, 0.29)); }
  function giveSign(ped, text, support) {
    if (!ped || !ped.group) return;
    const pr = new THREE.Group();
    pr.position.set(0, 1.8, 0.2);                   // where both hands meet on the stick
    const st = new THREE.Mesh(stickGeo(), cm(0x8a6a44));
    st.position.y = -0.12; pr.add(st);
    const bd = new THREE.Mesh(boardGeo(), signMats(text, support));
    bd.position.y = 0.6; pr.add(bd);
    ped.group.add(pr);
    ped._pubProp = pr;
    if (ped.char) { ped.char._pubProp = pr; ped.char._pubPh = Math.random() * 6; }
    setPose(ped, "pubPlacard");
  }
  function giveFlag(ped) {
    if (!ped || !ped.group) return;
    const pr = new THREE.Group();
    pr.position.set(-0.22, 1.72, 0.3);              // the right hand, raised
    const st = new THREE.Mesh(stickGeo(), cm(0x3a3a3a));
    st.scale.y = 0.9; st.position.y = 0.2; pr.add(st);
    const fl = new THREE.Mesh(smallFlagGeo(), flagMat());
    fl.position.set(-0.22, 0.5, 0); pr.add(fl);
    ped.group.add(pr);
    ped._pubProp = pr;
    if (ped.char) { ped.char._pubProp = pr; ped.char._pubPh = Math.random() * 6; }
    setPose(ped, "pubFlag");
  }
  // a sign carried at the side while walking away (the gait owns the arms)
  function lowerProp(ped) {
    const pr = ped && ped._pubProp;
    if (!pr) return;
    if (ped.char) ped.char._pubProp = null;
    pr.position.set(0.34, 0.55, 0.05); pr.rotation.set(0, 0, 0.12);
  }
  function hype(ped, t) { if (ped && ped.char) ped.char._pubHype = t || 3; }

  const SUP_JOBS = ["teacher", "nurse", "office worker", "student", "retiree", "shop assistant", "electrician", "bus driver"];
  const PRO_JOBS = ["student", "activist", "labourer", "teacher", "nurse", "unemployed"];
  function postMember(x, z, face, role, idx, force) {
    if (!CBZ.cityPostNpc || owned() >= BUDGET) return null;
    if (!spawnSafe(x, z, force)) return null;
    let ped = null;
    try {
      ped = CBZ.cityPostNpc(x, z, {
        job: role === "pro" ? PRO_JOBS[idx % PRO_JOBS.length] : SUP_JOBS[idx % SUP_JOBS.length],
        kind: "civilian", archetype: "resident", pin: true, face: face, armed: false, aggr: 0.08,
        wealth: role === "pro" ? 0.3 : 0.5, src: "prespublic:" + role,
      });
    } catch (e) { ped = null; }
    if (!ped) return null;
    const fy = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
    if (ped.pos && isFinite(fy)) ped.pos.y = fy;
    ped._pubRole = role;
    return ped;
  }
  function slogansNow() {
    const out = [];
    const T = now();
    const S = status();
    const recent = function (k, days) { return ORD[k] != null && T - ORD[k] < pace(days || 1.6); };
    const dep = deployments();
    if (curfewLive() || recent("curfew")) out.push("NO CURFEW", "OUR STREETS AT NIGHT");
    if (dep.martial || recent("martial")) out.push("SOLDIERS OUT", "NO TANKS ON OUR STREETS");
    if (recent("crackdown")) out.push("STOP THE CRACKDOWN");
    if ((S.emergency || 0) >= 40 || recent("emergency") || recent("fascism") || recent("crown")) out.push("NO DICTATOR", "RESTORE THE REPUBLIC");
    if (recent("taxup") || (S.seat && (S.treasury || 0) < 20000)) out.push("WHERE IS THE MONEY", "TAX THE PALACE");
    if (ATTACK.t != null && T - ATTACK.t < pace(1.5)) out.push("KEEP US SAFE", "NEVER AGAIN");
    if (recent("bureau", 2) || recent("martial", 3)) out.push("BRING THEM HOME");
    if (approval() < 35) out.push("RESIGN", "NOT MY PRESIDENT", "ENOUGH");
    if (!out.length) out.push("HEAR US", "RESIGN");
    return out;
  }
  function supportSlogans() {
    const c = current();
    const n = surname(c.name).toUpperCase();
    const out = ["FOUR MORE YEARS", "WE STAND WITH YOU", "SAFE STREETS"];
    if (n && n.length <= 10 && /^[A-Z' -]+$/.test(n)) out.push(n + " FOR US");
    return out;
  }

  // ---- the speech crowd ----------------------------------------------------
  function crowdSize() {
    const a = approval();
    return Math.round(8 + (clamp(a, 20, 80) - 20) / 60 * 28);       // 8 at 20% .. 36 at 80%
  }
  function protestShare() {
    const a = approval();
    let s = clamp((58 - a) / 70, 0.05, 0.7);
    s += anger() * 0.2;
    return clamp(s, 0.05, 0.85);
  }
  function makeSlots(stage, n) {
    const out = [];
    const f = stage.face;                             // the way the speaker looks = out to the crowd
    const dx = Math.sin(f), dz = Math.cos(f), px = Math.cos(f), pz = -Math.sin(f);
    let r = 0;
    while (out.length < n && r < 8) {
      const cnt = 7 + r;
      const dist = stage.d0 + r * 1.9;
      for (let i = 0; i < cnt && out.length < n; i++) {
        // centre-out so a small crowd still fills the front middle
        const k = i === 0 ? 0 : (i % 2 ? (i + 1) / 2 : -i / 2);
        const lat = k * 1.35 + (r % 2 ? 0.6 : 0) + (h01(r, i, 0x5b1) - 0.5) * 0.4;
        const dd = dist + (h01(i, r, 0x5b2) - 0.5) * 0.5;
        const x = stage.x + dx * dd + px * lat, z = stage.z + dz * dd + pz * lat;
        out.push({ x: x, z: z, row: r, lat: lat, face: faceTo(x, z, stage.x, stage.z) });
      }
      r++;
    }
    return out;
  }
  function stageOf(place) {
    if (!place) return null;
    if (place.stage === "balcony") {
      if (!B.group) return null;
      // first row at cz-4, clear of the perron treads (cz-8); d0 is metres
      // from the lectern out over the lawn
      const s = site();
      return { kind: "balcony", x: B.stand.x, y: B.deckY, z: B.stand.z, face: 0, d0: (s.cz - 4) - B.stand.z, place: place };
    }
    return { kind: "rally", x: place.x, y: 0.42, z: place.z, face: place.face || 0, d0: 5.2, place: place };
  }
  function crowdGather(stage, force) {
    if (!stage) return;
    if (CROWD.stage !== stage) {
      crowdRelease(false);
      CROWD.stage = stage;
      const n = crowdSize();
      const share = protestShare();
      CROWD.slots = makeSlots(stage, n);
      // protesters take the right-rear block: a real protest is a knot of
      // people, not a sprinkle
      const k = Math.round(n * share);
      const ord = CROWD.slots.map(function (s, i) { return { s: s, v: s.lat + s.row * 1.5 + i * 0.001 }; });
      ord.sort(function (a, b) { return b.v - a.v; });
      for (let i = 0; i < ord.length; i++) ord[i].s.role = i < k ? "pro" : "sup";
      const pro = slogansNow(), sup = supportSlogans();
      for (let i = 0; i < CROWD.slots.length; i++) {
        const s = CROWD.slots[i];
        if (s.role === "pro") s.sign = pro[i % pro.length];
        else {
          const r = h01(i, n, 0x5b3);
          s.prop = r < 0.55 ? "flag" : r < 0.75 ? "sign" : "none";
          if (s.prop === "sign") s.sign = sup[i % sup.length];
        }
      }
      CROWD.want = n; CROWD.tries = 0;
      CROWD.supporters = n - k; CROWD.protesters = k;
    }
    crowdFill(force);
  }
  function crowdFill(force) {
    const st = CROWD.stage; if (!st) return;
    const P = playerPos();
    if (!force && distXZ(P, st.x, st.z) > 150) return;
    const late = force || ++CROWD.tries > 24;
    let made = 0;
    for (let i = 0; i < CROWD.slots.length; i++) {
      const s = CROWD.slots[i];
      if (s.ped) continue;
      if (!force && made >= 4) break;
      const ped = postMember(s.x, s.z, s.face, s.role, i, late);
      if (!ped) { if (owned() >= BUDGET) break; continue; }
      s.ped = ped; made++;
      CROWD.members.push({ ped: ped, role: s.role, slot: s });
      if (s.role === "pro") giveSign(ped, s.sign || "RESIGN", false);
      else if (s.prop === "flag") giveFlag(ped);
      else if (s.prop === "sign") giveSign(ped, s.sign || "FOUR MORE YEARS", true);
    }
  }
  function crowdRelease(drift) {
    for (let i = 0; i < CROWD.members.length; i++) {
      const m = CROWD.members[i];
      if (drift) startDrift(m.ped, CROWD.drifting, CROWD.stage, false);
      else unpost(m.ped);
    }
    CROWD.members.length = 0; CROWD.slots = []; CROWD.stage = null; CROWD.want = 0;
    CROWD.supporters = 0; CROWD.protesters = 0;
  }
  // WALKING OFF (drift) or RUNNING (flee). The pin comes off and peds.js's
  // own brain takes the body; we only take it back out of the world once it
  // has gone a way off or enough time has passed.
  function startDrift(ped, list, from, flee) {
    if (!ped || ped.dead) return;
    ped.staffPost = null;
    ped.controlled = false;
    lowerProp(ped);
    setPose(ped, null);
    const fx = from ? from.x : ped.pos.x, fz = from ? from.z : ped.pos.z;
    if (flee && CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(ped, fx, fz); } catch (e) {} ped.fear = Math.max(ped.fear || 0, 4); }
    else {
      const dx = ped.pos.x - fx, dz = ped.pos.z - fz, L = Math.hypot(dx, dz) || 1;
      ped.state = "walk";
      if (ped.target && ped.target.set) ped.target.set(ped.pos.x + dx / L * 40, 0, ped.pos.z + dz / L * 40);
    }
    list.push({ ped: ped, t: 0 });
  }
  function tickDrift(list, dt) {
    const P = playerPos();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.t += dt;
      const p = d.ped;
      if (!p || p.dead) { list.splice(i, 1); continue; }
      const far = distXZ(P, p.pos.x, p.pos.z) > 40;
      if ((d.t > 12 && far) || d.t > 40) { unpost(p); list.splice(i, 1); }
    }
  }
  function members(role) {
    const out = [];
    for (let i = 0; i < CROWD.members.length; i++) { const m = CROWD.members[i]; if (!m.ped.dead && (!role || m.role === role)) out.push(m); }
    return out;
  }
  function frontOf(list) {
    let best = null, bv = Infinity;
    for (let i = 0; i < list.length; i++) { const v = list[i].slot.row * 10 + Math.abs(list[i].slot.lat) + Math.random() * 3; if (v < bv) { bv = v; best = list[i]; } }
    return best;
  }
  const CHEERS = ["Yes!", "Hear, hear!", "Four more years!", "That's right!", "We're with you!", "My mother voted for you!", "Say it again!"];
  const BOOS = ["Boo!", "Liar!", "Resign!", "Shame!", "Nobody believes you!", "Where's my pension?", "My son's still in your jail!"];
  /* THE CROWD IS HEARD. One synthesised crowd (systems/audio.js crowdVoice)
     from the middle of the people who are actually there. Approval sets the
     balance: a cheer from a country that likes him is a big warm one with
     hardly a boo in it; a cheer at 20% is thin, and the protest block boos
     through it. A boo is the mirror. */
  function crowdSound(kind, proToo, sup, pro) {
    if (!CBZ.crowdVoiceAt) return;
    const all = sup.concat(pro);
    if (!all.length) return;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < all.length; i++) { x += all[i].ped.pos.x; y += all[i].ped.pos.y || 0; z += all[i].ped.pos.z; }
    x /= all.length; y /= all.length; z /= all.length;
    const a = approval() / 100;
    const proShare = pro.length / all.length, supShare = 1 - proShare;
    let cheer, boo;
    if (kind === "cheer") {
      cheer = supShare * (0.45 + 0.55 * a);
      boo = proToo ? proShare * 0.25 : proShare * (0.4 + 0.6 * (1 - a));
    } else {
      boo = Math.max(proShare, 0.35) * (0.5 + 0.5 * (1 - a));
      cheer = supShare * a * 0.3;
    }
    try { CBZ.crowdVoiceAt(x, z, { y: y + 1.5, cheer: cheer, boo: boo, size: all.length }); } catch (e) {}
  }
  function react(kind, proToo) {
    const sup = members("sup"), pro = members("pro");
    crowdSound(kind, proToo, sup, pro);
    if (kind === "cheer") {
      for (let i = 0; i < sup.length; i++) {
        hype(sup[i].ped.char ? sup[i].ped : null, 3.2);
        if (sup[i].slot.prop === "none") { setPose(sup[i].ped, "pubCheer"); sup[i].cheerT = 3.2; }
      }
      const f = frontOf(sup); if (f) say(f.ped, rpick(CHEERS), "#cfe3ff");
      if (proToo) { for (let i = 0; i < pro.length; i++) hype(pro[i].ped, 2.5); }
      else if (pro.length > 2) { const b = frontOf(pro); if (b) setTimeout(function () { say(b.ped, rpick(BOOS), "#ffb4a8"); }, 900); }
    } else {
      for (let i = 0; i < pro.length; i++) hype(pro[i].ped, 3.5);
      const b = frontOf(pro.length ? pro : sup);
      if (b) say(b.ped, pro.length ? rpick(BOOS) : "Come on...", "#ffb4a8");
    }
  }
  function tickCrowdPoses(dt) {
    for (let i = 0; i < CROWD.members.length; i++) {
      const m = CROWD.members[i];
      if (m.cheerT > 0) { m.cheerT -= dt; if (m.cheerT <= 0) setPose(m.ped, null); }
    }
  }
  // A CROWD DOES NOT BOLT ON ONE FRAME. Each person hears it after the sound
  // reaches him and he makes sense of it (distance + his own beat), flinches
  // at once, and then does what CBZ.brain.threat.respond says a person like
  // him does: runs, or freezes / ducks for a second first, then runs.
  const PANIC = [];
  function queuePanic(ped, list, x, z) {
    if (!ped || ped.dead) return;
    const d = distXZ(ped.pos, x, z);
    let r = "flee";
    const B = CBZ.brain;
    if (B && B.threat && typeof B.threat.respond === "function") {
      try { if (B.of) B.of(ped); r = B.threat.respond(ped, { x: x, z: z, kind: "gunshot", armed: true, distance: d }) || "flee"; } catch (e) { r = "flee"; }
    }
    const still = r === "freeze" || r === "cover" || r === "surrender";
    ped.poseCower = Math.max(ped.poseCower || 0, still ? 1.6 : 0.5);
    const beat = 0.12 + Math.min(0.9, d / 45) + h01(ped.id | 0, (d * 10) | 0, 71) * 0.45;
    PANIC.push({ ped: ped, list: list, x: x, z: z, t: -(beat + (still ? 0.9 + h01(ped.id | 0, 3, 72) * 1.1 : 0)) });
  }
  function tickPanic(dt) {
    for (let i = PANIC.length - 1; i >= 0; i--) {
      const q = PANIC[i];
      q.t += dt;
      if (q.t < 0 && q.ped && !q.ped.dead) continue;
      PANIC.splice(i, 1);
      if (q.ped && !q.ped.dead) startDrift(q.ped, q.list, { x: q.x, z: q.z }, true);
    }
  }
  function panicAll(x, z) {
    for (let i = 0; i < CROWD.members.length; i++) queuePanic(CROWD.members[i].ped, CROWD.drifting, x, z);
    CROWD.members.length = 0; CROWD.slots = []; CROWD.stage = null;
    for (let i = 0; i < PROT.members.length; i++) queuePanic(PROT.members[i].ped, PROT.drifting, x, z);
    PROT.members.length = 0;
    if (CBZ.cityCrowdFlee) { try { CBZ.cityCrowdFlee(x, z, 60, 1); } catch (e) {} }
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(x, z, 1.2); } catch (e) {} }
  }

  // ---- the rally stage: a riser, a lectern, two flags; only while in use --
  const RALLY = { group: null, plat: null, cols: [] };
  function buildRally(stage) {
    dropRally();
    const root = arenaRoot(); if (!root) return;
    const grp = new THREE.Group();
    root.add(grp); RALLY.group = grp;
    const f = stage.face, dx = Math.sin(f), dz = Math.cos(f);
    const gy = CBZ.floorAt ? CBZ.floorAt(stage.x, stage.z) : 0;
    const top = gy + 0.42;
    stage.y = top;
    const riser = box(grp, stage.x + dx * 0.4, gy + 0.21, stage.z + dz * 0.4, 4.2, 0.42, 4.2, 0x3b3f47);
    riser.rotation.y = f;
    const skirt = box(grp, stage.x + dx * 2.5, gy + 0.2, stage.z + dz * 2.5, 4.3, 0.36, 0.04, 0x1d3160);
    skirt.rotation.y = f;
    const lx = stage.x + dx * 0.75, lz = stage.z + dz * 0.75;
    const lec = box(grp, lx, top + 0.56, lz, 0.64, 1.12, 0.46, 0x3a2a1e); lec.rotation.y = f;
    const sm = new THREE.MeshLambertMaterial({ map: sealTex(), transparent: true });
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), sm);
    seal.position.set(lx + dx * 0.235, top + 0.66, lz + dz * 0.235); seal.rotation.y = f; grp.add(seal);
    for (const s of [-1, 1]) {
      const px = stage.x - dx * 0.8 + Math.cos(f) * s * 1.6, pz = stage.z - dz * 0.8 - Math.sin(f) * s * 1.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 2.5, 8), cm(0x6e5a36));
      pole.position.set(px, top + 1.25, pz); grp.add(pole);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 1.24), flagMat());
      cloth.position.set(px - Math.cos(f) * s * 0.43, top + 1.78, pz + Math.sin(f) * s * 0.43); cloth.rotation.y = f; grp.add(cloth);
    }
    if (CBZ.platforms) {
      const h = 2.1;
      RALLY.plat = { minX: stage.x + dx * 0.4 - h, maxX: stage.x + dx * 0.4 + h, minZ: stage.z + dz * 0.4 - h, maxZ: stage.z + dz * 0.4 + h, top: top };
      CBZ.platforms.push(RALLY.plat); dirtyPlats();
    }
    col(RALLY.cols, lx - 0.34, lx + 0.34, lz - 0.34, lz + 0.34, top, top + 1.2); dirtyCols();
    stage.lect = { x: lx, z: lz };
  }
  function dropRally() {
    if (RALLY.group && RALLY.group.parent) RALLY.group.parent.remove(RALLY.group);
    RALLY.group = null;
    if (RALLY.plat && CBZ.platforms) { const k = CBZ.platforms.indexOf(RALLY.plat); if (k >= 0) CBZ.platforms.splice(k, 1); dirtyPlats(); }
    RALLY.plat = null;
    for (let i = 0; i < RALLY.cols.length; i++) uncol(RALLY.cols[i]);
    if (RALLY.cols.length) dirtyCols();
    RALLY.cols = [];
  }

  // ============================================================
  //  §5  WHAT THE COUNTRY IS ANGRY ABOUT — read off the bus and the state
  // ============================================================
  const ORD = {};                       // order key -> dayTime of its last yes
  const ATTACK = { t: null };
  const UNPOPULAR = { curfew: 0.35, martial: 0.45, emergency: 0.35, taxup: 0.25, crackdown: 0.3, fascism: 0.5, communism: 0.4, crown: 0.5, surge: 0.1 };
  let busWired = false;
  function wireBus() {
    if (busWired) return;
    const p = Pres();
    if (!p || typeof p.on !== "function") return;
    busWired = true;
    try {
      p.on("order", function (e) {
        if (!e || !e.key || e.ok === false) return;
        ORD[e.key] = now();
        if ((e.key === "crackdown" || e.key === "martial") && PROT.active) disperseProtest("crackdown");
      });
      p.on("attack", function () { ATTACK.t = now(); });
      p.on("lockdown", function (e) { if (e && e.active) cancelRest("lockdown"); });
    } catch (e) {}
    if (typeof p.onAssassinated === "function") {
      try { p.onAssassinated(function (ev) { onPresidentDown(ev); }); } catch (e) {}
    }
  }
  function anger() {
    const T = now();
    let a = Math.max(0, (35 - approval()) / 35);
    for (const k in UNPOPULAR) if (ORD[k] != null && T - ORD[k] < pace(1.5)) a += UNPOPULAR[k];
    if (ATTACK.t != null && T - ATTACK.t < pace(1.0)) a += 0.2;
    return clamp(a, 0, 1.5);
  }
  function curfewLive() {
    const G = CBZ.gov;
    if (!G || !G.curfewUntil) return false;
    try { return (G.curfewUntil() || 0) > (CBZ.worldDay ? CBZ.worldDay() : 0); } catch (e) { return false; }
  }
  function deployments() {
    const out = { surge: null, martial: null };
    const G = CBZ.gov;
    if (!G || !G.deployments) return out;
    try {
      const L = G.deployments() || [];
      for (let i = 0; i < L.length; i++) if (L[i] && (L[i].kind === "surge" || L[i].kind === "martial")) out[L[i].kind] = L[i];
    } catch (e) {}
    return out;
  }

  // ============================================================
  //  §6  APPEARANCES — the diary, executed for real
  // ============================================================
  function stateOf(it) { return APP.state[it.id] || (APP.state[it.id] = { phase: "pending", reminded: false }); }
  function cabinetChief() {
    const p = Pres();
    if (p && p.cabinet) { try { const c = p.cabinet(); if (c && c.chief) return { name: c.chief.display || c.chief.name, role: c.chief.role || "Chief of Staff" }; } catch (e) {} }
    return { name: "Chief of Staff", role: "Chief of Staff" };
  }
  function remind(it) {
    const O = CBZ.presidentOffice;
    if (!O || typeof O.offer !== "function") return;
    const pl = it.place && it.place.name ? it.place.name : "the city";
    let line;
    if (it.kind === "speech" && it.place.stage === "balcony") line = "Sir, the crowd is on the lawn. You're on the balcony in a few minutes. The door is upstairs, at the front of the residence.";
    else if (it.kind === "speech") line = "Sir, the rally at " + pl + " is about to start. The cars are waiting in the motor court.";
    else if (it.kind === "visit") line = "Sir, you're expected at " + pl + ". The motorcade is waiting in the motor court.";
    else line = "Sir, the motorcade leaves for " + pl + " shortly. The car is in the motor court.";
    try {
      O.offer({
        id: "pub:" + it.id, via: "aide", urgent: true, topic: "schedule", who: cabinetChief(), expires: 40,
        line: line,
        yes: { label: "On my way", reply: "They're ready for you." },
        no: { label: "Cancel it", reply: "I'll tell them.", run: function () { cancelItem(it, "cancelled"); } },
      });
    } catch (e) {}
  }
  function cancelItem(it, why) {
    const s = stateOf(it);
    if (s.phase === "done" || s.phase === "cancelled" || s.phase === "skipped") return;
    const wasLive = s.phase === "live";
    s.phase = "cancelled";
    if (wasLive && APP.live && APP.live.item.id === it.id) endLive("cancel");
    else if (CROWD.stage && CROWD.stage.itemId === it.id) { if (CROWD.stage.kind === "rally") dropRally(); crowdRelease(true); }
    emit("appearance", { kind: it.kind, phase: "cancel", place: it.place, reason: why || "cancelled" });
    if (why === "cancelled" && playerPres()) {
      shock(-0.6);
      news(it.kind === "speech" ? "The President cancels an appearance at " + it.place.name + "." : "The President's trip to " + it.place.name + " is called off.");
    }
  }
  function cancelRest(why) {
    const list = schedule();
    for (let i = 0; i < list.length; i++) {
      const it = findItem(list[i].id);
      if (!it) continue;
      const s = stateOf(it);
      if (s.phase === "pending" || s.phase === "prep" || s.phase === "live") cancelItem(it, why);
    }
  }
  function findItem(id) {
    for (let i = 0; i < APP.extra.length; i++) if (APP.extra[i].id === id) return APP.extra[i];
    const D = +String(id).split(":")[1];
    if (!isFinite(D)) return null;
    const L = baseSchedule(D);
    for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }

  // the live appearance record
  // APP.live = { item, who:"player"|"npc", ped, stage, waitUntil, sp (speech), phase, mc }
  function startLive(it, force) {
    const c = current();
    if (c.kind === "vacant") { stateOf(it).phase = "cancelled"; return false; }
    const s = stateOf(it);
    s.phase = "live";
    const L = APP.live = { item: it, who: c.kind, ped: c.kind === "npc" ? c.ped : null, stage: null, sp: null, t: 0, phase: "on", mc: null, waitUntil: now() + sec(35) };
    emit("appearance", { kind: it.kind, phase: "start", place: it.place });
    if (it.kind === "speech") {
      const pre = CROWD.stage && CROWD.stage.itemId === it.id ? CROWD.stage : null;
      L.stage = pre || stageOf(it.place);
      if (L.stage) {
        L.stage.itemId = it.id;
        if (L.stage.kind === "rally" && !pre) buildRally(L.stage);
        crowdGather(L.stage, force);
        if (L.stage.kind === "balcony") glassUp(true);
      }
      L.sp = { beats: null, i: 0, phase: c.kind === "npc" ? "npc" : "wait", t: 0, delta: 0, started: false, emitted: false, react: 0 };
      if (c.kind === "npc") npcToStage(L, true);
    } else {
      runMotorcade(L);
    }
    return true;
  }
  function npcToStage(L, force) {
    const ped = L.ped;
    if (!ped || ped.dead || !L.stage) return;
    if (L.stage.kind === "balcony") {
      npcTo(ped, B.stand.x, B.deckY, B.stand.z, 0);
      L.npcPlaced = true;
      return;
    }
    // a rally: he goes by car when there is a motorcade, else he is simply there
    const M = CBZ.motorcade;
    if (!force && M && typeof M.run === "function" && !L.mc) {
      try {
        L.mc = M.run({ principal: ped, from: { x: ped.pos.x, z: ped.pos.z }, to: { x: L.item.place.road ? L.item.place.road.x : L.stage.x, z: L.item.place.road ? L.item.place.road.z : L.stage.z }, route: L.item.route,
          onArrive: function () { if (APP.live === L) { npcTo(ped, L.stage.x, L.stage.y, L.stage.z, L.stage.face); L.npcPlaced = true; } } }) || true;
        return;
      } catch (e) { L.mc = null; }
    }
    npcTo(ped, L.stage.x, L.stage.y, L.stage.z, L.stage.face);
    L.npcPlaced = true;
  }
  function runMotorcade(L) {
    const it = L.item, M = CBZ.motorcade;
    const to = { x: it.place.x, z: it.place.z };
    const home = homePoint();
    if (L.who === "npc") {
      const ped = L.ped;
      if (!ped || ped.dead || !M || typeof M.run !== "function") return;      // it happens on paper; nobody to see
      try {
        L.mc = M.run({ principal: ped, from: { x: ped.pos.x, z: ped.pos.z }, to: to, route: it.route,
          onArrive: function () {
            if (APP.live !== L) return;
            L.arrivedT = now();
            if (it.kind === "motorcade") goHome(L);
          } }) || true;
      } catch (e) { L.mc = null; }
    } else {
      L.phase = "board";                             // waits for him to come to the court
    }
    L.home = home;
  }
  function goHome(L) {
    const M = CBZ.motorcade, ped = L.ped;
    if (L.returning) return;
    L.returning = true;
    if (L.who === "npc" && ped && !ped.dead && M && typeof M.run === "function" && L.home) {
      try {
        M.run({ principal: ped, from: { x: ped.pos.x, z: ped.pos.z }, to: L.home,
          onArrive: function () { npcHome(); } });
      } catch (e) {}
    }
  }
  function playerNearCourt() {
    const s = site(), P = playerPos();
    if (!s || !P) return false;
    const Pl = CBZ.player;
    if (Pl && Pl.driving) return distXZ(P, s.cx, s.cz + 18) < 90;
    return distXZ(P, s.cx, s.cz + 18) < 45 || distXZ(P, s.seatPoint ? s.seatPoint.x : s.cx, s.seatPoint ? s.seatPoint.z : s.cz) < 14;
  }
  function skip(L, why) {
    const it = L.item;
    stateOf(it).phase = "skipped";
    if (L.who === "player") {
      shock(-1.5);
      news(it.kind === "speech"
        ? "A crowd waits outside " + (it.place.stage === "balcony" ? "the Mansion" : it.place.name) + ". The President never comes out."
        : "The President does not show at " + it.place.name + ".");
    }
    endLive("cancel", why || "no-show");
  }
  function endLive(phase, why) {
    const L = APP.live;
    if (!L) return;
    APP.live = null;
    const it = L.item;
    const s = stateOf(it);
    if (s.phase === "live") s.phase = "done";
    if (L.sp && L.sp.awaiting && CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
    if (it.kind === "speech") {
      if (L.sp && !L.sp.emitted && (L.sp.started || L.who === "npc")) emitSpeech(L);
      if (phase === "panic") { /* the crowd is already running */ }
      else crowdRelease(true);
      glassUp(false);
      if (L.stage && L.stage.kind === "rally") setTimeout(dropRally, 4000);
      if (L.who === "npc" && L.npcPlaced) npcHome();
    } else if (L.who === "npc" && !L.returning && phase !== "panic") {
      goHome(L);
    }
    emit("appearance", { kind: it.kind, phase: phase === "end" ? "end" : "cancel", place: it.place, reason: why || null });
  }
  function emitSpeech(L) {
    L.sp.emitted = true;
    emit("speech", { crowd: CROWD.supporters + CROWD.protesters || CROWD.want, supporters: CROWD.supporters, protesters: CROWD.protesters, approvalDelta: +L.sp.delta.toFixed(2), by: L.who });
  }

  // ---- THE SPEECH ------------------------------------------------------
  // Each beat: a line he delivers, two stances that fit THIS moment, and a
  // fit score per stance read off the real state. Stances are words unless a
  // real order exists that does exactly what the words say.
  function buildBeats() {
    const S = status();
    const T = now();
    const a = approval();
    const dep = deployments();
    const recentAttack = (ATTACK.t != null && T - ATTACK.t < pace(1.5)) || !!(S.threat && S.threat.armed);
    const threat = S.threat && S.threat.members > 0;
    const broke = S.seat && (S.treasury || 0) < 20000;
    const taxed = ORD.taxup != null && T - ORD.taxup < pace(2);
    const beats = [];
    if (recentAttack) beats.push({
      line: "They came for us. They came for this city, for your streets, for your children.",
      a: { label: "Promise justice", say: "We will find every one of them. Every one.", fit: threat ? 2.4 : 1.4 },
      b: { label: "Call for calm", say: "Grieve, then go back to your lives. That is how we beat them.", fit: a >= 45 ? 1.4 : 0.4 },
    });
    if (curfewLive()) beats.push({
      line: "I know the curfew is hard. I know what it costs a family to be locked in after dark.",
      a: { label: "Defend the curfew", say: "It stays until the streets are safe. Not one day longer.", fit: (recentAttack || threat) ? 0.6 : -2.0 },
      b: { label: "Promise to lift it", say: "It will be lifted. You have my word.", fit: 1.8, pro: true },
    });
    if (dep.martial) beats.push({
      line: "There are soldiers on our streets tonight. I put them there.",
      a: { label: "The soldiers stay", say: "They stay until the job is done.", fit: recentAttack ? 1.0 : -1.8 },
      b: { label: "Bring them home soon", say: "They'll be home soon. That is a promise.", fit: 1.6, pro: true },
    });
    if (broke || taxed) beats.push({
      line: "Everyone here has asked me the same question. Where is the money going?",
      a: { label: "Promise jobs", say: "Into jobs. Into your jobs. Starting this month.", fit: broke ? -0.6 : 1.8 },
      b: { label: "Tighten the belt", say: "The state spends less, starting with this house.", fit: broke ? 1.4 : 0.2 },
    });
    if ((S.emergency || 0) >= 40) beats.push({
      line: "Some say this government has taken too much power.",
      a: { label: "Defend the emergency", say: "Extraordinary times. Extraordinary measures.", fit: recentAttack ? 0.5 : -1.8 },
      b: { label: "Promise elections", say: "The republic will vote. Nobody is above that.", fit: 1.6, pro: true },
    });
    // the openers and the close always exist, so there are always three beats
    const open = {
      line: "My fellow citizens. Thank you for coming out today.",
      a: { label: "Promise safety", say: "No family in this country should be afraid to walk home.", fit: threat || recentAttack ? 1.8 : 0.6 },
      b: { label: "Promise jobs", say: "A job for every pair of hands that wants one.", fit: broke ? 0.2 : 1.6 },
    };
    const close = {
      line: "I will finish with this.",
      a: { label: "Ask for their trust", say: "Give me your trust, and I will not waste it.", fit: a >= 40 ? 1.2 : 0.3 },
      b: { label: "Go after the opposition", say: "The people who oppose us want this country weak.", fit: a >= 55 ? 1.5 : -1.6 },
    };
    const filler = {
      line: "People ask me what this government is for.",
      a: { label: "Blame the cell", say: "It is for hunting down the men who threaten you.", fit: threat ? 1.6 : -0.4 },
      b: { label: "Talk about the future", say: "It is for your children, and their children.", fit: 0.9 },
    };
    const first = beats.length ? beats.shift() : open;
    const second = beats.length ? beats.shift() : (first === open ? filler : open);
    return [first, second, close];
  }
  function beginPlayerSpeech(L) {
    if (!L || !L.sp || L.sp.started) return;
    L.sp.started = true;
    L.sp.beats = buildBeats();
    L.sp.i = 0;
    L.sp.phase = "beat";
    runBeat(L);
  }
  function runBeat(L) {
    const sp = L.sp, ui = CBZ.campaignUI;
    const b = sp.beats[sp.i];
    if (!b) { finishSpeech(L); return; }
    const c = current();
    const name = c.name || "The President";
    if (!ui || !ui.say) {
      // no dialogue surface: speak the stronger stance
      applyStance(L, b.a.fit >= b.b.fit ? b.a : b.b);
      return;
    }
    let pr = null;
    sp.awaiting = true;
    // HE SAYS IT TO THE CROWD: over his own head at the podium (a speech is
    // spoken aloud, not inner monologue), then the two stances as replies.
    if (CBZ.speech && CBZ.player) CBZ.speech.lines([{ by: CBZ.player, line: b.line, aloud: true }]);
    try { pr = ui.say(name, "", [{ id: "a", label: b.a.label }, { id: "b", label: b.b.label }]); } catch (e) { pr = null; }
    if (!pr || !pr.then) { sp.awaiting = false; applyStance(L, b.a); return; }
    const myI = sp.i;
    pr.then(function (choice) {
      if (APP.live !== L || L.sp !== sp || sp.i !== myI) return;
      sp.awaiting = false;
      if (choice !== "a" && choice !== "b") { cutShort(L); return; }
      applyStance(L, b[choice]);
    });
  }
  function applyStance(L, st) {
    const sp = L.sp;
    const c = current();
    // the crowd does not hear a speech in a vacuum: a hostile crowd makes a
    // good line land softer and a bad one land harder
    const share = CROWD.protesters / Math.max(1, CROWD.protesters + CROWD.supporters);
    let d = st.fit >= 0 ? st.fit * (1 - share * 0.5) : st.fit * (1 + share * 0.5);
    d = clamp(d, -3, 3);
    if (sp.delta + d > 6) d = 6 - sp.delta;
    if (sp.delta + d < -6) d = -6 - sp.delta;
    sp.delta += d;
    shock(d);
    if (CBZ.speech && CBZ.player) CBZ.speech.lines([{ by: CBZ.player, line: st.say, aloud: true }]);
    react(d >= 0 ? "cheer" : "boo", !!st.pro);
    sp.phase = "react"; sp.t = 3.0;
  }
  function cutShort(L) {
    if (L.sp) { L.sp.phase = "done"; shock(-0.5); L.sp.delta -= 0.5; }
    news("The President walks away from his own speech.");
    finishSpeech(L, true);
  }
  function finishSpeech(L, short) {
    const sp = L.sp;
    if (!sp) return;
    sp.phase = "done";
    if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
    if (!short) react(sp.delta >= 0 ? "cheer" : "boo");
    emitSpeech(L);
    if (!short && L.who === "player") {
      const where = L.stage && L.stage.kind === "balcony" ? "from the Mansion balcony" : "at " + L.item.place.name;
      news(sp.delta >= 2 ? "The President speaks " + where + " to a warm crowd." : sp.delta <= -2 ? "Boos for the President " + where + "." : "The President speaks " + where + ".");
    }
    // the crowd stays a moment, then goes
    L.endAt = now() + sec(9);
  }
  // THE NPC PRESIDENT speaks by himself: three lines over the appearance
  const NPC_LINES = [
    ["My fellow citizens, thank you for coming.", "Thank you. Thank you all for coming out today."],
    ["This country will be safe. I will see to it.", "We have work to do, and we will do it together.", "Nobody is above the law in this republic.", "Bread costs less than last year. Remember that."],
    ["God bless you, and God bless this country.", "Go home safe. Thank you."],
  ];
  function tickNpcSpeech(L, dt) {
    const sp = L.sp;
    if (!L.npcPlaced || sp.i >= 3) return;
    sp.t -= dt;
    if (sp.t > 0) return;
    const ped = L.ped;
    const lines = NPC_LINES[sp.i];
    say(ped, lines[Math.floor(Math.random() * lines.length)], "#ffe6a8", 3.4);
    const a = approval();
    const good = Math.random() < clamp(a / 100 + 0.15, 0.2, 0.9);
    setTimeout(function () { if (APP.live === L) react(good ? "cheer" : "boo"); }, 1400);
    sp.i++;
    sp.t = Math.max(8, ((L.item.t1 - L.item.t0) * CBZ.dayCycleSeconds() - 12) / 3);
  }

  // ---- the per-tick run of the diary -------------------------------------
  function tickDiary(dt) {
    const T = now();
    const D = Math.floor(T);
    const list = baseSchedule(D).concat(APP.extra);
    const c = current();
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const s = stateOf(it);
      if (s.phase === "cancelled" || s.phase === "done" || s.phase === "skipped" || s.phase === "missed") continue;
      if ((s.phase === "pending" || s.phase === "prep") && isCancelled(it)) { cancelItem(it, lockdown().active ? "lockdown" : "vacant"); continue; }
      if (s.phase === "live") continue;
      if (T >= it.t1) {
        s.phase = "missed";
        if (CROWD.stage && CROWD.stage.itemId === it.id) { if (CROWD.stage.kind === "rally") dropRally(); crowdRelease(true); }
        continue;
      }
      // the Chief of Staff comes to find you
      if (c.kind === "player" && !s.reminded && T >= it.t0 - sec(22)) { s.reminded = true; remind(it); }
      // the crowd starts arriving ~25 s early for a speech near the player
      if (s.phase === "pending" && T >= it.t0 - sec(25) && !APP.live) {
        s.phase = "prep";
        if (it.kind === "speech") {
          const st = stageOf(it.place);
          if (st) { st.itemId = it.id; if (st.kind === "rally") buildRally(st); crowdGather(st, false); }
        }
      }
      // an NPC President steps out before the crowd is fully in
      if (s.phase === "prep" && it.kind === "speech" && it.place.stage === "balcony" && c.kind === "npc" && c.ped && !s.npcOut && T >= it.t0 - sec(12)) {
        const P = playerPos();
        const watching = distXZ(P, B.stand.x, B.stand.z) < 25 || (c.ped.pos && distXZ(P, c.ped.pos.x, c.ped.pos.z) < 25);
        if (!watching || T >= it.t0 - sec(2)) { if (B.group) { npcTo(c.ped, B.stand.x, B.deckY, B.stand.z, 0); s.npcOut = true; } }
      }
      if (T >= it.t0 && !APP.live) {
        startLive(it, false);
        if (APP.live && s.npcOut) APP.live.npcPlaced = true;
      }
    }
  }
  function tickLive(dt) {
    const L = APP.live;
    if (!L) return;
    const T = now(), it = L.item;
    L.t += dt;
    const c = current();
    // the President changed under us (death, succession): that ends it
    if ((L.who === "player" && c.kind !== "player") || (L.who === "npc" && (c.kind !== "npc" || (L.ped && L.ped.dead)))) { endLive("cancel", "president"); return; }
    if (it.kind === "speech") {
      const sp = L.sp;
      if (L.who === "npc") {
        if (!L.ped && c.ped) L.ped = c.ped;
        if (!L.npcPlaced && L.ped && !L.mc) npcToStage(L, false);
        tickNpcSpeech(L, dt);
      } else if (sp.phase === "wait") {
        if (T >= L.waitUntil) { skip(L, "no-show"); return; }
      } else if (sp.phase === "react") {
        sp.t -= dt;
        if (sp.t <= 0) {
          if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
          sp.i++;
          if (sp.i >= sp.beats.length) finishSpeech(L);
          else { sp.phase = "beat"; runBeat(L); }
        }
      } else if (sp.phase === "beat" && sp.awaiting) {
        // walking away from the lectern ends it
        const P = playerPos(), st = L.stage;
        if (st && distXZ(P, st.x, st.z) > 3.2) { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} } }
      }
      if (L.endAt && T >= L.endAt) { endLive("end"); return; }
      if (T >= it.t1) {
        if (L.who === "player" && !sp.started) { skip(L, "no-show"); return; }
        if (L.who === "npc" || sp.phase === "done" || T >= it.t1 + sec(30)) endLive("end");
      }
      return;
    }
    // motorcade / visit
    if (L.who === "player" && L.phase === "board") {
      const M = CBZ.motorcade;
      // a ride the President already took (he picked a place himself) is his:
      // the appointment never re-routes it. It waits for the column to be free
      // and, if he is still away when the window closes, it is a no-show.
      // (This used to call run() over the top of his ride: motorcade.run
      // replaces a boarding player run, so the car he sat in for a 700 m hop
      // to the Capitol silently re-planned a 13 km trip to the appointment.)
      const busy = M && typeof M.active === "function" ? M.active() : null;
      if (busy) { if (T >= L.waitUntil) { skip(L, "no-show"); return; } }
      else if (playerNearCourt()) {
        L.phase = "on";
        if (M && typeof M.run === "function") {
          try {
            L.mc = M.run({ principal: "player", from: { x: playerPos().x, z: playerPos().z }, to: { x: it.place.x, z: it.place.z }, route: it.route,
              onArrive: function () { if (APP.live === L) L.arrivedT = now(); } }) || true;
          } catch (e) { L.mc = null; }
        }
      } else if (T >= L.waitUntil) { skip(L, "no-show"); return; }
    }
    if (it.kind === "visit" && L.arrivedT != null && !L.returning && T - L.arrivedT > sec(20)) {
      if (L.who === "npc") goHome(L);
      else L.returning = true;
    }
    if (T >= it.t1) endLive("end");
  }

  // ---- the door zones ------------------------------------------------------
  function wireZones() {
    if (B.zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    B.zonesWired = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "prespub-balcony-out", kind: "presbalcony", radius: 2.2, prio: 16,
      find: function (px, pz) {
        if (!inCity() || !B.group) return null;
        const P = playerPos();
        if (!P || Math.abs(P.y - B.floorY) > 1.1) return null;
        const q = B.inside;
        return Math.hypot(q.x - px, q.z - pz) < 2.2 ? { x: q.x, y: q.y, z: q.z, kind: "presbalcony" } : null;
      },
      options: [{ id: "prespub-step-out", slot: "e", label: "Step out",
        onSelect: function () { movePlayer(B.cx + 2.4, B.deckY + 0.02, B.facadeZ + 1.6, 0); } }],
    });
    I.registerZone({
      id: "prespub-balcony-in", kind: "presbalcony", radius: 1.8, prio: 16,
      find: function (px, pz) {
        if (!inCity() || !B.group) return null;
        const P = playerPos();
        if (!P || !onBalcony(P)) return null;
        const q = B.door;
        return Math.hypot(q.x - px, q.z - pz) < 1.8 && !(APP.live && APP.live.sp && APP.live.sp.awaiting) ? { x: q.x, y: q.y, z: q.z, kind: "presbalcony" } : null;
      },
      options: [{ id: "prespub-go-in", slot: "e", label: "Go in",
        onSelect: function () { const q = B.inside; movePlayer(q.x, q.y + 0.02, q.z, Math.PI); } }],
    });
    I.registerZone({
      id: "prespub-lectern", kind: "preslectern", radius: 1.4, prio: 18,
      find: function (px, pz) {
        const L = APP.live;
        if (!inCity() || !L || L.who !== "player" || !L.sp || L.sp.started || !L.stage) return null;
        const P = playerPos();
        if (!P || Math.abs(P.y - L.stage.y) > 1.0) return null;
        return Math.hypot(L.stage.x - px, L.stage.z - pz) < 1.4 ? { x: L.stage.x, y: L.stage.y, z: L.stage.z, kind: "preslectern" } : null;
      },
      options: [{ id: "prespub-speak", slot: "e", label: "Speak",
        onSelect: function () {
          const L = APP.live; if (!L) return;
          const P = CBZ.player;
          if (P && P.pos && L.stage) { P.pos.x = L.stage.x; P.pos.z = L.stage.z; if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = L.stage.face; }
          beginPlayerSpeech(L);
        } }],
    });
  }

  // ============================================================
  //  §7  PROTESTS AT THE GATE
  // ============================================================
  function gatePoint() { const s = site(); return s && s.gate ? { x: s.gate.x, z: s.gate.z } : (s ? { x: s.cx, z: s.rect.maxZ } : null); }
  function startProtest(size, force) {
    const gp = gatePoint(); if (!gp) return false;
    const a = anger();
    PROT.active = true;
    PROT.anger = a;
    PROT.size = clamp(Math.round(size != null ? size : 6 + a * 14), 4, 22);
    PROT.at = { x: gp.x, z: gp.z + 13 };            // +z is out of the compound: the approach road, never inside
    PROT.startT = now();
    PROT.until = now() + pace(size != null ? 1.6 : 1.0 + 0.6 * h01(Math.floor(now()), PROT.size, 0x5c1));
    PROT.slogans = slogansNow();
    PROT.slots = null;
    PROT.chantT = 3;
    PROT.tries = 0;
    emit("protest", { phase: "start", size: PROT.size, at: { x: PROT.at.x, z: PROT.at.z } });
    news(PROT.size >= 14 ? "A large crowd of protesters fills the road outside the Executive Mansion." : "Protesters gather outside the Executive Mansion gate.");
    fillProtest(force);
    return true;
  }
  function protestSlots() {
    if (PROT.slots) return PROT.slots;
    const gp = gatePoint(), out = [];
    let r = 0;
    while (out.length < PROT.size && r < 6) {
      const cnt = 6 + r;
      for (let i = 0; i < cnt && out.length < PROT.size; i++) {
        const k = i === 0 ? 0 : (i % 2 ? (i + 1) / 2 : -i / 2);
        const x = gp.x + k * 1.4 + (r % 2 ? 0.7 : 0) + (h01(r, i, 0x5c2) - 0.5) * 0.5;
        const z = gp.z + 9 + r * 1.7 + (h01(i, r, 0x5c3) - 0.5) * 0.5;
        out.push({ x: x, z: z, face: faceTo(x, z, gp.x, gp.z) });
      }
      r++;
    }
    PROT.slots = out;
    return out;
  }
  function policeLineWanted() {
    const d = deployments();
    return { want: !!(d.surge || d.martial || curfewLive() || lockdown().active), soldiers: !!(d.martial || lockdown().active) };
  }
  function fillProtest(force) {
    if (!PROT.active) return;
    const gp = gatePoint(), P = playerPos();
    if (!gp) return;
    const near = force || distXZ(P, gp.x, gp.z) < 170;
    if (!near) { releaseProtestBodies(); return; }
    const slots = protestSlots();
    let made = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.ped) continue;
      if (!force && made >= 3) break;
      const ped = postMember(s.x, s.z, s.face, "pro", i, force || PROT.tries > 20);
      if (!ped) { if (owned() >= BUDGET) break; continue; }
      s.ped = ped; made++;
      PROT.members.push({ ped: ped, slot: s });
      giveSign(ped, PROT.slogans[i % PROT.slogans.length], false);
    }
    PROT.tries = (PROT.tries || 0) + 1;
    // the line between them and the gate
    const LW = policeLineWanted();
    if (LW.want && !PROT.police.length) {
      for (let i = 0; i < 4 && owned() < BUDGET; i++) {
        const x = gp.x + (i - 1.5) * 2.6, z = gp.z + 4.8;
        const b = LW.soldiers ? postSoldier(x, z, 0, "prespublic:protestline") : postCop(x, z, 0, 1, "prespublic:protestline");
        if (b) PROT.police.push(b);
      }
    } else if (!LW.want && PROT.police.length) {
      for (let i = 0; i < PROT.police.length; i++) dropBody(PROT.police[i]);
      PROT.police.length = 0;
    }
  }
  function releaseProtestBodies() {
    for (let i = 0; i < PROT.members.length; i++) unpost(PROT.members[i].ped);
    PROT.members.length = 0;
    if (PROT.slots) for (let i = 0; i < PROT.slots.length; i++) PROT.slots[i].ped = null;
    for (let i = 0; i < PROT.police.length; i++) dropBody(PROT.police[i]);
    PROT.police.length = 0;
  }
  function endProtest(phase) {
    if (!PROT.active) return;
    PROT.active = false;
    const flee = phase === "dispersed";
    for (let i = 0; i < PROT.members.length; i++) startDrift(PROT.members[i].ped, PROT.drifting, flee ? { x: PROT.at.x, z: PROT.at.z - 6 } : gatePoint(), flee);
    PROT.members.length = 0;
    for (let i = 0; i < PROT.police.length; i++) dropBody(PROT.police[i]);
    PROT.police.length = 0;
    PROT.slots = null;
    PROT.cooldownUntil = now() + pace(0.8);
    emit("protest", { phase: phase || "end", size: PROT.size, at: PROT.at ? { x: PROT.at.x, z: PROT.at.z } : null });
    if (flee) news("Police break up the protest outside the Executive Mansion.");
  }
  function disperseProtest() { endProtest("dispersed"); }
  const CHANTS = {
    "NO CURFEW": "No curfew! No curfew!", "SOLDIERS OUT": "Soldiers out! Soldiers out!", "RESIGN": "Resign! Resign!",
    "WHERE IS THE MONEY": "Where's the money?", "NO DICTATOR": "No dictator! No dictator!", "BRING THEM HOME": "Bring them home!",
    "STOP THE CRACKDOWN": "Stop the crackdown!", "KEEP US SAFE": "Keep us safe!", "ENOUGH": "Enough! Enough!",
  };
  function tickProtest(dt) {
    const T = now();
    if (PROT.active) {
      if (T >= PROT.until || current().kind === "vacant") { endProtest("end"); return; }
      // a curfew at night clears the street
      if (curfewLive() && isNight() && policeLineWanted().want) { endProtest("dispersed"); return; }
      fillProtest(false);
      PROT.chantT -= dt;
      if (PROT.chantT <= 0 && PROT.members.length) {
        PROT.chantT = 5 + Math.random() * 3;
        const m = PROT.members[(Math.random() * PROT.members.length) | 0];
        const sl = PROT.slogans[(Math.random() * PROT.slogans.length) | 0];
        say(m.ped, CHANTS[sl] || (sl.charAt(0) + sl.slice(1).toLowerCase() + "!"), "#ffb4a8", 2.8);
        for (let i = 0; i < PROT.members.length; i++) if (Math.random() < 0.5) hype(PROT.members[i].ped, 2.4);
      }
      return;
    }
    // does one form?
    if (T - PROT.lastEval < sec(2)) return;
    PROT.lastEval = T;
    if (T < PROT.cooldownUntil || current().kind === "vacant") return;
    const a = anger();
    if (a >= 0.3 && clockHour(T) > 7 && clockHour(T) < 22) startProtest(null, false);
  }

  // ============================================================
  //  §8  THE STATE ON THE STREET — checkpoints, corner pairs, roadblocks
  // ============================================================
  function postCop(x, z, fx, fz, tag) {
    if (!CBZ.citySpawnCop || owned() >= BUDGET) return null;
    let c = null;
    try { c = CBZ.citySpawnCop(x, z, false); } catch (e) { c = null; }
    if (!c) return null;
    if (c.pos && c.pos.set) c.pos.set(x, CBZ.floorAt ? CBZ.floorAt(x, z) : 0, z);
    const spec = { x: x, z: z, fx: fx, fz: fz, relaxed: true, kind: "checkpoint", tag: tag, job: "police officer" };
    if (CBZ.cityPostStand) { try { c._post = CBZ.cityPostStand(c, spec) || c._post; } catch (e) {} }
    if (!c._post) c._post = { x: x, z: z, fx: fx, fz: fz, mount: null, mountT: 0, relaxed: true };
    if (c.group) c.group.rotation.y = Math.atan2(fx, fz);
    c._presPublic = true; c._isCop = true;
    return c;
  }
  function postSoldier(x, z, face, tag) {
    if (!CBZ.cityPostNpc || owned() >= BUDGET) return null;
    let p = null;
    try {
      p = CBZ.cityPostNpc(x, z, { job: "soldier", archetype: "military", kind: "security", armed: true, weapon: "Rifle", aggr: 0.35, pin: true, face: face, src: tag, pose: "foldarms" });
    } catch (e) { p = null; }
    if (p) { p.organization = "military"; p._presPublic = true; }
    return p;
  }
  function dropBody(b) {
    if (!b || b.dead) return;
    if (b._isCop) {
      if (CBZ.cityPostRelease) { try { CBZ.cityPostRelease(b, "stand-down"); } catch (e) {} }
      b._post = null;
      if (b.group && b.group.parent) b.group.parent.remove(b.group);
      const L = CBZ.cityCops; if (L) { const i = L.indexOf(b); if (i >= 0) L.splice(i, 1); }
      return;
    }
    unpost(b);
  }
  function makeCruiser(x, z, heading) {
    if (!CBZ.cityMakeCar || !CBZ.cityCruiserModel) return null;
    let c = null;
    try { c = CBZ.cityMakeCar(x, z, heading, false, CBZ.cityCruiserModel(), 0); } catch (e) { c = null; }
    if (!c) return null;
    if (CBZ.cityMarkCruiser) { try { CBZ.cityMarkCruiser(c); } catch (e) {} }
    c.ai = false; c.v = 0; c.baseV = 0; c.road = null; c.parked = true; c._presPublic = true;
    return c;
  }
  function dropCar(c) {
    if (!c) return;
    const P = CBZ.player;
    if (c.stolen || c.wrecked || c.dead || (P && P._vehicle === c)) return;       // it is somebody's now
    const L = CBZ.cityCars; if (L) { const i = L.indexOf(c); if (i >= 0) L.splice(i, 1); }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }
  let _coneGeo = null;
  function cones(grp, pts) {
    if (!_coneGeo) _coneGeo = new THREE.ConeGeometry(0.17, 0.52, 7);
    for (let i = 0; i < pts.length; i++) {
      const m = new THREE.Mesh(_coneGeo, cm(0xff6a1a));
      m.position.set(pts[i][0], (CBZ.floorAt ? CBZ.floorAt(pts[i][0], pts[i][1]) : 0) + 0.26, pts[i][1]);
      grp.add(m);
    }
  }
  function roads() {
    const A = CBZ.city && CBZ.city.arena;
    return (A && A.roads) || (CBZ.city && CBZ.city.roads) || [];
  }
  function segEnds(r) {
    const h = (r.len || 0) / 2;
    return r.vertical ? [{ x: r.x, z: r.z - h }, { x: r.x, z: r.z + h }] : [{ x: r.x - h, z: r.z }, { x: r.x + h, z: r.z }];
  }
  function nearestOnSeg(r, px, pz) {
    const h = (r.len || 0) / 2;
    if (r.vertical) return { x: r.x, z: clamp(pz, r.z - h, r.z + h) };
    return { x: clamp(px, r.x - h, r.x + h), z: r.z };
  }
  // a checkpoint across a road near the player
  function buildCheckpoint(r, pt, tag) {
    const root = arenaRoot(); if (!root) return null;
    const grp = new THREE.Group(); root.add(grp);
    const ax = r.vertical ? 0 : 1, az = r.vertical ? 1 : 0;          // along the road
    const nx = r.vertical ? 1 : 0, nz = r.vertical ? 0 : 1;          // across it
    const hw = ((r.w != null ? r.w : 18) / 2);
    const pts = [];
    for (let i = 0; i < 5; i++) { const off = -hw * 0.6 + i * (hw * 1.2 / 4); pts.push([pt.x + nx * off - ax * 6, pt.z + nz * off - az * 6]); }
    cones(grp, pts);
    const it = { kind: tag, x: pt.x, z: pt.z, group: grp, bodies: [], cars: [] };
    const car = makeCruiser(pt.x + nx * (hw - 2.5) + ax * 3, pt.z + nz * (hw - 2.5) + az * 3, Math.atan2(nx, nz) + 0.5);
    if (car) it.cars.push(car);
    const c1 = postCop(pt.x + nx * 1.5 - ax * 3.5, pt.z + nz * 1.5 - az * 3.5, -ax, -az, "prespublic:" + tag);
    const c2 = postCop(pt.x - nx * 1.8 - ax * 3.0, pt.z - nz * 1.8 - az * 3.0, -ax, -az, "prespublic:" + tag);
    if (c1) it.bodies.push(c1);
    if (c2) it.bodies.push(c2);
    return it;
  }
  function dropItem(it) {
    if (it.group && it.group.parent) it.group.parent.remove(it.group);
    for (let i = 0; i < it.bodies.length; i++) dropBody(it.bodies[i]);
    for (let i = 0; i < (it.cars || []).length; i++) dropCar(it.cars[i]);
    for (let i = 0; i < (it.cols || []).length; i++) uncol(it.cols[i]);
    if (it.cols && it.cols.length) dirtyCols();
    it.bodies = []; it.cars = []; it.cols = [];
  }
  function roadPoints(P, minD, maxD, max, sep, salt) {
    const R = roads(), out = [];
    const cand = [];
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !isFinite(r.x) || !isFinite(r.z) || !(r.len > 20)) continue;
      if (Math.abs(r.x - P.x) > maxD + r.len && Math.abs(r.z - P.z) > maxD + r.len) continue;
      const q = nearestOnSeg(r, P.x, P.z);
      const d = Math.hypot(q.x - P.x, q.z - P.z);
      // step along the road so the point is not right under his feet
      if (d < minD) {
        const h = (r.len || 0) / 2, along = minD + 10;
        if (r.vertical) { const z = q.z + (q.z >= P.z ? along : -along); if (Math.abs(z - r.z) > h) continue; q.z = z; }
        else { const x = q.x + (q.x >= P.x ? along : -along); if (Math.abs(x - r.x) > h) continue; q.x = x; }
      }
      const d2 = Math.hypot(q.x - P.x, q.z - P.z);
      if (d2 < minD || d2 > maxD) continue;
      cand.push({ r: r, p: q, k: h01(Math.round(q.x / 10), Math.round(q.z / 10), salt) });
    }
    cand.sort(function (a, b) { return a.k - b.k; });
    for (let i = 0; i < cand.length && out.length < max; i++) {
      let ok = true;
      for (let j = 0; j < out.length; j++) if (Math.hypot(out[j].p.x - cand[i].p.x, out[j].p.z - cand[i].p.z) < sep) { ok = false; break; }
      if (ok) out.push(cand[i]);
    }
    return out;
  }
  function cornerPoints(P, max, salt) {
    const R = roads(), cand = [];
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !(r.len > 20)) continue;
      const E = segEnds(r), hw = (r.w != null ? r.w : 18) / 2 + 2.2;
      for (let e = 0; e < 2; e++) {
        const d = Math.hypot(E[e].x - P.x, E[e].z - P.z);
        if (d < 35 || d > 130) continue;
        const sx = h01(E[e].x, E[e].z, salt) < 0.5 ? -1 : 1, sz = h01(E[e].z, E[e].x, salt + 1) < 0.5 ? -1 : 1;
        cand.push({ x: E[e].x + sx * hw, z: E[e].z + sz * hw, road: E[e], k: h01(Math.round(E[e].x), Math.round(E[e].z), salt + 2) });
      }
    }
    cand.sort(function (a, b) { return a.k - b.k; });
    const out = [];
    for (let i = 0; i < cand.length && out.length < max; i++) {
      let ok = true;
      for (let j = 0; j < out.length; j++) if (Math.hypot(out[j].x - cand[i].x, out[j].z - cand[i].z) < 40) { ok = false; break; }
      if (ok) out.push(cand[i]);
    }
    return out;
  }
  function pairAt(pt, soldiers, tag) {
    const it = { kind: tag, x: pt.x, z: pt.z, group: null, bodies: [], cars: [] };
    const fx = pt.road.x - pt.x, fz = pt.road.z - pt.z, L = Math.hypot(fx, fz) || 1;
    const face = Math.atan2(fx / L, fz / L);
    for (let i = 0; i < 2; i++) {
      const ox = Math.cos(face) * (i ? 0.7 : -0.7), oz = -Math.sin(face) * (i ? 0.7 : -0.7);
      const b = soldiers ? postSoldier(pt.x + ox, pt.z + oz, face, "prespublic:" + tag) : postCop(pt.x + ox, pt.z + oz, fx / L, fz / L, "prespublic:" + tag);
      if (b) it.bodies.push(b);
    }
    return it;
  }
  function approachRoadblock() {
    const s = site(); if (!s) return null;
    const gp = gatePoint();
    let pt = { x: gp.x, z: gp.z + 40 }, rr = { vertical: true, x: gp.x, z: gp.z + 40, w: 18, len: 80 };
    const R = s.roads || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < R.length; i++) {
      const r = R[i]; if (!r || !isFinite(r.x)) continue;
      const q = nearestOnSeg(r, gp.x, gp.z), d = Math.hypot(q.x - gp.x, q.z - gp.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (best && bd < 20) {
      if (best.vertical) { const sg = best.z >= gp.z ? 1 : -1; pt = { x: best.x, z: gp.z + sg * 40 }; }
      else { const sg = best.x >= gp.x ? 1 : -1; pt = { x: gp.x + sg * 40, z: best.z }; }
      rr = best;
    }
    return { pt: pt, road: rr };
  }
  function buildLockdown() {
    const gp = gatePoint(); if (!gp) return null;
    const rb = approachRoadblock();
    const it = buildCheckpoint(rb.road, rb.pt, "lockdown");
    if (!it) return null;
    // two cruisers nose to nose across the lane: a roadblock, not a watch post
    const r = rb.road, nx = r.vertical ? 1 : 0, nz = r.vertical ? 0 : 1;
    const car2 = makeCruiser(rb.pt.x - nx * 3, rb.pt.z - nz * 3, Math.atan2(nx, nz) - 0.5);
    if (car2) it.cars.push(car2);
    for (const sx of [-1, 1]) for (const k of [0, 1]) {
      const b = postSoldier(gp.x + sx * (13.4 + k * 1.6), gp.z + 1.6, 0, "prespublic:lockdown-gate");
      if (b) it.bodies.push(b);
    }
    return it;
  }
  function tickConsequences(dt) {
    CONS.t -= dt;
    if (CONS.t > 0) return;
    CONS.t = 3;
    const P = playerPos();
    const Pl = CBZ.player;
    const want = {};
    const hasSeat = current().kind === "player";
    if (P && !(Pl && Pl._aircraft)) {
      if (hasSeat && curfewLive() && isNight()) want.curfew = true;
      const d = deployments();
      if (hasSeat && d.surge) want.surge = true;
      if (hasSeat && d.martial && Math.hypot(d.martial.at.x - P.x, d.martial.at.z - P.z) > 120) want.martial = true;
      const gp = gatePoint();
      if (lockdown().active && gp && distXZ(P, gp.x, gp.z) < 300) want.lockdown = true;
    }
    // drop what is no longer wanted, or what he has left behind
    for (let i = CONS.items.length - 1; i >= 0; i--) {
      const it = CONS.items[i];
      const far = P ? distXZ(P, it.x, it.z) > (it.kind === "lockdown" ? 360 : 230) : true;
      if (!want[it.kind] || far) { dropItem(it); CONS.items.splice(i, 1); }
    }
    function count(kind) { let n = 0; for (let i = 0; i < CONS.items.length; i++) if (CONS.items[i].kind === kind) n++; return n; }
    if (want.lockdown && !count("lockdown")) { const it = buildLockdown(); if (it) CONS.items.push(it); }
    if (want.curfew && count("curfew") < 2 && owned() < BUDGET - 3) {
      const pts = roadPoints(P, 55, 150, 2 - count("curfew"), 70, 0x5d1);
      for (let i = 0; i < pts.length; i++) {
        let clash = false;
        for (let j = 0; j < CONS.items.length; j++) if (Math.hypot(CONS.items[j].x - pts[i].p.x, CONS.items[j].z - pts[i].p.z) < 60) clash = true;
        if (clash || !spawnSafe(pts[i].p.x, pts[i].p.z, false)) continue;
        const it = buildCheckpoint(pts[i].r, pts[i].p, "curfew");
        if (it) CONS.items.push(it);
      }
    }
    for (const kind of ["surge", "martial"]) {
      if (!want[kind] || count(kind) >= 2 || owned() > BUDGET - 2) continue;
      const pts = cornerPoints(P, 2 - count(kind), kind === "surge" ? 0x5d2 : 0x5d3);
      for (let i = 0; i < pts.length; i++) {
        let clash = false;
        for (let j = 0; j < CONS.items.length; j++) if (Math.hypot(CONS.items[j].x - pts[i].x, CONS.items[j].z - pts[i].z) < 30) clash = true;
        if (clash || !spawnSafe(pts[i].x, pts[i].z, false)) continue;
        CONS.items.push(pairAt(pts[i], kind === "martial", kind));
      }
    }
  }

  // ============================================================
  //  §9  DEATH, PANIC, EVACUATION
  // ============================================================
  function evacuate() {
    const L = APP.live;
    const P = CBZ.player;
    if (L) {
      const st = L.stage;
      if (L.item.kind === "speech") {
        if (st) panicAll(st.x, st.z);
        if (L.who === "player" && P && P.pos && onBalcony(P.pos)) movePlayer(B.inside.x, B.inside.y + 0.02, B.inside.z, Math.PI);
        if (L.who === "npc" && L.npcPlaced) npcHome();
      }
      endLive("panic", "evacuate");
      return true;
    }
    if (P && P.pos && onBalcony(P.pos) && playerPres()) { movePlayer(B.inside.x, B.inside.y + 0.02, B.inside.z, Math.PI); return true; }
    return false;
  }
  function onPresidentDown(ev) {
    const at = ev && ev.at ? ev.at : null;
    const L = APP.live;
    if (L && L.item.kind === "speech") {
      const st = L.stage;
      panicAll(at ? at.x : st.x, at ? at.z : st.z);
      NPCP.away = false;                      // the body stays where it fell
      endLive("panic", "assassinated");
    } else if (L) {
      endLive("cancel", "assassinated");
    }
    if (PROT.active && at && distXZ(at, PROT.at.x, PROT.at.z) < 200) endProtest("dispersed");
  }

  // ============================================================
  //  §10  THE TICK
  // ============================================================
  let T4 = 0, builtArena = null;
  function resetAll() {
    if (APP.live) { try { endLive("cancel", "reset"); } catch (e) {} }
    crowdRelease(false);
    for (let i = 0; i < PANIC.length; i++) unpost(PANIC[i].ped);
    PANIC.length = 0;
    for (let i = 0; i < CROWD.drifting.length; i++) unpost(CROWD.drifting[i].ped);
    CROWD.drifting.length = 0;
    releaseProtestBodies();
    for (let i = 0; i < PROT.drifting.length; i++) unpost(PROT.drifting[i].ped);
    PROT.drifting.length = 0;
    PROT.active = false;
    for (let i = 0; i < CONS.items.length; i++) dropItem(CONS.items[i]);
    CONS.items.length = 0;
    dropRally();
    APP.state = {}; APP.extra = []; APP.live = null;
    NPCP.away = false; NPCP.ped = null;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.788, function (dt) {
    if (!inCity()) return;
    // a rebuilt world: everything we held pointed into the old one
    if (builtArena !== CBZ.govComplexes) {
      if (builtArena) { resetAll(); teardownBalcony(); }
      builtArena = CBZ.govComplexes;
    }
    T4 -= dt;
    tickCrowdPoses(dt);
    if (PANIC.length) tickPanic(dt);
    if (APP.live) tickLive(dt);
    if (T4 > 0) return;
    const step = 0.25 - T4;
    T4 = 0.25;
    if (!site()) return;
    buildBalcony();
    wireZones();
    wireBus();
    tickDiary(step);
    if (CROWD.stage) crowdFill(false);
    tickProtest(step);
    tickDrift(CROWD.drifting, step);
    tickDrift(PROT.drifting, step);
    tickConsequences(step);
  });

  // ============================================================
  //  §11  PUBLIC
  // ============================================================
  function nowAppearance() {
    const L = APP.live;
    if (!L) return null;
    const it = L.item;
    return { id: it.id, kind: it.kind, place: Object.assign({}, it.place), t0: it.t0, t1: it.t1, who: L.who,
      speaking: !!(L.sp && (L.sp.started || L.who === "npc") && L.sp.phase !== "done") };
  }
  function crowdRead() {
    let s = 0, p = 0;
    for (let i = 0; i < CROWD.members.length; i++) { const m = CROWD.members[i]; if (m.ped.dead) continue; if (m.role === "pro") p++; else s++; }
    if (!CROWD.members.length && CROWD.stage) { s = CROWD.supporters; p = CROWD.protesters; }
    return { size: s + p, supporters: s, protesters: p };
  }
  function balconyRead() {
    if (!B.group) buildBalcony();
    if (!B.group) return null;
    return { x: B.stand.x, y: B.deckY, z: B.stand.z, inside: { x: B.inside.x, y: B.inside.y, z: B.inside.z } };
  }
  function protestsRead() {
    return PROT.active && PROT.at ? [{ x: PROT.at.x, z: PROT.at.z, size: PROT.size }] : [];
  }

  CBZ.presidentPublic = {
    schedule: schedule,
    now: nowAppearance,
    crowd: crowdRead,
    balcony: balconyRead,
    protests: protestsRead,
    evacuate: evacuate,
    // harness/test hooks only, not part of the public contract
    _startNow: function (kind) {
      if (!site()) return null;
      buildBalcony();
      if (APP.live) endLive("cancel", "harness");
      kind = kind || "speech";
      const T = now();
      let place = null;
      if (kind === "speech") place = balconyPlace();
      else { const PL = buildPlaces(); place = PL.visits[0] || PL.rallies[0] || null; }
      if (!place) return null;
      const it = { id: "pa:hook:" + (++APP.seq), kind: kind, place: place, t0: T, t1: T + sec(80), hour0: +clockHour(T).toFixed(2) };
      if (kind !== "speech") { const r = routeTo(place); if (r) it.route = r; }
      APP.extra.push(it);
      stateOf(it).reminded = true;
      startLive(it, true);
      const L = APP.live;
      if (L && kind === "speech") {
        if (L.who === "player") movePlayer(B.stand.x, B.deckY + 0.02, B.stand.z, 0, true);
        else if (L.ped) { npcTo(L.ped, B.stand.x, B.deckY, B.stand.z, 0); L.npcPlaced = true; }
      }
      return it.id;
    },
    _speechBeat: function (choiceIndex) {
      const L = APP.live;
      if (!L || !L.sp) return false;
      if (L.who === "npc") { L.sp.t = 0; tickNpcSpeech(L, 0); return true; }
      if (!L.sp.started) { beginPlayerSpeech(L); return true; }
      if (L.sp.awaiting && CBZ.campaignUI && CBZ.campaignUI.choose) { CBZ.campaignUI.choose((choiceIndex | 0) ? "b" : "a"); return true; }
      if (L.sp.phase === "react") { L.sp.t = 0; return true; }
      return false;
    },
    _protestNow: function (size) {
      if (PROT.active) endProtest("end");
      PROT.cooldownUntil = -1;
      return startProtest(size != null ? size : 14, true);
    },
    _state: function () { return { app: APP, crowd: CROWD, prot: PROT, cons: CONS, balcony: B, owned: owned() }; },
    _reset: resetAll,
  };
})();
