/* ============================================================
   city/metro_promote.js — A METRO BUILDING THAT GETS HIT BECOMES A REAL ONE.

   OWNER (2026-10-20), on "metro buildings only get the fireball": "that
   sounds kind of stupid." Kingsbridge, Kingsport and Karvel are drawn as
   merged per-tile meshes (city/metro_fabric.js): one geometry for 800 m of
   city, no building in it is a thing the structural ledger, the collapse
   system or the fire automaton can hold. So a building that takes a real
   hit is PROMOTED, lazily and one at a time:

     1. BUILD (frame 1). A real shell from its plan record — footprint,
        storeys, storey height, wall colour, and the facade grammar its
        metro style corresponds to — through the same builder every Gang
        City lot uses (CBZ.cityMakeBuilding), so it has walls, slabs, glass,
        doors, colliders and everything city/collapse.js knows how to cut.
        It is kept out of the shell registry (metro.js BUILT would give it a
        second far copy).
     2. SWAP (frame 2). Its triangles are cut out of the merged near and far
        tile meshes (metro_fabric.js cutBuilding: draw groups round its run
        of the index buffer, no GPU buffer edited), its tile colliders come
        out, the facade cells that dressed it rebuild without it, and its
        lot joins the structural ledger's lot set (structural.js
        S.extraLots), so every blast, fire spread and load-path check finds
        it the way it finds a downtown lot.
     3. DAMAGE (the same frame). Whatever hit it is replayed against the
        real building: the ordnance bus's priced structural hit (the same
        amount, penetration and severed width CBZ.detonate computed) and
        the carve through CBZ.collapse.damage. The cut into chunks, the
        fracture and the fall are collapse.js's own, sliced over frames.

   WHAT TRIGGERS IT. Two doors, both shared:
     * any CBZ.detonate big enough to matter structurally (a structural
       amount of 6+ or a charge of 15 kg+: a car bomb, an airstrike, an
       aircraft) whose point lies inside a metro building and on no city lot;
     * city/aircraftimpact.js's building strike on a metro record
       (CBZ.metroPromote.request), which adds its own carve, fire and
       casualties when the shell is ready.

   WHAT IT COSTS. One shell build in one frame (the same builder the city
   runs per lot at boot), one swap the next. Never two promotions in one
   frame. At most MAX_LIVE promoted buildings stand at once; past that the
   oldest UNDAMAGED one is restored first.

   RESTORE. The promoted shell goes and the merged copy comes back when:
   its tile streams out (the camera is past DROP_D), the run resets
   (cityGlassReset), or the world is rebuilt (a new arena root).

   UNSUPPORTED SHAPES. A building on a diagonal (the shell builder is
   axis-aligned), a stadium bowl, a tank or a silo, or one standing off the
   lot level, is not rebuilt as a shell: it is cut out and comes down as
   pieces of its own box through CBZ.debris, with the dust. It is still
   destroyed; it simply has no floors to burn.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.metroPromote) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.METRO_PROMOTE == null) CFG.METRO_PROMOTE = true;

  const MAX_LIVE = 6;
  const DROP_D = 2700;             // metro.js DROP_R (2600) + slack: the tile is gone by then
  const MP = (CBZ.metroPromote = {});
  const live = [];                 // promoted entries
  const queue = [];                // pending entries
  const byB = new Map();           // plan building -> entry
  let rootRef = null;
  const stats = { promoted: 0, restored: 0, shattered: 0, failed: 0, replays: 0 };

  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function arenaRoot() { const a = CBZ.city && CBZ.city.arena; return a ? a.root : null; }
  function planOf(id) {
    for (const M of CBZ.metroCities || []) if (M && M.id === id) return M;
    const C = CBZ.metroCountryside;
    return C && C.id === id ? C : null;
  }
  function indexOf(P, b) {
    if (b && b.id != null && P.bldgs[b.id] === b) return b.id;
    return P.bldgs.indexOf(b);
  }

  // metro style -> the facade grammar a Gang City shell wears for it
  const STYLE = { glass: "intl", deco: "artdeco", concrete: "brutalist", brick: "brick", row: "brick",
                  stone: "stone", civic: "stone", house: "brickhouse", strip: null, metal: null };
  const NO_SHELL = { stadium: 1, tank: 1, silo: 1, pavilion: 1, clocktower: 1 };
  function dressFor(b, storeys) {
    const id = STYLE[b.style];
    if (!id || !CBZ.facadeDef) return false;
    const def = CBZ.facadeDef(id);
    if (!def || storeys < (def.minStoreys || 0) || storeys > (def.maxStoreys || Infinity)) return false;
    return { style: id };
  }
  // axis-aligned footprint, or null if the building stands on a diagonal
  function axisFoot(b) {
    const r = +b.rot || 0;
    const q = Math.round(r / (Math.PI / 2));
    if (Math.abs(r - q * Math.PI / 2) > 0.05) return null;
    return (Math.abs(q) % 2) ? { w: b.d, d: b.w } : { w: b.w, d: b.d };
  }

  /* ---- the request ------------------------------------------------------ */
  // rec: a city/airspace.js record (src "metro") or { city, b }.
  // cb(lot, entry): called once the real building stands (lot null when the
  // building was shattered instead). Returns the entry, or null.
  MP.request = function (rec, cb) {
    if (!CFG.METRO_PROMOTE || !rec || !rec.b || !inCity()) return null;
    let e = byB.get(rec.b);
    if (e) {
      if (e.state === "live") { if (cb) { try { cb(e.lot, e); } catch (err) {} } }
      else if (cb && e.state !== "dead") e.cbs.push(cb);
      return e;
    }
    const M = planOf(rec.city);
    if (!M || !M.plan) return null;
    const i = indexOf(M.plan, rec.b);
    if (i < 0) return null;
    e = { M: M, P: M.plan, i: i, b: rec.b, rec: rec, state: "queued", cbs: cb ? [cb] : [], lot: null, built: null, t: 0, damaged: false };
    byB.set(rec.b, e);
    queue.push(e);
    return e;
  };
  MP.lotOf = function (b) { const e = b && byB.get(b); return e && e.state === "live" ? e.lot : null; };
  // the metro building a point is inside of (pad metres of slack)
  const _at = [];
  MP.at = function (x, y, z, pad) {
    const AS = CBZ.airspace;
    if (!AS || !AS.recordsAt) return null;
    const list = AS.recordsAt(x, y, z, pad || 0, _at);
    let best = null, bv = Infinity;
    for (const r of list) {
      if (r.src !== "metro") continue;
      const v = r.hw * r.hd;
      if (v < bv) { bv = v; best = r; }                     // the innermost
    }
    return best;
  };

  /* ---- 1. build ---------------------------------------------------------- */
  function build(e) {
    const b = e.b, root = arenaRoot();
    if (!root || !CBZ.cityMakeBuilding) return false;
    const foot = axisFoot(b);
    if (!foot || NO_SHELL[b.type] || Math.abs(+b.y || 0) > 0.6 || !(b.h > 3)) return false;
    const fh = b.fh > 2.4 && b.fh < 8 ? +b.fh : 3.2;
    const storeys = Math.max(1, b.st > 0 ? Math.round(b.st) : Math.round(b.h / fh));
    const side = b.face === "n" ? 0 : b.face === "s" ? 1 : 1;
    const opts = { fh: fh, dress: dressFor(b, storeys) };
    if (b.shop || b.type === "strip" || b.type === "mall") { opts.retail = true; }
    if (b.type === "office" || b.type === "tower") opts.office = true;
    const shells = root.userData && root.userData.shells;
    const n0 = shells ? shells.length : 0;
    let built = null;
    try { built = CBZ.cityMakeBuilding(root, b.x, b.z, foot.w, foot.d, storeys, b.wall != null ? b.wall : 0x8b8f94, side, opts); }
    catch (err) { try { console.error("[metro promote] build", err); } catch (e2) {} built = null; }
    // out of the shell registry: metro.js BUILT would give it a far copy
    if (shells && shells.length > n0) shells.splice(n0, shells.length - n0);
    if (!built || !built.group) return false;
    built.metroPromoted = true;
    e.built = built;
    return true;
  }

  /* ---- 2. swap ----------------------------------------------------------- */
  function swap(e) {
    const MF = CBZ.metroFabric;
    if (MF && MF.cutBuilding) { try { MF.cutBuilding(e.P, e.i, true); } catch (err) {} }
    if (e.built) {
      const b = e.built;
      e.lot = { cx: b.ox, cz: b.oz, w: b.w, d: b.d, building: b, kind: "metro", metro: e.M.id, metroIndex: e.i };
      const S = CBZ.structure;
      if (S && S.extraLots) S.extraLots.push(e.lot);
      stats.promoted++;
    } else {
      shatter(e);
      stats.shattered++;
    }
    e.state = "live";
    live.push(e);
    const cbs = e.cbs; e.cbs = [];
    for (const cb of cbs) { try { cb(e.lot, e); } catch (err) {} }
  }

  // the building has no shell form: its own box, in its own colour, as pieces
  function shatter(e) {
    const b = e.b;
    if (!CBZ.debris || !CBZ.debris.shatterBox) return;
    const gy = 0.16 + (+b.y || 0);
    const r = +b.rot || 0, ac = Math.abs(Math.cos(r)), as = Math.abs(Math.sin(r));
    const ex = b.w / 2 * ac + b.d / 2 * as, ez = b.w / 2 * as + b.d / 2 * ac;
    let mat = null;
    try { mat = CBZ.cmat ? CBZ.cmat(b.wall != null ? b.wall : 0x8b8f94) : new THREE.MeshLambertMaterial({ color: b.wall || 0x8b8f94 }); } catch (err) { return; }
    try {
      CBZ.debris.shatterBox({ minX: b.x - ex, maxX: b.x + ex, minY: gy, maxY: gy + b.h, minZ: b.z - ez, maxZ: b.z + ez }, mat, {
        at: e.hitAt || { x: b.x, y: gy + b.h * 0.5, z: b.z }, power: 1.6, maxPieces: CBZ.qScale ? Math.round(CBZ.qScale(10, 28)) : 18,
        owner: "metro:" + e.M.id + ":" + e.i, solid: true,
      });
    } catch (err) {}
    if (CBZ.cityDustKick) { try { CBZ.cityDustKick(b.x, gy + 2, b.z, 3); } catch (err) {} }
  }

  /* ---- restore ----------------------------------------------------------- */
  function teardown(b) {
    if (!b) return;
    try { if (CBZ.collapse && CBZ.collapse.forget) CBZ.collapse.forget(b); } catch (err) {}
    const cols = new Set(), plats = new Set(), los = new Set();
    for (const gp of b.windows || []) {
      if (!gp.shattered) { gp.shattered = true; if (gp.mesh) gp.mesh.visible = false; else if (CBZ._paneShow) { try { CBZ._paneShow(gp, false); } catch (err) {} } }
      if (gp.col) cols.add(gp.col);
    }
    for (const c of b.colliders || []) cols.add(c);
    for (const p of b.platforms || []) plats.add(p);
    for (const m of b.losMeshes || []) los.add(m);
    for (const dr of b.doors || []) { dr.demolished = true; if (dr.col) cols.add(dr.col); dr.colIn = false; }
    if (CBZ.structuralTakeOut) CBZ.structuralTakeOut(cols, plats, los);
    else if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(cols);
    if (CBZ.stairs && CBZ.stairs.setOwnerActive) { try { CBZ.stairs.setOwnerActive(b, false); } catch (err) {} }
    if (CBZ.batchHideGroup) { try { CBZ.batchHideGroup(b.group); } catch (err) {} }
    const g = b.group;
    if (g) {
      if (g.parent) g.parent.remove(g);
      g.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (err) {} }
      });
    }
  }
  function restore(e) {
    if (e.state === "dead") return;
    const S = CBZ.structure, D = CBZ.cityDemolition;
    if (e.lot) {
      // the rubble and the rebuild calendar let go of it first
      try { if (D && D.has && D.has(e.lot) && D.rebuildAt) D.rebuildAt({ x: e.lot.cx, z: e.lot.cz }); } catch (err) {}
      try { if (S && S.forgetLot) S.forgetLot(e.lot); } catch (err) {}
      if (S && S.extraLots) { const k = S.extraLots.indexOf(e.lot); if (k >= 0) S.extraLots.splice(k, 1); }
      e.lot.demolished = true;                          // anything still holding it lets go
    }
    teardown(e.built);
    if (CBZ.debris && CBZ.debris.clear) { try { CBZ.debris.clear("metro:" + e.M.id + ":" + e.i); } catch (err) {} }
    const MF = CBZ.metroFabric;
    if (MF && MF.cutBuilding && e.P) { try { MF.cutBuilding(e.P, e.i, false); } catch (err) {} }
    e.state = "dead";
    byB.delete(e.b);
    const k = live.indexOf(e); if (k >= 0) live.splice(k, 1);
    stats.restored++;
  }
  MP.restore = restore;
  MP.restoreAll = function () {
    while (queue.length) { const e = queue.pop(); e.state = "dead"; byB.delete(e.b); }
    for (let i = live.length - 1; i >= 0; i--) restore(live[i]);
  };
  // a world rebuild: the old shells went with the old root; only the plans'
  // cut sets and the ledger's lot list are left to clear
  function forgetWorld() {
    queue.length = 0;
    for (const e of live) {
      if (e.P && e.P.__cut) e.P.__cut.clear();
      const S = CBZ.structure;
      if (S && S.extraLots && e.lot) { const k = S.extraLots.indexOf(e.lot); if (k >= 0) S.extraLots.splice(k, 1); }
      e.state = "dead";
    }
    live.length = 0; byB.clear();
  }

  function isDamaged(e) {
    if (!e.lot) return true;
    const S = CBZ.structure;
    try { const st = S && S.state ? S.state(e.lot) : null; if (st && (st.dmg > 0 || st.stage > 0)) return true; } catch (err) {}
    return !!(CBZ.collapse && CBZ.collapse.isFractured && CBZ.collapse.isFractured(e.built));
  }

  /* ---- the replay: the hit that triggered it, against the real building -- */
  function replay(lot, x, y, z, kind, opts, price) {
    const S = CBZ.structure;
    if (!lot || !S) return;
    stats.replays++;
    const row = CBZ.impact && CBZ.impact.row ? CBZ.impact.row(kind) : null;
    const o = {
      kind: kind, fire: row ? row.fire : 0, pen: price.pen, sudden: true,
      dirx: opts.dirx, dirz: opts.dirz, by: opts.by, byPlayer: opts.byPlayer, lot: lot,
    };
    if (price.severWidth > 0) o.severWidth = price.severWidth;
    try {
      if (row && row.charge > 0 && price.charge > 0 && S.charge) S.charge(x, y, z, price.charge, o);
      else if (price.amount > 0 && S.hit) S.hit(x, y, z, price.amount, o);
    } catch (err) {}
    // an aircraft carves its own cut (city/aircraftimpact.js); anything else
    // carves here, with its energy in collapse.js's megajoules
    if (!opts._airImpact && CBZ.collapse && CBZ.collapse.damage) {
      const E = price.E > 0 ? price.E / 1e6 : price.charge * 4.184;
      const R = Math.max(3, Math.min(14, (price.fireball || 6) * 0.4));
      const d = Math.hypot(opts.dirx || 0, opts.dirz || 0);
      try { CBZ.collapse.damage(lot.building, { x: x, y: y, z: z }, R, E, d > 1e-3 ? { x: opts.dirx / d, y: 0, z: opts.dirz / d } : null); } catch (err) {}
    }
  }

  // THE SHARED DOOR: every detonation. Anything big that lands inside a
  // metro building on no city lot promotes that building and is replayed
  // against it.
  function onDetonate(x, y, z, kind, opts) {
    if (!CFG.METRO_PROMOTE || !inCity() || (opts && (opts.noDamage || opts._metroReplay))) return;
    if (!CBZ.impact || !CBZ.impact.priceOf) return;
    opts = opts || {};
    const price = CBZ.impact.priceOf(kind, opts);
    if (!price || !(price.amount >= 6 || price.charge >= 15)) return;
    const S = CBZ.structure;
    if (opts.lot || (S && S.lotAt && S.lotAt(x, z, 2))) return;   // a real lot took it
    const r = MP.at(x, y, z, 2.5);
    if (!r) return;
    const e = MP.request(r, function (lot) { if (lot) replay(lot, x, y, z, kind, opts, price); });
    if (e && !e.hitAt) e.hitAt = { x: x, y: y, z: z };
  }
  function wrapDetonate() {
    const orig = CBZ.detonate;
    if (typeof orig !== "function" || orig._metroPromoteWrapped) return;
    const wrapped = function (x, y, z, kind, opts) {
      const r = orig.apply(this, arguments);
      try { onDetonate(x, y, z, kind, opts); } catch (err) {}
      return r;
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._metroPromoteWrapped = true;
    CBZ.detonate = wrapped;
  }
  function wrapReset() {
    const orig = CBZ.cityGlassReset;
    if (typeof orig !== "function" || orig._metroPromoteResetWrapped) return;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      try { MP.restoreAll(); } catch (err) {}
      return r;
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._metroPromoteResetWrapped = true;
    CBZ.cityGlassReset = wrapped;
  }

  /* ---- the tick: one stage of one promotion per frame ------------------- */
  if (CBZ.onUpdate) CBZ.onUpdate(41.6, function () {
    wrapDetonate(); wrapReset();
    const root = arenaRoot();
    if (root !== rootRef) { if (rootRef) forgetWorld(); rootRef = root; }
    if (!inCity() || (!queue.length && !live.length)) return;
    // stream-out: past the drop distance the merged copy is what is drawn
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam) for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      if (Math.hypot(e.b.x - cam.x, e.b.z - cam.z) > DROP_D) restore(e);
    }
    const e = queue[0];
    if (!e) return;
    if (e.state === "queued") {
      // room for one more: the oldest undamaged promotion goes back first
      if (live.length >= MAX_LIVE) {
        let k = -1;
        for (let i = 0; i < live.length; i++) if (!isDamaged(live[i])) { k = i; break; }
        if (k < 0) { queue.shift(); e.state = "dead"; byB.delete(e.b); stats.failed++; return; }
        restore(live[k]);
      }
      if (!build(e)) e.built = null;                  // shatter path
      e.state = "built";
      return;                                         // the swap is next frame
    }
    queue.shift();
    swap(e);
  });

  MP.list = function () { return live.slice(); };
  CBZ.metroPromoteAudit = function () {
    return {
      live: live.length, queued: queue.length, max: MAX_LIVE,
      promoted: stats.promoted, shattered: stats.shattered, restored: stats.restored, failed: stats.failed, replays: stats.replays,
      buildings: live.map(function (e) {
        return { city: e.M.id, i: e.i, type: e.b.type, storeys: e.built ? e.built.storeys : 0, shell: !!e.built,
                 x: Math.round(e.b.x), z: Math.round(e.b.z), damaged: isDamaged(e) };
      }),
    };
  };
})();
