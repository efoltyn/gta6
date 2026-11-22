/* ============================================================
   city/hitman_m_duel.js — AUTHORED JOB: THE OTHER RIFLE.

   OWNER: "A mission where you have to snipe a sniper who is also trying to
   snipe you." A duel at the longest range the city has, with the best
   shooter the other side could buy. He is on a roof somewhere in a wide arc
   of buildings and the paper does not know which. He hunts you as you hunt
   him.

   Registered with CBZ.hitmanJobs (city/hitman.js): the burner, Nico, the
   envelope, the folder, the cork. Nothing here draws a panel or keeps
   score, and nothing tells you when it is over.

   THE FIELD (from the world's records, never a coordinate)
     the nest    a mid-rise roof you reach by its lift, ringed on the atlas
                 page. Only a suggestion: he hunts you wherever you are.
     the arc     the lift roofs at long range that see the nest. He is on
                 one. A second one is dressed to look like him (a hat on a
                 stick behind a rifle and a lens). The paper names them all.
     the range   as long as the air lets you see: half the haze distance,
                 capped by the city (220 to 340 m). The rifle's round is
                 lifted to carry that far for as long as the job is live
                 (it is a real projectile with drag and drop,
                 systems/fpsmode.js; at 300 m it falls most of a metre and
                 takes four tenths of a second to arrive. The game's
                 ballistics have no wind term, so there is no wind here).

   HIM
     He stands at his roof's rim with the rifle over it: head, shoulders and
     the rifle show, the rest is masonry. He comes up to look, and folds
     down under the rim again. He can only be hit while he can see.
     SEEING YOU   only what he can see counts: how much of you shows over
                  your own parapet, whether you are moving, whether the sun
                  is on your glass. Behind cover he learns nothing.
     YOUR SHOT    tells him exactly where you are. He ZEROES that spot: show
                  yourself within a couple of metres of it again and his
                  next round needs half a second and does not miss.
     HIS SHOT     the flash, then the round (it gets there before the
                  sound: at 300 m the crack and the chip of wall beside your
                  head come 0.4 s after the flash, the report half a second
                  after that). A first round at a new spot usually goes a
                  hand wide. One hit is most of you; the second, or a head,
                  is all of you.
     AFTER IT     he moves along his roof to another corner before he looks
                  again. So should you.
     GLASS        when the sun is on his side of the sky for you, his scope
                  flashes while he settles on you. The dummy's glass shines
                  steadily and never moves: that is how you tell them apart.
                  Shoot the dummy and you have told him where you are.

   WHEN IT IS OVER it just goes quiet. The pipe's money text is held until
   you have gone to his roof and stood over him: his mat, his brass, and
   the card he drew of YOUR roof.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game || !CBZ.hitmanJobs || !CBZ.hitmanJobs.add) return;
  const g = CBZ.game;

  const PAY = 9000;
  const V0 = 786, DRAG = 0.44;             // the long 7.62 (weapons/ballistics.js CART "762lr")

  /* ---------------- small reads ---------------------------------------- */
  function P() { return CBZ.player || null; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function h01(a, b, c) { return CBZ.hash01 ? CBZ.hash01(a | 0, b | 0, c | 0) : ((Math.sin(a * 12.9898 + b * 78.233 + c) * 43758.5453) % 1 + 1) % 1; }
  function today() { return CBZ.paceDay ? (CBZ.paceDay() | 0) : 0; }
  function groundY(x, z, from) { try { return CBZ.groundAt ? CBZ.groundAt(x, z, from == null ? 2 : from) : 0; } catch (e) { return 0; } }
  function los(ax, ay, az, bx, by, bz) {
    if (!CBZ.clearLineOfFire) return true;
    try { return !!CBZ.clearLineOfFire(ax, ay, az, bx, by, bz); } catch (e) { return true; }
  }
  function lotKey(l) { return l ? (Math.round(l.cx) + ":" + Math.round(l.cz)) : null; }
  function lotName(l) {
    const b = l && l.building;
    if (b && b.name) { const n = String(b.name).trim(); return n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase(); }
    return "the building";
  }
  function liftRoofs() {
    const A = arena(); if (!A) return [];
    const out = [];
    const pools = [A.lots || [], A.shopLots || []];
    for (let q = 0; q < pools.length; q++) for (let i = 0; i < pools[q].length; i++) {
      const l = pools[q][i];
      if (!l || !l.building || !l.building.group || l.building.deferred || l.demolished || !isFinite(l.cx) || out.indexOf(l) >= 0) continue;
      const b = l.building;
      if (!b.lift || !b.roofSlab || b.roofCrown || l.kind === "player" || l.kind === "abandoned") continue;
      if (!(b.h >= 12 && b.h <= 60)) continue;
      out.push(l);
    }
    return out;
  }
  function lotByKey(k) { const L = liftRoofs(); for (let i = 0; i < L.length; i++) if (lotKey(L[i]) === k) return L[i]; return null; }
  function tof(d) { try { if (CBZ.ballistics && CBZ.ballistics.tof) return CBZ.ballistics.tof(V0, DRAG, d); } catch (e) {} return d / 700; }
  function dropAt(d) { const t = tof(d); return 0.5 * 9.81 * t * t; }
  function hazeFar() { const f = CBZ.scene && CBZ.scene.fog; return f && isFinite(f.far) ? f.far : 600; }
  // the sun, as the sky draws it (core/sky.js)
  const _sun = new THREE.Vector3();
  function sunDir() {
    const a = CBZ.sunAngle || 0;
    return _sun.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
  }
  function sunUp() { return (CBZ.sunHeight == null ? 1 : CBZ.sunHeight) > 0.06; }

  /* ---------------- THE FIELD --------------------------------------------- */
  const NO_NEST = { cityhall: 1, courthouse: 1, federal: 1, dmv: 1, hospital: 1, bank: 1, security: 1, transit: 1, postoffice: 1, airfield: 1 };
  // the sight line clears every other roof under it with room (a facade
  // dress can stand a pitched roof on a deck the line-of-fire test does not know)
  function clearOver(ax, ay, az, bx, by, bz, skipA, skipB, L) {
    const dx = bx - ax, dz = bz - az;
    for (let i = 0; i < L.length; i++) {
      const l = L[i]; if (l === skipA || l === skipB) continue;
      const b = l.building;
      const x0 = b.ox - b.w / 2 - 0.6, x1 = b.ox + b.w / 2 + 0.6, z0 = b.oz - b.d / 2 - 0.6, z1 = b.oz + b.d / 2 + 0.6;
      let t0 = 0, t1 = 1, hit = true;
      const pq = [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]];
      for (let k = 0; k < 4 && hit; k++) {
        const pp = pq[k][0], qq = pq[k][1];
        if (Math.abs(pp) < 1e-9) { if (qq < 0) hit = false; continue; }
        const r = qq / pp;
        if (pp < 0) { if (r > t1) hit = false; else if (r > t0) t0 = r; }
        else { if (r < t0) hit = false; else if (r < t1) t1 = r; }
      }
      if (!hit || t1 <= t0) continue;
      const low = Math.min(ay + (by - ay) * t0, ay + (by - ay) * t1);
      if (low < (b.h || 0) + 3.0) return false;
    }
    return true;
  }
  // the spot on a roof's rim nearest a far point, a pace back from the parapet,
  // slid `along` metres down the rim
  function rimPoint(l, tx, tz, along) {
    const b = l.building, hw = b.w / 2 - 0.95, hd = b.d / 2 - 0.95;
    const dx = tx - b.ox, dz = tz - b.oz;
    let x, z;
    if (Math.abs(dx) / (b.w || 1) > Math.abs(dz) / (b.d || 1)) { x = b.ox + Math.sign(dx) * hw; z = clamp(b.oz + clamp(dz, -hd, hd) * 0.25 + (along || 0), b.oz - hd, b.oz + hd); }
    else { z = b.oz + Math.sign(dz) * hd; x = clamp(b.ox + clamp(dx, -hw, hw) * 0.25 + (along || 0), b.ox - hw, b.ox + hw); }
    return { x: x, y: b.h, z: z };
  }
  function sees(a, la, bpt, lb, L) {
    // a standing eye at the rim of roof a to a standing or kneeling man on roof b
    const ay = a.y + 1.6;
    for (let k = 0; k < 2; k++) {
      const by = bpt.y + (k ? 1.6 : 1.05);
      if (!los(a.x, ay, a.z, bpt.x, by, bpt.z)) return false;
    }
    return clearOver(a.x, ay, a.z, bpt.x, bpt.y + 1.05, bpt.z, la, lb, L);
  }
  function pickField(S) {
    const L = liftRoofs();
    const far = hazeFar();
    const dMax = clamp(far * 0.46, 200, 340), dMin = dMax * 0.66;
    if (S && S.nestKey && S.hideKey && S.decoyKey) {
      const nl = lotByKey(S.nestKey), hl = lotByKey(S.hideKey), dl = lotByKey(S.decoyKey);
      if (nl && hl && dl) {
        const arc = (S.arcKeys || []).map(lotByKey).filter(Boolean);
        return { nest: nl, hide: hl, decoy: dl, arc: arc.length ? arc : [hl, dl], dMax: dMax };
      }
    }
    const fields = [];
    for (let i = 0; i < L.length; i++) {
      const nl = L[i], nb = nl.building;
      if (NO_NEST[nl.kind] || nb.h < 15 || nb.h > 42) continue;
      const cand = [];
      for (let j = 0; j < L.length; j++) {
        const hl = L[j]; if (hl === nl) continue;
        const hb = hl.building;
        if (hb.h > 46) continue;
        const d = Math.hypot(hl.cx - nl.cx, hl.cz - nl.cz);
        if (d < dMin || d > dMax) continue;
        const hp = rimPoint(hl, nl.cx, nl.cz, 1.7), np = rimPoint(nl, hl.cx, hl.cz, 0);
        if (!sees(hp, hl, np, nl, L)) continue;
        // a second corner on the same roof to move to
        let alt = null;
        for (const s of [8.2, -5.6, 5.1, -9]) { const q = rimPoint(hl, nl.cx, nl.cz, s); if (Math.hypot(q.x - hp.x, q.z - hp.z) > 3.5 && sees(q, hl, np, nl, L)) { alt = q; break; } }
        if (!alt) continue;
        cand.push({ lot: hl, d: d, a: Math.atan2(hl.cx - nl.cx, hl.cz - nl.cz) });
      }
      if (cand.length < 2) continue;
      cand.sort(function (a, b) { return a.a - b.a; });
      let spread = 0;
      for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) { let da = Math.abs(cand[a].a - cand[b].a); if (da > Math.PI) da = Math.PI * 2 - da; if (da > spread) spread = da; }
      fields.push({ nest: nl, cand: cand, score: Math.min(5, cand.length) * 0.5 + Math.min(1.6, spread) * 1.2 });
    }
    if (!fields.length) return null;
    fields.sort(function (a, b) { return b.score - a.score; });
    const top = fields.slice(0, Math.min(3, fields.length));
    const F = top[Math.min(top.length - 1, (h01(today(), CBZ.WORLD_SEED | 0, 0xd0e1) * top.length) | 0)];
    const c = F.cand.slice(0, 6);
    const hi = Math.min(c.length - 1, (h01(today(), CBZ.WORLD_SEED | 0, 0xd0e2) * c.length) | 0);
    // the dummy goes on the roof furthest round the arc from him
    let di = 0, bd = -1;
    for (let k = 0; k < c.length; k++) { if (k === hi) continue; let da = Math.abs(c[k].a - c[hi].a); if (da > Math.PI) da = Math.PI * 2 - da; if (da > bd) { bd = da; di = k; } }
    // THE ARC ON THE PAPER is wider than the roofs he could really use: every
    // lift roof at that range that looks at the nest goes on the list
    const arc = c.map(function (x) { return x; });
    for (let j = 0; j < L.length && arc.length < 5; j++) {
      const hl = L[j]; if (hl === F.nest || arc.some(function (x) { return x.lot === hl; })) continue;
      const d = Math.hypot(hl.cx - F.nest.cx, hl.cz - F.nest.cz);
      if (d < dMin * 0.85 || d > dMax * 1.08) continue;
      const hp = rimPoint(hl, F.nest.cx, F.nest.cz, 1.7), np = rimPoint(F.nest, hl.cx, hl.cz, 0);
      if (!los(hp.x, hp.y + 1.6, hp.z, np.x, np.y + 1.6, np.z)) continue;
      arc.push({ lot: hl, d: d, a: Math.atan2(hl.cx - F.nest.cx, hl.cz - F.nest.cz) });
    }
    arc.sort(function (a, b) { return a.a - b.a; });
    return { nest: F.nest, hide: c[hi].lot, decoy: c[di].lot, arc: arc.map(function (x) { return x.lot; }), dMax: dMax };
  }

  /* ---------------- PROPS (shared mats, no lights) --------------------------- */
  const MATS = {};
  function mat(hex, basic) {
    const k = hex + (basic ? "b" : "l");
    if (!MATS[k]) { MATS[k] = basic ? new THREE.MeshBasicMaterial({ color: hex }) : new THREE.MeshLambertMaterial({ color: hex }); MATS[k]._shared = true; }
    return MATS[k];
  }
  function box(grp, w, h, d, hex, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex)); m.position.set(x, y, z); m.castShadow = true; grp.add(m); return m; }
  function group() {
    const grp = new THREE.Group();
    grp.userData.transient = true; grp.userData.dynamic = true;
    const A = arena(); if (A && A.root) A.root.add(grp);
    return grp;
  }
  function killGroup(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (n) {
      if (n.geometry && !n.geometry._shared && n.geometry.dispose) n.geometry.dispose();
      if (n.material && !n.material._shared && n.material.dispose) { if (n.material.map && !n.material.map._shared) n.material.map.dispose(); n.material.dispose(); }
    });
  }
  // a bolt rifle, muzzle along +z from the group's origin (the origin is the
  // receiver, where it rests on the parapet); the scope's front lens is
  // userData.lens, in the group's own space
  function buildRifle() {
    const grp = group();
    box(grp, 0.05, 0.11, 0.42, 0x2b2117, 0, -0.03, -0.36);        // the stock
    box(grp, 0.055, 0.07, 0.34, 0x1b1c1e, 0, 0, 0);               // receiver
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.74, 8), mat(0x141516));
    br.rotation.x = Math.PI / 2; br.position.set(0, 0.012, 0.52); grp.add(br);
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 10), mat(0x101112));
    sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.085, 0.02); grp.add(sc);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.026, 0.07, 10), mat(0x101112));
    bell.rotation.x = Math.PI / 2; bell.position.set(0, 0.085, 0.2); grp.add(bell);
    box(grp, 0.012, 0.16, 0.012, 0x141516, 0.06, -0.09, 0.34).rotation.z = -0.32;      // bipod legs
    box(grp, 0.012, 0.16, 0.012, 0x141516, -0.06, -0.09, 0.34).rotation.z = 0.32;
    grp.userData.lens = new THREE.Vector3(0, 0.085, 0.24);
    grp.userData.muzzle = new THREE.Vector3(0, 0.012, 0.9);
    return grp;
  }
  // the glass: a soft star that the haze does not eat (a specular flash goes through it)
  let glintTex = null;
  function glintTexture() {
    if (glintTex) return glintTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,250,235,.95)"); gr.addColorStop(0.3, "rgba(255,240,200,.35)"); gr.addColorStop(1, "rgba(255,230,180,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = "rgba(255,255,255,.75)"; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(4, 32); x.lineTo(60, 32); x.moveTo(32, 10); x.lineTo(32, 54); x.stroke();
    glintTex = new THREE.CanvasTexture(c); glintTex._shared = true;
    return glintTex;
  }
  function buildGlint() {
    const m = new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    m.toneMapped = false;
    const s = new THREE.Sprite(m);
    s.visible = false; s.renderOrder = 20;
    s.userData.transient = true;
    const A = arena(); if (A && A.root) A.root.add(s);
    return s;
  }
  // place a glint (or a muzzle flash) so it holds the same few pixels at any range
  const _gw = new THREE.Vector3();
  function showGlint(s, wx, wy, wz, k, size) {
    if (!s) return;
    if (!(k > 0.01)) { s.visible = false; return; }
    const cam = CBZ.camera; if (!cam) return;
    const d = Math.hypot(wx - cam.position.x, wy - cam.position.y, wz - cam.position.z);
    s.visible = true;
    s.position.set(wx, wy, wz);
    const w = Math.max(0.12, d * (size || 0.003));
    s.scale.set(w, w, 1);
    s.material.opacity = clamp(k, 0, 1);
  }
  // where a rifle rests for a man standing at a roof's rim, over the deck. (The
  // lot record's parapet is the masonry; a facade's balustrade stands on top
  // of it and is not in any record, so both of them are stood tall enough to
  // clear one.)
  const RIFLE_Y = 1.34;
  // the dummy: a hat on a stick behind a rifle and a lens
  function buildDecoy(pt, face, parapet) {
    const grp = group();
    grp.position.set(pt.x, pt.y, pt.z);
    grp.rotation.y = face;
    const body = new THREE.Group(); grp.add(body);
    box(body, 0.04, 1.5, 0.04, 0x3a2f22, 0, 0.75, -0.02);                         // the stick
    box(body, 0.46, 0.26, 0.2, 0x3b4034, 0, 1.36, -0.02);                          // a rolled coat for shoulders
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), mat(0x6b5a48)); head.position.set(0, 1.6, 0); body.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x2a2d26)); cap.position.set(0, 1.615, 0); body.add(cap);
    const rifle = buildRifle();
    if (rifle.parent) rifle.parent.remove(rifle);
    rifle.position.set(0.02, RIFLE_Y, 0.42);
    grp.add(rifle);
    grp.userData.body = body; grp.userData.rifle = rifle; grp.userData.head = head;
    return grp;
  }
  // his kit where he first lay up: a mat, a flask, the card
  function buildKit(pt, face) {
    const grp = group();
    grp.position.set(pt.x, pt.y, pt.z);
    grp.rotation.y = face;
    box(grp, 0.7, 0.02, 1.7, 0x343a2c, 0, 0.012, -0.7).castShadow = false;       // the mat
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 10), mat(0x4a5a52)); fl.position.set(0.42, 0.12, -0.2); grp.add(fl);
    box(grp, 0.17, 0.06, 0.26, 0x2b2e24, -0.44, 0.03, -0.3);                       // a box of rounds
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.21), new THREE.MeshLambertMaterial({ color: 0xe9e1cb }));
    card.rotation.x = -Math.PI / 2; card.rotation.z = 0.3; card.position.set(-0.2, 0.026, -0.62); grp.add(card);
    grp.userData.card = card;
    return grp;
  }
  function brass(M, x, y, z) {
    if (!M.kit) return;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), mat(0xb08a3a));
    const A = arena(); if (!A || !A.root) return;
    b.rotation.z = Math.PI / 2; b.rotation.y = Math.random() * 3;
    b.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.008, z + (Math.random() - 0.5) * 0.5);
    b.userData.transient = true;
    A.root.add(b); M.brass.push(b);
  }

  /* ---------------- HIM ------------------------------------------------------ */
  function spawn(x, y, z, seed) {
    const A = arena(); if (!A || !A.root || !CBZ.cityMakePed) return null;
    let s = (seed * 2654435761) >>> 0;
    const rng = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let p = null;
    try { p = CBZ.cityMakePed(x, z, rng, { name: "a man nobody has a name for", gender: "m", archetype: "resident", outfit: 0x3b4034, armed: false, weapon: null, aggr: 0.2, wealth: 0.5, allowVisibleSpawn: true }); } catch (e) { p = null; }
    if (!p) return null;
    A.root.add(p.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(p);
    p._campaignTarget = true; p._hitMark = true; p._hmJob = "duel";
    p._noAimTag = true;                  // sweeping a scope across the roofs must not light a name pill over him (city/aim_dossier.js)
    p.controlled = true;                 // this file is his brain; and a controlled body is drawn (and can be hit) at any range
    p.job = null; p.nameKnown = false;
    p.state = "idle"; p.pause = 1; p.path = null;
    if (p.group) { p.group.visible = true; p._spawnHidden = false; }
    place(p, x, y, z);
    return p;
  }
  function place(p, x, y, z) {
    p.pos.set(x, y, z);
    if (p.target && p.target.set) p.target.set(x, 0, z);
    // a roof is a floor the crowd's feet are told about (city/occupy.js)
    if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(p, y); } catch (e) {} }
    p.pos.y = y;
  }
  function removeNow(p) {
    if (!p) return;
    if (p.group && p.group.parent) p.group.parent.remove(p.group);
    const L = CBZ.cityPeds || []; const i = L.indexOf(p); if (i >= 0) L.splice(i, 1);
  }

  /* ---------------- make(): stage it ------------------------------------------ */
  let LIVE = null;
  function make(S) {
    const F = pickField(S);
    if (!F) return null;
    const L = liftRoofs();
    const nest = F.nest, hideLot = F.hide, decoyLot = F.decoy;
    S.nestKey = lotKey(nest); S.hideKey = lotKey(hideLot); S.decoyKey = lotKey(decoyLot); S.arcKeys = F.arc.map(lotKey);
    const np = rimPoint(nest, hideLot.cx, hideLot.cz, 0);
    // his corners: the one he lies up in, and those he moves between
    const hides = [];
    for (const s of [1.7, 8.2, -5.6, 5.1, -9, 11, -11]) {
      const q = rimPoint(hideLot, nest.cx, nest.cz, s);
      if (hides.some(function (h) { return Math.hypot(h.x - q.x, h.z - q.z) < 3.2; })) continue;
      if (sees(q, hideLot, np, nest, L)) hides.push(q);
      if (hides.length >= 3) break;
    }
    if (hides.length < 2) return null;
    const seed = ((CBZ.WORLD_SEED | 0) ^ (today() * 7919) ^ 0xd0e1) >>> 0;
    const ped = spawn(hides[0].x, hides[0].y, hides[0].z, seed);
    if (!ped) return null;
    const dp = rimPoint(decoyLot, nest.cx, nest.cz, (h01(seed, 3, 5) - 0.5) * 6);
    const dface = Math.atan2(nest.cx - dp.x, nest.cz - dp.z);
    const face0 = Math.atan2(nest.cx - hides[0].x, nest.cz - hides[0].z);
    const range = Math.round(Math.hypot(hides[0].x - np.x, hides[0].z - np.z) / 10) * 10;
    const M = {
      nest: nest, hideLot: hideLot, decoyLot: decoyLot, arc: F.arc, hides: hides, hi: 0, np: np, range: range,
      ped: ped, face: face0,
      rifle: buildRifle(), glint: buildGlint(), flash: buildGlint(), dGlint: buildGlint(),
      decoy: buildDecoy(dp, dface, decoyLot.building.parapetH || 0.7), decoyAt: dp, decoyDown: 0, decoyHit: false,
      kit: buildKit(hides[0], face0), brass: [],
      phase: "watch", t: 0, up: false, upT: 2 + h01(seed, 1, 1) * 3, know: 0, zero: null, seenAt: null, settle: 0, settleNeed: 1.8,
      shots: 0, hits: 0, queue: [], flashT: 0, sweepT: 2, sweepOn: 0, engaged: false, found: false, quietT: 0, dead: false,
      lastP: null, pv: { x: 0, z: 0 }, cache: {}, notes: [], savedRange: null,
    };
    M.flash.material.color.setHex(0xffd9a0);
    // the round has to get there: lift the rifle's reach while this job is live
    try {
      const W = CBZ.weaponById ? CBZ.weaponById("sniper") : null;
      if (W && isFinite(W.range)) { M.savedRange = W.range; M.weapon = W; W.range = Math.max(W.range, F.dMax + 160); }
    } catch (e) {}
    const job = {
      mark: ped, name: "An unidentified man", role: "", pay: PAY, weight: "someone", cause: "shot", alarm: false,
      kills: { civ: 0, guard: 0 },
      M: M,
      file: function () { return file(M); },
      board: function () { return board(M); },
      boardKey: function () { return "duel" + (M.decoyHit ? "d" : "") + (ped.dead ? "x" : ""); },
      tick: function (dt) { tick(job, M, dt); },
      frame: function (dt) { frame(job, M, dt); },
      pinAt: function () { return M.engaged || ped.dead ? null : { x: nest.building.door.x, z: nest.building.door.z, label: "a roof", key: "nest" }; },
      onDead: function (inc) {
        M.dead = true; M.phase = "dead"; M.quietT = 0; showGlint(M.glint, 0, 0, 0, 0); layRifle(M);
        // nobody saw a man die on a far roof: no police, no tape, until somebody has been up there
        M.incId = inc && inc.id ? inc.id : null;
        try { if (M.incId && CBZ.hmFallout && CBZ.hmFallout.holdScene) CBZ.hmFallout.holdScene(M.incId, 1e7); } catch (e) {}
      },
      place: function () { return "the roof of " + lotName(hideLot); },
      clear: function () { return !!M.found; },
      end: function (hard) { end(M, hard); },
    };
    hookShots(); hookCard();
    LIVE = job;
    return job;
  }
  function end(M, hard) {
    if (LIVE && LIVE.M === M) LIVE = null;
    try { if (M.weapon && M.savedRange != null) M.weapon.range = M.savedRange; } catch (e) {}
    killGroup(M.rifle); killGroup(M.decoy); killGroup(M.kit);
    for (const s of [M.glint, M.flash, M.dGlint]) { if (s) { if (s.parent) s.parent.remove(s); if (s.material) s.material.dispose(); } }
    for (let i = 0; i < M.brass.length; i++) { const b = M.brass[i]; if (b.parent) b.parent.remove(b); if (b.geometry) b.geometry.dispose(); }
    M.brass.length = 0;
    const p = M.ped;
    if (p) {
      p._hitMark = false; p._hmJob = null;
      if (!p.dead) { p.controlled = false; if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(p, 0); } catch (e) {} } removeNow(p); }
    }
  }

  /* ---------------- how much of you he can see --------------------------------
     three heights of your body (and your shoulders), each a clear line or
     not from his eye. Your own parapet, a lift headhouse, a wall: cover is
     whatever the line-of-fire test says it is. */
  const _eye = new THREE.Vector3(), _hd = new THREE.Vector3();
  function hisEye(M) {
    const ch = M.ped.char;
    if (ch && ch.head && ch.head.getWorldPosition) { ch.head.getWorldPosition(_eye); _eye.y += 0.06; return _eye; }
    return _eye.set(M.ped.pos.x, M.ped.pos.y + 1.05, M.ped.pos.z);
  }
  function yourTop() {
    const pl = P(), cam = CBZ.camera;
    let top = pl.pos.y + 1.68;
    // first person: the lens is your eye, so a crouch is as low as you really are
    if (cam && Math.hypot(cam.position.x - pl.pos.x, cam.position.z - pl.pos.z) < 0.6 && cam.position.y > pl.pos.y + 0.4 && cam.position.y < pl.pos.y + 2) top = cam.position.y + 0.1;
    else if (pl.crouch || pl.crouching || pl._crouch) top = pl.pos.y + 1.15;
    return top;
  }
  const EXPO = { frac: 0, headOnly: false, x: 0, y: 0, z: 0 };
  function exposure(M) {
    const pl = P(), e = hisEye(M);
    const top = yourTop(), h = top - pl.pos.y;
    const ux = e.x - pl.pos.x, uz = e.z - pl.pos.z, ul = Math.hypot(ux, uz) || 1;
    const sx = -uz / ul * 0.19, sz = ux / ul * 0.19;                 // across his line: your shoulders
    const pts = [[0, h - 0.07, 0], [sx, h * 0.8, sz], [-sx, h * 0.8, -sz], [0, h * 0.58, 0], [0, h * 0.3, 0]];
    let n = 0, hi = -1;
    for (let i = 0; i < pts.length; i++) {
      const x = pl.pos.x + pts[i][0], y = pl.pos.y + pts[i][1], z = pl.pos.z + pts[i][2];
      if (los(e.x, e.y, e.z, x, y, z)) { n++; if (hi < 0) { hi = i; EXPO.x = x; EXPO.y = y; EXPO.z = z; } }
    }
    EXPO.frac = n / pts.length;
    EXPO.headOnly = n > 0 && n <= 1 && hi === 0;
    // he aims at the middle of what shows
    if (n >= 3) { EXPO.x = pl.pos.x; EXPO.y = pl.pos.y + h * 0.72; EXPO.z = pl.pos.z; }
    return EXPO;
  }

  /* ---------------- YOUR shots ---------------------------------------------------
     one subscription for the file's life. The trigger tells him where you
     are; where the round went decides the rest (a near thing over his head,
     the dummy's hat). The round itself is the game's own projectile and it
     kills him or it does not. */
  let shotsHooked = false;
  const _ad = new THREE.Vector3(), _ap = new THREE.Vector3();
  function nearest(ox, oy, oz, d, px, py, pz) {
    // closest approach of your round to a point, with the fall of the round at that range taken off
    const vx = px - ox, vy = py - oy, vz = pz - oz;
    const t = Math.max(0, vx * d.x + vy * d.y + vz * d.z);
    const fall = dropAt(t);
    const cx = ox + d.x * t, cy = oy + d.y * t - fall, cz = oz + d.z * t;
    return { miss: Math.hypot(cx - px, cy - py, cz - pz), range: t };
  }
  function hookShots() {
    if (shotsHooked || !CBZ.onCityEvent) return;
    shotsHooked = true;
    CBZ.onCityEvent(function (type) {
      if (type !== "bullet-impact" || !LIVE) return;
      const M = LIVE.M, pl = P(), cam = CBZ.camera;
      if (!pl || !cam || M.dead) return;
      try { if (CBZ.playerAimDir) CBZ.playerAimDir(_ad); else cam.getWorldDirection(_ad); } catch (e) { cam.getWorldDirection(_ad); }
      _ap.copy(cam.position);
      const e = hisEye(M);
      const far = Math.hypot(e.x - pl.pos.x, e.z - pl.pos.z);
      if (far > M.range + 260) return;                                     // not a shot in this field
      const him = nearest(_ap.x, _ap.y, _ap.z, _ad, e.x, e.y - 0.1, e.z);
      const dk = M.decoy && !M.decoyHit ? nearest(_ap.x, _ap.y, _ap.z, _ad, M.decoyAt.x, M.decoyAt.y + 1.5, M.decoyAt.z) : null;
      const at = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
      M.queue.push({ t: tof(far), kind: "heard", at: at, near: him.miss < 3.2 && M.up });
      if (dk && dk.miss < 0.5) M.queue.push({ t: tof(dk.range), kind: "decoy" });
    });
  }

  /* ---------------- the director (5 Hz) ------------------------------------------- */
  function inField(M) {
    const pl = P(); if (!pl || !pl.pos) return false;
    const d = Math.hypot(pl.pos.x - M.ped.pos.x, pl.pos.z - M.ped.pos.z);
    return d < M.range + 180 && pl.pos.y > 7;
  }
  function tick(job, M, dt) {
    const pl = P(), ped = M.ped;
    if (!pl) return;
    if (M.dead || ped.dead) {
      // it goes quiet. Nothing else. He is found when you stand over him.
      M.quietT += dt;
      if (!M.found) {
        const d = Math.hypot(pl.pos.x - ped.pos.x, pl.pos.z - ped.pos.z), dk = Math.hypot(pl.pos.x - M.hides[0].x, pl.pos.z - M.hides[0].z);
        if ((d < 5 && Math.abs(pl.pos.y - ped.pos.y) < 2.5) || (dk < 4 && Math.abs(pl.pos.y - M.hides[0].y) < 2.5)) found(M);
      }
      return;
    }
    if (pl.dead) {
      // he got you. He is still on that roof when you can stand again: the
      // paper stays open, and he has forgotten nothing but where you are now.
      M.know = 0; M.zero = null; M.phase = "watch"; M.settle = 0; M.queue.length = 0; M.up = false; M.upT = 4; M.hits = 0;
      return;
    }
    const field = inField(M);
    if (field && !M.engaged) { M.engaged = true; M.notes.push("Up. He is out there somewhere in that arc."); }
    M.t += dt;

    // what he can see of you, when his head is up
    const ex = M.up && (field || M.zero) ? exposure(M) : null;
    const frac = ex ? ex.frac : 0;
    // your speed across his view
    if (M.lastP) { M.pv.x = (pl.pos.x - M.lastP.x) / dt; M.pv.z = (pl.pos.z - M.lastP.z) / dt; }
    M.lastP = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
    const spd = Math.hypot(M.pv.x, M.pv.z);

    if (M.phase === "watch") {
      // up to look, down to breathe: the only time he can be hit is while he can see
      M.upT -= dt;
      if (M.upT <= 0) { M.up = !M.up; M.upT = M.up ? 4.5 + Math.random() * 3.5 : 2.2 + Math.random() * 2.4; }
      if (frac > 0) {
        let rate = frac / 3.4;
        if (spd > 1.2) rate *= 1.7;                                    // movement is what an eye catches
        // the sun on YOUR glass, if you have it up and pointed his way
        if (glassOnHim(M) && sunUp()) { const e = hisEye(M); _hd.set(e.x - pl.pos.x, e.y - pl.pos.y, e.z - pl.pos.z).normalize(); if (sunDir().dot(_hd) > 0.1) rate *= 1.9; }
        // a spot he has already zeroed he watches
        if (M.zero && Math.hypot(pl.pos.x - M.zero.x, pl.pos.z - M.zero.z) < 2.6) rate *= 3;
        M.know = Math.min(1.2, M.know + rate * dt);
        M.seenAt = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
      } else M.know = Math.max(0, M.know - dt * 0.07);
      if (M.know >= 1 && frac > 0) {
        M.phase = "settle"; M.settle = 0; M.up = true;
        const zeroed = M.zero && Math.hypot(pl.pos.x - M.zero.x, pl.pos.z - M.zero.z) < 2.6;
        M.settleNeed = zeroed ? 0.55 : (M.shots ? 1.5 : 1.9);
        M.zeroedShot = !!zeroed;
      }
      return;
    }
    if (M.phase === "settle") {
      M.up = true;
      if (frac > 0) { M.settle += dt; M.hideT = 0; M.seenAt = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z }; }
      else {
        // you went behind something: he holds on the place you went in, for a while
        M.hideT = (M.hideT || 0) + dt;
        if (M.hideT > 4.5) { M.phase = "watch"; M.know = 0.75; M.upT = 3; M.settle = 0; }
        return;
      }
      if (M.settle >= M.settleNeed) fire(M, ex, spd);
      return;
    }
    if (M.phase === "fired") {
      // the follow-through, then he is gone from that corner
      if (M.t > 0.7) {
        M.up = false; M.phase = "move"; M.t = 0;
        let ni = M.hi;
        for (let k = 0; k < 6 && ni === M.hi; k++) ni = (Math.random() * M.hides.length) | 0;
        if (ni === M.hi) ni = (M.hi + 1) % M.hides.length;
        M.hi = ni;
      }
      return;
    }
    if (M.phase === "move") {
      const hpt = M.hides[M.hi];
      if (Math.hypot(ped.pos.x - hpt.x, ped.pos.z - hpt.z) < 0.5 || M.t > 16) {
        M.phase = "watch"; M.t = 0; M.up = false; M.upT = 1.2 + Math.random() * 2.2;
        M.know = Math.min(M.know, 0.72);
      }
      return;
    }
  }
  function found(M) {
    if (M.found) return;
    M.found = true;
    M.notes.push("Found him. One mat, one flask, a card with my roof on it.");
    // now the city can find him too (the police come once you have gone)
    try { if (M.incId && CBZ.hmFallout && CBZ.hmFallout.holdScene) CBZ.hmFallout.holdScene(M.incId, 0); } catch (e) {}
  }
  function glassOnHim(M) {
    let lens = false;
    try { lens = !!(CBZ.fpsScoped && CBZ.fpsScoped()) || !!(CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()); } catch (e) { lens = false; }
    if (!lens) return false;
    const cam = CBZ.camera, e = hisEye(M);
    cam.getWorldDirection(_hd);
    const dx = e.x - cam.position.x, dy = e.y - cam.position.y, dz = e.z - cam.position.z, d = Math.hypot(dx, dy, dz) || 1;
    return (dx * _hd.x + dy * _hd.y + dz * _hd.z) / d > 0.985;             // within ten degrees: the glass is toward him
  }

  /* ---------------- HIS shot --------------------------------------------------------- */
  const _mz = new THREE.Vector3();
  function muzzle(M) {
    const r = M.rifle;
    r.updateMatrixWorld(true);
    return _mz.copy(r.userData.muzzle).applyMatrix4(r.matrixWorld);
  }
  function gauss() { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) * 1.22; }
  function fire(M, ex, spd) {
    const pl = P(), mz = muzzle(M);
    const d = Math.hypot(ex.x - mz.x, ex.y - mz.y, ex.z - mz.z);
    const T = tof(d);
    // he leads a man who is walking; a man who stops or turns walks out of it
    const lead = spd > 0.8 ? 1 : 0;
    const ax = ex.x + M.pv.x * T * lead, az = ex.z + M.pv.z * T * lead;
    // a first round on a new spot goes a hand wide; a zeroed one does not
    const sig = (M.zeroedShot ? 0.09 : 0.36) * (d / 300) * (ex.frac < 0.45 ? 1.25 : 1);
    const ux = (ex.x - mz.x) / d, uz = (ex.z - mz.z) / d;
    const side = gauss() * sig, vert = gauss() * sig * 0.8;
    const aim = { x: ax - uz * side, y: ex.y + vert, z: az + ux * side };
    M.shots++;
    M.phase = "fired"; M.t = 0; M.flashT = 0.085;
    M.zero = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };                    // he has this place now
    M.know = 1;
    M.queue.push({ t: T, kind: "round", from: { x: mz.x, y: mz.y, z: mz.z }, aim: aim, headOnly: ex.headOnly });
    M.queue.push({ t: d / 343, kind: "report", d: d });
    if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(mz, { scale: 2.2 }); } catch (e) {} }
    brass(M, M.ped.pos.x, M.ped.pos.y, M.ped.pos.z);
    try { if (CBZ.shake && d < 60) CBZ.shake(0.1); } catch (e) {}
  }
  // the round gets there
  const _rc = new THREE.Raycaster(), _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _ip = new THREE.Vector3(), _in = new THREE.Vector3();
  function arrive(job, M, q) {
    const pl = P(); if (!pl || pl.dead) return;
    const f = q.from, a = q.aim;
    _ro.set(f.x, f.y, f.z); _rd.set(a.x - f.x, a.y - f.y, a.z - f.z);
    const d = _rd.length(); _rd.multiplyScalar(1 / d);
    // does the line it flew pass through you, now, where you are now
    const top = yourTop();
    const vx = pl.pos.x - f.x, vz = pl.pos.z - f.z;
    const t = clamp(vx * _rd.x + vz * _rd.z + (pl.pos.y + 1 - f.y) * _rd.y, 0, d + 4);
    const cx = f.x + _rd.x * t, cy = f.y + _rd.y * t, cz = f.z + _rd.z * t;
    const lateral = Math.hypot(cx - pl.pos.x, cz - pl.pos.z);
    const inBody = lateral < 0.27 && cy > pl.pos.y + 0.12 && cy < top + 0.04;
    if (inBody && los(f.x, f.y, f.z, cx, cy, cz)) {
      M.hits++;
      const head = cy > top - 0.3 || q.headOnly;
      try { if (CBZ.sfx) CBZ.sfx("headshot", { force: true, volume: 0.9 }); } catch (e) {}
      if (head || M.hits >= 2 || pl.hp <= (pl.maxHp || 200) * 0.5) {
        try { CBZ.cityKillPlayer("shot", { fromX: f.x, fromZ: f.z, dmg: 70, headshot: !!head }); } catch (e) {}
      } else {
        try { CBZ.cityHurtPlayer(230, f.x, f.z, "shot", false, null, false, { kind: "bullet", cal: 1.3, zone: "chest", point: { x: cx, y: cy, z: cz }, power: 1 }); } catch (e) {}
        if (pl.hp <= 1 && !pl.dead) { try { CBZ.cityKillPlayer("shot", { fromX: f.x, fromZ: f.z, dmg: 70 }); } catch (e) {} }
      }
      return;
    }
    // a miss: it goes on into the first solid thing on its line, from a little
    // before the place it was sent (your own parapet) to well behind it
    let hitPt = false, hitAt = Infinity;
    const s0 = Math.max(0, d - 30), s1 = d + 45;
    try {
      // the walls the sight test knows
      if (CBZ.losRaycast && CBZ.losBlockers) {
        _rc.set(_ro, _rd); _rc.near = s0; _rc.far = s1;
        const hits = CBZ.losRaycast(_rc, CBZ.losBlockers);
        if (hits && hits.length) {
          const h = hits[0];
          _ip.copy(h.point); hitAt = h.distance;
          if (h.face && h.face.normal) { _in.copy(h.face.normal); if (h.object && h.object.matrixWorld) _in.transformDirection(h.object.matrixWorld); } else _in.copy(_rd).negate();
          if (_in.dot(_rd) > 0) _in.negate();
          hitPt = true;
        }
      }
    } catch (e) { hitPt = false; hitAt = Infinity; }
    if (CBZ.segmentHitsCollider) {
      // and the solid things round you that it does not (a lift headhouse, a
      // tank, a rail), as the world's own banded colliders have them
      let best = Infinity, bn = null;
      const ax = f.x + _rd.x * s0, ay = f.y + _rd.y * s0, az = f.z + _rd.z * s0;
      const bx = f.x + _rd.x * s1, bz = f.z + _rd.z * s1;
      try {
        CBZ.segmentHitsCollider(ax, az, bx, bz, 0.05, function (c) {
          if (c.y0 == null || c.y1 == null || c.yaw != null || c.y0 > 1e8) return false;       // (banded, axis-aligned boxes only)
          let t0 = 0, t1 = s1 - s0, n = null;
          const o = [ax, ay, az], dv = [_rd.x, _rd.y, _rd.z], lo = [c.minX, c.y0, c.minZ], hi = [c.maxX, c.y1, c.maxZ];
          for (let k = 0; k < 3; k++) {
            if (Math.abs(dv[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
            let ta = (lo[k] - o[k]) / dv[k], tb = (hi[k] - o[k]) / dv[k], sg = -1;
            if (ta > tb) { const tt = ta; ta = tb; tb = tt; sg = 1; }
            if (ta > t0) { t0 = ta; n = [k === 0 ? sg * Math.sign(dv[k]) : 0, k === 1 ? sg * Math.sign(dv[k]) : 0, k === 2 ? sg * Math.sign(dv[k]) : 0]; }
            if (tb < t1) t1 = tb;
            if (t0 > t1) return false;
          }
          if (n && t0 < best) { best = t0; bn = n; }
          return false;
        });
      } catch (e) { best = Infinity; }
      if (bn && s0 + best < hitAt) {
        _ip.set(ax + _rd.x * best, ay + _rd.y * best, az + _rd.z * best);
        _in.set(bn[0], bn[1], bn[2]); if (_in.dot(_rd) > 0) _in.negate();
        hitPt = true; hitAt = s0 + best;
      }
    }
    if (!hitPt) {
      // open air behind you: the deck it comes down on
      for (let s = d - 2; s < d + 60 && !hitPt; s += 1.5) {
        const x = f.x + _rd.x * s, y = f.y + _rd.y * s, z = f.z + _rd.z * s;
        const gy = groundY(x, z, y + 0.5);
        if (y <= gy + 0.05) { _ip.set(x, gy + 0.02, z); _in.set(0, 1, 0); hitPt = true; }
      }
    }
    const near = Math.hypot(cx - pl.pos.x, cy - (pl.pos.y + 1.4), cz - pl.pos.z);
    if (hitPt) {
      try { if (CBZ.bulletImpact) CBZ.bulletImpact(_ip, _in, { kind: "chip", power: 1.5, surface: "concrete" }); } catch (e) {}
      try { if (CBZ.bulletHole) CBZ.bulletHole(_ip, _in, { mm: 7.62 }); } catch (e) {}
      const di = Math.hypot(_ip.x - pl.pos.x, _ip.y - (pl.pos.y + 1.4), _ip.z - pl.pos.z);
      try { if (CBZ.sfx && di < 40) CBZ.sfx("ricochet", { dist: di, force: true, ghost: true, volume: 1 }); } catch (e) {}
    }
    // the crack of it going past your head
    try { if (CBZ.sfx && near < 6) CBZ.sfx("bullet_snap", { force: true, ghost: true, volume: clamp(1.2 - near * 0.15, 0.35, 1.1) }); } catch (e) {}
    try { if (CBZ.shake && near < 2.5) CBZ.shake(0.28); } catch (e) {}
  }
  function heard(M, q) {
    // your shot: he has your place. If it went close while he was up, he is off that corner at once.
    M.zero = q.at; M.know = Math.max(M.know, 1);
    if (M.dead) return;
    if (q.near && (M.phase === "watch" || M.phase === "settle")) {
      M.up = false; M.phase = "move"; M.t = 0;
      M.hi = (M.hi + 1 + ((Math.random() * (M.hides.length - 1)) | 0)) % M.hides.length;
      M.notes.push("Close. He is off that corner.");
    } else if (M.phase === "watch") { M.up = true; M.upT = 5; }
  }

  /* ---------------- motion, the rifle, the glass (every frame) ----------------------- */
  function layRifle(M) {
    const r = M.rifle; if (!r) return;
    const p = M.ped;
    r.visible = true;
    r.position.set(p.pos.x + Math.sin(M.face) * 0.5, M.hides[M.hi].y + 0.05, p.pos.z + Math.cos(M.face) * 0.5);
    r.rotation.order = "YXZ";
    r.rotation.set(0, M.face + 0.7, Math.PI / 2);
  }
  const _lp = new THREE.Vector3();
  function frame(job, M, dt) {
    const pl = P(), ped = M.ped, cam = CBZ.camera;
    if (!pl || !cam) return;
    // rounds and sounds in the air (his and yours)
    for (let i = M.queue.length - 1; i >= 0; i--) {
      const q = M.queue[i];
      q.t -= dt;
      if (q.t > 0) continue;
      M.queue.splice(i, 1);
      if (q.kind === "round") arrive(job, M, q);
      else if (q.kind === "report") { try { if (CBZ.sfx) CBZ.sfx("shoot_sniper", { dist: q.d, force: true, ghost: true, volume: 0.95 }); } catch (e) {} }
      else if (q.kind === "heard") heard(M, q);
      else if (q.kind === "decoy" && !M.decoyHit) { M.decoyHit = true; M.notes.push("That one was a hat on a stick."); }
    }
    // the dummy goes over when it is hit
    if (M.decoy) {
      if (M.decoyHit && M.decoyDown < 1) { M.decoyDown = Math.min(1, M.decoyDown + dt * 2.6); M.decoy.userData.body.rotation.x = -M.decoyDown * 1.35; }
      // its glass: steady while the sun is on it, a slow shimmer, never a movement
      let k = 0;
      if (!M.decoyHit && sunUp()) {
        _lp.copy(M.decoy.userData.rifle.userData.lens); M.decoy.userData.rifle.updateMatrixWorld(true); _lp.applyMatrix4(M.decoy.userData.rifle.matrixWorld);
        _hd.set(cam.position.x - _lp.x, cam.position.y - _lp.y, cam.position.z - _lp.z).normalize();
        k = sstep(0.03, 0.26, sunDir().dot(_hd)) * (0.55 + 0.25 * Math.sin((CBZ.now || 0) * 0.0011));
        // only from in front of it, and not through a wall
        const fwd = Math.sin(M.decoy.rotation.y) * _hd.x + Math.cos(M.decoy.rotation.y) * _hd.z;
        if (fwd < 0.75) k = 0;
        showGlint(M.dGlint, _lp.x, _lp.y, _lp.z, k);
      } else showGlint(M.dGlint, 0, 0, 0, 0);
    }
    if (M.dead || ped.dead) { showGlint(M.glint, 0, 0, 0, 0); showGlint(M.flash, 0, 0, 0, 0); return; }

    // HIM: kneeling at his corner (up) or folded behind the rim (down), or moving along it
    const hpt = M.hides[M.hi];
    const at = M.seenAt || M.zero || { x: M.np.x, y: M.np.y, z: M.np.z };
    const want = Math.atan2(at.x - ped.pos.x, at.z - ped.pos.z);
    M.face += wrapPi(want - M.face) * Math.min(1, dt * 3);
    if (ped.char) ped.char.crouch = !M.up || M.phase === "move";
    if (M.phase === "move") {
      ped.moveOrder = { x: hpt.x, z: hpt.z, speed: 1.9, stop: 0.25, leg: false, t: CBZ.now || 0 };
    } else {
      ped.path = null; ped.state = "idle"; ped.speed = 0;
      if (Math.hypot(ped.pos.x - hpt.x, ped.pos.z - hpt.z) > 0.4) ped.moveOrder = { x: hpt.x, z: hpt.z, speed: 1.4, stop: 0.2, leg: false, t: CBZ.now || 0 };
      else {
        ped.moveOrder = null;
        if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
        if (ped.group) ped.group.rotation.y += wrapPi(M.face - ped.group.rotation.y) * Math.min(1, dt * 6);
      }
    }
    // down: he is under the rim (the rig drops, the head with it)
    M.duck = (M.duck || 0) + ((M.up ? 0 : 1) - (M.duck || 0)) * Math.min(1, dt * 5);
    if (ped.char && ped.char.model) ped.char.model.position.y = -0.5 * M.duck;
    ped.pos.y = hpt.y;

    // the rifle: at his shoulder over the rim, on you; down with him when he is down
    const r = M.rifle;
    const ry = hpt.y + RIFLE_Y - 0.95 * M.duck;
    r.visible = true;
    const fx = Math.sin(M.face), fz = Math.cos(M.face);
    r.position.set(ped.pos.x + fx * 0.46 - fz * 0.07, ry, ped.pos.z + fz * 0.46 + fx * 0.07);
    const dx = at.x - r.position.x, dz = at.z - r.position.z, dy = (at.y + 1.3) - r.position.y;
    r.rotation.order = "YXZ";
    r.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)) + M.duck * 0.9, M.face, 0);
    if (M.phase === "fired" && M.t < 0.12) r.position.y += 0.03;
    r.updateMatrixWorld(true);
    // his hands on it, when the rig can reach
    if (ped.char && CBZ.charArmTo && M.duck < 0.5) {
      try {
        _lp.set(0, -0.02, -0.12).applyMatrix4(r.matrixWorld); CBZ.charArmTo(ped.char, _lp, "r", 1);
        _lp.set(0, -0.02, 0.26).applyMatrix4(r.matrixWorld); CBZ.charArmTo(ped.char, _lp, "l", 1);
      } catch (e) {}
    }

    // HIS GLASS: on you while he settles; a flick as his look crosses you while he watches
    let gk = 0;
    if (M.up && M.duck < 0.3 && sunUp()) {
      r.updateMatrixWorld(true);
      _lp.copy(r.userData.lens).applyMatrix4(r.matrixWorld);
      _hd.set(cam.position.x - _lp.x, cam.position.y - _lp.y, cam.position.z - _lp.z).normalize();
      const sunK = sstep(0.03, 0.26, sunDir().dot(_hd));
      if (sunK > 0) {
        if (M.phase === "settle") gk = sunK * (0.75 + 0.25 * Math.sin((CBZ.now || 0) * 0.02));
        else if (M.phase === "watch" && M.know > 0.25) {
          M.sweepT -= dt;
          if (M.sweepT <= 0) { M.sweepT = 2.4 + Math.random() * 4.2; M.sweepOn = 0.16 + Math.random() * 0.14; }
          if (M.sweepOn > 0) { M.sweepOn -= dt; gk = sunK * 0.85; }
        }
        // (the lens is behind a wall from where you stand: no flash through masonry)
        if (gk > 0 && !los(cam.position.x, cam.position.y, cam.position.z, _lp.x, _lp.y, _lp.z)) gk = 0;
      }
      showGlint(M.glint, _lp.x, _lp.y, _lp.z, gk);
    } else showGlint(M.glint, 0, 0, 0, 0);
    // the flash of his shot
    if (M.flashT > 0) {
      M.flashT -= dt;
      const mz = muzzle(M);
      showGlint(M.flash, mz.x, mz.y, mz.z, 1, 0.0042);
    } else showGlint(M.flash, 0, 0, 0, 0);
  }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  /* ---------------- THE CARD HE DREW -------------------------------------------------- */
  let cardHooked = false;
  const cardTok = { x: 0, y: 0, z: 0 };
  function hookCard() {
    const V = CBZ.hmVerbs;
    if (cardHooked || !V || !V.add) return;
    cardHooked = true;
    V.add({
      id: "duel-card", prio: 22,
      find: function (px, pz, P0) {
        if (!LIVE) return null;
        const M = LIVE.M, k = M.hides[0];
        if (!M.kit || !P0 || !P0.pos || Math.abs(P0.pos.y - k.y) > 1.6 || Math.hypot(px - k.x, pz - k.z) > 2.2) return null;
        cardTok.x = k.x; cardTok.y = k.y + 0.05; cardTok.z = k.z;
        return cardTok;
      },
      verb: "Look",
      onUse: function () {
        if (!LIVE) return;
        const M = LIVE.M, K = CBZ.hmPaper, H = CBZ.hmHold;
        if (!K || !H || !H.open) return;
        if (M.ped.dead) found(M);
        let c = null;
        try {
          const nb = M.nest.building;
          c = K.map({ places: [{ x: nb.ox, z: nb.oz, label: "him" }, { x: M.hides[0].x, z: M.hides[0].z, label: "me" }], title: M.range + " m" }, {});
        } catch (e) { c = null; }
        if (c) H.open(c, { kind: "paper" });
      },
    });
  }

  /* ---------------- PAPER ---------------------------------------------------------------- */
  function sunLine(M) {
    if (!sunUp()) return "After dark there is no glass to see. Only the flash.";
    const d = Math.hypot(M.hides[0].x - M.np.x, M.hides[0].z - M.np.z) || 1;
    const s = sunDir();
    const k = (s.x * (M.np.x - M.hides[0].x) + s.z * (M.np.z - M.hides[0].z)) / d;
    if (k > 0.08) return "The sun is behind you up there. His glass will show. Yours will not.";
    if (k < -0.08) return "The sun is in your face up there. Your glass shows before his does.";
    return "The sun is across you both. Nobody's glass shows for long.";
  }
  function file(M) {
    const names = M.arc.map(lotName);
    const fall = Math.round(dropAt(M.range) * 10) / 10;
    const notes = ["Shoot. Move.", "One of them is not a man."].concat(M.notes.slice(-5));
    return {
      codename: "THE OTHER RIFLE", opLabel: "", classification: "PRIVATE", header: "THE OTHER RIFLE",
      status: M.found ? "DONE" : "OPEN",
      subject: { name: "No name", role: "Brought in to find whoever has been doing this work.", photo: "", note: "Nobody has seen his face and kept theirs." },
      identified: M.found ? true : false,
      brief: [
        "He has been on a roof for two days, waiting for a man with a rifle to come up onto another one. That is you.",
        "He fires once and moves along his roof before he looks again. He remembers exactly where your last shot came from.",
        "He keeps a second position dressed to look like the first. It does not move.",
        sunLine(M),
      ],
      facts: [
        { k: "RANGE", v: "About " + M.range + " meters. At that range the round falls " + fall + " m and takes " + (Math.round(tof(M.range) * 10) / 10) + " s. Put the hair on his hat to hit his chest." },
        { k: "HIS ROOF", v: "One of: " + names.join(", ") + "." },
        { k: "A ROOF FOR YOU", v: "The roof of " + lotName(M.nest) + ", by the lift. Stay behind the parapet." },
        { k: "FEE", v: "$" + PAY.toLocaleString("en-US") + ", when I know it is done." },
      ],
      routine: [
        { label: "He looks", detail: "Head and rifle over the rim for a few seconds. Then down.", seen: true, now: false },
        { label: "He shoots", detail: "The round gets there before the sound does.", seen: true, now: false },
        { label: "He moves", detail: "Another corner of the same roof. Every time.", seen: true, now: false },
      ],
      security: [{ label: "Himself", detail: "One hit is most of you. Two is all of you.", seen: true }],
      approaches: [], kit: [],
      notes: notes,
      map: { places: [{ x: M.nest.building.ox, z: M.nest.building.oz, label: "you" }].concat(M.arc.map(function (l) { return { x: l.building.ox, z: l.building.oz, label: "?" }; })) },
      stamp: M.found ? "PAID" : null,
      footer: "Nico",
    };
  }
  function cached(M, id, key, makeIt) {
    const c = M.cache[id];
    if (c && c.key === key) return c.canvas;
    let cv = null; try { cv = makeIt(); } catch (e) { cv = null; }
    M.cache[id] = { key: key, canvas: cv };
    return cv;
  }
  function board(M) {
    const K = CBZ.hmPaper, R = CBZ.hmRoom;
    if (!K || !R) return null;
    const redraw = { onRedraw: function () { if (R.board && R.board.refresh) R.board.refresh(); } };
    const items = [];
    const pol = cached(M, "pol", "p" + (M.ped.dead ? "x" : ""), function () { return K.polaroid({ photo: null, caption: "?", crossed: !!M.ped.dead && M.found }, redraw); });
    if (pol) items.push({ id: "live", canvas: pol, w: 0.24, h: 0.288, x: -0.62, y: 0.05, rot: -0.04, pin: "red", links: ["map"] });
    const places = [{ x: M.nest.building.ox, z: M.nest.building.oz, label: "me" }].concat(M.arc.map(function (l) { return { x: l.building.ox, z: l.building.oz, label: "?" }; }));
    const map = cached(M, "map", "m", function () { return K.map({ places: places }, {}); });
    if (map) items.push({ id: "map", canvas: map, w: 0.44, h: 0.44, x: -0.08, y: -0.04, rot: 0.02, pin: "red" });
    const cards = [
      ["About " + M.range + " m", "Aim at the hat. It falls."],
      ["He shoots once", "then he moves"],
      ["Shoot. Move.", "He keeps the place"],
    ];
    for (let i = 0; i < cards.length; i++) {
      const lines = cards[i];
      const cv = cached(M, "card" + i, lines.join("|"), function () { return K.note({ lines: lines, hand: true, tone: i === 2 ? "yellow" : "index", redTitle: i === 2 }, {}); });
      if (cv) items.push({ id: "card" + i, canvas: cv, w: 0.24, h: 0.156, x: 0.55, y: 0.24 - i * 0.2, rot: ((i * 53) % 5 - 2) * 0.02, pin: "red", links: i < 2 ? ["map"] : ["live"] });
    }
    return items;
  }

  // can the city supply it (a nest and an arc that sees it)? The pipe asks five
  // times a second while he is home: the search is run at most every 20 s.
  let stageOk = false, stageAt = -1e9;
  function canStage() {
    const t = (CBZ.now || 0);
    if (t - stageAt > 20000 || t < stageAt) { stageAt = t; try { stageOk = !!pickField(null); } catch (e) { stageOk = false; } }
    return stageOk;
  }

  /* ---------------- register ---------------------------------------------------------------- */
  CBZ.hitmanJobs.add({
    id: "duel", order: 60, from: "Nico",
    call: [
      { by: "phone", line: "Nico. Sit down for this one." },
      { by: "phone", line: "Somebody paid for a rifle to come to town. He is on a roof, waiting for the man who does my work." },
      { by: "phone", line: "He put a round through a courier of mine from three blocks. Through a window." },
      { by: "phone", line: "I don't know which roof. The paper has the ones it could be. Go and take him off it." },
      { by: "phone", line: "Don't stand where you can be seen. And don't shoot twice from one place." },
    ],
    when: function () { return canStage(); },
    make: make,
  });

  // probes and tools
  CBZ.hmDuel = {
    live: function () { return LIVE; },
    field: function () { return pickField(null); },
    exposure: function () { return LIVE ? Object.assign({}, exposure(LIVE.M)) : null; },
    audit: function () {
      if (!LIVE) return null;
      const M = LIVE.M, p = M.ped, pl = P();
      return {
        phase: M.phase, up: M.up, know: +M.know.toFixed(2), settle: +M.settle.toFixed(2), need: M.settleNeed, shots: M.shots, hits: M.hits, hi: M.hi, hides: M.hides.length,
        range: M.range, nest: lotName(M.nest), hide: lotName(M.hideLot), decoy: lotName(M.decoyLot), arc: M.arc.map(lotName), decoyHit: M.decoyHit,
        zero: M.zero ? [Math.round(M.zero.x), Math.round(M.zero.z)] : null, engaged: M.engaged, found: M.found, dead: !!p.dead, queue: M.queue.length,
        him: [+p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1)], hp: p.hp,
        toPlayer: pl ? Math.round(Math.hypot(p.pos.x - pl.pos.x, p.pos.y - pl.pos.y, p.pos.z - pl.pos.z)) : null,
        gunRange: M.weapon ? M.weapon.range : null, sun: sunLine(M),
      };
    },
  };
})();
