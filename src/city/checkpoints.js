/* ============================================================
   city/checkpoints.js — POLICE CHECKPOINTS ON THE HIGHWAY SHOULDER.

   THE POINT
   ---------
   A long highway in this game had exactly one piece of police presence: the
   dynamic roadblock police.js stages ACROSS your lane when you are already at
   3 stars. Nothing existed for the ordinary state — the state you are in
   almost all the time — where the road is simply policed and you have no
   reason to worry unless you have done something. That absence is what makes
   a highway feel like a track instead of a road.

   A checkpoint is the opposite of a roadblock. It never blocks you. It is a
   fixed, permanent fact of the map, it sits on the shoulder, its officers
   stand around with their weapons holstered, and you drive past it a hundred
   times without incident — which is precisely what makes the hundred-and-
   first time, when you come past it hot, mean something.

   BUILT ENTIRELY OUT OF THINGS THAT ALREADY EXISTED
   -------------------------------------------------
   This file authors a barrier, a few cones and a placement rule. Everything
   else is borrowed:
     • the officers are real cops (CBZ.citySpawnCop) wearing police.js's OWN
       posted-officer brain — `c._post`, the same field the roadblock sets.
       That brain already walks a cop back to his slot, holds him there,
       runs the LOS check, aims, and honours arrest-first. Not one line of it
       is re-implemented here.
     • `post.relaxed` is the single behaviour this file needed and did not
       have: holstered until you actually have stars. It was added to that
       shared branch rather than forked into this one, so the next standing
       post gets it free.
     • the cruiser is a real, stealable CBZ.cityMakeCar, painted by
       CBZ.cityMarkCruiser — police.js's own marking code, exported for this
       instead of copied into it.
     • the radar feeds city/roadrules.js: a checkpoint watches the road for
       speeders whether or not an officer is looking your way, which is what
       CBZ.cityCheckpointWatching(x, z) answers.

   So the checkpoint knows how to arrest you, shoot back, be robbed of its
   car, and clock you at 90 in a 65 — and it authors none of that.

   Flags: HWY_CHECKPOINTS · HWY_CHECKPOINT_MAX · HWY_CHECKPOINT_RADAR.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.HWY_CHECKPOINTS == null) CBZ.CONFIG.HWY_CHECKPOINTS = true;
  if (CBZ.CONFIG.HWY_CHECKPOINT_MAX == null) CBZ.CONFIG.HWY_CHECKPOINT_MAX = 4;
  // metres either side of a checkpoint that its radar covers. Generous — a
  // radar gun ranges much further than the eye, and that difference is the
  // reason a checkpoint is worth driving carefully past.
  if (CBZ.CONFIG.HWY_CHECKPOINT_RADAR == null) CBZ.CONFIG.HWY_CHECKPOINT_RADAR = 85;

  const cmat = CBZ.cmat || CBZ.mat;
  const posts = [];              // { x, z, vertical, cops:[], car, group }
  let built = false;

  function on() { return CBZ.CONFIG.HWY_CHECKPOINTS !== false; }
  function arena() { return CBZ.city && CBZ.city.arena; }

  /* ---- PLACEMENT --------------------------------------------------------
     Highways only, long ones only, and never two on the same segment. The
     choice is a position hash so a given seed always polices the same
     stretches of road — a checkpoint that moved between sessions would be a
     random event, and the whole value of this thing is that it is a fact you
     can learn. */
  function pickSites() {
    const A = arena();
    const R = (A && A.roads) || (CBZ.city && CBZ.city.roads);
    if (!R || !R.length) return [];
    const cands = [];
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || String(r.district || "") !== "highway") continue;
      if ((r.len || 0) < 260) continue;                 // no room to stage on a stub
      cands.push(r);
    }
    if (!cands.length) return [];
    // deterministic order, then take the top N — a stable sort key, not a shuffle
    cands.sort(function (a, b) {
      const ka = CBZ.hash01 ? CBZ.hash01(a.x, a.z, 0x5c4b) : 0;
      const kb = CBZ.hash01 ? CBZ.hash01(b.x, b.z, 0x5c4b) : 0;
      return ka - kb;
    });
    const out = [];
    const max = Math.max(0, CBZ.CONFIG.HWY_CHECKPOINT_MAX | 0);
    for (let i = 0; i < cands.length && out.length < max; i++) {
      const r = cands[i];
      const h = CBZ.hash01 ? CBZ.hash01(r.x + 7, r.z - 3, 0x5c4c) : 0.5;
      // a third to two-thirds along the segment: off the ends, so the
      // checkpoint is never sitting inside a junction
      const t = (0.34 + h * 0.32) - 0.5;
      const along = t * (r.len || 0);
      const halfW = ((r.w != null ? r.w : (r.width != null ? r.width : 24)) / 2);
      const side = (CBZ.hash01 ? CBZ.hash01(r.z, r.x, 0x5c4d) : 0.5) < 0.5 ? -1 : 1;
      const shoulder = halfW + 3.4;
      const x = r.vertical ? r.x + side * shoulder : r.x + along;
      const z = r.vertical ? r.z + along : r.z + side * shoulder;
      // too near another one is a waste of both
      let clash = false;
      for (let k = 0; k < out.length; k++) if (Math.hypot(out[k].x - x, out[k].z - z) < 420) { clash = true; break; }
      if (clash) continue;
      out.push({ x: x, z: z, road: r, vertical: !!r.vertical, side: side, halfW: halfW });
    }
    return out;
  }

  /* ---- THE STAGE --------------------------------------------------------
     Cones taper from the live lane into the shoulder, which is the universal
     read for "something is happening up there, move over". They are NOT
     solid: a cone that stops a car is a bollard, and every driver in the
     world knows the difference. */
  function stage(site) {
    const A = arena();
    if (!A || !A.root) return null;
    const grp = new THREE.Group();
    A.root.add(grp);

    // unit vector ALONG the road, and the unit vector pointing at the road
    const ax = site.vertical ? 0 : 1, az = site.vertical ? 1 : 0;
    const nx = site.vertical ? -site.side : 0, nz = site.vertical ? 0 : -site.side;

    const coneMat = cmat(0xff6a1a), bandMat = cmat(0xf0f0f0);
    const coneGeo = new THREE.ConeGeometry(0.17, 0.52, 7);
    const bandGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.07, 7);
    for (let i = 0; i < 6; i++) {
      // Start out in the live lane and taper back to the shoulder over ~22m.
      // `into` is metres toward the centreline (nx/nz point at the road), so
      // the first cone sits inside the outer lane and the last sits level with
      // the post — the universal "move over" read.
      const u = i / 5;
      const along = -11 + u * 22;
      const into = (1 - u) * site.halfW * 0.55;
      const cx = site.x + ax * along + nx * into;
      const cz = site.z + az * along + nz * into;
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(cx, 0.32, cz); cone.castShadow = false; grp.add(cone);
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(cx, 0.34, cz); grp.add(band);
    }

    // the barrier board — a striped plank on two feet, on the shoulder, side
    // on to traffic. This one IS solid: it is the thing that says the shoulder
    // is closed, and driving through it should cost you.
    // Sits 1.4m TOWARD the road from the post: between the traffic and the
    // officers, which is the only place a barrier board is any use.
    const barW = 3.0;
    const bx = site.x + nx * 1.4, bz = site.z + nz * 1.4;
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(site.vertical ? 0.14 : barW, 0.34, site.vertical ? barW : 0.14),
      cmat(0xd8452f));
    plank.position.set(bx, 0.86, bz); grp.add(plank);
    const plank2 = new THREE.Mesh(plank.geometry, cmat(0xf0f0f0));
    plank2.position.set(bx, 0.52, bz); grp.add(plank2);
    for (let s = -1; s <= 1; s += 2) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), cmat(0x3a3f47));
      leg.position.set(bx + ax * s * (barW / 2 - 0.2), 0.36, bz + az * s * (barW / 2 - 0.2));
      grp.add(leg);
    }
    CBZ.colliders.push({
      minX: bx - (site.vertical ? 0.4 : barW / 2), maxX: bx + (site.vertical ? 0.4 : barW / 2),
      minZ: bz - (site.vertical ? barW / 2 : 0.4), maxZ: bz + (site.vertical ? barW / 2 : 0.4),
      ref: plank, y0: 0, y1: 1.05, noCam: true,
      // THE ONE DECLARED EXEMPTION from roadrules.js's road-gap law: standing in
      // the road IS this object's job, so the pass that cuts walls out of
      // carriageways must skip it and COUNT it (roadBlockAudit().exempt) rather
      // than special-case a file name. It is 3 m on a shoulder today and would
      // not qualify as a "run" anyway — the flag is here so that stays true if
      // the board is ever widened across a lane.
      roadBarrier: true,
    });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    return { grp: grp, ax: ax, az: az, nx: nx, nz: nz, bx: bx, bz: bz };
  }

  /* ---- THE UNIT ---------------------------------------------------------- */
  function crew(site, S) {
    const cops = [];
    // Two officers: one at the cones watching traffic, one back by the car.
    // Their post face vector points AT the road, which is what police.js's
    // posted branch uses to stand them the right way round.
    const slots = [
      { x: site.x + S.ax * -6.5 + S.nx * -1.2, z: site.z + S.az * -6.5 + S.nz * -1.2 },
      { x: site.x + S.ax * 4.0 + S.nx * -2.6, z: site.z + S.az * 4.0 + S.nz * -2.6 },
    ];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const c = CBZ.citySpawnCop ? CBZ.citySpawnCop(s.x, s.z, false) : null;
      if (!c) continue;
      // citySpawnCop jitters the spot a few metres (it was written for raids);
      // a posted officer belongs exactly where he was posted, and the post
      // brain will walk him back to it anyway.
      if (c.pos && c.pos.set) c.pos.set(s.x, 0, s.z);
      if (c.group) c.group.position.set(s.x, 0, s.z);
      c._post = { x: s.x, z: s.z, fx: S.nx, fz: S.nz, mount: null, mountT: 0, relaxed: true };
      c._checkpoint = true;
      cops.push(c);
    }
    return cops;
  }

  function cruiser(site, S) {
    if (!CBZ.cityMakeCar || !CBZ.cityCruiserModel) return null;
    // parked on the shoulder, nose angled out at the road the way a real one
    // sits — it is not blocking anything, it is watching
    const px = site.x + S.ax * 9.5 + S.nx * -2.2;
    const pz = site.z + S.az * 9.5 + S.nz * -2.2;
    const heading = Math.atan2(S.ax, S.az) + (site.side > 0 ? 0.38 : -0.38);
    let c = null;
    try { c = CBZ.cityMakeCar(px, pz, heading, site.vertical, CBZ.cityCruiserModel(), 0); } catch (e) { c = null; }
    if (!c) return null;
    if (CBZ.cityMarkCruiser) CBZ.cityMarkCruiser(c);
    // A REAL car, left in the world's own car list: it can be stolen, rammed
    // and wrecked like any other. That is the whole reason not to draw a
    // cruiser-shaped prop here.
    c.ai = false; c.v = 0; c.baseV = 0; c.road = null; c.parked = true;
    if (c._rbBar) { c._rbBar.red.visible = false; c._rbBar.blue.visible = false; }
    return c;
  }

  function build() {
    if (built || !on()) return;
    const A = arena();
    if (!A || !A.root || !CBZ.citySpawnCop || !CBZ.colliders) return;
    const sites = pickSites();
    built = true;                                  // one attempt, even if empty
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const S = stage(site);
      if (!S) continue;
      posts.push({
        x: site.x, z: site.z, vertical: site.vertical,
        group: S.grp, cops: crew(site, S), car: cruiser(site, S),
      });
    }
  }

  /* ---- RADAR + LIGHTS ---------------------------------------------------- */
  // The read city/roadrules.js asks: is this point being watched by a manned
  // checkpoint? A checkpoint whose officers are all dead has stopped watching,
  // which is a legitimate way to deal with one.
  CBZ.cityCheckpointWatching = function (x, z) {
    if (!on() || !posts.length) return false;
    const r = CBZ.CONFIG.HWY_CHECKPOINT_RADAR, r2 = r * r;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > r2) continue;
      for (let k = 0; k < p.cops.length; k++) if (p.cops[k] && !p.cops[k].dead) return true;
    }
    return false;
  };
  CBZ.cityCheckpoints = function () { return posts; };
  // nearest checkpoint to a point — for the map/minimap, and for anyone who
  // wants to route AROUND one
  CBZ.cityCheckpointNear = function (x, z, radius) {
    const r = radius || 1e9;
    let best = null, bd = r * r;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  let flashT = 0;
  CBZ.onUpdate(37.4, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    build();
    if (!posts.length) return;
    // The bar only lights when the checkpoint has a reason. A permanently
    // strobing light bar on the shoulder is wallpaper within a minute; one
    // that comes on as you approach hot is the whole point of the thing.
    const stars = g.wanted | 0;
    flashT += dt;
    const ph = (flashT * 6) | 0;
    const P = CBZ.player;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i], c = p.car;
      if (!c || !c._rbBar || c.player || c.dead) continue;
      const near = P && Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 200;
      const lit = stars >= 1 && near;
      if (!lit) { c._rbBar.red.visible = false; c._rbBar.blue.visible = false; continue; }
      const alt = ((ph + (c._rbBar.phase | 0)) & 1) === 0;
      c._rbBar.red.visible = alt; c._rbBar.blue.visible = !alt;
    }
  });

  // world teardown: the cops and the cruiser belong to the police/vehicle
  // pools and are cleared by their own resets, so this only drops OUR record
  // and the props parented to the arena root (which dies with the arena).
  CBZ.cityCheckpointReset = function () { posts.length = 0; built = false; };

  // Evidence, not a pin: how many checkpoints stand and how many are still
  // manned. `manned` reaching 0 with `count` > 0 means every officer in the
  // world's checkpoints is dead — true, and worth being able to see.
  CBZ.checkpointAudit = function () {
    let manned = 0;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      for (let k = 0; k < p.cops.length; k++) if (p.cops[k] && !p.cops[k].dead) { manned++; break; }
    }
    return { count: posts.length, manned: manned };
  };
})();
