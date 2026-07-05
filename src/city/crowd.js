/* ============================================================
   city/crowd.js — instanced BACKGROUND mass crowd for the city.

   Reuses the jail crowd's InstancedMesh body-part technique
   (entities/crowd.js) but is written NATIVELY in city coordinates — no
   prison-zone graph, no z≈-700 offset bookkeeping, no web-worker society
   sim. The near-camera detail and ALL interaction stay with the per-rig
   CBZ.cityPeds; this layer is pure ambient density: hundreds of little
   people walking the sidewalks, filling the streets out to the fog.

   Each agent strolls between sidewalk waypoints (city/world.js
   randomSidewalkPoint, clamped into the city). Six instanced parts per
   body (shirt torso + skin head/arms + pants legs) with per-instance
   tint and a cheap leg/arm stride. The whole thing is ONE Group toggled
   by mode; the simulation is pure math (testable headlessly), and the
   render no-ops where THREE.InstancedMesh is unavailable.

   DISTRICT DENSITY + WARDROBE: this layer IS the visible street
   population, so it must carry the district field (config CITY.districts
   via world.js) or busy-vs-quiet never reads — packed Midtown sidewalks
   are the "loud money" tell (marks, witnesses, cops) and a near-empty
   Dockyard is the "do crime here" tell. Spawn/reseed positions draw from
   world.js weightedSidewalkPoint (pop-weighted, core ~4× the docks) and
   strolls are biased to STAY in the walker's home district, so the
   density gradient holds instead of diffusing flat. Shirt tints cast by
   district kind (bright tourist colour downtown, hi-vis/drab work gear
   on the industrial end) — per-instance colour on the SAME shared
   materials, zero new draw calls, total agent count unchanged.

   THE CITY KEEPS DIFFERENT HOURS: night just got a LOOK (neon, lit
   windows, camp fires) — the street has to TURN OVER with it or the
   fantasy dies. After dusk (peds.js publishes the dusk/dawn flip off the
   canonical CBZ.nightAmount sun clock) the crowd THINS to ~60% and
   REDISTRIBUTES through a night-weighted draw: the core stays packed
   (party-bright wardrobe headed for the neon + the velvet rope),
   residential empties hard, the docks go dead — so the quiet quarters
   become genuinely good places to do crime and bad places to be a
   victim. All of it rides the EXISTING suppress/reseed machinery
   (teleports far from the camera, a few per tick) — no meshes are ever
   created or destroyed, and dawn reverses the whole thing.

   EVERYTHING TOUCHES THE GROUND: the mass crowd never cast real sun
   shadows (castShadow=false — 320 casters would double the shadow
   pass), so the bodies visually FLOATED. One more InstancedMesh of
   ground-flattened radial-gradient blob quads (shared texture/material
   with city/blobshadows.js via CBZ.blobShadowMat) rides the exact same
   per-agent matrix loop: every walker is glued to the pavement, corpses
   get a long smear, and the whole layer is ONE extra draw call.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const CAP = 760;                       // hard ceiling on instanced bodies (~1000-alive city)
  let count = 0, built = false, ready = false;

  // --- agent state (flat arrays; index 0..count-1) ---
  const px = new Float32Array(CAP), pz = new Float32Array(CAP);   // position (world/city coords)
  const tx = new Float32Array(CAP), tz = new Float32Array(CAP);   // current sidewalk target
  const heading = new Float32Array(CAP), spd = new Float32Array(CAP), phase = new Float32Array(CAP);
  const skin = new Int32Array(CAP), shirt = new Int32Array(CAP), hairC = new Int32Array(CAP);
  // WOMEN IN THE CROWD (W3): per-instance female flag, rolled ~48% alongside
  // skin/shirt/hair on the SAME Math.random() stream this file already uses
  // for every other appearance roll (city/crowd.js has no seeded rng — see
  // spawnCityCrowd below). Read by drawParts() to vary the shared put() scale
  // args for that one instance; the male path stays byte-identical.
  const fem = new Uint8Array(CAP);

  // ---- WALKING GROUPS (2-4 bodies) + SIDEWALK LANE BIAS ----------------------
  // groupLeader[i]: -1 = solo. Else the index of i's leader — a leader's own
  // slot points to itself, so `groupLeader[i] === i` is the leader test.
  // Followers never think for themselves: they copy the leader's (already
  // lane-biased) target with a fixed side-by-side lateral slot (groupOffset),
  // so a pair/trio reads as walking TOGETHER instead of merely adjacent.
  // groupMemA/B/C hold up to 3 followers per leader slot — a leader event
  // (death/promotion/suppression/teleport) unlinks its group in O(1) (a
  // handful of array writes) instead of an O(count) scan for members.
  const groupLeader = new Int32Array(CAP); groupLeader.fill(-1);
  const groupOffset = new Float32Array(CAP);            // this follower's fixed lateral slot (m)
  const groupMemA = new Int32Array(CAP), groupMemB = new Int32Array(CAP), groupMemC = new Int32Array(CAP);
  groupMemA.fill(-1); groupMemB.fill(-1); groupMemC.fill(-1);
  const LANE_MIN = 0.8, LANE_MAX = 1.2;                 // right-of-travel sidewalk lane offset (m)
  // NOTE: this is the per-candidate-slot probability of STARTING a group, not
  // the resulting body share — each hit consumes ~3 slots on average (1 leader
  // + ~2 followers), so ~0.15 here nets out to ~35% of the crowd ending up
  // grouped (verified empirically; see tools/verify-crowd.mjs-style query on
  // CBZ.cityCrowdAgent(i).leader).
  const GROUP_SHARE = 0.15;
  // lateral slots (m) for a group's followers, indexed by [followerCount-1] —
  // asymmetric so a duo isn't perfectly mirrored and a trio/quad fans out
  // without any two bodies overlapping.
  const SLOT_OFFSETS = [[1.0], [-1.0, 1.0], [-1.0, 1.0, 1.9]];

  const SKINS = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3c];
  // 0-9: the everyday base palette — plain tee colors people actually buy
  // (white/gray/black/navy/forest/maroon/mustard + two muted blues), matched
  // to peds.js's SHIRT rack so a promoted body keeps reading like the same
  // person. 10-14: BRIGHT tourist/money colours (downtown casting; peds.js
  // BRIGHTS mirrors 11-14+10). 15-18: hi-vis + drab canvas work gear
  // (industrial). 19-22: PARTY brights (hot pink/violet/cyan/cream) — the
  // night-core going-out wardrobe, loud under the neon. Plain hex values
  // tinted per-instance — no new materials.
  // APPEND-ONLY beyond index 22: KIND_SHIRTS / NIGHT_KIND_SHIRTS index SHIRTS by
  // POSITION, so the day/night palettes 0..22 must NEVER be reordered. Indices
  // 23+ are the BIOME bubble palette (crowd.js's near-player biome spread) —
  // reusing regionlife's plain palette hexes so a biome walker reads like the
  // land it stands on (military olive / farmland earth / forest green / desert
  // tan / snow brights / airport travel / speedway fan). Per-instance tint on
  // the SAME shared material → still ZERO new draw calls.
  const SHIRTS = [0x2c3e5c, 0x6e2b33, 0x33573b, 0xc9a23a, 0x444a52, 0x23262b, 0x8a939c, 0x3a5a7c, 0xe8e6e0, 0x356b9a,
                  0xe8e4da, 0xe2574c, 0x4fa3e0, 0xe8c84a, 0xd96bb0,
                  0xe8821a, 0xc6d435, 0x4e453a, 0x5a5e52,
                  0xff2e7a, 0xa44dff, 0x22d4c8, 0xf5e9da,
                  // 23-25 military olive | 26-28 farmland earth | 29-31 forest
                  0x44503a, 0x4e5740, 0x3a4030,
                  0x6b5d3a, 0x7a5a3a, 0x8a6b4a,
                  0x3a5a3a, 0x5a6b3a, 0x6b4a2a,
                  // 32-34 desert tan | 35-38 snow brights | 39-41 airport travel
                  0x8a7050, 0x6b5a40, 0x9a6a3a,
                  0xd03030, 0x3060c0, 0xe0a020, 0xe0e0e0,
                  0x3a4a6b, 0x8a4a4a, 0xb0b0b0,
                  // 42-45 speedway fan brights
                  0xd03030, 0x3060c0, 0x9030c0, 0xe0a020,
                  // ---- STANDALONE MINI-CITY wardrobes (append-only, ≥46 — never
                  // reorder; 0-22 are POSITION-indexed by KIND_SHIRTS) ----
                  // 46-47 capeharbor: coastal sun-bleached blues/whites
                  0x4f86b8, 0xe6ebf0,
                  // 48-49 goldspire: downtown money — warm gold + charcoal
                  0xd8b24a, 0x2e3138,
                  // 50-51 neonreef: night-core hot neon (pink/cyan)
                  0xff2e8a, 0x22d4d8,
                  // 52-53 foundry: industrial steel + rust
                  0x6a727c, 0x9a5a36];
  // BIOME → [first, lastInclusive] index range into SHIRTS (24+ entries above).
  const BIOME_TINT = {
    military: [23, 25], farmland: [26, 28], forest: [29, 31],
    desert:   [32, 34], snow:    [35, 38], airport: [39, 41],
    speedway: [42, 45],
    // STANDALONE MINI-CITIES — their own 2-index bright urban palettes (46-53).
    // harvestmarket/pinecrest carry biome 'farmland'/'snow' so they reuse those
    // ranges above (no entry needed here). The biome bubble RELOCATES existing
    // instanced bodies into these towns and tints them to fit — zero new draw
    // calls, zero new entities (same shared crowd material, per-instance tint).
    capeharbor: [46, 47], goldspire: [48, 49], neonreef: [50, 51], foundry: [52, 53],
    // X5 — the 4 new countries' settlements (city/countries.js), keyed by
    // settlement id (same convention as the mini-cities above). Trivial reuse
    // of the existing farmland range (26-28, earth tones) rather than minting
    // new SHIRTS entries — every one of these settlements, from a rural
    // capital to a hut village, reads earthy/agrarian, the same "why" the
    // farmland range already covers.
    veridiacity: [26, 28], lowport: [26, 28],
    keshtown: [26, 28], kesh_north: [26, 28], kesh_east: [26, 28],
    solaracity: [26, 28],
    mbeyacity: [26, 28], mbeya_west: [26, 28], mbeya_south: [26, 28], mbeya_east: [26, 28],
  };
  const HAIRS = [0x1a1410, 0x2a2018, 0x3b2a1a, 0x6b4a2a, 0x8a6a3a, 0x101010, 0x55524e, 0x4a3520];
  // WHO wears WHAT, by district kind (indexes into SHIRTS): downtown reads
  // moneyed (tourists in colour = walking wallets you can SEE), commercial
  // reads office, industrial reads shift-work, projects read broke/muted.
  // residential (and unknown) falls through to the full base palette.
  const KIND_SHIRTS = {
    core:       [10, 11, 12, 13, 14, 8, 0, 3],
    commercial: [8, 9, 0, 5, 3, 10, 12],
    industrial: [15, 16, 17, 18, 5, 6, 9],
    projects:   [5, 6, 17, 18, 1, 4],
  };
  // after dark the core dresses for the rope: party brights, not daypacks.
  const NIGHT_KIND_SHIRTS = { core: [19, 20, 21, 22, 14, 12] };

  // ---- THE NIGHT FIELD ----
  // Where the street lives by hour. Day density comes from world.js's
  // pop-weighted draw; after dusk we draw from THIS table instead: the lit
  // core packs out, residential empties hard, the docks go dead. The same
  // numbers drive the turnover relocations, so the field self-corrects.
  const NIGHT_KIND_W = { core: 3.4, commercial: 0.9, projects: 1.5, residential: 0.5, industrial: 0.12 };
  const NIGHT_DENSITY = 0.6;              // the street holds ~60% of the day crowd after dark

  // ---- BIOME BUBBLE (flag-gated; relocate, never create) ----
  // ROOT CAUSE: every position draw above pulls from A.lots (mainland district
  // lots), so all 760 instanced bodies live on the mainland — islands/biomes had
  // 0% land. FIX: when the player is on/near a NON-'city' region, relocate a
  // share of the existing agents into a near-player bubble INSIDE that region
  // (biome-tinted), reusing the SAME reseed/turnover machinery — zero new
  // entities, zero new draw calls. Mainland behaviour stays byte-identical.
  // Flag OFF → every biome gate below no-ops → exactly today's mainland-only crowd.
  if (CBZ.crowdBiomeBubble === undefined) CBZ.crowdBiomeBubble = true;
  const ACTIVE_RAD = 140;                 // stream the bubble only within this of a region edge
  const BIOME_BUBBLE_SHARE = 0.55;        // share of relocation draws that aim INTO the active region
  const BUBBLE_NEAR = 18, BUBBLE_FAR = 95; // bubble ring around the player (m) for biome relocations
  // per-biome density MULTIPLIER on liveTarget (sparse desert, packed speedway).
  // Folded into thin() so the on-street count tracks the biome — WITHOUT touching
  // CAP or draw calls (surplus is just suppressed, exactly like a massacre).
  // STANDALONE MINI-CITIES are CITIES → busy (high share), unlike the sparse
  // wilderness biomes. capeharbor 0.7 / goldspire 0.9 / neonreef 1.0 (packed
  // night-core) / foundry 0.6 (industrial, lighter foot traffic). harvestmarket/
  // pinecrest ride the existing farmland/snow shares (sparse, by design).
  const BIOME_DENSITY = { speedway: 1.0, airport: 0.85, military: 0.45, farmland: 0.4, forest: 0.35, desert: 0.3, snow: 0.3,
                          capeharbor: 0.7, goldspire: 0.9, neonreef: 1.0, foundry: 0.6 };
  // per-tick cache of the player's active region/biome (set in the onUpdate tick,
  // NEVER per-agent). _activeBiome 'city' = mainland or a link → bubble disabled.
  let _activeReg = null, _activeBiome = "city";
  // bubble is live only when the flag is on, we have a real region, and its biome
  // has a tint palette (links carry no biome → fall through to 'city'/mainland).
  function bubbleOn() { return CBZ.crowdBiomeBubble && _activeReg && _activeBiome !== "city" && !!BIOME_TINT[_activeBiome]; }
  const TURNOVER_FRAC = 0.5;              // share of the crowd reconsidered at each dusk/dawn flip
  let nightShift = false;                 // local copy of peds.js's dusk/dawn flip (CBZ.cityNightShift)
  let turnover = 0, _turnScan = 0;        // relocation budget + rolling cursor (spent in thin())
  function nightNow() {
    // peds.js owns the hysteresis flip off the ONE canonical sun clock
    // (CBZ.nightAmount); fall back to the raw dusk threshold if it's absent.
    return CBZ.cityNightShift ? CBZ.cityNightShift() : (CBZ.nightAmount == null ? 0 : CBZ.nightAmount) > 0.6;
  }
  // per-lot cumulative night weights, built once per arena (lots carry their
  // stamped district quadrant; annex/island lots fall to a low filler weight).
  let _ncA = null, _nc = null;
  function nightCum(A) {
    if (_ncA === A && _nc) return _nc;
    _ncA = A;
    const lots = A.lots, cum = new Float64Array(lots.length);
    let t = 0;
    for (let k = 0; k < lots.length; k++) {
      const d = A.districts && typeof lots[k].district === "number" ? A.districts[lots[k].district] : null;
      t += d && NIGHT_KIND_W[d.kind] != null ? NIGHT_KIND_W[d.kind] : 0.4;
      cum[k] = t;
    }
    return (_nc = { cum, total: t });
  }

  let root, wm = null;
  // full body + FACE so the city crowd reads as PEOPLE, not short faceless boxes —
  // same parts + proportions as the jail mass-crowd (entities/crowd.js).
  let torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth, meshes = null;
  // EVERYTHING TOUCHES THE GROUND: one extra InstancedMesh of ground-flattened
  // blob quads — every walker drops a soft contact shadow, ALL ~320 of them in
  // ONE draw call. The crowd never casts real sun shadows (castShadow=false on
  // every part below), so this blob IS what glues the mass to the pavement.
  let shadowQ = null;
  const rootD = new THREE.Object3D(), partD = new THREE.Object3D(), col = new THREE.Color();
  const shadD = new THREE.Object3D();    // shadow-quad matrix compose scratch (zero per-frame alloc)

  // ---- ONE shared blob-shadow texture/material for the whole city ----
  // (city/blobshadows.js draws the full-rig ped/car blobs with the SAME
  // material — defined guarded in both files so script order doesn't matter;
  // first caller builds it, everyone else reuses CBZ._blobShadowMat.)
  CBZ.blobShadowMat = CBZ.blobShadowMat || function () {
    if (CBZ._blobShadowMat !== undefined) return CBZ._blobShadowMat;
    let tex = null;
    if (typeof document !== "undefined" && document.createElement && THREE.CanvasTexture) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const ctx = c.getContext && c.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, "rgba(0,0,0,0.55)");
        grad.addColorStop(0.6, "rgba(0,0,0,0.34)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        tex = new THREE.CanvasTexture(c);
      }
    }
    // headless / no-DOM: no texture → no material (callers guard on null)
    if (!tex || !THREE.MeshBasicMaterial) return (CBZ._blobShadowMat = null);
    CBZ._blobShadowMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,            // never occludes, never z-buffers
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // floats clear of the road plane
    });
    return CBZ._blobShadowMat;
  };

  // ---- ON-DEMAND PROMOTION (same idea as the jail mass-crowd face-rigs) ----
  // The nearest ambient agents become REAL, fully interactive city peds (added
  // to CBZ.cityPeds, so the ped brain @34 AND the city interaction menu just
  // work on them) as you walk up, then get parked back to instanced density
  // when you walk away. Without this the city crowd was render-only and dead to
  // interaction — you could walk into someone and nothing happened.
  const PROMO = 22;                              // pool of interactive peds kept near you
                                                 // (a few slots of slack so bump-knockdowns
                                                 //  can promote victims mid-sprint)
  const PROMO_IN2 = 22 * 22;                     // promote-in radius (any direction)
  // FAR REACH: an agent in your sightline (ahead of the camera) gets promoted to a
  // real, shoot/run-over-able ped from much farther out, so anyone you can SEE down
  // the street is fully real before you reach them — not a phantom that pops in.
  const PROMO_AHEAD2 = 40 * 40;                  // promote-in distance for agents in front of you
  const AHEAD_DOT = 0.35;                        // cone half-width for "ahead of the camera"
  // demote-out must sit BEYOND the farthest promote-in (the ahead range) so a
  // body promoted way down the street doesn't instantly flicker back to density.
  const PROMO_OUT2 = 48 * 48;                    // hysteresis: park only past this
  const PARK = -4000;                            // where parked pool peds wait, off-map
  const promotedBy = new Int32Array(CAP);        // crowd index -> pool slot (or -1)
  const deadAgent = new Uint8Array(CAP);         // agent fully removed (corpse faded)
  const corpseT = new Float32Array(CAP);         // >0 = freshly killed, lying as a body for this many sec
  // THINNING: as the finite city population is killed off, a growing share of the
  // surviving ambient agents go "off-street" (suppressed) so the rendered density
  // tracks the remaining headcount — the streets EMPTY after a massacre instead of
  // staying magically full. Suppressed agents aren't dead (they don't reduce the
  // living total); they're parked off-map and skipped by sim/render/reseed/promote
  // until the target density says the street should hold more people again.
  const suppressed = new Uint8Array(CAP);
  // BUMP REACTIONS: stagger timer + shove velocity per agent. While stagT>0
  // the body is skidding/recovering from a physical hit instead of strolling —
  // the render leans it with the shove, so a bump READS without any rig anim.
  const stagT = new Float32Array(CAP), stagX = new Float32Array(CAP), stagZ = new Float32Array(CAP);
  // MASS FLEE (flag-gated, default OFF): when a city EVENT (gunshot/explosion, via
  // cityevents.js → cityPostEvent) lands near an instanced body it SPRINTS away for
  // panicT seconds along fleeH. Closes the gap where the 760-strong background crowd
  // ignored gunfire while the full-rig peds already scattered (cityevents handles
  // those). Reuses sim()'s existing move + 2-pass collide, so fleers scrape along
  // walls instead of tunnelling. OFF → panicT is never set → the sim() flee branch
  // is dead code → byte-identical to today.
  const panicT = new Float32Array(CAP), fleeHX = new Float32Array(CAP), fleeHZ = new Float32Array(CAP);
  const PANIC_SPD = 4.2;                          // m/s flat sprint while fleeing (a real run)
  // default ON (validated 2026-06-15: harness testCrowd — 14 bystanders' avg distance
  // from a gunshot rose 28.8→31.0m over 1.5s). Set CBZ.crowdMassFlee=false to revert.
  if (CBZ.crowdMassFlee === undefined) CBZ.crowdMassFlee = true;
  // dead-reckoning step direction (unit vector toward the current target),
  // refreshed on think ticks; mid/far agents walk this between ticks.
  const dirX = new Float32Array(CAP), dirZ = new Float32Array(CAP);
  const collapsedQ = new Uint8Array(CAP);         // park matrices already written (skip rewrites)
  let liveTarget = CAP;                           // how many agents should be ON the street
  let pool = [], poolBuilt = false;               // interactive-promotion pool (declaration was dropped when thinning was added)
  // ---- POOL PRE-WARM (kill the "NPCs pop in / load slowly as I walk up" hitch) ----
  // The promotion pool is ~PROMO real makeCharacter rigs (each ~16-22 THREE.Mesh +
  // ~10-12 cloned materials + trait rolls + a label sprite + outfit recolour). The
  // OLD path built ALL of them SYNCHRONOUSLY on FIRST NEED — i.e. the first frame you
  // walked near anyone — so your first encounter cost ~22 rig constructions in ONE
  // frame: a visible stutter exactly when the world should feel alive. CLASSIC FIX
  // (object-pool pre-warm, verified best practice): build the pool AHEAD of need, a
  // few rigs PER FRAME (time-sliced so no single frame spikes), starting at city
  // LOAD — while you're still on the spawn roof and can't reach anyone — so the rigs
  // are finished and parked off-map (visible=false) long before the first promotion.
  // GPU NOTE: every rig material is a MeshLambertMaterial, the SAME shader the
  // instanced crowd already renders on frame 0 — and cloneLook() clones (same shader
  // program/defines) — so revealing a pre-built rig triggers NO new shader compile;
  // the only first-reveal cost is a tiny matrix/uniform upload, dwarfed by the
  // construction we just moved off the hot path. (An optional renderer.compile()
  // warm-up would be a core/main hook, not ours — reported, not required.)
  const PREWARM_POOL = true;                       // ON: amortized pre-build at load. OFF → exact old lazy path.
  const PREWARM_PER_FRAME = 2;                      // rigs to construct per frame while warming (≈11 frames to fill 22 — invisible)
  let prewarming = false;                           // armed by spawnCityCrowd, spent by prewarmTick()
  promotedBy.fill(-1);

  // a UNIT (1×1×1) box scaled per-part at render time, jail-crowd style. Tinted
  // parts need a white color attribute (r128 USE_COLOR multiplies by 0 → black);
  // solid parts (legs/eyes/mouth) use a plain unit box.
  function tintUnit() {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const n = g.attributes.position.count, white = new Float32Array(n * 3); white.fill(1);
    g.setAttribute("color", new THREE.BufferAttribute(white, 3));
    return g;
  }

  function buildMeshes() {
    if (built) return;
    if (!THREE.InstancedMesh) return;    // headless / no-instancing → sim only, no render
    built = true;
    wm = new THREE.Matrix4();
    root = new THREE.Group(); root.name = "city-crowd"; root.visible = false;
    CBZ.scene.add(root);
    const unitT = tintUnit();                              // shared geom for all tinted parts
    const unitP = new THREE.BoxGeometry(1, 1, 1);          // shared geom for solid parts
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const pants = CBZ.mat ? CBZ.mat(0x2c3038) : new THREE.MeshLambertMaterial({ color: 0x2c3038 });
    const dark = CBZ.mat ? CBZ.mat(0x141414) : new THREE.MeshLambertMaterial({ color: 0x141414 });
    function part(mat, geo) {
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      root.add(m); return m;
    }
    torso = part(shirtMat, unitT);
    hd = part(skinMat, unitT);
    hair = part(hairMat, unitT);
    armL = part(skinMat, unitT); armR = part(skinMat, unitT);
    legL = part(pants, unitP); legR = part(pants, unitP);
    eyeL = part(dark, unitP); eyeR = part(dark, unitP); mouth = part(dark, unitP);
    meshes = [torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth];
    // the ground-contact blob layer: one more instanced draw for the whole mass
    const smat = CBZ.blobShadowMat ? CBZ.blobShadowMat() : null;
    if (smat && THREE.PlaneGeometry) {
      shadowQ = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smat, CAP);
      shadowQ.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      shadowQ.castShadow = false; shadowQ.receiveShadow = false; shadowQ.frustumCulled = false;
      // park ALL slots off-map up front: instances ≥ count would otherwise sit
      // as identity matrices — visible dark quads stacked at the origin.
      wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
      for (let i = 0; i < CAP; i++) shadowQ.setMatrixAt(i, wm);
      shadowQ.instanceMatrix.needsUpdate = true;
      root.add(shadowQ);
    }
    ready = true;
  }

  function arena() { return CBZ.city && CBZ.city.arena; }
  const _tmp = { x: 0, z: 0 };
  const _col = { x: 0, z: 0 };            // scratch for building collision in sim()

  // ---- DISTRICT-AWARE WAYPOINTS ----
  // lots grouped by district quadrant, built lazily per arena (world.js stamps
  // l.district once at build; deterministic — no rng spent here).
  let _dlA = null, _dlMap = null;
  function districtLots(A) {
    if (_dlA === A && _dlMap) return _dlMap;
    _dlA = A; _dlMap = {};
    if (A.lots) for (let k = 0; k < A.lots.length; k++) {
      const l = A.lots[k], q = l.district;
      if (q == null || typeof q !== "number") continue;     // annex/island lots: unstamped
      (_dlMap[q] || (_dlMap[q] = [])).push(l);
    }
    return _dlMap;
  }
  function sidewalkOnLot(l, out) {        // same ring math as world.js sidewalkOf
    const edge = (Math.random() * 4) | 0, t = (Math.random() - 0.5) * l.w;
    const off = l.w / 2 + 1.6;
    if (edge === 0) { out.x = l.cx + t; out.z = l.cz - off; }
    else if (edge === 1) { out.x = l.cx + t; out.z = l.cz + off; }
    else if (edge === 2) { out.x = l.cx - off; out.z = l.cz + t; }
    else { out.x = l.cx + off; out.z = l.cz + t; }
  }
  // a downtown walker strolls DOWNTOWN-ish: a bit over half the repicks stay in
  // the walker's home district; the rest fall through to the city-wide draw.
  // Loosened from 0.8 — the hard home clamp is what bunched the whole street
  // onto a few sidewalks; real foot traffic bleeds between neighbourhoods.
  const STAY = 0.55;
  // the city-wide draw for the CURRENT hour: pop-weighted by day, night-field
  // weighted after dusk. ALL spawn/reseed/relocation positions come through
  // here, so flipping ONE flag re-shapes where the whole street lives.
  function drawPoint(out) {
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    if (nightShift && A.lots && A.lots.length && A.districts) {
      const nc = nightCum(A);
      if (nc.total > 0) {
        const x = Math.random() * nc.total;
        let lo = 0, hi = nc.cum.length - 1;                    // binary-search the cum table
        while (lo < hi) { const mid = (lo + hi) >> 1; if (nc.cum[mid] < x) lo = mid + 1; else hi = mid; }
        sidewalkOnLot(A.lots[lo], out);
        if (A.clampToCity) A.clampToCity(out, 0.6);
        return;
      }
    }
    // SPREAD: a third of the day draws come straight off the FULL lot grid
    // (uniform — every street in the city), the rest stay pop-weighted toward
    // the busy quarters. Together with the flattened district weights this
    // kills the dead zones AND the clown-car sidewalks. Uniform path picks
    // the lot with Math.random so the world's seeded rng stream is untouched.
    if (!nightShift && A.lots && A.lots.length && Math.random() < 0.35) {
      sidewalkOnLot(A.lots[(Math.random() * A.lots.length) | 0], out);
      if (A.clampToCity) A.clampToCity(out, 0.6);
      return;
    }
    const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(Math.random) : A.randomSidewalkPoint();
    if (A.clampToCity) A.clampToCity(p, 0.6);
    out.x = p.x; out.z = p.z;
  }
  // ---- BIOME BUBBLE POINT ----
  // When the bubble is live, with prob BIOME_BUBBLE_SHARE draw a relocation point
  // INSIDE the active region but within BUBBLE_FAR of the player (a near-player
  // bubble), so the biome fills with bodies; otherwise fall through to the
  // mainland draw. Always region-aware clamped (A.clampToCity consults regions).
  function regionPoint(out) {
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    const P = CBZ.player; const ppx = P ? P.pos.x : 0, ppz = P ? P.pos.z : 0;
    if (bubbleOn() && Math.random() < BIOME_BUBBLE_SHARE) {
      const reg = _activeReg, far2 = BUBBLE_FAR * BUBBLE_FAR;
      // a few region scatter tries, keep the first that lands inside the bubble
      for (let t = 0; t < 6; t++) {
        const pts = CBZ.cityScatterInRegion(reg, 1, Math.random, 4);
        if (!pts || !pts.length) break;
        const dx = pts[0].x - ppx, dz = pts[0].z - ppz;
        if (dx * dx + dz * dz <= far2) {
          out.x = pts[0].x; out.z = pts[0].z;
          if (A.clampToCity) A.clampToCity(out, 0.6);
          return;
        }
      }
      // fallback: a ring point around the player, clamped onto the region so it
      // can never land in the sea even when the bubble overhangs the edge.
      const a = Math.random() * Math.PI * 2, d = BUBBLE_NEAR + Math.random() * (BUBBLE_FAR - BUBBLE_NEAR);
      let rx = ppx + Math.cos(a) * d, rz = ppz + Math.sin(a) * d;
      if (CBZ.cityRegionClamp) { const c = CBZ.cityRegionClamp(reg, rx, rz, 0.6); rx = c.x; rz = c.z; }
      out.x = rx; out.z = rz;
      if (A.clampToCity) A.clampToCity(out, 0.6);
      return;
    }
    drawPoint(out);
  }
  // dispatcher for RELOCATION draws only: biome bubble when active, else mainland.
  function fieldPoint(out) { if (bubbleOn()) regionPoint(out); else drawPoint(out); }
  // pickWaypoint(out)         → hour-weighted city-wide point (spawn/reseed)
  // pickWaypoint(out, ax, az) → stroll target biased into (ax,az)'s district
  function pickWaypoint(out, ax, az) {
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    // BIOME STROLL: a body standing INSIDE the active region picks its next stroll
    // goal WITHIN the same region (cityScatterInRegion), not from mainland district
    // lots — otherwise clampToCity would drag every biome goal to the nearest
    // mainland sidewalk and the whole bubble would "walk to the sea". Gated so
    // mainland bodies are untouched (bubbleOn false → skipped entirely).
    if (ax !== undefined && bubbleOn() && CBZ.cityRegionHit && CBZ.cityRegionHit(_activeReg, ax, az, 0)) {
      const pts = CBZ.cityScatterInRegion(_activeReg, 1, Math.random, 4);
      if (pts && pts.length) {
        out.x = pts[0].x; out.z = pts[0].z;
        if (A.clampToCity) A.clampToCity(out, 0.6);
        return;
      }
    }
    if (ax !== undefined && A.districtAt && A.lots && Math.random() < STAY) {
      const home = A.districtAt(ax, az);
      // AFTER DARK a dead quarter doesn't hold its walkers: a stroller in a
      // night-dead district (residential/docks) usually heads for the lights
      // instead of pacing an empty block, so the emptying reads as an exodus.
      const deadHere = nightShift && home && (NIGHT_KIND_W[home.kind] == null || NIGHT_KIND_W[home.kind] < 0.5) && Math.random() < 0.65;
      const ls = home && !deadHere ? districtLots(A)[home.q] : null;
      if (ls && ls.length) {
        sidewalkOnLot(ls[(Math.random() * ls.length) | 0], out);
        if (A.clampToCity) A.clampToCity(out, 0.6);
        return;
      }
    }
    drawPoint(out);
  }

  // ---- lane bias + group target propagation (helpers for repick() below) ----
  // Offset a freshly-picked target ~0.8-1.2u to the RIGHT of the travel
  // direction from (px[i],pz[i]) to it — one vector op at target-pick time,
  // never per-frame. "Right" is just a fixed rotation of each agent's OWN
  // heading (consistent across all agents), so opposing foot traffic ends up
  // on opposite physical sides of the sidewalk, exactly like real lane
  // discipline, with zero notion of a "true" world-space side.
  function applyLaneBias(i, out) {
    const dx = out.x - px[i], dz = out.z - pz[i];
    const dlen = Math.hypot(dx, dz) || 1;
    const bias = LANE_MIN + Math.random() * (LANE_MAX - LANE_MIN);
    out.x += (dz / dlen) * bias;
    out.z += (-dx / dlen) * bias;
  }
  // seat follower i's target off leader L's CURRENT target, offset to i's
  // fixed lateral slot (perpendicular to the leader's travel direction), and
  // ease i's speed toward the leader's so the pair paces together instead of
  // snapping. Cheap: only runs when the leader repicks (arrival/interrupt),
  // never per-frame.
  function followTarget(i, L) {
    const dx = tx[L] - px[L], dz = tz[L] - pz[L], dlen = Math.hypot(dx, dz) || 1;
    const rx = dz / dlen, rz = -dx / dlen;
    tx[i] = tx[L] + rx * groupOffset[i]; tz[i] = tz[L] + rz * groupOffset[i];
    heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
    dirX[i] = Math.sin(heading[i]); dirZ[i] = Math.cos(heading[i]);
    spd[i] += (spd[L] - spd[i]) * 0.5;               // slight follow damping, not a hard snap
  }
  function propagateGroup(L) {
    if (groupMemA[L] >= 0) followTarget(groupMemA[L], L);
    if (groupMemB[L] >= 0) followTarget(groupMemB[L], L);
    if (groupMemC[L] >= 0) followTarget(groupMemC[L], L);
  }
  // unlink a single agent from whatever group role it holds (leader or
  // follower). Leader case cascades to every living follower (O(1) — at most
  // 3 array writes, no O(count) scan) so they fall back to solo strolling
  // instead of forever chasing a leader that died/was promoted/suppressed/
  // teleported. Safe to call on any agent, grouped or not.
  function ungroup(i) {
    const L = groupLeader[i];
    if (L < 0) return;
    if (L === i) {                                    // i IS a leader — release its followers
      const a = groupMemA[i], b = groupMemB[i], c = groupMemC[i];
      if (a >= 0 && groupLeader[a] === i) groupLeader[a] = -1;
      if (b >= 0 && groupLeader[b] === i) groupLeader[b] = -1;
      if (c >= 0 && groupLeader[c] === i) groupLeader[c] = -1;
      groupMemA[i] = -1; groupMemB[i] = -1; groupMemC[i] = -1;
    } else {                                          // i is a follower — free its slot on the leader
      if (groupMemA[L] === i) groupMemA[L] = -1;
      else if (groupMemB[L] === i) groupMemB[L] = -1;
      else if (groupMemC[L] === i) groupMemC[L] = -1;
    }
    groupLeader[i] = -1;
  }
  // central repick used by every stroll/arrival/interrupt site: solo agents
  // (and leaders) draw a fresh lane-biased target and push it to their group;
  // followers skip the independent think entirely and just re-seat off their
  // leader's existing target. Replaces the old repeated pickWaypoint+heading
  // boilerplate at every call site, so lane bias + group propagation are free
  // everywhere a target is (re)picked.
  function repick(i) {
    const L = groupLeader[i];
    if (L >= 0 && L !== i) {
      if (groupLeader[L] === L) { followTarget(i, L); return; }
      groupLeader[i] = -1;               // stale leader ref (shouldn't happen) — fall through solo
    }
    pickWaypoint(_tmp, px[i], pz[i]);
    applyLaneBias(i, _tmp);
    tx[i] = _tmp.x; tz[i] = _tmp.z;
    heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
    dirX[i] = Math.sin(heading[i]); dirZ[i] = Math.cos(heading[i]);
    if (L === i) propagateGroup(i);
  }
  // form ~GROUP_SHARE of [0,n) into leader+1..3-follower walking groups.
  // Deterministic (CBZ.seedStream) so WHO is grouped is byte-identical across
  // clients; runtime jitter (huddle wobble) stays Math.random per file
  // convention. Consecutive followers are snapped next to the leader's spawn
  // position so a group reads as together from frame 0, not just after its
  // first shared arrival.
  function formGroups(n) {
    const rand = CBZ.seedStream ? CBZ.seedStream("crowdGroups") : Math.random;
    let i = 0;
    while (i < n - 1) {
      if (rand() < GROUP_SHARE) {
        const room = Math.min(3, n - i - 1);           // followers available before running off the array
        const size = 1 + ((rand() * room) | 0);        // 1..3 followers → group of 2..4
        const offs = SLOT_OFFSETS[size - 1];
        const L = i;
        for (let k = 1; k <= size; k++) {
          const m = L + k;
          groupLeader[m] = L; groupOffset[m] = offs[k - 1];
          if (k === 1) groupMemA[L] = m; else if (k === 2) groupMemB[L] = m; else groupMemC[L] = m;
          // huddle the follower next to the leader's spawn spot (small jitter)
          px[m] = px[L] + (rand() - 0.5) * 0.6;
          pz[m] = pz[L] + (rand() - 0.5) * 0.6;
        }
        groupLeader[L] = L;
        propagateGroup(L);                             // seat every follower's target now, not on first arrival
        i += 1 + size;
      } else i++;
    }
  }
  // cast the shirt for wherever this agent stands (district wardrobe above);
  // skin/hair stay city-wide. Used at spawn and when a body is recycled into
  // a NEW district (it walks in as a local, not a teleported stranger).
  function castTint(i, x, z) {
    const A = arena();
    // BIOME WARDROBE: a body that lands in a non-'city' region dresses for the
    // land (olive on the base, earth on the farm, tan in the desert). Gated on
    // the flag; mainland bodies fall straight through to the district palette so
    // flag-off / mainland casting is byte-identical to today. Append-only SHIRTS
    // indices (23+) keep this one material / zero new draw calls.
    if (CBZ.crowdBiomeBubble && A) {
      const reg = CBZ.cityAnyRegion ? CBZ.cityAnyRegion(A, x, z, 0) : null;
      const bt = reg && reg.biome && reg.biome !== "city" ? BIOME_TINT[reg.biome] : null;
      if (bt) { shirt[i] = bt[0] + ((Math.random() * (bt[1] - bt[0] + 1)) | 0); return; }
    }
    const d = A && A.districtAt ? A.districtAt(x, z) : null;
    // night in the core dresses for the line — party brights under the neon
    const pool = d && ((nightShift && NIGHT_KIND_SHIRTS[d.kind]) || KIND_SHIRTS[d.kind]);
    shirt[i] = pool ? pool[(Math.random() * pool.length) | 0] : ((Math.random() * 10) | 0);
  }
  function repaintShirt(i) {              // recolour one recycled body in-place
    if (!ready) return;
    col.setHex(SHIRTS[shirt[i]]); torso.setColorAt(i, col);
    if (torso.instanceColor) torso.instanceColor.needsUpdate = true;
  }

  CBZ.spawnCityCrowd = function (n) {
    buildMeshes();
    const A = arena(); if (!A) { count = 0; return 0; }
    count = Math.max(0, Math.min(CAP, n | 0));
    if (poolBuilt) releaseAll();                 // un-assign any held peds before re-seeding
    promotedBy.fill(-1); deadAgent.fill(0); corpseT.fill(0); suppressed.fill(0);
    stagT.fill(0); collapsedQ.fill(0); panicT.fill(0);
    groupLeader.fill(-1); groupOffset.fill(0);
    groupMemA.fill(-1); groupMemB.fill(-1); groupMemC.fill(-1);
    liveTarget = count;                          // full street at the start of a run
    for (let i = 0; i < count; i++) {
      // pop-weighted spawn (Midtown packed, Dockyard thin), then a stroll
      // target inside the home district so the gradient survives the walking.
      pickWaypoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;
      repick(i);                                 // lane-biased target (groups aren't formed yet — solo path)
      spd[i] = 1.0 + Math.random() * 1.6;
      phase[i] = Math.random() * 6.2832;
      skin[i] = (Math.random() * SKINS.length) | 0;
      castTint(i, px[i], pz[i]);
      hairC[i] = (Math.random() * HAIRS.length) | 0;
      fem[i] = Math.random() < 0.48 ? 1 : 0;   // ~48% female, same unseeded stream as the rolls above
    }
    formGroups(count);                           // ~35% link into 2-4 body walking groups (deterministic)
    paintColors();
    if (ready) {
      // park EVERY slot ≥ count across ALL body parts + the blob, so a re-seed
      // to a smaller crowd can never strand stale frozen bodies (or detached
      // face parts) from a previous, larger run — render() only writes 0..count-1.
      wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
      for (let i = count; i < CAP; i++) {
        for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, wm);
        if (shadowQ) shadowQ.setMatrixAt(i, wm);
      }
      render(0);                 // place them so frame 0 isn't a pile at the origin
    }
    // ARM THE POOL PRE-WARM. This fires at city LOAD (mode.js calls spawnCityCrowd
    // on entry) — you're still on the spawn roof, far from anyone — so the ~PROMO
    // rigs get built a couple per frame over the next ~11 frames and are parked,
    // ready, off-map BEFORE your first encounter. If the pool was already built
    // (a re-seed within the same run), leave it: releaseAll() above already freed
    // its held slots, so it's warm and reusable as-is. Guests skip (cosmetic crowd).
    if (PREWARM_POOL && !poolBuilt && !(CBZ.net && CBZ.net.noSim())) prewarming = true;
    return count;
  };
  CBZ.cityCrowdReset = function () { CBZ.spawnCityCrowd(count || ((CBZ.CITY && CBZ.CITY.crowd) || 700)); };
  // tiny debug accessors (used by the headless harness; cheap, read-only)
  CBZ.cityCrowdCount = function () { return count; };
  CBZ.cityCrowdAgent = function (i) { return { x: px[i], z: pz[i], tx: tx[i], tz: tz[i], heading: heading[i], leader: groupLeader[i] }; };

  function paintColors() {
    if (!ready) return;
    for (let i = 0; i < count; i++) {
      col.setHex(SHIRTS[shirt[i]]); torso.setColorAt(i, col);
      col.setHex(SKINS[skin[i]]); hd.setColorAt(i, col); armL.setColorAt(i, col); armR.setColorAt(i, col);
      col.setHex(HAIRS[hairC[i]]); hair.setColorAt(i, col);
    }
    [torso, hd, hair, armL, armR].forEach(function (m) { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }

  // pure-math simulation: stroll toward the target, repick on arrival.
  // TICK TIERS — the 700-strong street at flat per-frame cost: agents near the
  // camera think every frame, mid-range every 4th, far every 16th (round-robin
  // by (frame+i), so the work spreads evenly). Between thinks a body DEAD-
  // RECKONS along its cached step direction at full speed, so motion stays
  // per-frame smooth everywhere; only the steering/arrival/collide brain is
  // sliced. Worst-case wall drift before a far tick's 2-pass depenetration is
  // ~0.7m — well inside any building box, so the push always resolves it.
  let _simFrame = 0;                       // for the collide stride time-slice
  const NEAR2 = 42 * 42, MID2 = 110 * 110; // think-tier rings (camera distance)
  function sim(dt) {
    const A = arena(); if (!A) return;
    const frame = _simFrame++;
    const P = CBZ.player;
    const ppx = P ? P.pos.x : 0, ppz = P ? P.pos.z : 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i]) continue;
      if (corpseT[i] > 0) { corpseT[i] -= dt; if (corpseT[i] <= 0) deadAgent[i] = 1; continue; }  // lying dead → fade out
      if (suppressed[i]) continue;                        // off-street (thinned out) → don't walk it
      if (promotedBy[i] >= 0) continue;                   // a real promoted ped owns this one
      // BUMPED: skid out the shove, recover, then pick a fresh stroll — the
      // physical reaction IS the behaviour (no pathing AI on top of it).
      if (stagT[i] > 0) {
        stagT[i] -= dt;
        px[i] += stagX[i] * dt; pz[i] += stagZ[i] * dt;
        const dec = Math.pow(0.02, dt); stagX[i] *= dec; stagZ[i] *= dec;
        if (CBZ.collide) {
          _col.x = px[i]; _col.z = pz[i];
          CBZ.collide(_col, 0.5, 0, 1.7);
          px[i] = _col.x; pz[i] = _col.z;
        }
        if (stagT[i] <= 0) repick(i);
        continue;
      }
      // PANIC: sprint away from a recent threat (set by cityCrowdFlee). Runs every
      // frame while panicked — bounded, since only bodies near a live event are armed
      // — so the scatter reads instantly. Reuses the 2-pass collide so a fleer scrapes
      // along walls, not through them. Off-flag → panicT is always 0 → never taken.
      if (panicT[i] > 0) {
        panicT[i] -= dt;
        const fh = Math.atan2(fleeHX[i], fleeHZ[i]);
        heading[i] = CBZ.lerpAngle ? CBZ.lerpAngle(heading[i], fh, 1 - Math.pow(0.02, dt)) : fh;
        dirX[i] = Math.sin(heading[i]); dirZ[i] = Math.cos(heading[i]);
        px[i] += dirX[i] * PANIC_SPD * dt; pz[i] += dirZ[i] * PANIC_SPD * dt;
        phase[i] += PANIC_SPD * 2.4 * dt;          // legs pump fast
        if (CBZ.collide) {
          _col.x = px[i]; _col.z = pz[i];
          for (let pass = 0; pass < 2; pass++) {
            const bx = _col.x, bz = _col.z;
            CBZ.collide(_col, 0.5, 0, 1.7);
            if (Math.abs(_col.x - bx) < 0.002 && Math.abs(_col.z - bz) < 0.002) break;
          }
          px[i] = _col.x; pz[i] = _col.z;
        }
        if (panicT[i] <= 0) repick(i);              // calmed → pick a fresh stroll
        continue;
      }
      const cdx = px[i] - ppx, cdz = pz[i] - ppz, cd2 = cdx * cdx + cdz * cdz;
      const stride = cd2 < NEAR2 ? 1 : (cd2 < MID2 ? 4 : 16);
      if (stride > 1 && (frame + i) % stride !== 0) {
        // off-tick: keep walking the cached direction — full speed, no brain.
        // CLOSE THE WALL-PHASING HOLE: a mid/far body skips up to 15 frames between
        // think-ticks, dead-reckoning a STRAIGHT line that cuts through the building
        // in the middle of a block — so it MUST still collide every frame it moves
        // (every rendered, no far-cull). Clamp the per-frame step to one push's worth
        // (<FEEL_SAFE_STEP 0.35m — matters at low FPS / big dt so a giant off-tick
        // step can't tunnel the wall before the push registers), advance, then a CHEAP
        // 2-pass collideSlide (corners need a second push — see below). collide() is
        // grid-accelerated → ~O(local walls), and the slide early-outs after one pass
        // in open street, so this is ~one bucket lookup + a few box tests per body:
        // well within the 760-body budget.
        let oStep = spd[i] * dt; if (oStep > 0.34) oStep = 0.34;
        px[i] += dirX[i] * oStep; pz[i] += dirZ[i] * oStep;
        phase[i] += spd[i] * 2.4 * dt;
        if (CBZ.collideSlide) {
          // 2-PASS depenetration on the dead-reckoned off-tick step too (was a
          // single push). SEAL THE WALL-PHASING HOLE: a body skipping up to 15
          // frames between brains can dead-reckon straight at a CORNER, where one
          // push shoves it out of one wall and INTO the abutting one — a single
          // collide() leaves it embedded for the rest of the off-tick streak,
          // visibly inside the building. The second pass resolves that corner, so
          // even an off-tick body can't squeeze a thin wall. collideSlide early-
          // outs the instant a pass moves <2mm (the common open-street case = one
          // grid lookup), so 2 passes cost ~the same as the old single collide for
          // the bodies that weren't touching anything — perf-neutral on the budget.
          // Its returned boolean IS "was pushed" → drive the repick off it directly.
          _col.x = px[i]; _col.z = pz[i];
          if (CBZ.collideSlide(_col, 0.5, 0, 1.7, 2)) {
            px[i] = _col.x; pz[i] = _col.z;          // shoved out of a wall on the dead-reckoned line
            repick(i);                                // repick so it doesn't grind back in (mirrors the think-tick block below)
          } else { px[i] = _col.x; pz[i] = _col.z; }   // converged in open street; keep the (unchanged) resolved pos
        } else if (CBZ.collide) {
          // fallback if the slide helper isn't loaded (partial load order): single push
          _col.x = px[i]; _col.z = pz[i];
          CBZ.collide(_col, 0.5, 0, 1.7);
          if (_col.x !== px[i] || _col.z !== pz[i]) {
            px[i] = _col.x; pz[i] = _col.z;
            repick(i);
          }
        }
        continue;
      }
      let dx = tx[i] - px[i], dz = tz[i] - pz[i], d = Math.hypot(dx, dz);
      if (d < 1.4) { repick(i); dx = tx[i] - px[i]; dz = tz[i] - pz[i]; d = Math.hypot(dx, dz); }
      const inv = 1 / (d || 1);
      const want = Math.atan2(dx, dz);
      heading[i] = CBZ.lerpAngle ? CBZ.lerpAngle(heading[i], want, 1 - Math.pow(0.0015, dt)) : want;
      dirX[i] = dx * inv; dirZ[i] = dz * inv;             // dead-reckoning cache for off-ticks
      const step = spd[i] * dt;
      px[i] += dx * inv * step; pz[i] += dz * inv * step;
      phase[i] += spd[i] * 2.4 * dt;
      // STOP THE NAMELESS AMBIENT CROWD WALKING THROUGH WALLS: the stroll above is
      // a straight line to a random sidewalk point, which cuts THROUGH the building
      // in the middle of a block. EVERY agent is RENDERED (no far-cull), so EVERY
      // agent must collide — a camera-distance gate previously let the whole mid/far
      // crowd walk through buildings on off-ticks in plain sight (the known instanced-
      // crowd wall-phasing). collide() is grid-accelerated (~O(local walls)), so it's
      // cheap. feetY/headY 0..1.7 hits full walls but ignores high window panes.
      // 2-PASS DEPENETRATION (mirrors peds.js): one push at a corner can shove a body
      // OUT of one wall and INTO the next, so a second pass resolves that — a straight-
      // line stroll can't squeeze a thin wall in a single push. Stop early once a pass
      // no longer moves the body. EVERY agent now collides EVERY frame it moves: the
      // off-tick branch above already collides the dead-reckoned step, so this think-
      // tick block no longer needs the old 1-in-3 near-tier slice to avoid leaving a
      // gap — gating is now uniform (one grid-accelerated collide per moving body/frame).
      if (CBZ.collide) {
        _col.x = px[i]; _col.z = pz[i];
        for (let pass = 0; pass < 2; pass++) {
          const bx = _col.x, bz = _col.z;
          CBZ.collide(_col, 0.5, 0, 1.7);
          if (Math.abs(_col.x - bx) < 0.002 && Math.abs(_col.z - bz) < 0.002) break;
        }
        if (_col.x !== px[i] || _col.z !== pz[i]) {
          px[i] = _col.x; pz[i] = _col.z;            // shoved out of the wall
          repick(i);                                 // repick so it doesn't grind back in; don't reckon back into the wall
        }
      }
    }
  }

  // Scatter the instanced crowd away from a threat at (ex,ez). Called by the city
  // EVENT bus (cityevents.js → cityPostEvent) on gunfire/explosions. A linear scan of
  // the ≤count bodies is cheap and events are ring-throttled, so no extra rate-limit.
  // Each in-range body gets a flee heading (unit vector away) + a panic timer scaled
  // by intensity and distance falloff; sim()'s panic branch does the running.
  CBZ.cityCrowdFlee = function (ex, ez, radius, intensity) {
    if (!CBZ.crowdMassFlee || !count) return;
    const r = radius > 0 ? radius : 24, r2 = r * r, it = intensity > 0 ? intensity : 1;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || corpseT[i] > 0 || suppressed[i] || promotedBy[i] >= 0) continue;
      const dx = px[i] - ex, dz = pz[i] - ez, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 0.001, inv = 1 / d;
      fleeHX[i] = dx * inv; fleeHZ[i] = dz * inv;                 // unit vector AWAY from the threat
      const ttl = (1.4 + 2.6 * (1 - d / r)) * (0.6 + 0.7 * it);   // ~1.4–4.7s, closer + louder = longer
      if (ttl > panicT[i]) panicT[i] = ttl;                      // refresh, never shorten an active panic
    }
  };

  function put(mesh, i, lx, ly, lz, sx, sy, sz, rx) {
    partD.position.set(lx, ly, lz);
    partD.rotation.set(rx || 0, 0, 0);
    partD.scale.set(sx, sy, sz);
    partD.updateMatrix();
    wm.multiplyMatrices(rootD.matrix, partD.matrix);
    mesh.setMatrixAt(i, wm);
  }
  // the 10 body parts at standard proportions (matches the jail mass-crowd).
  // WOMEN IN THE CROWD (W3): fem[i] set → a narrower/shallower torso, a
  // slightly smaller head, slimmer + closer-in arms, slimmer legs, and hair
  // that reads LONG (dropped y-offset + stretched y-scale so it cascades down
  // behind the head instead of sitting as a short cap). Every number below is
  // ONLY a scale/offset tweak on the SAME put() calls/instances — the male
  // (else) branch is byte-identical to the original single path.
  function drawParts(i, sw, bob) {
    if (fem[i]) {
      put(torso, i, 0, 1.42 + bob, 0, 0.82 * 0.85, 0.88, 0.44 * 0.88, 0);
      put(hd, i, 0, 2.18 + bob, 0, 0.54 * 0.92, 0.54 * 0.92, 0.54 * 0.92, 0);
      // LONG HAIR: same cap width, dropped ~0.35 lower and stretched ~4.4x
      // taller so it drapes down behind the head to shoulder height instead
      // of reading as a short crown.
      put(hair, i, 0, 2.15 + bob, 0, 0.58, 0.62, 0.58, 0);
      put(legL, i, -0.20, 0.52, 0, 0.28 * 0.9, 0.92, 0.28 * 0.9, sw);
      put(legR, i, 0.20, 0.52, 0, 0.28 * 0.9, 0.92, 0.28 * 0.9, -sw);
      put(armL, i, -0.55 * 0.9, 1.40 + bob, 0, 0.24 * 0.83, 0.78, 0.24 * 0.83, -sw * 0.82);
      put(armR, i, 0.55 * 0.9, 1.40 + bob, 0, 0.24 * 0.83, 0.78, 0.24 * 0.83, sw * 0.82);
    } else {
      put(torso, i, 0, 1.42 + bob, 0, 0.82, 0.88, 0.44, 0);
      put(hd, i, 0, 2.18 + bob, 0, 0.54, 0.54, 0.54, 0);
      put(hair, i, 0, 2.50 + bob, 0, 0.58, 0.14, 0.58, 0);
      put(legL, i, -0.20, 0.52, 0, 0.28, 0.92, 0.28, sw);
      put(legR, i, 0.20, 0.52, 0, 0.28, 0.92, 0.28, -sw);
      put(armL, i, -0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, -sw * 0.82);
      put(armR, i, 0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, sw * 0.82);
    }
    // FACE — the head box is 0.54 deep (front face at local z 0.27). The old
    // z 0.235 + 0.06-deep eyes put the face's FRONT at 0.265 — fully BURIED
    // inside the head, so the whole instanced crowd read as faceless mannequins.
    // Deep boxes centred at z 0.25 stick ~0.04 proud of the face AND wrap back
    // into the head, so eyes/mouth read from any reasonable angle, not just
    // dead-on. Same instances, zero new draw calls.
    put(eyeL, i, -0.12, 2.235 + bob, 0.25, 0.11, 0.14, 0.12, 0);
    put(eyeR, i, 0.12, 2.235 + bob, 0.25, 0.11, 0.14, 0.12, 0);
    put(mouth, i, 0, 2.045 + bob, 0.255, 0.22, 0.055, 0.10, 0);
  }
  const FARDRAW2 = 95 * 95;     // beyond this, matrix rewrites drop to every 4th frame
  function render() {
    if (!ready || !count) return;
    const frame = _simFrame;
    const P = CBZ.player;
    const ppx = P ? P.pos.x : 0, ppz = P ? P.pos.z : 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || suppressed[i] || promotedBy[i] >= 0) {  // faded corpse, thinned off-street, or promoted to a real rig → collapse the instanced body
        if (collapsedQ[i]) continue;                   // park matrices already written — skip the 11 rewrites
        collapsedQ[i] = 1;
        wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
        for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, wm);
        if (shadowQ) shadowQ.setMatrixAt(i, wm);   // blob collapses with the body
        continue;
      }
      collapsedQ[i] = 0;                               // visible again → park matrices need rewriting next collapse
      if (corpseT[i] > 0) {                            // freshly killed → lie flat ON the ground
        // Rotating the standing rig 90° about X lays it on its back: each part's
        // local +Z (body depth) becomes the world-vertical extent. The thickest
        // parts (head/torso, ~0.27 half-depth) set how high the whole body must
        // ride so NOTHING sinks below the surface — lift the lying body to ~0.42
        // above the floor so it rests cleanly ON the ground, not bisected by it.
        const fy = (CBZ.floorAt ? CBZ.floorAt(px[i], pz[i]) : 0) + 0.42;
        rootD.position.set(px[i], fy, pz[i]);
        rootD.rotation.set(Math.PI / 2, heading[i], 0);
        rootD.scale.set(1, 1, 1);
        rootD.updateMatrix();
        drawParts(i, 0, 0);
        if (shadowQ) {                               // the dead still touch the ground:
          shadD.position.set(px[i], fy - 0.38, pz[i]);   // floor + 0.04 (fy carries the 0.42 lying lift)
          shadD.rotation.set(-Math.PI / 2, 0, heading[i]);   // long smear aligned under the lying body
          shadD.scale.set(1.5, 2.3, 1);
          shadD.updateMatrix();
          shadowQ.setMatrixAt(i, shadD.matrix);
        }
        continue;
      }
      // far bodies move sub-pixel per frame — rewrite their 11 matrices every
      // 4th frame (round-robin) and let the stale pose coast in between.
      const rdx = px[i] - ppx, rdz = pz[i] - ppz;
      const isFar = rdx * rdx + rdz * rdz > FARDRAW2;
      if (isFar && ((frame + i) & 3) !== 0) continue;
      // FEET ON THE GROUND: the city is flat (groundHeightAt→0) so this is 0
      // today, but route through floorAt like the corpse path so a body never
      // sinks/floats if it walks onto raised terrain (beach/boardwalk/etc).
      const fy = CBZ.floorAt ? CBZ.floorAt(px[i], pz[i]) : 0;
      rootD.position.set(px[i], fy, pz[i]);
      if (stagT[i] > 0) {
        // bumped: face the shover, pitch away with the shove — a readable
        // stumble straight off the verlet-style skid, no rig animation needed.
        const lean = Math.min(0.55, stagT[i] * 1.1);
        rootD.rotation.set(lean, Math.atan2(stagX[i], stagZ[i]) + Math.PI, 0);
      } else rootD.rotation.set(0, heading[i], 0);
      rootD.scale.set(1, 1, 1);
      rootD.updateMatrix();
      // STOP THE FAR-TIER LEG STROBE: a far body's matrices are only rewritten
      // every 4th frame, but phase[i] keeps advancing every frame — so on each
      // write Math.sin(phase[i]) has jumped ~4 frames of swing, snapping the legs
      // to a new angle 4× a second (the filmed far-crowd leg strobe / stutter).
      // The legs are sub-pixel out there anyway, so draw the far tier in a STILL
      // pose (sw 0, bob 0 — exactly like the corpse path) and let only the body's
      // SLIDE (position) read as motion. The 0.94-quarter shadow stays a plain
      // disc. Near bodies (full per-frame rewrites) keep the normal walk cycle.
      const sn = isFar ? 0 : (stagT[i] > 0 ? Math.sin(phase[i]) * 0.25 : Math.sin(phase[i]));
      drawParts(i, isFar ? 0 : sn * 0.5, isFar ? 0 : Math.abs(Math.cos(phase[i])) * 0.05);
      if (shadowQ) {
        shadD.position.set(px[i], fy + 0.04, pz[i]);  // a hair above the surface (+ polygonOffset)
        shadD.rotation.set(-Math.PI / 2, 0, 0);
        const ss = 1.18 + Math.abs(sn) * 0.22;       // stride spreads the contact patch — reads as WALK
        shadD.scale.set(ss, ss * 0.94, 1);
        shadD.updateMatrix();
        shadowQ.setMatrixAt(i, shadD.matrix);
      }
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
    if (shadowQ) shadowQ.instanceMatrix.needsUpdate = true;
  }

  // ---- promotion pool: real makeCharacter peds reused as you move ----
  // isolate a pooled rig's tinted materials once so recolouring it per agent
  // can't bleed onto the shared material cache.
  function cloneLook(ped) {
    const ch = ped.char; if (!ch) return;
    const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
    if (ch.head && ch.head.material) ch.head.material = ch.head.material.clone();
    const ss = ch.skinSlots || {};
    iso(ss.hands); iso(ss.arms); iso(ss.armsLower); iso(ss.hair); iso(ss.torso); iso(ss.collar);
  }
  function setLook(ped, skinHex, shirtHex, hairHex) {
    const ch = ped.char; if (!ch) return;
    // PLAIN CIVILIANS (CBZ.CONFIG.CITY_PLAIN_CIVVIES, default on): a body
    // stepping out of the instanced mass is an ordinary civilian — a SOLID
    // shirt, no painted canvas. A pooled rig is reused, so the previous
    // occupant may have left a painted garment (cop/tux/biz) on it; strip that
    // back to flat geometry+materials first, else setHex would tint the painted
    // texture (the orange-tux bug). outfits.js redressPed re-paints any body
    // that recasts into a real role/gang/business identity right after this.
    const C = CBZ.CONFIG, plain = !C || C.CITY_PLAIN_CIVVIES == null || !!C.CITY_PLAIN_CIVVIES;
    if (plain && ch._clothesKey != null && CBZ.cityApplyClothes) CBZ.cityApplyClothes(ch, null);
    // a stale bandana from a prior gang occupant must go too (clothes.js mesh)
    if (plain && ch._bandana && CBZ.cityAttachBandana) CBZ.cityAttachBandana(ch, null);
    const paint = (arr, hex) => (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(hex); });
    if (ch.head && ch.head.material && ch.head.material.color) ch.head.material.color.setHex(skinHex);
    const ss = ch.skinSlots || {};
    paint(ss.hands, skinHex); paint(ss.arms, skinHex); paint(ss.armsLower, skinHex); paint(ss.hair, hairHex);
    paint(ss.torso, shirtHex); paint(ss.collar, shirtHex);
  }
  function makePooled() {
    const A = arena();
    const ped = CBZ.cityMakePed(PARK, PARK, Math.random, { kind: "civilian" });
    ped._crowd = true; ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    cloneLook(ped);
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    return ped;
  }
  // Build the pool the REST of the way to PROMO. With PREWARM the prewarmTick()
  // has usually already filled most/all of it across earlier frames, so this is a
  // no-op or a tiny top-up; without prewarm (or if a body is needed before the warm
  // finished) it completes synchronously — the exact OLD behaviour, so this is a
  // clean fallback that can never leave the pool short.
  function buildPool() {
    if (poolBuilt) return;
    if (!arena() || !CBZ.cityMakePed || !CBZ.cityPeds) return;
    // resume in-place: keep any rigs the pre-warm already constructed (don't throw
    // them away and rebuild — that would re-spike). Only allocate the shortfall.
    if (!Array.isArray(pool)) pool = [];
    while (pool.length < PROMO) pool.push({ ped: makePooled(), idx: -1 });
    prewarming = false;
    poolBuilt = true;
  }
  // ---- AMORTIZED PRE-WARM: build a few pooled rigs per frame until the pool is
  //      full, then stop. Started at city load (spawnCityCrowd) so construction
  //      happens BEFORE the first encounter, spread thin enough to never spike a
  //      single frame. Guests never build the real pool (host owns the population).
  function prewarmTick() {
    if (!prewarming || poolBuilt) { prewarming = false; return; }
    if (CBZ.net && CBZ.net.noSim()) { prewarming = false; return; }   // guest: cosmetic crowd only
    if (!arena() || !CBZ.cityMakePed || !CBZ.cityPeds) return;        // deps not ready yet → try again next frame
    if (!Array.isArray(pool)) pool = [];
    let made = 0;
    while (pool.length < PROMO && made < PREWARM_PER_FRAME) { pool.push({ ped: makePooled(), idx: -1 }); made++; }
    if (pool.length >= PROMO) { poolBuilt = true; prewarming = false; }   // pool complete — promotion is now instant
  }
  function park(e) {
    if (CBZ.cityPedStash) CBZ.cityPedStash(e.ped);   // bank the identity before the body leaves play
    const ped = e.ped;
    ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    ped.rage = null; ped.mem = null; ped.state = "walk"; ped.path = null; ped.finalGoal = null;
    e.idx = -1;
  }
  // ---- GENDER-MATCHED SLOT PICK (W3) ----
  // A pooled rig's BUILD ("f"/"m") is baked into its actual geometry at
  // construction (makePooled → cityMakePed → makeCharacter's build param) and
  // can't be reshaped when the slot is reused for a different agent — so we
  // can't literally "make the promoted ped inherit fem" after the fact. What
  // we CAN do cheaply: cityMakePed already rolls its own gender per pooled rig
  // (makePed's own ~48/52 split, independent of any instanced agent), so the
  // pool already reads as a mixed crowd — pick the FREE slot whose rig gender
  // already matches this instance's fem[] flag when one is free, so the body
  // that walks up doesn't flip silhouette from what you were watching. Falls
  // back to any free slot (never blocks a promotion over a cosmetic match).
  function pickFreeSlot(wantFem) {
    const wantG = wantFem ? "f" : "m";
    let fallback = -1;
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s];
      if (e.idx >= 0) continue;
      if (fallback < 0) fallback = s;
      if (e.ped.gender === wantG) return s;
    }
    return fallback;
  }
  // ---- NO CLOTHING-CHANGE POP ON PROMOTION (LOD continuity) ----
  // The instanced body can only ever render a FLAT shirt — it has no badge, no
  // lapels, no bandana — so to the player every distant ambient body reads as an
  // ordinary plain civilian in the shirt color we tinted it (SHIRTS[shirt[i]]).
  // When that body is promoted to a real rig it must walk up wearing EXACTLY that:
  // the same plain civilian, the same shirt. The old path re-rolled a fresh role
  // (cop/hi-vis/tux/gang/socialite) ON the body you were walking toward AND reused
  // a pooled rig that still carried the PREVIOUS occupant's painted uniform — so
  // setLook() tinted the crowd shirt and then redressPed() instantly repainted it
  // into a uniform the distant body never showed: the visible "dumb load-in"
  // clothing swap. Fix: wipe the pooled rig back to a CLEAN plain-civilian identity
  // and stamp THIS agent's crowd shirt as the ped's outfit BEFORE any dress runs,
  // so every redress path (cityRecastForHour / cityPedDeal → outfits.js redressPed)
  // keeps the body plain and keeps the exact shirt the player just saw. Night
  // BEHAVIOUR churn still happens — but only off-screen, via peds.js's margins pass
  // (gated by VIS_D2), never on the body in your face. A genuine banked identity
  // (cityPedDeal) can still re-seat a specific remembered person and re-dress them.
  function resetToPlain(ped, shirtHex) {
    // identity → ordinary resident (clear any stale role the pooled rig wore last)
    ped.archetype = "resident"; ped.job = "between jobs";
    ped.gang = null; ped.vendor = null; ped.vagrant = false;
    ped.bounty = 0; ped.bountyTag = null;
    // wardrobe-revert reads in outfits.js: no cast fit, no worn record, no stashed
    // day-cast, no role tag → redressPed takes its plain-civilian branch and keeps
    // the live (crowd) shirt instead of repainting a uniform.
    ped._castFit = null; ped._wornOutfit = null; ped._dayCast = null;
    ped._role = null; ped._work = null; ped._castNight = void 0;
    // the shirt the instanced body was rendering IS this person's outfit now, so
    // liveTorsoHex/civShirtFor and every downstream read agree with what was seen.
    ped.outfit = shirtHex;
  }
  function assign(e, s, i) {
    const ped = e.ped;
    ungroup(i);          // promoted to a real rig → any walking-group link releases (followers go solo)
    e.idx = i; promotedBy[i] = s;
    ped._parked = false; ped.dead = false; ped.deadT = 0; ped.ko = 0; ped.culled = false; ped.collected = false; ped.needsPickup = false;
    ped.pos.set(px[i], 0, pz[i]); ped.char.group.rotation.y = heading[i];
    // PROMOTION MOTION CONTINUITY: the instanced body you were watching was
    // WALKING along its cached heading; the real ped must pick that walk straight
    // up. The old hand-off parked it (target == its own pos) AND added a 0.2-0.8s
    // pause → the body you approached FROZE solid the instant it became "real" (the
    // filmed freeze-on-approach). Instead, aim the fresh target a few metres ahead
    // down the SAME heading the instanced agent was carrying (dirX/dirZ are its
    // live dead-reckoning unit vector) and zero the pause — so it keeps striding
    // through the swap with no visible hitch. (The ped's own brain repicks a proper
    // waypoint within a stride; this just bridges the one-frame identity hand-off.)
    const AHEAD = 4;
    ped.target.set(px[i] + dirX[i] * AHEAD, 0, pz[i] + dirZ[i] * AHEAD);
    ped.group.visible = true;
    ped.state = "walk"; ped.path = null; ped.finalGoal = null; ped.pause = 0;
    const shirtHex = SHIRTS[shirt[i]];
    // CLEAN SLATE FIRST: drop the prior occupant's role/outfit and adopt the
    // instanced body's exact shirt, so what walks up matches what you saw.
    resetToPlain(ped, shirtHex);
    setLook(ped, SKINS[skin[i]], shirtHex, HAIRS[hairC[i]]);
    // a remembered identity DUE at this spot (a banked dealer/regular walking back
    // in, carrying its take) is the one legitimate non-plain promotion — it sets
    // its own identity + re-dresses itself. Everyone else stays the plain civilian
    // we just painted. The on-promotion hour-recast is GONE: it minted a uniform on
    // the body in your face (the pop); night churn now lives only in peds.js's
    // off-screen margins pass (VIS_D2-gated), so nobody ever changes clothes as you
    // approach. cityRecastForHour still runs there for the behavioural turnover.
    if (CBZ.cityPedDeal) CBZ.cityPedDeal(ped);
  }
  function releaseAll() {
    if (!poolBuilt) return;
    for (let s = 0; s < pool.length; s++) { const e = pool[s]; if (e.idx >= 0) { promotedBy[e.idx] = -1; park(e); } }
  }
  function updatePromotion() {
    // multiplayer guest: the crowd is pure local set-dressing — never promote
    // an agent into a real simulated ped (the host owns the real population)
    if (CBZ.net && CBZ.net.noSim()) return;
    if (!poolBuilt) { buildPool(); if (!poolBuilt) return; }
    const P = CBZ.player; if (!P) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    // 1) reconcile currently-promoted slots
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx < 0) continue;
      const i = e.idx, ped = e.ped;
      if (ped.dead) { ungroup(i); deadAgent[i] = 1; promotedBy[i] = -1; pool[s] = { ped: makePooled(), idx: -1 }; continue; } // killed → consume agent, fresh pool ped
      px[i] = ped.pos.x; pz[i] = ped.pos.z; heading[i] = ped.char.group.rotation.y;   // mirror live motion back
      const dx = ped.pos.x - ppx, dz = ped.pos.z - ppz;
      // keep YOUR killer promoted + on-map while you spectate it after WASTED
      // (city/death.js sets g._citySpecTarget); otherwise this park-on-death sweep
      // would banish a crowd-pool killer off-map and the kill-cam would orbit empty
      // space. Everyone else parks as usual.
      if (CBZ.game._citySpecTarget && ped === CBZ.game._citySpecTarget) continue;
      // the velvet-rope LINE (club.js) drafts promoted crowd bodies like any
      // other nearby civilian — never park one mid-queue, or the line holds a
      // ghost slot pointing at an off-map body. It re-parks once released.
      if (ped._clubLine || ped._clubGoingIn) continue;
      if (P.dead || P.driving || dx * dx + dz * dz > PROMO_OUT2) { promotedBy[i] = -1; park(e); }   // walked away → back to density
    }
    if (P.dead || P.driving) return;
    // camera facing (city look dir): used to extend promotion reach for agents
    // you're looking AT, so distant NPCs down your sightline are real by the time
    // you draw a bead on them — you can shoot or run anyone you can see.
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // 2) promote agents into any free slots: nearby in any direction, OR farther
    //    out but inside the forward cone. Score = squared distance, but agents in
    //    front get their effective range pushed out to PROMO_AHEAD2.
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx >= 0) continue;
      let best = -1, bd = PROMO_AHEAD2;
      for (let i = 0; i < count; i++) {
        if (promotedBy[i] >= 0 || deadAgent[i] || suppressed[i]) continue;
        const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
        if (d2 >= bd) continue;
        // near in any direction, OR ahead of the camera within the far range
        const dn = Math.sqrt(d2) || 1;
        const ahead = (dx / dn) * fx + (dz / dn) * fz >= AHEAD_DOT;
        const range = ahead ? PROMO_AHEAD2 : PROMO_IN2;
        if (d2 < range && d2 < bd) { bd = d2; best = i; }
      }
      if (best < 0) break;
      // gender-matched slot pick (W3): e/s is only a guaranteed-free anchor —
      // prefer whichever free pooled rig already matches this agent's fem[]
      // flag (falls back to e/s itself when none free matches).
      const slotIdx = pickFreeSlot(!!fem[best]);
      assign(pool[slotIdx], slotIdx, best);
      // ONE promotion per frame: filling every free slot in one frame is
      // O(slots×agents) (worst ~18×360 sqrt scans after a mass release);
      // refilling over ~0.3s instead is invisible at promotion distances.
      break;
    }
  }
  // ---- COVERAGE BALANCE: keep the crowd spread over the WHOLE map ------------
  // ROOT CAUSE (user: "they all crowd one area"): the old aheadReseed teleported
  // far agents into a 30-64m ring INSIDE the camera's FORWARD CONE every frame.
  // Because the player keeps moving, bodies that were ahead fell behind, became
  // re-eligible, and got vacuumed forward again — so over a minute of walking the
  // bulk of the 700-strong population collapsed into one moving blob in front of
  // the camera and the rest of the city emptied (measured: 82% of agents ended up
  // within 70m of the player; cell-occupancy fell from 96/144 to 51/144).
  //
  // FIX (open-world / GTA-popcycle model + blue-noise even coverage): the static
  // district density FIELD owns where the crowd lives, NOT where the player looks.
  // This pass only CORRECTS two failure modes, both off-screen, on a tiny budget:
  //   • DRAIN GUARD — if more than a fair LOCAL SHARE of the living crowd is
  //     packed near the player, push the surplus (the FARTHEST-from-player of the
  //     near set is left alone; we recycle ones at the edge of the near ring) back
  //     out through the whole-map density draw (drawPoint), re-spreading them so
  //     distant districts refill instead of starving. This is what stops the blob.
  //   • SPARSE FILL — only when the player's own block is genuinely empty AND the
  //     player stands in a district the field says should be busy, trickle a
  //     couple of far agents into a ring AROUND the player, drawn through the SAME
  //     density field so a quiet quarter (docks / 3am) stays quiet.
  // No bodies are created/destroyed (finite headcount preserved); we only retarget
  // a few existing agents per frame. Draw-call neutral (instanced; count fixed).
  //
  // POP-IN FIX (2026-06-30): the omnidirectional ring above used to be the WHOLE
  // story, and it landed bodies as close as FILL_NEAR=26m in an arbitrary
  // direction — including right where the camera is already looking, so a body
  // could materialize 26m dead ahead with nothing stopping it (this is distinct
  // from the old forward-VACUUM bug above: that one *continuously* re-funnelled
  // the WHOLE crowd into the cone every frame with no distance floor; this is a
  // one-shot bias on an already rate/budget-gated relocation, with a forced
  // FARTHER floor in front of you and an omni fallback, so it can't reproduce the
  // blob). Mirrors the promotion step's existing forward-cone mechanism (AHEAD_DOT/
  // PROMO_AHEAD2 above): candidates landing inside the camera's forward cone are
  // now allowed/preferred to seat FARTHER out (AHEAD ring), so a relocated body
  // that happens to land in your sightline is already distant when you first see
  // it, instead of popping in at the same close 26m used for behind-you coverage.
  // Bodies landing outside the cone (beside/behind you, off-screen) still use the
  // original close-in ring — that's coverage, not a spotlight, and is what keeps
  // this from re-funnelling the whole crowd forward like the old bug.
  const NEAR_R = 90;                              // "local" radius around the player
  const NEAR_R2 = NEAR_R * NEAR_R;
  // fair share of the LIVING crowd allowed inside NEAR_R. The near disc is a small
  // slice of the ~258m-wide map (π·90² ≈ 0.4 of the play area), so allotting ~45%
  // of the crowd to it already reads as a believably busier foreground without
  // draining the rest. Surplus past this gets re-spread.
  const NEAR_SHARE = 0.45;
  const FILL_NEAR = 26, FILL_FAR = 60;            // ring around the player for sparse-fill (off-cone / behind)
  // AHEAD ring: candidates that land INSIDE the forward cone get pushed to this
  // farther band instead — same idea as PROMO_AHEAD2, just applied one step
  // earlier (at the instanced-body relocation, before promotion ever looks at
  // it), so the underlying body itself never appears close-and-ahead.
  const FILL_AHEAD_NEAR = 45, FILL_AHEAD_FAR = 90;
  const FILL_MIN = 10;                            // below this many locals → allow a fill
  let reseedScan = 0;
  // shared forward-cone test (mirrors the promotion pass's AHEAD_DOT check):
  // true when (rx,rz) — a vector FROM the player TO the candidate point — falls
  // inside the camera's forward cone. Cheap (one normalize + one dot); only
  // called a handful of times per frame (DRAIN/FILL are already rate-capped).
  function inForwardCone(rx, rz) {
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rd = Math.hypot(rx, rz) || 1;
    return (rx / rd) * fx + (rz / rd) * fz >= AHEAD_DOT;
  }
  function aheadReseed() {
    const P = CBZ.player; if (!P || P.dead) return;
    const A = arena(); if (!A || !A.randomSidewalkPoint) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    // census: how many living, on-street, non-promoted agents are near the player,
    // and the live total (the budget the fair-share is a fraction of). One cheap
    // O(count) scan reused for both decisions.
    let near = 0, live = 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || corpseT[i] > 0 || suppressed[i] || promotedBy[i] >= 0) continue;
      live++;
      const dx = px[i] - ppx, dz = pz[i] - ppz;
      if (dx * dx + dz * dz < NEAR_R2) near++;
    }
    const fairNear = Math.max(FILL_MIN + 4, (live * NEAR_SHARE) | 0);
    const over = near > fairNear;                 // crowd is piling up on the player
    const sparse = near < FILL_MIN;               // player's block is a ghost town
    if (!over && !sparse) return;                 // density already fair here — leave it
    let moved = 0, scanned = 0;
    // walk a rolling window of agents (a few per frame) so the cost is bounded
    for (let n = 0; n < count && scanned < 60 && moved < 3; n++) {
      const i = reseedScan; reseedScan = (reseedScan + 1) % Math.max(1, count); scanned++;
      if (deadAgent[i] || corpseT[i] > 0 || promotedBy[i] >= 0 || suppressed[i]) continue;
      const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
      if (over) {
        // DRAIN GUARD: recycle agents at/just inside the near ring (not the ones
        // right on top of you — those would visibly vanish) OUT to a whole-map
        // density point, so the surplus repopulates distant districts. Far-bias:
        // only touch ones in the OUTER half of the near disc, which are off-screen
        // enough that a relocate doesn't pop in the player's face.
        if (d2 < (NEAR_R * 0.6) * (NEAR_R * 0.6) || d2 >= NEAR_R2) continue;
        for (let t = 0; t < 4; t++) {
          drawPoint(_tmp);
          const rx = _tmp.x - ppx, rz = _tmp.z - ppz, rd2 = rx * rx + rz * rz;
          if (rd2 < NEAR_R2) continue;   // must land OUTSIDE the local disc
          // POP-IN: a draw that happens to fall in front of the camera must clear
          // the same farther AHEAD floor sparse-fill uses below — otherwise the
          // drain could hand a sightline slot right back at the close edge of the
          // local disc (NEAR_R, ~90m — already closer than this game wants a
          // forward body to first appear). Off-cone draws are untouched (that's
          // the coverage path, not a spotlight).
          if (inForwardCone(rx, rz) && rd2 < FILL_AHEAD_NEAR * FILL_AHEAD_NEAR) continue;
          ungroup(i);                                  // teleport → drop any walking-group link
          px[i] = _tmp.x; pz[i] = _tmp.z;
          castTint(i, px[i], pz[i]); repaintShirt(i);  // re-dress for the district it lands in
          repick(i);
          moved++; break;
        }
      } else {
        // SPARSE FILL: only pull bodies from genuinely FAR away, and seat them in a
        // ring around the player, drawn through the density field so a quiet
        // district refuses to fill. POP-IN FIX: a candidate that lands inside the
        // camera's forward cone (where you're actually looking, and where you're
        // about to WALK) is required to clear the farther FILL_AHEAD ring instead
        // of the close FILL_NEAR one — so a body materializing in your sightline
        // is already distant the first time you see it. Off-cone candidates
        // (beside/behind you, off-screen either way) still use the close ring —
        // that's coverage, not a spotlight, and is what keeps this from
        // re-funnelling the whole crowd forward like the old aheadReseed bug.
        if (d2 < NEAR_R2 * 1.6) continue;         // only recycle distant agents
        for (let t = 0; t < 4; t++) {
          fieldPoint(_tmp);                        // biome bubble pulls fill INTO the active region
          const rx = _tmp.x - ppx, rz = _tmp.z - ppz, rd = Math.hypot(rx, rz) || 1;
          const ahead = inForwardCone(rx, rz);
          const lo = ahead ? FILL_AHEAD_NEAR : FILL_NEAR, hi = ahead ? FILL_AHEAD_FAR : FILL_FAR;
          if (rd < lo || rd > hi) continue;        // land in the appropriate ring
          ungroup(i);                                  // teleport → drop any walking-group link
          px[i] = _tmp.x; pz[i] = _tmp.z;
          castTint(i, px[i], pz[i]); repaintShirt(i);
          repick(i);
          moved++; break;
        }
      }
    }
  }

  // ---- BUMP KNOCKDOWNS: collision IS the crowd AI ----
  // No personal-space pathing — if something fast hits a body, the body reacts
  // physically. Walking pace just shoulders people aside; a brisk runner makes
  // them stumble (skid + lean + recover); a full sprint — yours or a fleeing
  // ped's — bowls them over. Near-camera victims get PROMOTED into real rigs
  // first so the shared body physics sells the hit, and the victim then reacts
  // in character (curse, scramble, swing) through humancontact like any shove.
  // Movers are the player + the handful of fast full rigs near the camera, so
  // the pass is movers × agents (a few thousand mults), never O(n²) pairs.
  const BUMP_R2 = 1.05 * 1.05;     // mover-vs-agent contact distance²
  const STUMBLE_SPD = 3.0;         // relative speed → stumble (below: a shove aside)
  const RIG_KD_SPD = 4.6;          // a sprinting/fleeing RIG bowls bodies past this
  const MOVERS = 10;
  const _mvX = new Float32Array(MOVERS), _mvZ = new Float32Array(MOVERS), _mvS = new Float32Array(MOVERS);
  const _mvKD = new Uint8Array(MOVERS);      // mover hits hard enough to knock down
  const _mvRef = new Array(MOVERS);          // mover actor (null = the player → an INSTANCED-source bump)
  const _mvAgent = new Int32Array(MOVERS);   // instanced-source mover's own agent index (-1 = rig/player)
  _mvAgent.fill(-1);                          // every slot is rewritten per gather; -1 baseline so an unset slot can never read as agent 0
  // one-hit-per-agent-per-frame guard WITHOUT an O(CAP) clear: stamp the frame a
  // body was bumped and compare; never cleared, so wrap is harmless (a stale stamp
  // only ever matches its OWN frame). The instanced movers can overlap 3×3 cells,
  // so without this an agent in two neighbourhoods could take two shoves a frame.
  const _bumpStamp = new Int32Array(CAP);
  let _bumpFrame = 0;
  // NPC<->NPC bumps: the instanced mass is far too large to test pairwise, so we
  // hash the LIVE agents into a 2m uniform grid each frame (CBZ.makeGrid — one
  // persistent Map, alloc-free after warm-up) and only resolve a mover against the
  // 3×3 cells around it. The fastest instanced agents (spd≥STUMBLE_SPD) become
  // movers themselves, slotted into the SAME _mv* arrays as the rig movers, so the
  // resolve loop and bumpAgent() don't need to know the source kind.
  let _bumpGrid = null;                      // CBZ.makeGrid(2.0), built lazily (cell ≈ 2× contact reach)
  const _gridIdx = [];                       // index list fed to grid.rebuild (reused; holds live agent indices)
  const _gridVec = { x: 0, z: 0 };           // getVec scratch (the grid reads px/pz through this)
  let _gridBuiltFrame = -1;                  // bump + separation share one rebuild per sim frame
  function _agentVec(i) { _gridVec.x = px[i]; _gridVec.z = pz[i]; return _gridVec; }
  function rebuildAgentGrid() {
    if (!_bumpGrid) { if (!CBZ.makeGrid) return false; _bumpGrid = CBZ.makeGrid(2.0); }
    if (_gridBuiltFrame === _simFrame) return true;
    _gridIdx.length = 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0 || stagT[i] > 0) continue;
      _gridIdx.push(i);
    }
    _bumpGrid.rebuild(_gridIdx, _agentVec);
    _gridBuiltFrame = _simFrame;
    return true;
  }
  const _bumpSrc = { isPlayer: true, pos: null };   // react() source for player bumps
  // react() source for an INSTANCED-agent-on-agent bump: explicitly NOT the player
  // (no isPlayer flag), so a promoted victim reacts to the SHOVER, not to you —
  // otherwise every NPC pile-up would file player crimes / sic cops on you / make
  // bystanders fight you for a collision you never caused. One reused object; its
  // pos is repointed to the mover each resolve (alloc-free).
  const _npcSrc = { isPlayer: false, _crowdBump: true, pos: { x: 0, z: 0 } };
  const _victims = [];                       // near, slow, upright rigs (reused)
  // NPC<->NPC chain reactions can knock over MANY bodies in one frame (a sprinter
  // ploughs a line, the fallers ploughs the next), and each real-rig promotion is
  // a ragdoll + humancontact brain + draw calls. Cap NEW promotions per frame so a
  // pile-up can't spike a frame; overflow victims still react via the free instanced
  // skid below (zero allocation), so the chain keeps propagating — just cheaper.
  const PROMO_CAP_FRAME = 4;
  let _promoBudget = PROMO_CAP_FRAME;        // remaining rig promotions THIS frame (reset in bumpPass)
  function bumpAgent(i, nx, nz, sp, kd, ref) {
    const guest = CBZ.net && CBZ.net.noSim();          // guests never spawn real peds
    if (kd && !guest && _promoBudget > 0) {
      // promote → real rig → real knockdown physics (the comedy payoff)
      if (!poolBuilt) buildPool();
      if (poolBuilt) {
        // gender-matched slot pick (W3) — see pickFreeSlot() above.
        const slotIdx = pickFreeSlot(!!fem[i]);
        if (slotIdx >= 0) {
          const e = pool[slotIdx];
          assign(e, slotIdx, i);
          _promoBudget--;                                // spent one of this frame's rig slots
          const ped = e.ped;
          if (CBZ.body && CBZ.body.knockdown) {
            CBZ.body.knockdown(ped, { fromX: px[i] - nx, fromZ: pz[i] - nz, force: 7 + Math.min(8, sp * 0.6), t: 1.1 + Math.random() * 0.7 });
          }
          if (CBZ.humanContact) {                        // gets up cursing / swinging / fleeing per aggr
            _bumpSrc.pos = CBZ.player.pos;
            CBZ.humanContact.react(ped, { mode: "city", source: ref || _bumpSrc, kind: "run-over", severity: 1 });
          }
          if (CBZ.sfx) CBZ.sfx("ko");
          return;
        }
      }
    }
    if (kd) {
      // no free rig slot (or guest): a violent instanced skid still sells it
      stagT[i] = 1.0 + Math.random() * 0.3;
      stagX[i] = nx * (3.5 + sp * 0.5); stagZ[i] = nz * (3.5 + sp * 0.5);
    } else if (sp >= STUMBLE_SPD) {
      stagT[i] = 0.45 + Math.random() * 0.25;
      stagX[i] = nx * (1.6 + sp * 0.35); stagZ[i] = nz * (1.6 + sp * 0.35);
    } else {
      // a walking-pace shoulder: they just get shifted aside, no drama
      px[i] += nx * 0.35; pz[i] += nz * 0.35;
    }
  }
  function bumpPass(dt) {
    const P = CBZ.player; if (!P || !count) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    _promoBudget = PROMO_CAP_FRAME;                     // refill this frame's rig-promotion allowance
    _bumpFrame++;                                       // new one-hit-per-agent epoch
    // 1) gather movers: the player on foot + any fast rig near the camera
    let nm = 0;
    if (!P.dead && !P.driving && (P.speed || 0) > 1.5) {
      _mvX[nm] = ppx; _mvZ[nm] = ppz; _mvS[nm] = P.speed || 0;
      _mvKD[nm] = (P.sprint && (P.speed || 0) >= 6.2) ? 1 : 0;   // same charge gate as humancontact
      _mvRef[nm] = null; _mvAgent[nm] = -1; nm++;
    }
    _victims.length = 0;
    const peds = CBZ.cityPeds;
    if (peds) for (let k = 0; k < peds.length && nm < MOVERS; k++) {
      const p = peds[k];
      if (p._parked || p.dead || p.inCar || p.culled || !p.pos) continue;
      const dx = p.pos.x - ppx, dz = p.pos.z - ppz;
      if (dx * dx + dz * dz > 45 * 45) continue;       // bump theatre is near-camera only
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(p)) continue;
      const sp = p.speed || 0;
      if (sp >= STUMBLE_SPD) {                          // a runner — a mover
        _mvX[nm] = p.pos.x; _mvZ[nm] = p.pos.z; _mvS[nm] = sp;
        _mvKD[nm] = sp >= RIG_KD_SPD ? 1 : 0; _mvRef[nm] = p; _mvAgent[nm] = -1; nm++;
      } else _victims.push(p);                          // upright bystander rig
    }
    // 1b) hash the LIVE instanced agents into the 2m grid (the exact set the
    //     resolve below is allowed to bump). Reuses _gridIdx + the persistent grid
    //     Map — alloc-free after warm-up. We bucket by INDEX (getVec reads px/pz).
    if (!rebuildAgentGrid()) return;
    // 1c) NPC<->NPC MOVERS: the FASTEST live instanced agents become movers in the
    //     SAME _mv* arrays, _mvRef=null flagging an instanced source. A body's
    //     EFFECTIVE speed is its stroll speed OR — while it's skidding from a hit —
    //     the magnitude of its stag velocity, because THAT is what physically
    //     carries it into the bodies ahead. Prioritise the fastest: fill free slots,
    //     then displace the slowest instanced mover already held if this one hits
    //     harder, so a sprinting runner is always represented even in a dense crowd.
    //
    //     This is the CHAIN, with NO recursion: a mover knocks a (non-stag) victim
    //     down → bumpAgent gives the victim a stagX/stagZ skid (or promotes it to a
    //     ragdoll that gets up and flees fast) → NEXT frame that skidder's stag
    //     velocity clears STUMBLE_SPD so it qualifies HERE as a mover and ploughs
    //     the next bodies. It self-limits because sim() bleeds the skid every frame
    //     (Math.pow(0.02,dt)); once it drops below STUMBLE_SPD the body stops
    //     shoving and the pile settles. Skidders are MOVERS but never VICTIMS (the
    //     grid skips stagT>0), so a body mid-skid is never re-shoved into a loop.
    //     We scan ALL live, un-promoted agents (not just the grid set) precisely so
    //     the skidding propagators — excluded from the grid — can still drive it.
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0) continue;
      let sp = spd[i];
      if (stagT[i] > 0) {                              // skidding: velocity, not stroll pace
        const sv = Math.sqrt(stagX[i] * stagX[i] + stagZ[i] * stagZ[i]);
        if (sv > sp) sp = sv;
      }
      if (sp < STUMBLE_SPD) continue;                  // only fast bodies shove others
      let slot = -1;
      if (nm < MOVERS) slot = nm++;
      else {
        // arrays full → find the slowest INSTANCED mover (rig/player movers are
        // never evicted) and replace it only if this agent is genuinely faster.
        let worst = -1, worstS = sp;
        for (let m = 0; m < nm; m++) {
          if (_mvAgent[m] < 0) continue;               // rig/player mover: keep
          if (_mvS[m] < worstS) { worstS = _mvS[m]; worst = m; }
        }
        slot = worst;
      }
      if (slot < 0) continue;                          // no room and nothing slower to evict
      _mvX[slot] = px[i]; _mvZ[slot] = pz[i]; _mvS[slot] = sp;
      _mvKD[slot] = sp >= RIG_KD_SPD ? 1 : 0; _mvRef[slot] = null; _mvAgent[slot] = i;
    }
    if (!nm) return;
    // 2) movers vs instanced agents — query ONLY the mover's 3×3 grid cells, so the
    //    cost stays O(agents × local-neighbours) instead of movers × count. The
    //    per-agent frame stamp keeps it to one shove each even where cells overlap.
    for (let m = 0; m < nm; m++) {
      const gx = _bumpGrid.cellIndex(_mvX[m]), gz = _bumpGrid.cellIndex(_mvZ[m]);
      const selfI = _mvAgent[m];                        // an instanced mover must not bump itself
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        for (let cz = gz - 1; cz <= gz + 1; cz++) {
          const cell = _bumpGrid.bucket(cx, cz);
          if (!cell) continue;
          for (let q = 0; q < cell.length; q++) {
            const i = cell[q];
            if (i === selfI || _bumpStamp[i] === _bumpFrame) continue;
            // stagT can be set mid-pass by an earlier mover this frame; the stamp
            // already excludes it, but guard anyway so a downgraded skid is one-shot.
            if (stagT[i] > 0 || promotedBy[i] >= 0) continue;
            const dx = px[i] - _mvX[m], dz = pz[i] - _mvZ[m], d2 = dx * dx + dz * dz;
            if (d2 >= BUMP_R2) continue;
            const d = Math.sqrt(d2) || 1;
            _bumpStamp[i] = _bumpFrame;                 // claim the hit before resolving
            // ref: rig actor for a rig mover; the non-player crowd source for an
            // instanced mover (selfI>=0); null only for the PLAYER (becomes _bumpSrc).
            let ref = _mvRef[m];
            if (!ref && selfI >= 0) { _npcSrc.pos.x = _mvX[m]; _npcSrc.pos.z = _mvZ[m]; ref = _npcSrc; }
            bumpAgent(i, dx / d, dz / d, _mvS[m], _mvKD[m] === 1, ref);
          }
        }
      }
    }
    // 3) RIG movers vs bystander RIGS: a fleeing ped flattens whoever's in the
    //    way (player-vs-rig charges are humancontact.js's job — not repeated here)
    for (let m = 0; m < nm; m++) {
      if (!_mvKD[m] || !_mvRef[m]) continue;
      const src = _mvRef[m];
      for (let v = 0; v < _victims.length; v++) {
        const t = _victims[v];
        if (t === src) continue;
        const dx = t.pos.x - _mvX[m], dz = t.pos.z - _mvZ[m];
        if (dx * dx + dz * dz >= 1.21) continue;
        if (CBZ.body && CBZ.body.knockdown) CBZ.body.knockdown(t, { fromX: _mvX[m], fromZ: _mvZ[m], force: 6 + _mvS[m] * 0.5, t: 1.1 + Math.random() * 0.6 });
        if (CBZ.humanContact) CBZ.humanContact.react(t, { mode: "city", source: src, kind: "run-over", severity: 0.8 });
        if (CBZ.sfx) CBZ.sfx("ko");
      }
    }
  }

  // ---- PERSONAL SPACE: keep the mass from standing INSIDE each other ----
  // The stroll/dead-reckon brain steers every agent toward a sidewalk point with
  // zero awareness of its neighbours, so two walkers headed for the same corner
  // (or a slow body the dead-reckoning others overtake) end up co-located —
  // bodies merged into one blob, which kills the world-model read. This is the
  // classic boids SEPARATION rule (Reynolds): each agent feels a soft repulsion
  // from anyone inside a small "personal space" radius, scaled by the overlap.
  // We accelerate it with the SAME uniform spatial hash the bumps use
  // (CBZ.makeGrid) so it's O(agents × local-neighbours), never O(n²) — at a
  // 700-strong crowd the naive pairwise pass would be ~250k checks/frame.
  //
  // CHEAP BY NATURE: alloc-free (a persistent grid + a reused index list), and
  // TIME-SLICED — we rebuild the full grid every frame (cheap O(n) bucketing)
  // but only RESOLVE one slice of the agents per frame (round-robin), so the
  // neighbour scan cost is ~count/SEP_SLICES regardless of crowd size. An agent
  // gets nudged ~3× a second, which is plenty to stop standing overlaps without
  // any visible jitter. The push is a gentle clamped NUDGE (not a hard solve) so
  // it never fights the navigation: a body still walks where it's going, it just
  // doesn't share a square metre with the person next to it. After the nudge we
  // run the SAME collide() depenetration the stroll uses, so separation can
  // never shove anyone into a wall, a building, or the street.
  const SEP_R = 0.62;                 // personal-space radius (≈1.24m apart — box bodies are ~0.82 wide)
  const SEP_R2 = SEP_R * SEP_R, SEP_MIN = SEP_R * 2;
  const SEP_PUSH = 0.5;               // share of the overlap closed per resolve (the other body closes the rest)
  // GENTLER, FRAMERATE-INDEPENDENT separation nudge. WHY: the old 0.18m was a flat
  // PER-FRAME cap — at 120fps a body resolves twice as often as at 60fps, so the
  // same crush shoved it twice as far per second (a high-FPS-only personal-space
  // JITTER, the filmed twitch when bodies bunch). Cap the nudge as a SPEED instead
  // (m/s × dt) so it closes the same ground per second at any framerate, and halve
  // it: 0.55m/s × dt → ~0.09m at a 60fps slice — reads as a calm step-aside, never
  // a pop. (Scaled by dt below; the post-clamp collide still keeps it off walls.)
  const SEP_MAXVEL = 0.55;            // max separation drift (m/s); per-frame cap = SEP_MAXVEL*dt
  const SEP_MAXSTEP_CEIL = 0.10;      // absolute ceiling (m) so one huge-dt hitch can't still pop
  const SEP_SLICES = 3;               // resolve 1/SEP_SLICES of the crowd each frame (round-robin)
  let _sepSlice = 0;                  // rolling slice cursor
  // separable = a normally-strolling body: skip the dead/corpse/suppressed,
  // the promoted rigs (a real ped owns their motion + their own actorcollide),
  // and skidding bodies (their bump skid IS their motion this beat).
  function separable(i) {
    return !deadAgent[i] && !suppressed[i] && corpseT[i] <= 0 && promotedBy[i] < 0 && stagT[i] <= 0;
  }
  function separate(dt) {
    if (!count) return;
    // Bump reactions and personal-space separation operate on the same live,
    // upright ambient set. Share their one per-frame broadphase rebuild.
    if (!rebuildAgentGrid() || !_gridIdx.length) return;
    // resolve only THIS frame's slice (round-robin over the agent array)
    const slice = _sepSlice; _sepSlice = (_sepSlice + 1) % SEP_SLICES;
    for (let i = slice; i < count; i += SEP_SLICES) {
      if (!separable(i)) continue;
      const ax = px[i], az = pz[i];
      const gx = _bumpGrid.cellIndex(ax), gz = _bumpGrid.cellIndex(az);
      let nxAcc = 0, nzAcc = 0;
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        for (let cz = gz - 1; cz <= gz + 1; cz++) {
          const cell = _bumpGrid.bucket(cx, cz); if (!cell) continue;
          for (let q = 0; q < cell.length; q++) {
            const j = cell[q];
            if (j === i || !separable(j)) continue;
            const dx = ax - px[j], dz = az - pz[j], d2 = dx * dx + dz * dz;
            if (d2 >= SEP_MIN * SEP_MIN || d2 < 1e-6) continue;   // outside personal space (or exactly coincident)
            const d = Math.sqrt(d2);
            // repulsion scaled by how deep the overlap is (boids separation):
            // closer neighbours push harder; the inverse-distance unit vector
            // away from each crowder accumulates into one resolved nudge.
            const w = (SEP_MIN - d) / d;       // (overlap / d) → unit-away × overlap
            nxAcc += dx * w; nzAcc += dz * w;
          }
        }
      }
      if (nxAcc === 0 && nzAcc === 0) continue;
      // two co-located bodies EXACTLY overlapping would net to zero above — but
      // 1e-6 skip prevents that pair contributing, so a deterministic stack can't
      // lock. Nudge by half the accumulated overlap, hard-capped so it reads as a
      // step-aside, never a pop. (The other body resolves its own half next slice.)
      let mvx = nxAcc * SEP_PUSH * 0.5, mvz = nzAcc * SEP_PUSH * 0.5;
      const ml = Math.hypot(mvx, mvz);
      // dt-scaled drift cap (framerate-independent), with an absolute ceiling so a
      // single giant-dt hitch can't teleport-pop the body across the pavement.
      let cap = SEP_MAXVEL * dt; if (cap > SEP_MAXSTEP_CEIL) cap = SEP_MAXSTEP_CEIL;
      if (ml > cap) { const s = cap / ml; mvx *= s; mvz *= s; }
      let nx = ax + mvx, nz = az + mvz;
      // keep the nudge on the pavement — never let separation shove a body into a
      // wall/building or out into the road. Same collider the stroll already obeys.
      if (CBZ.collide) {
        _col.x = nx; _col.z = nz;
        CBZ.collide(_col, 0.5, 0, 1.7);
        nx = _col.x; nz = _col.z;
      }
      px[i] = nx; pz[i] = nz;
    }
  }

  // ---- COARSE OBSTACLE AVOIDANCE: stop the filler crowd walking THROUGH walls ----
  // ROOT CAUSE: sim()'s collide()/collideSlide() calls are purely REACTIVE — they
  // depenetrate a body AFTER it has already stepped into a wall, which keeps it
  // from ending up embedded inside geometry but does nothing to stop the visible
  // act of walking face-first into a building face and being shoved aside frame
  // after frame (reads as grinding along the wall, not as a person who SAW it
  // coming). The instanced background crowd has zero look-ahead: the only other
  // spatial awareness it has is SEP_R personal-space separation (above), which is
  // agent-vs-agent, never agent-vs-building.
  //
  // FIX (cheap, NOT the active tier's full contextSteer kernel — this is the
  // background/filler tier, budgeted accordingly): once a body is selected this
  // frame, cast one short probe point out along its current heading and ask the
  // SAME broadphase the player/ped collision already indexes (CBZ.queryCollidersNear
  // — an O(local walls) grid lookup, not a scene raycast) whether anything sits
  // there. If the probe lands inside (or within AVOID_R of) a collider box, the body
  // is about to walk into a wall within the next ~AVOID_LOOKAHEAD metres — repick a
  // fresh stroll waypoint (the SAME "hit a wall → pickWaypoint" idiom sim() already
  // uses after a REACTIVE shove, just triggered proactively here) so it visibly
  // turns away instead of grinding along the face. This is coarse on purpose: a
  // single forward probe, not a multi-ray fan or a steering field — good enough to
  // kill the "walks straight through a building footprint" complaint without
  // spending the active tier's per-frame budget on 700+ background bodies.
  //
  // AMORTIZED: only a small ROTATING SLICE of the live crowd is probed per frame
  // (mirrors separate()'s SEP_SLICES idiom), so the added cost is a fixed handful
  // of grid lookups/frame regardless of crowd size — not O(count) every frame.
  // collide()'s own per-frame depenetration stays the safety net for whatever this
  // coarse, infrequent probe misses between an agent's turns.
  const AVOID_LOOKAHEAD = 2.6;        // probe this far ahead of the body (m)
  const AVOID_R = 0.55;               // probe radius — slightly more than the body's 0.5 collide radius
  const AVOID_PER_FRAME = 40;         // agents probed per frame (flat cost, independent of CAP/count)
  const _avoidCols = [];              // queryCollidersNear scratch (reused; alloc-free after warm-up)
  let _avoidScan = 0;                 // rolling cursor, round-robins the whole live crowd over several frames
  // true if a probe circle (px,pz,r) overlaps any nearby full-height-or-body-height
  // wall box. Reuses the exact box test collide() uses, just read-only (no push).
  function probeBlocked(qx, qz, r) {
    const cols = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(qx, qz, r, _avoidCols) : null;
    if (!cols || !cols.length) return false;
    for (let c = 0; c < cols.length; c++) {
      const box = cols[c];
      // height-gated colliders (windows/sills) only block a body in that vertical
      // span; the instanced crowd's body occupies ~0..1.7m like the stroll collide
      // call above, so the same gate applies — a body can walk under a high sill.
      if (box.y0 != null && (1.7 <= box.y0 || 0 >= box.y1)) continue;
      const cx = qx < box.minX ? box.minX : (qx > box.maxX ? box.maxX : qx);
      const cz = qz < box.minZ ? box.minZ : (qz > box.maxZ ? box.maxZ : qz);
      const dx = qx - cx, dz = qz - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  function avoidPass() {
    if (!count || !CBZ.queryCollidersNear) return;     // no broadphase loaded → nothing to probe against
    let scanned = 0;
    for (; scanned < AVOID_PER_FRAME && scanned < count; scanned++) {
      const i = _avoidScan; _avoidScan = (_avoidScan + 1) % count;
      // only a normally-strolling, think-tick-eligible body needs steering — the
      // staggered/panicked/promoted/dead/suppressed/corpse states already have
      // their own movement (or none) and either ignore walls on purpose (panic
      // sprint already 2-pass collides) or aren't walking at all.
      if (!separable(i)) continue;
      const ax = px[i], az = pz[i];
      const lx = ax + dirX[i] * AVOID_LOOKAHEAD, lz = az + dirZ[i] * AVOID_LOOKAHEAD;
      if (!probeBlocked(lx, lz, AVOID_R)) continue;     // clear ahead — nothing to steer around
      // STEER AROUND: try the body's left and right flank (perpendicular to its
      // current heading) before giving up and repicking a whole new waypoint —
      // a 90°-ish side-step around a corner reads as "noticed the wall and
      // walked around it", which is the whole point; a full waypoint repick is
      // only the fallback when both flanks are also blocked (a dead-end nook).
      const sideX = -dirZ[i], sideZ = dirX[i];            // unit perpendicular (left)
      const tryFlank = AVOID_LOOKAHEAD * 0.85;
      let steered = false;
      for (let side = 0; side < 2 && !steered; side++) {
        const sgn = side === 0 ? 1 : -1;
        const fx = ax + (dirX[i] * 0.4 + sideX * sgn) * tryFlank;
        const fz = az + (dirZ[i] * 0.4 + sideZ * sgn) * tryFlank;
        if (probeBlocked(fx, fz, AVOID_R)) continue;
        // aim the existing stroll target at the clear flank point.
        tx[i] = fx; tz[i] = fz;
        steered = true;
      }
      if (!steered) {
        // both flanks blocked too (a corner/dead end) — fall back to the existing
        // "hit something → repick a fresh sidewalk waypoint" idiom used elsewhere
        // in this file, so the body picks an entirely new direction to try.
        pickWaypoint(_tmp, ax, az); tx[i] = _tmp.x; tz[i] = _tmp.z;
      }
      // REFRESH THE DEAD-RECKONING CACHE NOW, not just the target: a far/mid-tier
      // body may not get another think-tick for up to 15 frames (sim()'s NEAR2/
      // MID2 stride), and the off-tick branch walks the CACHED dirX/dirZ every
      // frame regardless — so if we only repointed tx/tz the body would keep
      // dead-reckoning straight at the wall it just "saw" until its next brain
      // tick. Updating heading/dirX/dirZ immediately makes the steer take effect
      // on the very next off-tick step, matching the lerpAngle smoothing sim()
      // itself uses on a real think-tick (no snap; a body still turns, not warps).
      const ndx = tx[i] - ax, ndz = tz[i] - az;
      const want = Math.atan2(ndx, ndz);
      heading[i] = CBZ.lerpAngle ? CBZ.lerpAngle(heading[i], want, 0.5) : want;
      dirX[i] = Math.sin(heading[i]); dirZ[i] = Math.cos(heading[i]);
    }
  }

  // ---- COMBAT: the ambient crowd is now shootable + run-over-able ----
  // (previously only the ~14 promoted peds could be hit; far NPCs were phantoms).
  function shootable(i) { return !deadAgent[i] && !suppressed[i] && corpseT[i] <= 0 && promotedBy[i] < 0; }
  // distance along a (normalised) ray at which it first enters a sphere, or -1.
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
    const mx = ox - cx, my = oy - cy, mz = oz - cz;
    const b = mx * dx + my * dy + mz * dz;
    const c = mx * mx + my * my + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = 0;                         // origin inside sphere
    return t <= maxT ? t : -1;
  }
  // nearest ambient agent the ray hits within maxT (head sphere wins). hr/br = assist radii.
  CBZ.cityCrowdRayHit = function (ox, oy, oz, dx, dy, dz, maxT, hr, br) {
    let best = -1, bd = maxT, head = false;
    const HR = (hr || 0.33) + 0.05, BR = (br || 0.48) + 0.08;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const hd = raySphere(ox, oy, oz, dx, dy, dz, px[i], 2.18, pz[i], HR, bd);
      if (hd >= 0 && hd < bd) { bd = hd; best = i; head = true; continue; }
      const td = raySphere(ox, oy, oz, dx, dy, dz, px[i], 1.42, pz[i], BR, bd);
      if (td >= 0 && td < bd) { bd = td; best = i; head = false; }
    }
    return best >= 0 ? { i: best, dist: bd, head: head, x: px[best], z: pz[best] } : null;
  };
  // kill ambient agent i: leave a body, throw gore, and report the crime (wanted).
  CBZ.cityCrowdKill = function (i, opts) {
    opts = opts || {};
    if (i < 0 || i >= count || !shootable(i)) return false;
    const x = px[i], z = pz[i];
    ungroup(i);                                         // corpse → drop any walking-group link
    corpseT[i] = 28;                                   // lie on the ground a good long while, then fade
    if (CBZ.gore) try { CBZ.gore(x, 1.4, z, { dir: opts.fromX != null ? { x: x - opts.fromX, z: z - opts.fromZ } : null, amount: opts.head ? 1.4 : 1.0, player: false }); } catch (e) {}
    if (CBZ.sfx && !opts.quiet) CBZ.sfx(opts.byCar ? "ko" : (opts.head ? "headshot" : "hit"));
    // a killed civilian is a witnessed crime → routes through the city wanted system
    // (skip when an NPC/explosion you didn't cause did the killing — opts.noCrime)
    if (CBZ.cityCrime && !opts.noCrime) CBZ.cityCrime(opts.byCar ? 150 : 200, { x: x, z: z, type: opts.byCar ? "vehicular homicide" : "murder" });
    if (CBZ.game) CBZ.game.cityKills = (CBZ.game.cityKills || 0) + 1;
    if (CBZ.city && CBZ.city.addKill) CBZ.city.addKill();   // count crowd kills toward story/leaderboard too
    // FINITE POPULATION: an ambient agent just died → tick the city headcount
    // DOWN (peds.js owns the roster). Un-promoted agents only ever die through
    // here; promoted rigs die via cityKillPed — exactly one decrement each.
    if (CBZ.cityPopulationDie) CBZ.cityPopulationDie(1);
    return true;
  };
  // everyone within r of (x,z) gets run down (car mowing through a crowd).
  CBZ.cityCrowdCircleKill = function (x, z, r, opts) {
    let n = 0; const r2 = r * r;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const dx = px[i] - x, dz = pz[i] - z;
      if (dx * dx + dz * dz < r2 && CBZ.cityCrowdKill(i, opts)) n++;
    }
    return n;
  };

  // a city teardown (new run / mode reset) nukes CBZ.cityPeds — drop the pool too
  if (CBZ.clearCityPeds) {
    const _clear = CBZ.clearCityPeds;
    CBZ.clearCityPeds = function () { pool = []; poolBuilt = false; prewarming = false; promotedBy.fill(-1); deadAgent.fill(0); suppressed.fill(0); stagT.fill(0); collapsedQ.fill(0); liveTarget = count; return _clear.apply(this, arguments); };
  }

  // ---- DENSITY THINNING: keep the on-street agent count in step with the finite
  //      city headcount. liveTarget = full crowd × (alive / total); as people are
  //      killed off, the fraction falls and we PARK surplus living agents off-map
  //      (suppress) so the streets get visibly emptier — and never re-park more
  //      than the math says, so a massacre stays a massacre (no magic refill).
  //      Cheap: a couple of park/un-park flips per call, biased AWAY from the
  //      player so bodies don't pop in/out right in your face. ----
  let _thinT = 0, _thinScan = 0;
  function recountAgents() {                     // living, on-street (not dead/suppressed/corpse)
    let live = 0, sup = 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || corpseT[i] > 0) continue;
      if (suppressed[i]) sup++; else live++;
    }
    return { live: live, sup: sup };
  }
  function thin(dt) {
    _thinT -= dt; if (_thinT > 0) return;
    _thinT = 0.5;                                // re-evaluate ~twice a second (cheap)
    if (!CBZ.cityPopulation) return;
    // ---- THE DUSK/DAWN FLIP (rides this 0.5s cadence — an hourly dial, never
    //      per-frame). On a flip, arm a turnover budget: about half the crowd
    //      gets reconsidered over the next ~30s so the street changes hands
    //      gradually — the day people go in, the night people come out. ----
    const wantNight = nightNow();
    if (wantNight !== nightShift) { nightShift = wantNight; turnover = (count * TURNOVER_FRAC) | 0; }
    const pop = CBZ.cityPopulation();
    const frac = pop.total > 0 ? pop.alive / pop.total : 1;
    // the night street holds fewer people OVERALL (~60% of day) on top of the
    // finite-headcount fraction; dawn lifts the target back and the existing
    // un-suppress path walks everyone back in.
    // BIOME DENSITY: when the bubble is live, scale the on-street target by the
    // biome's multiplier (sparse desert, packed speedway) — surplus is suppressed
    // exactly like a massacre, so it's a MULTIPLIER on liveTarget, not a cap or
    // draw-call change. Flag-off / mainland → biomeMul stays 1 → byte-identical.
    const biomeMul = bubbleOn() && BIOME_DENSITY[_activeBiome] != null ? BIOME_DENSITY[_activeBiome] : 1;
    liveTarget = Math.round(count * Math.max(0, Math.min(1, frac)) * (nightShift ? NIGHT_DENSITY : 1) * biomeMul);
    const c = recountAgents();
    const P = CBZ.player;
    const ppx = P ? P.pos.x : 0, ppz = P ? P.pos.z : 0;
    // FAR bias so density changes happen off-screen, never popping at your feet
    const FAR2 = 60 * 60;
    if (c.live > liveTarget) {
      // too many on the street → suppress a few FAR, non-promoted, living agents
      let need = Math.min(10, c.live - liveTarget), scanned = 0;   // rate scaled for the 700 crowd
      while (need > 0 && scanned < count) {
        const i = _thinScan; _thinScan = (_thinScan + 1) % Math.max(1, count); scanned++;
        if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0) continue;
        const dx = px[i] - ppx, dz = pz[i] - ppz;
        if (dx * dx + dz * dz < FAR2) continue;  // close enough to see → leave it alone
        ungroup(i);                              // off-street → drop any walking-group link
        suppressed[i] = 1; need--;
      }
    } else if (c.live < liveTarget && c.sup > 0) {
      // population didn't drop further (or a fresh run) → let a few back onto the
      // street, re-seeded at a FAR sidewalk point so they walk IN, not blink in.
      const A = arena();
      let add = Math.min(7, liveTarget - c.live), scanned = 0;     // rate scaled for the 700 crowd
      while (add > 0 && scanned < count) {
        const i = _thinScan; _thinScan = (_thinScan + 1) % Math.max(1, count); scanned++;
        if (!suppressed[i] || deadAgent[i]) continue;
        suppressed[i] = 0;
        if (A && A.randomSidewalkPoint) {        // fresh pop-weighted spot, dressed for it
          ungroup(i);                            // teleport → drop any walking-group link (already unlinked normally)
          fieldPoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;   // biome bubble seats un-suppressed bodies in-region
          castTint(i, px[i], pz[i]); repaintShirt(i);
          repick(i);
        }
        add--;
      }
    }
    // ---- TURNOVER: spend the dusk/dawn relocation budget, a few bodies per
    //      tick. Each far, living, non-promoted agent gets teleport-reseeded
    //      through the CURRENT hour's draw + re-dressed for where it lands —
    //      the destination field is what shapes the street, so the same rule
    //      works in both directions (dusk packs the core, dawn re-spreads).
    //      Far-only, so the change always happens off-screen. ----
    if (turnover > 0) {
      let moved = 0, scanned = 0;          // budgets scaled with the 700-strong street
      while (turnover > 0 && moved < 5 && scanned < 80) {
        const i = _turnScan; _turnScan = (_turnScan + 1) % Math.max(1, count); scanned++;
        if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0) { turnover--; continue; }
        const dx = px[i] - ppx, dz = pz[i] - ppz;
        if (dx * dx + dz * dz < FAR2) { turnover--; continue; }   // in sight → it keeps walking; the draw fields still converge
        ungroup(i);                                               // teleport → drop any walking-group link
        fieldPoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;         // biome bubble routes turnover INTO the active region
        castTint(i, px[i], pz[i]); repaintShirt(i);               // walks on dressed for the hour/biome
        repick(i);
        moved++; turnover--;
      }
    }
  }

  // ambient layer: runs during city play (own order, independent of peds @34).
  let _cosmFrame = 0;      // stride counter for the cosmetic passes below
  CBZ.onUpdate(23.7, function (dt) {
    if (CBZ.game.mode !== "city") { if (root) { root.visible = false; } if (poolBuilt) releaseAll(); return; }
    if (root) root.visible = true;
    if (!count && arena()) CBZ.spawnCityCrowd((CBZ.CITY && CBZ.CITY.crowd) || 700);
    // BIOME BUBBLE: cache the player's active region/biome ONCE per tick (never
    // per-agent). On/near a non-'city' region → the relocation paths (fieldPoint),
    // the stroll gate and the density multiplier all aim the crowd into that biome.
    // Flag off (or no region) → _activeBiome stays 'city' → every gate no-ops.
    _activeReg = null; _activeBiome = "city";
    if (CBZ.crowdBiomeBubble) {
      const A = arena(), P = CBZ.player;
      if (A && P && P.pos) {
        const ppx = P.pos.x, ppz = P.pos.z;
        const reg = (CBZ.cityAnyRegion && CBZ.cityAnyRegion(A, ppx, ppz, 0)) ||
                    (CBZ.cityNearestRegion && CBZ.cityNearestRegion(A, ppx, ppz, ACTIVE_RAD));
        if (reg) { _activeReg = reg; _activeBiome = reg.biome || "city"; }  // links carry no biome → 'city'
      }
    }
    // amortized pool pre-warm (a couple of rigs/frame at load) — runs FIRST so the
    // promotion pool is finished and parked before updatePromotion() reaches for it.
    // No-op once the pool is full or when PREWARM_POOL is off (prewarming stays false).
    if (prewarming) prewarmTick();
    avoidPass();           // coarse look-ahead: steer a rotating slice away from walls before sim() walks into them
    sim(dt);
    // COSMETIC-PASS STRIDE: separate() (personal-space nudge) and bumpPass()
    // (near-camera bump theatre) are pure polish — nothing downstream reads
    // their output the same frame — so at low tiers they run every 2nd
    // (tiers 1-2) or 3rd (tier 0) frame with dt scaled up to cover the skipped
    // frames (separate's push is dt-capped, so per-second drift is unchanged;
    // the absolute step ceiling still prevents pops). Tiers 3-4 keep N=1 →
    // byte-identical to before. They stride TOGETHER so their shared
    // per-frame agent-grid rebuild is still amortized across both.
    const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
    const stride = q >= 3 ? 1 : (q >= 1 ? 2 : 3);
    _cosmFrame++;
    if (_cosmFrame % stride === 0) {
      separate(dt * stride);   // personal-space repulsion: no bodies standing inside each other
      bumpPass(dt * stride);   // physical bump reactions: stumble / bowl bodies over
    }
    thin(dt);             // keep on-street density in step with the finite headcount
    aheadReseed();        // pull distant bodies into the street ahead of you
    updatePromotion();
    render();
  });
})();
