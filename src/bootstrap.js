/* ============================================================
   src/bootstrap.js — O1 compat shim (BUILD-PLAN.md Stage O;
   MASTER-PLAN.md Part II.2 "OSS composability: Vite + compat shim +
   adapter convention").

   MODULE WORLD ONLY. This file is real ESM and only ever runs when the
   page is served through Vite (`npm run dev` / a `vite build` bundle) —
   see vite.config.js's `cbzLegacyBridge` plugin, which injects
   `<script type="module" src="/src/bootstrap.js"></script>` (dev) or the
   built equivalent (`/assets/bootstrap.js`, build) right before `</body>`
   IN MEMORY / IN THE BUILD OUTPUT ONLY. The index.html FILE ON DISK is
   never touched, so a dumb static server (`python3 -m http.server`) still
   serves the exact byte-identical legacy game and never loads this file —
   "legacy files untouched" holds for source AND for static-serve behavior.

   WHAT THIS IS THE BRIDGE FOR (read before writing an O2+ adapter):
   the legacy game is ~241 classic (non-module) `<script>` tags that build
   window.CBZ up across parse time and only finish booting when
   src/main.js (the LAST tag) calls CBZ.setState("title") + CBZ.startLoop().
   Because <script type="module"> tags default to defer semantics (execute
   after the document has finished parsing, i.e. after every earlier
   classic script already ran synchronously), placing this tag at the very
   end of <body> means by the time bootstrap.js executes, window.CBZ and
   window.THREE already exist AND the legacy boot has already reached
   "title". readyNow() below still polls defensively (rAF, capped) rather
   than assuming that ordering, since dev-server/HMR timing isn't something
   to bet a public contract on.

   THE CONTRACT — O2's grass adapter (and any future vendored three.js
   component) consumes exactly this surface:

     import { onCBZReady, registerModule, adoptScene } from "./bootstrap.js";

     onCBZReady(cb)
       cb() fires once (immediately if already ready) after window.CBZ +
       window.THREE exist and CBZ.game.state has reached "title" (i.e.
       core/loop.js is sorted and CBZ.startLoop() has been called).

     registerModule(name, initFn)
       Runs `initFn(adoptScene())` once, after onCBZReady. Wrapped in
       try/catch and logged with `name` on failure — same isolation
       contract as core/loop.js's per-updater try/catch (one broken OSS
       adapter must never take down the legacy game, and must never take
       down another adapter either).

     adoptScene()
       Returns a snapshot object:
         {
           scene, camera, renderer,   // the ACTUAL live CBZ.scene/camera/
                                       // renderer objects — not copies;
                                       // mutating them (e.g. scene.add(mesh))
                                       // affects the running game directly.
           THREE, CBZ,                // live references to the globals.
           onUpdate(order, fn),       // forwards to CBZ.onUpdate — join the
           onAlways(order, fn),       // SAME frame loop (core/loop.js) at a
                                       // normal PRIO band. Use CBZ.PRIO (see
                                       // core/prio.js) to pick one, e.g.
                                       // CBZ.PRIO.PRESENTATION for a visual-
                                       // only effect, and leave a one-line
                                       // comment saying why, per that file's
                                       // own convention.
           terrainHeight(x, z),       // forwards to CBZ.terrainHeight when
                                       // present (undefined otherwise) — the
                                       // exact query MASTER-PLAN's grass
                                       // worked example (Part II.2) uses.
         }
       Called fresh each time (cheap — just re-reads the current globals),
       so an adapter that self-defers (`onAlways(-1, tryBuild)` until
       `CBZ.scene && CBZ.terrainHeight` exist, per the grass worked example)
       can call adoptScene() again on a later tick and see live state.

   WHY window.THREE ISN'T TOUCHED HERE: MASTER-PLAN Part II.2 describes
   bootstrap.js eventually doing `import * as THREE from 'three'; window.THREE
   = THREE;` so legacy scripts (which read `THREE` as a global) find an
   npm-resolved three. BUILD-PLAN.md deliberately splits that into O3
   ("three.js upgrade with legacy-visual flags") — O1 keeps three
   CDN-vendored exactly as today (index.html:246-248) and this file only
   RE-EXPORTS whatever window.THREE the CDN script already produced. When
   O3 lands its own module-world THREE import earlier in the graph, this
   file's `THREE` export (a live getter, re-read on every adoptScene() call)
   keeps working with zero changes here.
============================================================ */

const _pending = [];
let _ready = false;
let _cbz = null;
let _three = null;

