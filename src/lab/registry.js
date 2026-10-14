/* ============================================================
   lab/registry.js — the lab's two phone books: INGREDIENTS and KITS.

   An INGREDIENT is one real thing from the game, put in a lab world by name:
   a person (the shipped CBZ.human rig on CBZ.moves with a CBZ.brain), a chair
   (city/furniture.js drawn as a systems/pushables.js loose piece), a car, a
   building, a gun. It declares the game files/symbols it needs and a make()
   that builds it in the world and hands back a handle.

       CBZ.lab.ingredient("chair", {
         files: ["src/city/furniture.js"], symbols: ["pushables"],
         make: function (W, o) { ... return handle; }
       });

   A KIT is a scenario: which ingredients, where, and what happens when.

       CBZ.lab.kit("person-chair", {
         uses: ["person", "chair", "player"],
         params: { seed: 1 },              // defaults; any URL param overrides
         duration: 14,                     // sim seconds the default run covers
         setup: function (W, P) { ... },   // build it (W = the lab world)
         script: function (W, P) { return [[0, fn], [3.5, fn], ...]; },
         probe: function (W, P) { return { ok, summary, data }; },
       });

   Pure data + functions, no THREE, no DOM: tools/lab/deps.mjs evaluates the
   kit and ingredient files under plain node to resolve their script closure
   without a browser. Kits live in src/lab/kits/<name>.js and ingredients in
   src/lab/ingredients/<name>.js; the page and the tracer both load them by
   that path.
============================================================ */
(function (root) {
  "use strict";
  const CBZ = (root.CBZ = root.CBZ || {});
  const L = (CBZ.lab = CBZ.lab || {});
  if (L.registry) return;
  const ING = Object.create(null), KITS = Object.create(null);
  L.registry = { ingredients: ING, kits: KITS };
  L.ingredient = function (name, def) { def.name = name; ING[name] = def; return def; };
  L.kit = function (name, def) { def.name = name; KITS[name] = def; return def; };
  L.BASE_FILES = ["src/world/materials.js"];
  /* What core/microboot.js answers for REAL in the lab: the collider registry
     and its resolver (studio.js's `boot` pack says the same: "the physics core
     is in here ... shared consumers call CBZ.collide & co. and get one answer
     in both worlds", over the same CBZ.colliders array). A kit reading only
     these does not pull systems/physics.js (and with it player.js, input.js);
     a kit that wants the player's physics names physics.js and it wins, as it
     does in index.html. Everything else microboot defines is a fallback the
     real file replaces. */
  L.MICRO_PROVIDES = ["colliders", "collide", "collideSlide", "sweepCircle", "rayColliders", "queryCollidersNear",
    "colliderAdd", "colliderRemove", "colliderShrunk", "markCollidersDirty", "orientedCollider", "orientedSlack",
    "segmentHitsCollider", "platforms", "markPlatformsDirty", "micro", "shake"];
  L.kitFile = function (name) { return "src/lab/kits/" + name + ".js"; };
  L.ingredientFile = function (name) { return "src/lab/ingredients/" + name + ".js"; };

  /* every ingredient a kit uses, with the ones THEY use (an ingredient may
     say `uses: ["person"]`: a gunman is a person holding a gun) */
  L.ingredientsOf = function (kit) {
    const out = [], seen = Object.create(null);
    (function walk(list) {
      (list || []).forEach(function (n) {
        if (seen[n]) return;
        seen[n] = 1;
        const d = ING[n];
        if (d && d.uses) walk(d.uses);
        out.push(n);
      });
    })(kit.uses);
    return out;
  };

  /* what the tracer starts from for a kit + its params */
  L.entriesFor = function (name, params) {
    const k = KITS[name];
    if (!k) throw new Error("lab: no kit '" + name + "' (known: " + Object.keys(KITS).join(", ") + ")");
    const P = Object.assign({}, k.params || {}, params || {});
    let files = [], symbols = [], skip = [];
    function take(d) {
      const f = typeof d.files === "function" ? d.files(P) : d.files;
      const s = typeof d.symbols === "function" ? d.symbols(P) : d.symbols;
      files = files.concat(f || []); symbols = symbols.concat(s || []); skip = skip.concat(d.skip || []);
    }
    // THE LOOK IS ALWAYS REAL: world/materials.js is the engine's material
    // factory (cmat with vertex colours, PBR twins, addBox). microboot only
    // has a flat fallback that ignores those options (a pushables chair drew
    // pure white on it), so every kit gets the real one unless it says base:false.
    if (k.base !== false) take({ files: L.BASE_FILES });
    L.ingredientsOf(k).forEach(function (n) { if (!ING[n]) throw new Error("lab: kit '" + name + "' uses unknown ingredient '" + n + "'"); take(ING[n]); });
    take(k);
    return { files: Array.from(new Set(files)), symbols: Array.from(new Set(symbols)), skip: skip, depth: k.depth != null ? k.depth : 1, mode: k.mode || "lab", ingredients: L.ingredientsOf(k) };
  };
})(typeof window !== "undefined" ? window : globalThis);
