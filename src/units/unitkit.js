/* ============================================================
   units/unitkit.js — THE ONE UNIT REGISTRY. Every kind of thing that can
   fight: an animal species, a military vehicle, and (as a row with no file)
   men. One registry for all of them, not one per kind.

   WHY. ~50 agents redraw and re-animate NPC War's animals and vehicles at
   the same time. Each one owns ONE file, src/units/<kind>/<id>.js, that
   registers its unit here. Nothing else in the battle names a species: the
   battle asks this kit for the body, the animation, the fight and the
   numbers, and falls back to what the game already has (the bestiary's
   low-poly build, the shared gait rig, creature_combat's strike driver)
   until a unit file overrides it.

   THE FILE A UNIT AGENT OWNS (species):
     CBZ.unitKit.register("bengal_tiger", {
       kind: "species",
       stats: { hp, spd, danger, bite, scale,              // what it IS
                chase, march, dmg, rate, brave, prey },    // how NPC War fights it
       build(ctx)          -> THREE.Group   feet at y=0, nose +X, metres
                               ctx = { THREE, mat, rng, seed, id }
       animate(unit, dt)   -> per-frame pose (gait, breathing, tail, jaw)
       fight(unit, tgt, dt, opts) -> the close fight; opts carries the
                               battle's seams (move, onHit, reach, rate, dmg)
     });
   (vehicle) the same call with kind: "vehicle" and
       stats  { hp, mass, speed, armour: {front, side, rear, top} (mm RHA) }
       crew   [{ seat: "driver"|"gunner"|"commander"|"loader", pos:[x,y,z] }]
       weapons[{ id, seat, kind: "cannon"|"mg"|"rockets"|"missile", ... }]
       build(ctx) -> { group, turret, gun, hatches, wheels|tracks }
       drive(unit, dt, ctrl)  ctrl = { throttle, steer, brake }
       aim(unit, dt, tx, ty, tz)  turret + gun laying
       fight(unit, tgt, dt, opts) which weapon, when
   Every hook is optional. A missing hook means "the shared default".

   PUBLIC
     CBZ.unitKit.register(id, def)   one unit file = one call
     CBZ.unitKit.get(id)             the registered def (or null)
     CBZ.unitKit.has(id) / ids(kind?)
     CBZ.unitKit.kindOf(id)          "men" | "species" | "vehicle" | null
     CBZ.unitKit.meta(id)            the manifest row (name, plural, group noun)
     CBZ.unitKit.label(id, n)        "40 gorillas", "1 Bengal tiger", "3 M1 Abrams"
     CBZ.unitKit.groupNoun(id, n)    "troop" / "pride" / "company" / null
     CBZ.unitKit.build(id, ctx)      the unit file's build, else the bestiary's
     CBZ.unitKit.stat(id, key, d)    the unit file's number, else the bestiary row's
     CBZ.unitKit.need(ids) -> Promise   loads the unit files a roster needs
     CBZ.speciesKit / CBZ.vehicleKit thin views (register with the kind preset)

   Loaded in node by tools/npcwar-check.mjs (no THREE needed at load).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  if (CBZ.unitKit) return;

  const REG = Object.create(null);
  const KINDS = { species: 1, vehicle: 1 };

  function manifest() { return CBZ.UNIT_MANIFEST || {}; }
  function bestiary() { return CBZ.WILDLIFE_SPECIES || {}; }

  function register(id, def) {
    if (!id || !def) throw new Error("unitKit.register(id, def)");
    const kind = def.kind || (manifest()[id] && manifest()[id].kind) || "species";
    if (!KINDS[kind]) throw new Error("unitKit: unknown kind " + kind + " for " + id);
    REG[id] = Object.assign({ id: id }, def, { kind: kind });
    // ONE TRUTH PER ANIMAL: the species' own numbers are written back onto
    // its bestiary row, so creature_combat, the wildlife rig and the battle
    // all read the same hp / speed / danger / bite / scale
    if (kind === "species" && def.stats) {
      const row = bestiary()[id];
      if (row) for (let i = 0; i < ROW_KEYS.length; i++) {
        const k = ROW_KEYS[i];
        if (def.stats[k] != null) row[k] = def.stats[k];
      }
    }
    return REG[id];
  }
  const ROW_KEYS = ["hp", "spd", "danger", "bite", "scale"];
  // a unit's number: its file's stats, else its bestiary row
  function stat(id, key, dflt) {
    const d = REG[id];
    if (d && d.stats && d.stats[key] != null) return d.stats[key];
    const row = bestiary()[id];
    if (row && row[key] != null) return row[key];
    return dflt;
  }
  function get(id) { return REG[id] || null; }
  function has(id) { return !!REG[id]; }
  function ids(kind) {
    return Object.keys(REG).filter(function (k) { return !kind || REG[k].kind === kind; });
  }
  function kindOf(id) {
    if (id === "men") return "men";
    if (REG[id]) return REG[id].kind;
    const m = manifest()[id];
    if (m) return m.kind;
    return bestiary()[id] ? "species" : null;
  }
  function meta(id) {
    const m = manifest()[id];
    if (m) return m;
    const sp = bestiary()[id];
    if (sp) { const nm = String(sp.name || id).toLowerCase(); return { kind: "species", name: nm, plural: nm + "s" }; }
    return { kind: null, name: String(id).replace(/_/g, " "), plural: String(id).replace(/_/g, " ") };
  }
  /* "40 gorillas", "1 Bengal tiger", "200 men", "3 M1 Abrams". A number and
     the real name of the thing. Never a made-up army name. */
  function label(id, n) {
    n = n == null ? 1 : n;
    const m = meta(id);
    return n + " " + (n === 1 ? m.name : m.plural);
  }
  /* The real collective noun, ONLY where one exists (a pride of lions, a pod
     of orcas). For men it follows the size of the unit: a platoon is ~30-50,
     a company ~80-250, a battalion ~300-1000, a brigade more. */
  function groupNoun(id, n) {
    const m = meta(id);
    if (typeof m.group === "function") return m.group(n);
    return m.group || null;
  }
  function build(id, ctx) {
    const d = REG[id];
    if (d && typeof d.build === "function") return d.build(ctx);
    const sp = bestiary()[id];
    if (sp && typeof sp.build === "function") return sp.build(ctx);
    return null;
  }

  /* LAZY LOAD. A roster names the units it needs; their files load at START,
     not with the page, so a men-only war never pays for fifty animals and a
     dozen tanks. Files live at <studio root>units/<kind>/<id>.js. A unit
     with no file (or a file that fails) keeps the shared defaults. */
  const loading = Object.create(null);
  const scripts = Object.create(null);
  /* Unit files ride THIS file's ?v= key (the way studio packs ride
     studio.js's): bump units/unitkit.js's key on the page and every unit file
     re-fetches. No per-unit key, so fifty agents never edit one shared line. */
  const BUST = (function () {
    try {
      const s = typeof document !== "undefined" && document.currentScript;
      const q = s && s.src && /[?&]v=([^&#]+)/.exec(s.src);
      return q ? "?v=" + q[1] : "";
    } catch (e) { return ""; }
  })();
  function fileOf(id) {
    const k = kindOf(id);
    if (k !== "species" && k !== "vehicle") return null;
    if (!manifest()[id]) return null;             // only manifest units have files
    return "units/" + (k === "species" ? "species" : "vehicles") + "/" + id + ".js";
  }
  function loadOne(id) {
    if (REG[id]) return Promise.resolve();
    if (loading[id]) return loading[id];
    const rel = fileOf(id);
    if (!rel || typeof document === "undefined") return Promise.resolve();
    const root = (CBZ.studio && CBZ.studio.root) || "../src/";
    const extra = (manifest()[id] && manifest()[id].needs) || [];
    loading[id] = Promise.all(extra.map(loadScript)).then(function () { return loadScript(rel); });
    // one tag per path, however many units need it (five hulls share mil_armor)
    function loadScript(r) {
      if (scripts[r]) return scripts[r];
      // an engine file the host page already carries (the city loads
      // dogmodel.js itself) is not loaded twice
      const tags = typeof document !== "undefined" && document.scripts;
      if (tags && r.indexOf("units/") !== 0) {
        for (let i = 0; i < tags.length; i++) {
          const src = String(tags[i].src || "");
          if (src.indexOf("/" + r) >= 0) return (scripts[r] = Promise.resolve());
        }
      }
      return (scripts[r] = new Promise(function (resolve) {
        const s = document.createElement("script");
        s.src = root + r + BUST;
        s.async = false;
        if (s.dataset) s.dataset.unit = id;          // tools/npcwar-headless.mjs runs these for real
        s.onload = function () { resolve(); };
        s.onerror = function () { console.warn("[units] no file for", r); resolve(); };
        document.head.appendChild(s);
      }));
    }
    return loading[id];
  }
  function need(list) {
    const seen = {};
    const want = (list || []).filter(function (id) {
      if (!id || id === "men" || seen[id]) return false;
      seen[id] = 1; return true;
    });
    return Promise.all(want.map(loadOne));
  }

  CBZ.unitKit = {
    register: register, get: get, has: has, ids: ids, kindOf: kindOf, meta: meta,
    label: label, groupNoun: groupNoun, build: build, need: need, fileOf: fileOf, stat: stat,
  };
  function view(kind) {
    return {
      register: function (id, def) { return register(id, Object.assign({}, def, { kind: kind })); },
      get: function (id) { const d = REG[id]; return d && d.kind === kind ? d : null; },
      ids: function () { return ids(kind); },
    };
  }
  CBZ.speciesKit = view("species");
  CBZ.vehicleKit = view("vehicle");
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.unitKit;
})();
