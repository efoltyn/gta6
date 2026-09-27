/* city/construction.js: the retired player lot-kit that used to open this
   file is gone (it early-returned; player building on owned lots is
   systems/building.js + systems/buildmode.js + city/compoundkit.js). What
   remains is the live state construction below. */

/* ============================================================
   STATE CONSTRUCTION — THE BORDER WALL (CBZ.stateWall). The live half of
   this file: the retired lot-kit above builds nothing, so this is what
   "construction.js builds physical structures" means today.

   WHAT IT IS: a Situation-Room order (city/presidency.js presses it) that
   builds a real wall along the SALTLANDS FRONTIER — the west edge of the
   desert region biome_desert.js registered — SEGMENT BY SEGMENT OVER DAYS,
   each section paid out of the ordering seat's real polity treasury (the
   same rec.treasury polwar drains and civilwar splits; an empty purse
   PAUSES the crews, because the number is real). Where an existing road
   record crosses the line the wall leaves a GAP with a manned border post:
   real officers on police.js's `_post` standing brain via garrison.js's
   cityPostStand (checkpoints.js's exact grammar — this is that pattern's
   third consumer).

   WHAT THE WALL DOES (the mechanism, stated once, read by presidency.js):
   CBZ.stateWall.coverage() = (standing sections / total) x (manned gaps /
   gaps). The terror cell's nightly RESUPPLY RUNS cross this frontier, and
   each run is intercepted with probability = coverage — so a standing,
   manned wall starves the cell's supply and with it the attack cadence.
   A blown section (see SABOTAGE) lowers coverage, which is why the cell
   has a reason to bomb it back.

   SABOTAGE: cityExplosion is wrapped ONCE (module-local guard) and EVERY
   marker flag on the wrapped function is copied forward (the repo's
   *Wrapped law); a blast within reach knocks a section's hp down and a
   dead section drops to rubble and loses its collider. Crews REBUILD
   breaches on the daily tick before extending, at the same price.

   DETERMINISM: the line, the gaps and every section height come from the
   region rect + CBZ.hash01. No Math.random anywhere in a build path.
   BATCHING: these are runtime meshes built after load — batch.js never
   merged them, so removal is plain group surgery; nothing merged is ever
   disposed.

   FLAG: STATE_WALL_V1 (self-defaulted here; one-line revert).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.STATE_WALL_V1 == null) CFG.STATE_WALL_V1 = true;

  const SEG_LEN = 12, SEG_H = 5.2, SEG_T = 1.1;
  const SEG_COST = 1200;            // per section, out of rec.treasury
  const SEGS_PER_DAY = 6;
  const GAP_HALF = 13;              // half-width of a road gap in the line
  const REPOST_COST = 300;          // re-manning a shot-out border post
  const SEG_HP = 3;                 // explosions to fell a section

  function on() { return CFG.STATE_WALL_V1 !== false; }
  function h01(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : 0.5; }
  function cmat(hex) { return (CBZ.cmat || CBZ.mat) ? (CBZ.cmat || CBZ.mat)(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function news(t) { if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: t, priority: 1 }); return; } catch (e) {} } if (CBZ.cityFeed) CBZ.cityFeed(t, "#ffd76a"); }

  // ---- state -------------------------------------------------------------
  function fresh() {
    return { ordered: false, seatId: null, built: 0, paidStallDay: -1, breached: {}, gapsManned: {}, spentTotal: 0 };
  }
  function st() { if (!g.stateWall) g.stateWall = fresh(); return g.stateWall; }

  // ---- the line — derived from the region the desert itself registered ---
  let PLAN = null;                  // { x, z0, z1, segs:[{z,gap:false}], gaps:[{z, road}] }
  function saltlands() {
    // regions are registered on the arena (the landmass builders' `city`);
    // CBZ.city.regions is empty on a booted world — read whichever is filled.
    const A = CBZ.city && CBZ.city.arena;
    const a = (CBZ.city && CBZ.city.regions) || [], b = (A && A.regions) || [];
    const regs = a.length >= b.length ? a : b;
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (r && r.name === "The Saltlands" && r.minX != null) return r;
    }
    return null;
  }
  function plan() {
    if (PLAN) return PLAN;
    const R = saltlands();
    if (!R) return null;
    const x = R.minX - 14;                       // just outside the region pad — the frontier
    const z0 = R.minZ + 16, z1 = R.maxZ - 16;
    // GAPS: any horizontal road record whose span crosses the line gets a
    // crossing (the causeway + the desert highway). A wall that severed the
    // only road in would strand the region it claims to protect.
    const gaps = [];
    const A = CBZ.city && CBZ.city.arena;
    const roads = (A && A.roads) || (CBZ.city && CBZ.city.roads) || [];
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || r.vertical || r.x == null || r.len == null) continue;
      const rx0 = r.x - r.len / 2, rx1 = r.x + r.len / 2;
      if (rx0 > x || rx1 < x) continue;
      if (r.z < z0 - 6 || r.z > z1 + 6) continue;
      let dup = false;
      for (let k = 0; k < gaps.length; k++) if (Math.abs(gaps[k].z - r.z) < GAP_HALF * 2) { dup = true; break; }
      if (!dup) gaps.push({ z: r.z, road: r });
    }
    const segs = [];
    for (let z = z0; z + SEG_LEN <= z1; z += SEG_LEN) {
      const zc = z + SEG_LEN / 2;
      let inGap = false;
      for (let k = 0; k < gaps.length; k++) if (Math.abs(zc - gaps[k].z) < GAP_HALF) { inGap = true; break; }
      if (!inGap) segs.push({ z: zc });
    }
    PLAN = { x: x, z0: z0, z1: z1, segs: segs, gaps: gaps };
    return PLAN;
  }

  // ---- the physical wall -------------------------------------------------
  const LIVE = { group: null, meshes: [], cols: [], posts: [], builtFor: null };
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || null; }
  function teardown() {
    if (LIVE.group && LIVE.group.parent) LIVE.group.parent.remove(LIVE.group);
    for (let i = 0; i < LIVE.cols.length; i++) {
      const k = CBZ.colliders ? CBZ.colliders.indexOf(LIVE.cols[i]) : -1;
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    LIVE.group = null; LIVE.meshes = []; LIVE.cols = []; LIVE.posts = []; LIVE.builtFor = null;
    if (CBZ.debris) CBZ.debris.clear("border-wall");     // a rebuild re-lays the breached rubble
  }
  function segMesh(i, seg) {
    const P = plan();
    const grp = LIVE.group;
    if (!grp || !P) return null;
    const hJit = 0.4 * (h01(Math.round(P.x), Math.round(seg.z), 0x77a1) - 0.5);
    const h = SEG_H + hJit;
    const floorY = CBZ.floorAt ? CBZ.floorAt(P.x, seg.z) : 0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(SEG_T, h, SEG_LEN - 0.4), cmat(0x9a8f7d));
    m.position.set(P.x, floorY + h / 2, seg.z);
    grp.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(SEG_T + 0.3, 0.35, SEG_LEN - 0.4), cmat(0x776c5c));
    cap.position.set(P.x, floorY + h + 0.17, seg.z);
    grp.add(cap);
    const col = { minX: P.x - SEG_T / 2, maxX: P.x + SEG_T / 2, minZ: seg.z - (SEG_LEN - 0.4) / 2, maxZ: seg.z + (SEG_LEN - 0.4) / 2, y0: floorY, y1: floorY + h, ref: m };
    CBZ.colliders.push(col);
    LIVE.cols.push(col);
    return { i: i, mesh: m, cap: cap, col: col, hp: SEG_HP, z: seg.z, floorY: floorY, h: h };
  }
  // a manned border post at a gap — checkpoints.js's crew grammar, third
  // consumer of the shared standing-post record.
  function manGap(k, gap) {
    const P = plan();
    if (!P || !CBZ.citySpawnCop) return null;
    const post = { k: k, z: gap.z, cops: [], barrier: null };
    const slots = [
      { x: P.x - 2.2, z: gap.z - 4.5 },
      { x: P.x + 2.2, z: gap.z + 4.5 },
    ];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const c = CBZ.citySpawnCop(s.x, s.z, false);
      if (!c) continue;
      if (c.pos && c.pos.set) c.pos.set(s.x, 0, s.z);
      if (c.group) c.group.position.set(s.x, 0, s.z);
      c._post = CBZ.cityPostStand
        ? CBZ.cityPostStand(c, { x: s.x, z: s.z, fx: i === 0 ? 1 : -1, fz: 0, relaxed: true, kind: "borderpost", org: "police", verb: "roadblock", tag: "police:borderpost", job: "border guard" })
        : { x: s.x, z: s.z, fx: i === 0 ? 1 : -1, fz: 0, mount: null, mountT: 0, relaxed: true };
      c._borderPost = true;
      post.cops.push(c);
    }
    if (LIVE.group) {
      const floorY = CBZ.floorAt ? CBZ.floorAt(P.x, gap.z) : 0;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, GAP_HALF * 2 - 4), cmat(0xd8452f));
      plank.position.set(P.x, floorY + 0.9, gap.z);
      LIVE.group.add(plank);
      post.barrier = plank;                     // visual only — the road stays passable, the POST watches it
    }
    LIVE.posts.push(post);
    return post;
  }
  // (re)build the physical wall to match `built` — used both by the daily
  // extension and by hydrate-after-load (physical presence re-materializes).
  function syncMeshes() {
    const S = st();
    const P = plan();
    const root = arenaRoot();
    if (!on() || !S.ordered || !P || !root) return;
    if (!LIVE.group || LIVE.builtFor !== root) {
      teardown();
      LIVE.group = new THREE.Group();
      root.add(LIVE.group);
      LIVE.builtFor = root;
    }
    for (let i = LIVE.meshes.length; i < S.built && i < P.segs.length; i++) {
      const rec = segMesh(i, P.segs[i]);
      if (rec) {
        LIVE.meshes.push(rec);
        if (S.breached[i]) applyBreach(rec);
      }
    }
    // man the gaps once the wall reaches them (a gap is "reached" when the
    // build count passes half the plan) — one post per gap, re-mannable.
    if (S.built >= Math.ceil(P.segs.length / 2)) {
      for (let k = 0; k < P.gaps.length; k++) {
        let have = null;
        for (let q = 0; q < LIVE.posts.length; q++) if (LIVE.posts[q].k === k) { have = LIVE.posts[q]; break; }
        if (!have) manGap(k, P.gaps[k]);
      }
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
  }
  function applyBreach(rec, blast) {
    // THE WALL BREAKS INTO ITS OWN CONCRETE. The top 70% of the section (and
    // its coping) is fractured by CBZ.debris out of the section's own
    // material: live, the pieces are thrown away from the charge; on a
    // reload the breach is already old, so the same material lies as a
    // settled heap at the stump. The stump (a third of the height) stays and
    // stops being a barrier. Mesh scale (never a dispose — batching law).
    if (CBZ.debris && rec.col && !rec.piled) {
      const c = rec.col, y0 = rec.floorY + rec.h * 0.3, y1 = rec.floorY + rec.h;
      const cx = (c.minX + c.maxX) / 2;
      if (blast) {
        const dx = cx - blast.x, dz = rec.z - blast.z, dl = Math.hypot(dx, dz) || 1;
        const at = { x: cx - dx / dl * 0.3, y: (y0 + y1) / 2, z: rec.z - dz / dl * 0.3 };
        CBZ.debris.shatterBox({ minX: c.minX, maxX: c.maxX, minY: y0, maxY: y1, minZ: c.minZ, maxZ: c.maxZ },
          rec.mesh.material, { kind: "concrete", at, dir: { x: dx / dl, y: 0.3, z: dz / dl }, power: 1.4, owner: "border-wall", solid: true });
        if (rec.cap && rec.cap.visible) CBZ.debris.shatter(rec.cap, { kind: "concrete", at, power: 1.2, maxPieces: 6, owner: "border-wall", hide: false });
      } else {
        CBZ.debris.pile({ permanent: true, x: cx, z: rec.z, y: rec.floorY, w: (c.maxX - c.minX) + 3, d: (c.maxZ - c.minZ) * 0.9, h: rec.h * 0.25,
          materials: [{ material: rec.mesh.material, kind: "concrete", weight: 3 }, { material: rec.cap ? rec.cap.material : rec.mesh.material, kind: "concrete", weight: 1 }],
          owner: "border-wall", solid: true });
      }
      rec.piled = true;
    }
    rec.mesh.scale.y = 0.3;
    rec.mesh.position.y = rec.floorY + (rec.h * 0.3) / 2;
    if (rec.cap) rec.cap.visible = false;
    const k = CBZ.colliders ? CBZ.colliders.indexOf(rec.col) : -1;
    if (k >= 0) CBZ.colliders.splice(k, 1);
    rec.hp = 0;
  }
  function repairSeg(rec) {
    // the crew hauls the rubble off before it pours the section again
    if (rec.piled && CBZ.debris) {
      if (CBZ.debris.clearNear) CBZ.debris.clearNear(rec.col ? (rec.col.minX + rec.col.maxX) / 2 : rec.mesh.position.x, rec.z, SEG_LEN * 0.55);
      rec.piled = false;
    }
    rec.mesh.scale.y = 1;
    rec.mesh.position.y = rec.floorY + rec.h / 2;
    if (rec.cap) rec.cap.visible = true;
    if (CBZ.colliders && CBZ.colliders.indexOf(rec.col) < 0) CBZ.colliders.push(rec.col);
    rec.hp = SEG_HP;
  }

  // ---- SABOTAGE — the explosion wrapper (marker law honoured) ------------
  let _blastWrapped = false;
  function wireBlast() {
    if (_blastWrapped) return;
    const orig = CBZ.cityExplosion;
    if (typeof orig !== "function" || orig._wallWrap) { _blastWrapped = !!(orig && orig._wallWrap); return; }
    _blastWrapped = true;
    const wrapped = function (x, y, z, radius) {
      try { wallBlast(+x || 0, +z || 0, +radius || 4); } catch (e) {}
      return orig.apply(this, arguments);
    };
    // COPY EVERY *Wrapped MARKER FORWARD (doctrine's explosion-wrapper law):
    // demolition.js and friends stamp flags on the current top of the chain
    // and check them before re-wrapping — losing one grows the chain.
    for (const k in orig) { try { wrapped[k] = orig[k]; } catch (e) {} }
    wrapped._wallWrap = true;
    CBZ.cityExplosion = wrapped;
  }
  function wallBlast(x, z, radius) {
    const S = st();
    if (!on() || !S.ordered || !LIVE.meshes.length) return;
    const P = plan();
    if (!P || Math.abs(x - P.x) > radius + SEG_T) return;
    const reach = radius + 4;
    for (let i = 0; i < LIVE.meshes.length; i++) {
      const rec = LIVE.meshes[i];
      if (!rec || rec.hp <= 0) continue;
      if (Math.abs(rec.z - z) > reach) continue;
      rec.hp -= 1;
      if (rec.hp <= 0) {
        S.breached[rec.i] = 1;
        applyBreach(rec, { x: x, z: z });
        if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
        news("A section of the border wall is blown open in the Saltlands.");
      }
    }
  }

  // ---- the order + the daily crews ---------------------------------------
  function seatRec() {
    const S = st();
    if (!S.seatId || !CBZ.polity || !CBZ.polity.get) return null;
    return CBZ.polity.get(S.seatId);
  }
  function order(rec) {
    if (!on()) return { ok: false, why: "Construction is switched off." };
    const S = st();
    if (S.ordered) return { ok: false, why: "Already ordered." };
    const P = plan();
    if (!P || !P.segs.length) return { ok: false, why: "No frontier to build on, the Saltlands never registered." };
    if (!rec || !rec.id) return { ok: false, why: "No treasury to pay the crews from." };
    if ((rec.treasury || 0) < SEG_COST * SEGS_PER_DAY) return { ok: false, why: "The treasury cannot cover even the first day of crews." };
    S.ordered = true; S.seatId = rec.id; S.built = 0; S.breached = {}; S.spentTotal = 0;
    // day one's sections go up the moment the pen lifts — visible commitment
    extend(rec);
    return { ok: true, total: P.segs.length };
  }
  function extend(rec) {
    const S = st();
    const P = plan();
    if (!S.ordered || !P) return;
    rec = rec || seatRec();
    if (!rec) return;
    let budgetSegs = SEGS_PER_DAY;
    // 1. repairs first — a standing wall beats a longer broken one
    for (let i = 0; i < LIVE.meshes.length && budgetSegs > 0; i++) {
      const m = LIVE.meshes[i];
      if (!m || m.hp > 0 || !S.breached[m.i]) continue;
      if ((rec.treasury || 0) < SEG_COST) break;
      rec.treasury -= SEG_COST; S.spentTotal += SEG_COST;
      delete S.breached[m.i];
      repairSeg(m);
      budgetSegs--;
    }
    // 2. extension
    while (budgetSegs > 0 && S.built < P.segs.length) {
      if ((rec.treasury || 0) < SEG_COST) {
        if (S.paidStallDay !== day()) {
          S.paidStallDay = day();
          news("Wall construction stalls, the treasury cannot cover the crews.");
        }
        break;
      }
      rec.treasury -= SEG_COST; S.spentTotal += SEG_COST;
      S.built++; budgetSegs--;
    }
    syncMeshes();
    if (S.built >= P.segs.length && !S.doneAnnounced) {
      S.doneAnnounced = true;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE WALL STANDS");
      news("The Saltlands border wall is complete · " + P.segs.length + " sections, " + P.gaps.length + " manned crossing(s).");
    }
  }
  // re-man a post whose officers died — next day, small treasury cost
  function remanPosts(rec) {
    const S = st();
    const P = plan();
    if (!S.ordered || !P || !rec) return;
    for (let q = 0; q < LIVE.posts.length; q++) {
      const post = LIVE.posts[q];
      let alive = 0;
      for (let i = 0; i < post.cops.length; i++) if (post.cops[i] && !post.cops[i].dead) alive++;
      if (alive > 0) continue;
      if ((rec.treasury || 0) < REPOST_COST) continue;
      rec.treasury -= REPOST_COST; S.spentTotal += REPOST_COST;
      post.cops = [];
      LIVE.posts.splice(q, 1); q--;
      manGap(post.k, { z: post.z });
    }
  }

  // ---- reads -------------------------------------------------------------
  function mannedGapCount() {
    let n = 0;
    for (let q = 0; q < LIVE.posts.length; q++) {
      const post = LIVE.posts[q];
      for (let i = 0; i < post.cops.length; i++) if (post.cops[i] && !post.cops[i].dead) { n++; break; }
    }
    return n;
  }
  function status() {
    const S = st();
    const P = plan();
    const total = P ? P.segs.length : 0;
    const breaches = Object.keys(S.breached || {}).length;
    const gaps = P ? P.gaps.length : 0;
    const manned = mannedGapCount();
    return {
      ordered: !!S.ordered, built: S.built | 0, total: total, breaches: breaches,
      gaps: gaps, mannedPosts: manned, manned: gaps === 0 ? true : manned >= gaps,
      done: !!S.ordered && total > 0 && (S.built | 0) >= total,
      spent: S.spentTotal | 0,
    };
  }
  // THE NUMBER THE CELL'S SUPPLY TICK READS. Standing fraction x manned
  // fraction — a wall with open gaps or dead sentries leaks.
  function coverage() {
    const S = st();
    const P = plan();
    if (!on() || !S.ordered || !P || !P.segs.length) return 0;
    const standing = Math.max(0, (S.built | 0) - Object.keys(S.breached || {}).length);
    const wallFrac = standing / P.segs.length;
    const gapFrac = P.gaps.length ? (mannedGapCount() / P.gaps.length) : 1;
    return Math.max(0, Math.min(1, wallFrac * (0.35 + 0.65 * gapFrac)));
  }

  // ---- ticks + persistence ----------------------------------------------
  if (CBZ.onNewDay) CBZ.onNewDay(function () {
    if (!on()) return;
    const S = st();
    if (!S.ordered) return;
    const rec = seatRec();
    try { extend(rec); } catch (e) {}
    try { remanPosts(rec); } catch (e) {}
  });
  let syncT = 0;
  // 38.79 — free by grep (38.74 is govcomplex's, 38.76 cashstore, 38.8 empire).
  if (CBZ.onUpdate) CBZ.onUpdate(38.79, function (dt) {
    if (!on() || !g || g.mode !== "city") return;
    wireBlast();
    syncT -= dt;
    if (syncT > 0) return;
    syncT = 3.0;
    const S = st();
    if (S.ordered && (!LIVE.group || LIVE.builtFor !== arenaRoot() || LIVE.meshes.length < Math.min(S.built, 9999))) syncMeshes();
  });

  function serialize() {
    const S = st();
    return { v: 1, ordered: !!S.ordered, seatId: S.seatId || null, built: S.built | 0, breached: Object.assign({}, S.breached || {}), spentTotal: S.spentTotal | 0, doneAnnounced: !!S.doneAnnounced };
  }
  function apply(obj) {
    g.stateWall = fresh();
    if (!obj || obj.v !== 1) return;
    const S = st();
    S.ordered = !!obj.ordered; S.seatId = obj.seatId || null;
    S.built = obj.built | 0; S.breached = Object.assign({}, obj.breached || {});
    S.spentTotal = obj.spentTotal | 0; S.doneAnnounced = !!obj.doneAnnounced;
  }
  function stamp() { const led = g.cityWorld; if (led && typeof led === "object") led.wall = serialize(); }
  let _wrapsDone = false;
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    _wrapsDone = true;
    const c = CBZ.cityWorldCommit;
    if (typeof c === "function" && !c._wallSaveWrap) {
      const w = function () { stamp(); return c.apply(this, arguments); };
      w._wallSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._wallSaveWrap) {
      const w2 = function () { stamp(); return cc.apply(this, arguments); };
      w2._wallSaveWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  let _hydrated = null;
  function hydrate() {
    const led = g.cityWorld;
    if (!led || led === _hydrated) return;
    _hydrated = led;
    if (led.wall) { apply(led.wall); PLAN = null; teardown(); }
  }
  // 46.28 — free by grep (46.19 is migration.js's; 46.27 is presidency's).
  if (CBZ.onUpdate) CBZ.onUpdate(46.28, function () {
    if (!g) return;
    ensureSaveWraps();
    hydrate();
  });

  CBZ.stateWall = {
    order: order, status: status, coverage: coverage,
    serialize: serialize, apply: apply,
    reset: function () { teardown(); PLAN = null; g.stateWall = fresh(); },
    // harness/test hooks only
    _plan: plan, _extend: extend, _blast: wallBlast, _live: LIVE, _st: st,
  };
  CBZ.stateWallReset = CBZ.stateWall.reset;
})();
