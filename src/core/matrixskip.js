/* ============================================================
   core/matrixskip.js — THE RENDER WALK: what three visits before it draws.

   Every renderer.render(scene) walks the graph before drawing a thing (three
   r187 WebGLRenderer.render): scene.updateMatrixWorld() visits every node,
   projectObject visits them again for frustum culling and the render lists,
   and a sun-map refresh walks them a third time. Each walk stops at an
   invisible node, but only AFTER calling into it. A hidden child still costs
   a visit in every walk of every frame.

   MEASURED (2026-11-22, phone profile: iPhone UA, 390x844 at 3x, CPU 4x,
   Gang City seed 90210, ~50k nodes; scene.updateMatrixWorld and the
   projection timed from inside renderer.render):
     - matrices are NOT recomposed for the static city. core/staticfreeze.js
       already set matrixAutoUpdate=false on it at build, and the scene root
       too, so nothing force-cascades. The cost is the VISIT, not the math.
     - of ~25k nodes a render walk touched, ~17.6k were hidden children of
       visible parents (batch-hidden wall originals, farcull's far groups,
       parked pools), 22.9k of the 24.3k hidden held by just 66 parents
       (23 of them hold 256+ each: a downtown tower keeps 2,800 children
       to draw 13).
     - the walks were ~30 ms of a ~59 ms render() on a contended box (median;
       9.5 ms matrices + 20 ms projection), ~14 of ~28 ms uncontended (p20).
     - part 2 on vs off, same session, 150 interleaved pairs: matrices 9.4
       -> 5.5 ms, projection 18.3 -> 16.5 ms, its own scan +2.5 ms; render()
       CPU 56.3 -> 52.9 ms (paired median saving 2.8 ms; a 100-pair rerun
       5.1 ms). Same render lists, calls and triangles on and off.
     - WHY NOT MORE: the scan still reads every hidden child once a render,
       so the cache miss each one costs moves from the walk to the scan and
       only the calls are saved. The rest needs the hidden originals OUT of
       the graph (core/batch.js keeps them as children only for code that
       traverses building groups; LOS raycasts use explicit blocker lists).

   PART 1 — hidden subtrees skip matrix math (MATRIX_SKIP_HIDDEN, below).
   PART 2 — the render walk does not visit them at all (STATIC_MATRIX_FREEZE,
   further down). Only part 2 changes what a frame visits; part 1 is what
   keeps a hidden node's matrices honest when it is shown again.
============================================================ */

/* ---- PART 1: SKIP WORLD-MATRIX MATH FOR HIDDEN SUBTREES -----------------
   Object3D.updateMatrixWorld walks EVERY node of the graph every frame —
   roughly half the scene is invisible at any moment (batch-hidden wall
   originals, parked FX pools, culled far-chunk contents, interior decor
   behind visibility toggles). three renders none of them (projectObject
   prunes invisible subtrees) but still pays full matrix recomposition for
   all of them. Measured 2026-08-03 (M1 Pro, seed 90210): updateMatrixWorld
   ≈ 1.1s of every 8s of play inside a 76ms-average render slice. The classic
   community patch (skip the subtree when !visible) was measured at ~50%
   matrix-cost reduction on desktop and 30→55fps on mobile in the three.js
   forum thread "UpdateMatrixWorld Performance"; upstream declined it because
   it changes semantics for code that reads matrixWorld of hidden objects.

   Why it is safe HERE:
   - Hidden-but-load-bearing meshes in this game (batch-hidden LOS walls,
     collider refs) are STATIC: their matrixWorld was computed while
     visible at build time and never changes, so skipping recomputation
     returns the same numbers.
   - getWorldPosition()/updateWorldMatrix() are NOT patched — direct
     callers always get fresh values regardless of visibility.
   - The one real hazard — parent moves while a child is hidden, child is
     shown later without the parent moving again — is handled explicitly:
     a skipped forced update marks the node, and the mark upgrades the
     next visible update to a forced one. No stale-forever case remains.
   - Anything that must keep updating while hidden can opt out with
     `obj._cbzMatrixAlways = true`.

   Flag: CBZ.CONFIG.MATRIX_SKIP_HIDDEN (default on;
   ?cfg_MATRIX_SKIP_HIDDEN=0 restores stock three behaviour at boot, and
   turns part 2 off with it: part 2 leans on part 1's stale marks).
------------------------------------------------------------------------- */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG.MATRIX_SKIP_HIDDEN == null) CBZ.CONFIG.MATRIX_SKIP_HIDDEN = true;
  if (!CBZ.CONFIG.MATRIX_SKIP_HIDDEN) return;

  const proto = THREE.Object3D.prototype;
  const orig = proto.updateMatrixWorld;
  proto.updateMatrixWorld = function (force) {
    /* MATRIX-AUTHORITY HANDOFF (entities/pedinstance.js): the instancing
       pass already composes fresh world matrices for every node of every
       city ped/cop rig each frame (that IS its job — the instance matrices
       are built from them), and then three's render walk was recomposing the
       same ~33k nodes again: measured at most of an 8ms updateMatrixWorld.
       A rig whose root carries THIS frame's ownership stamp is skipped
       whole. Self-healing by construction: the stamp only matches while
       pedinstance is live and stamping every tick — teardown resets the
       shared counter, a detached/cloned subtree loses the stamped root, a
       mode switch stops the stamping — and in every one of those cases the
       equality fails and stock behaviour resumes on the next frame. */
    if (this._cbzMatrixOwnedFrame !== undefined && this._cbzMatrixOwnedFrame === CBZ._matrixOwnStamp) return;
    if (this.visible === false && this._cbzMatrixAlways !== true) {
      // Parent's world matrix changed while we're hidden: remember, so the
      // first visible update recomposes even though our local flags are clean.
      if (force) this._cbzStaleWorld = true;
      return;
    }
    if (this._cbzStaleWorld === true) { this._cbzStaleWorld = false; force = true; }
    orig.call(this, force);
  };
})();

