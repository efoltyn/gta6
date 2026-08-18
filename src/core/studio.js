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

   THE FIVE-POINT BLOCK LAW COMPLIANCE (scrolls/claude/doctrine.md):
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

  /* ---- THE LANDMASS COLLECTOR ---------------------------------------------
     The REAL islands — the military base, the civil airport — register
     themselves with CBZ.addLandmass and wait for the city's world build to
     call them. On a slice page there is no world build, so that registration
     either threw at load (island_airport.js calls it unguarded) or vanished
     into a function nobody would ever run — which is exactly how the bomb
     game ended up with a hand-rolled airbase beside a shipped one.

     So the studio collects. When no city owns the registry, addLandmass files
     each builder under the FILE that registered it (loadFile stamps the name),
     and CBZ.studio.raise(pack) runs a pack's builders against a synthesized
     city context. The array is the SAME name worldmap.js uses, so a page that
     later grows into the full engine hands its registry over cleanly. */
  let _loadingFile = null;
  if (!CBZ.addLandmass) {
    CBZ._landmassBuilders = CBZ._landmassBuilders || [];
    CBZ.addLandmass = function (fn, order) {
      CBZ._landmassBuilders.push({ fn: fn, order: order == null ? 50 : order, file: _loadingFile });
    };
    CBZ.addLandmass._studioCollector = true;
  }
  /* The islands also file their walkable regions at the end of their builders,
     UNGUARDED — a missing registrar would abort a builder's tail on a page.
     Collect regions onto the city context instead of losing the island. */
  if (!CBZ.registerCityRegion) {
    CBZ.registerCityRegion = function (city, r) {
      if (city && r) (city.regions || (city.regions = [])).push(r);
      return r;
    };
    CBZ.registerCityRegion._studioCollector = true;
  }

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

    // ---- the four services the prison wave proved every game needs ---------
    // Each is standalone: no world, no city file, no mode. `day` and `light`
    // are the pair that make a night mean something; `rest` and `push` are the
    // pair that make furniture mean something.
    day: {
      gives: "a DAY made of named blocks. CBZ.dayPlan.define(id, [{id,from}...]) " +
             "answers what block it is, how long until the next and fires a " +
             "callback when it turns over — wrapping midnight, silent on the " +
             "arm, and reading the world's own sun when one is loaded",
      needs: [],
      files: ["systems/dayplan.js"],
      publishes: ["dayPlan", "dayPlanAudit"],
    },
    light: {
      gives: "light as a FACT. CBZ.fixtures.rig(id, spec) registers fixtures " +
             "with a per-kind schedule and drives their materials for free, " +
             "answers level(x,z) region-aware (a lamp does not shine through " +
             "a wall) and scale(sensor,x,z) — what a sensor's range is worth " +
             "in this much dark. Pair it with `day` for lights-out",
      needs: [],
      files: ["systems/fixtures.js"],
      publishes: ["fixtures", "fixtureAudit"],
    },
    /* THE PACK THAT PROMISED A POSE AND SHIPPED A FACADE. systems/rest.js is
       the six verbs — claim, walk, hand over, hold, get up, step clear — and
       every one of them ends in a call to city/propuse.js: propRegisterSeat,
       propEntryPoint, propSit, propSleep, propWake, propArcActive. That file
       was in no pack at all, so on a one-shot page `rest.seat()` queued into a
       registry that would never exist and `rest.sit()` returned false forever.
       Measured on a bare page before this line: audit().pending 1,
       flushed false, registered 0, and nobody could sit on anything. The
       manifest's own ratchet could not see it — rest.js publishes `CBZ.rest`
       whatever happens, so the promise was kept and the capability was not. */
    rest: {
      gives: "bodies USING furniture: claim a place, walk there, take the " +
             "pose, get up, step clear. CBZ.rest also carries the three " +
             "load-order repairs that make furniture anchors exist at all — " +
             "deferred registration, a late re-flush, and a loud count of " +
             "anchors refused for sharing a coordinate key",
      needs: ["people"],
      files: ["city/propuse.js", "systems/rest.js"],
      publishes: ["rest", "restAudit", "restWatch", "propRegisterSeat", "propSit", "propSleep"],
    },
    rooms: {
      gives: "FURNITURE, and the grammar of a room. CBZ.furnish is the one " +
             "vocabulary — chair, stool, bench, sofa, bed, desk, table, " +
             "counter, shelf, locker, lamp — where one call DRAWS the piece " +
             "at real metric proportions, REGISTERS its sit/sleep anchor and " +
             "hands back the meshes; CBZ.roomShell stamps a floor and four " +
             "open-top walls with a doorway, and CBZ.roomFurnish lays out a " +
             "named program (office, breakroom, bedroom, lounge, mess) and " +
             "then FLOODS the floor from the door to drop anything nobody " +
             "could walk to",
      needs: ["look", "rest"],
      files: ["city/furniture.js", "world/roombuild.js"],
      publishes: ["furnish", "roomShell", "roomFurnish"],
    },
    push: {
      gives: "furniture that MOVES when you walk into it. CBZ.pushables.add" +
             "({parts, mass, leash, stand}) makes a drawn prop a mass on a " +
             "floor: contact slides it, its collider and its standable top go " +
             "with it, and the broadphase is dirtied — so the stool you shoved " +
             "under the vent is really there to climb",
      needs: ["boot"],
      files: ["systems/pushables.js"],
      publishes: ["pushables", "pushProp", "pushPropAudit"],
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
    /* THE PACK THAT MAKES THE REAL CITY AFFORDABLE ON A ONE-SHOT PAGE.

       Measured, games/battle.html standing on one CBZ.studio.town(): 17 041
       draw calls and 21 912 colliders for eight blocks of the real fabric.
       That is not the town being extravagant — it is the mainland's own
       number before city/mode.js runs the two passes that fix it, and a
       slice page never runs city/mode.js. core/batch.js collapses the
       provably-static shell into a handful of merged meshes (originals kept,
       invisible, so colliders and every LOS ray still hit them), and
       core/staticfreeze.js stops r128 recomposing a matrix per frame for a
       wall that will never move again. Neither file reads a city record;
       both were simply behind a door only the full engine had a key to.

       Call it, once, after the world is built and BEFORE the actors go in:
         CBZ.batchStaticUnder(CBZ.scene); CBZ.freezeStaticUnder(CBZ.scene);
       or just CBZ.studio.settle() below, which does both in the right order
       and is idempotent. */
    batch: {
      gives: "the two one-time passes that make a real city fabric cheap: " +
             "static geometry merged into a handful of draw calls, and " +
             "per-frame matrix recomputation switched off for everything " +
             "that will never move. CBZ.studio.settle() runs both in order",
      needs: ["boot"],
      files: ["core/batch.js", "core/staticfreeze.js"],
      publishes: ["batchStaticUnder", "freezeStaticUnder"],
    },
    citycore: {
      gives: "THE REAL CITY FABRIC: cityMakeBuilding, the one mint every shell " +
             "in Gang City comes from — enterable glass towers with pooled " +
             "instanced panes, stairs, doors, furnished floors — plus buildTown, " +
             "the street generator that lays a grid of marked roads, sidewalks, " +
             "crosswalks, non-overlapping lots, shops with signs and a skyline " +
             "cluster. Ask for a downtown with CBZ.studio.town(); nothing in it " +
             "is a stage flat",
      needs: ["look", "seed"],
      files: ["vendor/BufferGeometryUtils.js", "city/buildings.js", "city/furniture.js", "city/towngen.js"],
      publishes: ["cityMakeBuilding", "buildTown"],
    },
    militaryisland: {
      gives: "the REAL military island from the Gang City map, raised at its " +
             "authored place (centre -620,-700): fenced perimeter, airstrip with " +
             "parked fighters and the heavy bomber, cargo apron, helipads, motor " +
             "pool. Load it, then CBZ.studio.raise('militaryisland') builds it. " +
             "Same files as `military`, named separately so a page that only " +
             "wants the MODELS never raises an island by accident",
      needs: ["military"],
      files: ["city/island_military.js"],
      publishes: [],
    },
    airport: {
      gives: "the REAL civil airport island from the Gang City map (Halloran " +
             "Field, x -900..290, z -280..40): terminal, gates, tower, aprons " +
             "and parked airliners. Load it, then CBZ.studio.raise('airport')",
      // citycore, because the TERMINAL is a real shell: island_airport.js calls
      // cityMakeBuilding to raise it. Measured as a live fault — a page that
      // asked for `airport` alone got "[studio.raise] airport TypeError:
      // CBZ.cityMakeBuilding is not a function" and an airfield with no
      // terminal on it. bomb-survivor never saw it because it happens to name
      // citycore for its own downtown, which is exactly how an under-declared
      // dependency hides.
      needs: ["look", "military", "seed", "citycore"],
      files: ["city/island_airport.js"],
      publishes: ["cityCivilAircraftRayTest"],
    },

    /* THE REST OF GANG CITY'S VENUES, BY NAME.

       Every file below already registers a landmass builder and has since the
       day it was written — they were only ever reachable through a full world
       build, which a slice page never runs. raise() was the door; these are
       the handles. A venue costs one declaration here because the geometry is
       ALREADY BUILT: nothing in this block authors a wall.

       The rule the airport learned the hard way is the only trap: name every
       pack whose publishes/ the builder actually calls, or the venue raises
       half-built with a TypeError in the console and nobody notices. The
       `needs` below were read off the builders, not guessed. */
    govcomplex: {
      gives: "the REAL government complex: the seat of state with its wings, " +
             "secure perimeter, strongrooms and the presidential office. Sites " +
             "are computed at build time (CBZ.govComplexes lists them once " +
             "raised), so measure the footprint rather than assuming a centre",
      needs: ["look", "citycore"],           // buildStrongroom raises real shells
      files: ["city/govcomplex.js"],
      publishes: ["govComplexes", "govComplexAudit"],
    },
    marina: {
      gives: "the REAL marina: basin, pontoons, moored boats and the quay. " +
             "Floating pontoons follow the water when MARINA_FLOAT is on",
      // marina.js will not build on grass: its site walk needs cityWaterAt to
      // find navigable water east of the seawall, and returns null rather than
      // put a basin on a field. waterfield.js is where that answer lives, so
      // it is part of the venue, not an optional extra.
      needs: ["look"],
      files: ["city/waterfield.js", "city/marina.js"],
      publishes: ["cityWaterAt"],
    },
    capeharbor: {
      gives: "Cape Harbor airfield — the small coastal strip with its apron " +
             "and helipads, authored well away from Halloran Field so a page " +
             "can raise both and have two airfields to fight over",
      // TWO under-declared dependencies, both silent. capeharbor's builder is
      // one `if (!CBZ.buildAirfield) return;` so without airport_kit.js it
      // raises NOTHING and says nothing; and the kit's own line 73 calls
      // CBZ.registerAirport UNGUARDED, so without systems/airports.js it
      // throws into raise()'s try/catch and the venue is just as empty.
      // registerCityRegion is fine — studio stubs it above — and
      // cityStaffPost is guarded at the call site.
      needs: ["look"],
      files: ["systems/airports.js", "city/airport_kit.js", "city/airport_capeharbor.js"],
      publishes: ["buildAirfield", "airportKit", "registerAirport"],
    },
    speedway: {
      gives: "the REAL speedway island: banked oval with a measured centreline, " +
             "grandstands and the pit lane. The track surface is a genuine " +
             "height field, which makes it the one venue where flat ground lies",
      needs: ["look"],
      files: ["city/island_speedway.js"],
      publishes: [],
    },
    bank: {
      gives: "the REAL bank: banking hall, the vault and its approach",
      needs: ["look", "citycore"],
      files: ["city/bank.js"],
      publishes: [],
    },
    casino: {
      gives: "the REAL casino: floor, tables and the back of house",
      needs: ["look"],
      files: ["city/casino.js"],
      publishes: [],
    },

    // ---- the living assets: every animal Gang City owns ---------------------
    bestiary: {
      gives: "THE WHOLE BESTIARY: 54 species as CBZ.WILDLIFE_SPECIES — lions, " +
             "wolves, bears, the gorilla, elephants, dogs, the sea's sharks and " +
             "orcas — each with its authored stats (hp, speed, danger, bite, " +
             "herd) and a low-poly build() that returns the posed body. Data " +
             "and geometry only: no engine, no spawning, no hunt",
      needs: ["look"],
      files: ["city/wildlife_species.js",
        "city/wildlife/forest_deer.js", "city/wildlife/bears.js",
        "city/wildlife/canines.js", "city/wildlife/apes.js",
        "city/wildlife/bigcats.js", "city/wildlife/megafauna.js",
        "city/wildlife/farm.js", "city/wildlife/snow_ungulates.js",
        "city/wildlife/small_game.js", "city/wildlife/snakes.js",
        "city/wildlife/aquatic.js"],
      publishes: ["WILDLIFE_SPECIES", "defineSpecies"],
    },
    beasts: {
      gives: "animals that WALK, FIGHT and DIE without the full city: the " +
             "shared discovered gait rig (wildlife_rig), the one animal-attack " +
             "driver creatureFight (lunge, pounce, maul, gore, stomp — windup, " +
             "strike, recover, flinch), the land body layer that poses jaws and " +
             "legs through a strike, the verlet corpse solver that lays a dead " +
             "quadruped on its flank with its legs splayed, and the ape move " +
             "set — a knuckle-walker charges, hammers, backhands, beats its " +
             "chest and PICKS A MAN UP and swings him, which the one generic " +
             "maul could never be",
      /* THE SOLVER RIDES WITH THE FIGHT, and that is a correction, not a
         convenience. A pack that can make an animal attack but not die
         properly is a pack that hands every page it serves the exact death
         quadruped_ragdoll.js was written to delete — a corpse sat upright with
         its nose at the sky, because the only fallback left is a canned
         rotation. games/battle.html was the proof: it loaded `beasts`, ran real
         animal combat, and had no solver at all. Discovery-driven and
         self-budgeting, so it costs a page that never kills anything nothing. */
      /* AND SO DOES THE APE, for the same reason in the other direction: the
         one thing `beasts` exists to serve is games/battle.html, and the
         matchup that page is asked for by name is a hundred men against a
         gorilla. `caps` joins the needs because ape_combat reaches its
         bystanders through the capability bus (CBZ.worldActors /
         CBZ.hurtWorldActor) rather than one branch per host — without that
         pack a backhand has nobody to reach. */
      needs: ["look", "caps"],
      files: ["city/wildlife_rig.js", "city/creature_combat.js", "systems/predator_anim.js",
        "systems/quadruped_ragdoll.js", "systems/ape_combat.js"],
      publishes: ["wildlifeRig", "creatureFight", "faceAnimalHeading", "quadRagdoll",
        "apeStep", "apeAudit"],
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
    blood: {
      gives: "what a body does when something opens it: the directional spray, " +
             "the atomised mist, the ground pool, the wall splat and the drip " +
             "trail — CBZ.goreImpact and CBZ.gore. Restraint is built in (mist " +
             "only on a real crunch, a pool only once the skin is genuinely " +
             "open), so it does not turn every hit into a bloodbath",
      /* ITS OWN PACK, and it is a fair-weather one on purpose. A page that
         fights with guns already draws its impacts through gunfx; the file
         below is what an ANIMAL's jaws need (creature_combat's biteBlood),
         and 2.5k lines of it should not ride along on a battle of riflemen
         that will never call it. Callers pull it in when the roster earns it —
         games/battle.html asks for it exactly when a side is a beast army. */
      needs: ["fx"],
      files: ["systems/gore.js"],
      publishes: ["gore", "goreImpact", "goreAudit"],
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
      // Files load one at a time (need() awaits each), so whatever calls
      // addLandmass while this file executes belongs to this file. That stamp
      // is what lets raise() run ONE island's builders and not the world's.
      _loadingFile = rel;
      s.onload = function () { loaded[rel] = 1; _loadingFile = null; resolve(); };
      s.onerror = function () { _loadingFile = null; reject(new Error("studio: cannot load " + ROOT + rel)); };
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

  /* ---- WARM AND PROGRESS ---------------------------------------------------
     THE LOAD ORDER IS THE CONTRACT AND THE LOAD *TIME* WAS AN ACCIDENT.

     need() executes files one at a time and awaits each, which is right —
     several of these throw if loaded early, and the addLandmass stamp above
     depends on exactly one file being in flight when it fires. But awaiting
     each file also DOWNLOADS them one at a time, so a page naming ten packs
     paid ten serial round trips before the first line of its game ran. On the
     deployed site (GitHub Pages, one hop per file) that is the whole boot.

     warm() separates the two. A `<link rel=preload as=script>` fetches a file
     into the HTTP cache and does NOT execute it, so the chain below keeps its
     exact serial execution and finds every file already in hand. Downloads go
     wide; execution stays single file. Nothing about ORDER changes, which is
     why this is safe to do for every page at once.

     A page also cannot draw a progress bar for a load it cannot see, so
     onProgress reports each file as it lands. Both are additive: a page that
     ignores them behaves exactly as before. */
  const warmed = Object.create(null);
  CBZ.studio.warm = function (rels) {
    if (!rels || !rels.length || CBZ.CONFIG.STUDIO_V1 === false) return 0;
    let n = 0;
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i];
      if (!rel || loaded[rel] || inflight[rel] || warmed[rel] || alreadyInDocument(rel)) continue;
      warmed[rel] = 1;
      const l = document.createElement("link");
      l.rel = "preload"; l.as = "script"; l.href = ROOT + rel;
      document.head.appendChild(l);
      n++;
    }
    return n;
  };
  /* prefetch(packs...) — warm everything those packs WOULD load, without
     loading any of it. A menu can warm the map the player is hovering. */
  CBZ.studio.prefetch = function () {
    const plan = CBZ.studio.plan.apply(null, arguments);
    CBZ.studio.warm(plan.files);
    return plan;
  };
  const progressCbs = [];
  CBZ.studio.onProgress = function (cb) {
    if (typeof cb === "function") progressCbs.push(cb);
    return CBZ.studio;
  };
  function tellProgress(info) {
    for (let i = 0; i < progressCbs.length; i++) { try { progressCbs[i](info); } catch (e) {} }
  }

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
    // wide download, narrow execution
    CBZ.studio.warm(plan.files);
    const total = plan.files.length;
    let done = 0;
    let chain = Promise.resolve();
    plan.files.forEach(function (f) {
      chain = chain.then(function () { return loadFile(f); }).then(function () {
        done++;
        tellProgress({ file: f, done: done, total: total, frac: total ? done / total : 1 });
      });
    });
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

  /* settle(root) — THE WORLD IS FINISHED; STOP PAYING FOR IT EVERY FRAME.

     Two passes, in the one order that works: merge first (batch rewrites the
     graph), freeze second (freeze locks what merge left). Call it once the
     ground is built and BEFORE the people go in — anything added afterwards
     keeps its own live matrix and is never baked, which is exactly why the
     order is "world, settle, actors" and not "everything, settle".

     Silent and safe when the `batch` pack is not loaded: a page that never
     asks for it behaves as it always did, just more expensively. */
  CBZ.studio.settle = function (root) {
    const r = root || CBZ.scene;
    if (!r) return null;
    const out = { merged: null, frozen: null };
    if (CBZ.batchStaticUnder) { try { out.merged = CBZ.batchStaticUnder(r); } catch (e) { try { console.warn("[studio.settle] batch", e); } catch (e2) {} } }
    if (CBZ.freezeStaticUnder) { try { out.frozen = CBZ.freezeStaticUnder(r); } catch (e) { try { console.warn("[studio.settle] freeze", e); } catch (e2) {} } }
    return out;
  };

  /* ==========================================================================
     THE WORLD CONTRACT — a pack never asks WHICH world it landed in.

     It asks the world questions: where is the ground, where is the water.
     Any page that answers them gets conduct for free — a chase camera that
     stays out of the hill, ordnance that knows where dirt is, crowds that
     stand on the floor, and every future pack (boats, wildlife) that needs to
     know sea from land. Same law as CBZ.modeHas, one level down.

       CBZ.studio.setWorld({ groundAt: fn(x,z), waterAt: fn(x,z), seaLevel: 0 })

     Additive and degrade-safe: nothing anywhere REQUIRES CBZ.world; every
     consumer feature-detects it and keeps its old inline answer. */
  CBZ.studio.setWorld = function (api) {
    api = api || {};
    const W = (CBZ.world = CBZ.world || {});
    if (typeof api.groundAt === "function") W.groundAt = api.groundAt;
    if (typeof api.waterAt === "function") W.waterAt = api.waterAt;
    if (api.seaLevel != null) W.seaLevel = api.seaLevel;
    return W;
  };

  /* ==========================================================================
     raise(pack, opts) — BUILD A REAL PIECE OF THE GANG CITY MAP, HERE.

     The islands in city/ register themselves as landmass builders and wait
     for a world build that a slice page never runs. raise() runs them: it
     takes the builders the named pack's files registered (the collector above
     stamped each with its file), synthesizes the small `city` context they
     actually read — root, roads, regions, a note sink — and calls them in
     their authored order, each try/caught so one bad builder cannot sink the
     rest (the worldmap contract, kept).

     The island builds at its AUTHORED map coordinates, which is the point:
     a page that raises the military base and the airport is standing on Gang
     City's own geography, and a game grown there transfers.

       const base = CBZ.studio.raise("militaryisland");
       base.roads      // every road record the builders pushed
       base.regions    // every walkable region they filed

     Returns the city context, or null when there was nothing to raise (no
     collector — a full city owns the registry — or no builders from that
     pack). */
  CBZ.studio.raise = function (name, opts) {
    opts = opts || {};
    if (!CBZ.addLandmass || !CBZ.addLandmass._studioCollector) return null;
    const P = PACKS[name];
    const files = P ? P.files : [String(name)];
    const list = (CBZ._landmassBuilders || [])
      .filter(function (b) { return b.file && files.indexOf(b.file) >= 0 && !b._raised; })
      .sort(function (a, b) { return a.order - b.order; });
    if (!list.length) return null;
    const city = opts.city || {};
    if (!city.root) city.root = opts.parent || CBZ.scene;
    if (!city.roads) city.roads = [];
    if (!city.regions) city.regions = [];
    if (!city.note) city.note = opts.note || function () {};
    /* THE BOUNDS ARE NOT OPTIONAL, EVEN WHEN THERE IS NO CITY.

       88 reads of city.minX / maxX / minZ / maxZ / center are spread across
       the venue builders, because on the mainland a landmass builder is
       handed a world that already knows how big it is. A slice page hands it
       nothing, and `city.maxX + 26` is NaN — which does not throw. It builds:
       the marina raised its seawall at NaN and the venue came back EMPTY with
       a clean console, indistinguishable from a pack that failed to load.

       A finite default is the difference between a venue that works and a
       venue that silently is not there. Override via opts.city for a page
       that has real bounds. */
    const R = opts.extent == null ? 1200 : opts.extent;
    if (city.center == null) city.center = { x: 0, y: 0, z: 0 };
    if (city.minX == null) city.minX = city.center.x - R;
    if (city.maxX == null) city.maxX = city.center.x + R;
    if (city.minZ == null) city.minZ = city.center.z - R;
    if (city.maxZ == null) city.maxZ = city.center.z + R;
    if (city.radius == null) city.radius = R;
    for (let i = 0; i < list.length; i++) {
      list[i]._raised = true;             // an island raised twice is two islands
      try { list[i].fn(city); }
      catch (e) { try { console.error("[studio.raise]", name, e); } catch (e2) {} }
    }
    return city;
  };

  /* ==========================================================================
     heightfield(root, opts) — WHERE IS THE GROUND? MEASURE IT, DO NOT DECLARE IT.

     A slice page that raises a venue has to answer one question for every man
     it puts on it: what is the surface height at (x,z)? Until now each page
     answered it by hand, and games/battle.html shows what that costs — four
     of its five maps declared `groundAt = () => 0` and the fifth borrowed the
     desert's analytic terrain. Flat is right until a venue has a banked track,
     a raised deck or a sloped apron, and then every man on it stands at the
     wrong height with nothing in the repo able to see it: the page's own
     checker measures overlap in XZ and never looks at Y.

     So: build the venue, then ASK IT. One downward ray per grid point, once,
     against the venue's own subtree, and bilinear interpolation between them.
     The field is measured from the same geometry the player sees, which means
     it cannot drift from it — the class of bug is gone, not fixed.

     Cost is one-time and bounded: `step` metres apart over the venue's own
     footprint, capped at MAX_CELLS rays no matter how large the venue, and
     cast against a subtree rather than the scene (pass the group you raised
     into, not CBZ.scene, or you will pay for the skybox).

       const g = CBZ.studio.raise("militaryisland", { parent: venue });
       const H = CBZ.studio.heightfield(venue);
       H.heightAt(x, z)   // metres, interpolated
       H.miss             // grid points where no ray hit anything

     Returns null when there is nothing under the root to measure.           */
  const MAX_CELLS = 96;                       // 96×96 = 9216 rays, ~one frame
  CBZ.studio.heightfield = function (root, opts) {
    opts = opts || {};
    root = root || CBZ.scene;
    // bare `THREE` would ReferenceError on a page that never loaded it; every
    // other reference in this file goes through window for the same reason.
    const T = window.THREE;
    if (!root || !T) return null;

    /* FOOTPRINT. Box3 over the subtree, except that one 26 km sea plate would
       swallow the grid and spend every ray on open water, so anything wider
       than `maxSpan` is measured for its Y and excluded from the bounds. */
    /* WORLD MATRICES FIRST, OR EVERY VENUE MEASURES AT THE ORIGIN.

       A venue is raised and measured in the same tick, before any render, so
       nothing has propagated matrixWorld down the new subtree yet — and most
       of this geometry is matrixAutoUpdate:false with a hand-called
       updateMatrix(), which sets the LOCAL matrix only. r128's expandByObject
       refreshes each object against its parent's EXISTING matrixWorld, so a
       stale parent silently reports every child at 0,0. Measured: island,
       speedway and gov all came back centred on the origin with a 40 m span
       until this line existed. */
    root.updateMatrixWorld(true);

    const maxSpan = opts.maxSpan == null ? 4000 : opts.maxSpan;
    const parts = [];
    const one = new T.Box3();
    root.traverse(function (o) {
      if (!o.isMesh || !o.visible) return;
      one.setFromObject(o);
      if (!isFinite(one.min.x) || !isFinite(one.max.x)) return;
      if (one.max.x - one.min.x > maxSpan || one.max.z - one.min.z > maxSpan) return;
      parts.push(one.clone());
    });
    if (!parts.length) return null;

    /* THE BOUNDING BOX IS THE WRONG FOOTPRINT FOR A VENUE THAT BUILDS IN MORE
       THAN ONE PLACE. govcomplex raises every seat of state on the map: the
       union of them spans 3.1 km, 94% of which is empty air between compounds.
       Measured over that box the grid is mostly misses, the ray budget is
       spent on nothing, and a page that centres an event on it puts the two
       halves of a fight a kilometre apart with a field between them.

       So find where the geometry actually IS. Histogram the parts into cells,
       take the densest one, and keep only what lies within `focus` metres of
       it. One venue is unaffected (everything is in the cluster); a scattered
       pack resolves to its biggest site, which is the one worth standing on. */
    const focus = opts.focus == null ? 320 : opts.focus;
    let cxc = 0, czc = 0;
    if (focus > 0 && parts.length > 1) {
      const cell = Math.max(20, focus / 3);
      const bins = new Map();
      for (let i = 0; i < parts.length; i++) {
        const px = (parts[i].min.x + parts[i].max.x) / 2, pz = (parts[i].min.z + parts[i].max.z) / 2;
        const k = Math.round(px / cell) + ":" + Math.round(pz / cell);
        const b = bins.get(k);
        if (b) { b.n++; b.x += px; b.z += pz; } else bins.set(k, { n: 1, x: px, z: pz });
      }
      let best = null;
      bins.forEach(function (b) { if (!best || b.n > best.n) best = b; });
      cxc = best.x / best.n; czc = best.z / best.n;
    } else {
      cxc = (parts[0].min.x + parts[0].max.x) / 2;
      czc = (parts[0].min.z + parts[0].max.z) / 2;
    }
    const box = new T.Box3();
    let any = false;
    const r2 = focus > 0 ? focus * focus : Infinity;
    for (let i = 0; i < parts.length; i++) {
      const px = (parts[i].min.x + parts[i].max.x) / 2, pz = (parts[i].min.z + parts[i].max.z) / 2;
      const dx = px - cxc, dz = pz - czc;
      if (dx * dx + dz * dz > r2) continue;
      box.union(parts[i]); any = true;
    }
    if (!any || !isFinite(box.min.x)) return null;

    const pad = opts.pad == null ? 40 : opts.pad;
    const minX = box.min.x - pad, maxX = box.max.x + pad;
    const minZ = box.min.z - pad, maxZ = box.max.z + pad;
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    let step = opts.step == null ? 6 : opts.step;
    // never exceed the ray budget, whatever the venue's size
    step = Math.max(step, spanX / MAX_CELLS, spanZ / MAX_CELLS);
    const cols = Math.max(2, Math.ceil(spanX / step) + 1);
    const rows = Math.max(2, Math.ceil(spanZ / step) + 1);

    const ray = new T.Raycaster();
    ray.far = opts.far == null ? 1200 : opts.far;
    const org = new T.Vector3(), down = new T.Vector3(0, -1, 0);
    const top = box.max.y + 50;
    const floor = opts.floor == null ? box.min.y : opts.floor;
    const h = new Float32Array(cols * rows);
    let miss = 0, lo = Infinity, hi = -Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = minX + i * step, z = minZ + j * step;
        org.set(x, top, z);
        ray.set(org, down);
        const hit = ray.intersectObject(root, true);
        /* THE FIRST HIT IS NOT ALWAYS THE FLOOR. A ray dropped on a hangar
           hits its roof, and a man does not stand on the roof. Take the
           LOWEST hit above the venue's floor plane: that is the surface you
           walk on, and a roof stops being an answer. */
        let y = null;
        for (let k = 0; k < hit.length; k++) {
          const py = hit[k].point.y;
          if (py < floor - 0.5) continue;
          if (y == null || py < y) y = py;
        }
        if (y == null) { y = floor; miss++; }
        h[j * cols + i] = y;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }

    function heightAt(x, z) {
      const fx = (x - minX) / step, fz = (z - minZ) / step;
      let i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0) i = 0; else if (i > cols - 2) i = cols - 2;
      if (j < 0) j = 0; else if (j > rows - 2) j = rows - 2;
      const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
      const a = h[j * cols + i], b = h[j * cols + i + 1];
      const c = h[(j + 1) * cols + i], d = h[(j + 1) * cols + i + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
    return {
      heightAt: heightAt, box: box, cols: cols, rows: rows, step: step,
      minX: minX, minZ: minZ, minY: lo, maxY: hi, miss: miss,
      cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2,
      spanX: box.max.x - box.min.x, spanZ: box.max.z - box.min.z,
    };
  };

  /* ==========================================================================
     town(opts) — A REAL DOWNTOWN, BY NAME.

     city/towngen.js is the generator every settlement in Gang City grows
     from, and city/buildings.js is the one mint every enterable shell comes
     from. This verb is the missing door: it hands buildTown a seeded rng, a
     downtown recipe and a skyline plan, so a page gets marked streets,
     sidewalks, crosswalks, shops with lit signs and vendors' counters, and a
     CLUSTER of real glass towers — the same instanced-pane, stairs-inside,
     door-in-the-facade shells the mainland is made of. Nothing here is new
     geometry; it is the city's own fabric, called.

       const town = CBZ.studio.town({ at: {x:0, z:-700}, seed: "talloran" });
       town.lots        // every lot; lot.building.door is a REAL doorway
       town.roads       // the street grid, with lane metadata
       town.rect        // the footprint

     opts: at {x,z} · seed · cols/rows · blockW/blockD/roadW · name ·
           skyline (towngen shape) · prefabs (overrides the recipe) ·
           parent (default CBZ.scene). Deterministic per seed. */
  CBZ.studio.town = function (opts) {
    opts = opts || {};
    if (typeof CBZ.buildTown !== "function") return null;
    const root = opts.parent || CBZ.scene;
    // seeded local LCG — the determinism law forbids Math.random in layout
    const ss = String(opts.seed == null ? "studio-town" : opts.seed);
    let h = 2166136261;
    for (let i = 0; i < ss.length; i++) { h ^= ss.charCodeAt(i); h = (h * 16777619) >>> 0; }
    const rng = (function (s) {
      let x = s >>> 0 || 1;
      return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
    })(h);
    // THE DOWNTOWN RECIPE. Weighted prefabs per zone: towngen builds nothing
    // from an empty recipe, so the verb carries a real one — office glass and
    // trades in the core, apartments outward. A page overrides with its own
    // prefabs to change the town's character without touching the generator.
    const prefabs = opts.prefabs || {
      civic: [
        { name: "Exchange Bank", w: 2, storeys: 6, color: 0x46607a, lotKind: "shop", shopKind: "bank" },
        { name: "Meridian Tower", w: 3, storeys: 8, color: 0x3e5a74, lotKind: "shop", shopKind: "security" },
        { name: "Civic Center", w: 1, storeys: 5, color: 0x54626e, lotKind: "shop", shopKind: "hardware" },
      ],
      commercial: [
        { name: "Glasshouse Offices", w: 3, storeys: 7, color: 0x3a4e64, lotKind: "shop", shopKind: "security" },
        { name: "Harbor Market", w: 2, storeys: 3, color: 0x62707c, lotKind: "shop", shopKind: "food" },
        { name: "Corner Bar", w: 1, storeys: 3, color: 0x5a4a3c, lotKind: "shop", shopKind: "bar" },
        { name: "Pawn & Gold", w: 1, storeys: 2, color: 0x6b5d44, lotKind: "shop", shopKind: "pawn" },
        { name: "Clinic", w: 1, storeys: 4, color: 0x9aa3ab, lotKind: "shop", shopKind: "hospital" },
      ],
      residential: [
        { name: "Riverside Flats", w: 3, storeys: 4, color: 0x6e6a62, lotKind: "home" },
        { name: "Block Housing", w: 2, storeys: 3, color: 0x75706a, lotKind: "home" },
        { name: "Terrace Homes", w: 1, storeys: 2, color: 0x7d7468, lotKind: "home" },
      ],
    };
    const at = opts.at || { x: 0, z: 0 };
    const cfg = {
      cx: at.x || 0, cz: at.z || 0,
      cols: opts.cols || 6, rows: opts.rows || 6,
      blockW: opts.blockW || 42, blockD: opts.blockD || 42, roadW: opts.roadW || 14,
      pattern: opts.pattern || "grid",
      density: opts.density != null ? opts.density : 0.85,
      name: opts.name || "Downtown", district: opts.district || "downtown",
      rng: rng, prefabs: prefabs, region: opts.region || null,
      integratedSkyline: true,
      skyline: opts.skyline || {
        minStoreys: 4, maxStoreys: 9, landmarkStoreys: 24,
        towerFrac: 0.3, megaChance: true, townMax: 5,
      },
      palette: opts.palette || {
        ground: 0x8b8f96, sidewalk: 0x9aa0a8, road: 0x33363c,
        plaza: 0xa8adb4, wood: 0x5a6470, accent: 0x8a94a0,
      },
    };
    return CBZ.buildTown(root, cfg);
  };

  /* crowd(n, role, opts) — N shipped bodies, placed and parented. The whole
     point of the asset farm: a page that wants people gets people.
       opts.at(i)  -> {x,z,y?}  placement, called per body (else a ring)
       opts.color             team/faction colour
       opts.parent            defaults to CBZ.scene
       opts.wander            they LIVE: seeded strolling on the real gait,
                              sliding along real colliders, standing on the
                              world's own ground. A city read as a city from
                              the air because forty statues stood in it was a
                              lie; a person is a body that goes somewhere.
         wander: true | { range: 46, speed: 1.25, pause: 2.5 }
     Returns the array of groups, empty when `people` is not loaded. The array
     carries .stop() to end the wandering. */
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
    out.stop = function () {};
    if (opts.wander && out.length && CBZ.micro && CBZ.micro.onFrame) {
      const W = opts.wander === true ? {} : opts.wander;
      const range = W.range > 0 ? W.range : 46;
      const speed = W.speed > 0 ? W.speed : 1.25;
      const pauseFor = W.pause > 0 ? W.pause : 2.5;
      // seeded, not Math.random: crowds are world dressing and the
      // determinism law does not stop applying because a thing is small
      const roll = CBZ.seedStream ? CBZ.seedStream("studio-crowd-" + role)
        : (function () { let s = 0x9e3779b9; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
      const groundAt = W.groundAt || (CBZ.world && CBZ.world.groundAt) || null;
      const walkers = out.map(function (g) {
        return { g: g, hx: g.position.x, hz: g.position.z, tx: g.position.x, tz: g.position.z, wait: roll() * pauseFor, yaw: g.rotation.y };
      });
      let live = true;
      CBZ.micro.onFrame(function (dt) {
        if (!live) return;
        for (let i = 0; i < walkers.length; i++) {
          const w = walkers[i], g = w.g;
          if (!g.parent) continue;                       // dropped: leave it be
          if (g.userData.dead) continue;                 // a page may kill one
          const dx = w.tx - g.position.x, dz = w.tz - g.position.z;
          const d = Math.hypot(dx, dz);
          let moving = false;
          if (w.wait > 0) { w.wait -= dt; }
          else if (d < 0.6) {
            const a = roll() * Math.PI * 2, r = 6 + roll() * range;
            w.tx = w.hx + Math.cos(a) * r; w.tz = w.hz + Math.sin(a) * r;
            w.wait = pauseFor * (0.4 + roll());
          } else {
            const vx = dx / d, vz = dz / d;
            g.position.x += vx * speed * dt;
            g.position.z += vz * speed * dt;
            // the engine's own slide resolver: a walker uses doors and corners
            // rather than passing through the town like a ghost
            if (CBZ.micro.resolveCircle) CBZ.micro.resolveCircle(g.position, 0.42, g.position.y, 1.8);
            const wantYaw = Math.atan2(vx, vz);
            let dy = wantYaw - w.yaw;
            while (dy > Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            w.yaw += dy * Math.min(1, dt * 6);
            g.rotation.y = w.yaw;
            moving = true;
          }
          if (groundAt) g.position.y = groundAt(g.position.x, g.position.z);
          // animChar(ch, SPEED, DT) — entities/character.js:1430. This call had
          // the last two arguments swapped, which is not a no-op and is not
          // caught by the try/catch: `speed` read the frame dt (0.016, always
          // below the 0.2 walk threshold, so a walking crowd never animated)
          // and `ch.breath += dt` added an OBJECT to a number, turning the
          // rig's own phase accumulator into the string "2.28…[object Object]"
          // on the first frame and NaN on every trig call after it.
          if (CBZ.animChar && g.userData.charRig) {
            try { CBZ.animChar(g.userData.charRig, moving ? speed : 0, dt); } catch (e) {}
          }
        }
      });
      out.stop = function () { live = false; };
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

    /* THE AIRFRAME'S ORIGIN IS NOT THE MODEL'S ORIGIN, AND NOTHING SAID SO.

       systems/airframe.js treats af.pos as a point gearHeight ABOVE the
       wheels: step() clamps pos.y to `groundAt + P.gearHeight` and will not
       let it go lower. The models world/airbase.js hands out are seated the
       other way round — their wheels sit at local y = 0, because that file
       exists to put PARKED aeroplanes flat on the concrete. applyTo() copies
       pos straight through, so the two conventions differed by exactly
       gearHeight and every flown model rode that high.

       In the air it is invisible: 3.4 m of error at 320 m of altitude is
       nothing, which is why it survived. On the ground it is the whole first
       impression — Bomb Survivor's B-2 sat a MEASURED 3.40 m over its own
       runway, wheels in mid-air, which is what "the plane is floating" was.

       One wrapper reconciles them. The returned group's origin IS the
       airframe's reference point, and the model hangs below it by exactly the
       distance down to its own lowest geometry, measured rather than assumed —
       a model the pack already seated and one it did not both come out right,
       and a page that never heard of gearHeight cannot get it wrong. */
    let mount = g;
    if (af && af.spec && af.spec.gearHeight > 0 && THREE.Box3) {
      const box = new THREE.Box3().setFromObject(g);
      if (isFinite(box.min.y)) {
        const drop = -af.spec.gearHeight - box.min.y;
        if (Math.abs(drop) > 0.01) {
          mount = new THREE.Group();
          g.position.y += drop;
          mount.add(g);
        }
      }
    }

    const parent = opts.parent || CBZ.scene;
    if (parent && parent.add) parent.add(mount);
    return { group: mount, af: af };
  };

  /* drop(obj) — REMOVE IT AND GIVE THE MEMORY BACK.

     `parent.remove(obj)` unhooks it from the scene graph and leaves every
     BufferGeometry and Material it owns resident on the GPU. That is not a
     leak you notice: it is a slow climb, and it was measured here at +11.7 MB
     per aircraft, monotonic, in a game that respawns aircraft on a nine second
     timer. Any page that spawns and despawns needs this and no page had it.

     SHARED assets are spared. materials.js caches materials and geometry
     behind `_shared`, and microboot's own helpers do the same, so disposing
     one of those would blank every other object using it. Anything a page
     wants kept regardless takes `userData.keepAssets = true`. */
  CBZ.studio.drop = function (obj) {
    if (!obj) return 0;
    let freed = 0;
    const seenG = new Set(), seenM = new Set();
    obj.traverse(function (o) {
      if (o.userData && o.userData.keepAssets) return;
      if (o.geometry && !o.geometry._shared && !seenG.has(o.geometry)) {
        seenG.add(o.geometry);
        if (o.geometry.dispose) { o.geometry.dispose(); freed++; }
      }
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (let i = 0; i < list.length; i++) {
        const mm = list[i];
        if (!mm || mm._shared || seenM.has(mm)) continue;
        seenM.add(mm);
        // a texture a material owns goes with it, unless it is shared too
        for (const k of ["map", "normalMap", "emissiveMap", "alphaMap", "roughnessMap"]) {
          const t = mm[k];
          if (t && !t._shared && t.dispose) t.dispose();
        }
        if (mm.dispose) { mm.dispose(); freed++; }
      }
    });
    if (obj.parent) obj.parent.remove(obj);
    return freed;
  };

  /* structureAt(x, z, reach) — WHAT IS STANDING HERE.

     Reads CBZ.colliders, which is the registry the whole engine already writes
     and reads, and returns the nearest full-height box's own record — its
     centre, its extents and its height — or null over open ground. A world
     declares a building by registering one collider with a `ref`; nothing here
     knows what a lot, a district or a city is, so the prison, the desert and
     the city all answer the same way.

     `reach` lets a near miss still find the wall it went off beside, which is
     what a bomb actually does to a building. */
  CBZ.studio.structureAt = function (x, z, reach) {
    const list = CBZ.colliders;
    if (!list || !list.length) return null;
    const R = reach > 0 ? reach : 0;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.y0 != null) continue;                 // height-gated: a rail, a roof, not a structure
      const r = c.ref;
      if (!r || !(r.w > 0) || !(r.h > 0)) continue;     // a record that cannot describe itself
      if (r.alive === false) continue;
      const dx = Math.max(c.minX - x, 0, x - c.maxX);
      const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
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
    // cityExplosionCore's signature is (x, z, opts) with the detonation HEIGHT
    // riding opts.y — this call used to pass (x, y, z, opts), so every slice
    // page's fireball drew at z≈1 with the default 6 m radius and its own
    // mis-aimed damage sweep. Measured from games/battle.html: rockets whose
    // blast damage landed (boom's own sweep below is aimed right) while the
    // flame bloomed a map away. noDamage because the roster sweep is done
    // HERE, once, through modecaps — the core's internal applyBlastDamage
    // would run the same blastWorldActors again and double-kill.
    if (CBZ.cityBlastCore) {
      try {
        CBZ.cityBlastCore(pos.x, pos.z, {
          power: power, radius: R / Math.max(0.2, power),
          y: pos.y || 1, noDamage: true, byPlayer: !!opts.byPlayer,
        });
        drew = true;
      } catch (e) {}
    }
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
    const struck = opts.structural === false ? null : CBZ.studio.collapseAt(pos, opts);
    return { drew: drew, hit: hit, struck: struck };
  };

  /* collapseAt(pos, opts) — THE STRUCTURAL HALF ON ITS OWN.

     systems/ordnance.js already draws its own fireball and applies its own
     damage when a store goes off, so a page hooking onDetonate and calling
     boom() there gets the explosion TWICE: two fireballs, two bangs, and the
     sound stacking seven deep across a stick. What ordnance does not do is
     bring the building down, and that is the only part such a hook wants.

     cityAirstrikeCollapse resolves a facade out of whatever it is given, and
     given only a point it has to guess the footprint. The world already knows:
     the structure under the impact is a collider with a `ref` carrying its own
     extents. Hand over the real lot and the collapse lands on the real face at
     the real roofline. Returns the struck record, or null over open ground. */
  CBZ.studio.collapseAt = function (pos, opts) {
    opts = opts || {};
    if (!CBZ.cityAirstrikeCollapse || !pos) return null;
    const R = opts.radius > 0 ? opts.radius : 18;
    const s = CBZ.studio.structureAt(pos.x, pos.z, opts.reach != null ? opts.reach : R);
    const lot = s ? { cx: s.x, cz: s.z, w: s.w, d: s.d } : { x: pos.x, z: pos.z };
    try {
      CBZ.cityAirstrikeCollapse(lot, {
        at: pos, top: s ? s.h : undefined,
        power: opts.power > 0 ? opts.power : 1, radius: R,
      });
    } catch (e) { return null; }
    return s;
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
    const handles = Object.create(null);
    // Sensible keys for the verbs a page usually has, so a keyboard player gets
    // the same actions the touch buttons give without the page restating them.
    const KEYMAP = opts.keys || {
      fire: "Space", alt: "KeyF", boost: "ShiftLeft",
      sprint: "ShiftLeft", nuke: "KeyN", use: "KeyE",
    };

    let throttleSlider = null;
    const furniture = [];

    /* THE RIGHT-HAND FURNITURE IS ONE BLOCK, SAT DOWN ON THE RADAR.

       The verbs used to march LEFTWARD along the bottom edge — right: 24, 120,
       216 — which walks a second button into the middle of the screen and, on
       a flying page, strands it under a throttle slider it has nothing to do
       with. They are one column now: the slider outboard where it is dragged,
       the verbs inboard where they are tapped, every top edge on one line.

       AND THE BLOCK SITS AS LOW AS THE SCREEN ALLOWS. It used to float in the
       middle of the right edge with ~60 px of dead air under it and the radar
       marooned below that, because each piece was placed by a number somebody
       picked rather than against the thing it had to clear. BASE is that thing
       stated once: the scope is RADAR px tall standing RADAR_GAP off the
       bottom, so nothing may come below its top edge plus a little air — and
       the whole cluster is built UP from that line.

       env(safe-area-inset-bottom) is in there because the furniture layer is
       `inset:0` on the RAW viewport while the radar is placed with the inset,
       so a plain pixel number here and a calc() there drift apart by the
       height of the home indicator and the two overlap on exactly the phones
       this layout is for.

       PWR's cap is the alignment reference: microboot draws it CAP_INSET
       inside the slider's own top edge, and the slider is sized so that line
       lands on the TOP button's top edge. The column fills BOTTOM-UP in
       declaration order, so the verb a page lists first — the one pressed
       every few seconds — is nearest the resting thumb, and a rare armed verb
       (a nuke) is the one you reach up for. */
    const RADAR = 132, RADAR_GAP = 14, AIR = 14;
    const BASEPX = RADAR_GAP + RADAR + AIR;                  // 160 px of scope + air
    const BASE = "calc(" + BASEPX + "px + env(safe-area-inset-bottom,0px))";
    const CAP_INSET = 6;                      // .mt-slider>b { top: 6px }
    const BTN = 76, BTN_GAP = 14;
    const nBtn = Object.keys(btnDefs).length;
    const STACK_H = nBtn * BTN + Math.max(0, nBtn - 1) * BTN_GAP;
    // the throttle is as tall as the stack it aligns to, floored so a page
    // with a single verb still gets a slider long enough to drag accurately
    const PWR = { right: 24, width: 46, height: Math.max(150, STACK_H + CAP_INSET) };
    // where the cap's top edge lands, measured up from the same base
    const STACK_TOP = BASEPX + PWR.height - CAP_INSET;

    if (coarse) {
      T.init({});
      // A FLYING GAME ON A PHONE NEEDS A THROTTLE, and holding a key is not an
      // option there. microboot already ships the slider; nobody had wired it
      // to the one control that actually needs to be held at a value.
      if (kind === "fly" && T.addSlider) {
        throttleSlider = T.addSlider({
          label: "PWR", value: 0.72, right: PWR.right, bottom: BASE,
          width: PWR.width, height: PWR.height,
          onChange: function (v) { C.throttle = v; },
        });
        furniture.push(throttleSlider);
      }
      /* A PHONE MUST BE ABLE TO PAUSE. The engine owns KeyP, and a
         touchscreen has no keys, so a page that never thinks about it ships a
         ten minute half nobody can stop. Added here, once, above the page. */
      if (opts.pause !== false) {
        // TOP LEFT, UNDER THE HEALTH METER — the only free corner. The right
        // one is a column the HUD already owns: .scr sits at top 13 and .fd
        // runs from top 86 down, so a 44 px button at top 16 on that side
        // landed ON the score, which is exactly how it shipped. Health is
        // ~48 px tall from top 14, so 64 clears it.
        furniture.push(T.addButton({
          label: "II", size: 44,
          left: "calc(14px + env(safe-area-inset-left,0px))",
          top: "calc(64px + env(safe-area-inset-top,0px))",
          onDown: function () { if (CBZ.micro) CBZ.micro.paused = !CBZ.micro.paused; },
        }));
      }
      // inboard of the slider when there is one, on the outside edge when
      // there is not — a walking surface has no throttle to clear
      const colRight = throttleSlider ? PWR.right + PWR.width + 16 : 24;
      let i = 0;
      for (const name in btnDefs) {
        (function (n, idx) {
          // idx 0 is the bottom of the stack; the last one declared lands with
          // its top edge on STACK_TOP, level with the PWR cap
          // idx 0 is the bottom of the stack. With a slider the stack hangs
          // from its cap; without one it stands straight on BASE. Either way
          // the lowest button never comes below BASE, which is the radar.
          const up = idx * (BTN + BTN_GAP);
          const bottom = throttleSlider
            ? "calc(" + (STACK_TOP - STACK_H + up) + "px + env(safe-area-inset-bottom,0px))"
            : "calc(" + (BASEPX + up) + "px + env(safe-area-inset-bottom,0px))";
          handles[n] = T.addButton({
            label: btnDefs[n], word: String(btnDefs[n]).length > 2, size: BTN,
            right: colRight, bottom: bottom,
            onDown: function () { state.held[n] = true; state.tapped[n] = true; },
            onUp: function () { state.held[n] = false; },
          });
          furniture.push(handles[n]);
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
      /* SHOW A BUTTON ONLY WHEN IT DOES SOMETHING. A touch layout is small and
         a dead control on it is worse than a missing one: it reads as broken.
         `visible` hides it, `lit` marks it armed, `label` renames it. On a
         mouse this is a no-op, because there is no button to hide. */
      button: function (n, visible, lit, label) {
        const h = handles[n];
        if (h && h.set) h.set(visible, lit, label);
        return h || null;
      },
      /* SHOW OR HIDE THE WHOLE SURFACE. A game whose player changes role
         mid-match otherwise leaves a throttle slider and a bomb button on
         screen for a man on foot, which is the same "a dead control reads as
         broken" failure one level up. Make one surface per role and show the
         one that is live. */
      show: function (on) {
        for (let i = 0; i < furniture.length; i++) {
          const f = furniture[i];
          if (f && f.show) f.show(on !== false);
          else if (f && f.set) f.set(on !== false);
        }
        if (on === false) { for (const k in state.held) state.held[k] = false; }
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
      /* THE AIRCRAFT CONVENTION, kept here so no flying page has to rediscover
         it. systems/airframe.js publishes af.heading() as atan2(-fx, -fz),
         because the nose is -Z: forward is (-sin h, -cos h). follow() places
         the camera at pos - (sin y, cos y) * back, which is BEHIND a body whose
         forward is (sin y, cos y) — a walking man — and directly IN FRONT of an
         aeroplane. Passing af.heading() straight into follow() therefore flies
         the camera backwards through the aeroplane, which looks like a broken
         renderer and is really a sign. */
      followAir: function (af, dt, o) {
        if (!af) return;
        o = o || {};
        o.air = o.air !== false;
        this.follow(af.pos, af.heading() + Math.PI, dt, o);
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
.sHud .dg{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .18s linear;
  box-shadow:inset 0 0 90px 22px rgba(196,44,30,.85), inset 0 0 260px 60px rgba(150,20,10,.42)}
.sHud .pz{position:absolute;inset:0;display:none;place-items:center;background:rgba(9,11,14,.62);
  font-size:clamp(20px,6vw,34px);letter-spacing:.34em}
body.micro-paused .sHud .pz{display:grid}
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
    // DANGER IS A VIGNETTE, NOT A WORD. It costs no HUD space, it reads in
    // peripheral vision, and it cannot collide with anything else on screen —
    // which is the whole reason a bare HUD can still tell you you are about to
    // die. No icon, no emoji, no counter.
    const dg = spec.danger === false ? null : mk("dg", "");
    if (spec.pause !== false) mk("pz", "PAUSED");
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
      danger: function (level) {
        if (!dg) return;
        const f = Math.max(0, Math.min(1, level || 0));
        // squared, so a distant store is a hint and a close one is the screen
        dg.style.opacity = (f * f * 0.92).toFixed(3);
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
