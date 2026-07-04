/* ============================================================
   systems/proptypes.js — THE PROP-TYPE REGISTRY.

   Every new pickup/prop used to mean editing 5-6 files: a bespoke
   mesh builder + hardcoded spawn call in entities/*, a dedicated
   if/for block wedged into systems/interactions.js's monolithic
   updateInteractions(), plus whatever save/reset code (systems/
   state.js) and HUD/economy hooks it needed. That pattern doesn't
   scale — it's why interactions.js grew into one 200-line function
   nobody wants to touch.

   This file is the paved road out: ONE registry, ONE updater.
   Adding a campfire (or a health pack, a lockpick, a loot crate...)
   from here on is:
     1. one CBZ.registerPropType({...}) call describing how to build
        it, animate it, and react to the player being near it;
     2. one CBZ.spawnProp(typeId, x, y, z, opts) call at the spawn site.
   No new updater, no new if-block in interactions.js, no bespoke
   array to remember to reset.

   Rhymes with city/interactions.js ("THE INTERACTION REGISTRY") on
   purpose — that one is the context-menu/verb registry for peds and
   cars; this one is the lifecycle registry for simple world objects
   (spawn → animate → proximity-react → despawn). Different shape,
   same house style: register a DEFINITION, let one shared tick own
   the loop.

   API:
     CBZ.registerPropType({
       id,                       // string type id, e.g. "coin"
       build(pos, opts) -> { mesh|group, radius?, data? }
                                  // construct the THREE object(s); pos is
                                  // a Vector3 (the spawn site). `data` is
                                  // a free-form bag the def can stash per-
                                  // instance state on (inst.data) — return
                                  // the SAME object a legacy array expects
                                  // if you need drop-in compatibility (see
                                  // entities/coins.js migrating CBZ.coins).
       onUpdate(dt, inst),        // per-frame animation (bob/spin/etc.)
       onInteract(player, inst) -> bool,
                                  // fired automatically when the player is
                                  // within interactRadius. Return true to
                                  // have the instance REMOVED (deferred
                                  // reap — see CBZ.removeProp); return
                                  // false/undefined to leave it alive (a
                                  // pickup that just flips a flag and
                                  // resets on respawn, e.g. coins, wants
                                  // false — it never truly disappears).
       interactRadius,            // planar (x,z) radius for the proximity
                                  // check that triggers onInteract; omit
                                  // to skip proximity handling entirely.
       modes,                     // optional ["escape","city","survival"]
                                  // — when set, instances of this type only
                                  // tick while CBZ.game.mode is in the list.
                                  // Omit to tick regardless of mode (this
                                  // is what the coin pickup did before the
                                  // migration, so it keeps that default).
       save(inst) -> obj,         // optional — reserved for a future
       load(obj) -> inst,         // persistence pass; not wired yet.
     })

     CBZ.spawnProp(typeId, x, y, z, opts) -> inst
       Builds via def.build, adds the returned mesh to CBZ.scene (or
       opts.parent), and returns inst = { id, typeId, pos, mesh, data,
       radius, alive:true }. Pushed into the flat instance list.

     CBZ.removeProp(inst)
       Marks the instance dead. The shared tick reaps (splices + disposes
       geometry/material) at the END of its pass — same deferred-reap
       idiom as city/vehicles.js's `_reap` flag — so nothing here ever
       mutates the instance list mid-iteration.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const defs = new Map();        // typeId -> def
  const instances = [];          // flat list of every live/pending instance
  let seq = 0;

  function registerPropType(def) {
    if (!def || !def.id) { console.warn("[proptypes] registerPropType needs an id"); return null; }
    defs.set(def.id, def);
    return def.id;
  }

  function spawnProp(typeId, x, y, z, opts) {
    const def = defs.get(typeId);
    if (!def) { console.warn("[proptypes] spawnProp: unknown type", typeId); return null; }
    opts = opts || {};
    const pos = new THREE.Vector3(x, y, z);
    const built = def.build(pos, opts) || {};
    const mesh = built.mesh || built.group || null;
    const parent = opts.parent || CBZ.scene;
    if (mesh && parent && !mesh.parent) parent.add(mesh);
    const inst = {
      id: "prop" + (++seq), typeId, pos, mesh,
      radius: built.radius, data: built.data || null,
      alive: true,
    };
    instances.push(inst);
    return inst;
  }

  function removeProp(inst) {
    if (inst) inst.alive = false;   // deferred — the tick below reaps it
  }

  // dispose a mesh tree's geometry/material (never touch anything cached
  // via world/materials.js's cmat(), which flags shared resources _shared —
  // same guard city/vehicles.js's explodeCar uses on wreck cleanup)
  function disposeMesh(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
  }

  function tick(dt) {
    const mode = g.mode;
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      if (!inst.alive) continue;
      const def = defs.get(inst.typeId);
      if (!def) continue;
      if (def.modes && def.modes.indexOf(mode) < 0) continue;

      if (def.onUpdate) def.onUpdate(dt, inst);

      if (def.onInteract && def.interactRadius != null && CBZ.player) {
        const dx = CBZ.player.pos.x - inst.pos.x, dz = CBZ.player.pos.z - inst.pos.z;
        if (dx * dx + dz * dz < def.interactRadius * def.interactRadius) {
          if (def.onInteract(CBZ.player, inst)) removeProp(inst);
        }
      }
    }
    // reap dead instances (splice from the tail so indices stay valid)
    for (let i = instances.length - 1; i >= 0; i--) {
      if (!instances[i].alive) { disposeMesh(instances[i].mesh); instances.splice(i, 1); }
    }
  }

  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.GAMEPLAY, 5) : 40.05, tick);

  CBZ.registerPropType = registerPropType;
  CBZ.spawnProp = spawnProp;
  CBZ.removeProp = removeProp;
  CBZ.propInstances = instances;   // read-only debug/inspection handle
})();