/* ---- PART 2: THE RENDER WALK ONLY SEES WHAT CAN BE DRAWN -----------------
   For the length of ONE renderer.render() call, a parent with many hidden
   children hands three a compact children array holding just its visible
   ones. The matrix pass, the projection pass and the sun-map pass all walk
   `children`, so none of them visits a hidden subtree at all. The real
   array is put back the moment render() returns; outside a render call
   nothing in the game ever sees the compact one.

   WHY EXACT, NOT A HEURISTIC:
   - The compact list is rebuilt from the live `visible` flags at the start
     of every render call (one flat read per child, ~2 ms per 26k children
     at CPU 4x, against the three calls per child it saves). Nothing is
     cached across frames except which parents are worth it, and NOT
     swapping is always correct, so that cache can only cost speed.
   - Everything three's walks skip for a hidden node they still skip:
     projection and the shadow pass never draw it; part 1 never recomputes
     its matrices. The one thing part 1 did for a hidden child that the
     compact walk no longer reaches — mark it stale when its parent's world
     matrix changed — is done here after the render: a swapped parent whose
     matrixWorld differs from the copy taken at swap time marks its hidden
     children exactly as a forced visit would have.
   - Part 1's `_cbzMatrixAlways` opt-out (no user anywhere today) is not
     read by the scan: reading a property most nodes lack, for every hidden
     child, cost as much as the read of `visible`. A hidden node that must
     keep its matrices fresh must not hang under a wide parent.
   - LOD nodes are never compacted: projectObject flips their levels'
     visibility mid-walk (LOD.update), after the list was built.
   - The render window is guarded. add/attach/remove/clear/copy/traverse/
     getObjectByProperty/getObjectsByProperty on a swapped parent, any
     raycast and any Box3.expandByObject put the real array(s) back first,
     so code that runs
     inside a render (onBeforeRender hooks, nested renders) can never edit
     or search the compact view. An array replaced or pushed to behind the
     API is reconciled on restore (children whose parent is still this one).
   - The swap is innermost (installed when core/renderer.js makes the
     renderer, before lightpin/carinstances/profile wrap it), so every
     visibility flip those wrappers make for a render is seen by the scan.
   - Nested renders pass straight through; they see the same compact view
     the outer render does, which is all of what any camera can draw.

   WHICH PARENTS: any node that reaches WIDE children, registered on add()
   (only once it hangs under a Scene: a subtree built detached is walked
   once when it is attached) plus one walk of the scene on the first
   render. Streamed blocks, re-attached parked blocks and rebuilt buildings
   are covered by the same add() path. A registered parent that no longer
   hangs under any Scene is dropped on the next render (no reference kept to
   unbuilt blocks). A parent under a hidden ancestor is not even scanned.

   SWITCH: CBZ.CONFIG.STATIC_MATRIX_FREEZE (default "phone": on for a phone,
   off on a desktop; 1 forces it on anywhere, false turns it off). `?cfg_STATIC_MATRIX_
   FREEZE=0` boots without it; setting it false at runtime takes effect on
   the next render call (nothing is swapped any more; the registry idles).
   CBZ.walkStats counts parents swapped, children dropped and scan time.
------------------------------------------------------------------------- */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const CFG = CBZ.CONFIG;
  if (CFG.STATIC_MATRIX_FREEZE == null) CFG.STATIC_MATRIX_FREEZE = "phone";

  const P = THREE.Object3D.prototype;
  const WIDE = 16;         // children before a parent is tracked at all
  const MIN_HIDDEN = 8;    // hidden children before a swap is worth doing
  const COLD = 30;         // renders a not-worth-it parent waits before a re-look

  const wide = [];         // registered parents
  const swapped = [];      // parents whose `children` is the compact list right now
  let swapping = false;    // inside a pruned render call
  let depth = 0, tick = 0;
  const seen = new WeakSet();   // scenes walked once for wide parents
  const stats = CBZ.walkStats = { parents: 0, swapped: 0, dropped: 0, kept: 0, scanMs: 0, renders: 0, reconciled: 0, guards: 0, staleMarks: 0 };

  // (a phone only: a desktop draws ~930 calls with time to spare and keeps
  // the stock walk. `?cfg_STATIC_MATRIX_FREEZE=1` forces it on anywhere.
  // A render that throws while the walk is pruned turns it off for the
  // session: `broken`, set by the wrapper below.)
  let broken = false;
  function on() {
    if (broken || CFG.STATIC_MATRIX_FREEZE === false || CFG.MATRIX_SKIP_HIDDEN === false) return false;
    return CFG.STATIC_MATRIX_FREEZE === true || CFG.STATIC_MATRIX_FREEZE === 1 || !!CBZ.isMobileDevice;
  }

  function underScene(o) {
    let a = o;
    while (a.parent !== null && a.parent !== undefined) a = a.parent;
    return a.isScene === true;
  }
  function register(o) {
    if (o._cbzWalk !== undefined || o.isLOD === true) return;
    const mw = new Float64Array(16), e = o.matrixWorld.elements;
    for (let k = 0; k < 16; k++) mw[k] = e[k];
    o._cbzWalk = { list: [], real: null, n: 0, cold: 0, last: tick, mw: mw };
    wide.push(o);
  }
  function discover(o) {
    const k = o.children;
    if (k.length >= WIDE) register(o);
    for (let i = 0; i < k.length; i++) if (k[i].children.length !== 0) discover(k[i]);
  }

  /* ---- restore -------------------------------------------------------- */
  function reconcile(p, real, cur) {
    stats.reconciled++;
    const had = new Set(real), keep = [];
    for (let i = 0; i < real.length; i++) if (real[i].parent === p) keep.push(real[i]);
    for (let i = 0; i < cur.length; i++) { const c = cur[i]; if (c.parent === p && !had.has(c)) keep.push(c); }
    real.length = 0;
    for (let i = 0; i < keep.length; i++) real.push(keep[i]);
  }
  function settle(p, w) {
    const real = w.real;
    w.real = null;
    const cur = p.children;
    if (cur !== w.list || cur.length !== w.n) reconcile(p, real, cur);
    p.children = real;
    // (the compact list is emptied in restoreAll, never here: a guard can fire
    // while a three walk is still iterating it)
    // part 1's stale mark, for the hidden children the compact walk skipped:
    // measured against the parent's world matrix as it stood when it was
    // last settled, so a change made between renders counts too
    const e = p.matrixWorld.elements, m = w.mw;
    let moved = false;
    for (let k = 0; k < 16; k++) if (e[k] !== m[k]) { moved = true; m[k] = e[k]; }
    if (moved) {
      for (let i = 0; i < real.length; i++) {
        const c = real[i];
        if (c.visible === false) { c._cbzStaleWorld = true; stats.staleMarks++; }
      }
    }
  }
  function unswap(p) {
    const w = p._cbzWalk;
    if (w === undefined || w.real === null) return;
    stats.guards++;
    settle(p, w);
  }
  function unswapAll() {
    for (let i = 0; i < swapped.length; i++) unswap(swapped[i]);
  }
  function restoreAll() {
    for (let i = 0; i < swapped.length; i++) {
      const p = swapped[i], w = p._cbzWalk;
      if (w === undefined) continue;
      if (w.real !== null) settle(p, w);
      w.list.length = 0;
    }
    swapped.length = 0;
  }

  /* ---- the per-render scan --------------------------------------------- */
  function prune(scene) {
    tick++;
    if (!seen.has(scene)) { seen.add(scene); discover(scene); }
    const t0 = performance.now();
    let dropped = 0, kept = 0;
    for (let i = wide.length - 1; i >= 0; i--) {
      const p = wide[i], w = p._cbzWalk;
      if (w === undefined) { wide[i] = wide[wide.length - 1]; wide.pop(); continue; }
      if (w.cold > tick) continue;
      // where does it hang, and can this render reach it?
      let a = p, reach = p.visible !== false;
      while (a.parent !== null && a.parent !== undefined) { a = a.parent; if (a.visible === false) reach = false; }
      if (a !== scene) {
        // hangs under no scene, or under another scene nobody has rendered
        // for a long while: forget it (the registry must not keep an unbuilt
        // block alive). A scene that comes back is walked again.
        if (a.isScene !== true || tick - w.last > 3000) {
          if (a.isScene === true) seen.delete(a);
          w.list.length = 0; p._cbzWalk = undefined;
          wide[i] = wide[wide.length - 1]; wide.pop();
        }
        continue;
      }
      w.last = tick;
      if (!reach) continue;
      const real = p.children, list = w.list;
      if (real.length < WIDE) { w.cold = tick + COLD; continue; }
      list.length = 0;
      for (let j = 0; j < real.length; j++) {
        const c = real[j];
        if (c.visible !== false) list.push(c);
      }
      const hid = real.length - list.length;
      if (hid < MIN_HIDDEN) { list.length = 0; w.cold = tick + COLD; continue; }
      w.real = real; w.n = list.length;
      p.children = list;
      swapped.push(p);
      dropped += hid; kept += list.length;
    }
    stats.parents = wide.length; stats.swapped = swapped.length;
    stats.dropped = dropped; stats.kept = kept;
    stats.scanMs += performance.now() - t0; stats.renders++;
  }

  /* ---- the render wrapper (installed by core/renderer.js) -------------- */
  CBZ.walkPruneInstall = function (R) {
    if (!R || R._cbzWalkPrune || typeof R.render !== "function") return;
    R._cbzWalkPrune = true;
    const render0 = R.render;
    R.render = function (scene) {
      if (depth !== 0 || !scene || scene.isObject3D !== true || !on()) {
        depth++;
        try { return render0.apply(this, arguments); } finally { depth--; }
      }
      depth++;
      try {
        try { prune(scene); } catch (err) { restoreAll(); console.error("[walkprune]", err); }
        swapping = swapped.length !== 0;
        try { return render0.apply(this, arguments); }
        catch (err) {
          if (!swapping) throw err;
          // A FRAME THAT THROWS WITH THE WALK PRUNED is drawn again whole:
          // every child back, the prune off for the rest of the session, and
          // the error kept on the console so the cause can be found.
          swapping = false; restoreAll(); broken = true;
          console.error("[walkprune] render threw with the walk pruned; off for this session", err);
          return render0.apply(this, arguments);
        }
      } finally {
        swapping = false;
        restoreAll();
        depth--;
      }
    };
  };

  /* ---- registration and the render-window guards ----------------------- */
  const add0 = P.add, attach0 = P.attach, remove0 = P.remove, clear0 = P.clear, copy0 = P.copy, trav0 = P.traverse;
  const gobp0 = P.getObjectByProperty, gosbp0 = P.getObjectsByProperty;
  P.add = function (object) {
    if (swapping) unswap(this);
    const was = arguments.length === 1 && object ? object.parent : null;
    const r = add0.apply(this, arguments);
    if (arguments.length === 1 && object && object.parent === this) {
      if (this._cbzWalk === undefined && this.children.length >= WIDE && underScene(this)) register(this);
      if (was !== this && object.children && object.children.length !== 0 && underScene(this)) discover(object);
    }
    return r;
  };
  // attach() pushes onto children itself (it does not go through add)
  if (attach0) P.attach = function (object) {
    if (swapping) unswap(this);
    const was = object ? object.parent : null;
    const r = attach0.apply(this, arguments);
    if (object && object.parent === this) {
      if (this._cbzWalk === undefined && this.children.length >= WIDE && underScene(this)) register(this);
      if (was !== this && object.children && object.children.length !== 0 && underScene(this)) discover(object);
    }
    return r;
  };
  P.remove = function () { if (swapping) unswap(this); return remove0.apply(this, arguments); };
  if (clear0) P.clear = function () { if (swapping) unswap(this); return clear0.apply(this, arguments); };
  P.copy = function (source) { if (swapping && source) unswap(source); return copy0.apply(this, arguments); };
  P.traverse = function (cb) { if (swapping && this._cbzWalk !== undefined) unswap(this); return trav0.call(this, cb); };
  if (gobp0) P.getObjectByProperty = function () { if (swapping && this._cbzWalk !== undefined) unswap(this); return gobp0.apply(this, arguments); };
  if (gosbp0) P.getObjectsByProperty = function () { if (swapping && this._cbzWalk !== undefined) unswap(this); return gosbp0.apply(this, arguments); };
  const RC = THREE.Raycaster && THREE.Raycaster.prototype;
  if (RC && RC.intersectObject) {
    const io = RC.intersectObject, ios = RC.intersectObjects;
    RC.intersectObject = function () { if (swapping) unswapAll(); return io.apply(this, arguments); };
    if (ios) RC.intersectObjects = function () { if (swapping) unswapAll(); return ios.apply(this, arguments); };
  }
  const B3 = THREE.Box3 && THREE.Box3.prototype;
  if (B3 && B3.expandByObject) {
    const ebo = B3.expandByObject;
    B3.expandByObject = function () { if (swapping) unswapAll(); return ebo.apply(this, arguments); };
  }
})();
