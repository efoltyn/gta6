/* ============================================================
   entities/decals.js — Ground decals (blood / scuff).

   Whenever a guard or inmate NEWLY goes down — knocked out (ko>0) or
   dead — we stamp a flat, dark-red splat on the floor where they fell.
   The splats are CircleGeometry planes laid flat (rotation.x = -PI/2),
   floating a hair above ground (y=0.03) to dodge z-fighting, each with
   a random scale + spin so no two read the same.

   It's pure grit: the splats PERSIST through the run so a busy yard
   slowly accumulates evidence of every brawl. To stay phone-friendly we
   POOL a hard cap of ~40 decals and recycle the oldest when full, and we
   fade the oldest ones down very slowly so the floor never turns into a
   solid sheet of red. Everything is wiped and the pool reset on a fresh
   run (detected by CBZ.game.elapsed dropping back toward zero).

   Cheap by design: a small fixed pool of meshes, no per-frame allocation
   in the hot loop, and a shared geometry. We only do real work on the
   frames where someone actually drops.

   Per-actor down-state is held in a WeakMap keyed by the actor object,
   so guards/inmates that get despawned mid-run (e.g. recalled
   reinforcements) don't leak references — no pruning needed.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // never throw at load: bail quietly if the engine or THREE isn't ready.
  if (!CBZ || !CBZ.scene || typeof CBZ.onAlways !== "function") return;
  if (typeof THREE === "undefined" || !THREE.CircleGeometry) return;

  const scene = CBZ.scene;

  // ---- tuning ----
  const CAP = 40;             // hard pool cap (oldest recycled when full)
  const Y = 0.03;             // float just above ground to avoid z-fight
  const FADE_START = 24;      // decals older than this (by recency rank) begin to fade
  const MIN_OP = 0.16;        // never fade fully out — keep a faint stain
  const MAX_OP = 0.82;        // freshest opacity

  // dark-red palette — a little variation per splat so it doesn't read flat
  const REDS = [0x4a0d0d, 0x5a1010, 0x6b1414, 0x3e0a0a, 0x551111];

  // one shared unit-radius circle; per-decal size comes from mesh.scale
  const GEO = new THREE.CircleGeometry(1, 14);

  // ---- pool ----
  // each entry: { mesh, born, op } ; mesh.visible=false when free
  const pool = [];
  let writeIdx = 0;   // next slot to (re)use — round-robins for oldest-first recycle
  let used = 0;       // how many slots are currently live

  function makeMesh() {
    const m = new THREE.Mesh(
      GEO,
      new THREE.MeshBasicMaterial({
        color: REDS[0],
        transparent: true,
        opacity: MAX_OP,
        depthWrite: false,           // flat overlay — don't fight other transparents
        polygonOffset: true,         // bias toward camera so it sits cleanly on the floor
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    m.rotation.x = -Math.PI / 2;     // lay flat on the ground plane
    m.position.y = Y;
    m.visible = false;
    m.renderOrder = -1;              // draw under most decals/sprites
    scene.add(m);
    return m;
  }

  // pre-warm the whole pool once (no churn during play)
  for (let i = 0; i < CAP; i++) pool.push({ mesh: makeMesh(), born: 0, op: MAX_OP });

  // ---- drop a splat at (x,z) ----
  function drop(x, z) {
    if (!isFinite(x) || !isFinite(z)) return;
    const slot = pool[writeIdx];
    writeIdx = (writeIdx + 1) % CAP;
    if (used < CAP) used++;

    const mesh = slot.mesh;
    // randomized look: scale, spin (around the now-vertical axis), tint
    const r = 0.55 + Math.random() * 0.85;        // splat radius ~0.55..1.4
    mesh.scale.set(r, r * (0.78 + Math.random() * 0.4), 1); // slight oval
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(x, Y + Math.random() * 0.004, z);     // tiny y jitter to layer overlaps
    mesh.material.color.setHex(REDS[(Math.random() * REDS.length) | 0]);
    slot.op = MAX_OP * (0.85 + Math.random() * 0.15);
    mesh.material.opacity = slot.op;
    mesh.visible = true;
    slot.born = CBZ.now;
  }

  // ---- per-actor previous down-state, keyed by the actor object ----
  // We store one of three values per actor:
  //   undefined -> never seen
  //   true      -> currently down AND already stamped for this down spell
  //   false     -> currently up, armed to stamp on the next knockdown
  // WeakMap so despawned actors are garbage-collected (no leak, no pruning).
  let downState = new WeakMap();

  function isDown(a) {
    return !!(a && (a.dead || (a.ko > 0)));
  }

  function actorPos(a) {
    // rig group carries the world position; fall back gracefully
    const g = a && a.group;
    if (g && g.position) return g.position;
    if (a && a.char && a.char.group) return a.char.group.position;
    return null;
  }

  function scan(list) {
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || typeof a !== "object") continue; // WeakMap keys must be objects
      const down = isDown(a);
      const prev = downState.get(a);   // true | false | undefined
      if (prev === undefined) {
        // first time we've seen this actor; remember its current state.
        // (if it spawned already-down we conservatively skip the splat)
        downState.set(a, down);
      } else if (down && prev === false) {
        // newly went down -> stamp a splat under them
        const p = actorPos(a);
        if (p) drop(p.x, p.z);
        downState.set(a, true);
      } else if (!down && prev === true) {
        // got back up -> arm for the next knockdown
        downState.set(a, false);
      }
    }
  }

  // ---- full reset on a new run ----
  function clearAll() {
    for (let i = 0; i < pool.length; i++) {
      pool[i].mesh.visible = false;
      pool[i].born = 0;
    }
    writeIdx = 0;
    used = 0;
    // fresh WeakMap drops all held actor state (WeakMap has no .clear()).
    downState = new WeakMap();
  }

  // ---- slow age-out fade ----
  // We rank live decals by recency using the round-robin write cursor:
  // the oldest live slot is the one writeIdx points at next. Writes are
  // strictly round-robin, so slot order == age order. Anything beyond
  // FADE_START "slots back" from the newest gets eased toward MIN_OP.
  // This is O(used) and allocation-free.
  function fade(dt) {
    if (used <= FADE_START) return;
    // newest slot index is (writeIdx-1); walk backward through live slots.
    for (let rank = 0; rank < used; rank++) {
      const idx = ((writeIdx - 1 - rank) % CAP + CAP) % CAP;
      const slot = pool[idx];
      if (!slot.mesh.visible) continue;
      const target = rank < FADE_START
        ? slot.op
        : MIN_OP + (slot.op - MIN_OP) * Math.max(0, 1 - (rank - FADE_START) / (CAP - FADE_START));
      const cur = slot.mesh.material.opacity;
      if (cur > target) {
        slot.mesh.material.opacity = Math.max(target, cur - 0.06 * dt);
      }
    }
  }

  // ---- new-run detection: watch elapsed drop back toward 0 ----
  let lastElapsed = 0;
  let lastState = (CBZ.game && CBZ.game.state) || "title";

  // run on ALWAYS so we can catch the reset even between play sessions, and
  // keep fading on menus. Drops only ever happen while the action is live,
  // but stamping on a paused frame is harmless too.
  CBZ.onAlways(78, function (dt) {
    const g = CBZ.game;
    if (g) {
      const el = g.elapsed || 0;
      // elapsed resets to 0 on a new run; a meaningful drop = fresh run
      if (el + 0.001 < lastElapsed && lastElapsed > 0.25) clearAll();
      lastElapsed = el;

      // also treat a transition INTO 'playing' from a non-playing state as a
      // safety reset point if elapsed is essentially zero (covers fast restarts)
      if (g.state === "playing" && lastState !== "playing" && el < 0.25) clearAll();
      lastState = g.state;
    }

    // watch both actor buses for fresh knockdowns
    scan(CBZ.guards);
    scan(CBZ.npcs);

    if (dt > 0) fade(dt);
  });

  // expose a manual drop in case other systems want to splat something
  CBZ.dropDecal = drop;
})();
