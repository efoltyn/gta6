/* ============================================================
   core/prisonlazy.js — THE PRISON IS BUILT THE FIRST TIME IT IS NEEDED.

   The whole of Prison Escape used to be built while index.html parsed: some
   thirty script tags each raised their part of the compound into
   CBZ.prisonRoot as a side effect of being loaded. A Gang City player (the
   default mode) paid ~1.2 s of script evaluation and carried ~13k objects,
   ~2k materials and ~3.7k geometries of a prison they never saw.

   Now every prison-building script hands its build to
       CBZ.definePrison("<file>", function () { ...the old top level... });
   and nothing is built until CBZ.ensurePrison() runs — when a mode that shows
   the prison is entered (systems/state.js setMode, the gun game's JAIL map)
   or when the page STARTS on one (main.js, before the title card, so the
   title still shows the live prison).

   THE BAR IS "BUILT EXACTLY AS IF IT WERE STILL PARSE TIME". A builder that
   runs half a minute later, after every other script and maybe after the
   whole city, would otherwise see a different world than the one it was
   written against. So each queued builder is run inside a replay of the
   moment its script tag was parsed:

     1. CBZ / CBZ.CONFIG / CBZ.game KEYS. A key that did not exist when the
        builder was defined is hidden while it runs, and a key whose value
        changed since is shown at its old value. `if (CBZ.propRegisterSeat)`
        takes the branch it took at parse time; a CONFIG default written by a
        later script is not seen early; g.mode reads what it read at parse.
        Whatever the builder itself writes is kept (and is never time-
        travelled for the builders after it: the prison's own keys are the
        prison's). Everything else is put back the moment it returns.

     2. SHARED ARRAYS (CBZ.colliders, npcs, platforms, losBlockers,
        _prisonPromptSites, ... every array hanging off CBZ, plus
        prisonRoot.children and scene.children). While a builder runs, each
        array shows only what it held at that builder's parse point (plus
        what earlier prison builders added); items added later — by later
        scripts or by the running game, e.g. the city's 123k collider boxes
        — are lifted off and put back AFTER the builder's own. So a collider
        scan inside a builder sees the same boxes it always did, and every
        list ends up in exactly the order the parse-time build produced
        (gang membership reads CBZ.npcs.indexOf; physics resolves colliders
        in array order).

     3. FRAME WORK. CBZ.onUpdate/onAlways stamp a registration sequence
        (config.js); a builder's registrations take its parse-time sequence,
        and core/loop.js slots them into the frame lists exactly where the
        load-time sort would have put them — at the top of the next frame,
        never in the middle of one.

   Separate script tags each failed alone; so does each builder here.

   Nothing to turn off: lazy is the only behaviour. CBZ.prisonBuildReport()
   says what ran, how long it took and anything the replay had to resolve.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const queue = [];
  let built = false, building = false, wanted = false;
  const report = { built: false, ms: 0, builders: [], conflicts: [], errors: [] };

  // ---- key snapshots ------------------------------------------------------
  // An accessor (CBZ.WORLD_SEED is one) is kept as its descriptor, wrapped so
  // it can never be mistaken for a value, and is never invoked or flattened.
  function Acc(d) { this.d = d; }
  function readOwn(o, k) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d) return undefined;
    return ("value" in d) ? d.value : new Acc(d);
  }
  function same(a, b) {
    if (a === b) return true;
    return a instanceof Acc && b instanceof Acc && a.d.get === b.d.get && a.d.set === b.d.set;
  }
  function writeOwn(o, k, v) {
    if (v instanceof Acc) { Object.defineProperty(o, k, v.d); return; }
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (d && !("value" in d)) Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
    else o[k] = v;
  }
  function snapMap(o) {
    const m = new Map();
    if (!o) return m;
    const keys = Object.getOwnPropertyNames(o);
    for (let i = 0; i < keys.length; i++) m.set(keys[i], readOwn(o, keys[i]));
    return m;
  }
  function arrayLens(o) {
    const m = new Map();
    const keys = Object.getOwnPropertyNames(o);
    for (let i = 0; i < keys.length; i++) {
      const d = Object.getOwnPropertyDescriptor(o, keys[i]);
      if (d && Array.isArray(d.value)) m.set(keys[i], [d.value, d.value.length]);
    }
    return m;
  }
  function appendAll(dst, src) {
    for (let i = 0; i < src.length; i += 8192) Array.prototype.push.apply(dst, src.slice(i, i + 8192));
  }

  // The frame lists are ordered by registration sequence instead (loop.js).
  const NOT_BUSES = { updaters: 1, always: 1 };

  /* EAGER UNLESS THE PAGE STARTS IN GANG CITY. config.js has already read the
     start mode (?mode=, a page's START_MODE, the menu's remembered game). A
     page that starts on the jail, the title or any other game builds each
     part right here, at its parse point, exactly as before laziness existed:
     the replay below is only ever used by a city-first page, which pays for
     the prison when an arrest (or the menu) first takes it there. */
  const EAGER = !(CBZ.game && CBZ.game.mode === "city") || /[?&]prison=eager\b/.test(location.search);
  CBZ.prisonLazy = !EAGER;
  CBZ.definePrison = function (name, fn) {
    if (EAGER) {
      const t0 = performance.now();
      try { fn(); } catch (e) { report.errors.push(name + ": " + (e && e.message)); console.error("[prison] " + name, e); }
      report.builders.push({ name: String(name), ms: +(performance.now() - t0).toFixed(2) });
      built = true; report.built = true;
      return;
    }
    if (built) console.error("[prison] builder defined after the prison was built:", name);
    queue.push({
      name: String(name), fn: fn,
      seq: CBZ.frameSeqMark ? CBZ.frameSeqMark() : 0,
      keys: [snapMap(CBZ), snapMap(CBZ.CONFIG), snapMap(CBZ.game)],
      arrays: arrayLens(CBZ),
      rootKids: CBZ.prisonRoot ? CBZ.prisonRoot.children.length : 0,
      sceneKids: CBZ.scene ? CBZ.scene.children.length : 0,
      gained: null,
    });
  };

  // Keys the prison's own builders created or changed during this build, per
  // object: never replayed for the builders after them.
  const owned = new Map();
  function ownedOf(o) { let s = owned.get(o); if (!s) owned.set(o, (s = new Set())); return s; }

  // Show an object as it was at the snapshot. Pushes (obj, key, current,
  // kind) to `undo`; kind 1 = hidden, 0 = replaced, 2 = shown again.
  function travel(o, then, undo) {
    if (!o) return;
    const own = ownedOf(o);
    const keys = Object.getOwnPropertyNames(o);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (own.has(k)) continue;
      const cur = readOwn(o, k);
      // An ARRAY is a shared bus (whichever script touched it first created
      // it); the bus replay below owns those, they are never hidden.
      if (Array.isArray(cur)) continue;
      if (!then.has(k)) { try { delete o[k]; undo.push(o, k, cur, 1); } catch (e) { /* non-configurable: stays visible */ } }
      else {
        const was = then.get(k);
        if (!same(was, cur)) { undo.push(o, k, cur, 0); writeOwn(o, k, was); }
      }
    }
    then.forEach(function (was, k) {
      if (own.has(k) || Object.prototype.hasOwnProperty.call(o, k)) return;
      undo.push(o, k, undefined, 2);
      writeOwn(o, k, was);
    });
  }

  // How many items each bus array has gained from prison builders so far.
  const inserted = new Map();

  function runOne(q) {
    const objs = [CBZ, CBZ.CONFIG, CBZ.game];
    // ---- 1. keys as they were at the builder's parse point ----
    const undo = [];
    for (let j = 0; j < 3; j++) travel(objs[j], q.keys[j], undo);
    // ---- 2. buses: lift off everything added after that point ----
    const buses = [], bases = [];
    const addBus = function (arr, base) { if (buses.indexOf(arr) < 0) { buses.push(arr); bases.push(base); } };
    const names = Object.getOwnPropertyNames(CBZ);
    for (let i = 0; i < names.length; i++) {
      const k = names[i];
      if (NOT_BUSES[k]) continue;
      const arr = readOwn(CBZ, k);
      if (!Array.isArray(arr) || !Object.isExtensible(arr)) continue;   // a frozen list is nobody's bus
      const def = q.arrays.get(k);
      addBus(arr, def && def[0] === arr ? def[1] : 0);
    }
    if (CBZ.prisonRoot) addBus(CBZ.prisonRoot.children, q.rootKids);
    if (CBZ.scene) addBus(CBZ.scene.children, q.sceneKids);
    const keep = [], lifted = [];
    for (let i = 0; i < buses.length; i++) {
      const arr = buses[i];
      const n = Math.min(arr.length, bases[i] + (inserted.get(arr) || 0));
      keep.push(n);
      lifted.push(arr.length > n ? arr.splice(n) : null);
    }
    // ---- 3. frame work takes the parse-time registration sequence ----
    CBZ._frameSeqBase = q.seq;
    CBZ._frameSeqSub = 0;
    const before = [snapMap(objs[0]), snapMap(objs[1]), snapMap(objs[2])];
    const t0 = performance.now();
    try { q.fn(); }
    catch (e) { report.errors.push(q.name + ": " + (e && e.message)); console.error("[prison] " + q.name + " threw while building", e); }
    const ms = performance.now() - t0;
    CBZ._frameSeqBase = null;
    // ---- buses: the builder's items stay where parse time put them ----
    const gained = new Map();
    for (let i = 0; i < buses.length; i++) {
      const arr = buses[i], got = arr.length - keep[i];
      if (got > 0) { inserted.set(arr, (inserted.get(arr) || 0) + got); gained.set(arr, got); }
      if (lifted[i] && lifted[i].length) appendAll(arr, lifted[i]);
    }
    q.gained = gained;
    // ---- keys: keep what the builder wrote, put the rest back ----
    const changed = objs.map(function (o, j) {
      const set = new Set();
      if (!o) return set;
      const b = before[j];
      const ks = Object.getOwnPropertyNames(o);
      for (let i = 0; i < ks.length; i++) if (!b.has(ks[i]) || !same(b.get(ks[i]), readOwn(o, ks[i]))) set.add(ks[i]);
      b.forEach(function (_, k) { if (!Object.prototype.hasOwnProperty.call(o, k)) set.add(k); });
      return set;
    });
    for (let i = undo.length - 4; i >= 0; i -= 4) {
      const o = undo[i], k = undo[i + 1], cur = undo[i + 2], kind = undo[i + 3];
      const j = objs.indexOf(o);
      if (changed[j].has(k)) {
        // The builder wrote a key that a LATER script (or the running game)
        // also wrote. At parse time that later write came second; it still
        // does. Named in the report so it can be checked by hand.
        report.conflicts.push(q.name + ": " + ["CBZ.", "CONFIG.", "game."][j] + k);
        changed[j].delete(k);
      }
      if (kind === 2) delete o[k];
      else writeOwn(o, k, cur);
    }
    for (let j = 0; j < 3; j++) if (objs[j]) changed[j].forEach(function (k) { ownedOf(objs[j]).add(k); });
    report.builders.push({ name: q.name, ms: +ms.toFixed(2) });
  }

  /* THE PAGE'S "load" EVENT, REPLAYED TOO. A builder that waits for `load`
     (world/clutter.js's seat anchors, when neither seat pipe exists yet) got
     that event after every script had parsed. Its listener is caught during
     the build and fired from here: at the real load event when the prison is
     built before it (this listener is registered ahead of every other script,
     so it fires first, as the builder's own did), or straight after the build
     when the page loaded long ago. */
  const loadQueue = [];
  let pageLoaded = document.readyState === "complete";
  function drainLoadQueue() {
    while (loadQueue.length) {
      const f = loadQueue.shift();
      try { if (typeof f === "function") f.call(window, new Event("load")); else if (f && f.handleEvent) f.handleEvent(new Event("load")); }
      catch (e) { report.errors.push("load listener: " + (e && e.message)); console.error("[prison] load listener", e); }
    }
  }
  if (!pageLoaded) addEventListener("load", function () { pageLoaded = true; drainLoadQueue(); }, { once: true });

  // One-shot hooks for systems that sized themselves off the prison at load
  // (entities/ambientstate.js): run after the build, before anyone plays.
  const afterHooks = [];
  CBZ.afterPrisonBuilt = function (fn) {
    if (built) { try { fn(); } catch (e) { console.error("[prison] after-build hook", e); } return; }
    afterHooks.push(fn);
  };

  // A parse-point mark: how long an array was at THIS point of the page parse,
  // counting the prison items that were built here before laziness existed.
  // Readers that sized something off a bus at load use it to see that bus as
  // it was (entities/ambientstate.js's spawn scan).
  CBZ.prisonParseMark = function () {
    return { builders: queue.length, arrays: arrayLens(CBZ) };
  };
  CBZ.prisonMarkLength = function (mark, key) {
    const arr = CBZ[key];
    if (!Array.isArray(arr)) return 0;
    const def = mark.arrays.get(key);
    let n = def && def[0] === arr ? def[1] : 0;
    for (let b = 0; b < mark.builders && b < queue.length; b++) n += (queue[b].gained && queue[b].gained.get(arr)) || 0;
    return Math.min(arr.length, n);
  };

  CBZ.prisonBuilt = function () { return built; };
  // Would entering mode `id` build the prison now? (the boot card's question)
  CBZ.prisonNeededBy = function (id) {
    if (built) return false;
    if (id === "escape") return true;
    return id === "gungame" && !!(CBZ.gungameWorlds && CBZ.gungameWorlds().jail);
  };
  CBZ.prisonWanted = function () { return wanted && !built; };

  CBZ.ensurePrison = function () {
    if (built || building) return built;
    if (!CBZ.bootComplete) { wanted = true; return false; }
    building = true;
    if (CBZ.bootStep) CBZ.bootStep("prison:build");
    const t0 = performance.now();
    const u0 = CBZ.updaters.length, a0 = CBZ.always.length;
    const winAdd = window.addEventListener;
    window.addEventListener = function (type, fn, opts) {
      if (type === "load") { loadQueue.push(fn); return; }
      return winAdd.call(this, type, fn, opts);
    };
    try {
      for (let i = 0; i < queue.length; i++) {
        runOne(queue[i]);
        queue[i].fn = null; queue[i].keys = null;     // the snapshots are done with
      }
    } finally { window.addEventListener = winAdd; }
    // New frame work leaves the lists now (a frame may be iterating them)
    // and is slotted in by core/loop.js at the top of the next frame.
    const newU = CBZ.updaters.splice(u0), newA = CBZ.always.splice(a0);
    if (CBZ.frameListsAdd) CBZ.frameListsAdd(newU, newA);
    else { appendAll(CBZ.updaters, newU); appendAll(CBZ.always, newA); }
    built = true; building = false; wanted = false;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.losGridDirty) CBZ.losGridDirty();
    if (pageLoaded) drainLoadQueue();
    for (let i = 0; i < afterHooks.length; i++) {
      try { afterHooks[i](); } catch (e) { report.errors.push("after-build: " + (e && e.message)); console.error("[prison] after-build hook", e); }
    }
    afterHooks.length = 0;
    report.built = true;
    report.ms = +(performance.now() - t0).toFixed(1);
    if (report.conflicts.length) console.warn("[prison] replay conflicts (later script wins):", report.conflicts.join(", "));
    return true;
  };

  CBZ.prisonBuildReport = function () {
    return { built: report.built, ms: report.ms, queued: queue.length, builders: report.builders.slice(), conflicts: report.conflicts.slice(), errors: report.errors.slice() };
  };
})();
