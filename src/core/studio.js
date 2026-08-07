/* ============================================================
   core/studio.js — THE FRONT DOOR OF THE STUDIO. One script tag.

   OWNER DOCTRINE (2026-08-07):
     "if I'm constantly building new HTML to new studios with the pieces and
      the actors from my Gang City, and going back and improving the Gang City
      engine and building those assets that I need for the HTML, and always
      one-shotting the HTML, because new models come out and I'm gonna wanna
      one-shot things… what I need is to build the back end so then all I need
      is a couple hundred line system prompt that I can add on to my mini game
      ID. And they don't have to call that NPC. They just draw the outfit, or
      they can just use current outfits, because there are other outfits that
      exist. You have a ton of roles already."

   And the finding underneath it: "the jail part in gang city proved to me that
   mini HTMLs running an engine makes much better code than an engine walking
   in a sandbox."

   ------------------------------------------------------------------
   THE FAULT THIS FILE EXISTS TO FIX.

   index.html carries 471 script tags. Every mode pays for every other mode, so
   the cheapest thing to add has always been another dressed room inside the
   monolith, and the most expensive has always been a real game. That is the
   whole reason the casino is a room and the jail is a game.

   A one-shot page pays for nothing it does not name. But it has never been
   able to NAME anything, because the load contract lived nowhere:

     • games/bomb-survivor.html's eighteen script tags were found by FAILURE
       over most of a session. world/materials.js throws at load unless the
       frame-hook bridge exists; city/island_military.js called addLandmass
       unconditionally; world/airbase.js's local→world convention is stated in
       a comment and mirrors silently if you read it wrong.
     • Worse, and this is the proof the manifest is the missing half: that page
       does NOT load systems/modecaps.js. So the capability declaration added
       to it on 2026-08-07 — the one whose entire job is to let a games/ page
       be reached by the shared verbs — is a no-op there. The engine was made
       reachable and the page still could not reach it, because nothing tells a
       page what to load.

   Eight of the nine pages in games/ load exactly one script: their own. They
   are shallow because reaching into the studio cost a session of archaeology.

   ------------------------------------------------------------------
   WHAT A ONE-SHOT LOOKS LIKE NOW. Two tags, and the second one is the game.

       <script src="../src/core/studio.js"></script>
       <script>
         CBZ.studio.need("people", "desert", "air", "ordnance", "match")
           .then(function () { start(); });
       </script>

   studio.js resolves dependencies, loads in the ONE order that works, skips
   anything the page already listed by hand, and finds src/ from its own URL so
   a page never types a relative path twice. It needs no THREE at load: three
   is a pack like everything else, pulled by whatever asks for it.

   THE CATALOG IS THE OTHER HALF. A page should not build a person it already
   owns. `CBZ.studio.cast("soldier")` returns the shipped 1.82 m voxel rig,
   cast against the same role table city/occupy.js uses, wearing the wardrobe
   if it is loaded. `CBZ.studio.model("bomber")` returns the shipped B-2 rather
   than six boxes. What a page cannot get by name, it may still build — but it
   must be told what it already has first.

   THE FIVE-POINT BLOCK LAW COMPLIANCE (docs/claude/doctrine.md):
   1. ONE-LINE ADOPTION — `CBZ.studio.need(...)` replaces a hand-typed list of
      script tags, and a page may adopt it for SOME packs while keeping its own
      tags for the rest: files already in the document are never re-injected.
   2. DEGRADE-SAFE — a page that lists its own tags and never calls need() is
      unaffected; this file publishes and does nothing until called.
      `CBZ.CONFIG.STUDIO_V1 = false` makes need() resolve immediately without
      loading anything, which is the revert for a page mid-adoption.
   3. REAL CONSUMERS — games/bomb-survivor.html is migrated in the same change,
      from eighteen hand-found tags to one need() call, and it is the page that
      proved the fault. Honest count today: one. The manifest is derived from
      that page's measured working set rather than invented, and every other
      games/ page is a candidate because every other games/ page loads one
      script and reaches nothing.
   4. NAMED IN CLAUDE.md — see THE STUDIO there.
   5. RATCHET — `CBZ.studio.audit().missing` counts packs whose files do not
      publish what the manifest says they publish, resolved by asking the live
      CBZ for the symbol rather than by reading the table. A file renamed, a
      symbol dropped, or a lie in the manifest pushes it up. Pinned at 0 by
      tools/studio-check.mjs.

   WHAT THIS FILE DOES NOT DO. It owns no scene, no loop, no asset and no rule.
   core/microboot.js still stands the world up; entities/character.js still
   builds the body; the packs below are the files that already existed. This is
   a phone book and a doorman, not a layer.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  if (CBZ.studio) return;                         // idempotent (family guard idiom)
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.STUDIO_V1 == null) CBZ.CONFIG.STUDIO_V1 = true;

  /* ---- WHERE src/ IS ------------------------------------------------------
     Derived from this file's own URL, never from the page's location. A page
     in games/ and a page at the repo root get the same answer, and neither has
     to type a relative path that the next page will get wrong. */
  function srcRoot() {
    let u = "";
    const cur = document.currentScript;
    if (cur && cur.src) u = cur.src;
    else {
      const all = document.getElementsByTagName("script");
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].src && /core\/studio\.js/.test(all[i].src)) { u = all[i].src; break; }
      }
    }
    const cut = u.indexOf("core/studio.js");
    return cut >= 0 ? u.slice(0, cut) : "src/";
  }
  const ROOT = srcRoot();

  /* ==========================================================================
     THE MANIFEST.

     A pack is a NAME for a set of files that are useless apart, plus the
     packs it cannot load without, plus what it publishes on CBZ. `gives` is
     the sentence a person writing a one-shot reads to decide whether they
     want it; `publishes` is what the ratchet checks by asking CBZ.

     The order inside `files` is LOAD ORDER and it is not negotiable — it is
     the order that was measured to work, and several of these files throw if
     loaded early. Dependencies resolve depth-first, so a pack never has to
     restate what its dependencies already pull.
     ========================================================================== */
  const PACKS = {
    // ---- the floor every page stands on -----------------------------------
    three: {
      gives: "three.js r128, the renderer everything here is written against",
      files: ["vendor/three.r128.min.js"],
      publishes: [],
      test: function () { return !!window.THREE; },
    },
    seed: {
      gives: "deterministic streams; the determinism law forbids Math.random",
      needs: ["three"],
      files: ["core/seed.js"],
      publishes: ["hash01"],
    },
    boot: {
      gives: "scene, renderer, camera, clock, frame loop, input, touch, " +
             "colliders with sliding movement, and procedural sound. The door: " +
             "it stands all of this up under the SAME CBZ names the full engine " +
             "uses, so engine files loaded afterwards find what they expect",
      needs: ["three", "seed"],
      files: ["core/microboot.js"],
      publishes: ["micro"],
    },

    // ---- what a world is made of ------------------------------------------
    look: {
      gives: "shared materials, box/geometry helpers, concrete and checker " +
             "textures, glass, ground depth kinds, and the vehicle paint/glass " +
             "environment. Load this before anything that draws",
      needs: ["boot"],
      files: ["world/materials.js", "world/carfx.js"],
      publishes: ["cmat", "boxGeom", "vehicleMat"],
    },
    green: {
      gives: "instanced trees, bushes and grass that cost one draw call a layer",
      needs: ["look"],
      files: ["world/vegetation.js"],
      publishes: ["vegetationKit"],
    },

    // ---- people ------------------------------------------------------------
    people: {
      gives: "the 1.82 m voxel body the whole game runs on, its gait, its " +
             "poses and its death. This is the rig the city, the prison and " +
             "gun game all wear. Use CBZ.studio.cast(role) rather than " +
             "building a person out of boxes",
      needs: ["look"],
      files: ["entities/character.js", "entities/poses.js"],
      publishes: ["makeCharacter", "animChar", "charPoses"],
    },

    // ---- being reachable by the engine's shared verbs ----------------------
    caps: {
      gives: "the capability bus. A page calls CBZ.registerMode(id, {caps, " +
             "actors, hurt}) and from that line the shared verbs reach it: " +
             "vault, ledge step, blast damage, wall breach. WITHOUT THIS PACK " +
             "every shared verb in the engine declines and a page's people " +
             "cannot be hurt by anything the engine fires",
      needs: ["boot"],
      files: ["systems/modecaps.js"],
      publishes: ["modeHas", "worldActors", "hurtWorldActor", "blastWorldActors"],
    },

    // ---- vehicles and aircraft, as shipped models --------------------------
    military: {
      gives: "the shipped military models: fighter jet, bomber, cargo plane, " +
             "helicopter, tank, truck, and the B-2. Real geometry, not boxes",
      needs: ["look"],
      files: ["city/island_military.js", "city/strategic.js"],
      publishes: ["milModels", "strategicModels"],
    },

    // ---- worlds ------------------------------------------------------------
    desert: {
      gives: "a desert basin with one city in it: 200 towers on a grid, a " +
             "park, shelters, dunes, an inland sea, salt flats and a mountain " +
             "rim. Analytic terrain, so heightAt(x,z) is a pure function",
      needs: ["look", "green"],
      files: ["world/desertcity.js"],
      publishes: ["desertCity"],
    },
    airbase: {
      gives: "a portable military installation: runway, hangars, tower, revetments, " +
             "and parked aircraft that sit on their wheels because seat() measures " +
             "the bounding box instead of guessing a gear drop",
      needs: ["look", "military"],
      files: ["world/airbase.js"],
      publishes: ["airbase"],
    },

    // ---- flight and weapons -------------------------------------------------
    air: {
      gives: "flight for a bomber, a fighter or a transport. Coefficients are " +
             "DERIVED from cruise speed and max thrust, not tuned by feel, and " +
             "the autopilot commands bank ANGLE so an aeroplane cannot roll " +
             "itself into the ground",
      needs: ["boot"],
      files: ["systems/airframe.js"],
      publishes: ["airframe"],
    },
    ordnance: {
      gives: "iron bombs, heavy bombs, cluster, rockets and a nuke, with one " +
             "shared ballistic integrator so the aiming pipper and the bomb " +
             "cannot disagree, overhead cover, and blast that walks a snapshot " +
             "so a kill mid-sweep cannot skip the next body",
      needs: ["boot", "look"],
      files: ["systems/ordnance.js"],
      publishes: ["ordnance"],
    },
    nukefx: {
      gives: "the researched mushroom: stem, cap, surge, collar, whiteout, and " +
             "a yield-to-radius model rather than a big orange ball",
      needs: ["look"],
      files: ["city/nukefx.js"],
      publishes: ["cityNukeFX", "nukeLethalAt"],
    },

    // ---- what things look like when they break -----------------------------
    fx: {
      gives: "the pooled particle, puff, chunk and scorch systems everything " +
             "violent draws out of. Cheap because it is pooled, so a salvo " +
             "cannot flood the frame",
      needs: ["look"],
      files: ["systems/fx.js"],
      publishes: ["fx"],
    },
    damage: {
      gives: "what ordnance LOOKS like when it lands on anything: fireball, " +
             "wall ruin, rebar, ejecta cone, dust, and cityAirstrikeCollapse, " +
             "the verb that brings a section of a building down. None of it " +
             "reads a city record any more",
      needs: ["fx"],
      files: ["city/crashfx.js"],
      publishes: ["cityBlastCore", "cityAirstrikeCollapse", "cityWallRuin"],
    },
    sound: {
      gives: "the shared audio bus: positional effects, ducking, and the " +
             "procedural bank, so a page does not ship its own oscillators",
      needs: ["boot"],
      files: ["systems/audio.js"],
      publishes: ["sfx"],
    },

    // ---- instruments and rules ---------------------------------------------
    radar: {
      gives: "a PPI scope: heading-up, sweeping, paint-and-decay, altitude on " +
             "its own channel, threats drawn hot",
      needs: ["boot"],
      files: ["systems/radarscope.js"],
      publishes: ["radar"],
    },
    match: {
      gives: "two sides, a clock, halves, a role swap at half time, a kill " +
             "feed and a score that cannot disagree with the world",
      needs: ["boot"],
      files: ["modes/teammatch.js"],
      publishes: ["teammatch"],
    },
  };
  CBZ.studio = {};
  CBZ.studio.PACKS = PACKS;
  CBZ.studio.root = ROOT;

  /* ---- THE DOORMAN --------------------------------------------------------
     Depth-first over `needs`, then the pack's own files, each appended once
     and awaited before the next so load ORDER is exactly the manifest's order.
     A file the page already listed by hand is counted as loaded and skipped,
     which is what lets a page adopt need() for some packs and keep its own
     tags for the rest. */
  const loaded = Object.create(null);
  const inflight = Object.create(null);

  function alreadyInDocument(rel) {
    const tags = document.getElementsByTagName("script");
    for (let i = 0; i < tags.length; i++) {
      const s = tags[i].getAttribute("src");
      if (s && s.indexOf(rel) >= 0) return true;
    }
    return false;
  }

  function loadFile(rel) {
    if (loaded[rel]) return Promise.resolve();
    if (inflight[rel]) return inflight[rel];
    if (alreadyInDocument(rel)) { loaded[rel] = 1; return Promise.resolve(); }
    const p = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = ROOT + rel;
      s.async = false;                            // order is the contract
      s.onload = function () { loaded[rel] = 1; resolve(); };
      s.onerror = function () { reject(new Error("studio: cannot load " + ROOT + rel)); };
      document.head.appendChild(s);
    });
    inflight[rel] = p;
    return p;
  }

  function planFor(names, seen, out) {
    for (let i = 0; i < names.length; i++) {
      const id = names[i];
      if (seen[id]) continue;
      seen[id] = 1;
      const P = PACKS[id];
      if (!P) { out.unknown.push(id); continue; }
      if (P.needs) planFor(P.needs, seen, out);
      for (let f = 0; f < P.files.length; f++) {
        if (out.files.indexOf(P.files[f]) < 0) out.files.push(P.files[f]);
      }
      out.packs.push(id);
    }
    return out;
  }

  // The plan a need() call WOULD run, without running it. Useful in a probe and
  // in the tool that prints this manifest into a system prompt.
  CBZ.studio.plan = function () {
    const names = Array.prototype.slice.call(arguments).flat ?
      Array.prototype.slice.call(arguments).flat() : Array.prototype.slice.call(arguments);
    return planFor(names, Object.create(null), { files: [], packs: [], unknown: [] });
  };

  CBZ.studio.need = function () {
    const names = [];
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i];
      if (Array.isArray(a)) for (let j = 0; j < a.length; j++) names.push(a[j]);
      else if (a) names.push(a);
    }
    if (CBZ.CONFIG.STUDIO_V1 === false) return Promise.resolve({ packs: [], files: [], unknown: [] });
    const plan = planFor(names, Object.create(null), { files: [], packs: [], unknown: [] });
    if (plan.unknown.length) {
      return Promise.reject(new Error("studio: no such pack: " + plan.unknown.join(", ") +
        ". Known packs: " + Object.keys(PACKS).join(" ")));
    }
    let chain = Promise.resolve();
    plan.files.forEach(function (f) { chain = chain.then(function () { return loadFile(f); }); });
    return chain.then(function () { return plan; });
  };

  /* ==========================================================================
     THE CASTING TABLE — a person by NAME.

     city/occupy.js already owns a role table and calls it "casting only: job +
     archetype + temperament; everything downstream is the shipped ped
     pipeline". That table is the right one and this does not replace it: when
     occupy.js is loaded its rows are merged in, so a page gets the same
     soldier the city's fortresses get.

     What lives here is the part occupy.js cannot give a page outside the city:
     a WEARABLE reading of the role. city/peds.js's makePed is genuinely
     city-coupled (wanted ladder, cityKillPed, the ped brain), so a one-shot
     cannot have it — but the BODY is engine (entities/character.js) and the
     wardrobe is a catalog (city/outfits.js). So `cast` builds the shipped rig,
     dressed to the role, and leaves the brain to the game. A page that wants
     the full city ped loads the city and calls makePed.
     ========================================================================== */
  const CASTING = {
    soldier:   { pal: { legs: 0x3e4630, torso: 0x47503a, arms: 0x47503a, shoes: 0x241f19, cap: 0x3a4230 }, armed: "Rifle", hp: 170 },
    officer:   { pal: { legs: 0x2f3626, torso: 0x39412e, arms: 0x39412e, shoes: 0x1e1a15, cap: 0x2b3223 }, armed: "Pistol", hp: 200 },
    guard:     { pal: { legs: 0x22242a, torso: 0x2b2e36, arms: 0x2b2e36, shoes: 0x17181c, cap: 0x22242a }, armed: "Pistol", hp: 140 },
    security:  { pal: { legs: 0x22242a, torso: 0x2b2e36, arms: 0x2b2e36, shoes: 0x17181c, cap: 0x22242a }, armed: "Pistol", hp: 140 },
    agent:     { pal: { legs: 0x18181c, torso: 0x1f1f24, arms: 0x1f1f24, shoes: 0x101013, cap: 0x18181c }, armed: "Pistol", hp: 150 },
    muscle:    { pal: { legs: 0x1d1d20, torso: 0x3a2f2a, arms: 0x3a2f2a, shoes: 0x141416 }, armed: "Pistol", hp: 150 },
    thug:      { pal: { legs: 0x2a2f38, torso: 0x6d2f2f, arms: 0x6d2f2f, shoes: 0x1a1a1d }, armed: "Pistol", hp: 110 },
    civilian:  { pal: { legs: 0x3a4152, torso: 0x9aa3b4, arms: 0x9aa3b4, shoes: 0x2a2622 }, hp: 100 },
    worker:    { pal: { legs: 0x394a63, torso: 0xc8862c, arms: 0xc8862c, shoes: 0x2a2622 }, hp: 110 },
    exec:      { pal: { legs: 0x23252c, torso: 0x2c2f38, arms: 0x2c2f38, shoes: 0x191a1e }, hp: 100 },
    medic:     { pal: { legs: 0xe9edf2, torso: 0xf3f6fa, arms: 0xf3f6fa, shoes: 0x2a2622 }, hp: 110 },
    pilot:     { pal: { legs: 0x3f4438, torso: 0x5a6046, arms: 0x5a6046, shoes: 0x241f19, cap: 0xd8dce2 }, hp: 120 },
    runner:    { pal: { legs: 0x2f3a48, torso: 0xb4643a, arms: 0xb4643a, shoes: 0x22201c }, hp: 100 },
  };
  const SKINS = [0xc9a07a, 0x8d5a3b, 0x6b4228, 0xe0b894, 0x4a2f1e, 0xa87551];
  const HAIRS = [0x1a1410, 0x3a2a1c, 0x6b4a2a, 0x101010, 0x8a7250, 0x2a1f18];

  CBZ.studio.roles = function () { return Object.keys(CASTING).slice(); };

  /* cast(role, opts) -> THREE.Group (the rig's group), with .userData.charRig
     opts: { color }  team/faction colour, overrides the torso and cap
           { variant } integer; picks skin and hair deterministically
           { scale }   metres tall override, default the shipped 1.82 m
     Returns null when the `people` pack is not loaded, so a caller can fall
     back rather than crash — the same degrade rule the rest of the file uses. */
  CBZ.studio.cast = function (role, opts) {
    if (!CBZ.makeCharacter) return null;
    opts = opts || {};
    const occ = (CBZ.cityOccupyRoles && CBZ.cityOccupyRoles[role]) || null;
    const C = CASTING[role] || CASTING[(occ && occ.archetype)] || CASTING.civilian;
    const v = (opts.variant | 0);
    const pal = C.pal;
    const body = {
      legs: pal.legs, torso: opts.color != null ? opts.color : pal.torso,
      collar: opts.color != null ? opts.color : pal.torso,
      arms: pal.arms, shoes: pal.shoes,
      skin: SKINS[((v % SKINS.length) + SKINS.length) % SKINS.length],
      hair: HAIRS[((v * 3 + 1) % HAIRS.length + HAIRS.length) % HAIRS.length],
    };
    if (pal.cap != null) body.cap = opts.color != null ? opts.color : pal.cap;
    let ch = null;
    try { ch = CBZ.makeCharacter(body); } catch (e) { return null; }
    const g = (ch && ch.isObject3D) ? ch : (ch && ch.group);
    if (!g) return null;
    g.userData.charRig = ch;
    g.userData.role = role;
    g.userData.hp = C.hp || 100;
    if (C.armed) g.userData.weapon = C.armed;
    if (opts.scale > 0 && g.scale) g.scale.setScalar(opts.scale / 1.82);
    return g;
  };

  /* ---- MODELS BY NAME -----------------------------------------------------
     The shipped geometry, wherever it lives. city/island_military.js and
     city/strategic.js publish their factories; world/airbase.js wraps them
     with the wheels-on-concrete seating. Returns null when the owning pack is
     absent, so a page can fall back to primitives and say so. */
  // world/airbase.js is asked FIRST on purpose: its factories are the ones
  // that ask the engine for the real model, fall back to primitives when the
  // military pack is absent, and seat the thing on its wheels by measuring the
  // bounding box. Going straight to milModels gets you geometry with no
  // fallback and no seating, which is how aircraft ended up floating.
  const MODEL_ALIAS = { jet: "fighter", fighter: "fighter", b2: "bomber", plane: "cargo", chopper: "heli" };
  const MODEL_SOURCES = [
    function (n) { return CBZ.airbase && CBZ.airbase[MODEL_ALIAS[n] || n]; },
    function (n) { return CBZ.milModels && CBZ.milModels[n]; },
    function (n) { return CBZ.strategicModels && CBZ.strategicModels[n]; },
  ];
  CBZ.studio.models = function () {
    const out = [];
    const push = (k) => { if (out.indexOf(k) < 0) out.push(k); };
    if (CBZ.airbase) ["bomber", "fighter", "heli", "tank", "truck", "cargo"].forEach(function (k) { if (CBZ.airbase[k]) push(k); });
    if (CBZ.milModels) for (const k in CBZ.milModels) push(k);
    if (CBZ.strategicModels) for (const k in CBZ.strategicModels) push(k);
    return out;
  };
  CBZ.studio.model = function (name, opts) {
    for (let i = 0; i < MODEL_SOURCES.length; i++) {
      const f = MODEL_SOURCES[i](name);
      if (typeof f === "function") { try { return f(opts || {}); } catch (e) { return null; } }
    }
    return null;
  };

  /* ==========================================================================
     ORCHESTRATION — the verbs that let a page BE ABOUT ITS GAME.

     OWNER DOCTRINE (2026-08-07): "using as much of gang city code directly
     with as few lines for you, that makes your few lines give you the ability
     to make it much better, because you don't have to redraw shit. You just
     orchestrate assets as much as possible."

     Everything below is a ROUTE to something the engine already ships, chosen
     at call time from what is loaded, with a stated fallback. None of it draws
     anything this repo did not already draw. The point is that a one-shot page
     spends its lines on rules, feel and novelty rather than on rebuilding a
     body, a HUD, an aeroplane and an explosion for the ninth time.
     ========================================================================== */

  /* join(spec) — BE REACHABLE, in one call. Wraps CBZ.registerMode with the
     defaults a page almost always wants, so nobody has to remember the
     capability names to be hittable. `actors` and `hurt` are the only fields
     that carry information; everything else has a right answer. */
  CBZ.studio.join = function (spec) {
    spec = spec || {};
    const id = spec.id || (CBZ.game && CBZ.game.mode) || "slice";
    // AND BECOME THAT MODE. Every shared verb resolves through CBZ.game.mode,
    // and microboot's honest default is "slice". A page that declares itself
    // "bombsurvivor" and stays "slice" registers a descriptor nothing will ever
    // look up — reachable on paper, unreachable in fact, which is the exact
    // failure this whole path exists to end.
    if (CBZ.game && spec.mode !== false) CBZ.game.mode = id;
    if (!CBZ.registerMode) return null;
    CBZ.registerMode(id, {
      id: id, label: spec.label || id,
      caps: spec.caps || { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
      actors: spec.actors || null,
      hurt: spec.hurt || null,
      hurtPlayer: spec.hurtPlayer || null,
      blast: spec.blast || null,
      route: spec.route || (spec.label || id) + " roster",
    });
    return id;
  };

  /* world(name, opts) — a named world, built. The page names a place instead
     of laying out a place. Returns whatever the world builder returns. */
  CBZ.studio.world = function (name, opts) {
    opts = opts || {};
    if (name === "desert" && CBZ.desertCity) return CBZ.desertCity.build(opts);
    return null;
  };
  CBZ.studio.worlds = function () { return CBZ.desertCity ? ["desert"] : []; };

  /* crowd(n, role, opts) — N shipped bodies, placed and parented. The whole
     point of the asset farm: a page that wants people gets people.
       opts.at(i)  -> {x,z,y?}  placement, called per body (else a ring)
       opts.color             team/faction colour
       opts.parent            defaults to CBZ.scene
     Returns the array of groups, empty when `people` is not loaded. */
  CBZ.studio.crowd = function (n, role, opts) {
    opts = opts || {};
    const out = [];
    if (!CBZ.makeCharacter) return out;
    const parent = opts.parent || CBZ.scene;
    const R = opts.radius > 0 ? opts.radius : 30;
    for (let i = 0; i < n; i++) {
      const g = CBZ.studio.cast(role, { color: opts.color, variant: i });
      if (!g) break;
      let p = null;
      if (typeof opts.at === "function") p = opts.at(i);
      if (!p) { const a = (i / Math.max(1, n)) * Math.PI * 2; p = { x: Math.cos(a) * R, z: Math.sin(a) * R }; }
      g.position.set(p.x || 0, p.y || 0, p.z || 0);
      if (parent && parent.add) parent.add(g);
      out.push(g);
    }
    return out;
  };

  /* fly(kind, opts) — a machine in the air: the SHIPPED model, with the
     derived-coefficient airframe already attached and launched.
       kind: "bomber" | "jet" | "cargo" | "heli"
     Returns {group, af} or null. The page flies it; it never models it. */
  const AIRFRAME_FOR = { bomber: "bomber", b2: "bomber", jet: "fighter", cargo: "transport", heli: "transport" };
  CBZ.studio.fly = function (kind, opts) {
    opts = opts || {};
    const g = CBZ.studio.model(kind, opts) || CBZ.studio.model(kind === "bomber" ? "b2" : "jet", opts);
    if (!g) return null;
    let af = null;
    if (CBZ.airframe && CBZ.airframe.make) {
      af = CBZ.airframe.make({ preset: AIRFRAME_FOR[kind] || "fighter", groundAt: opts.groundAt || null });
      if (af && af.launch && opts.at) {
        af.launch(opts.at.x || 0, opts.at.y || 300, opts.at.z || 0, opts.heading || 0, opts.speed || 160);
      }
    }
    const parent = opts.parent || CBZ.scene;
    if (parent && parent.add) parent.add(g);
    return { group: g, af: af };
  };

  /* boom(pos, opts) — a detonation, through the best route that is loaded.
     ordnance owns the shape of one; crashfx owns what it looks like; modecaps
     owns whose people it reaches. A page should never grow its own fireball.
     CBZ.cityExplosion is deliberately NOT used: it is a wrapper chain six city
     files hang couplings on, so outside the city the core is the honest call. */
  CBZ.studio.boom = function (pos, opts) {
    opts = opts || {};
    const R = opts.radius > 0 ? opts.radius : 18;
    const power = opts.power > 0 ? opts.power : 1;
    let drew = false;
    if (CBZ.cityBlastCore) { try { CBZ.cityBlastCore(pos.x, pos.y || 1, pos.z, { power: power, radius: R }); drew = true; } catch (e) {} }
    // IT MUST ALSO BE HEARD, and the falloff is the bank's own job rather than
    // every caller's. A detonation across the basin should be a thud, not the
    // same bang as one in the street.
    const S = CBZ.micro && CBZ.micro.sfx;
    if (opts.silent !== true && S && S.boom) {
      let gain = 0.75 * Math.min(1.6, power);
      if (CBZ.camera && S.gainAt) {
        const c = CBZ.camera.position;
        const d = Math.sqrt((c.x - pos.x) * (c.x - pos.x) + (c.y - (pos.y || 0)) * (c.y - (pos.y || 0)) + (c.z - pos.z) * (c.z - pos.z));
        gain *= S.gainAt(d, opts.earshot || 420);
      }
      if (gain > 0.015) {
        try { S.boom({ gain: gain, dur: 1.2 + power * 0.5, sub: 96 - power * 12, bright: R < 12 }); } catch (e) {}
      }
    }
    let hit = 0;
    if (CBZ.blastWorldActors) { try { hit = CBZ.blastWorldActors(pos.x, pos.y || 1, pos.z, R, power, opts) || 0; } catch (e) {} }
    if (opts.structural !== false && CBZ.cityAirstrikeCollapse) {
      try { CBZ.cityAirstrikeCollapse({ x: pos.x, z: pos.z, at: pos, power: power }, opts); } catch (e) {}
    }
    return { drew: drew, hit: hit };
  };

  /* ==========================================================================
     controls(kind, opts) — ONE CONTROL SURFACE, PHONE FIRST.

     Every page in games/ has re-typed the same branch: read WASD, read a mouse
     delta, then bolt on a touch stick afterwards and discover on a phone that
     half the game is unreachable. So the branch lives here once and a page
     reads a surface that means the same thing on both.

       const C = CBZ.studio.controls("fly", { buttons: { fire: "DROP" } });
       C.move.x  C.move.y      -1..1   left stick, or WASD
       C.look.x  C.look.y      radians this frame, mouse or right-side drag
       C.held("fire")  C.tapped("fire")
       C.throttle              0..1, held by the surface across frames

     kind is "fly" or "walk" and only changes the default layout of the touch
     furniture. A coarse pointer gets a stick and real buttons; a mouse gets
     pointer lock. NOTHING renders a key cap on a touchscreen, here or in the
     HUD, because that is the rule that keeps getting broken.
     ========================================================================== */
  CBZ.studio.controls = function (kind, opts) {
    opts = opts || {};
    const IN = (CBZ.micro && CBZ.micro.input) || null;
    const T = (CBZ.micro && CBZ.micro.touch) || null;
    const coarse = COARSE && T && T.init;
    const btnDefs = opts.buttons || (kind === "fly" ? { fire: "DROP" } : { fire: "USE" });
    const state = { held: Object.create(null), tapped: Object.create(null) };
    const KEYMAP = opts.keys || { fire: "Space", alt: "KeyF", boost: "ShiftLeft" };

    let throttleSlider = null;
    if (coarse) {
      T.init({});
      // A FLYING GAME ON A PHONE NEEDS A THROTTLE, and holding a key is not an
      // option there. microboot already ships the slider; nobody had wired it
      // to the one control that actually needs to be held at a value.
      if (kind === "fly" && T.addSlider) {
        throttleSlider = T.addSlider({
          label: "PWR", value: 0.72, right: 24, bottom: 210, height: 168,
          onChange: function (v) { C.throttle = v; },
        });
      }
      let i = 0;
      for (const name in btnDefs) {
        (function (n, idx) {
          T.addButton({
            label: btnDefs[n], word: String(btnDefs[n]).length > 2, size: 76,
            right: 24 + idx * 96, bottom: kind === "fly" ? 108 : 132,
            onDown: function () { state.held[n] = true; state.tapped[n] = true; },
            onUp: function () { state.held[n] = false; },
          });
        })(name, i++);
      }
    }

    const C = {
      kind: kind || "walk",
      touch: !!coarse,
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      throttle: kind === "fly" ? 0.72 : 1,
      held: function (n) {
        if (state.held[n]) return true;
        return !!(IN && KEYMAP[n] && IN.isDown(KEYMAP[n]));
      },
      tapped: function (n) {
        if (state.tapped[n]) { state.tapped[n] = false; return true; }
        return !!(IN && KEYMAP[n] && IN.pressed(KEYMAP[n]));
      },
      // called once a frame by the page; keeps the surface honest about edges
      step: function (dt) {
        C.move.x = 0; C.move.y = 0; C.look.x = 0; C.look.y = 0;
        if (!IN) return C;
        const st = T && T.stick;
        if (st && st.mag > 0.04) { C.move.x = st.x; C.move.y = -st.y; }
        else { C.move.x = IN.axis("KeyA", "KeyD"); C.move.y = IN.axis("KeyS", "KeyW"); }
        const sens = IN.sensitivity || 0.0022;
        C.look.x = -IN.mx * sens;
        C.look.y = -IN.mz * sens;
        if (kind === "fly" && !throttleSlider) {
          // no slider means a keyboard, where the stick's Y is the throttle and
          // the page should not have to know which of the two it is reading
          C.throttle = Math.max(0.15, Math.min(1, C.throttle + C.move.y * 0.55 * dt));
        }
        return C;
      },
      lock: function () { if (!coarse && CBZ.micro && CBZ.micro.lock) CBZ.micro.lock(); },
    };
    return C;
  };

  /* ==========================================================================
     bombsight(opts) — WHERE THE BOMB LANDS, DRAWN.

     A bombing game is the mark under the nose. This asks systems/ordnance.js's
     SHARED integrator, so the ring on the ground and the bomb that follows it
     cannot disagree — the pipper that lied by 311 m did so because it ran its
     own maths beside the bomb's. One integrator, one answer, and this verb has
     no maths of its own to get wrong.

       const sight = CBZ.studio.bombsight({ kind: "iron" });
       sight.aim(af.pos, af.vel);     // each frame while attacking
       sight.hide();                  // when not
       sight.mark                     // THREE.Vector3, the predicted impact
     ========================================================================== */
  CBZ.studio.bombsight = function (opts) {
    opts = opts || {};
    const THREE = window.THREE;
    if (!THREE || !CBZ.scene) return { aim: function () {}, hide: function () {}, mark: null, ok: false };
    const kind = opts.kind || "iron";
    const col = opts.color != null ? opts.color : 0xffc46a;
    const g = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(opts.inner || 7, opts.outer || 8.4, 40, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(ringGeo, mat));
    // a cross, so the mark reads as an AIM and not as a decal on the ground
    const barGeo = new THREE.PlaneGeometry(opts.outer ? opts.outer * 2.6 : 22, 0.7);
    barGeo.rotateX(-Math.PI / 2);
    const b1 = new THREE.Mesh(barGeo, mat); const b2 = new THREE.Mesh(barGeo, mat);
    b2.rotation.y = Math.PI / 2;
    g.add(b1); g.add(b2);
    g.renderOrder = 900;
    g.visible = false;
    CBZ.scene.add(g);
    const mark = new THREE.Vector3();
    return {
      ok: true, group: g, mark: mark,
      aim: function (pos, vel) {
        if (!CBZ.ordnance || !CBZ.ordnance.predict) { g.visible = false; return null; }
        // predict() returns {x,y,z,t,hit,roof} — a flat point, not a wrapper.
        const p = CBZ.ordnance.predict(pos, vel, kind, opts.maxT || 40);
        if (!p || p.x == null) { g.visible = false; return null; }
        mark.set(p.x, p.y, p.z);
        g.position.set(mark.x, mark.y + 0.6, mark.z);
        g.visible = true;
        return p;
      },
      hide: function () { g.visible = false; },
      dispose: function () { if (g.parent) g.parent.remove(g); },
    };
  };

  /* ==========================================================================
     chase(opts) — A CAMERA THAT IS NOT A SUBTRACTION OF TWO VECTORS.

     Every page writes this and every page writes it slightly wrong: no
     smoothing, so the frame jitters; no ground clamp, so it clips through a
     hill; no separate air/ground distance, so an aeroplane is either a speck
     or inside its own tail. Written once.

       const cam = CBZ.studio.chase({ groundAt: world.heightAt });
       cam.follow(target.pos, yaw, dt, { air: true });
     ========================================================================== */
  CBZ.studio.chase = function (opts) {
    opts = opts || {};
    const THREE = window.THREE;
    const groundAt = opts.groundAt || function () { return 0; };
    const cur = new THREE.Vector3();
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    let seeded = false;
    return {
      follow: function (pos, yaw, dt, o) {
        o = o || {};
        const camera = opts.camera || CBZ.camera;
        if (!camera || !pos) return;
        const back = o.back != null ? o.back : (o.air ? 64 : 7.2);
        const up = o.up != null ? o.up : (o.air ? 17 : 2.7);
        want.set(pos.x - Math.sin(yaw) * back, pos.y + up, pos.z - Math.cos(yaw) * back);
        // never inside the hill: the world's own height function decides
        const floor = groundAt(want.x, want.z) + (o.air ? 6 : 1.2);
        if (want.y < floor) want.y = floor;
        if (!seeded) { cur.copy(want); seeded = true; }
        // frame-rate independent smoothing, so a slow frame does not lurch
        const k = 1 - Math.pow(0.0016, Math.max(0.0001, dt));
        cur.lerp(want, o.snap ? 1 : k);
        camera.position.copy(cur);
        look.set(pos.x, pos.y + (o.air ? 1.5 : 1.55), pos.z);
        camera.lookAt(look);
      },
      reset: function () { seeded = false; },
    };
  };

  /* ==========================================================================
     trail(opts) — A CONTRAIL, A SMOKE COLUMN, A WAKE. One draw call.

     Anything that moves fast and matters reads better with a line behind it,
     and every page that wanted one has either gone without or spawned a
     particle per frame and watched the frame time climb. This is a single
     THREE.Line over a ring buffer: fixed memory, fixed draw calls, and the
     tail fades by vertex colour rather than by spawning anything.

       const t = CBZ.studio.trail({ length: 90, color: 0xdfe6ee });
       t.push(af.pos);        // each frame while it should be drawing
       t.cut();               // a gap: the aeroplane died, do not join the dots
     ========================================================================== */
  CBZ.studio.trail = function (opts) {
    opts = opts || {};
    const THREE = window.THREE;
    if (!THREE || !CBZ.scene) return { push: function () {}, cut: function () {}, dispose: function () {} };
    const N = Math.max(8, opts.length || 80);
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const c = new THREE.Color(opts.color != null ? opts.color : 0xdfe6ee);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: opts.opacity != null ? opts.opacity : 0.55, depthWrite: false,
    }));
    line.frustumCulled = false;
    line.renderOrder = 850;
    CBZ.scene.add(line);
    let n = 0, last = null;
    const minStep = opts.minStep != null ? opts.minStep : 6;
    return {
      line: line,
      push: function (p) {
        if (!p) return;
        if (last && (p.x - last.x) * (p.x - last.x) + (p.y - last.y) * (p.y - last.y) +
            (p.z - last.z) * (p.z - last.z) < minStep * minStep) return;
        last = { x: p.x, y: p.y, z: p.z };
        // shift back by one and write the head: a ring buffer would need an
        // index attribute to draw in order, and N is small enough that the
        // copy is cheaper than the bookkeeping.
        if (n >= N) {
          pos.copyWithin(0, 3);
          n = N - 1;
        }
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
        n++;
        for (let i = 0; i < n; i++) {
          const f = i / Math.max(1, n - 1);      // 0 at the tail, 1 at the head
          col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
        }
        geo.setDrawRange(0, n);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.computeBoundingSphere();
      },
      cut: function () { n = 0; last = null; geo.setDrawRange(0, 0); },
      dispose: function () { if (line.parent) line.parent.remove(line); geo.dispose(); line.material.dispose(); },
    };
  };

  /* ==========================================================================
     engineSound(opts) — THE NOISE A MACHINE MAKES, tied to what it is doing.

     microboot's bank already has a controllable noise bed; what nobody has is
     the mapping from throttle and airspeed onto it, so every vehicle page
     either ships silence or invents its own. Two beds, because one is not
     enough to read as machinery: a low core that follows THROTTLE, and a
     bright rush that follows SPEED. A jet at idle in a dive should hiss and
     not roar, and at full power on the deck it should do both.

       const eng = CBZ.studio.engineSound();
       eng.set(af.throttle, af.speed, distanceToCamera);
       eng.stop();
     ========================================================================== */
  CBZ.studio.engineSound = function (opts) {
    opts = opts || {};
    const S = CBZ.micro && CBZ.micro.sfx;
    if (!S || !S.loop) return { set: function () {}, stop: function () {} };
    const core = S.loop({ freq: opts.coreFreq || 110, q: 0.9, filter: "lowpass" });
    const rush = S.loop({ freq: opts.rushFreq || 900, q: 0.5, filter: "bandpass" });
    let dead = false;
    return {
      set: function (throttle, speed, dist) {
        if (dead) return;
        const t = Math.max(0, Math.min(1, throttle || 0));
        const v = Math.max(0, Math.min(1, (speed || 0) / (opts.vRef || 240)));
        let att = 1;
        if (dist != null && S.gainAt) att = S.gainAt(dist, opts.earshot || 260);
        core.set((opts.coreFreq || 110) * (0.7 + t * 0.9), (0.05 + t * 0.20) * att);
        rush.set((opts.rushFreq || 900) * (0.6 + v * 1.5), (0.01 + v * 0.10) * att);
      },
      stop: function () { if (dead) return; dead = true; core.stop(); rush.stop(); },
    };
  };

  /* alarm(level, opts) — ONE WARNING VOICE, rate limited so a salvo cannot
     turn it into a drone. `level` is 0..1; below the threshold it says nothing.
     A page should not own a cooldown timer for a siren. */
  let _alarmAt = -1e9;
  CBZ.studio.alarm = function (level, opts) {
    opts = opts || {};
    const S = CBZ.micro && CBZ.micro.sfx;
    if (!S || !S.tone) return false;
    const L = level || 0;
    if (L < (opts.threshold != null ? opts.threshold : 0.18)) return false;
    const now = (CBZ.micro && CBZ.micro.elapsed) || 0;
    // the closer it is, the faster it repeats — the interval IS the warning
    const gap = opts.gap != null ? opts.gap : (1.15 - Math.min(0.95, L) * 0.85);
    if (now - _alarmAt < gap) return false;
    _alarmAt = now;
    S.tone(opts.hi || (560 + L * 260), 0.16, {
      type: "square", gain: (opts.gain || 0.10) * (0.5 + L * 0.5), slideTo: opts.lo || 380,
    });
    return true;
  };

  /* ==========================================================================
     hud(spec) — THE STANDARD HUD, and the owner's rules built into it so the
     next one-shot cannot get them wrong:

       • HEALTH IS ALWAYS TOP LEFT. One meter. Never a heart, never a ring.
       • NO EMOJI IN HUD SPACE. Ever.
       • NEVER SHOW A KEYBOARD KEY ON A TOUCHSCREEN. The prompt is a TAP
         TARGET on a coarse pointer and a key cap on a mouse, decided here,
         once, instead of in every page by somebody who forgot.
       • FRAGMENTS, NOT SENTENCES. The API takes short strings and gives them
         no punctuation of its own.

     Returns a handle; every method is safe to call every frame. ------------ */
  const HUD_CSS = `
.sHud{position:fixed;inset:0;pointer-events:none;font:600 14px/1.2 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  color:#f4f1ea;text-shadow:0 1px 3px rgba(0,0,0,.75);z-index:40;-webkit-user-select:none;user-select:none}
.sHud .hp{position:absolute;left:calc(14px + env(safe-area-inset-left,0px));top:calc(14px + env(safe-area-inset-top,0px));width:min(34vw,190px)}
.sHud .hp b{display:block;font-size:11px;letter-spacing:.16em;opacity:.75;margin-bottom:5px;font-weight:700}
.sHud .hp i{display:block;height:9px;border-radius:5px;background:rgba(255,255,255,.16);overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.5) inset}
.sHud .hp i s{display:block;height:100%;width:100%;background:linear-gradient(90deg,#5fd07a,#a9e05a);transition:width .12s linear,background .2s}
.sHud.low .hp i s{background:linear-gradient(90deg,#e0603a,#e8a33a)}
.sHud .clk{position:absolute;left:50%;transform:translateX(-50%);top:calc(12px + env(safe-area-inset-top,0px));
  font-size:clamp(18px,4.4vw,26px);letter-spacing:.08em;font-variant-numeric:tabular-nums}
.sHud .scr{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));top:calc(13px + env(safe-area-inset-top,0px));
  text-align:right;font-size:13px;letter-spacing:.06em;font-variant-numeric:tabular-nums}
.sHud .scr div{opacity:.92;margin-bottom:3px}
.sHud .scr em{font-style:normal;opacity:.6;margin-right:8px;font-size:11px;letter-spacing:.14em}
.sHud .fd{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));top:calc(86px + env(safe-area-inset-top,0px));
  text-align:right;font-size:12px;letter-spacing:.04em;max-width:60vw}
.sHud .fd p{margin:0 0 4px;opacity:.85;animation:sfd 6s forwards}
@keyframes sfd{0%{opacity:0;transform:translateX(10px)}8%{opacity:.9;transform:none}75%{opacity:.9}100%{opacity:0}}
.sHud .nt{position:absolute;left:calc(14px + env(safe-area-inset-left,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));
  font-size:12px;letter-spacing:.05em;opacity:.7;max-width:56vw}
.sHud .pr{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(22px + env(safe-area-inset-bottom,0px));
  pointer-events:auto;display:none;align-items:center;gap:9px;padding:11px 20px;border-radius:999px;
  background:rgba(16,17,20,.66);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(6px);
  font-size:14px;letter-spacing:.1em;cursor:pointer}
.sHud .pr.on{display:flex}
.sHud .pr kbd{font:inherit;font-size:12px;padding:2px 8px;border-radius:5px;background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.26)}
.sHud.touch .pr{padding:15px 30px;font-size:16px}
`;
  let cssIn = false;
  function ensureCss() {
    if (cssIn) return;
    cssIn = true;
    const st = document.createElement("style");
    st.textContent = HUD_CSS;
    document.head.appendChild(st);
  }
  const COARSE = (function () {
    try { return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || ("ontouchstart" in window); }
    catch (e) { return false; }
  })();
  CBZ.studio.touchDevice = COARSE;

  CBZ.studio.hud = function (spec) {
    spec = spec || {};
    ensureCss();
    const root = document.createElement("div");
    root.className = "sHud" + (COARSE ? " touch" : "");
    const mk = (cls, html) => { const d = document.createElement("div"); d.className = cls; if (html) d.innerHTML = html; root.appendChild(d); return d; };
    // HEALTH. Top left. Always. One meter.
    const hp = spec.health === false ? null : mk("hp", "<b>" + (spec.healthLabel || "HEALTH") + "</b><i><s></s></i>");
    const hpFill = hp ? hp.querySelector("s") : null;
    const clk = spec.clock === false ? null : mk("clk", "");
    const scr = spec.score === false ? null : mk("scr", "");
    const fd = spec.feed === false ? null : mk("fd", "");
    const nt = spec.note === false ? null : mk("nt", "");
    const pr = spec.prompt === false ? null : mk("pr", "");
    let onTap = null;
    if (pr) pr.addEventListener("click", function (e) { e.preventDefault(); if (onTap) onTap(); });
    document.body.appendChild(root);

    return {
      el: root,
      health: function (frac) {
        if (!hpFill) return;
        const f = Math.max(0, Math.min(1, frac));
        hpFill.style.width = (f * 100).toFixed(1) + "%";
        root.classList.toggle("low", f < 0.34);
      },
      clock: function (t) { if (clk) clk.textContent = t == null ? "" : String(t); },
      score: function (rows) {
        if (!scr) return;
        let h = "";
        for (const k in rows) h += "<div><em>" + k + "</em>" + rows[k] + "</div>";
        scr.innerHTML = h;
      },
      feed: function (line) {
        if (!fd || !line) return;
        const p = document.createElement("p");
        p.textContent = String(line);
        fd.insertBefore(p, fd.firstChild);
        while (fd.childNodes.length > 6) fd.removeChild(fd.lastChild);
        setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 6200);
      },
      note: function (t) { if (nt) nt.textContent = t == null ? "" : String(t); },
      /* THE RULE THAT KEEPS GETTING BROKEN, kept here instead. A coarse
         pointer gets a tap target with a verb on it. A mouse gets the key. */
      prompt: function (label, tap, key) {
        if (!pr) return;
        if (!label) { pr.classList.remove("on"); onTap = null; return; }
        onTap = tap || null;
        pr.innerHTML = COARSE ? String(label)
          : "<kbd>" + (key || "E") + "</kbd><span>" + String(label) + "</span>";
        pr.classList.add("on");
      },
      hide: function () { root.style.display = "none"; },
      show: function () { root.style.display = ""; },
      remove: function () { if (root.parentNode) root.parentNode.removeChild(root); },
    };
  };

  /* ---- WHAT IS ACTUALLY HERE ---------------------------------------------
     Printed by tools/studio-check.mjs into the system prompt a one-shot is
     written against. A catalogue nobody can read is a catalogue nobody uses. */
  CBZ.studio.list = function () {
    const out = [];
    for (const id in PACKS) {
      const P = PACKS[id];
      out.push({
        pack: id, gives: P.gives, needs: (P.needs || []).slice(),
        files: P.files.slice(), publishes: (P.publishes || []).slice(),
        loaded: (P.publishes || []).every(function (s) { return CBZ[s] != null; }),
      });
    }
    return out;
  };

  /* ---- RATCHET (Block Law rule 5) -----------------------------------------
     THE NUMBER THAT MAY ONLY GO DOWN. For every pack whose files have been
     loaded, does CBZ actually carry what the manifest PROMISED? Resolved by
     asking the live CBZ, never by reading the table — a manifest that
     describes itself measures nothing. A renamed file, a dropped symbol or a
     lie written here pushes `missing` up. Pinned at 0 by
     tools/studio-check.mjs. */
  CBZ.studio.audit = function () {
    const rows = {};
    let missing = 0, checked = 0;
    for (const id in PACKS) {
      const P = PACKS[id];
      const pub = P.publishes || [];
      const filesIn = P.files.every(function (f) { return !!loaded[f] || alreadyInDocument(f); });
      if (!filesIn) continue;                     // not loaded: nothing to promise
      if (P.test && !P.test()) { rows[id] = "LOAD FAILED"; missing++; checked++; continue; }
      const gone = pub.filter(function (s) { return CBZ[s] == null; });
      checked++;
      if (gone.length) { rows[id] = "MISSING " + gone.join(","); missing++; }
      else rows[id] = "ok";
    }
    return {
      missing: missing,        // <- THE RATCHET. Pin at 0. May only go down.
      checked: checked,
      packs: Object.keys(PACKS).length,
      rows: rows,
      root: ROOT,
      flag: CBZ.CONFIG.STUDIO_V1 !== false,
    };
  };
})();
