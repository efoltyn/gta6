/* ============================================================
   city/army.js — ONE ARMY. Gang City's door to the battle core.

   Gang City does not grow its own soldiers, tanks or battle sim. NPC War's
   battle core (src/battle/core/*), its sim (src/battle/*.js, the FULL tier:
   men, vehicles, fire, squads, and the MID / FAR tiers) and its unit kit
   (src/units/*) run here on the city's ground and walls, through the same
   files games/battle.html runs (docs/npcwar/ARCHITECTURE.md §8, "Two hosts,
   one core"). The sim is compiled into a private scope (battle/core/realm.js)
   between the city's page layer (city/armypage.js) and its glue
   (city/armyrealm.js).

   NOTHING LOADS WITH THE CITY. This file is the only part on the page at
   boot (the API and a loader, a few KB). The unit files load when something
   asks for a unit (Fort Brandt's motor pool as you come near it, a force
   with hulls); the war engine (the core, the sim, the realm) loads the first
   time a force is spawned (a war's battle, a coup, martial law, the fort's
   alarm). A city nobody fights in pays for one small file.

   PUBLIC  CBZ.army
     spawnForce(spec) -> force          a handle at once; the bodies appear when
                                        the engine and the unit files are in
       spec = { side, nation, hostile, stars, units, training, gun, at: {x, z},
                heading, face: {x, z}, order, name, id }
         side      who it fights for: a nation id (city/flags.js / polwar), or
                   any belligerent key ("coup"); two belligerents per theatre
         hostile   to the player: "never" | "always" | "wanted" (stars >= `stars`)
         units     ["men*30", "m1_abrams*2"] or [{ id, n }], in spawn order
         training  civ | thug | pro | elite | swat (default elite)
         gun       a weapon id, or an issue list "carbine,carbine,lmg,..."
     orderForce(force, order)           order = { type, at: {x, z}, heading,
                                        face: {x, z}, route: [{x, z}...] }
         attack    march on `at` and fight what is there
         hold      stand on a formation round `at`
         move      go to that formation (fight back from it, do not chase)
         withdraw  fall back to `at`
         route     move along `route` (roads): handed to the registered
                   route driver (systems/convoy.js), else walked point to point
     disband(force)                     off the map
     status(force) -> { alive, dead, fled, routed, vehicles, x, z, order,
                        contact, arrived, ready }
     forces() / force(id)
     on(fn)                             fn(event): { type: "spawned" | "contact" |
                                        "destroyed" | "routed" | "arrived" |
                                        "route-done" | "war", force, data }
     routeDriver(fn)                    THE CONVOY SEAM: fn(force, order, api)
                                        -> driver { step(dt), stop() } | null.
                                        api = { move(at, o), hold(at), status(),
                                        units(), vehicles(), done() }
     loadUnits(ids) -> Promise          the unit kit + these units' files
     load() -> Promise                  the war engine (idempotent)
     ready                              the engine is up
     shot(a, dmg, hit, w) / blast(x, z, R, power, o)   the city's guns and
                                        blasts on the soldiers (fpsmode, crashfx)
     audit()
   CBZ.cityArmy                         the soldiers the city's guns can hit
   Every caller (the President, an AI nation, a coup, martial law, the fort)
   goes through spawnForce / orderForce: one path, the same for the AI and
   the player, ready for multiplayer orders.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  if (CBZ.army) return;

  /* ---------------------------------------------------------------- the loader
     Where this file came from is where src/ is ("src/" on index.html). */
  const ROOT = (function () {
    try {
      const s = typeof document !== "undefined" && document.currentScript;
      const a = s && s.getAttribute && s.getAttribute("src");
      const m = a && /^(.*\/)city\/army\.js/.exec(a);
      return m ? m[1] : "src/";
    } catch (e) { return "src/"; }
  })();
  // this file's ?v= key: every lazily loaded file rides it (bump army.js's key
  // on index.html and the whole engine re-fetches)
  const BUST = (function () {
    try {
      const s = typeof document !== "undefined" && document.currentScript;
      const q = s && s.src && /[?&]v=([^&#]+)/.exec(s.src);
      return q ? "?v=" + q[1] : "";
    } catch (e) { return ""; }
  })();
  function onPage(rel) {
    const tags = typeof document !== "undefined" && document.scripts;
    if (!tags) return false;
    for (let i = 0; i < tags.length; i++) if (String(tags[i].src || "").indexOf("/" + rel) >= 0) return true;
    return false;
  }
  /* THE IO: a <script> per page-free file (in order), the text of a realm file.
     A node tool swaps CBZ.army.io for the file system (tools/army-headless.mjs). */
  const scripts = Object.create(null);
  const texts = Object.create(null);
  const io = {
    script: function (rel) {
      if (scripts[rel]) return scripts[rel];
      if (typeof document === "undefined" || onPage(rel)) return (scripts[rel] = Promise.resolve(true));
      return (scripts[rel] = new Promise(function (resolve) {
        const s = document.createElement("script");
        s.src = ROOT + rel + BUST;
        s.async = false;
        s.onload = function () { resolve(true); };
        s.onerror = function () { console.warn("[army] could not load", rel); resolve(false); };
        document.head.appendChild(s);
      }));
    },
    text: function (rel) {
      if (texts[rel]) return texts[rel];
      return (texts[rel] = fetch(ROOT + rel + BUST).then(function (r) {
        if (!r.ok) throw new Error(rel + " " + r.status);
        return r.text();
      }));
    },
  };
  function scriptsInOrder(list) { return Promise.all(list.map(function (rel) { return A.io.script(rel); })); }

  /* THE UNIT KIT: the registry, the manifest, the shared vehicle maths. The
     unit files themselves come through CBZ.unitKit.need (their `needs` too). */
  const KIT = ["units/unitkit.js", "units/manifest.js", "units/kit/vehicle.js"];
  let kitP = null;
  function loadKit() { return kitP || (kitP = scriptsInOrder(KIT)); }
  function loadUnits(ids) {
    return loadKit().then(function () {
      const K = CBZ.unitKit;
      if (!K) return [];
      const want = (ids || []).filter(function (id) { return id && id !== "men" && !!K.fileOf(id); });
      return K.need(want).then(function () { return want.filter(function (id) { return K.has(id); }); });
    });
  }

  /* THE WAR ENGINE: the page-free core as scripts, then the sim compiled into
     its realm between the city's page layer and its glue. */
  const CORE = ["core/stage.js", "battle/core/roster.js", "battle/core/sides.js", "battle/core/host.js",
    "battle/core/store.js", "battle/core/lod.js", "battle/core/flow.js", "battle/core/tiersim.js",
    "battle/core/tactics.js", "battle/core/realm.js"];
  const PAGE = "city/armypage.js", GLUE = "city/armyrealm.js";
  let engineP = null, R = null;
  function load() {
    if (engineP) return engineP;
    engineP = loadKit().then(function () { return scriptsInOrder(CORE); }).then(function () {
      const RM = CBZ.battleRealm;
      if (!RM) throw new Error("battle/core/realm.js did not load");
      const names = [PAGE].concat(RM.SIM, [GLUE]);
      return Promise.all(names.map(function (rel) { return A.io.text(rel); })).then(function (codes) {
        const files = names.map(function (rel, i) { return { name: rel, code: codes[i] }; });
        const C = RM.compile(files, { name: "city-war" });
        if (!C.fn) {
          const m = C.err && /<anonymous>:(\d+)/.exec(String(C.err.stack || ""));
          throw new Error("the war realm did not compile: " + (C.err && C.err.message) + (m ? " at " + C.where(+m[1]) : ""));
        }
        A._where = C.where;
        R = RM.run(C, { seed: A.seed | 0, corpseMax: A.phone ? 70 : 140, capHint: A.phone ? 1024 : 4096 });
        if (!R) throw new Error("the war realm exported nothing");
        A.ready = true;
        A.realm = R;
        CBZ.cityArmy = R.list();
        hook();
        return R;
      });
    }).catch(function (e) {
      console.error("[army] the war engine failed:", e);
      engineP = null;
      throw e;
    });
    return engineP;
  }
  // the city's frame drives the war (only while the game is playing)
  let hooked = false;
  function hook() {
    if (hooked || !CBZ.onUpdate) return;
    hooked = true;
    CBZ.onUpdate(36.5, function (dt) { A.step(dt); });
  }

  /* ---------------------------------------------------------------- forces */
  const TRAIN = { civ: 1, thug: 1, pro: 1, elite: 1, swat: 1 };
  function rosterOf(units) {
    const parts = [];
    let gun = null;
    (units || []).forEach(function (u) {
      if (typeof u === "string") { if (u.trim()) parts.push(u.trim()); return; }
      if (!u || !u.id) return;
      parts.push(u.id + "*" + Math.max(1, u.n | 0 || 1));
      if (u.gun && !gun) gun = u.gun;
    });
    return { roster: parts.join(",") || "men*1", gun: gun };
  }
  function idsOf(roster) {
    return roster.split(",").map(function (p) { return p.split("*")[0].trim(); })
      .filter(function (id, i, a) { return id && id !== "men" && a.indexOf(id) === i; });
  }
  const handles = [];
  let seq = 0;
  function spawnForce(spec) {
    spec = spec || {};
    if (!spec.at || !isFinite(spec.at.x) || !isFinite(spec.at.z)) throw new Error("army.spawnForce: spec.at {x, z} is required");
    const ro = rosterOf(spec.units);
    const F = {
      id: spec.id || ("force" + (++seq)), side: String(spec.side || "army"), name: spec.name || null,
      roster: ro.roster, ready: false, gone: false, rf: null, pending: null, driver: null, route: null,
      spec: spec, events: [],
    };
    let heading = spec.heading;
    if (heading == null && spec.face) heading = Math.atan2(spec.face.x - spec.at.x, spec.face.z - spec.at.z);
    if (heading == null && spec.order && spec.order.at) heading = Math.atan2(spec.order.at.x - spec.at.x, spec.order.at.z - spec.at.z);
    F.heading = isFinite(heading) ? heading : 0;
    handles.push(F);
    F.promise = Promise.all([A.load(), A.loadUnits(idsOf(ro.roster))]).then(function () {
      if (F.gone) return F;
      const tier = TRAIN[spec.training] ? spec.training : "elite";
      const order = spec.order && spec.order.type !== "route" ? spec.order : null;
      F.rf = R.spawn({
        id: F.id, side: F.side, nation: spec.nation || F.side, hostile: spec.hostile || "never", stars: spec.stars,
        roster: ro.roster, tier: tier, gun: spec.gun || ro.gun || (tier === "thug" ? "ak47" : "carbine"),
        at: spec.at, heading: F.heading, order: order, name: F.name,
      });
      if (!F.rf) { console.warn("[army] no room for a third side:", F.side); F.gone = true; return F; }
      F.ready = true;
      emit({ type: "spawned", force: F.id, data: { side: F.side, n: F.rf.n } });
      if (spec.order && spec.order.type === "route") orderForce(F, spec.order);
      if (F.pending) { const o = F.pending; F.pending = null; orderForce(F, o); }
      return F;
    });
    F.promise.catch(function () {});
    return F;
  }
  function orderForce(F, o) {
    if (!F || F.gone || !o) return false;
    if (!F.ready) { F.pending = o; return true; }
    stopRoute(F);
    if (o.type === "route") return startRoute(F, o);
    return R.order(F.rf, o);
  }
  function disband(F) {
    if (!F || F.gone) return false;
    F.gone = true;
    stopRoute(F);
    if (F.rf) R.disband(F.rf);
    const k = handles.indexOf(F);
    if (k >= 0) handles.splice(k, 1);
    return true;
  }
  function status(F) {
    if (!F) return null;
    const f = F.rf;
    if (!f) return { ready: false, gone: F.gone, alive: 0, dead: 0, fled: 0, routed: 0, vehicles: 0 };
    return { ready: true, gone: F.gone, alive: f.alive, dead: f.dead, fled: f.fled, routed: f.routed, vehicles: f.vehicles,
      x: f.cx, z: f.cz, order: f.order ? f.order.type : null, at: f.order ? f.order.at : null,
      contact: f.contact, arrived: f.arrived, route: F.route ? { k: F.route.k, of: F.route.pts.length } : null };
  }

  /* ---------------------------------------------------------------- routes
     A "route" order is a road movement. THE CONVOY SEAM: a registered driver
     (systems/convoy.js, on the motorcade router) owns it and steers the force
     through api.move(); with no driver the force walks the route's points,
     the next one each time it arrives. */
  let routeDriverFn = null;
  function routeApi(F) {
    return {
      force: F,
      move: function (at, o) { o = o || {}; return R.order(F.rf, { type: o.type || "move", at: at, heading: o.heading, face: o.face }); },
      hold: function (at) { return R.order(F.rf, { type: "hold", at: at || { x: F.rf.cx, z: F.rf.cz } }); },
      status: function () { return status(F); },
      units: function () { return R.units(F.rf); },
      vehicles: function () { return R.units(F.rf).filter(function (u) { return u.vehicle && !u.dead; }); },
      done: function () { if (F.route) { F.route = null; emit({ type: "route-done", force: F.id }); } F.driver = null; },
    };
  }
  function startRoute(F, o) {
    const pts = (o.route || []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.z); });
    if (!pts.length) return false;
    F.route = { pts: pts, k: 0, order: o };
    if (routeDriverFn) {
      let d = null;
      try { d = routeDriverFn(F, o, routeApi(F)); } catch (e) { console.warn("[army] route driver threw", e); }
      if (d) { F.driver = d; return true; }
    }
    R.order(F.rf, { type: "move", at: pts[0] });
    return true;
  }
  function stopRoute(F) {
    if (F.driver && F.driver.stop) { try { F.driver.stop(); } catch (e) {} }
    F.driver = null; F.route = null;
  }
  function stepRoutes(dt) {
    for (let i = 0; i < handles.length; i++) {
      const F = handles[i];
      if (!F.ready || F.gone || !F.route) continue;
      if (F.driver) { if (F.driver.step) { try { F.driver.step(dt); } catch (e) { console.warn("[army] route driver", e); stopRoute(F); } } continue; }
      if (!F.rf.arrived) continue;
      const Rt = F.route;
      Rt.k++;
      if (Rt.k >= Rt.pts.length) { F.route = null; emit({ type: "route-done", force: F.id }); continue; }
      R.order(F.rf, { type: "move", at: Rt.pts[Rt.k] });
    }
  }

  /* ---------------------------------------------------------------- the bus */
  const listeners = [];
  function emit(e) {
    for (let i = 0; i < listeners.length; i++) { try { listeners[i](e); } catch (err) { console.warn("[army] listener", err); } }
  }

  const A = {
    ROOT: ROOT, ready: false, realm: null, seed: 0, io: io,
    phone: !!(typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0) && Math.min(W.innerWidth || 9999, W.innerHeight || 9999) < 900),
    load: load, loadKit: loadKit, loadUnits: loadUnits,
    spawnForce: spawnForce, orderForce: orderForce, disband: disband, status: status,
    forces: function () { return handles.slice(); },
    force: function (id) { for (let i = 0; i < handles.length; i++) if (handles[i].id === id) return handles[i]; return null; },
    on: function (fn) { if (typeof fn === "function") listeners.push(fn); return function () { const k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); }; },
    routeDriver: function (fn) { routeDriverFn = typeof fn === "function" ? fn : null; },
    // the war's frame (city: CBZ.onUpdate; a node tool calls it by hand)
    step: function (dt) {
      if (!R) return;
      R.frame(dt);
      stepRoutes(dt);
      const ev = R.events();
      for (let i = 0; i < ev.length; i++) emit(ev[i]);
    },
    shot: function (a, dmg, hit, w) { return R ? R.shot(a, dmg, hit, w) : null; },
    blast: function (x, z, R0, power, o) { return R ? R.blast(x, z, R0, power, o) : 0; },
    audit: function () { return R ? R.audit() : { open: false, ready: A.ready }; },
    _emit: emit,
  };
  CBZ.army = A;
})();
