/* ============================================================
   systems/prisontiers.js — FOUR SECURITY LEVELS OVER ONE COMPOUND.

   OWNER (phase 5): "four security levels (low/medium/high/ultra-max);
   caught escaping = transferred UP a level, not a flat loss."

   WHAT WAS THERE. Three captures ended the run: capture.js:281 called
   CBZ.loseGame("transferred") and state.js printed "Strike three — shipped
   to max security" on a card that then offered you TRY AGAIN — the identical
   prison, at the identical difficulty, with the sentence about max security
   still on the screen behind the button. The game already said the word
   TRANSFERRED; it just never did it.

   WHY A REGIME AND NOT A MAP. World geometry in this build is parse-time:
   systems/state.js's resetGame() rebuilds nothing, so a "max security wing"
   would have to be a second compound built at boot and hidden. It would also
   be the wrong answer. A prison does not become another building when your
   classification changes — the SAME wing runs a different regime around you:
   more screws on more posts, more lenses actually wired, a shorter yard and a
   longer lockdown, and lights that never quite go out. Everything this wave
   published exists to be turned: prisonschedule's block table, prisonnight's
   fixture registry and light levels, guards' posts/ranks, security.js's camera
   records, economy's loadouts and social rates. This file turns them, and
   OWNS NO SIMULATION OF ITS OWN — every knob below lands on somebody else's
   published surface.

   ------------------------------------------------------------------
   THE LADDER.  LOW -> MEDIUM -> HIGH -> ULTRA-MAX.

     You start in LOW. Three captures while escaping = a TRANSFER up one
     level (the strike arc is unchanged; only its third rung is). At
     ULTRA-MAX there is nowhere left to send you, so the third capture is
     just another confinement in your ultra-max cell — the regime IS the
     punishment. Death and every other loss path are untouched.

     Escaping ANY tier still wins. Escaping a high one wins bigger, and the
     shipped win card says so.

   ------------------------------------------------------------------
   THE TRANSFER IS A SCENE. Caught -> the shipped result card, relabelled
   (TRANSFERRED / "Reclassified — High Security") with the button reading
   REPORT TO HIGH SECURITY -> you wake in your cell, first light of a new
   day, pockets emptied by a reception shakedown whose strictness is the
   destination's own. It is a STATE TRANSITION screen, which is legitimate;
   nothing new is ever printed mid-play.

     WHAT SURVIVES A TRANSFER
       cigs        half -> a quarter -> nothing        (destination's rule)
       property    personal effects -> harmless only -> nothing
       keys/tools  never. A card, a pick, a blade and a shiv are exactly
                   what a reception search is for.
       loyalty     NEVER. You bought THOSE screws; these are different men.
                   (economy.js's resetLoadouts already zeroes it on a new
                   run — this file only has to not fight it.)
       respect     TRAVELS, at 0.8. Your reputation goes in the transfer
                   file ahead of you; it just loses a little in the post.

   ------------------------------------------------------------------
   TIER IS READ IN THE WORLD, NEVER IN THE HUD. The regime is the tell —
   you can count screws and lit lenses. But a returning player needs an
   anchor, so the wing carries a CLASSIFICATION PLACARD at its throat (four
   bar slots, N of them burning in the tier's colour), a paint band on the
   south face you cross every morning, a second band on the wall you wake up
   facing, and a plate on the staff-room noticeboard. Four surfaces, one
   colour, no words.

   Flags: PRISON_TIERS_V1 (all of it) · PRISON_TIER_TRANSFER (the ladder
   alone — off, and a third strike loses the run exactly as it always did) ·
   PRISON_TIER_SIGNAGE (the painted anchors alone).
   Ratchet: CBZ.prisonTierAudit().unapplied pinned at 0 — every knob this
   file declares must land on a live surface; a knob nothing reads is a lie.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PRISON_TIERS_V1 == null) CFG.PRISON_TIERS_V1 = true;
  if (CFG.PRISON_TIER_TRANSFER == null) CFG.PRISON_TIER_TRANSFER = true;
  if (CFG.PRISON_TIER_SIGNAGE == null) CFG.PRISON_TIER_SIGNAGE = true;

  const addBox = CBZ.addBox;
  const g = CBZ.game;

  /* ==========================================================
     1. THE KNOB TABLE — THE WHOLE DESIGN, IN ONE PLACE.

        Every number a regime differs by is here and nowhere else. Read a
        column top to bottom and you have that prison. MEDIUM is deliberately
        the SHIPPED build byte for byte (1.00 everywhere, the shipped block
        hours, the shipped three cameras) — so "what the game has always
        been" is a named rung on the ladder rather than an unstated default,
        and LOW is a real relaxation measured against it rather than a
        different game.
     ========================================================== */
  const TIERS = [
    {
      id: "low", name: "Low Security", label: "LOW", short: "Low",
      color: 0x3ea55f, bars: 1,
      // ---- the county farm. Thirteen hours of open compound, cells shut for
      //      seven, keys loose on the belt, chatty screws, and a night that
      //      actually goes dark: half the masts are off the circuit and one
      //      dim blue fitting burns on the tier.
      posts: 0,             // extra patrols beyond the shipped 12
      viewMul: 0.90,        // guard sight range, off each guard's own base
      coneMul: 0.94,        // guard cone half-angle
      speedMul: 0.94,       // patrol speed (density: ground covered per hour)
      torchDuty: 0.25,      // fraction of the roster on night torch duty
      cameras: 1,           // how many of the 9 lenses are WIRED
      camReach: 0.80,       // multiplies the 9 m lens reach (latch distance)
      camHeat: 0.70,        // multiplies the heat a locked lens pours on
      camSweep: 0.80,       // pan rate — a slow lens leaves bigger gaps
      floods: 4,            // yard flood masts on the circuit (of 8)
      nightLamp: 0.35,      // prisonnight LEVELS.night.out — the tier's own night lights
      blockLamp: 0.06,      // LEVELS.block.out
      roomLamp: 0.14,       // LEVELS.room.out
      poolR: 4.0,           // searchlight pool radius, m
      sweepMul: 0.85,       // searchlight sweep width
      stealMul: 1.25,       // economy.stealOdds
      keyMul: 1.20,         // how often a post's keys are actually on the belt
      respectMul: 1.20,     // how fast respect forms
      loyaltyMul: 1.25,     // how fast a screw stays bought
      keep: { cigs: 1, items: "all" },   // never used: nobody is transferred INTO low
      arrive: "",
      // ---- MUSTER: how hard the wing is closed. LOW is a county farm — the
      //      horn goes, the screws stand at the apron, and a man who is slow
      //      about it drifts in over the next few minutes. Nobody comes to get
      //      you until you are practically standing on a guard.
      muster: { herdR: 6.0, grace: 0.55, sweep: false },
      blocks: {
        //          hour  cells   home     pa torches
        wake:   { from: 5.0,  cells: "open", home: "block", pa: 1, torches: true },
        yard:   { from: 6.5,  cells: null,   home: null,    pa: 1, torches: false },
        mess:   { from: 12.0, cells: null,   home: null,    pa: 1, torches: false },
        work:   { from: 13.0, cells: null,   home: null,    pa: 1, torches: false },
        supper: { from: 17.5, cells: null,   home: null,    pa: 1, torches: false },
        count:  { from: 19.5, cells: null,   home: "block", pa: 1, torches: true },
        secure: { from: 22.0, cells: "lock", home: "cell",  pa: 2, torches: true },
        night:  { from: 23.0, cells: "lock", home: "cell",  pa: 1, torches: true },
      },
    },
    {
      id: "medium", name: "Medium Security", label: "MEDIUM", short: "Medium",
      color: 0xd9b64c, bars: 2,
      posts: 2, viewMul: 1.00, coneMul: 1.00, speedMul: 1.00, torchDuty: 0.40,
      cameras: 3, camReach: 1.00, camHeat: 1.00, camSweep: 1.00,
      floods: 6, nightLamp: 0.55, blockLamp: 0.10, roomLamp: 0.18,
      poolR: 5.0, sweepMul: 1.00,
      stealMul: 1.00, keyMul: 1.00, respectMul: 1.00, loyaltyMul: 1.00,
      keep: { cigs: 0.5, items: "personal" },
      arrive: "Medium Security. New wing, new screws, half your property.",
      muster: { herdR: 8.0, grace: 0.35, sweep: false },   // the shipped behaviour
      blocks: {   // ---- THE SHIPPED TIMETABLE, unchanged ----
        wake:   { from: 5.0,  cells: "open", home: "block", pa: 2, torches: true },
        yard:   { from: 7.0,  cells: null,   home: null,    pa: 1, torches: false },
        mess:   { from: 11.5, cells: null,   home: null,    pa: 1, torches: false },
        work:   { from: 13.0, cells: null,   home: null,    pa: 1, torches: false },
        supper: { from: 17.0, cells: null,   home: null,    pa: 1, torches: false },
        count:  { from: 18.5, cells: null,   home: "block", pa: 2, torches: true },
        secure: { from: 21.0, cells: "lock", home: "cell",  pa: 3, torches: true },
        night:  { from: 22.0, cells: "lock", home: "cell",  pa: 1, torches: true },
      },
    },
    {
      id: "high", name: "High Security", label: "HIGH", short: "High",
      color: 0xe0742a, bars: 3,
      posts: 4, viewMul: 1.12, coneMul: 1.06, speedMul: 1.04, torchDuty: 0.70,
      cameras: 6, camReach: 1.15, camHeat: 1.30, camSweep: 1.25,
      floods: 8, nightLamp: 0.70, blockLamp: 0.16, roomLamp: 0.26,
      poolR: 6.2, sweepMul: 1.15,
      stealMul: 0.80, keyMul: 1.15, respectMul: 0.85, loyaltyMul: 0.75,
      keep: { cigs: 0.25, items: "harmless" },
      arrive: "High Security. Longer nights, shorter yard, and they kept most of it.",
      muster: { herdR: 11.0, grace: 0.18, sweep: true },
      blocks: {   // the evening COUNT is taken in the cells, not on the tier
        wake:   { from: 5.5,  cells: "open", home: "block", pa: 2, torches: true },
        yard:   { from: 8.0,  cells: null,   home: null,    pa: 1, torches: false },
        mess:   { from: 11.0, cells: null,   home: null,    pa: 1, torches: false },
        work:   { from: 13.0, cells: null,   home: null,    pa: 1, torches: false },
        supper: { from: 16.0, cells: null,   home: null,    pa: 1, torches: false },
        count:  { from: 17.0, cells: "lock", home: "cell",  pa: 3, torches: true },
        secure: { from: 19.0, cells: "lock", home: "cell",  pa: 3, torches: true },
        night:  { from: 20.0, cells: "lock", home: "cell",  pa: 2, torches: true },
      },
    },
    {
      id: "ultra", name: "Administrative Segregation", label: "ULTRA-MAX", short: "Ultra-Max",
      color: 0xc1272d, bars: 4,
      posts: 6, viewMul: 1.26, coneMul: 1.14, speedMul: 1.10, torchDuty: 1.00,
      cameras: 9, camReach: 1.35, camHeat: 1.70, camSweep: 1.55,
      floods: 8, nightLamp: 0.85, blockLamp: 0.24, roomLamp: 0.34,
      poolR: 7.5, sweepMul: 1.30,
      stealMul: 0.60, keyMul: 1.35, respectMul: 0.60, loyaltyMul: 0.45,
      keep: { cigs: 0, items: "none" },
      arrive: "Segregation. You arrive with what you stand up in.",
      // Everyone in, at the horn, and the screws WALK THE COMPOUND for anyone
      // who is not. There is no grace at all — segregation counts bodies.
      muster: { herdR: 15.0, grace: 0.0, sweep: true },
      blocks: {   // 5 3/4 hours out of the cell; 14 1/4 locked in it
        wake:   { from: 6.0,  cells: "open", home: "block", pa: 3, torches: true },
        yard:   { from: 10.0, cells: null,   home: null,    pa: 1, torches: false },
        mess:   { from: 11.5, cells: null,   home: null,    pa: 1, torches: false },
        work:   { from: 13.0, cells: null,   home: null,    pa: 1, torches: false },
        supper: { from: 15.0, cells: null,   home: null,    pa: 1, torches: false },
        count:  { from: 15.75, cells: "lock", home: "cell", pa: 3, torches: true },
        secure: { from: 16.5, cells: "lock", home: "cell",  pa: 4, torches: true },
        night:  { from: 17.5, cells: "lock", home: "cell",  pa: 2, torches: true },
      },
    },
  ];
  const TOP = TIERS.length - 1;

  function on() { return CFG.PRISON_TIERS_V1 !== false && g && g.mode === "escape"; }
  function level() { return Math.max(0, Math.min(TOP, (g && g.securityTier) | 0)); }
  function tier() { return TIERS[level()]; }
  function knob(k) { const t = tier(); return t[k]; }

  /* ==========================================================
     2. EXTRA POSTS. Spawned through entities/guards.js's own factory
        (CBZ.spawnGuard) and torn down the same way systems/reinforcements.js
        tears its riot detail down — that file is the shipped precedent for
        adding and removing a patrol at runtime, and copying its disposal is
        cheaper than inventing a "hidden guard" state the AI would have to
        learn.

        THE WAYPOINTS ARE THE RANK. economy.js's guardPost() derives post and
        seniority from the loop a man walks, so a post added here lands in the
        rank ladder without this file knowing the ladder exists — and a rank-2
        post is a man with a KEYCARD on his belt. That is why the escalation
        alternates: a high tier is not just more bodies, it is more bodies
        worth robbing and much harder to rob.

        The two wing loops hug the x=0 spine on purpose. The patrol mover has
        no steering at all (entities/guards.js), and the spine is the one lane
        through the wing the shipped indoor officer already proves is walkable.
     ========================================================== */
  const POSTS = [
    // waypoints,                                             speed view half   post it derives
    { w: [[-2.2, -14], [-2.2, -40], [2.2, -40], [2.2, -14]], s: 3.0, v: 12, h: 0.60 }, // wing  (rank 2)
    { w: [[-8, -2], [8, -2], [8, 8], [-8, 8]],               s: 3.2, v: 13, h: 0.60 }, // checkpoint (2)
    { w: [[-28, -4], [-28, 50], [-24, 50], [-24, -4]],       s: 3.4, v: 14, h: 0.58 }, // yard  (rank 1)
    { w: [[-6, 118], [6, 118], [6, 126], [-6, 126]],         s: 3.0, v: 15, h: 0.64 }, // gate  (rank 2)
    { w: [[-10, 50], [10, 50], [10, 60], [-10, 60]],         s: 3.4, v: 14, h: 0.60 }, // yard  (rank 1)
    { w: [[2.6, -12], [2.6, -42], [-2.6, -42], [-2.6, -12]], s: 3.0, v: 12, h: 0.60 }, // wing  (rank 2)
  ];
  const mine = [];   // ONLY the guards this file spawned

  function disposeMesh(o) {
    if (!o) return;
    if (o.geometry && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
    const m = o.material;
    if (m) {
      if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) if (m[i] && m[i].dispose) { try { m[i].dispose(); } catch (e) {} } }
      else if (m.dispose) { try { m.dispose(); } catch (e) {} }
    }
  }
  function removePost(gd) {
    if (!gd) return;
    gd.hunt = 0; gd.alert = 0; gd.ko = 0; gd.dead = true;
    if (CBZ.jailBoost) { CBZ.jailBoost.restore("difficulty", gd); CBZ.jailBoost.restore("lockdown", gd); }
    if (gd.group) {
      if (gd.group.parent) gd.group.parent.remove(gd.group);
      else if (CBZ.scene) CBZ.scene.remove(gd.group);
      if (gd.group.traverse) { try { gd.group.traverse(disposeMesh); } catch (e) {} }
    }
    if (gd.wedge) disposeMesh(gd.wedge);
    if (CBZ.guards) { const i = CBZ.guards.indexOf(gd); if (i >= 0) CBZ.guards.splice(i, 1); }
  }
  function reconcilePosts(want) {
    if (typeof CBZ.spawnGuard !== "function") return;
    while (mine.length > want) removePost(mine.pop());
    while (mine.length < want && mine.length < POSTS.length) {
      const p = POSTS[mine.length];
      let gd = null;
      try { gd = CBZ.spawnGuard(p.w.map(function (q) { return [q[0], q[1]]; }), p.s, p.v, p.h, {}); } catch (e) { gd = null; }
      if (!gd || !gd.group) break;
      gd._tierPost = true;
      mine.push(gd);
      // pockets, post and rank right now — economy.js's cast-time mint has
      // already run for this session, and CBZ.socialAudit().unminted is
      // pinned at 0 by the phase that built it.
      if (CBZ.econ) {
        if (CBZ.econ.guardPost) CBZ.econ.guardPost(gd);
        if (CBZ.econ.rollLoadout) CBZ.econ.rollLoadout(gd);
      }
    }
  }

  /* ---- guard QUALITY. Snapshot each man's natural numbers once and always
       write base * knob, so re-applying can never compound. Deliberately NOT
       through CBZ.jailBoost: systems/difficulty.js holds a "difficulty" ledger
       on viewDist/speed and scales from ITS snapshot every frame, so two
       ledgers on one field would each capture the other's product. Writing the
       BASE at reset time — after difficulty.js's own state-exit restoreAll has
       already put the natural values back — lets the ramp compose on top of
       the tier instead of fighting it, which is the honest ordering: the tier
       is what the prison IS, the ramp is how long you have been in it. ---- */
  let applying = -1;
  function applyGuards(t) {
    applying = TIERS.indexOf(t);
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!gd || gd._reinf) continue;               // heat reinforcements are not a post
      if (!gd._tierBase) gd._tierBase = { viewDist: gd.viewDist, half: gd.half, speed: gd.speed };
      const b = gd._tierBase;
      gd.viewDist = b.viewDist * t.viewMul;
      gd.half = Math.min(1.35, b.half * t.coneMul);
      gd.speed = b.speed * t.speedMul;
      // TORCH DUTY. Deterministic on the man's own id, so the same officers
      // carry at the same tier every run. The warden always has his.
      const duty = gd.kind === "warden" || ((gd.id * 37) % 100) / 100 < t.torchDuty;
      gd.flashlightPatrol = duty;
      if (gd._dayRoute) gd._dayTorch = duty;        // prisonschedule holds the day value
      /* THE RECEIPT, not the live value. systems/difficulty.js legitimately
         scales viewDist and speed on top of what we write, every frame, as
         the run gets older — so "does gd.viewDist still equal base * knob"
         is a question that is FALSE by design thirty seconds into a run and
         would have made the ratchet below fire on a working prison. What the
         audit is actually entitled to assert is that the tier reached this
         man; the ramp riding on top of it is another system doing its job. */
      gd._tierLevel = applying;
    }
  }

  /* ==========================================================
     3. THE LENSES. Nine camera bodies are bolted up at parse time and the
        tier decides how many are WIRED. That is the readable half: an
        unwired lens paints "out" (dark), a wired one sweeps green — so the
        number of live dots in a corridor IS the classification, visible from
        the floor, with no text anywhere.

        entities/security.js still owns every pixel of the lens: this file
        writes `offline` and the record's own sweep rate, and that file
        paints. Two files writing one material is exactly the fault its own
        header was written to record.
     ========================================================== */
  function mast(x, z, h) {
    const m = addBox(x, h / 2, z, 0.26, h, 0.26, 0x6b7480, { solid: true });
    addBox(x, h + 0.06, z, 0.5, 0.12, 0.5, 0x515a66, { cast: false });
    return m;
  }
  const EXTRA = [
    // yard door, west of the throat — watches the apron everyone crosses
    { x: -4.6, y: 6.2, z: -7.3, a: 0.55, o: { range: 1.0 } },
    // the gun-room door, from its own west wall, looking back up the approach
    { x: 18.6, y: 5.2, z: 1, a: -Math.PI / 2, o: { range: 1.0, offset: 0.6 } },
    // the admin corridor, sweeping its length
    { x: 0, y: 4.2, z: -46.6, a: Math.PI / 2, o: { range: 1.3 } },
    // the warden's office door
    { x: 11.4, y: 4.2, z: -49.4, a: Math.PI, o: { range: 0.9, offset: 0.4 } },
    /* The last two stand in open ground and need their own mast. Both sit
       OFF the centreline on purpose: x=0 is the lane a runner actually takes
       — through the 8 m exit gap at (0,128) and down the 60 m throat at
       z=52 — and a pole is a solid collider. A camera should watch the lane,
       not stand in it. Their reach still crosses it at every tier. */
    // the sally port, looking up the last stretch at the gate
    { x: -7, y: 7.0, z: 119, a: 0, o: { range: 1.2 }, mast: 6.6 },
    // the throat between the two yards — the one neck everybody must cross
    { x: -7, y: 7.0, z: 53.5, a: 0, o: { range: 1.4 }, mast: 6.6 },
  ];
  (function buildExtraCameras() {
    if (typeof CBZ.makeCamera !== "function") return;
    for (let i = 0; i < EXTRA.length; i++) {
      const e = EXTRA[i];
      if (e.mast) mast(e.x, e.z, e.mast);
      const cam = CBZ.makeCamera(e.x, e.y, e.z, e.a, e.o);
      if (cam) cam.offline = true;                  // dark until a tier wires it
    }
  })();

  function applyCameras(t) {
    const list = CBZ.cameras || [];
    for (let i = 0; i < list.length; i++) {
      const cam = list[i];
      if (cam._tierSweep == null) cam._tierSweep = cam.sweepSpeed;
      cam.offline = i >= t.cameras;
      cam.sweepSpeed = cam._tierSweep * t.camSweep;
      if (cam.offline) { cam.seenT = 0; cam.watchT = 0; cam._wasSeen = false; }
    }
  }

  /* ==========================================================
     4. THE TIMETABLE. CBZ.prisonSchedule.blocks is the LIVE table that file
        reads every tick, and the entries are mutated in place (never
        replaced) so its cached `cur` reference stays the same object. The
        ratchet it pins — every hour belongs to exactly one block, entries in
        ascending order — holds for all four regimes by construction: each
        column above is authored ascending and covers the same eight ids.
     ========================================================== */
  function applySchedule(t) {
    const S = CBZ.prisonSchedule;
    if (!S || !S.blocks) return 0;
    let n = 0;
    for (let i = 0; i < S.blocks.length; i++) {
      const b = S.blocks[i];
      const spec = t.blocks[b.id];
      if (!spec) continue;
      b.from = spec.from;
      b.cells = spec.cells;
      b.home = spec.home;
      b.pa = spec.pa;
      b.torches = spec.torches;
      n++;
    }
    return n;
  }

  /* ==========================================================
     5. LIGHT DISCIPLINE — and it runs the OTHER way to intuition.
        A county farm goes properly dark at 2 a.m.: half its masts are off
        the circuit and the tier burns one dim blue fitting. A fortress is
        never dark, because darkness is the thing it is built to deny you.
        So the night is your best window at LOW and barely a window at all
        at ULTRA — which is the whole reason the ladder costs you something.

        Both handles are prisonnight.js's published ones: LEVELS (the
        lights-out floor per fixture kind) and each fixture's own `on`
        predicate, which its driver already honours.
     ========================================================== */
  const FLOOD_ORDER = [2, 3, 6, 7, 0, 1, 4, 5];   // wing apron + gate first, yard middles last
  function applyLights(t) {
    const P = CBZ.prisonLights;
    if (!P) return 0;
    if (P.kinds) {
      if (P.kinds.night) P.kinds.night.out = t.nightLamp;
      if (P.kinds.block) P.kinds.block.out = t.blockLamp;
      if (P.kinds.room) P.kinds.room.out = t.roomLamp;
    }
    const floods = [];
    for (let i = 0; i < (P.fixtures || []).length; i++) if (P.fixtures[i].kind === "flood") floods.push(P.fixtures[i]);
    let lit = 0;
    for (let k = 0; k < floods.length; k++) {
      const slot = FLOOD_ORDER.indexOf(k);
      const live = (slot < 0 ? k : slot) < t.floods;
      floods[k].on = live ? null : function () { return false; };
      if (live) lit++;
    }
    return lit;
  }

  // searchlight aggression — record fields on entities/searchlight.js's own
  // tower lights, snapshotted once so this never compounds either.
  function applyTowers(t) {
    const list = CBZ.searchlights || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const sl = list[i];
      if (!sl || sl.sweep == null || !sl.pool) continue;    // foreign records (games/military.js) keep out
      if (!sl._tierBase) sl._tierBase = { poolRadius: sl.poolRadius, sweep: sl.sweep, sweepZAmp: sl.sweepZAmp };
      const b = sl._tierBase;
      sl.poolRadius = t.poolR;
      sl.sweep = b.sweep * t.sweepMul;
      sl.sweepZAmp = b.sweepZAmp * t.sweepMul;
      n++;
    }
    return n;
  }

  /* ---- DOOR DISCIPLINE, and the ONE lever this file deliberately does not
       pull. A draft of this table had the yard door standing open through
       YARD and WORK at LOW — "a county farm does not card a man into his own
       exercise yard". It reads well and it is wrong twice over. That door is
       the game's opening objective ("Find a keycard for checkpoints"), so
       giving it away free at the tier EVERY run starts in deletes the spine
       of the shipped game from the default experience; and tools/
       prison-polish-check.mjs caught it immediately — the LOS test that
       stands south of the leaf and shoots north found nothing to hit.

       Lock discipline is real here, it just lives where it belongs: the CELL
       doors, through the schedule table above (LOW racks them shut at 22:00
       for seven hours; ULTRA-MAX at 15:45 for fourteen and a quarter) and
       through `keyMul`, which decides how often the cell key that beats them
       is actually on a screw's belt. Both escalate, neither touches the
       escape route. world/door.js is untouched by this file. ---- */

  /* ==========================================================
     6. THE PAINTED ANCHORS. No words, one colour, four surfaces.
        userData.mover keeps the static batcher off them — a mesh merged into
        a static batch loses the private material this file recolours.
     ========================================================== */
  const paint = [];      // meshes that take the flat tier colour
  const barSlots = [];   // the placard's four bars, lit up to `bars`
  (function signage() {
    if (CFG.PRISON_TIER_SIGNAGE === false || !addBox) return;
    function band(x, y, z, w, h, d) {
      const m = addBox(x, y, z, w, h, d, 0xd9b64c, { cast: false });
      m.userData.mover = true;
      paint.push(m);
      return m;
    }
    // (a) the wing's south face, either side of the throat — the wall you
    //     walk out of every morning and back into every evening.
    band(-9.5, 1.75, -7.44, 12.4, 0.34, 0.08);
    band(9.5, 1.75, -7.44, 12.4, 0.34, 0.08);
    // (b) the north wall INSIDE the wing — the wall a bunk faces. Above the
    //     staff-door head: cellblock.js's opening (CBZ.cellblockStaffGap) is
    //     2.6 m tall at x[-4.2,-2.2], and a stripe at chest height would have
    //     been painted straight across the top of a doorway.
    band(0, 2.95, -43.44, 29, 0.30, 0.08);
    // (c) THE CLASSIFICATION PLACARD, beside the throat at eye height:
    //     a dark backer with four bar slots, N of them burning.
    addBox(-4.35, 3.5, -7.42, 1.5, 1.5, 0.09, 0x16202a, { cast: false });
    for (let i = 0; i < 4; i++) {
      const bar = addBox(-4.35, 3.02 + i * 0.32, -7.36, 1.16, 0.2, 0.06, 0x2b2b2b, { cast: false });
      bar.userData.mover = true;
      barSlots.push(bar);
    }
    // (d) the staff-room noticeboard plate (world/adminwing.js's muster board
    //     is at x 5.75, z -55.5, facing -x) — the same classification, where
    //     the people who set it read it.
    addBox(5.66, 3.35, -53.2, 0.05, 0.66, 1.5, 0x16202a, { cast: false });
    const plate = addBox(5.60, 3.35, -53.2, 0.04, 0.44, 1.2, 0xd9b64c, { cast: false });
    plate.userData.mover = true;
    paint.push(plate);
  })();

  function applySignage(t) {
    for (let i = 0; i < paint.length; i++) {
      const m = paint[i].material;
      m.color.setHex(t.color);
      if (m.emissive) m.emissive.setHex(t.color);
      m.emissiveIntensity = 0.25;
    }
    for (let i = 0; i < barSlots.length; i++) {
      const m = barSlots[i].material;
      const lit = i < t.bars;
      m.color.setHex(lit ? t.color : 0x2b2b2b);
      if (m.emissive) m.emissive.setHex(lit ? t.color : 0x000000);
      m.emissiveIntensity = lit ? 0.9 : 0;
    }
    return paint.length + barSlots.length;
  }

  /* ==========================================================
     7. APPLY — one call, every surface. Runs from the escape mode's own
        reset() hook (below), i.e. at the very end of systems/state.js's
        resetGame, after every counter it wipes and after resetCameras.
     ========================================================== */
  let applied = -1, appliedAt = 0;
  function applyRegime() {
    if (!on()) return false;
    const t = tier();
    reconcilePosts(t.posts);
    applyGuards(t);
    applyCameras(t);
    applySchedule(t);
    applyLights(t);
    applyTowers(t);
    applySignage(t);
    applied = level();
    appliedAt = (CBZ.now || 0);
    return true;
  }

  /* ==========================================================
     8. THE SHAKEDOWN. What a reception search at the DESTINATION lets
        through. Keys, tools and blades never survive one — that is what a
        reception search is FOR, and it is also the honest reason a transfer
        hurts: you do not lose a run, you lose your kit.
     ========================================================== */
  const CONTRA = /key|card|lockpick|hacksaw|shiv|baton|gun|knuckle|torch|c4|charge|rope|saw|blade|phone|sim/i;
  const HARMLESS = ["Soap", "Ramen", "Energy Bar", "Painkillers", "Cigarette Carton", "Lighter", "Pruno Hooch"];
  function survives(name, rule) {
    if (rule === "all") return true;
    if (rule === "none") return false;
    if (rule === "harmless") return HARMLESS.indexOf(name) >= 0;
    return !CONTRA.test(name);                     // "personal": effects, not equipment
  }
  function packProperty(destTier) {
    const rule = destTier.keep;
    const bag = { cigs: Math.floor((g.cigs || 0) * rule.cigs), items: {}, rep: [] };
    const inv = g.inventory || {};
    for (const k in inv) {
      const n = inv[k] | 0;
      if (n > 0 && survives(k, rule.items)) bag.items[k] = n;
    }
    // RESPECT TRAVELS, LOYALTY DOES NOT. Your reputation goes in the transfer
    // file ahead of you and loses a little in the post; the screws you bought
    // are not the screws here (economy.js's resetLoadouts zeroes loyalty on
    // every new run, so this file only has to not put it back).
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || n._crowd) continue;
      const r = n.rep || 0;
      if (r) bag.rep.push([i, r * 0.8]);
    }
    return bag;
  }
  function unpackProperty(bag) {
    if (!bag) return 0;
    let n = 0;
    if (bag.cigs > 0 && CBZ.econ && CBZ.econ.addCigs) { CBZ.econ.addCigs(bag.cigs); n++; }
    if (CBZ.econ && CBZ.econ.addItem) for (const k in bag.items) { CBZ.econ.addItem(k, bag.items[k] | 0); n++; }
    const list = CBZ.npcs || [];
    for (let i = 0; i < (bag.rep || []).length; i++) {
      const row = bag.rep[i], a = list[row[0]];
      if (a) { a.rep = row[1]; n++; }
    }
    return n;
  }

  /* ==========================================================
     9. THE TRANSFER ITSELF. systems/capture.js calls this in place of the
        loseGame it used to make on a third strike; everything after it —
        the card, the button, the wake-up — is this file's.
     ========================================================== */
  let transfers = 0;
  function transfer() {
    if (!on() || CFG.PRISON_TIER_TRANSFER === false) return false;
    const cur = level();
    if (cur >= TOP) return false;                  // nowhere left to send you
    const dest = TIERS[cur + 1];
    g._tierCarry = packProperty(dest);
    g.securityTier = cur + 1;
    g._tierArrive = true;                          // consumed by the next reset
    transfers++;
    // the wing hears you go: three blasts off the nearest real horn, which is
    // prisonschedule's own PA and not a new noise.
    if (CBZ.prisonSchedule && CBZ.prisonSchedule.announce) { try { CBZ.prisonSchedule.announce(3); } catch (e) {} }
    if (CBZ.loseGame) CBZ.loseGame("transferred");
    return true;
  }

  /* THE CARD. systems/state.js owns the DOM; this owns the words on it for a
     transfer, so the between-levels beat lives with the thing it describes. */
  function card() {
    if (!on() || !g._tierArrive) return null;
    const t = tier();
    return {
      logo: "TRANSFERRED",
      sub: "Reclassified: " + t.arrive,
      place: String(level() + 1),
      total: "of 4 · " + t.label,
      button: "REPORT TO " + t.label,
      kept: (g._tierCarry && g._tierCarry.cigs) | 0,
      keptLabel: "Cigs kept",
    };
  }

  /* THE CROWN. Escaping a fortress is not the same result as walking off a
     county farm, and the shipped win card is where that is said.

     AND THE WIN IS WHERE THE LADDER IS BANKED. You beat the classification;
     the next run opens back on the county farm with the crown already on the
     card behind you. That clearing happens HERE — synchronously, inside the
     one call that means "you got out" — and not on a state-change watcher: a
     state hook fires a frame later, on a dispatcher that has to see the
     transition, and a run that is over is exactly when frames stop being
     something to rely on. `beaten` is captured before the clear so winLine()
     below still names the wing you actually escaped. */
  let beaten = 0;
  function crown(box) {
    if (!on() || !box) return false;
    beaten = level();
    const t = TIERS[beaten];
    const logo = box.querySelector(".logo");
    if (logo) logo.textContent = beaten === 0 ? "YOU'RE OUT!" : "OUT OF " + t.label;
    g.securityTier = 0;
    g._tierCarry = null;
    g._tierArrive = false;
    return beaten > 0;
  }
  function winLine(sub) {
    if (!on()) return sub;
    return beaten === 0 ? sub : sub + " · out of " + TIERS[beaten].short;
  }

  /* ==========================================================
     10. ARRIVAL. Fired from the escape mode descriptor's reset(), which
         systems/state.js calls as the LAST thing resetGame does.
     ========================================================== */
  let arrivals = 0;
  function reset() {
    if (!on()) return;
    applyRegime();
    if (!g._tierArrive) return;
    g._tierArrive = false;
    arrivals++;
    // FIRST LIGHT OF A NEW DAY. Land on the tier's own wake hour rather than
    // a literal, so a regime that musters at 06:00 wakes you at 06:00.
    const wake = tier().blocks.wake.from;
    if (CBZ.dayPhase) CBZ.dayPhase((((wake - 6) / 24) % 1 + 1) % 1);
    if (CBZ.dayCount) CBZ.dayCount(CBZ.dayCount() + 1);
    // ...IN YOUR CELL, not on the yard spawn. cellblock.js answers where that
    // is; playerSpawn() returns {x,z} with no y, so never .copy() it.
    const cb = CBZ.cellblock;
    if (cb && cb.playerSpawn) {
      let p = null;
      try { p = cb.playerSpawn(); } catch (e) { p = null; }
      if (p && isFinite(+p.x) && isFinite(+p.z)) {
        CBZ.player.pos.set(+p.x, 0, +p.z);
        CBZ.player.vy = 0;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
      }
    }
    /* THE SCREWS HERE ARE NOT THE SCREWS YOU BOUGHT, and this file has to be
       the one that says so. economy.js's resetLoadouts() does zero loyalty on
       a new run — but it is called by systems/prisondrops.js's own newRunWatcher,
       which polls game.elapsed falling and therefore lands a frame or two
       AFTER this arrival, on a schedule nothing here controls. Measured: a
       guard carried 80 loyalty straight through a transfer on one run and 0
       on the next, purely on frame timing. A guarantee this file makes in its
       own header is a guarantee this file enforces. */
    const lists = [CBZ.guards || [], CBZ.npcs || []];
    for (let q = 0; q < lists.length; q++)
      for (let i = 0; i < lists[q].length; i++) { lists[q][i].loyalty = 0; lists[q][i].bribed = 0; }
    unpackProperty(g._tierCarry);
    g._tierCarry = null;
  }

  /* THE ESCAPE MODE HAS A DESCRIPTOR NOW. config.js:37 has owned
     CBZ.registerMode since long before this file, city/mode.js, survival and
     gungame all use it, and systems/state.js already calls the active mode's
     reset() at the end of resetGame — escape was simply the one mode that
     never registered, so that hook fired for everybody except the prison.
     No `caps` field: systems/modecaps.js asks the descriptor first and falls
     straight through to its own escape row when one is absent, so every
     shared capability answers exactly what it answered before. */
  if (typeof CBZ.registerMode === "function" && !(CBZ.modes && CBZ.modes.escape)) {
    CBZ.registerMode("escape", { id: "escape", label: "Prison Escape", reset: reset });
  }

  /* BELT AND BRACES for a win that never reaches the card (a future exit that
     calls setState("won") without winGame): the ladder must not survive one.
     Every OTHER exit keeps the tier — losing is not a pardon. */
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) {
    CBZ.jailBoost.onStateExit(function (s) {
      if (s === "won" && on()) { g.securityTier = 0; g._tierCarry = null; g._tierArrive = false; }
    }, ["won"]);
  }

  /* ==========================================================
     11. THE TICK — one job only, and it is a latch, not a simulation. The
         regime is applied at reset; this only catches a level that changed
         without one (a console `set`, a probe, a future mid-run mechanic),
         so the world can never disagree with CBZ.game.securityTier for
         longer than a frame.
     ========================================================== */
  CBZ.onUpdate(19.4, function () {
    if (!on()) return;
    if (applied !== level()) applyRegime();
  });

  /* ==========================================================
     12. THE CONTRACT
     ========================================================== */
  CBZ.prisonTier = {
    enabled: on,
    tiers: TIERS,
    table: TIERS,
    level: level,
    tier: tier,
    id: function () { return tier().id; },
    name: function () { return tier().name; },
    label: function () { return tier().label; },
    knob: knob,
    top: function () { return level() >= TOP; },
    set: function (n) {                            // probes and the console
      g.securityTier = Math.max(0, Math.min(TOP, n | 0));
      applyRegime();
      return level();
    },
    transfer: transfer,
    apply: applyRegime,
    card: card,
    crown: crown,
    winLine: winLine,
    posts: mine,
  };

  /* THE RATCHET. `unapplied` counts knobs this file DECLARES that did not
     land on a live surface this session — a knob nothing reads is a design
     that exists only in a comment. It is measured against the world, not
     against the table: guards actually carrying the tier's sight, lenses
     actually offline, the schedule's own hours actually rewritten, floods
     actually dark, towers actually widened, placard bars actually lit.
     `ladderGaps` is the other invariant: four rungs, strictly escalating in
     the things the ladder is FOR — more posts, more lenses, less yard. */
  CBZ.prisonTierAudit = function () {
    const t = tier(), lv = level();
    const missing = [];
    const guards = CBZ.guards || [];
    let reached = 0, owed = 0, torches = 0;
    for (let i = 0; i < guards.length; i++) {
      const gd = guards[i];
      if (gd._reinf) continue;
      owed++;
      if (gd._tierLevel === lv) reached++;
      if (gd.flashlightPatrol) torches++;
    }
    if (owed && reached !== owed) missing.push("guards:" + reached + "/" + owed);
    if (mine.length !== t.posts) missing.push("posts:" + mine.length + "/" + t.posts);
    const cams = CBZ.cameras || [];
    let liveCams = 0;
    for (let i = 0; i < cams.length; i++) if (!cams[i].offline) liveCams++;
    if (cams.length && liveCams !== Math.min(cams.length, t.cameras)) missing.push("cameras:" + liveCams);
    const S = CBZ.prisonSchedule;
    if (!S || !S.blocks || S.blocks[1].from !== t.blocks.yard.from) missing.push("schedule");
    const P = CBZ.prisonLights;
    let litFloods = 0;
    if (P && P.fixtures) for (let i = 0; i < P.fixtures.length; i++) {
      const f = P.fixtures[i];
      if (f.kind === "flood" && !(f.on && !f.on())) litFloods++;
    }
    if (P && litFloods !== t.floods) missing.push("floods:" + litFloods);
    const towers = CBZ.searchlights || [];
    let poolOk = 0;
    for (let i = 0; i < towers.length; i++) if (towers[i]._tierBase && towers[i].poolRadius === t.poolR) poolOk++;
    if (towers.length && !poolOk) missing.push("towers");
    let barsLit = 0;
    for (let i = 0; i < barSlots.length; i++) if (barSlots[i].material.emissiveIntensity > 0) barsLit++;
    if (barSlots.length && barsLit !== t.bars) missing.push("placard:" + barsLit);
    if (P && P.kinds && P.kinds.night && P.kinds.night.out !== t.nightLamp) missing.push("nightLamp");
    const unapplied = missing.length;
    // the ladder must actually escalate, or it is four names for one prison
    let ladderGaps = 0;
    for (let i = 1; i < TIERS.length; i++) {
      const a = TIERS[i - 1], b = TIERS[i];
      if (!(b.posts > a.posts)) ladderGaps++;
      if (!(b.cameras > a.cameras)) ladderGaps++;
      if (!(b.viewMul > a.viewMul)) ladderGaps++;
      if (!(openHours(b) < openHours(a))) ladderGaps++;
      if (!(b.stealMul < a.stealMul)) ladderGaps++;
    }
    // and every regime's table must stay a legal timetable
    let unsorted = 0;
    for (let i = 0; i < TIERS.length; i++) {
      const ids = ["wake", "yard", "mess", "work", "supper", "count", "secure", "night"];
      for (let k = 1; k < ids.length; k++)
        if (!(TIERS[i].blocks[ids[k]].from > TIERS[i].blocks[ids[k - 1]].from)) unsorted++;
    }
    return {
      on: on(), level: level(), id: t.id, name: t.name,
      unapplied: unapplied, missing: missing, ladderGaps: ladderGaps, unsorted: unsorted,
      hudText: 0,
      guards: guards.length, tierPosts: mine.length, torchCarriers: torches,
      cameras: cams.length, liveCameras: liveCams,
      floods: litFloods, poolRadius: t.poolR,
      openHours: Math.round(openHours(t) * 100) / 100,
      lockedHours: Math.round(lockedHours(t) * 100) / 100,
      transfers: transfers, arrivals: arrivals, appliedAt: appliedAt,
      carry: g._tierCarry ? Object.keys(g._tierCarry.items).length : 0,
      signage: paint.length + barSlots.length,
    };
  };
  // hours the COMPOUND is open (yard start -> the first block that sends a
  // body home) and hours the cell holds you.
  function openHours(t) {
    const b = t.blocks;
    const home = b.count.home ? b.count.from : b.secure.from;
    return home - b.yard.from;
  }
  function lockedHours(t) {
    const b = t.blocks;
    const lock = b.count.cells === "lock" ? b.count.from : b.secure.from;
    return (24 - lock) + b.wake.from;
  }
})();
