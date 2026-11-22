/* ============================================================
   city/hitman_m_sawyou.js — AUTHORED JOB: "REISS". He saw you.

   OWNER: "You point the sniper at someone and they look directly at you,
   and then signal a hand across the throat like they are going to slit your
   throat, and then they start sprinting toward your building and come up
   the elevator or stairs and try to kill you, and then say 'you should have
   taken the shot'. Make it scary as hell and hard to decide, and any
   hesitation you can get killed."

   Registered with CBZ.hitmanJobs (city/hitman.js): the burner rings, Nico
   talks, an envelope comes under the door, the folder opens in your hands,
   the cork is pinned. Nothing in this file draws a panel or names a goal.

   THE JOB AS IT IS WRITTEN ON THE PAPER
     Anton Reiss sells what ten years behind a rifle taught him. He meets a
     buyer on the pavement outside a real door; the buyer brings the money
     in a grey case. The client wants the sale to HAPPEN first: "the man
     holding the case when it is over is Reiss". They dress alike on
     purpose. The position is a real roof (ringed on the atlas page) you
     travel to: the lift in the lobby, or the stair.
   WHY YOU HESITATE
     Two men in the same coat. Until the case changes hands the paper says
     do not shoot, and the case is how you tell them apart. The one thing
     that shows you the handoff is glass, and glass is what he can feel.
   WHAT HAPPENS
     MEET     they stand and talk. The longer your scope (or the binoculars)
              sits on him, the nearer the moment; you cannot time it.
     LOOK     he stops, turns, and looks straight up your lens. A beat.
     GESTURE  his hand comes up and goes slowly across his throat.
              (All of this he does standing still. That was the shot.)
     RUN      flat out through the streets at your building, corner to
              corner on whichever pavements the buildings hide from your
              roof: straight where nothing stands in the way, round a
              building by the city's own router, over a park rail.
     INSIDE   the street door, the lobby, then the lift (the same machine
              you rode: you hear it start over your head, and the floor
              chime; city/elevators.js CBZ.cityLiftSend) or the stair (the
              building's own core, asked to come out on the roof: boots,
              nearer each flight). You are not told which.
     ROOF     he comes out of that door at a sprint with a blade. Two cuts.
              The last thing said to you is "You should have taken the shot."
     If you wait it out with the scope down, the case does change hands, and
     Reiss walks; you get one clean look at his back.
   WHAT PAYS
     the pipe (city/hitman.js) pays through the dead drop. Before the
     handoff the fee is short; once he has run at you the street knows
     (alarm), so the fallout is the mess it was.

   Places come from the world's own records (arena lots, the building's
   lift and stair core); nothing here is a coordinate.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game || !CBZ.hitmanJobs || !CBZ.hitmanJobs.add) return;
  const g = CBZ.game;

  const NAME = "Anton Reiss";
  const PAY = 7000, PAY_EARLY = 4000;
  const LINE = "You should have taken the shot.";

  /* ---------------- small reads ---------------------------------------- */
  function P() { return CBZ.player || null; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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
  function builtLots(parks) {
    const A = arena(); if (!A) return [];
    const out = [];
    const pools = [A.lots || [], A.shopLots || []];
    for (let q = 0; q < pools.length; q++) for (let i = 0; i < pools[q].length; i++) {
      const l = pools[q][i];
      if (!l || !l.building || l.demolished || !isFinite(l.cx) || out.indexOf(l) >= 0) continue;
      if (!(l.building.group && !l.building.deferred) && !(parks && l.kind === "park")) continue;
      out.push(l);
    }
    return out;
  }
  function lotByKey(k) { const L = builtLots(true); for (let i = 0; i < L.length; i++) if (lotKey(L[i]) === k) return L[i]; return null; }
  function outward(l) {
    const d = l.building.door;
    let ox = d.x - l.cx, oz = d.z - l.cz;
    const m = Math.hypot(ox, oz);
    if (m < 0.01) return { x: 0, z: 1 };
    return { x: ox / m, z: oz / m };
  }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  /* ---------------- THE PLACES -------------------------------------------
     the roof: a mid-rise with a lift (every roof in the city is reached by
     its lift) whose deck sees a public door 100 to 190 m off. the meet: the
     pavement in front of that door. Scored, then one of the best picked by
     the day, and the pick is written in the job's ledger row so a reload
     stands the same two men in front of the same door. */
  const NO_ROOF = { cityhall: 1, courthouse: 1, federal: 1, dmv: 1, hospital: 1, bank: 1, security: 1, transit: 1, postoffice: 1, airfield: 1 };
  const MEET_KINDS = { park: 1, food: 1, bar: 1, club: 1, casino: 1, clothing: 1, pawn: 1, jewelry: 1, eyewear: 1, electronics: 1, barber: 1, gym: 1, transit: 1, realtor: 1, postoffice: 1, hardware: 1, bank: 1, drugs: 1 };
  function roofEyes(l) {
    const b = l.building, hw = b.w / 2 - 1.3, hd = b.d / 2 - 1.3, y = b.h + 1.55;
    const all = [
      { x: b.ox - hw, y: y, z: b.oz }, { x: b.ox + hw, y: y, z: b.oz }, { x: b.ox, y: y, z: b.oz - hd }, { x: b.ox, y: y, z: b.oz + hd },
      { x: b.ox - hw, y: y, z: b.oz - hd }, { x: b.ox + hw, y: y, z: b.oz - hd }, { x: b.ox - hw, y: y, z: b.oz + hd }, { x: b.ox + hw, y: y, z: b.oz + hd },
    ];
    // not a place to lie up: inside the lift's headhouse, or on top of the stair
    const lr = b.lift && b.lift.roof, sp = b.stairPlan && b.stairPlan.hole;
    return all.filter(function (e) {
      if (lr && Math.hypot(e.x - lr.x, e.z - lr.z) < 3.6) return false;
      if (sp && e.x > b.ox + sp.x0 - 1.2 && e.x < b.ox + sp.x1 + 1.2 && e.z > b.oz + sp.z0 - 1.2 && e.z < b.oz + sp.z1 + 1.2) return false;
      return true;
    });
  }
  function meetAt(l) {
    // a park: the open ground in the middle of it (no wall, seen from anywhere)
    if (l.kind === "park" || !l.building.group) {
      const d = l.building.door || { x: l.cx, z: l.cz };
      return { x: d.x, z: d.z, ox: 0, oz: 0, open: true, cx: l.cx, cz: l.cz };
    }
    const o = outward(l), d = l.building.door;
    // (a mainland door record is 1.6 m inside its wall: 4.4 m out along the
    // door's own line is the kerb side of the pavement, clear of the awning)
    return { x: d.x + o.x * 4.4, z: d.z + o.z * 4.4, ox: o.x, oz: o.z, open: false };
  }
  function roomLot() { try { const r = CBZ.hmRoom && CBZ.hmRoom.ensure ? CBZ.hmRoom.ensure() : null; return r ? r.lot : null; } catch (e) { return null; } }
  let FORCE = null;                                            // (tools: stage on this roof lot)
  function pickPlaces(S) {
    const L = builtLots(true);
    if (S && S.roofKey && S.meetKey) {
      const rl = lotByKey(S.roofKey), ml = lotByKey(S.meetKey);
      if (rl && ml && rl.building.lift) { const pl = pairOf(rl, ml); if (pl) return pl; }
    }
    const home = roomLot();
    const cands = [];
    for (let i = 0; i < L.length; i++) {
      const rl = L[i], b = rl.building;
      if (!b.group || !b.lift || rl === home || rl.kind === "player" || rl.kind === "abandoned" || rl.kind === "park") continue;
      if (NO_ROOF[rl.kind] || b.roofCrown) continue;         // not a civic roof (a dome on it, a detail in the lobby)
      if (b._interiorResidents) continue;                    // a lived-in ground floor: party walls and locked flats between the street door and the lift
      if (!(b.h >= 15 && b.h <= 42) || !b.roofSlab) continue;
      for (let j = 0; j < L.length; j++) {
        const ml = L[j];
        if (ml === rl || ml === home || !MEET_KINDS[ml.kind] || (!ml.building.door && ml.kind !== "park")) continue;
        const dd = d2(rl.cx, rl.cz, ml.cx, ml.cz);
        if (dd < 90 || dd > 165) continue;
        const pl = pairOf(rl, ml);
        if (!pl) continue;
        // a front you look AT, not along (edge-on he stands behind every lamp
        // post on the pavement); nearer 150 m; a taller roof a little
        if (!pl.meet.open && pl.facing < 0.3) continue;
        if (pl.dist > 148) continue;                          // (a watched rig is drawn to about 150 m: he must be seen leaving)
        pl.score = 1 - Math.abs(pl.dist - 125) / 90 + Math.min(0.3, b.h / 100) + (pl.meet.open ? 0.75 : pl.facing * 0.8);
        cands.push(pl);
      }
    }
    if (!cands.length) return null;
    cands.sort(function (a, b) { return b.score - a.score; });
    if (S && S.all) return cands;                              // (tools: every pairing the city offers)
    if (FORCE) { for (let i = 0; i < cands.length; i++) if (lotKey(cands[i].roofLot) === FORCE) return cands[i]; }
    const top = cands.slice(0, Math.min(5, cands.length));
    return top[Math.min(top.length - 1, (h01(today(), CBZ.WORLD_SEED | 0, 0x5a7) * top.length) | 0)];
  }
  /* THE SIGHT LINE CLEARS EVERY ROOF UNDER IT, WITH ROOM. The line-of-fire
     test knows walls and slabs; it does not know what a facade dress stood on
     top of a building (a pitched roof, a mansard, a dome), and a line that
     skims a wall top by a hand looks through one of those. From the lot
     records: over every other building's footprint the line must be 3.4 m
     above its deck. */
  function clearOver(e, x, y, z, skip) {
    const L = builtLots(false);
    const dx = x - e.x, dz = z - e.z;
    for (let i = 0; i < L.length; i++) {
      const l = L[i]; if (l === skip) continue;
      const b = l.building;
      const x0 = b.ox - b.w / 2 - 0.6, x1 = b.ox + b.w / 2 + 0.6, z0 = b.oz - b.d / 2 - 0.6, z1 = b.oz + b.d / 2 + 0.6;
      let t0 = 0, t1 = 1;
      // Liang-Barsky: the part of the segment over this footprint
      const pq = [[-dx, e.x - x0], [dx, x1 - e.x], [-dz, e.z - z0], [dz, z1 - e.z]];
      let hit = true;
      for (let k = 0; k < 4 && hit; k++) {
        const pp = pq[k][0], qq = pq[k][1];
        if (Math.abs(pp) < 1e-9) { if (qq < 0) hit = false; continue; }
        const r = qq / pp;
        if (pp < 0) { if (r > t1) hit = false; else if (r > t0) t0 = r; }
        else { if (r < t0) hit = false; else if (r < t1) t1 = r; }
      }
      if (!hit || t1 <= t0) continue;
      const low = Math.min(e.y + (y - e.y) * t0, e.y + (y - e.y) * t1);
      if (low < (b.h || 0) + 3.4) return false;
    }
    return true;
  }
  // is there room for a man to stand here (nothing solid within his body)?
  const _probe = { x: 0, y: 0, z: 0 };
  function standable(x, z) {
    if (!CBZ.collide) return true;
    const gy = groundY(x, z);
    if (Math.abs(gy) > 1.2) return false;                    // on top of something
    _probe.x = x; _probe.y = gy; _probe.z = z;
    try { CBZ.collide(_probe, 0.42, gy + 0.3, gy + 1.7); } catch (e) { return true; }
    return Math.hypot(_probe.x - x, _probe.z - z) < 0.02;
  }
  function pairOf(rl, ml) {
    const m = meetAt(ml), E = roofEyes(rl);
    if (m.open) {
      // out of the fountain: the first clear patch on the roof's side of the park
      const dx = rl.cx - m.cx, dz = rl.cz - m.cz, dl = Math.hypot(dx, dz) || 1;
      let ok = false;
      for (let k = 0; k < 6 && !ok; k++) {
        const r = 5.5 + k * 1.3, a = (k % 2 ? 1 : -1) * (0.35 + 0.12 * k);
        const ux = (dx / dl) * Math.cos(a) - (dz / dl) * Math.sin(a), uz = (dx / dl) * Math.sin(a) + (dz / dl) * Math.cos(a);
        const x = m.cx + ux * r, z = m.cz + uz * r;
        if (standable(x, z) && standable(x + 0.7, z) && standable(x - 0.7, z) && standable(x, z + 0.7) && standable(x, z - 0.7)) { m.x = x; m.z = z; ok = true; }
      }
      if (!ok) return null;
    }
    let best = null, n = 0;
    for (let k = 0; k < E.length; k++) {
      const e = E[k];
      if (!los(e.x, e.y, e.z, m.x, groundY(m.x, m.z) + 1.4, m.z)) continue;
      if (!clearOver(e, m.x, groundY(m.x, m.z) + 0.6, m.z, rl)) continue;
      n++;
      const dd = Math.hypot(e.x - m.x, e.z - m.z);
      if (!best || dd < best.d) best = { e: e, d: dd };
    }
    if (!best) return null;
    const e = best.e;
    // both of them, a stride either side of the spot, must be in the open to that eye
    const ux = (e.x - m.x) / best.d, uz = (e.z - m.z) / best.d;
    const tx = -uz, tz = ux;                                   // across your line of sight: you see them side by side
    for (let sg = -1; sg <= 1; sg += 2) {
      const sx = m.x + tx * 0.62 * sg, sz = m.z + tz * 0.62 * sg, gy = groundY(sx, sz);
      if (!los(e.x, e.y, e.z, sx, gy + 0.9, sz) || !los(e.x, e.y, e.z, sx, gy + 1.6, sz)) return null;
    }
    return { roofLot: rl, meetLot: ml, eye: e, meet: m, dist: best.d, eyes: n, tx: tx, tz: tz, facing: m.open ? 1 : (m.ox * ux + m.oz * uz) };
  }

  /* ---------------- THE PEOPLE ------------------------------------------- */
  function spawn(name, x, z, seed, opts) {
    const A = arena(); if (!A || !A.root || !CBZ.cityMakePed) return null;
    let s = (seed * 2654435761) >>> 0;
    const rng = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let p = null;
    try {
      p = CBZ.cityMakePed(x, z, rng, Object.assign({ name: name, gender: "m", archetype: "resident", armed: false, weapon: null, aggr: 0.2, wealth: 0.6, allowVisibleSpawn: true }, opts || {}));
    } catch (e) { p = null; }
    if (!p) return null;
    p.pos.y = groundY(x, z);
    A.root.add(p.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(p);
    p.name = name;
    p._campaignTarget = true;            // the city's "spoken for" stamp: nobody recasts or drafts him
    p._hitMark = true;
    p._hmJob = "sawyou";
    p._noAimTag = true;                  // the crosshair's name pill (city/aim_dossier.js) says nothing over either of them
    p.controlled = true;                 // this file is his brain; and a controlled body is drawn at any range
    p.state = "idle"; p.pause = 1; p.path = null;
    if (p.group) { p.group.visible = true; p._spawnHidden = false; }
    return p;
  }
  // the same dark coat and trousers on both of them. Plain cloth (the rig's own
  // solid torso, tinted at spawn) with the legs matched by hand: a cast
  // wardrobe record would dress each of them as whatever job the city dealt.
  function dressAlike(p, legs) {
    try {
      const sl = p && p.char && p.char.skinSlots; if (!sl) return;
      const lists = [sl.legs, sl.legsLower];
      for (let j = 0; j < lists.length; j++) {
        const L = lists[j]; if (!L) continue;
        for (let i = 0; i < L.length; i++) {
          const m = L[i]; if (!m || !m.material || !m.material.color) continue;
          m.material = m.material.clone();
          m.material.color.setHex(legs);
        }
      }
    } catch (e) {}
  }
  function hold(p, x, z, face) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.speed = 0; p.moveOrder = null;
    if (p.target && p.target.set) p.target.set(x, 0, z);
    if (Math.hypot(p.pos.x - x, p.pos.z - z) > 0.5) p.moveOrder = { x: x, z: z, speed: 1.4, stop: true, t: CBZ.now || 0 };
    if (face != null && CBZ.cityPedFaceYaw) { try { CBZ.cityPedFaceYaw(p, face, 1.2); } catch (e) {} }
    else if (face != null && p.group) p.group.rotation.y += wrapPi(face - p.group.rotation.y) * 0.2;
  }
  function gone(p) { return !p || !p.group || !p.group.parent || (CBZ.cityPeds || []).indexOf(p) < 0; }
  function removeNow(p) {
    if (!p) return;
    if (p.group && p.group.parent) p.group.parent.remove(p.group);
    const L = CBZ.cityPeds || []; const i = L.indexOf(p); if (i >= 0) L.splice(i, 1);
  }
  function release(p, hard) {
    if (!p) return;
    p._hitMark = false; p._hmJob = null; p._noAimTag = false;
    if (p.dead) return;
    p.controlled = false; p._boardOwn = false; p.moveOrder = null;
    if (!hard && CBZ.leave && p.group && p.group.parent) { p.rage = null; try { CBZ.leave.go(p, { tag: "hmjob", remove: removeNow }); return; } catch (e) {} }
    removeNow(p);
  }

  /* the grey case: a box with a handle, in whichever hand holds it */
  let caseGeo = null, caseMat = null, gripMat = null;
  function buildCase() {
    if (!caseGeo) {
      caseGeo = new THREE.BoxGeometry(0.44, 0.31, 0.1); caseGeo._shared = true;
      caseMat = new THREE.MeshLambertMaterial({ color: 0x7c8187 }); caseMat._shared = true;
      gripMat = new THREE.MeshLambertMaterial({ color: 0x1b1c1e }); gripMat._shared = true;
    }
    const grp = new THREE.Group();
    const body = new THREE.Mesh(caseGeo, caseMat); body.position.set(0, -0.2, 0); body.castShadow = true; grp.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.03), gripMat); grip.position.set(0, -0.03, 0); grp.add(grip);
    grp.userData.transient = true;
    return grp;
  }
  function caseTo(M, ped) {
    const sock = ped && ped.char && ped.char.sockets ? ped.char.sockets.leftHand : null;
    if (!M.caseG || !sock) return;
    if (M.caseG.parent) M.caseG.parent.remove(M.caseG);
    sock.add(M.caseG);
    M.caseG.position.set(0, 0, 0); M.caseG.rotation.set(0, Math.PI / 2, 0);
    M.caseWith = ped;
  }
  function caseDrop(M) {
    const c = M.caseG; if (!c || !c.parent) return;
    const A = arena(); const w = new THREE.Vector3();
    c.getWorldPosition(w);
    c.parent.remove(c);
    if (A && A.root) { A.root.add(c); c.position.set(w.x, groundY(w.x, w.z, w.y) + 0.36, w.z); c.rotation.set(Math.PI / 2, 0, 0.4); }
    M.caseWith = null;
  }
  function blade(ped) {
    const sock = ped && ped.char && ped.char.sockets ? ped.char.sockets.rightHand : null;
    if (!sock || ped._hmBlade) return;
    let k = null;
    try { k = CBZ.buildActorWeapon ? CBZ.buildActorWeapon("shank") : null; } catch (e) { k = null; }
    if (!k || !k.isObject3D) {
      k = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.2, 0.004), new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.9, roughness: 0.25 }));
      k.position.set(0, -0.12, 0.02);
    }
    sock.add(k);
    ped._hmBlade = k; ped.blade = true;
  }

  /* ---------------- GLASS ON HIM ------------------------------------------
     how hard your lens is on him right now: 0 (not looking), 1 (the rifle
     scope or the binoculars centred on him with a clear line). A gun held on
     him at street range counts the same. */
  const _dir = new THREE.Vector3(), _to = new THREE.Vector3();
  function glassOn(ped) {
    const cam = CBZ.camera, pl = P();
    if (!cam || !pl || !ped || !ped.pos) return 0;
    let lens = false;
    try { lens = !!(CBZ.fpsScoped && CBZ.fpsScoped()) || !!(CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()); } catch (e) { lens = false; }
    let ads = false;
    try { ads = !!(CBZ.isADS && CBZ.isADS()); } catch (e) { ads = false; }
    if (!lens && !ads) return 0;
    cam.getWorldDirection(_dir);
    _to.set(ped.pos.x - cam.position.x, ped.pos.y + 1.45 - cam.position.y, ped.pos.z - cam.position.z);
    const d = _to.length(); if (d < 0.5) return 1;
    const c = _to.dot(_dir) / d;
    if (!lens && d > 45) return 0;                       // iron sights at 150 m is not glass
    const need = lens ? 0.99925 : 0.985;                 // about 2.2 degrees of a ten-power tube
    if (c < need) return 0;
    if (!los(cam.position.x, cam.position.y, cam.position.z, ped.pos.x, ped.pos.y + 1.45, ped.pos.z)) return 0;
    return 1;
  }

  /* ---------------- THE GESTURE -------------------------------------------
     written onto his rig after the crowd has animated him (the job's frame()
     runs after the ped update): the right hand comes up to the left side of
     his neck, goes across, and drops. k 0..1. */
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  const _nk = new THREE.Vector3(), _wr = new THREE.Vector3();
  function throatPose(p, k) {
    const ch = p.char;
    if (!ch || !ch.neck || !p.group) return;
    const up = ease(k / 0.24), down = ease((k - 0.84) / 0.16);
    const w = up * (1 - down);                           // how much of the pose is on
    const draw = ease((k - 0.28) / 0.54);                // the cut: from his left to his right
    if (w <= 0.001) return;
    if (CBZ.charArmTo) {
      // the wrist, solved to a point in front of his own neck (the rig's arm IK):
      // fingers start at the left of the throat and are drawn across to the right
      const yaw = p.group.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
      ch.neck.getWorldPosition(_nk);
      const side = -0.02 + draw * 0.21, fwd = 0.13 - Math.sin(draw * Math.PI) * 0.015;
      _wr.set(_nk.x + fx * fwd + rx * side, _nk.y + 0.045, _nk.z + fz * fwd + rz * side);
      try { CBZ.charArmTo(ch, _wr, "r", w); return; } catch (e) {}
    }
    // no IK on this rig: the same read from joint angles
    const ra = ch.parts ? ch.parts.ra : null, low = ch.low ? ch.low.ra : null;
    if (!ra || !low) return;
    ra.rotation.x += (-0.55 - ra.rotation.x) * w;
    ra.rotation.z += ((0.5 - draw * 0.8) - ra.rotation.z) * w;
    low.rotation.x += (-2.4 - low.rotation.x) * w;
  }
  function lookUp(ch, pitch, w) {
    if (!ch || !ch.neck) return;
    ch.neck.rotation.x += (-pitch * 0.5 - ch.neck.rotation.x) * w;
    if (ch.head) ch.head.rotation.x += (-pitch * 0.5 - ch.head.rotation.x) * w;
    ch.neck.rotation.y += (0 - ch.neck.rotation.y) * w;
    if (ch.head) ch.head.rotation.y += (0 - ch.head.rotation.y) * w;
  }

  /* ---------------- SOUND ---------------------------------------------------
     everything he does out of your sight has a place and gets to your ear
     across the real distance; a storey between you and it goes dull. */
  function stepSound(p, loud) {
    const pl = P(); if (!pl || !CBZ.sfx) return;
    const dy = (p.pos.y + 0.1) - pl.pos.y;
    const d = Math.hypot(p.pos.x - pl.pos.x, dy * 1.4, p.pos.z - pl.pos.z);
    if (d > 60) return;
    const under = Math.abs(dy) > 2.2;
    try { CBZ.sfx("step", { dist: d * (under ? 1.6 : 1), volume: (loud ? 1.25 : 0.8), pitch: 0.82 + Math.random() * 0.1, force: true, ghost: true, far: under && d > 9 }); } catch (e) {}
  }
  function doorSound(x, y, z, open) {
    if (!CBZ.sfxAt) return;
    try { CBZ.sfxAt(open ? "door_open" : "door_close", x, z, { y: y, volume: 0.9, force: true, ghost: true }); } catch (e) {}
  }
  // the one line, close and quiet. The game's mouth is words over the head
  // (systems/speech.js); where the browser can speak, it is also said aloud,
  // low and near, so it is the last thing HEARD.
  function sayLine(ped) {
    try { if (CBZ.speech && CBZ.speech.say) CBZ.speech.say(ped, LINE, { force: true, important: true, secs: 4, ear: 30 }); } catch (e) {}
    try {
      const SS = window.speechSynthesis, U = window.SpeechSynthesisUtterance;
      if (!SS || !U || (CBZ.CONFIG && CBZ.CONFIG.HITMAN_SPOKEN_LINE === false)) return;
      const u = new U(LINE);
      const voices = SS.getVoices ? SS.getVoices() : [];
      let v = null;
      for (let i = 0; i < voices.length && !v; i++) if (/whisper/i.test(voices[i].name)) v = voices[i];
      for (let i = 0; i < voices.length && !v; i++) if (/^en/i.test(voices[i].lang || "") && /daniel|alex|fred|male|guy|david|george/i.test(voices[i].name)) v = voices[i];
      if (v) u.voice = v;
      u.rate = 0.78; u.pitch = 0.55; u.volume = v && /whisper/i.test(v.name) ? 1 : 0.55;
      SS.cancel(); SS.speak(u);
    } catch (e) {}
  }
  try { if (window.speechSynthesis && window.speechSynthesis.getVoices) window.speechSynthesis.getVoices(); } catch (e) {}   // (the list loads lazily: ask early)

  /* ---------------- THE RUN: streets, then the building --------------------
     The street legs come from the city's own router (centre lines through the
     intersections, the last leg through the building's door). Each leg is
     then walked on a PAVEMENT, and of the two pavements the one your roof
     sees least of. */
  function streetPath(M, fromX, fromZ) {
    const b = M.roofLot.building, d = b.door;
    const tmp = [];
    let pts = null;
    try { pts = CBZ.cityNav && CBZ.cityNav.routeTo ? CBZ.cityNav.routeTo(fromX, fromZ, d.x, d.z, tmp) : null; } catch (e) { pts = null; }
    const raw = [];
    if (pts && pts.length) for (let i = 0; i < pts.length; i++) raw.push({ x: pts[i].x, z: pts[i].z });     // (pooled objects: copied)
    else raw.push({ x: d.x, z: d.z });
    // the last three points are the door: the pavement outside it, the
    // threshold, a stride inside. Everything before is an intersection centre.
    const nDoor = raw.length >= 3 ? 3 : raw.length;
    const cross = raw.slice(0, raw.length - nDoor), tail = raw.slice(raw.length - nDoor);
    const A = arena(), off = ((A && A.ROAD) || 18) / 2 + 1.5;
    const e = M.eye;
    // how much of a straight walk between two points your roof can see
    const seenLeg = function (ax, az, bx, bz) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(len / 7));
      let c = 0;
      for (let i = 1; i < n; i++) {
        const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
        if (los(e.x, e.y, e.z, x, groundY(x, z) + 1.3, z)) c++;
      }
      return c * len / n;                                   // metres in the open
    };
    // each intersection is crossed at one of its four pavement corners; pick
    // the chain of corners that keeps him out of your sight, then short
    const K = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const cost = [], back = [];
    for (let i = 0; i < cross.length; i++) {
      cost.push([0, 0, 0, 0]); back.push([-1, -1, -1, -1]);
      for (let k = 0; k < 4; k++) {
        const x = cross[i].x + K[k][0] * off, z = cross[i].z + K[k][1] * off;
        if (i === 0) { cost[0][k] = Math.hypot(x - fromX, z - fromZ) + seenLeg(fromX, fromZ, x, z) * 2.2; continue; }
        let best = Infinity, bj = 0;
        for (let j = 0; j < 4; j++) {
          const px = cross[i - 1].x + K[j][0] * off, pz = cross[i - 1].z + K[j][1] * off;
          const c = cost[i - 1][j] + Math.hypot(x - px, z - pz) + seenLeg(px, pz, x, z) * 2.2;
          if (c < best) { best = c; bj = j; }
        }
        cost[i][k] = best; back[i][k] = bj;
      }
    }
    const out = [];
    if (cross.length) {
      const t0 = tail[0];
      let k = 0, best = Infinity;
      const last = cross.length - 1;
      for (let j = 0; j < 4; j++) {
        const x = cross[last].x + K[j][0] * off, z = cross[last].z + K[j][1] * off;
        const c = cost[last][j] + Math.hypot(t0.x - x, t0.z - z) + seenLeg(x, z, t0.x, t0.z) * 2.2;
        if (c < best) { best = c; k = j; }
      }
      const chain = [];
      for (let i = last; i >= 0; i--) { chain.push({ x: cross[i].x + K[k][0] * off, z: cross[i].z + K[k][1] * off }); k = back[i][k]; }
      chain.reverse();
      for (let i = 0; i < chain.length; i++) out.push(chain[i]);
    }
    // the pavement outside the door, then the threshold. (The router's third
    // point, a stride inside on the door's centre line, is not walked: some
    // lobbies stand a partition on that line, and the lobby is the grid's.)
    for (let i = 0; i < Math.min(2, tail.length); i++) out.push({ x: tail[i].x, z: tail[i].z, door: i > 0 });
    return out;
  }
  // from just inside the street door to a point on the ground floor (steer() routes it)
  function lobbyPath(M, ped, to) { return [{ x: to.x, z: to.z }]; }
  // (the mover reads `stop` as the arrival distance and `leg` as "passed at speed")
  function order(p, x, z, speed, stop) { p.moveOrder = { x: x, z: z, speed: speed, stop: stop ? 0.3 : 0.15, leg: !stop, t: CBZ.now || 0 }; }
  // toward (x, z) on the ground floor THROUGH what is there: the city's own
  // grid router (systems/navgrid.js, the one the crowd walks on) turns the
  // goal into the next step of a walk that exists (round the hedge, out of
  // the gate, through the door) and the order is to that step. Where the grid
  // has no say (off its window, up a storey) the order is the goal itself.
  // does a straight walk from a to b pass through a building? (the lot records' footprints)
  function crossesBuilding(ax, az, bx, bz) {
    const L = builtLots(false);
    const dx = bx - ax, dz = bz - az;
    for (let i = 0; i < L.length; i++) {
      const b = L[i].building;
      const x0 = b.ox - b.w / 2 - 0.7, x1 = b.ox + b.w / 2 + 0.7, z0 = b.oz - b.d / 2 - 0.7, z1 = b.oz + b.d / 2 + 0.7;
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
      let t0 = 0, t1 = 1, hit = true;
      const pq = [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]];
      for (let k = 0; k < 4 && hit; k++) {
        const pp = pq[k][0], qq = pq[k][1];
        if (Math.abs(pp) < 1e-9) { if (qq < 0) hit = false; continue; }
        const r = qq / pp;
        if (pp < 0) { if (r > t1) hit = false; else if (r > t0) t0 = r; }
        else { if (r < t0) hit = false; else if (r < t1) t1 = r; }
      }
      if (hit && t1 > t0) return true;
    }
    return false;
  }
  const _nav = new THREE.Vector3();
  function steer(p, x, z, speed, dt, stop) {
    _nav.set(x, 0, z);
    try { if (CBZ.navGrid && CBZ.navGrid.step) CBZ.navGrid.step(p, p.pos, _nav, dt, { speed: speed, slack: 2.5 }); } catch (e) { _nav.set(x, 0, z); }
    const routed = Math.abs(_nav.x - x) > 0.01 || Math.abs(_nav.z - z) > 0.01;
    order(p, _nav.x, _nav.z, speed, !!stop && !routed);
    return routed;
  }

  /* ---------------- make(): stage it, return the live job ------------------ */
  function make(S) {
    const pl0 = pickPlaces(S);
    if (!pl0) return null;
    const roofLot = pl0.roofLot, meetLot = pl0.meetLot, rb = roofLot.building;
    S.roofKey = lotKey(roofLot); S.meetKey = lotKey(meetLot);
    // the stair: ask the building's own core to come out on the roof. If a
    // core already stands there without a roof door, the lift is the way up.
    let core = null;
    try { core = CBZ.cityStairCore ? CBZ.cityStairCore(roofLot, { roof: true }) : null; } catch (e) { core = null; }
    const stairs = !!(core && core.roof && core.route);
    const m = pl0.meet;
    const tx = pl0.tx, tz = pl0.tz;                            // across your line of sight
    const face0 = Math.atan2(tx, tz);                          // the two of them face each other, in profile to the roof
    const seed = ((CBZ.WORLD_SEED | 0) ^ (today() * 7919) ^ 0x51a7) >>> 0;
    const coat = 0x2b2e34, legs = 0x22252b, skin = 0xd9b08c;
    const mark = spawn(NAME, m.x - tx * 0.62, m.z - tz * 0.62, seed + 1, { outfit: coat, skin: skin, hp: 125 });
    const buyer = spawn("the buyer", m.x + tx * 0.62, m.z + tz * 0.62, seed + 2, { outfit: coat, skin: skin });
    if (!mark || !buyer) { release(mark, true); release(buyer, true); return null; }
    dressAlike(mark, legs); dressAlike(buyer, legs);
    // (the crosshair's own tag reads a man's trade: neither of these two has one to read)
    mark.job = null; buyer.job = null; mark.nameKnown = false; buyer.nameKnown = false;
    mark.baseSpeed = 3.3;                                       // flee pace = 2.2x: a flat sprint
    buyer._hitMark = false;
    let photo = "", photoCanvas = null, wearing = null;
    try {
      photo = CBZ.cityMugshot ? (CBZ.cityMugshot({ ped: mark }) || "") : "";
      photoCanvas = CBZ.cityMugshotCanvas ? CBZ.cityMugshotCanvas({ ped: mark }) : null;
      wearing = CBZ.cityMugshotWearing ? CBZ.cityMugshotWearing({ ped: mark }) : null;
    } catch (e) { photo = ""; }
    const r = function (k) { return h01(seed, k, 0x77); };
    const M = {
      roofLot: roofLot, meetLot: meetLot, eye: pl0.eye, meet: m, dist: Math.round(pl0.dist / 5) * 5, core: core, stairs: stairs,
      mark: mark, buyer: buyer, face0: face0, tx: tx, tz: tz,
      phase: "meet", t: 0, glass: 0, lookAt: 4.5 + r(1) * 6.5, posT: 0, handAt: 46 + r(2) * 18, hand: 0, handT: 0,
      way: (stairs && r(3) < 0.5) ? "stairs" : "lift", path: null, pi: 0, stride: 0, stuck: 0, lastX: mark.pos.x, lastZ: mark.pos.z,
      ride: null, strikes: 0, strikeT: 0, said: false, shotT: 0, alarmed: false, lostT: 0, caseG: buildCase(), caseWith: null,
      photo: photo, photoCanvas: photoCanvas, wearing: wearing, cache: {}, notes: [],
    };
    caseTo(M, buyer);
    const job = {
      mark: mark, name: NAME, role: "Ex-army marksman, selling names", pay: PAY_EARLY, weight: "someone", cause: "shot", alarm: false,
      kills: { civ: 0, guard: 0 },
      M: M,
      file: function () { return file(M); },
      board: function () { return board(M); },
      boardKey: function () { return M.phase === "meet" ? "meet" + M.hand : "hot"; },
      tick: function (dt) { tick(job, M, dt); },
      frame: function (dt) { frame(job, M, dt); },
      pinAt: function () { return M.phase === "meet" ? { x: rb.door.x, z: rb.door.z, label: "the roof", key: "roof" } : null; },
      onKill: function (ped) { if (ped === M.buyer) startle(job, M, true); },
      onDead: function () { M.phase = "dead"; caseDrop(M); if (M.buyer && !M.buyer.dead && M.buyer.controlled) scatter(M); },
      place: function () { return lotName(nearestLot(mark.pos.x, mark.pos.z)); },
      end: function (hard) { end(M, hard); },
    };
    hookShots();
    LIVE = job;
    return job;
  }
  function nearestLot(x, z) {
    const L = builtLots(); let best = null, bd = Infinity;
    for (let i = 0; i < L.length; i++) { const d = d2(L[i].cx, L[i].cz, x, z); if (d < bd) { bd = d; best = L[i]; } }
    return best;
  }
  function end(M, hard) {
    if (LIVE && LIVE.M === M) LIVE = null;
    if (M.ride && M.ride.cancel) { try { M.ride.cancel(); } catch (e) {} }
    if (M.caseG) { if (M.caseG.parent) M.caseG.parent.remove(M.caseG); M.caseG = null; }
    release(M.mark, hard); release(M.buyer, hard);
  }
  // the buyer is nobody: when it goes wrong he takes the case and runs
  function scatter(M) {
    const b = M.buyer; if (!b || b.dead) return;
    b.controlled = false; b.moveOrder = null; b._campaignTarget = false;
    const away = { x: b.pos.x + (b.pos.x - M.eye.x) * 0.6, z: b.pos.z + (b.pos.z - M.eye.z) * 0.6 };
    b.state = "flee"; b.fear = 1; b.pause = 0;
    if (b.target && b.target.set) b.target.set(away.x, 0, away.z);
    try { if (CBZ.voice && CBZ.voice.runner) CBZ.voice.runner(b, M.mark.pos.x, M.mark.pos.z, "ran"); } catch (e) {}
  }

  /* ---------------- the player's shots --------------------------------------
     one subscription for the file's life; it reads the live job. A round that
     went out while he was standing there and did not put him down tells him
     exactly where you are. */
  let LIVE = null, shotsHooked = false;
  function hookShots() {
    if (shotsHooked || !CBZ.onCityEvent) return;
    shotsHooked = true;
    CBZ.onCityEvent(function (type) {
      if (type !== "bullet-impact" || !LIVE) return;
      const M = LIVE.M;
      if (M.phase === "meet" || M.phase === "look" || M.phase === "gesture") M.shotT = 0.5;      // judged when the round has had time to arrive
    });
  }
  function startle(job, M, wrongMan) {
    if (M.phase !== "meet" && M.phase !== "look" && M.phase !== "gesture") return;
    if (M.mark.dead) return;
    M.notes.push(wrongMan ? "Wrong coat. He knew where it came from before the other one hit the ground." : "Missed. He did not even duck.");
    startRun(job, M);
  }

  /* ---------------- the director (5 Hz) and the motion (every frame) ------- */
  function inPosition(M) {
    const pl = P(); if (!pl || !pl.pos) return false;
    const b = M.roofLot.building;
    return pl.pos.y > b.h - 1.5 && Math.abs(pl.pos.x - b.ox) < b.w / 2 + 1 && Math.abs(pl.pos.z - b.oz) < b.d / 2 + 1;
  }
  function tick(job, M, dt) {
    const mark = M.mark, pl = P();
    if (!pl || mark.dead || M.phase === "dead") return;
    M.t += dt;
    if (M.shotT > 0) { M.shotT -= dt; if (M.shotT <= 0 && !mark.dead) startle(job, M, false); }
    if (M.phase === "meet") {
      // the clock on the sale only runs while you are up there to see it
      if (inPosition(M)) M.posT += dt;
      if (M.hand === 0 && M.posT >= M.handAt) { M.hand = 1; M.handT = 0; }
      if (M.hand === 2 && M.handT > 34) {
        // he walked, with the case, and you let him
        M.phase = "lost"; M.lostT = 0;
        return;
      }
      // glass: it builds while your lens is on him and drains, slower, when it is not
      const gl = glassOn(mark);
      if (gl > 0) M.glass += dt; else M.glass = Math.max(0, M.glass - dt * 0.22);
      // a man with a gun out walking up to him on the pavement is the same thing, closer
      const near = d2(pl.pos.x, pl.pos.z, mark.pos.x, mark.pos.z);
      if (near < 13 && Math.abs(pl.pos.y - mark.pos.y) < 3 && CBZ.cityHasGun && CBZ.cityHasGun() && CBZ.playerArmed && CBZ.playerArmed()) M.glass += dt * 1.6;
      if (M.glass >= M.lookAt) { M.phase = "look"; M.t = 0; M.seenFrom = { x: pl.pos.x, y: pl.pos.y + 1.5, z: pl.pos.z }; }
      return;
    }
    if (M.phase === "lost") {
      M.lostT += dt;
      if (M.lostT > 4) {
        const t0 = today();
        LOST_DAY = t0;
        if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: "Nico", text: "He walked. With the case. You had him in the glass and you let him walk. Forget it.", priority: 2 }); } catch (e) {} }
        if (CBZ.hitmanJobs && CBZ.hitmanJobs.drop) CBZ.hitmanJobs.drop();
      }
      return;
    }
    if (pl.dead || M.phase === "after") {
      // it is done. He stands a moment, then he is a man walking away, and the
      // contract went with him (you waking up in a hospital does not bring him back).
      if (M.phase !== "after") { M.phase = "after"; M.t = 0; mark.moveOrder = null; mark._boardOwn = false; }
      if (M.t > 5) {
        LOST_DAY = today();
        if (CBZ.hitmanJobs && CBZ.hitmanJobs.drop) CBZ.hitmanJobs.drop();
      }
      return;
    }
    // the long way round: he could not reach you
    if (M.phase !== "look" && M.phase !== "gesture") {
      M.chaseT = (M.chaseT || 0) + dt;
      if (M.chaseT > 210) { M.phase = "lost"; M.lostT = 0; }
    }
  }
  let LOST_DAY = -1;

  function startRun(job, M) {
    const mark = M.mark;
    M.phase = "run"; M.t = 0; M.chaseT = 0;
    job.alarm = true;                                              // a man sprinting through traffic at a building: the street saw it
    blade(mark);
    mark.staffPost = null;
    streetBody(mark);
    M.path = streetPath(M, mark.pos.x, mark.pos.z);
    M.pi = 0;
    if (M.hand < 2) scatter(M);
    try { if (CBZ.faceMood && mark.char) CBZ.faceMood(mark.char, "angry", 1, 60000); } catch (e) {}
    try { if (CBZ.voice && CBZ.voice.runner) CBZ.voice.runner(mark, M.meet.x, M.meet.z, "ran"); } catch (e) {}
  }

  // Two men watched through a ten-power tube are not "far": the crowd swaps a
  // rig to its far hands and limbs past 30 m from YOU, which is right for a
  // street and wrong for the one face you are studying. Hold both at the
  // near detail (the stamp tells the crowd's own distance swap it is done).
  function nearDetail(p) {
    if (!p || p.dead || !p.char || !p.char.setHandLod) return;
    if (p._handLod !== 2 || !p._hmNear) { try { p.char.setHandLod(1); } catch (e) {} p._handLod = 2; p._hmNear = true; }
  }
  /* OVER WHAT IS LOW. A sprinting pedestrian goes over a park rail or a
     car bonnet on the game's character controller (CBZ.characterTraversal);
     the crowd mover only offers that to bodies it runs itself, and cancels it
     for one somebody else owns. He is this file's body all the way (so that
     he is drawn through your scope at any range and the crowd's recasting
     leaves him alone), so this file asks the same controller for the same
     vault along the way he is headed and steps it to its end, with the crowd
     loop told to keep its hands off for that half second. */
  function vaultOver(M, q) {
    const p = M.mark, T = CBZ.characterTraversal;
    if (!T || !T.start || !p.char) return false;
    const dx = q.x - p.pos.x, dz = q.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.5) return false;
    let st = null;
    try {
      st = T.start(p, p.char, dx / d, dz / d, { speed: 7.4, radius: p.radius || 0.36, height: (p.char.metric && p.char.metric.height) || 1.75, allowTop: false, cars: true, npc: true, running: true, sprinting: true });
    } catch (e) { st = null; }
    if (!st) return false;
    M.vault = true; p._boardOwn = true; p.moveOrder = null;
    return true;
  }
  function streetBody(p) { if (p && !p.dead) { p.controlled = true; p._mugFleeT = 0; p.state = "flee"; } }
  function frame(job, M, dt) {
    const mark = M.mark, buyer = M.buyer, pl = P();
    if (!pl || !pl.pos || M.phase === "dead" || M.phase === "lost") return;
    if (mark.dead) return;
    const m = M.meet;
    nearDetail(mark); if (M.phase === "meet" || M.phase === "look" || M.phase === "gesture") nearDetail(buyer);

    if (M.phase === "meet") {
      // the two of them, a stride apart, talking; then the case goes across
      const ax = m.x - M.tx * 0.62, az = m.z - M.tz * 0.62, bx = m.x + M.tx * 0.62, bz = m.z + M.tz * 0.62;
      if (M.hand === 0) { hold(mark, ax, az, M.face0); if (buyer && !buyer.dead) hold(buyer, bx, bz, M.face0 + Math.PI); }
      else if (M.hand === 1) {
        M.handT += dt;
        hold(mark, ax, az, M.face0); if (buyer && !buyer.dead) hold(buyer, bx, bz, M.face0 + Math.PI);
        // the buyer holds it out; Reiss takes it
        if (buyer && !buyer.dead && buyer.char && buyer.char.parts && buyer.char.parts.la) {
          const k = ease(M.handT / 0.8) * (1 - ease((M.handT - 1.6) / 0.6));
          buyer.char.parts.la.rotation.x += (-1.1 - buyer.char.parts.la.rotation.x) * k;
          if (mark.char && mark.char.parts && mark.char.parts.la) mark.char.parts.la.rotation.x += (-0.9 - mark.char.parts.la.rotation.x) * k;
        }
        if (M.handT > 1.2 && M.caseWith !== mark) caseTo(M, mark);
        if (M.handT > 2.6) { M.hand = 2; M.handT = 0; job.pay = PAY; M.notes.push("The case changed hands. The one carrying it now."); }
      } else {
        // done: they part. Reiss walks up the pavement with the case.
        M.handT += dt;
        if (M.handT > 3) {
          order(mark, m.x - M.tx * 60, m.z - M.tz * 60, 1.5, false);
          if (buyer && !buyer.dead && buyer.controlled) { order(buyer, m.x + M.tx * 60, m.z + M.tz * 60, 1.5, false); }
        } else { hold(mark, ax, az, M.face0); if (buyer && !buyer.dead) hold(buyer, bx, bz, M.face0 + Math.PI); }
      }
      return;
    }

    if (M.phase === "look" || M.phase === "gesture") {
      M.ft = (M.ft || 0) + dt;
      const t = M.ft;
      const sx = M.seenFrom ? M.seenFrom.x : pl.pos.x, sz = M.seenFrom ? M.seenFrom.z : pl.pos.z, sy = M.seenFrom ? M.seenFrom.y : pl.pos.y + 1.5;
      const yaw = Math.atan2(sx - mark.pos.x, sz - mark.pos.z);
      const dd = Math.hypot(sx - mark.pos.x, sz - mark.pos.z);
      const pitch = Math.atan2(sy - (mark.pos.y + 1.6), Math.max(1, dd));
      // he stops where he is. The head comes round first, then the rest of him.
      mark.path = null; mark.moveOrder = null; mark.state = "idle"; mark.speed = 0;
      if (mark.target && mark.target.set) mark.target.set(mark.pos.x, 0, mark.pos.z);
      const turn = ease((t - 0.15) / 0.75);
      if (mark.group) {
        const dy = wrapPi(yaw - mark.group.rotation.y);
        mark.group.rotation.y += dy * Math.min(1, dt * (1.5 + turn * 9));
        if (mark.char && mark.char.neck) {
          // the neck leads the shoulders while the body is still turning
          const lead = clamp(wrapPi(yaw - mark.group.rotation.y), -1.1, 1.1) * ease(t / 0.3);
          mark.char.neck.rotation.y += (lead - mark.char.neck.rotation.y) * Math.min(1, dt * 14);
        }
      }
      if (t > 0.5) lookUp(mark.char, pitch, Math.min(1, dt * 10));
      mark.foe = PA();
      if (t > 0.3 && !M.mooded) { M.mooded = true; try { if (CBZ.faceMood && mark.char) CBZ.faceMood(mark.char, "angry", 0.8, 9000); } catch (e) {} }
      // the buyer keeps talking a moment, then follows the stare
      if (buyer && !buyer.dead && buyer.controlled) {
        if (t < 1.7) hold(buyer, buyer.pos.x, buyer.pos.z, M.face0 + Math.PI);
        else if (buyer.group) buyer.group.rotation.y += wrapPi(Math.atan2(sx - buyer.pos.x, sz - buyer.pos.z) - buyer.group.rotation.y) * Math.min(1, dt * 3);
      }
      // a beat of stillness; then the hand
      const G0 = 2.25, GLEN = 2.5;
      if (t >= G0) {
        M.phase = "gesture";
        throatPose(mark, (t - G0) / GLEN);
      }
      if (t >= G0 + GLEN + 0.12) startRun(job, M);
      return;
    }

    // ---- from here he is coming ------------------------------------------------
    const lv = mark.pos.y - pl.pos.y;
    const flat = d2(mark.pos.x, mark.pos.z, pl.pos.x, pl.pos.z);
    // footfalls you can hear (the street is too far; the building is not)
    const moved = Math.hypot(mark.pos.x - M.lastX, mark.pos.z - M.lastZ);
    M.stride += moved;
    if (M.stride > 1.5) { M.stride = 0; if (M.phase !== "run" || flat < 40) stepSound(mark, M.phase === "stairs" || M.phase === "roof"); }
    // stuck: a body that has not gone anywhere in a second
    M.stuckT = (M.stuckT || 0) + dt;
    if (M.stuckT > 0.75) {
      const gone0 = M.sx0 == null ? 9 : Math.hypot(mark.pos.x - M.sx0, mark.pos.y - M.sy0, mark.pos.z - M.sz0);
      M.stuck = (gone0 < 0.5 && !M.ride && !mark._traversal) ? M.stuck + 1 : 0;
      M.sx0 = mark.pos.x; M.sy0 = mark.pos.y; M.sz0 = mark.pos.z; M.stuckT = 0;
    }
    // (while he is the crowd's body nothing else gets to carry him off: a
    // jump no pair of legs makes in a frame is undone)
    if (moved > 12 && M.phase === "run" && !M.ride) { mark.pos.x = M.lastX; mark.pos.z = M.lastZ; mark.pos.y = M.lastY != null ? M.lastY : mark.pos.y; if (mark.target && mark.target.set) mark.target.set(M.lastX, 0, M.lastZ); if (window.console) console.warn("[sawyou] the runner was moved " + Math.round(moved) + " m in a frame; put back"); }
    M.lastX = mark.pos.x; M.lastZ = mark.pos.z; M.lastY = mark.pos.y;

    // he is on your level and close: forget the route, it is you now
    const sameLevel = Math.abs(lv) < 1.3;
    if (sameLevel && flat < 30 && M.phase !== "strike" && M.phase !== "lift" && (M.phase !== "run" || flat < 14 || los(mark.pos.x, mark.pos.y + 1.5, mark.pos.z, pl.pos.x, pl.pos.y + 1.4, pl.pos.z))) {
      if (M.phase !== "roof") { M.phase = "roof"; M.t = 0; }
    }
    if (M.phase !== "run" && M.vault) { M.vault = false; mark._boardOwn = false; }

    if (M.phase === "run") {
      const q = M.path[M.pi];
      if (!q) { enterBuilding(M); return; }
      // a vault under way is stepped here to its end (see vaultOver)
      if (M.vault) {
        let on = false;
        try { on = !!CBZ.characterTraversal.step(mark, mark.char, dt, true); } catch (e) { on = false; }
        if (!on) { M.vault = false; mark._boardOwn = false; mark._traversal = null; if (CBZ.moves && CBZ.moves.reset && CBZ.moves.motor) { try { CBZ.moves.reset(CBZ.moves.motor(mark), mark.pos); } catch (e) {} } }
        return;
      }
      const dq = d2(mark.pos.x, mark.pos.z, q.x, q.z);
      if (dq < (q.door ? 0.75 : 2.6)) { M.pi++; M.flipT = 0; M.flips = 0; return; }
      // the door: straight over the threshold (the leaf swings for a body at it)
      if (q.door) { order(mark, q.x, q.z, 5.2, false); return; }
      /* THE STREET, to the next pavement corner. Two ways to make for it, and
         neither is right everywhere in this city:
           STRAIGHT   when no building stands on the line. (A sight line is no
                      test: a showroom is glass.)
           THE GRID   the city's own router, round a building. (It cannot see
                      a knee-high rail, and a body following it into one
                      stands there.)
         So: straight when the footprints say so, the grid when they do not;
         held on something low, he goes OVER it; held for a second on anything
         else, he tries the other way for a moment; held for five, he asks the
         streets again from where he is. */
      const sp = dt > 0 ? moved / dt : 9;
      if (sp < 1.3 && dq > 2.5) { M.slowT = (M.slowT || 0) + dt; if (M.slowT > 0.3) { M.slowT = 0; if (vaultOver(M, q)) return; } } else M.slowT = 0;
      M.flipT = (M.flipT || 0) - dt;
      // (crawling counts as held: a body scraping along a wall at walking pace is not getting there)
      if (sp < 2.6) M.crawlT = (M.crawlT || 0) + dt; else M.crawlT = 0;
      if ((M.stuck >= 2 || M.crawlT > 1.3) && M.flipT <= 0) { M.flipT = 1.7; M.stuck = 0; M.crawlT = 0; M.flips = (M.flips || 0) + 1; mark._nav = null; }
      if (M.flips >= 4) { M.flips = 0; M.path = streetPath(M, mark.pos.x, mark.pos.z); M.pi = 0; return; }
      M.openT = (M.openT || 0) - dt;
      if (M.openT <= 0) { M.openT = 0.25; M.open = !crossesBuilding(mark.pos.x, mark.pos.z, q.x, q.z); }
      const straight = M.flipT > 0 ? !M.open : M.open;
      if (straight) { mark._nav = null; order(mark, q.x, q.z, 7.4, false); }
      else steer(mark, q.x, q.z, 7.4, dt, false);
      return;
    }
    if (M.phase === "lobby") {
      const q = M.path[M.pi];
      if (!q) {
        if (M.way === "lift") {
          let ride = null;
          try { ride = CBZ.cityLiftSend ? CBZ.cityLiftSend(M.roofLot, mark, "roof", { speed: 4.2 }) : null; } catch (e) { ride = null; }
          if (ride) { M.ride = ride; M.phase = "lift"; M.t = 0; return; }
          if (M.stairs) { M.way = "stairs"; toStairs(M); return; }
          M.t += dt; if (M.t > 3) { M.t = 0; toLift(M); }
          return;
        }
        M.phase = "stairs"; M.path = stairLine(M, 0, M.core.floors); M.pi = 0; M.t = 0;
        return;
      }
      const dq = d2(mark.pos.x, mark.pos.z, q.x, q.z);
      if (dq < 0.7) { M.pi++; M.stuck = 0; return; }
      M.t += dt;
      if (M.stuck >= 6 || M.t > 14) {
        // he cannot get across this lobby to it: the other way up, once
        M.stuck = 0; mark._nav = null;
        if (!M.swapped) { M.swapped = true; if (M.way === "lift" && M.stairs) { toStairs(M); return; } if (M.way === "stairs") { toLift(M); return; } }
        M.pi++;
        return;
      }
      steer(mark, q.x, q.z, 5.4, dt, M.pi === M.path.length - 1);
      return;
    }
    if (M.phase === "lift") {
      const rd = M.ride;
      if (!rd || rd.done) {
        M.ride = null;
        if (rd && rd.phase === "done") { M.phase = "roof"; M.t = 0; mark._boardOwn = false; return; }
        // the car was held against him: the stair, if this roof has one
        if (M.stairs && Math.abs(mark.pos.y - groundY(mark.pos.x, mark.pos.z, mark.pos.y + 0.5)) < 1 && mark.pos.y < 2) { M.way = "stairs"; toStairs(M); return; }
        M.phase = "roof"; M.t = 0;
      }
      return;
    }
    if (M.phase === "stairs") {
      // THE STAIR IS RUN ON ITS OWN LINE. The core hands over the walk through
      // itself (the same points its flights were built from): in at the door,
      // up lane A, across the half landing, up lane B. The crowd mover takes
      // each switchback as a stop and a turn on the spot, five seconds a
      // storey; a man running a stair takes it in two and a half. So this file
      // carries his feet along that line (his height is the stair's own, read
      // from the ground under him) and the rig runs at the pace he is making.
      let left = 4.5 * dt;
      mark._boardOwn = true; mark.moveOrder = null;
      while (left > 0 && M.path[M.pi]) {
        const q = M.path[M.pi];
        const dx = q.x - mark.pos.x, dz = q.z - mark.pos.z, dq = Math.hypot(dx, dz);
        if (dq <= left) { mark.pos.x = q.x; mark.pos.z = q.z; left -= dq; M.pi++; continue; }
        mark.pos.x += dx / dq * left; mark.pos.z += dz / dq * left;
        if (mark.group) mark.group.rotation.y += wrapPi(Math.atan2(dx, dz) - mark.group.rotation.y) * Math.min(1, dt * 14);
        left = 0;
      }
      const q1 = M.path[Math.min(M.pi, M.path.length - 1)];
      const gy = groundY(mark.pos.x, mark.pos.z, mark.pos.y + 0.55);
      // (the ground under him, when it is within a riser of where the stair says he is)
      const py = M.pi > 0 ? M.path[M.pi - 1].y : q1.y, want = Math.max(Math.min(py, q1.y) - 0.3, Math.min(Math.max(py, q1.y) + 0.3, gy));
      mark.pos.y += (want - mark.pos.y) * Math.min(1, dt * 18);
      if (mark.target && mark.target.set) mark.target.set(mark.pos.x, 0, mark.pos.z);
      mark.speed = 4.5;
      try { if (CBZ.animChar && mark.char) CBZ.animChar(mark.char, 4.5, dt); } catch (e) {}
      if (!M.path[M.pi]) {
        // off the top (or the bottom) of it: his own feet again
        mark._boardOwn = false;
        if (CBZ.moves && CBZ.moves.reset && CBZ.moves.motor) { try { CBZ.moves.reset(CBZ.moves.motor(mark), mark.pos); } catch (e) {} }
        M.phase = "roof"; M.t = 0;
      }
      return;
    }
    if (M.phase === "roof") {
      M.t += dt;
      if (!sameLevel || flat > 60) { repath(M, dt); return; }
      if (flat < 1.55 && !(CBZ.verbs && CBZ.verbs.strikeOf && CBZ.verbs.strikeOf(mark))) { strike(job, M); return; }
      // straight at you, flat out; the last metres he does not weave
      const wob = flat > 6 ? Math.sin((CBZ.now || 0) * 0.006) * 1.3 : 0;
      const nx = -(pl.pos.z - mark.pos.z) / (flat || 1), nz = (pl.pos.x - mark.pos.x) / (flat || 1);
      order(mark, pl.pos.x + nx * wob, pl.pos.z + nz * wob, 7.6, false);
      return;
    }
    if (M.phase === "strike") {
      M.strikeT += dt;
      // stay on you between the cuts
      if (flat > 1.2) order(mark, pl.pos.x, pl.pos.z, 6.5, false);
      if (M.strikeT > 0.62 && !(CBZ.verbs && CBZ.verbs.strikeOf && CBZ.verbs.strikeOf(mark))) { M.phase = "roof"; }
      return;
    }
  }

  // you left the roof, or he came up the wrong way: get to your level by what the building has
  function repath(M, dt) {
    const mark = M.mark, pl = P();
    M.rpT = (M.rpT || 0) - dt;
    const b = M.roofLot.building;
    const playerUp = pl.pos.y > b.h - 1.5 && Math.abs(pl.pos.x - b.ox) < b.w / 2 + 1 && Math.abs(pl.pos.z - b.oz) < b.d / 2 + 1;
    const markUp = mark.pos.y > b.h - 1.5;
    const markIn = Math.abs(mark.pos.x - b.ox) < b.w / 2 && Math.abs(mark.pos.z - b.oz) < b.d / 2;
    if (playerUp && !markUp) {
      if (markIn && mark.pos.y < 1.5) { if (M.way === "lift") toLift(M); else toStairs(M); return; }
      if (!markIn) { if (M.rpT <= 0) { M.rpT = 3; M.path = streetPath(M, mark.pos.x, mark.pos.z); M.pi = 0; M.phase = "run"; } return; }
      // somewhere on the stair between: keep climbing
      if (M.stairs) { M.phase = "stairs"; M.path = stairLine(M, 0, M.core.floors); M.pi = nearestIdx(M.path, mark); return; }
      return;
    }
    if (!playerUp && markUp) {
      // down the stair after you; with no stair, the lift
      if (M.stairs) { if (M.rpT <= 0) { M.rpT = 4; M.phase = "stairs"; M.path = stairLine(M, M.core.floors, 0); M.pi = nearestIdx(M.path, mark); } }
      else if (!M.ride && M.rpT <= 0) {
        M.rpT = 5;
        try { M.ride = CBZ.cityLiftSend ? CBZ.cityLiftSend(M.roofLot, mark, "ground", { speed: 4.2 }) : null; } catch (e) { M.ride = null; }
        if (M.ride) M.phase = "lift";
      }
      return;
    }
    // both on the ground somewhere: run you down in the street
    if (!markUp && !playerUp) {
      const flat = d2(mark.pos.x, mark.pos.z, pl.pos.x, pl.pos.z);
      if (M.rpT <= 0 || !M.path) {
        M.rpT = 1.5;
        const tmp = [];
        let pts = null;
        try { pts = CBZ.cityNav && CBZ.cityNav.routeTo ? CBZ.cityNav.routeTo(mark.pos.x, mark.pos.z, pl.pos.x, pl.pos.z, tmp) : null; } catch (e) { pts = null; }
        M.chase = [];
        if (pts) for (let i = 0; i < pts.length; i++) M.chase.push({ x: pts[i].x, z: pts[i].z });
        M.ci = 0;
      }
      let q = M.chase && M.chase[M.ci];
      if (q && flat > 12) { if (d2(mark.pos.x, mark.pos.z, q.x, q.z) < 2.6) { M.ci++; q = M.chase[M.ci] || pl.pos; } } else q = pl.pos;
      if (crossesBuilding(mark.pos.x, mark.pos.z, q.x, q.z)) steer(mark, q.x, q.z, 7.3, dt, false); else order(mark, q.x, q.z, 7.3, false);
    }
  }
  // the core's walk from one level to another, without stepping out of the
  // stair door and back in on every floor between (rec.route joins the
  // storeys door to door: the last two points of one are the first two of the next)
  function stairLine(M, k0, k1) {
    const up = k1 > k0;
    const raw = M.core.route(Math.min(k0, k1), Math.max(k0, k1));   // (always read bottom to top; turned round below)
    const out = [];
    const per = 8;                                             // points a storey (elevators.js storeyPaths)
    const n = Math.abs(k1 - k0);
    for (let i = 0; i < raw.length; i++) {
      // the joined list is 8 for the first storey and 7 for each after it
      const s = i < per ? 0 : 1 + Math.floor((i - per) / (per - 1));
      const j = i < per ? i : (i - per) % (per - 1) + 1;       // index inside its storey, 0..7
      const firstStorey = s === 0, lastStorey = s === n - 1;
      if (!lastStorey && j >= per - 2) continue;               // do not walk out onto the landing...
      if (!firstStorey && j <= 1) continue;                    // ...or back in from it
      out.push(raw[i]);
    }
    const line = out.length >= 2 ? out : raw;
    return up ? line : line.slice().reverse();
  }
  function nearestIdx(path, p) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < path.length; i++) { const d = Math.hypot(path[i].x - p.pos.x, (path[i].y - p.pos.y) * 2, path[i].z - p.pos.z); if (d < bd) { bd = d; bi = i; } }
    return Math.min(path.length - 1, bi + 1);
  }
  function enterBuilding(M) {
    const b = M.roofLot.building;
    doorSound(b.door.x, 1.2, b.door.z, true);
    if (M.way === "lift") toLift(M); else toStairs(M);
  }
  function toLift(M) {
    const L = CBZ.cityLiftLanding ? CBZ.cityLiftLanding(M.roofLot, 0) : null;
    if (!L) { if (M.stairs) { M.way = "stairs"; toStairs(M); } else { M.phase = "roof"; } return; }
    M.way = "lift"; M.phase = "lobby"; M.t = 0;
    M.path = lobbyPath(M, M.mark, L.out); M.pi = 0;
  }
  function toStairs(M) {
    const h0 = M.core.headAt(0);
    M.way = "stairs"; M.phase = "lobby"; M.t = 0;
    // a stride outside the stair door on the ground floor (headAt is the opening itself)
    M.path = lobbyPath(M, M.mark, { x: h0.x + (h0.nx || 0) * 0.9, z: h0.z + (h0.nz || 0) * 0.9 }); M.pi = 0;
  }

  /* ---------------- THE BLADE -------------------------------------------------
     he is better than you at this distance: the first cut takes most of you,
     the second is the end. Each is a real swing (CBZ.verbs.strike): it lands
     when his hand reaches you, and a step back at the right moment is a miss. */
  function strike(job, M) {
    const mark = M.mark, pa = PA(), pl = P();
    M.phase = "strike"; M.strikeT = 0;
    const land = function (res) {
      if (!pl || pl.dead || mark.dead) return;
      M.strikes++;
      const pt = res && res.point ? res.point : null;
      if (M.strikes >= 2 || pl.hp <= (pl.maxHp || 200) * 0.45) {
        // close and quiet, and then nothing
        if (!M.said) { M.said = true; sayLine(mark); }
        try { CBZ.cityKillPlayer("stabbed", { fromX: mark.pos.x, fromZ: mark.pos.z, dmg: 30 }); } catch (e) {}
        return;
      }
      try { CBZ.cityHurtPlayer(190, mark.pos.x, mark.pos.z, "stabbed", false, mark, false, { kind: "blade", zone: (res && res.zone) || "belly", point: pt, power: 1, heavy: true }); } catch (e) {}
      if (pl.hp <= 1 && !pl.dead) {
        if (!M.said) { M.said = true; sayLine(mark); }
        try { CBZ.cityKillPlayer("stabbed", { fromX: mark.pos.x, fromZ: mark.pos.z, dmg: 30 }); } catch (e) {}
      }
    };
    let st = null;
    try {
      if (CBZ.verbs && CBZ.verbs.strike && pa) st = CBZ.verbs.strike(mark, pa, { kind: "stab", arm: "r", power: 1, heavy: true, weapon: { kind: "knife", mass: 0.3, blade: true }, onLand: land, maxLunge: 1.6 });
    } catch (e) { st = null; }
    if (!st) {
      // no strike verb on this page: the cut still takes its beat
      setTimeout(function () { if (LIVE && LIVE.M === M && !mark.dead && d2(mark.pos.x, mark.pos.z, pl.pos.x, pl.pos.z) < 2.1) land(null); }, 260);
    }
  }

  /* ---------------- PAPER ------------------------------------------------------ */
  function file(M) {
    const rb = M.roofLot.building;
    const up = M.stairs ? "The lift in the lobby, or the stair in the back corner. Both come out on the roof." : "The lift in the lobby is the only way onto the roof.";
    const notes = ["Roof first. Glass second.", "Two ways up there is two ways up for anybody."].concat(M.notes.slice(-4));
    if (!M.stairs) notes[1] = "One door onto that roof. Watch it.";
    return {
      codename: "REISS", opLabel: "", classification: "PRIVATE", header: "REISS",
      status: M.mark.dead ? "DONE" : "OPEN",
      subject: { name: NAME, role: "Ex-army. Ten years behind a rifle.", photo: M.photoCanvas || M.photo || "", note: "They dress alike on purpose. Do not go by the coat." },
      identified: M.hand >= 2 || M.phase !== "meet",
      brief: [
        "He sells what the army taught him. Today it is a list of names.",
        "He meets the buyer " + whereMeet(M) + ". The buyer brings the money in a grey case.",
        "The client wants the sale to happen first. NOT before the case changes hands. The man holding the case when it is over is Reiss.",
        "He knows what glass on him feels like. Do not sit on him.",
      ],
      facts: [
        { k: "POSITION", v: "The roof of " + lotName(M.roofLot) + ". " + up },
        { k: "RANGE", v: "About " + M.dist + " meters, across the street grid." },
        { k: "FEE", v: "$" + PAY.toLocaleString("en-US") + ". Short if the case has not moved." },
      ],
      routine: [
        { label: "The meet", detail: "Two men in dark coats on the pavement, talking. One has the case.", seen: true, now: M.phase === "meet" && M.hand < 2 },
        { label: "The handoff", detail: "The case goes across. After that he walks, and he does not come back.", seen: true, now: M.phase === "meet" && M.hand >= 1 },
      ],
      security: [{ label: "Nobody", detail: "He does not need anybody.", seen: true }],
      approaches: [], kit: [],
      notes: notes,
      map: { places: [{ x: rb.ox, z: rb.oz, label: "you" }, { x: M.meet.x, z: M.meet.z, label: "him" }] },
      stamp: M.mark.dead ? "PAID" : null,
      footer: "Nico",
    };
  }
  function whereMeet(M) {
    const l = M.meetLot;
    if (M.meet.open) return "in the open in " + (l.building && l.building.name ? String(l.building.name) : "the park");
    return "on the pavement outside " + lotName(l);
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
    const rb = M.roofLot.building;
    const items = [];
    const pol = cached(M, "pol", "p", function () { return K.polaroid({ photo: M.photoCanvas || M.photo || null, caption: NAME }, redraw); });
    if (pol) items.push({ id: "live", canvas: pol, w: 0.24, h: 0.288, x: -0.62, y: 0.05, rot: -0.04, pin: "red", links: ["map"] });
    const map = cached(M, "map", "m", function () { return K.map({ places: [{ x: rb.ox, z: rb.oz, label: "the roof" }, { x: M.meet.x, z: M.meet.z, label: "the meet" }] }, {}); });
    if (map) items.push({ id: "map", canvas: map, w: 0.44, h: 0.44, x: -0.08, y: -0.04, rot: 0.02, pin: "red" });
    const cards = [
      ["Roof of " + lotName(M.roofLot), "about " + M.dist + " m to him"],
      ["Two coats, one case", "The one holding it AFTER"],
      ["Do not sit on him", "He feels glass"],
    ];
    for (let i = 0; i < cards.length; i++) {
      const lines = cards[i];
      const cv = cached(M, "card" + i, lines.join("|"), function () { return K.note({ lines: lines, hand: true, tone: i === 2 ? "yellow" : "index", redTitle: i === 2 }, {}); });
      if (cv) items.push({ id: "card" + i, canvas: cv, w: 0.24, h: 0.156, x: 0.55, y: 0.24 - i * 0.2, rot: ((i * 53) % 5 - 2) * 0.02, pin: "red", links: i < 2 ? ["map"] : ["live"] });
    }
    return items;
  }

  // can the city supply it (a roof and a meet it can see)? The pipe asks five
  // times a second while he is home: the search is run at most every 20 s.
  let stageOk = false, stageAt = -1e9;
  function canStage() {
    const t = (CBZ.now || 0);
    if (t - stageAt > 20000 || t < stageAt) { stageAt = t; try { stageOk = !!pickPlaces(null); } catch (e) { stageOk = false; } }
    return stageOk;
  }

  /* ---------------- register ---------------------------------------------------- */
  CBZ.hitmanJobs.add({
    id: "sawyou", order: 20, from: "Nico",
    call: [
      { by: "phone", line: "It's Nico. This one is glass work. You on a roof, him on the street." },
      { by: "phone", line: "He meets a man to sell something. The client wants the sale done first. Then him." },
      { by: "phone", line: "Two men, same coat. Read the paper before you look at anybody." },
      { by: "phone", line: "And listen. He did this for a living. Don't stare at him." },
    ],
    when: function () { return LOST_DAY !== today() && canStage(); },
    make: make,
  });

  // probes and tools: the live staging, and the beats driven by hand
  CBZ.hmSawYou = {
    live: function () { return LIVE; },
    places: function () { return pickPlaces(null); },
    pairs: function () { return (pickPlaces({ all: true }) || []).map(function (c) { return { roof: lotName(c.roofLot), key: lotKey(c.roofLot), meet: c.meet.open ? "park" : lotName(c.meetLot), dist: Math.round(c.dist), score: +c.score.toFixed(2), core: !!(c.roofLot.building.group.userData.stairCore || c.roofLot.building._stairCore) }; }); },
    force: function (roofKey) { FORCE = roofKey || null; return FORCE; },
    look: function () { if (!LIVE) return false; const M = LIVE.M, pl = P(); if (M.phase !== "meet") return false; M.phase = "look"; M.t = 0; M.seenFrom = { x: pl.pos.x, y: pl.pos.y + 1.5, z: pl.pos.z }; return true; },
    run: function (way) { if (!LIVE) return false; if (way) LIVE.M.way = way; startRun(LIVE, LIVE.M); return true; },
    audit: function () {
      if (!LIVE) return null;
      const M = LIVE.M, mk = M.mark, pl = P();
      return {
        phase: M.phase, way: M.way, stairs: M.stairs, hand: M.hand, glass: +M.glass.toFixed(2), lookAt: +M.lookAt.toFixed(2), posT: +M.posT.toFixed(1), handAt: +M.handAt.toFixed(1),
        roof: lotName(M.roofLot), meet: whereMeet(M), dist: M.dist, pi: M.pi, path: M.path ? M.path.length : 0, stuck: M.stuck,
        mark: mk ? { x: +mk.pos.x.toFixed(1), y: +mk.pos.y.toFixed(1), z: +mk.pos.z.toFixed(1), dead: !!mk.dead, hp: mk.hp } : null,
        ride: M.ride ? M.ride.phase : null, strikes: M.strikes, said: M.said,
        toPlayer: mk && pl ? +Math.hypot(mk.pos.x - pl.pos.x, mk.pos.y - pl.pos.y, mk.pos.z - pl.pos.z).toFixed(1) : null,
      };
    },
  };
})();