function _checkReady() {
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  // Any truthy state counts as ready: config seeds state:"title" and main.js
  // re-asserts it as the FIRST setState of the boot, so every later state
  // ("playing", ...) implies the world objects already exist. Requiring
  // strict === "title" here stranded integrations forever if the state
  // advanced (fast Play click) between rAF polls.
  return !!(CBZ && THREE && CBZ.scene && CBZ.camera && CBZ.renderer &&
    CBZ.onUpdate && CBZ.onAlways && CBZ.game && CBZ.game.state);
}

function _pump() {
  if (_ready) return;
  if (_checkReady()) {
    _ready = true;
    _cbz = window.CBZ;
    _three = window.THREE;
    for (const cb of _pending.splice(0)) _fire(cb);
    return;
  }
  requestAnimationFrame(_pump);
}

function _fire(cb) {
  try { cb(); }
  catch (err) { console.error("[bootstrap] onCBZReady callback failed", err); }
}

// Kick the poll off immediately (module scripts execute once, at load).
if (typeof window !== "undefined") {
  if (_checkReady()) {
    _ready = true;
    _cbz = window.CBZ;
    _three = window.THREE;
  } else {
    requestAnimationFrame(_pump);
  }
}

/** Fire cb() once window.CBZ/window.THREE are up and the legacy boot has
 *  reached "title" (immediately, if that has already happened). */
export function onCBZReady(cb) {
  if (typeof cb !== "function") return;
  if (_ready) { _fire(cb); return; }
  _pending.push(cb);
}

/** Live snapshot of the running game's THREE handles + loop-registration
 *  helpers. See file header for the full contract. */
export function adoptScene() {
  const CBZ = _cbz || window.CBZ;
  const THREE = _three || window.THREE;
  if (!CBZ) {
    throw new Error("[bootstrap] adoptScene() called before CBZ is ready — wrap the call in onCBZReady()/registerModule()");
  }
  return {
    scene: CBZ.scene,
    camera: CBZ.camera,
    renderer: CBZ.renderer,
    THREE,
    CBZ,
    onUpdate(order, fn) { return CBZ.onUpdate(order, fn); },
    onAlways(order, fn) { return CBZ.onAlways(order, fn); },
    terrainHeight(x, z) {
      return typeof CBZ.terrainHeight === "function" ? CBZ.terrainHeight(x, z) : undefined;
    },
  };
}

/** Register an OSS/vendored-component adapter: initFn(adoptScene()) runs
 *  once, after onCBZReady, isolated by try/catch (a throwing adapter is
 *  logged with `name` and can never crash the legacy game or another
 *  adapter). This is the O2+ entry point. */
export function registerModule(name, initFn) {
  if (typeof initFn !== "function") return;
  onCBZReady(() => {
    try {
      initFn(adoptScene());
    } catch (err) {
      console.error(`[bootstrap] module "${name}" failed to init`, err);
    }
  });
}

// Live getters so `import { CBZ, THREE } from "./bootstrap.js"` always sees
// the CURRENT window globals (not a value captured at import time — these
// modules load before the legacy boot finishes, so a plain destructured
// export would be `undefined` forever).
export const CBZ = new Proxy({}, {
  get(_t, prop) { return (window.CBZ || {})[prop]; },
  set(_t, prop, val) { (window.CBZ || (window.CBZ = {}))[prop] = val; return true; },
  has(_t, prop) { return prop in (window.CBZ || {}); },
});
export const THREE = new Proxy({}, {
  get(_t, prop) { return (window.THREE || {})[prop]; },
  has(_t, prop) { return prop in (window.THREE || {}); },
});

// Dev-only breadcrumb so it's obvious from the console that the module
// world is active (static serving never logs this — the file never loads).
if (typeof console !== "undefined") {
  console.log("[bootstrap] module world active (src/bootstrap.js loaded)");
}

// O2+: the module-world integrations registry (vendored/OSS adapters, e.g.
// src/integrations/grass.js). MUST be a DYNAMIC import, not a static one:
// integrations import { registerModule } etc. FROM this file, so a static
// `import "./integrations/index.js"` here would form a circular import
// graph — and because static imports are always fully evaluated BEFORE any
// of this module's OWN top-level statements run (regardless of where the
// import line sits in the file), that circle would try to read `_pending`/
// `_ready` above while they're still in their temporal dead zone
// ("Cannot access '_pending' before initialization"). A dynamic import()
// is its own microtask, scheduled AFTER this module's synchronous body
// (everything above, including the exports) has already finished — by the
// time integrations/grass.js's `import { registerModule } from
// "../bootstrap.js"` resolves, this file is fully initialized. See
// src/integrations/index.js's own header for why this only ever runs in
// the module world (never for a dumb static server).
import("./integrations/index.js").catch((err) => {
  console.error("[bootstrap] integrations registry failed to load", err);
});
