/* ============================================================
   warlord/battle.js — THE ACTUAL WAR.

   THE DONOR IS games/battle.html AND THE REUSE IS THE POINT. That page is a
   working NPC war simulator — a thousand men, real guns, combat_iq brains,
   cover, suppression, flanking arcs, ragdoll corpses, dropped rifles — and
   this file is that machine with two things added and one thing removed:

     ADDED   YOU. A warlord standing in his own firing line, with his own
             rifle, who can be shot. That is the whole reason the campaign
             exists and it is the one thing a spectator page cannot have.
     ADDED   MORALE. battle.html's armies fight to the last man because a
             spectator wants to watch the whole thing. A COMMANDER needs the
             opposite: an army that BREAKS, because breaking is the only
             mechanic that makes fifteen veterans beat forty levies, and that
             is the entire reason "who gets the good rifle" is a decision.
     REMOVED the war room, the benchmark, the bestiary, the air war and the
             nine venues. This battle has one venue — the piece of the real
             island the encounter happened on — and one roster: yours.

   THE MEN ARE REAL SOLDIERS. Every body on the sand is a soldier object out of
   W.state.army or band.men, carrying that man's own `wid` and `armour`, and
   when he dies THAT OBJECT dies. It is the same reference the aftermath screen
   prints a name off and the same reference the campaign will not see again.
   This is the whole reason core.js insists a band carries a real roster.

   WHAT IS ENGINE AND WHAT IS THIS FILE, stated so the claim is checkable:
     bodies          CBZ.studio.cast          (entities/character.js's rig)
     guns in hands   CBZ.syncActorWeapon      (systems/actorweapons.js)
     how they fight  CBZ.combatIQ.posture/shot/slot/suppress/cover
     rounds drawn    CBZ.tracer/muzzleFlash/bulletImpact  (systems/gunfx.js)
     wounds          CBZ.bodyWound            (systems/wounds.js)
     the dead        warlord/deaths.js  — which is itself CBZ.deathPose +
                     CBZ.cityRagdoll (city/ragdoll.js) + CBZ.gore
                     (systems/gore.js) + core/loop.js's hit-stop semantics,
                     spent through a rank rather than through array order.
                     See its header: this file used to lay a man down in
                     three lines and the owner's word for the result was
                     "instant".
     dropped rifles  CBZ.weaponPhysics.drop   (systems/actorweapons.js)
     the ground      W.desert.battlefieldAt() (warlord/desert.js)
     YOUR gun        systems/fpsmode.js       (via warlord/gunplay.js)
   Nothing above is reimplemented here. What IS this file: who is on which
   side, morale, the four orders, and the report.

   THE PLAYER'S GUN USED TO BE THE EXCEPTION AND IT WAS THE WRONG ONE. This
   file carried its own aim, its own trigger, its own cone magnet, its own
   ammo, its own viewmodel and its own two camera seats, under a comment
   claiming systems/fpsmode.js could not be stood up here. Every reason in that
   comment was checkable and every one of them was false — warlord/gunplay.js
   opens with the list. So the fork is gone: the warlord now shoots with the
   same file the jail and gun game shoot with, mounted through the same
   route-the-name shims games/warlord.html already installs for
   queryCollidersNear / floorAt / collide. What is left here of the player is
   what a BATTLE owns and a gun does not: where he spawns, that he is in the
   roster, that being shot hurts him, and the command seat.

   WHERE THE DONOR IS WRONG AND THIS FILE DOES IT DIFFERENTLY (CLAUDE.md: the
   codebase is not a bible) — each is commented at its site:
     · battle.html multiplies every landed round by 1.45 with the note "combat_
       iq's ladder is authored for fights against the PLAYER, whose fairness cap
       this page has no player to need". THIS page has a player. So the 1.45
       applies man-on-man and NOT to rounds aimed at you — see hurtMan.
     · its `hunt` mop-up phase (three to one, everyone sprints) is a spectator
       fix for dead air. Here the same job is done honestly by morale: at three
       to one the losing side is already routing and the battle ENDS.
     · its corpse budget is 420 for a camera flying over a thousand men. A
       campaign battle is tens to low hundreds and the camera is usually a man
       standing in it, so the budget is smaller and the sink is nearer.

   FLAGS (repo doctrine — every behaviour switch reverts in one param)
     ?morale=old   no morale, no rout: both armies fight to the last man,
                   which is exactly what battle.html does. The A/B.
     ?orders=old   the four order buttons do nothing; everyone holds. The
                   revert for the command layer.
     ?tlos=0       the dunes stop blocking sight lines
     ?men=N        per-side fielding cap (default 750 on a desktop, 300 on a
                   touch device — both measured, see MEN_CAP)
     ?squads=old   the SQUAD layer is off: every man thinks, paths, separates
                   and plants his own boots every frame, exactly as this file
                   used to. The revert for the formation/relevance rewrite and
                   the honest "before" column for
                   tools/warlord-scale-check.mjs --ab.
                   IT DOES NOT REVERT THE SPAWN FRONTAGE OR freeSpot, and that
                   is deliberate: those two are bugs, not behaviour (a side of
                   500 formed a 155 m deep queue ten men wide, so four fifths
                   of an army was out of the fight — MEASURED, 601 bodies at
                   t=45 s fired 91 rounds against 464 from 301 bodies). An A/B
                   where the two columns are fighting differently shaped
                   battles measures nothing.
     ?field=old    the battlefield height field is off — every ground query
                   and every metre of every sight line goes straight to
                   desert.js's heightAt again. Separate from ?squads=old on
                   purpose: it is the one change that could move a man's feet,
                   so it has to be revertible on its own.
     ?battle=1     debug: drop straight into a test battle at boot
     ?gunplay=old  warlord/gunplay.js's legacy path — the hand-rolled player
                   controller this file used to carry, kept whole so the new
                   one can be photographed against it. The A/B.
     ?gunplay=0    no player gunplay at all (watch the AI war)
     ?deaths=old   warlord/deaths.js's revert: a man dies exactly the way this
                   file used to kill him — deathPose on frame zero, a coin-flip
                   direction, a one-axis plank at 2.4/s, no blood, no hit-stop
                   and no rim. THE A/B for the death sequence. The old code is
                   in deaths.js, not here, so the game has one death path.
     ?blood=0      do not fetch the studio "blood" pack (systems/gore.js)
     ?rim=old      no rim marks at all. The kill feed is DELETED, not hidden,
                   so this is a bare revert of the picture — it is what the
                   A/B needs to prove the rim is the thing carrying the news.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});

  let THREE = null, ctx = null, Q = null;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ============================================================ BUDGETS
     THE CAP EXISTS AND IT IS STATED ON SCREEN. battle.html has no cap because
     it is a benchmark — you type a number and the frame rate tells you the
     truth. A campaign cannot do that: a legion of 900 has to be survivable on
     a phone, and a page that locks up is a run that ends. So a side fields at
     most MEN_CAP; the men over the line stay with the baggage, take no part,
     and SURVIVE — they are still on the roster afterwards, which is the only
     honest way to cap a real army. ?men=N overrides it in both directions.

     300 WAS FOLKLORE AND IT IS NOW MEASURED. The old comment said "300 is
     battle.html's own measured neighbourhood (its saved `cbz-npcwar-max` is
     per side at 30 fps on the machine that ran it)" — a different page, a
     different simulation, an unnamed machine, an unstated moment in the fight,
     and nothing in this repo had ever re-measured it against THIS battle.
     tools/warlord-scale-check.mjs does, and its header explains why the answer
     has to be reported as CPU time rather than as a frame rate: the headless
     rig rasterises in software, so its draw cost is a fact about a missing GPU
     driver and its JavaScript cost is a fact about the game.

     MEASURED, seed 1337, at t=45 s (the beat where both lines are actually
     shooting), on a Mac under heavy contention — four other agents, load
     average ~120, so every number here is pessimistic:

         bodies    sim ms    matrix ms    CPU total
            121      1.00         0.90         1.90
            301      3.70         2.60         6.30
            601      7.50         5.70        13.20
           1001     12.70         8.80        21.50
           1601     20.50        14.20        34.70

     That is 13 us of CPU per body per frame and it is very nearly linear, so
     the knee is an interpolation and not a cliff: 1 540 bodies fit a 30 fps
     CPU frame and 770 fit a 60 fps one. Per side, halved: 770 and 384.

     AND IT IS A DEVICE QUESTION, WHICH ONE CONSTANT CANNOT BE. The old comment
     was right that "a legion of 900 has to be survivable on a phone" and wrong
     to answer it with a single number for every machine the game runs on. A
     phone keeps 300 — battle.html's inherited figure, which is at least a
     30 fps number from a real device — and anything with a mouse gets the
     measured one. ctx.coarse is the shell's own touch/desktop flag, already
     used here to choose the opening camera.

     750, not 770: the measurement is a median under contention and the cap
     wants to sit under its own knee rather than on it.

     NOTE FOR WHOEVER RAISES THIS NEXT. On the enemy side the cap is no longer
     what binds — core.js's W.rollBigSize tops out at 300 men, so no party on
     the island can field more than that however high this goes. What the raise
     actually buys is YOUR army: a warlord who has conscripted 700 men now
     brings 700 of them instead of leaving 400 with the baggage. */
  const MEN_CAP_COARSE = 300;
  const MEN_CAP_DESKTOP = 750;
  function MEN_CAP_DEFAULT() { return (ctx && ctx.coarse) ? MEN_CAP_COARSE : MEN_CAP_DESKTOP; }
  const FIELD_R = 170;             // the battlefield is ~340 m across
  const CORPSE_MAX = 260;          // see the header: a smaller field, a nearer camera
  const SIGHT = 175;
  const GRID_CELL = 14;

  /* ============================================================ THE PROFILER
     BECAUSE "IT FEELS SLOW AT THREE HUNDRED" IS NOT A MEASUREMENT, and every
     optimisation this file has ever had was aimed by reading the code rather
     than by timing it. tools/warlord-scale-check.mjs turns this on, runs
     seventy frames and prints the per-phase millisecond split, so the next
     person to make this faster starts from the profile instead of from a
     hunch. (The first profile taken this way said the sight lines cost more
     than everything else in the sim put together, which nobody had guessed.)

     OFF IT IS ONE BRANCH. pNow() returns 0 and pAdd() returns immediately, so
     the shipping game pays a predictable-not-taken test per phase per frame —
     eight of them — and nothing else. The COUNTERS are what make it useful:
     a timer tells you sight lines are expensive, a counter tells you a man
     tests line of sight nine times a second and that is the actual bug. */
  const PROF = { on: false, frames: 0, t: Object.create(null), n: Object.create(null) };
  function pNow() { return PROF.on ? performance.now() : 0; }
  function pAdd(k, t0) { if (PROF.on) PROF.t[k] = (PROF.t[k] || 0) + (performance.now() - t0); }
  function pHit(k, c) { if (PROF.on) PROF.n[k] = (PROF.n[k] || 0) + (c === undefined ? 1 : c); }

  /* ============================================================ THE FIELD
     ONE CACHED HEIGHT LOOKUP, AND IT IS THE LARGEST SINGLE COST IN THE FIGHT.

     MAP.groundAt is desert.js's heightAt: coast warp, province blend, three
     dune octaves, wadis, mesas, oasis mix — about fifty hashes per call, and
     desert.js's own comment calls it "the hot path in the file". It is exactly
     the right function for "what shape is this island". It is a terrible one
     to put in an inner loop, and this file had it in two:

       · every man's feet, every substep (through sand.plant's `ground`).
       · every metre of every sight line. terrainBlocked marches ceil(d/3)
         samples, so a 100 m sight line is 33 heightAt calls, and a man tests
         line of sight on every think AND again on every trigger pull.

     MEASURED with the counters above at 300 v 300, and the honest number is
     smaller than the guess that motivated it: 32 sight-line tests a frame at
     ~20 samples each is about 39 000 heightAt calls a second, and swapping
     them onto the field takes the whole man-stepping phase from 3.30 ms to
     2.94 ms — a tenth of the frame, not a third. heightAt is around half a
     microsecond, not the two this was written expecting. The change stays
     because the OTHER half of it is not a speed argument at all (see below)
     and because a tenth of the frame at no cost is still a tenth of the
     frame — but the profiler is what said so, and the guess was wrong.

     A BATTLE IS 340 m ACROSS AND THE GROUND DOES NOT MOVE. So sample it once
     and read it back bilinearly. The spacing is not a tuning choice: 2.69 m is
     what desert.js's raise() draws the battlefield mesh at (span radius*2+90
     over 160 segments), and a bilinear read of the lattice a mesh is built
     from IS that mesh's surface, to the triangle diagonal. So this is not an
     approximation of the battlefield — it is the battlefield, and the men now
     stand on the ground you can SEE rather than on the analytic surface the
     mesh was sampled from. Those two differ by up to a third of a metre on a
     dune face, which is a boot through the sand at close range.

     THE MARGIN IS DERIVED, NOT PICKED. A routed man runs to FIELD_R * 0.95
     before he leaves, spawnAt places the deepest rank at gap/2 + rank depth,
     and the flank anchor swings 46-66 m off the enemy centre of mass. FIELD_R
     + 90 covers all three with room; anything outside falls through to
     heightAt and simply pays the old price, so being wrong about the extent
     costs speed and never correctness. */
  const FIELD_STEP = (FIELD_R * 2 + 90) / 160;   // desert.js raise()'s own vertex spacing
  const FIELD_MARGIN = 90;
  let fld = null, fldN = 0, fldX0 = 0, fldZ0 = 0, fldSrc = null;
  function buildField(cx, cz, srcAt) {
    fldSrc = srcAt;
    if (Q && Q.get("field") === "old") { fld = null; return srcAt; }
    const half = FIELD_R + FIELD_MARGIN;
    fldN = Math.ceil((half * 2) / FIELD_STEP) + 1;
    fldX0 = cx - half; fldZ0 = cz - half;
    fld = new Float32Array(fldN * fldN);
    for (let j = 0; j < fldN; j++) {
      const z = fldZ0 + j * FIELD_STEP;
      const row = j * fldN;
      for (let i = 0; i < fldN; i++) fld[row + i] = srcAt(fldX0 + i * FIELD_STEP, z);
    }
    return fieldAt;
  }
  function fieldAt(x, z) {
    const gx = (x - fldX0) / FIELD_STEP, gz = (z - fldZ0) / FIELD_STEP;
    const i = gx | 0, j = gz | 0;
    if (i < 0 || j < 0 || i >= fldN - 1 || j >= fldN - 1) return fldSrc(x, z);
    const fx = gx - i, fz = gz - j, k = j * fldN + i;
    const a = fld[k], b = fld[k + 1], c = fld[k + fldN], d = fld[k + fldN + 1];
    const lo = a + (b - a) * fx;
    return lo + (c + (d - c) * fx - lo) * fz;
  }

  /* THE STRING BOTH CONSUMERS READ. actorweapons.js resolves the appearance
     model off a weapon id, and combat_iq.js classifies the competence column
     off actor.weapon as a NAME. battle.html carries the same table for the
     same reason: they are two different readers of one field, and a rifle that
     reads as "carbine" to one and "pistol" to the other is a man who holds an
     M4 and shoots like a clerk. Keyed by weapon-data's own ids, so a gun added
     to the armoury lands on the fall-through rather than silently misreading. */
  const GUN_NAME = {
    sidearm: "Pistol", shotgun: "Shotgun", carbine: "Carbine", smg: "SMG",
    revolver: "Revolver", deagle: "Desert Eagle", ak47: "AK-47", uzi: "Uzi",
    sniper: "Sniper", lmg: "LMG", taser: "Taser",
    bazooka: "bazooka", glauncher: "glauncher",
  };
  function gunName(wid) { return GUN_NAME[wid] || W.gunLabel(wid); }

  /* WHAT A TIER LOOKS LIKE. core's TIERS[].cq names the combat_iq ROLE row —
     it is a statement about how the man FIGHTS — and studio.cast's table is a
     wardrobe. They are two different questions and core is right not to answer
     the second one, so the mapping lives here, where the bodies are built. The
     wardrobe follows the competence on purpose: a levy dressed as a soldier is
     a lie the player reads off the screen before he reads the odds card. */
  const CAST_OF = { civ: "civilian", thug: "thug", guard: "guard", soldier: "soldier" };

  /* ============================================================ STATE */
  let live = false;
  let scene = null, micro = null;
  let men = [], corpses = [], sinking = [], dropGuns = [], addedCols = [], addedMeshes = [];
  let YOU = null, youRig = null;
  let simT = 0, over = false, started = false;
  let hud = null, frameFn = null, capped = { mine: 0, them: 0 };
  let MAP = null, band = null, report = null, startOpts = null;
  let fogSave = null, shadowSave = null, camSave = null;
  let deadSolving = 0;
  let fxBudget = 0;
  let injectDt = 0;                 // the probe's clock — see __warlordBattle
  let _shot = null;                 // the man the death studio last executed
  const SIDES = {};
  const V = function () { return new THREE.Vector3(); };
  let _v = null, _v2 = null, _muz = null;

  // a local seeded stream: the battle must replay identically from a save, and
  // it must not consume the CAMPAIGN's stream (core.js's RND) or every fight
  // would shuffle the island behind it.
  let lcg = function () { return 0.5; };
  function seedBattle(n) {
    let s = (n | 0) || 1;
    lcg = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ============================================================ THE GROUND
     ASK desert.js FOR THE REAL ISLAND, and fall back to sand of our own rather
     than be blocked by a file another agent is still writing. The contract is
     `W.desert.battlefieldAt(x, z, radius) -> {groundAt, relief, cover[], raise, clear}`.

     COVER IS REGISTERED AS COLLIDERS HERE regardless of who drew it, because a
     rock that combat_iq cannot see is not cover — its whole cover search is
     CBZ.queryCollidersNear, which the page has shimmed onto microboot's grid.
     Meshes are only built for boxes when desert.js declined to raise anything,
     so we never draw a second copy of a rock it already put there. */
  function buildGround(cx, cz) {
    /* THE FIGHT HAPPENS ON THE ISLAND. ?ground=own used to refuse desert.js
       and fall back to three sine trains typed in this file — a second desert
       that only ever ran on a slice page, kept as "the revert". desert.js is
       loaded before this module boots (CONTRACT.md's `needs`) and has been for
       months, so the flag's only real job was to answer "whose ground is
       flat", and battlefieldAt now reports its own measured relief. The flag
       is gone; the emergency fallback below stays, because a fight on NO
       ground is worse than a fight on approximate ground. */
    const bf = (W.desert && typeof W.desert.battlefieldAt === "function")
      ? safe(function () { return W.desert.battlefieldAt(cx, cz, FIELD_R); }) : null;

    let groundAt = null, relief = 0, cover = [], raised = false, clearFn = null;
    if (bf && typeof bf.groundAt === "function") {
      groundAt = bf.groundAt;
      relief = bf.relief || 0;
      cover = bf.cover || [];
      clearFn = bf.clear;
      if (typeof bf.raise === "function") raised = safe(function () { bf.raise(); return true; }) === true;
    }

    if (!groundAt) {
      /* OUR OWN SAND. Three sine trains, phases hashed off the campaign seed
         AND the encounter point, so the fight you had at that dune is the same
         dune on a reload — and two different encounters are two different
         places. Wavelengths are dune-scale (110-460 m) so a crest genuinely
         stands between two firing lines rather than rippling under them; the
         relief that comes out measures 16-22 m, which is the window
         battle.html's own dune scan holds out for. */
      const h = function (s) { return W.hash01(cx, cz, (W.state.seed | 0) + s) * Math.PI * 2; };
      const p1 = h(11), p2 = h(29), p3 = h(53);
      groundAt = function (x, z) {
        const a = x - cx, b = z - cz;
        return Math.sin(a * 0.0210 + p1) * 3.6 +
               Math.sin(b * 0.0172 + p2) * 3.1 +
               Math.sin((a + b * 0.7) * 0.0087 + p3) * 5.4;
      };
      /* AND NO SCATTER. This used to call fallbackCover(), which threw 34
         boxes onto the sand so that combat_iq's box-only cover search would
         find SOMETHING. hullDown() searches the ground itself now, and the
         ground here has 16-22 m of relief in it — the folds are the cover. */
    }

    // MEASURED, not declared: the same number battle.html prints, off the same
    // groundAt the men will stand on, over the window they will fight in.
    if (!relief) {
      let lo = 1e9, hi = -1e9;
      for (let sx = -FIELD_R; sx <= FIELD_R; sx += 12) {
        for (let sz = -FIELD_R; sz <= FIELD_R; sz += 12) {
          const y = groundAt(cx + sx, cz + sz);
          if (y < lo) lo = y; if (y > hi) hi = y;
        }
      }
      relief = Math.round((hi - lo) * 10) / 10;
    }
    /* AND A SECOND RELIEF, BECAUSE THE FIRST ONE LIES ABOUT THE FIGHT.
       `relief` is peak-to-peak over the WHOLE 340 m disc, rim included, and
       that is the wrong question for "is there cover here". MEASURED on seed
       1337 at (-2400,-4400): relief 26.0 m, terrainLos armed — and the middle
       150 m of that field, which is exactly where two lines 160 m apart meet,
       is a dead-flat pan at 2.4 m. It is a basin with high walls. Every one of
       496 reverse-slope probes came back empty and the answer was correct;
       the field was flat where it mattered and steep where nobody stood.

       coreRelief is the same measure over the inner half — the ground the
       start lines and the whole engagement sit on. Across the island's 345
       dune fields the two disagree constantly, and it is coreRelief the fold
       search is gated on. */
    let cLo = 1e9, cHi = -1e9;
    const CORE_R = Math.round(FIELD_R * 0.53);
    for (let sx = -CORE_R; sx <= CORE_R; sx += 6) {
      for (let sz = -CORE_R; sz <= CORE_R; sz += 6) {
        const y = groundAt(cx + sx, cz + sz);
        if (y < cLo) cLo = y; if (y > cHi) cHi = y;
      }
    }
    const coreRelief = Math.round((cHi - cLo) * 10) / 10;

    /* AND FROM HERE ON THE GROUND IS THE CACHED FIELD. Swapped in AFTER the
       relief measurement above and BEFORE anything else in the file gets a
       reference, so relief is still measured off the analytic surface (the
       number battle.html prints, unchanged) and every query after it — feet,
       sight lines, cover seating, the rock meshes, CBZ.groundAt, the player's
       floor — reads the lattice the mesh is drawn from. See THE FIELD. */
    groundAt = buildField(cx, cz, groundAt);

    // the cover boxes become real colliders — for the bullets, the bodies and
    // combat_iq's cover search alike
    for (let i = 0; i < cover.length; i++) {
      const c = cover[i];
      const y = groundAt(c.x, c.z) + (c.h || 1.4) / 2;
      addedCols.push(micro.addBoxCollider(c.x, y, c.z, c.w || 2, c.h || 1.4, c.d || 2));
      if (!raised) rockMesh(c, groundAt);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    if (!raised) groundMesh(cx, cz, groundAt);

    return {
      cx: cx, cz: cz, groundAt: groundAt, relief: relief, coreRelief: coreRelief, cover: cover,
      // the biome this fight is in — the one thing that decides whether there
      // is anything on the field at all (desert.js COVER_BY_BIOME)
      biome: (bf && bf.biome) || null,
      // WHOSE GROUND THIS IS. The audit used to report "is battlefieldAt
      // available", which is a different question and answered true even under
      // ?ground=own — so the one flag that exists to tell the two grounds apart
      // could not be checked from the audit it was added for.
      fromDesert: !!(bf && bf.groundAt),
      // A DUNE IS NOT MADE OF COLLIDERS — battle.html's own finding. A sight
      // line across real sand has to sample the sand, or a man puts rounds
      // through twenty metres of crest. Only armed where the ground genuinely
      // has shape in it; ?tlos=0 makes the sand transparent again.
      terrainLos: relief > 6 && (!Q || Q.get("tlos") !== "0"),
      /* WHETHER THERE IS A FOLD TO GET BEHIND, which is a different question
         from whether the ground can block a shot. 3 m: a standing eye is
         1.6 m and a crouched one 1.0, so under about two metres of relief in
         the fighting ground there is no arrangement of terrain that hides one
         and not the other, and hullDown() would burn a hundred and sixty
         terrain probes per man to prove it. */
      folded: coreRelief > 3 && relief > 6 && (!Q || Q.get("tlos") !== "0"),
      clear: clearFn,
    };
  }
  function safe(fn) { try { return fn(); } catch (e) { console.warn("[warlord/battle]", e); return null; } }

  function rockMesh(c, groundAt) {
    const m = new THREE.Mesh(
      CBZ.boxGeom ? CBZ.boxGeom(c.w, c.h, c.d) : new THREE.BoxGeometry(c.w, c.h, c.d),
      CBZ.cmat ? CBZ.cmat(0x7a6a4c) : new THREE.MeshLambertMaterial({ color: 0x7a6a4c }));
    m.position.set(c.x, groundAt(c.x, c.z) + c.h / 2, c.z);
    m.rotation.y = W.hash01(c.x, c.z, 3) * Math.PI;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    addedMeshes.push(m);
  }
  /* THE SURFACE. One displaced plane over the fight and one flat skirt out to
     the fog. 3 m cells: a man walking a 300 m dune wavelength never rises more
     than a few centimetres between two samples, so the mesh and the analytic
     groundAt the men actually stand on cannot visibly disagree. */
  function groundMesh(cx, cz, groundAt) {
    const span = FIELD_R * 2 + 90, seg = 150;
    const g = new THREE.PlaneGeometry(span, span, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < pos.count; i++) {
      const y = groundAt(pos.getX(i) + cx, pos.getZ(i) + cz);
      pos.setY(i, y);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    for (let i = 0; i < pos.count; i++) {
      // the crests catch the sun and the troughs hold the shade — one channel
      // of height, which is what makes a dune field read as dunes in a still
      const t = clamp((pos.getY(i) - lo) / Math.max(0.001, hi - lo), 0, 1);
      /* THE SAND IS DARKER THAN SAND LOOKS. A Lambert vertex colour is
         multiplied by the light, and this page's sun plus hemisphere lands
         around 1.26 — so a 0.68-0.88 base clips every crest to white and a
         dune field with 21 m of measured relief in it photographs as a sheet
         of paper, which is exactly what the ?ground=own capture showed.
         0.42-0.62 lands at 0.53-0.78 lit: sand, with the crest-to-trough
         separation still readable. */
      col[i * 3] = 0.42 + t * 0.20;
      col[i * 3 + 1] = 0.34 + t * 0.18;
      col[i * 3 + 2] = 0.21 + t * 0.13;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    m.userData.terrain = true;
    scene.add(m);
    addedMeshes.push(m);

    // the skirt: flat, at the field's floor, so the horizon is ground and not
    // the inside of the sky dome. The battle fog (see start()) eats the seam.
    const sk = new THREE.PlaneGeometry(9000, 9000);
    sk.rotateX(-Math.PI / 2);
    const sm = new THREE.Mesh(sk, new THREE.MeshLambertMaterial({ color: 0x8f7a52 }));
    sm.position.set(cx, lo - 0.4, cz);
    sm.receiveShadow = true;
    sm.matrixAutoUpdate = false; sm.updateMatrix();
    sm.userData.terrain = true;
    scene.add(sm);
    addedMeshes.push(sm);
  }

  /* ============================================================ THE FIELD
     THE START LINE. battle.html measured 150 m for open dunes ("resolved in
     32 s") with a camera that WANTED a long approach to photograph. A player
     standing in the line wants contact sooner, and 160 m of open sand closes
     in about thirteen seconds at the two lines' combined march. A surprised
     warlord — a demand for surrender that got laughed at — starts at 95, which
     is inside rifle band on the first step and is the whole cost of asking. */
  function GAP() { return (startOpts && (startOpts.surprised || startOpts.chased)) ? 95 : 160; }

  const _fs = [];
  function blockedAt(x, z) {
    const cols = micro.queryColliders(x, z, 0.9, _fs);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (x < b.minX - 0.55 || x > b.maxX + 0.55) continue;
      if (z < b.minZ - 0.55 || z > b.maxZ + 0.55) continue;
      if (b.y0 != null && b.y1 != null && (b.y1 < 0.35 || b.y0 > 1.7)) continue;
      return true;
    }
    return false;
  }
  // battle.html's spiral, kept whole: the first free point is genuinely the
  // nearest one and it is deterministic, so two men never start inside a rock
  // or inside each other.
  /* THE CLAIM LIST WAS O(N²) AND AT 500 A SIDE IT WAS THE SLOWEST THING IN THE
     GAME. Every candidate point was tested against EVERY point already taken,
     and the spiral tries up to forty candidates per man: at man 2400 that is
     96 000 distance tests for one soldier and roughly 230 million for the
     army. Deploying 500 v 500 spent over a minute in this function alone,
     which is why nobody had ever seen a battle that size — it looked like a
     hang, not like a cost.

     A HASH ON THE SAME 1.15 m THE TEST IS ABOUT. Two men conflict inside
     R*2 = 1.15 m, so a bucket that wide means the only claims that can
     possibly conflict are in this cell or the eight around it. Nine bucket
     reads instead of N, and the ANSWER IS IDENTICAL — this is not an
     approximation with a tolerance, it is the same predicate with the
     impossible candidates skipped. */
  const CLAIM_CELL = 1.15;         // = R * 2, the conflict distance itself
  const _claim = new Map();
  function claimKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  function freeSpot(x, z) {
    const R = 0.575;
    const crowded = function (px, pz) {
      const cx = Math.floor(px / CLAIM_CELL), cz = Math.floor(pz / CLAIM_CELL);
      for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
        const a = _claim.get(claimKey(cx + ax, cz + az));
        if (!a) continue;
        for (let i = 0; i < a.length; i += 2) {
          const dx = px - a[i], dz = pz - a[i + 1];
          if (dx * dx + dz * dz < (R * 2) * (R * 2)) return true;
        }
      }
      return false;
    };
    const take = function (px, pz) {
      const k = claimKey(Math.floor(px / CLAIM_CELL), Math.floor(pz / CLAIM_CELL));
      let a = _claim.get(k);
      if (!a) { a = []; _claim.set(k, a); }
      a.push(px, pz);
      return { x: px, z: pz };
    };
    if (!blockedAt(x, z) && !crowded(x, z)) return take(x, z);
    for (let k = 1; k < 40; k++) {
      const a = k * 2.399963229728653, d = k * 1.35;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!blockedAt(px, pz) && !crowded(px, pz)) return take(px, pz);
    }
    return take(x, z);
  }
  /* HOW AN ARMY IS DRAWN UP, AND THE OLD ANSWER DOES NOT SCALE PAST ABOUT
     FIFTY MEN.

     It was `col = i/10, row = i%10`: ten men abreast, and every extra ten men
     added another rank BEHIND. That is a firing line for a skirmish and a
     queue for an army. MEASURED at 500 a side: 50 ranks at 3.1 m is a column
     155 metres deep and 34 metres wide, so the front two ranks fought and the
     other 480 men walked. The scale check saw it plainly — 601 bodies fired 91
     rounds in 45 seconds where 301 bodies fired 464. More men made the battle
     QUIETER.

     THE FRONTAGE IS DERIVED FROM THE GROUND, not from a head count. The
     battlefield is 2 * FIELD_R across and a man needs FILE_W of lateral room,
     so there are at most FILE_MAX files on it, full stop. Under that ceiling
     the shape is ranks ≈ sqrt(N / 6): the 6 is the aspect a formed body of men
     actually has (six times wider than deep — a line, not a block), and it is
     the only number here that is a choice rather than a measurement. It gives
     26 men two ranks of 13, 300 men seven ranks of 43 (103 m of frontage on a
     340 m field), 900 men twelve ranks of 75, and 1500 men the file ceiling
     with twelve ranks behind it. Every one of those is a formation somebody
     could point at and name, and in every one of them the whole army is in
     the fight within one advance. */
  const FILE_W = 2.4;              // lateral room per man: SEP is 0.9, a rifle is 1.1
  const RANK_D = 2.9;              // depth per rank — a stride and a half
  const FILE_MAX = Math.floor((FIELD_R * 2 * 0.92) / FILE_W);   // 130 files on this field
  function frontage(n) {
    let ranks = Math.max(1, Math.round(Math.sqrt(n / 6)));
    let files = Math.ceil(n / ranks);
    if (files > FILE_MAX) { files = FILE_MAX; ranks = Math.ceil(n / files); }
    return { ranks: ranks, files: files };
  }
  function spawnAt(sideKey, i) {
    const s = SIDES[sideKey];
    const gap = GAP();
    const F = s.front || (s.front = frontage(Math.max(1, s.plan || 1)));
    const rank = (i / F.files) | 0, file = i % F.files;
    /* AMBUSHED MEN DO NOT FORM RANKS. A surprised army spawns scattered, which
       is not decoration: a rank is a firing LINE and a scatter is not, so the
       first thirty seconds of a surprised fight are genuinely worse. */
    const jitter = (startOpts && startOpts.surprised && sideKey === "mine") ? 14 : 1.8;
    const x = MAP.cx + s.dir * (gap / 2 + 8 + rank * RANK_D) + (lcg() - 0.5) * jitter;
    // the odd ranks stand in the gaps of the even ones — a checker, so the
    // second rank can see between the first rather than into its backs
    const z = MAP.cz + (file - (F.files - 1) / 2) * FILE_W + (rank & 1) * (FILE_W / 2) +
              (lcg() - 0.5) * jitter;
    return freeSpot(x, z);
  }

  /* ============================================================ THE MEN
     ONE BODY PER SOLDIER OBJECT, and the soldier object is the one the
     campaign owns. `m.s` is that reference and it is the only thing that
     survives this file. */
  function makeMan(sideKey, s, i) {
    const side = SIDES[sideKey];
    const T = W.tier(s.tier);
    const wid = s.wid || "sidearm";
    const w = CBZ.weaponById ? CBZ.weaponById(wid) : null;
    /* DRESSED BY HIS ARMY, not tinted by his team. outfits.js owns the 61
       painted fits and knows which faction this man belongs to; feature-
       detected so a page where outfits.js failed to load still fields men,
       and ?outfits=old returns the flat tint byte for byte. Passing
       side.band is what makes YOUR army read as yours: a null band means
       "my men", and outfits.js dresses them in whatever faction each was
       taken out of, with your own colour on their head. */
    const group = (W.outfits && W.outfits.cast)
      ? W.outfits.cast(s, side.band || null,
          { role: CAST_OF[T.cq] || "civilian", variant: i * 2 + side.vseed })
      : CBZ.studio.cast(CAST_OF[T.cq] || "civilian",
          { color: side.colour, variant: i * 2 + side.vseed });
    if (!group) return null;
    const at = spawnAt(sideKey, i);
    group.position.set(at.x, MAP.groundAt(at.x, at.z), at.z);
    group.rotation.y = side.dir < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(group);

    const m = {
      id: sideKey + i, s: s, side: side, team: sideKey, i: i,
      group: group, char: group.userData.charRig,
      pos: group.position,
      target: V(),
      yaw: group.rotation.y, speed: 0,
      /* THE ARMOUR IS A SOAK, NOT A HEALTH BAR. core states it as flat damage
         removed per hit, which is the only version that makes a plate rig feel
         like a plate rig: it stops a pistol outright and merely blunts a rifle.
         hp stays the tier's own number so a levy in plate is still a levy. */
      hp: s.hp > 0 ? s.hp : T.hp, maxHp: T.hp,
      soak: W.armour(s.armour).soak,
      slow: W.armour(s.armour).slow,
      wounded: !!s.wounded,
      armed: true, weapon: gunName(wid), wid: wid,
      launcher: !!(w && w.explosive),
      mag: w ? (w.magSize || w.mag || 30) : 30,
      magSize: w ? (w.magSize || w.mag || 30) : 30,
      cool: 0.4 + lcg() * 1.2, reloadT: 0,
      tgt: null, losBadT: 0, slot: "hold",
      thinkAt: simT + lcg() * 0.3, lastThink: simT,
      // `fall` is warlord/deaths.js's record of how this man is going down;
      // null while he is alive. It replaced dieT/dieDir, which were a fold
      // timer and a COIN FLIP for which way he tipped.
      dead: false, fall: null, animF: (i % 4),
      lastShotT: -9, sq: Math.floor(i / 10), sqSlot: i % 10,
      kills: 0, rad: 0.45, eyeH: 1.52, losY: 1.35, aimY: 1.28, headY: 1.62,
      // the STANDING originals, so setStance() can restore them exactly
      eyeH0: 1.52, losY0: 1.35, aimY0: 1.28, headY0: 1.62,
      stance: "stand",
      // the hull-down position he has committed to, and the pop-up clock
      hull: null, hullT: 0, popT: 0,
      routed: false, fled: false,
      /* IS THIS MAN CURRENTLY A FORMATION SLOT RATHER THAN AN INDIVIDUAL.
         stepSquad owns this flag; frame() skips stepMan for anyone carrying
         it. Nothing else in the file reads it, so a man handed back is
         indistinguishable from a man who was never in a squad. */
      formed: false,
      // where seatMan last put his rig — see THE BOOTS
      seatX: null, seatZ: null, seatYaw: null,
    };
    m.target.set(at.x, 0, at.z);
    /* THE TIER TAGS combat_iq's roleTier() ALREADY READS. core's TIERS[].cq
       names the row, and these are the exact fields battle.html sets — no new
       tag, no fork of the brain's classifier. */
    const cq = T.cq;
    if (cq === "soldier") m.kind = "soldier";
    else if (cq === "guard") m.kind = "guard";
    else if (cq === "thug") m.aggr = 0.92;
    // a wounded man fights at 60%: core's own number, applied where it lands
    if (m.wounded) m.hp = Math.max(1, Math.round(m.hp * 0.6));
    if (CBZ.syncActorWeapon) safe(function () { CBZ.syncActorWeapon(m); });
    /* AND HE JOINS A SECTION. `m.sq` was already here and was already
       (i / 10) | 0; what is new is that side.squads[m.sq] is now a UNIT rather
       than a bare array of ten men. See THE SQUAD. */
    joinSquad(side, m);
    return m;
  }

  /* ============================================================ YOU
     THE WARLORD IS AN ACTOR IN THE SAME ROSTER, deliberately: the grid finds
     him, combat_iq targets him, morale reads whether he is standing. What he
     is NOT is a thing stepMan drives — his goal comes from a thumb. */
  function makeYou() {
    const you = W.state.you;
    const s = SIDES.mine;
    const at = { x: MAP.cx + s.dir * (GAP() / 2 + 4), z: MAP.cz };
    const rig = CBZ.studio.cast("officer", { color: 0xffb347, variant: 1 });
    // the fit you chose in the wardrobe, on the man who walks into the fight
    if (rig && W.wardrobe && W.wardrobe.dressYou) W.wardrobe.dressYou(rig);
    if (rig) {
      rig.position.set(at.x, MAP.groundAt(at.x, at.z), at.z);
      scene.add(rig);
    }
    youRig = rig;
    const m = {
      id: "you", isYou: true, s: null, side: s, team: "mine", i: -1,
      group: rig, char: rig ? rig.userData.charRig : null,
      pos: rig ? rig.position : new THREE.Vector3(at.x, MAP.groundAt(at.x, at.z), at.z),
      target: V(), yaw: s.dir < 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, speed: 0,
      hp: you.hp, maxHp: you.maxHp, soak: W.armour(you.armour).soak,
      armed: true, weapon: gunName(you.wid), wid: you.wid,
      /* NO mag / magSize / reloadT / cool. Those four were the fork's ammo
         model and they are the gun's business now: CBZ.fps holds the real
         magazine, the real reserve and the real reload clock, off the same
         weapon-data row. A dead field on the one record every other system
         reads is how a second ammo model gets re-grown. */
      kills: 0, dead: false, rad: 0.45, eyeH: 1.62, losY: 1.4, aimY: 1.3, headY: 1.68,
      routed: false, fled: false, slot: "fire", tgt: null,
      // roleTier: a warlord is a trained man. `swat` is the top row and would
      // read as a tactical unit; `kind:"soldier"` is the honest one.
      kind: "soldier",
    };
    m.target.copy(m.pos);
    /* AND HE CARRIES THE GUN HE IS CARRYING. Without this the third-person
       warlord walked into his own war empty-handed while every levy behind him
       held a rifle — the viewmodel is only ever visible in first person, so the
       hands have to be filled by the same call that fills everybody else's. */
    if (CBZ.syncActorWeapon) safe(function () { CBZ.syncActorWeapon(m); });
    return m;
  }

  /* ============================================================ THE GRID
     Target search over hundreds of men cannot be O(n^2): battle.html's uniform
     grid, queried in rings, ported whole. */
  const grid = new Map();
  let gridAt = -1;
  function gridKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  /* THE BUCKETS ARE EMPTIED, NOT THROWN AWAY. Both of this file's spatial
     hashes used to `clear()` the Map and allocate a fresh array for every
     occupied cell on every rebuild — the fine one runs up to three times per
     substep, so at 1 800 men that is on the order of five thousand array
     allocations a frame, every frame, all of them immediately garbage. The
     cells are the same cells; only their contents change. Keeping the arrays
     and truncating them makes the steady state allocation-free, and the Map
     itself is bounded by the battlefield (a 480 m field at 2.4 m cells is at
     most 40 000 keys, and only the ones men have actually stood in are ever
     created). purgeCells() drops the empties on a slow timer so a battle that
     sweeps across the whole field does not keep every cell it ever touched. */
  function bucket(map, k) {
    let a = map.get(k);
    if (!a) { a = []; map.set(k, a); }
    return a;
  }
  function clearArr(a) { a.length = 0; }
  function emptyAll(map) { map.forEach(clearArr); }
  let purgeAt = -1;
  const _drop = [];
  function purgeOne(map) {
    _drop.length = 0;
    map.forEach(function (a, k) { if (!a.length) _drop.push(k); });
    for (let i = 0; i < _drop.length; i++) map.delete(_drop[i]);
  }
  function purgeCells() {
    if (simT - purgeAt < 5) return;
    purgeAt = simT;
    purgeOne(grid);
    purgeOne(fine);
  }
  function rebuildGrid() {
    emptyAll(grid);
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.dead || m.fled) continue;
      bucket(grid, gridKey(Math.floor(m.pos.x / GRID_CELL), Math.floor(m.pos.z / GRID_CELL))).push(m);
    }
    gridAt = simT;
    purgeCells();
  }
  const _cand = [];
  function pickTarget(m, range) {
    const cx = Math.floor(m.pos.x / GRID_CELL), cz = Math.floor(m.pos.z / GRID_CELL);
    const maxR = Math.ceil(range / GRID_CELL);
    _cand.length = 0;
    for (let r = 0; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const a = grid.get(gridKey(cx + dx, cz + dz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const o = a[i];
          if (o.team === m.team || o.dead || o.fled) continue;
          const d2 = (o.pos.x - m.pos.x) * (o.pos.x - m.pos.x) + (o.pos.z - m.pos.z) * (o.pos.z - m.pos.z);
          if (d2 < range * range) _cand.push(o, d2);
        }
      }
      if (_cand.length >= 12 && r > 1) break;
    }
    if (!_cand.length) return null;
    let bestO = null, bestD = 1e18;
    for (let i = 0; i < _cand.length; i += 2) if (_cand[i + 1] < bestD) { bestD = _cand[i + 1]; bestO = _cand[i]; }
    let tries = 0;
    while (tries < 4) {
      let o = null, od = 1e18, oi = -1;
      for (let i = 0; i < _cand.length; i += 2) {
        if (_cand[i] && _cand[i + 1] < od) { od = _cand[i + 1]; o = _cand[i]; oi = i; }
      }
      if (!o) break;
      _cand[oi] = null; tries++;
      if (eyeLos(m, o)) return o;
    }
    return bestO;
  }

  /* BODIES. battle.html's second grid, at body scale, because the target grid's
     14 m cell can only ever be wrong about a 0.9 m clearance. Its note is worth
     keeping: one sweep is not a solver, so it sweeps until nothing moves. */
  const FINE = 2.4, SEP = 0.9;
  const fine = new Map();
  const FAN = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  let sepFixed = 0;
  function rebuildFine() {
    emptyAll(fine);
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.dead || m.fled) continue;
      bucket(fine, gridKey(Math.floor(m.pos.x / FINE), Math.floor(m.pos.z / FINE))).push(m);
    }
  }
  function push2(m, o, k) {
    if (o.dead || o === m || o.fled) return;
    // two men in the same formation are two metres apart by construction
    if (m.formed && o.formed) return;
    const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > SEP * SEP) return;
    let d = Math.sqrt(d2), ux, uz;
    if (d < 1e-4) {
      const a = ((m.i * 37 + o.i * 91) % 360) * Math.PI / 180;
      ux = Math.cos(a); uz = Math.sin(a); d = 1e-4;
    } else { ux = dx / d; uz = dz / d; }
    const push = (SEP - d) * 0.5 * (d < SEP * 0.69 ? 1 : k);
    if (!m.isYou && !m.formed) { m.pos.x -= ux * push; m.pos.z -= uz * push; }
    if (!o.isYou && !o.formed) { o.pos.x += ux * push; o.pos.z += uz * push; }
    sepFixed++;
    m.resT = 0; o.resT = 0;
  }
  /* A FORMATION IS NOT A CROWD, AND THE SOLVER IS WHERE THAT BECOMES TRUE.
     A man standing in a squad slot is where his section put him: his
     neighbours are FILE_W apart by construction, so testing him against them
     can only ever find nothing, and letting the solver PUSH him would undo the
     formation one nudge at a time — which is exactly what used to happen and
     why a formed advance turned into a clump inside twenty metres. So formed
     men are skipped as the DRIVER and are never moved, but they stay in the
     grid as neighbours: a routing man running back through a reserve section
     is pushed around it rather than through it.

     The men actually fighting are the only ones the solver spends time on,
     which at 900 a side is a small fraction of the roster while the armies are
     closing and the whole roster once the lines meet — exactly the shape this
     cost should have had all along. */
  function separatePass(k) {
    sepFixed = 0;
    fine.forEach(function (a) {
      for (let i = 0; i < a.length; i++) {
        const m = a[i];
        if (m.dead || m.formed) continue;
        for (let j = i + 1; j < a.length; j++) push2(m, a[j], k);
        const cx = Math.floor(m.pos.x / FINE), cz = Math.floor(m.pos.z / FINE);
        for (let f = 0; f < 4; f++) {
          const b = fine.get(gridKey(cx + FAN[f][0], cz + FAN[f][1]));
          if (!b) continue;
          for (let j = 0; j < b.length; j++) push2(m, b[j], k);
        }
      }
    });
    return sepFixed;
  }
  function separateSolve(k) {
    if (!separatePass(k)) return;
    for (let it = 0; it < 2; it++) { rebuildFine(); if (!separatePass(k)) return; }
  }
  const _fine1 = [];
  function fineNear(x, z, r, out) {
    out = out || _fine1;
    out.length = 0;
    const x0 = Math.floor((x - r) / FINE), x1 = Math.floor((x + r) / FINE);
    const z0 = Math.floor((z - r) / FINE), z1 = Math.floor((z + r) / FINE);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = fine.get(gridKey(cx, cz));
      if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
    }
    return out;
  }

  /* ============================================================ SIGHT */
  /* A SIGHT LINE IS SAMPLED AT THE GROUND'S OWN RESOLUTION AND NOT FINER.
     The old march was every 3 m, which was a guess. The ground under it is now
     a lattice at FIELD_STEP (2.69 m) read bilinearly, and a bilinear read is
     LINEAR along any straight segment inside one cell — so a sample taken
     between two lattice crossings can only ever return a value already implied
     by its neighbours. Marching finer than the lattice is arithmetic that
     cannot change the answer. Under ?field=old the source is the analytic
     surface again and the same step is simply the old one to within 10%. */
  function terrainBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 8) return false;
    const gAt = MAP.groundAt;
    const dy = by - ay, n = Math.ceil(d / FIELD_STEP);
    pHit("terrainSamples", n);
    for (let i = 1; i < n; i++) {
      const t = i / n, at = t * d;
      if (at < 2 || d - at < 2) continue;
      if (gAt(ax + dx * t, az + dz * t) > ay + dy * t + 0.35) return true;
    }
    return false;
  }
  /* ============================================================ HULL DOWN
     THE DUNE IS THE COVER. This is the whole of what the owner asked for:
     "desert is great but fake rocks fuck, there is already cover from the
     natural steepness of the desert dunes."

     WHY THERE WERE ROCKS AT ALL. systems/combat_iq.js's cover() is the only
     cover search in this engine, and it can only see BOXES — it scans
     queryCollidersNear for a solid thing at least 0.85 m tall and puts the man
     on the far side of it. A dune is not a box. So on open ground the search
     came back empty, every man stood upright in the open, and desert.js
     answered by scattering boulders across biomes that have none. The fake
     rocks were a workaround for a search that could not see the ground.

     WHAT A REVERSE-SLOPE POSITION ACTUALLY IS. A soldier on the back side of a
     crest, close enough to the top that standing up puts his head and his
     rifle over it, and low enough that crouching puts the whole of him behind
     it. Two probes at two heights, on the same sight line, is the entire test:

       CROUCHED (eye 1.0 m)  the ground must BLOCK the threat's view of him.
       STANDING (eye 1.6 m)  the ground must NOT block it — otherwise he is
                             not in cover, he is in a hole with no shot out.

     Both probes go through terrainBlocked(), the same sampler eyeLos() already
     uses, so a position is hull-down by exactly the rule that decides whether
     a round connects. Nothing new can disagree with it.

     THE SEARCH is a ring fan around the man: four radii from 4 to 15 m and
     twelve bearings, biased toward the ones that do not walk him at the enemy.
     Candidates must be walkable (blockedAt) and on the field. Scoring is walk
     distance plus a penalty for closing on the threat — the same shape
     combat_iq.cover() scores with, for the same reason.

     HYSTERESIS. A man keeps the fold he chose unless a much better one turns
     up (combat_iq.cover()'s "-4" sticky rule, same idea): re-probing every
     think and taking the current best made a line shuffle sideways forever.
     The probe is throttled per man on a de-synced clock so 300 men do not all
     search the terrain on the same frame.

     COST. Each candidate is two terrainBlocked calls, each of which samples
     the height lattice every FIELD_STEP (2.69 m) along the line — about 12
     samples at 30 m. 48 candidates is ~1150 lattice reads, which is why it is
     throttled to roughly once every two seconds per man and why it early-outs
     on the first probe (a candidate that is not HIDDEN never pays for the
     second). MEASURED at 60 v 60 it costs under 0.2 ms a frame. */
  /* THE SEARCH IS A MARCH, NOT A GRID, and the first draft was a grid: four
     fixed radii on twelve bearings, 48 candidates, each tested for "crouched
     hidden AND standing exposed". It found a position ONCE IN 429 PROBES —
     measured, by tools/warlord-cover-check.mjs, which is why that tool exists.

     THE ARITHMETIC SAYS WHY. The two probes differ by 0.6 m of eye height at
     the man's end of a sight line 40 to 160 m long, so at the crest — which is
     somewhere in the middle of that line — the two rays are perhaps 0.3 m
     apart. A hull-down position is exactly the band of ground where the crest
     falls INSIDE that 0.3 m window. On a dune of 200 m wavelength and 0.15
     slope that band is about four metres wide, and a grid of four radii spaced
     3.5 m apart lands in a 4 m band roughly at random. The position was always
     there; the search was throwing darts at it.

     SO THE SEARCH FINDS THE LIP INSTEAD OF GUESSING AT IT. Per bearing:
     march outward until the CROUCHED ray first goes blocked (that step is
     cheap and fails fast in the open), bisect the last interval to land on the
     lip within ~15 cm, then step just behind it and ask the standing question
     there. That is one boundary solve per bearing rather than a scatter, and
     it lands in the band by construction. */
  /* 26 m, NOT 16. A dune here has a wavelength in the hundreds of metres, so
     the walk from the open to the back of the nearest crest is tens of metres,
     not a stride. MEASURED by sweeping the island: over a 9-bearing fan out to
     40 m, 159 of 345 dune fields hold a real reverse-slope position, and the
     ones inside 16 m are a minority of those. 26 m is about five seconds of
     walking, which is what a man will spend to stop being shot at. */
  const HULL_BEARINGS = [0, 0.55, -0.55, 1.15, -1.15, 1.8, -1.8, 2.5, -2.5];
  const HULL_R0 = 3, HULL_R1 = 26, HULL_STEP = 1.6;
  const HULL_CROUCH_EYE = 1.0;      // a crouched man's eye, metres above his boots
  const HULL_STAND_EYE = 1.6;       // and a standing one's
  const HULL_BEHIND = 0.7;          // how far behind the lip to stand
  let _hullQ = 0, _hullHit = 0;
  /* PUBLIC because tools/warlord-cover-check.mjs asks the question the AI asks,
     rather than re-deriving the terrain rule in node and grading the game
     against a second implementation of it. */
  function hullDown(x, z, tx, tz, r) {
    if (!MAP || !MAP.folded) return null;       // flat ground has no reverse slope
    _hullQ++;
    const gA = MAP.groundAt;
    const ty = gA(tx, tz) + HULL_STAND_EYE;     // the threat is a standing rifleman
    const away = Math.atan2(x - tx, z - tz);    // bearing from the threat to the man
    const rr = r > 0 ? r : 1;
    const dThreat = Math.hypot(x - tx, z - tz);
    let best = null, bs = 1e9;
    for (let ai = 0; ai < HULL_BEARINGS.length; ai++) {
      const ang = away + HULL_BEARINGS[ai];
      const sa = Math.sin(ang), ca = Math.cos(ang);
      // ---- hidden(rad): is a CROUCHED man at this radius behind the ground?
      const hidden = function (rad) {
        const px = x + sa * rad, pz = z + ca * rad;
        return terrainBlocked(tx, ty, tz, px, gA(px, pz) + HULL_CROUCH_EYE, pz);
      };
      // march out to the first blocked step
      let lo = -1, hi = -1;
      for (let rad = HULL_R0 * rr; rad <= HULL_R1 * rr; rad += HULL_STEP * rr) {
        if (hidden(rad)) { hi = rad; break; }
        lo = rad;
      }
      if (hi < 0) continue;                     // this bearing never gets behind anything
      if (lo < 0) lo = Math.max(0.5, hi - HULL_STEP * rr);
      // bisect onto the lip (4 halvings of a 1.3 m step ≈ 8 cm)
      for (let k = 0; k < 4; k++) {
        const mid = (lo + hi) * 0.5;
        if (hidden(mid)) hi = mid; else lo = mid;
      }
      // stand just behind it, and ask the standing question there
      for (let back = 0; back < 3; back++) {
        const rad = hi + HULL_BEHIND * (back ? back * 0.5 : 1);
        if (rad > (HULL_R1 + 2) * rr) break;
        const px = x + sa * rad, pz = z + ca * rad;
        if (Math.abs(px - MAP.cx) > FIELD_R * 0.94 || Math.abs(pz - MAP.cz) > FIELD_R * 0.94) break;
        if (blockedAt(px, pz)) continue;        // a walk that ends inside a rock is not a position
        const gy = gA(px, pz);
        if (!terrainBlocked(tx, ty, tz, px, gy + HULL_CROUCH_EYE, pz)) continue;
        // STANDING must NOT be blocked. A fold that hides him standing is a
        // hole with no shot out of it, and men in holes lose battles.
        if (terrainBlocked(tx, ty, tz, px, gy + HULL_STAND_EYE, pz)) continue;
        const walk = Math.hypot(px - x, pz - z);
        // never take a fold that walks him at the gun (cover()'s own rule)
        const closing = Math.max(0, dThreat - Math.hypot(px - tx, pz - tz));
        const score = walk + closing * 1.4 + Math.abs(HULL_BEARINGS[ai]) * 1.1;
        if (score < bs) { bs = score; best = { x: px, z: pz, d: walk }; }
        break;
      }
    }
    if (best) _hullHit++;
    return best;
  }
  /* The per-man wrapper: throttle, hysteresis, and "am I still standing in
     it". Everything above is a pure function of the ground so a tool can call
     it directly; this is the part that belongs to a person. */
  function hullFor(m, tgt, force) {
    if (!MAP.folded) return null;
    if (!force && m.hullT > simT) return m.hull;
    /* 2.6-3.5 s, phased off the man's index so a line does not probe together.
       A search is ~7 bearings x up to 15 marched crouch probes, each ~15 reads
       of the height lattice — call it 1.5k reads. At 300 men that is 130
       searches a second if they all probe at once, which is why the phase
       matters more than the period. */
    /* AND A MAN WITH NOWHERE TO GO KEEPS LOOKING. One period for everybody
       meant a man whose first probe came back empty stood in the open for
       three seconds before asking again, while a man already tucked behind a
       lip re-derived a position he was not going to leave. MEASURED: 57% of
       held men had found a fold; asking again in half the time when the answer
       was NO — and the ground under him has moved, because he has — lifts it
       without costing a single probe on a man who is already covered. */
    m.hullT = simT + (m.hull ? 2.6 : 1.2) + (m.i % 9) * 0.1;
    const found = hullDown(m.pos.x, m.pos.z, tgt.pos.x, tgt.pos.z, 1);
    if (!found) { m.hull = null; return null; }
    /* STICKY. The fold he is already using outbids a marginally nearer one by
       3 m of walk — without it a held line re-picked every two seconds and
       shuffled sideways all fight. */
    if (m.hull) {
      const keep = Math.hypot(m.hull.x - m.pos.x, m.hull.z - m.pos.z);
      if (keep < found.d + 3) return m.hull;
    }
    m.hull = found;
    return found;
  }
  /* IN IT, AND WORKING IT. A man who has ARRIVED at his fold alternates: down
     behind the lip where the ground genuinely hides him (setStance drops his
     losY, so an enemy's eyeLos to him fails and he cannot be targeted or hit),
     then up over it to shoot. The cycle is a real one — about a second and a
     half down, a second and a bit up — and it is what a firing line on a
     reverse slope looks like from the other side: men appearing and going.

     Returns true while he is UP, which is the only time the trigger below
     lets him fire. */
  function workHull(m, sdt) {
    /* 3.2 m, NOT the 1.6 the first draft used. Two things move a man off the
       exact point the search returned: spreadGoal() pushes his goal up to
       2.6 m sideways to keep the line from stacking, and stepMan stops him
       within 1.1 m of that goal. At 1.6 m he never counted as arrived, never
       crouched, and the whole fold did nothing — MEASURED as zero men in
       crouch on a field where 40 of them had found one. A fold is a stretch of
       ground, not a coordinate. */
    const d = Math.hypot(m.hull.x - m.pos.x, m.hull.z - m.pos.z);
    if (d > 3.2) { setStance(m, "stand"); return false; }   // still walking to it
    m.popT -= sdt;
    if (m.popT <= 0) {
      const up = m.stance === "crouch";
      // de-synced per man so a line does not pop as one body
      m.popT = up ? (1.0 + (m.i % 7) * 0.12) : (1.4 + (m.i % 5) * 0.18);
      setStance(m, up ? "stand" : "crouch");
    }
    return m.stance === "stand";
  }

  /* ============================================================ STANCE
     A MAN IS A DIFFERENT SHAPE WHEN HE IS DOWN, and until now nobody in this
     battle was ever down. posePass has been setting `m.char.crouch` for men in
     cover since the file was written — so a man in cover LOOKED small and was
     shot at exactly as if he were standing, because eyeH / losY / aimY / headY
     were constants stamped once in makeMan.

     These four numbers ARE the man as far as the fight is concerned: eyeH is
     where he sees from, losY is what an enemy has to see to shoot him, aimY
     and headY are where a round arrives. Dropping them by the real ratio of a
     crouched man's eye to a standing one's (about 1.0 m against 1.6 m, which
     is where the hull-down search below puts its two probes) is what makes
     going down actually hide you behind a dune lip.

     One function, called whenever the stance changes, so the four can never
     drift apart. `stand` restores makeMan's own numbers exactly. */
  const STANCE_K = { stand: 1, crouch: 0.645 };
  function setStance(m, st) {
    if (m.stance === st) return;
    m.stance = st;
    const k = STANCE_K[st] || 1;
    m.eyeH = m.eyeH0 * k;
    m.losY = m.losY0 * k;
    m.aimY = m.aimY0 * k;
    m.headY = m.headY0 * k;
  }

  function eyeLos(m, o) {
    pHit("eyeLos");
    const ay = m.pos.y + m.eyeH, by = o.pos.y + o.losY;
    if (micro.segmentBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z)) return false;
    return !(MAP.terrainLos && terrainBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z));
  }
  function mateInLane(m, tgt) {
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    const nx = dx / d, nz = dz / d, reach = Math.min(d - 0.6, 12);
    if (reach <= 1) return 0;
    const a = fineNear(m.pos.x + nx * reach * 0.5, m.pos.z + nz * reach * 0.5, reach * 0.5 + 1.2);
    let worst = 0, worstOff = 9;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o === m || o.dead || o.team !== m.team) continue;
      const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
      const along = ox * nx + oz * nz;
      if (along < 0.8 || along > reach) continue;
      const off = ox * nz - oz * nx;
      if (Math.abs(off) < 0.62 && Math.abs(off) < worstOff) {
        worstOff = Math.abs(off);
        worst = off >= 0 ? 1 : -1;
      }
    }
    return worst;
  }

  /* ============================================================ MORALE
     THE ONE MECHANIC THIS FILE ADDS TO THE DONOR, AND THE REASON THE CAMPAIGN
     WORKS AT ALL.

     An army that fights to the last man makes head count the only variable:
     forty levies with pistols beat fifteen veterans with rifles as long as the
     arithmetic works out, and then "who gets the good rifle" is a menu with no
     consequence. Morale inverts that, and it does it without a single typed
     balance scalar — both halves are read off tables that already exist:

     HOW MUCH AN ARMY HAS LOST is a POWER fraction, not a head count:
     1 - power(standing)/power(started), using core's own W.power(). That is
     already weighted by tier, gun, armour and wounds, so losing your four
     veterans hurts your morale roughly four times as much as losing four
     levies — which is the brief's "has lost a third of its men AND its best
     soldiers" without a second term to tune.

     WHEN A MAN BREAKS is combat_iq's own nerve column. ROLE[cq].nerve is
     already "the hp fraction at which this person breaks for cover" — the
     file's own measure of how much fight is in a man — and core's TIERS[].cq
     already names each tier's row. So: civ 0.62, thug 0.42, guard 0.30,
     soldier 0.20. A levy breaks when the army's morale falls under 0.62 and a
     veteran holds to 0.20, from two tables, neither of them written here.

     AND THE WARLORD IN THE LINE HOLDS IT TOGETHER. You alive and near the
     fighting is worth +0.16; you down is worth -0.30, which on top of losing
     the battle outright is the reason standing at the back is not free.

     ?morale=old removes the whole thing — no break point, no rout, no morale
     end condition — which is battle.html's behaviour exactly, and is the
     honest before side for photographing what it buys. */
  const MORALE_OFF = function () { return Q && Q.get("morale") === "old"; };
  const NERVE_FALLBACK = { civ: 0.62, thug: 0.42, guard: 0.30, soldier: 0.20 };
  function nerveOf(m) { return nerveFor(m.s ? W.tier(m.s.tier).cq : "soldier"); }
  function standing(side) {
    const out = [];
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.team === side.key && !m.dead && !m.fled && !m.isYou) out.push(m.s);
    }
    return out;
  }
  function updateMorale() {
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k], foe = SIDES[k === "mine" ? "them" : "mine"];
      s.alive = 0; s.routing = 0;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.team !== k || m.dead || m.fled || m.isYou) continue;
        s.alive++;
        if (m.routed) s.routing++;
      }
      s.powerNow = W.power(standing(s));
      /* AND THE WARLORD COUNTS ON BOTH SIDES OF THE FRACTION. power0 has
         included his 14 since start() — he is worth about a dozen men and the
         encounter card says so — but powerNow was built from the ROSTER alone,
         so your army began every battle with `lost` already at 14/power0 and
         carried that phantom casualty to the end. Small (0.07 of morale on a
         34-man force) and entirely one-sided, which is the worst kind: your
         side broke first in every run of the storyboard and the cause was an
         asymmetry in a fraction rather than anything on the field. */
      if (k === "mine" && !YOU.dead) s.powerNow += 14;
    });
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k], foe = SIDES[k === "mine" ? "them" : "mine"];
      if (MORALE_OFF()) { s.morale = 1; return; }
      s.morale = moraleFrom({
        lost: 1 - s.powerNow / Math.max(0.001, s.power0),
        theirLost: 1 - foe.powerNow / Math.max(0.001, foe.power0),
        leader: k === "mine",
        leaderDown: YOU.dead,
        leaderNear: !YOU.dead && Math.hypot(YOU.pos.x - s.comX, YOU.pos.z - s.comZ) < 55,
        malus: s.moraleMalus || 0,
        routingFrac: s.routing / Math.max(1, s.alive),
      });
      /* THE BUS, ON THE TICK THAT ALREADY DID THE ARITHMETIC. warlord/feel.js
         has carried listeners for battle:morale and battle:rout since the day
         it was written, under a comment saying battle.js emits neither and
         that updateMorale() is polled through audit() until they exist. It
         does not have to any more. Emitted only when the number MOVED past a
         hundredth: a morale event every half second in both directions is a
         listener being asked to filter, and the file that already holds the
         previous value is the one that should do it. */
      const prevMo = s._moEmit;
      if (prevMo == null || Math.abs(prevMo - s.morale) >= 0.01) {
        s._moEmit = s.morale;
        if (W.emit) W.emit("battle:morale", { side: k, morale: s.morale, routing: s.routing });
      }
      /* AND ONCE, THE FRAME A SIDE COMES APART. brokenSide() is checkEnd()'s
         own rule, so the shout and the ending cannot disagree about when an
         army broke. Latched, or a routing army shouts twice a second for the
         rest of the fight. */
      if (!s._routEmit && brokenSide(s, report.fledOf[k].length)) {
        s._routEmit = true;
        if (W.emit) W.emit("battle:rout", { side: k });
      }
    });
  }
  function stepRout(m) {
    if (MORALE_OFF() || m.isYou || (m.side && m.side.noRout)) return false;
    const nerve = nerveOf(m);
    if (!m.routed) {
      if (m.side.morale < nerve) {
        m.routed = true;
        m.side.brokeN = (m.side.brokeN || 0) + 1;
        /* "HAKIM BREAKS" was the same mistake as "HAKIM DOWN": a name you have
           not learned, and no answer to the only question that matters, which
           is which part of your line is coming apart. An AMBER tick on the rim
           at his bearing — thinner than a death's red one, because a man
           running is not a man dead and the two must not read alike. This also
           fires battle:break, which warlord/feel.js has had a listener for
           since the day it was written and has never once received. */
        const D = DTH(); if (D) D.broke(m);
      }
    } else if (m.side.morale > nerve + 0.14) {
      // RALLY, with hysteresis: an army that steadies gets its men back, and
      // without the band the whole line would flicker at the threshold.
      m.routed = false;
    }
    return m.routed;
  }

  /* ============================================================ ONE MODEL,
     TWO PRESENTATIONS — the fast resolution, and why it is not a second game.

     THE REQUIREMENT (owner, through the orchestrator): "it's almost like
     openfront.io met Bannerlord once it's multiplayer" — and in a multiplayer
     campaign the shared clock never stops. Seven other warlords are riding
     while you fight, so a battle cannot be allowed to own the world. Three
     things have to exist: a fight that resolves WITHOUT rendering (a player
     skipped it, a player dropped, the AI is fighting the AI, the match cannot
     wait), a hard ceiling on the 3D one so it cannot run forever, and — the
     part that actually matters — a guarantee that the two agree.

     SO THERE IS EXACTLY ONE MODEL. What follows is the attrition tick, and it
     is the arithmetic the 3D battle is already doing, with the geometry taken
     out:

       · the DPS is combat_iq's OWN ladder. profile() gives dps, hit10 and
         secPerRound for a man's role×weapon, so rounds-per-second and
         damage-per-round are read off the same table that decides every
         trigger pull on the sand. Not a parallel stat block — the same one.
       · every round lands through hurtOne(), which is the soak formula
         hurtMan() uses, term for term.
       · morale is moraleFrom(), the same pure function updateMorale() calls.
       · a man breaks at combat_iq's ROLE[].nerve, the same nerveOf().
       · a side is finished at broken(), the same rule checkEnd() uses.

     WHAT THE GEOMETRY WAS WORTH is the one number that cannot come out of a
     table, because it is everything the sand does to a bullet: the walk into
     range, the crest in the way, the rock a man is behind, combat_iq's fire
     token holding all but two or three shooters off any one mark, the misses
     that spread with distance, the suppression. MEASURED against the 3D battle
     it is standing in for — see BATTLE-CHECK in the report — a 26 v 26 on real
     dunes killed ten men in 54 s against a raw ladder output of ~338 HP/s, and
     ENGAGE is that ratio. It is a measurement of this file against itself, and
     if the 3D fight is retuned this number is what has to be re-measured. */
  /* HOW HARD ARMY-ON-ARMY TRADES ARE, and it is the one dial that decides how
     long a battle lasts.

     battle.html multiplies every landed round by 1.45, with the note that
     combat_iq's ladder is authored for fights against the PLAYER and a page
     with no player does not need that fairness cap. This page HAS a player, so
     the multiplier applies army-on-army and NOT to rounds arriving at the
     warlord — against him the shipped ladder is exactly the balance it was
     measured as (see hurtMan).

     1.9, not 1.45, and the reason is a length target rather than a feel:
     "battles need to be SHORT — closer to 60-120 seconds of real decisions".
     MEASURED at 1.45: a 26 v 26 on real dunes took 54 s in the 3D fight and
     74 s resolved, and a 150 v 150 ran into the 150 s ceiling rather than
     ending on its own. At 1.9 the same fights land at roughly 40 s and 110 s,
     which puts every campaign-sized band inside the window and leaves the
     ceiling for genuine stalemates. Raising it does NOT make the player more
     fragile, because his rounds are the ones that skip the multiplier. */
  const ARMY_MUL = 1.9;
  const ENGAGE = 0.045;           // measured: see above
  const ROUT_ESCAPE = 22;         // seconds a routed man needs to reach the edge (FIELD_R*0.95 / 7.6)

  const _profCache = {};
  function profOf(u) {
    const key = (u.cq || "soldier") + "|" + u.wid;
    let p = _profCache[key];
    if (p) return p;
    const fake = { armed: true, weapon: gunName(u.wid), pos: { x: 0, z: 0 } };
    if (u.cq === "soldier") fake.kind = "soldier";
    else if (u.cq === "guard") fake.kind = "guard";
    else if (u.cq === "thug") fake.aggr = 0.92;
    p = (CBZ.combatIQ && CBZ.combatIQ.profile) ? CBZ.combatIQ.profile(fake) : null;
    if (!p) p = { dps: 8, hit10: 0.5, secPerRound: 0.5 };
    _profCache[key] = p;
    return p;
  }
  /* THE SOAK FORMULA, LIFTED OUT SO BOTH PATHS CALL THE SAME ONE. hurtMan is
     the 3D version and it now delegates here; a second copy of this expression
     is exactly how a plate rig starts meaning two different things. */
  /* ...AND THE FLOOR IS A THIRD, NOT A SEVENTH.

     core states armour as flat damage removed per hit, which is the right model
     — it is what makes a plate rig stop a pistol outright and merely blunt a
     rifle. But the FLOOR under it decides whether "blunt" means anything. At
     0.15 a plate rig (soak 20) against a combat_iq rifle round (~22 after the
     army multiplier) left 3.4 damage: thirty rounds to kill a soldier, i.e. a
     man nothing on the field could reliably hurt. MEASURED on the second
     before/after pair — the enemy band, whose makeBand roster puts about one in
     five in armour, out-traded a bare-shirted army five to one and won every
     run of the storyboard.

     At 0.35 a pistol round (~9) still lands as 3 against plate, which is
     "stops a pistol, mostly" exactly as core's own row says, and a rifle round
     lands as 7.7 — blunted to a third, not to nothing. The row keeps its
     meaning; the fight keeps ending. */
  function hurtOne(u, dmg) {
    const after = Math.max(dmg * 0.35, dmg - (u.soak || 0));
    u.hp -= after;
    return after;
  }

  /* THE PURE MORALE FUNCTION. Both updateMorale() (on the sand) and the
     attrition tick (headless) call it, so an army cannot break at a different
     moment depending on whether anybody was watching. */
  function moraleFrom(o) {
    let mo = 1 - o.lost * 1.6 + o.theirLost * 0.55;
    if (o.leader) mo += o.leaderDown ? -0.30 : (o.leaderNear ? 0.16 : 0);
    mo -= o.malus || 0;
    mo -= clamp(o.routingFrac, 0, 1) * 0.25;   // men watch men run
    return clamp(mo, 0, 1);
  }

  /* THE TICK. One second of battle, no rendering, no geometry. It mutates the
     unit records in place — which is why the 3D battle can hand it its OWN
     live bodies when the clock runs out and simply carry on. */
  function attritionTick(units, sides, ctxR, dt) {
    /* THE FRACTIONAL ROUND CARRIES OVER. A 26-man line puts out about 2.3
       rounds a second at this engagement rate, and flooring that every tick
       throws away a third of the fire — a systematic 15% under-count that
       would make the fast path quietly gentler than the fight it stands in
       for. The remainder lives on the report, so it survives the tick. */
    const acc = ctxR._acc || (ctxR._acc = { mine: 0, them: 0 });
    for (const k in sides) {
      const s = sides[k];
      s.alive = 0; s.routing = 0; s.out = 0; s.roundDmg = 0; s.powerNow = 0;
      const standing = [];
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.team !== k || u.dead || u.fled || u.isYou) continue;
        s.alive++;
        /* POWER FIRST, AND A ROUTED MAN STILL HAS IT. This line used to sit
           below the `continue`, so a man who broke stopped counting toward his
           own side's strength — and morale is 1 - powerNow/power0, so one man
           routing lowered the morale that made him rout. A death spiral with
           no death in it: the FIRST man to break took the next four with him.
           updateMorale() on the 3D side has never had this bug, because
           standing() there filters on !dead && !fled and says nothing about
           routed. Two paths, one rule, and this was the divergence. */
        if (u.s) s.powerNow += W.soldierPower(u.s);
        if (u.routed) { s.routing++; continue; }
        standing.push(u);
        const p = profOf(u);
        const rounds = (p.hit10 / Math.max(0.05, p.secPerRound)) * ENGAGE;
        const per = (p.dps * p.secPerRound / Math.max(0.05, p.hit10)) * ARMY_MUL *
          (u.wounded ? 0.6 : 1);
        s.out += rounds;
        s.roundDmg += rounds * per;
      }
      s.standing = standing;
      s.nStanding = standing.length;
      s.perRound = s.out > 0 ? s.roundDmg / s.out : 0;
      /* AND THE WARLORD COUNTS ON BOTH SIDES OF THE FRACTION — updateMorale()'s
         own comment, and its own fix, which the headless path never got.
         power0 for `mine` is W.power(roster) + 14 (he is worth about a dozen
         men and the encounter card says so), so a powerNow built from the
         ROSTER ALONE starts every resolved battle with `lost` already at
         14/power0 and carries a phantom casualty to the end. MEASURED on a
         20-levy line: a permanent 0.26 of `lost`, which is 0.42 of morale, and
         on any roster poorer than sidearms it put the whole line under the
         civ nerve of 0.62 on TICK ONE — every man routed at t=1 and
         brokenSide() ended the fight at t=2 with nobody dead. That is the
         "resolve() ends on tick 2" report, and it is this one line. */
      if (k === "mine" && ctxR.you && !ctxR.you.dead && !ctxR.youSafe) s.powerNow += 14;
    }
    /* THE WARLORD SHOOTS TOO, AND HIS ROUNDS ARE ROUNDS — not a bonus on
       everybody else's.

       The first draft added his whole output to the side's roundDmg and ONE to
       its round count, which is a category error: perRound is the mean damage
       of a round and every round the army fires is then dealt at that mean. A
       26-man line puts out about 2.3 rounds a second, so folding a player's
       ~130 HP/s into that average multiplied EVERY rifle round by roughly
       forty. MEASURED: a 26 v 26 resolved in six seconds with the enemy wiped
       and not one friendly casualty, and an 8 v 26 won clean. It read as a
       balance problem and it was an arithmetic one.

       So he contributes a round STREAM at his own rate: three times an engaged
       rifleman's, because he picks his moments and nobody is holding a fire
       token over him, carrying his weapon's own damage at the 0.55 the 3D path
       applies to a player trigger pull. That works out at five or six riflemen
       of output, which is the same neighbourhood core's yourPower() puts him
       in. */
    /* AND HIS RATE IS DERIVED, NOT TYPED. The line here used to read

           const rounds = 2.0 * ENGAGE * 3;

       under a comment saying "three times an engaged rifleman's". It is not:
       an engaged rifleman's rate in this very function is
       (hit10 / secPerRound) * ENGAGE, which for a levy with a pistol is 0.0116
       rounds a second. 2.0 * ENGAGE * 3 is 0.27 — twenty-three times a
       rifleman, so the warlord out-shot his entire twenty-man army and a
       20 v 20 was really a 43 v 20. MEASURED: an EVEN levy fight resolved as a
       win 86% of the time with 0-1 friendly casualties against 7-8 enemy.

       What he is worth is not a number this file gets to invent — core states
       it, in the same currency the encounter card uses: W.yourPower() against
       a soldier's W.soldierPower(). So his damage stream is that many men's
       worth of the output the side is ALREADY producing, and his round count
       is that damage divided by what one of his rounds does.

       AND IT IS ITS OWN STREAM, NOT AN ADDITION TO THE MEAN. The old code
       pushed his rounds into s.out and his damage into s.roundDmg and then
       re-derived perRound — which is the mean damage of a round, dealt to
       EVERY round the army fires. A player carrying a shotgun therefore made
       every levy's pistol round hit like a shotgun, and a player carrying a
       pistol nerfed his whole line's rifles. He fires his own rounds now, at
       his own damage, into the same pool. */
    const you = ctxR.you;
    const mineS = sides.mine;
    mineS.youOut = 0; mineS.youPer = 0;
    if (you && !you.dead && !ctxR.youSafe && mineS.nStanding > 0 && mineS.out > 0) {
      const w = CBZ.weaponById ? CBZ.weaponById(you.wid) : null;
      // 0.55 is the same factor the 3D path applies to a player trigger pull
      const per = ((w && w.damage) || 24) * ((w && w.pellets) || 1) * 0.55;
      /* HIS OWN WORTH, NOT HIS FORCE'S. W.yourPower() is
         `W.power(S.army) + 14 * gunCombat * armour` — the strength of the
         WHOLE COLUMN, which is what the encounter card compares against a
         band. Reading it as "what is the warlord worth" makes him worth his
         own army plus himself: MEASURED, an even 20 v 20 resolved as a 100%
         win with ZERO friendly casualties, and it got worse the bigger your
         army was, which is the tell. Subtracting the roster leaves exactly
         core's own second term — his gun and his plate — without re-typing the
         expression here, so a change to core moves this with it. */
      const manPower = Math.max(0.001, (mineS.powerNow - 14) / mineS.nStanding);
      const solo = Math.max(1, (W.yourPower ? W.yourPower() : 14) -
        W.power((W.state && W.state.army) || []));
      const worthMen = Math.max(1, solo / manPower);
      const manOut = mineS.roundDmg / mineS.nStanding;      // HP/s from one man
      mineS.youPer = per;
      mineS.youOut = (worthMen * manOut) / Math.max(1, per);
    }

    // ---- deal it, one round at a time, through the same soak
    for (const k in sides) {
      const s = sides[k], foe = sides[k === "mine" ? "them" : "mine"];
      const pool = foe.standing.concat(
        foe.routing ? units.filter(function (u) {
          return u.team === foe.key && u.routed && !u.dead && !u.fled;
        }) : []);
      if (!pool.length || s.perRound <= 0) continue;
      acc[k] = (acc[k] || 0) + s.out * dt;
      let n = Math.floor(acc[k]);
      acc[k] -= n;
      /* the warlord's own rounds, on their own accumulator and at their own
         damage — see the derivation above. He only ever exists on `mine`. */
      acc.you = (acc.you || 0) + (k === "mine" ? (s.youOut || 0) * dt : 0);
      let nYou = Math.floor(acc.you);
      acc.you -= nYou;
      n += nYou;
      /* AND THE WARLORD IS IN THE POOL. He is standing in his own line — that
         is the whole pitch — so the enemy's rounds can find him at the rate
         one man in the line would expect. */
      const youIn = k === "them" && ctxR.you && !ctxR.you.dead && !ctxR.youSafe;
      while (n-- > 0) {
        const total = pool.length + (youIn ? 1 : 0);
        const pick = Math.floor(lcg() * total);
        const tgt = pick >= pool.length ? ctxR.you : pool[pick];
        if (!tgt || tgt.dead) continue;
        // the player does not eat the army-on-army multiplier — hurtMan's rule
        // his rounds are dealt first and carry HIS damage; the rest carry the
        // line's mean. The player still never eats the army multiplier.
        const dmg = (nYou-- > 0) ? s.youPer
          : (tgt === ctxR.you ? s.perRound / ARMY_MUL : s.perRound);
        hurtOne(tgt, dmg);
        if (tgt.hp <= 0) {
          tgt.dead = true; tgt.hp = 0;
          if (tgt === ctxR.you) { ctxR.youDown = true; continue; }
          const si = pool.indexOf(tgt);
          if (si >= 0) pool.splice(si, 1);
          sides[tgt.team].deadN++;
          if (tgt.s) ctxR.deadOf[tgt.team].push(tgt.s);
          if (!pool.length) break;
        }
      }
    }

    // ---- morale, on the same numbers, through the same function
    for (const k in sides) {
      const s = sides[k], foe = sides[k === "mine" ? "them" : "mine"];
      s.morale = MORALE_OFF() ? 1 : moraleFrom({
        lost: 1 - s.powerNow / Math.max(0.001, s.power0),
        theirLost: 1 - foe.powerNow / Math.max(0.001, foe.power0),
        leader: k === "mine" && !ctxR.youSafe,
        leaderDown: !!ctxR.youDown,
        // headless: a warlord who fights is IN it — but an AI-on-AI battle has
        // no warlord at all, and giving `mine` his +0.16 anyway is why two
        // identical bands resolved with one of them mysteriously steadier.
        leaderNear: !ctxR.youSafe,
        malus: s.moraleMalus || 0,
        routingFrac: s.routing / Math.max(1, s.alive),
      });
    }
    // ---- who breaks, and who gets away
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.fled || u.isYou) continue;
      const s = sides[u.team];
      if (!MORALE_OFF()) {
        const nerve = u.nerve;
        if (!u.routed && s.morale < nerve) { u.routed = true; s.brokeN = (s.brokeN || 0) + 1; }
        else if (u.routed && s.morale > nerve + 0.14) u.routed = false;
      }
      if (u.routed) {
        u.runT = (u.runT || 0) + dt;
        if (u.runT >= ROUT_ESCAPE) {
          u.fled = true;
          if (u.s) ctxR.fledOf[u.team].push(u.s);
        }
      } else u.runT = 0;
    }
  }

  /* ============================================================ RESOLVE
     THE SAME FIGHT, WITHOUT A CAMERA. Same rosters, same guns, same armour,
     same morale, same break points, same report shape — and it returns in one
     call, which is what lets a multiplayer campaign carry on while somebody
     skips a battle, drops, or lets two AI bands settle it between themselves.

     It does NOT touch the phase, the screen or the scene. `apply:true` hands
     the result to army.js's aftermath the way a real battle does; leaving it
     off returns the report and changes nothing, which is what a headless
     simulation of somebody else's fight wants. */
  function resolve(opts) {
    opts = opts || {};
    const b = opts.band || W.makeBand({ size: 12 });
    seedBattle((W.state.seed | 0) * 7919 + (W.state.day | 0) * 131 + (b.men.length | 0) +
      (opts.salt | 0));
    const cap = Math.max(1, parseInt((Q && Q.get("men")) || "", 10) || MEN_CAP_DEFAULT());
    const mineR = (opts.army || W.state.army).slice(0, cap);
    const themR = b.men.slice(0, cap);

    const mk = function (s, team) {
      const T = W.tier(s.tier);
      return {
        s: s, team: team, wid: s.wid || "sidearm", cq: T.cq,
        hp: (s.hp > 0 ? s.hp : T.hp) * (s.wounded ? 0.6 : 1),
        maxHp: T.hp, soak: W.armour(s.armour).soak, wounded: !!s.wounded,
        nerve: nerveFor(T.cq), dead: false, fled: false, routed: false, runT: 0,
      };
    };
    const units = [];
    for (let i = 0; i < mineR.length; i++) units.push(mk(mineR[i], "mine"));
    for (let i = 0; i < themR.length; i++) units.push(mk(themR[i], "them"));

    const you = { isYou: true, team: "mine", wid: W.state.you.wid,
      hp: W.state.you.hp, maxHp: W.state.you.maxHp,
      soak: W.armour(W.state.you.armour).soak, dead: false };

    const sides = {
      mine: sideRecord("mine", -1), them: sideRecord("them", 1),
    };
    sides.mine.power0 = W.power(mineR) + 14;
    sides.them.power0 = W.power(themR);
    sides.mine.moraleMalus = opts.surprised ? 0.2 : (opts.chased ? 0.1 : 0);
    sides.mine.men0 = mineR.slice();
    sides.them.men0 = themR.slice();

    const ctxR = {
      band: b, youKills: 0, headless: true, you: you,
      youSafe: !!opts.youSafe,      // an AI-vs-AI fight has no warlord in it
      ratio: sides.mine.power0 / Math.max(0.001, sides.them.power0),
      deadOf: { mine: [], them: [] }, fledOf: { mine: [], them: [] },
      reserveOf: { mine: (opts.army || W.state.army).slice(mineR.length),
                   them: b.men.slice(themR.length) },
    };

    const limit = opts.limit || BATTLE_MAX();
    let t = 0, outcome = null;
    while (t < limit) {
      attritionTick(units, sides, ctxR, 1);
      t++;
      if (ctxR.youDown && !ctxR.youSafe) { outcome = "lost"; break; }
      if (sides.them.alive === 0 || brokenSide(sides.them, ctxR.fledOf.them.length)) { outcome = "won"; break; }
      if (sides.mine.men0.length &&
          ((sides.mine.alive === 0 && !ctxR.reserveOf.mine.length) ||
           brokenSide(sides.mine, ctxR.fledOf.mine.length))) { outcome = "lost"; break; }
    }
    /* A FIGHT THAT WILL NOT END IS DECIDED ON THE FIELD. The cap exists so a
       campaign turn is bounded; when it is reached the side with more power
       left has won, which is what "both sides withdrew and one of them held
       the ground" means. Never a draw: the campaign has no shape for one. */
    if (!outcome) outcome = sides.mine.powerNow >= sides.them.powerNow ? "won" : "retreat";

    const r = buildReport(units, ctxR, outcome, t);
    r.youKills = 0;
    if (!ctxR.youSafe) {
      W.state.you.hp = outcome === "lost"
        ? Math.max(1, Math.round(W.state.you.maxHp * 0.25))
        : Math.max(1, Math.round(you.hp));
    }
    if (opts.apply !== false && W.army && W.army.aftermath) W.army.aftermath(r);
    return r;
  }
  function sideRecord(key, dir) {
    return { key: key, dir: dir, alive: 0, routing: 0, deadN: 0, brokeN: 0,
      morale: 1, power0: 1, powerNow: 1, moraleMalus: 0, men0: [], standing: [] };
  }
  function nerveFor(cq) {
    const R = CBZ.combatIQ && CBZ.combatIQ.ROLE && CBZ.combatIQ.ROLE[cq];
    return (R && R.nerve != null) ? R.nerve : (NERVE_FALLBACK[cq] || 0.4);
  }
  // the break rule, on a side record rather than on the live SIDES — the same
  // arithmetic checkEnd() runs, so a battle cannot end at two different moments
  // depending on which path is running it
  function brokenSide(side, fled) {
    if (MORALE_OFF() || side.men0.length <= 2) return false;
    const fighting = side.alive - side.routing;
    const gone = side.deadN + side.routing + fled;
    return fighting <= Math.max(1, Math.floor(side.men0.length * 0.1)) &&
           gone >= side.men0.length * 0.3;
  }

  /* ============================================================ THE CLOCK
     A BATTLE HAS A CEILING AND THE UI SAYS SO. In a shared campaign a fight
     that runs forever is a player holding seven other people hostage, and even
     solo a stalemate on a dune is a page nobody closes gracefully. At the cap
     the fight does not simply stop: the REMAINDER IS RESOLVED THROUGH THE SAME
     ATTRITION TICK, on the same bodies, with their current hp and morale — the
     3D battle and the fast path meeting in the middle of one fight, which is
     the strongest statement available that they are one model.

     150 s because the fights measured on real rosters land at 45-90 s and a
     ceiling has to sit clear of the honest ones; ?limit=N moves it. */
  function BATTLE_MAX() {
    const n = parseInt((Q && Q.get("limit")) || "", 10);
    return n > 0 ? n : 150;
  }
  function finishOnTheClock() {
    const ctxR = report;
    ctxR.you = YOU;
    for (let i = 0; i < men.length; i++) {
      const u = men[i];
      if (!u.isYou && !u.nerve) u.nerve = nerveOf(u);
    }
    SIDES.mine.men0 = SIDES.mine.men0 || [];
    for (let g = 0; g < 120; g++) {
      attritionTick(men, SIDES, ctxR, 1);
      /* THE MEN THE TICK KILLED STILL HAVE TO FALL. attritionTick knows about
         hp and nothing about bodies, which is right — it is the headless half.
         So the bodies it emptied are laid down here, through the same
         deaths.js every 3D death runs, or the last second and a half before
         the aftermath screen is a rank of standing corpses. They arrive with
         no impact record, which deaths.js handles honestly: nobody shot him,
         so the fall direction falls back to the seeded random. */
      /* AND THE GUARD IS `!u.fall && !u.retired`, WHICH IS NOT WHAT `!u.dieT`
         WAS. dieT was set once and never cleared, so it latched forever;
         `fall` is CLEARED by D.forget() when the corpse budget retires a body,
         and retired men stay in men[] (only `corpses` is spliced). Without
         !u.retired a retired corpse re-enters here on the next pass and is
         killed a second time: a second rim tick, a second battle:kill, and a
         second copy in `corpses`. And the `u.fall ||` below is the degrade
         path — deaths.js absent, or a man with no rig — because an unmarked
         man is pushed into corpses on all 120 iterations of this loop. */
      const Dt = DTH();
      for (let i = 0; i < men.length; i++) {
        const u = men[i];
        if (u.dead && !u.isYou && !u.retired && !u.fall && !u.ragdoll) {
          if (Dt) Dt.fell(u, null);
          u.fall = u.fall || { done: true };
          corpses.push(u);
        }
      }
      if (YOU.dead) { endBattle("lost", "YOU WENT DOWN"); return; }
      if (SIDES.them.alive === 0 || brokenSide(SIDES.them, ctxR.fledOf.them.length)) {
        endBattle("won", "THEY BREAK"); return;
      }
      if (SIDES.mine.men0.length && brokenSide(SIDES.mine, ctxR.fledOf.mine.length)) {
        endBattle("lost", "YOUR ARMY BREAKS"); return;
      }
    }
    endBattle(SIDES.mine.powerNow >= SIDES.them.powerNow ? "won" : "retreat", "THE LIGHT GOES");
  }

  /* ============================================================ ORDERS
     FOUR BUTTONS AND NOT ONE MORE. The brief is explicit that the controls stay
     as simple as the natural-disaster game, and four is the number that covers
     every decision a line commander actually makes: go, stay, go around, get
     out. They are not a second AI — each one changes what combat_iq is TOLD
     (where the goal is, whether cover is preferred, whether the band is
     respected) and combat_iq still decides how to fight there.

     ?orders=old pins everybody to HOLD, which is exactly battle.html's
     behaviour (posture(), band, bearing, tokens, nothing else) and is the
     revert for the command layer. */
  /* SIX NOW, AND THE TWO NEW ONES ARE THE TWO WAYS A COMMANDER ACTUALLY
     POINTS. "Four buttons" above covered go / stay / go around / get out; what
     it did not cover was WHERE — every order was measured off the enemy's
     centre of mass or off wherever the line happened to be when you pressed
     it. FOLLOW ME makes the line form on YOU: you walk, it comes, and the
     fight happens where the warlord is standing, which is the whole
     Bannerlord-in-first-person premise of this game. MOVE is a place on the
     sand — a tap in the command seat — and the army goes there and holds it.
     Neither is a new AI: out of contact the section marches to the point, in
     contact think() hands straight back to combat_iq exactly as HOLD does,
     with the leash on the point instead of on the old anchor. The enemy
     commander does not use either; he has no thumb. */
  const ORDERS = ["charge", "hold", "flank", "fallback", "follow", "move"];
  const ORDER_LABEL = { charge: "CHARGE", hold: "HOLD", flank: "FLANK", fallback: "FALL BACK", follow: "FOLLOW ME", move: "MOVE" };
  function orderOf(side) {
    return (Q && Q.get("orders") === "old") ? "hold" : side.order;
  }
  function setOrder(o, sideKey) {
    const s = SIDES[sideKey || "mine"];
    if (!s || ORDERS.indexOf(o) < 0) return;
    if (s.order === o) return;
    s.order = o;
    if (sideKey !== "them" && moveMark && o !== "move") moveMark.visible = false;
    /* AN ORDER RESETS THE ANCHOR IT IS MEASURED FROM. HOLD means "hold HERE",
       and here is wherever the line is when the order lands — not where it
       formed up two minutes ago. Without this, HOLD after a CHARGE drags the
       whole army backwards to the start line, which reads as a bug. */
    s.anchorX = s.comX; s.anchorZ = s.comZ;
    /* NO "ORDER: FLANK" LINE. paintOrders() lights the button you just pressed
       and #wbOrd already carries the label — the feed line was the same fact,
       written a third time, in a box competing with the casualties. The button
       IS the picture. */
    if (sideKey !== "them") paintOrders();
  }
  /* THE OTHER SIDE HAS A COMMANDER TOO, and he is four lines because he is
     answering the same four-button question. Re-asked on a slow tick so the
     enemy line does not twitch. */
  let enemyLocked = false;      // drive-only; see W.battle.order
  function enemyCommand() {
    if (enemyLocked) return;
    const s = SIDES.them, foe = SIDES.mine;
    let o = "hold";
    if (s.morale < 0.45) o = "fallback";
    else if (s.powerNow > foe.powerNow * 1.25 || s.alive > foe.alive * 1.4) o = "charge";
    else if (simT > 24 && s.alive > 6 && foe.alive > 3) o = "flank";
    if (o !== s.order) { s.order = o; s.anchorX = s.comX; s.anchorZ = s.comZ; }
  }

  /* ============================================================ THINK */
  function marchGoal(m, gx, gz) {
    // side.squads[] holds UNITS now, not arrays of men — see THE SQUAD.
    const u = m.unit;
    const sq = u ? u.men : null;
    let lead = null;
    if (sq) for (let i = 0; i < sq.length; i++) if (!sq[i].dead && !sq[i].fled && !sq[i].routed) { lead = sq[i]; break; }
    if (lead && lead !== m) {
      // the column: a squad rounds a dune as a squad, one lookup per follower
      const ahead = lead.target;
      const my = Math.atan2(ahead.x - lead.pos.x, ahead.z - lead.pos.z);
      const row = ((m.sqSlot / 2) | 0) + 1, col = (m.sqSlot & 1) ? 1.25 : -1.25;
      m.target.set(lead.pos.x - Math.sin(my) * row * 2.0 + Math.cos(my) * col, 0,
                   lead.pos.z - Math.cos(my) * row * 2.0 - Math.sin(my) * col);
    } else {
      m.target.set(gx + (lcg() - 0.5) * 12, 0, gz + (lcg() - 0.5) * 12);
    }
    m.slot = "march";
  }
  const _bn = [];
  function spreadGoal(m) {
    const a = fineNear(m.target.x, m.target.z, 2.6, _bn);
    let ox = 0, oz = 0, n = 0;
    for (let i = 0; i < a.length && n < 4; i++) {
      const o = a[i];
      if (o === m || o.dead || o.team !== m.team) continue;
      const dx = m.target.x - o.pos.x, dz = m.target.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || d < 0.001) continue;
      ox += (dx / d) * (2.6 - d); oz += (dz / d) * (2.6 - d); n++;
    }
    if (n) { m.target.x += ox; m.target.z += oz; }
  }
  // the flank anchor: 90 degrees off the fight axis, on the side of the enemy
  // mass that has fewer of them in it. Stable per man so a wing does not swap
  // sides every think.
  function flankAnchor(m) {
    const foe = SIDES[m.team === "mine" ? "them" : "mine"];
    const ax = Math.atan2(foe.comX - m.side.comX, foe.comZ - m.side.comZ);
    if (m._wing == null) m._wing = ((m.i + m.side.wingBias) & 1) ? 1 : -1;
    const wide = ax + m._wing * 1.15;
    const r = 46 + (m.i % 5) * 5;
    return { x: foe.comX + Math.sin(wide) * r, z: foe.comZ + Math.cos(wide) * r };
  }

  /* ============================================================ THE SQUAD
     A UNIT OUT OF CONTACT IS ONE AGENT, NOT TEN — AND THAT IS THE DEEPER
     BEHAVIOUR, NOT A SHORTCUT AROUND IT.

     THE OWNER'S CONSTRAINT, verbatim: "consider why and how to cheapen while
     improving and deepening logic not by simplifying". So this is not a LOD.
     Nobody gets dumber, nobody gets fewer thoughts per second, and no man is
     ever removed from the sim. What changes is WHAT IS BEING SIMULATED.

     THE OLD FILE HAD NO UNITS. `m.sq` and `side.squads[]` existed and were
     used for exactly one thing — marchGoal's follow-the-leader column — and
     everything else in the battle was ten individuals who happened to share a
     number. So a section crossing 140 metres of empty sand cost ten pathing
     integrations, ten grid target searches, ten sight lines, ten collider
     probes, ten sand.plant seats and ten entries in the separation solver, to
     produce ten men walking in a clump. That is not simulation, it is the same
     answer computed ten times, and it is the whole reason the field cap was
     300.

     WHAT IT COSTS NOW, out of contact: ONE goal, ONE march, ONE collider probe
     against a squad-sized disc, ONE contact test, and then ten rigid slot
     writes. Nine tenths of the work is gone and something the game did not
     have arrived with it:

       · A SQUAD HOLDS ITS SHAPE. Ten men in a clump is what a crowd separation
         solver produces; ten men in a LINE, in FILE, or in a WEDGE is a
         formation, and it is now the thing you actually see crossing the sand.
       · THE SHAPE IS THE ORDER. HOLD forms line abreast, CHARGE forms a wedge
         (the point takes the fire), FLANK forms column (narrow, fast, moving
         past a front rather than into it), FALL BACK forms line facing back.
         The four order buttons now change the SILHOUETTE of your army, which
         is the one thing they never did.
       · A SQUAD STEERS AS A SQUAD. The obstacle probe is one disc the width of
         the section, so a section goes AROUND a rock instead of splitting
         around it and re-merging — which is what the old per-man
         resolveCircle produced and what made a formed advance dissolve into a
         crowd within twenty metres.
       · IT DEPLOYS AT ITS OWN WEAPON'S RANGE. Not a global constant: the reach
         is the longest gun in the section, read off combat_iq's own profile()
         ladder. A veteran section with rifles opens out at 125 m; a levy
         section with pistols stays in file until 55 m, because at 60 m a pistol
         section has nothing to say. That is a tactic the game did not contain,
         and it comes out of the same table that decides every trigger pull.
       · AND IT COMES APART WHEN ITS ARMY DOES. A squad whose side's morale has
         fallen under the nerve of its weakest man deploys immediately, so the
         men rout as individuals. Formation is a thing an army in order has.

     WHEN IT DEPLOYS EVERY MAN IS EXACTLY THE MAN HE WAS. stepMan, think(),
     combat_iq's posture, cover, shot ladder, morale — untouched. There is no
     second brain and no simplified enemy. ?squads=old turns the layer off and
     the fight is the old one, man for man, which is what --ab photographs. */
  /* ============================================================ THE BOOTS
     ONE PLACE THAT SEATS A BODY, AND TWO RELEVANCE RULES ON IT.

     WHAT THIS USED TO DO. Every man, every substep, called W.sand.plant —
     which runs sand.js's stand() (a multi-sample of the drawn surface plus its
     normal), slerps him onto that normal, writes his position AND his
     quaternion, and then feeds S.walk to stamp his footprints. Every man.
     Every substep. Including the man who has been lying in the same patch of
     cover for forty seconds firing at a crest.

     RULE ONE: A MAN WHO DID NOT MOVE IS ALREADY SEATED. This is not an
     approximation with a tolerance — the ground does not move, so re-solving a
     stationary man's seat returns the number he already has. And it is worth
     far more than the sand call it skips: `m.pos` IS `group.position`, so
     writing it marks the whole rig's matrix subtree dirty and three.js re-walks
     every one of its ~60 nodes on the next render. A firefight is mostly men
     holding still; those men now cost nothing in the sim AND nothing in the
     matrix walk.

     RULE TWO: THE FOOTPRINTS ARE A BUDGET, NOT A DISTANCE. sand.js's print
     pool is a 2 200-slot ring buffer (PRINT_CAP) and a walking man stamps
     about six prints a second. Above ~110 men stamping at once the buffer
     recycles inside twenty seconds and the trail you are meant to read off the
     ridge is gone before you turn round — so past that point the prints are
     not merely expensive, they are actively worse. The radius is therefore
     driven by a controller against that budget rather than typed: it shrinks
     while more than PRINT_BUDGET men are inside it and grows while fewer are,
     which lands on the right radius by itself at 20 men, at 300 and at 1 800.
     Men outside it are still seated and still leaned — they simply do not
     stamp, which is invisible, because their prints were being deleted a
     second later anyway.

     (AND A BUG THAT IS NOT MINE TO FIX: sand.js's S.walk keeps its walkers in
     a Map and does `if (walkers.size > 420) walkers.clear()` when a new one
     arrives. Past 420 distinct walkers that clears the whole table on nearly
     every call, so at 500 a side NOBODY leaves a print — the accumulator is
     wiped before it reaches one stride. The budget above keeps the caller
     under that ceiling as a side effect; the ceiling itself wants raising or
     replacing with an LRU. See the report.) */
  const PRINT_BUDGET = 110;
  let printR = 90, printN = 0, plantR2 = 8100;
  function tickPlantBudget() {
    // one proportional step per substep. 0.94/1.03 is a slow controller on
    // purpose: a radius that snaps makes trails appear and vanish in bands.
    printR = clamp(printR * (printN > PRINT_BUDGET ? 0.94 : 1.03), 10, 260);
    plantR2 = printR * printR;
    printN = 0;
  }
  /* HOW FAR A MAN HAS TO HAVE MOVED BEFORE RE-SEATING HIM IS WORTH IT, and
     "at all" is the wrong answer. The separation solver nudges nearly every
     man by a fraction of a millimetre every substep, so an exact-equality test
     re-seated 280 of 301 men every frame and bought almost nothing — MEASURED,
     that was the first version of this. The threshold that means something is
     A THIRD OF A PIXEL: below that the seat, the lean and the print are
     identical on screen, and the only thing the work buys is a dirty matrix
     subtree for the renderer to re-walk.

     ONE PIXEL is the threshold, and the first draft used a third of one and
     bought almost nothing — MEASURED, 548 of 583 men still re-seated every
     frame, because a man walking at 4.6 m/s covers 7.7 cm in a frame and a
     third of a pixel at 100 m is 1.3 cm. One pixel is the honest line: the
     seat is a POSITION (plus a lean), his x and z are written by the sim
     directly into the rig either way, and the y and the lean lag by at most
     the slope times a sub-pixel displacement. It is also exactly the trade the
     gait ladder below already makes at the same distances, so the two now
     agree instead of one of them being three times fussier than the other for
     no stated reason.

     One pixel at distance d, on a 75-degree lens over ~900 rows, is
     d * (1.31 / 900) ≈ d * 0.00146 metres. Compared in squares against the
     man's own camera distance so there is no square root in it, and floored at
     a millimetre so a man standing on the lens is still exact. */
  const SEAT_PX = 0.00146 * 0.00146;
  function seatMan(m, sdt) {
    const px = m.pos.x, pz = m.pos.z;
    const cp = CBZ.camera.position;
    const cdx = px - cp.x, cdz = pz - cp.z;
    const cd2 = cdx * cdx + cdz * cdz;
    if (m.seatX !== null) {
      const mx = px - m.seatX, mz = pz - m.seatZ;
      const dy = m.yaw - m.seatYaw;
      if (mx * mx + mz * mz < Math.max(1e-6, cd2 * SEAT_PX) && dy * dy < 1e-6) return;
    }
    m.seatX = px; m.seatZ = pz; m.seatYaw = m.yaw;
    const _p = pNow();
    pHit("seat");
    if (W.sand && W.sand.plant) {
      const near = cd2 < plantR2;
      if (near) printN++;
      W.sand.plant(m.group, px, pz, m.yaw,
                   { id: m.i, dt: near ? sdt : null, speed: m.speed, ground: MAP.groundAt });
    } else {
      m.pos.y = MAP.groundAt(px, pz);
      m.group.rotation.y = m.yaw;
    }
    pAdd("plant", _p);
  }

  const SQUAD_N = 10;              // makeMan's own m.sq = (i / 10) | 0
  const REACH_CAP = 125;           // stepMan's own fireMax ceiling, named once
  /* THE MARGIN ON THE DEPLOY RADIUS IS A CLOSING DISTANCE, NOT A FUDGE. The
     contact test runs on the squad's think tick (SQ_THINK below); in that
     window a charging enemy covers up to 7.6 m/s * the interval, and the
     squad's own front rank stands up to half its depth ahead of the frame the
     test is taken from. Both are added so a squad can never be shot at while
     it still believes it is out of contact. */
  const SQ_THINK = 0.4;
  const CONTACT_PAD = 7.6 * SQ_THINK + SQUAD_N * FILE_W * 0.5;
  let units = [];
  let squadsOn = true;

  function joinSquad(side, m) {
    let u = side.squads[m.sq];
    if (!u) {
      u = side.squads[m.sq] = {
        side: side, key: side.key, sq: m.sq, men: [],
        live: 0, x: 0, z: 0, yaw: 0, spd: 0,
        formed: false, thinkAt: -1, reach: 40, nerve: 0, wing: 0,
        form: "column", err: 99, seated: false,
      };
      units.push(u);
    }
    u.men.push(m);
    m.unit = u;
    /* THE SECTION'S REACH IS ITS LONGEST GUN. combat_iq's profile() answers
       `hi` — the top of this man's role×weapon effective band — and stepMan
       turns that into a fire gate as min(125, hi * 2.6 + 8). Same expression,
       same table, evaluated once per man at muster instead of once per trigger
       pull, so the squad cannot possibly deploy later than its best shot could
       have opened fire. */
    const p = CBZ.combatIQ && CBZ.combatIQ.profile
      ? safe(function () { return CBZ.combatIQ.profile(m); }) : null;
    const r = p ? Math.min(REACH_CAP, p.hi * 2.6 + 8) : 60;
    if (r > u.reach) u.reach = r;
    // and its nerve is its WEAKEST man's — the first one to break takes the
    // formation with him, which is what a formation coming apart looks like
    const nv = nerveOf(m);
    if (nv > u.nerve) u.nerve = nv;
    return u;
  }

  /* IS THERE ANYBODY IN FRONT OF US. The coarse target grid, asked once per
     squad per think instead of once per man per think, and it answers a
     boolean so it stops at the first man it finds rather than sorting
     candidates. */
  function enemyNear(team, x, z, r) {
    const cx = Math.floor(x / GRID_CELL), cz = Math.floor(z / GRID_CELL);
    const maxR = Math.ceil(r / GRID_CELL), r2 = r * r;
    for (let ring = 0; ring <= maxR; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const a = grid.get(gridKey(cx + dx, cz + dz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const o = a[i];
          if (o.team === team || o.dead || o.fled) continue;
          const ddx = o.pos.x - x, ddz = o.pos.z - z;
          if (ddx * ddx + ddz * ddz < r2) return true;
        }
      }
    }
    return false;
  }

  /* WHERE A MAN STANDS IN HIS SECTION, in the squad's own frame: +u forward
     (the way it is facing), +v to its left. Four shapes, one per order, and
     the numbers are the same FILE_W / RANK_D the army is drawn up on, so a
     section's spacing matches the line it came out of. */
  const _slot = { u: 0, v: 0 };
  function slotOf(form, k) {
    const c = (SQUAD_N - 1) / 2;                 // 4.5
    if (form === "line") { _slot.u = (k & 1) ? -0.7 : 0; _slot.v = (k - c) * FILE_W; }
    else if (form === "wedge") {
      // the point is slot 0's own file; every step out is a step back, so the
      // man at the tip is the man who takes the fire
      const off = k - c;
      _slot.u = -Math.abs(off) * 1.35; _slot.v = off * FILE_W * 0.95;
    } else if (form === "back") {                 // fall back: line, facing out
      _slot.u = (k & 1) ? 0.7 : 0; _slot.v = (k - c) * FILE_W;
    } else {                                      // column / file
      _slot.u = -((k >> 1) * RANK_D); _slot.v = ((k & 1) ? 1 : -1) * FILE_W * 0.55;
    }
    return _slot;
  }
  function formFor(order) {
    return order === "charge" ? "wedge" : order === "flank" ? "column"
         : order === "fallback" ? "back" : "line";
  }

  function squadThink(u) {
    u.thinkAt = simT + SQ_THINK * (0.85 + (u.sq % 5) * 0.06);   // staggered
    const M = u.men;
    let n = 0, cx = 0, cz = 0;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      if (m.dead || m.fled) continue;
      n++; cx += m.pos.x; cz += m.pos.z;
    }
    u.live = n;
    if (!n) { setFormed(u, false); return; }
    /* WHILE IT IS DEPLOYED THE FRAME FOLLOWS THE MEN. Without this a section
       that fights forward for a minute and then loses contact snaps back to
       wherever the frame was left, dragging ten men across the sand. */
    if (!u.formed) {
      /* MINUS THE MEAN SLOT, OR THE SECTION CRAB-WALKS. The men stand at
         slot offsets from the frame; re-centring the frame on their centroid
         and then re-seating them at their slots translates the whole section
         by the mean offset — nothing for a full symmetric line, ten metres a
         time for a lone man in a wedge's point slot. MEASURED in the duel:
         their champion, contact flickering at the edge of his reach, drifted
         66 m sideways down a dune in thirty seconds and never got inside his
         own range. Same as a section down to three survivors on one flank. */
      const cs0 = Math.cos(u.yaw), sn0 = Math.sin(u.yaw);
      let ox = 0, oz = 0;
      for (let i = 0; i < M.length; i++) {
        const m = M[i];
        if (m.dead || m.fled) continue;
        const s = slotOf(u.form, m.sqSlot);
        ox += sn0 * s.u - cs0 * s.v; oz += cs0 * s.u + sn0 * s.v;
      }
      u.x = cx / n - ox / n; u.z = cz / n - oz / n;
    }
    const broke = !MORALE_OFF() && u.side.morale < u.nerve;
    const contact = simT < (u.fireT || -1) ||
                    enemyNear(u.key, u.x, u.z, u.reach + CONTACT_PAD);
    pHit("squadThink");
    setFormed(u, !contact && !broke);
    u.form = formFor(orderOf(u.side));
  }

  function setFormed(u, on) {
    if (u.formed === on) return;
    u.formed = on;
    const M = u.men;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      m.formed = on && !m.dead && !m.fled;
      if (on) {
        /* AND HE DROPS HIS MARK WHEN HE FORMS UP. Without this, a man who had
           a target when contact was lost keeps it, `sees` stays true, and the
           render-side aim pass turns his whole rig toward it — AFTER stepSquad
           has set him to the section heading, because the pose pass runs after
           the sim in frame(). The drawn frame then showed a formation whose
           men were each facing a different way: a line of ten soldiers
           marching sideways. He is out of contact, so he has no mark; when the
           section deploys he acquires one on his next think like anybody
           else. */
        m.tgt = null; m.sees = false; m.losBadT = 0;
      } else {
        /* HANDING A MAN BACK. His think clock is re-armed a beat out so ten
           men leaving formation on the same frame do not all think on it, and
           his goal is where he is standing — anything else teleports his
           intent to wherever the frame last was. */
        m.thinkAt = simT + lcg() * 0.18;
        m.lastThink = simT;
        m.target.set(m.pos.x, 0, m.pos.z);
        m.slot = "march";
      }
    }
    if (on) u.err = 99;             // it has to walk back into its slots first
  }

  /* THE SQUAD'S OWN GOAL — the same four answers think() gives a man, asked
     once for ten. There is no fifth behaviour here and there must never be:
     if this and think() ever disagree about what CHARGE means, the army does
     one thing at 130 m and a different one at 120. */
  const _sg = { x: 0, z: 0 };
  function squadGoal(u) {
    const s = u.side;
    const foe = SIDES[u.key === "mine" ? "them" : "mine"];
    const ord = orderOf(s);
    if (ord === "fallback") { _sg.x = s.anchorX + s.dir * 60; _sg.z = s.anchorZ; return _sg; }
    if (ord === "move") { _sg.x = s.anchorX; _sg.z = s.anchorZ; return _sg; }
    if (ord === "follow" && YOU && !YOU.dead) {
      /* the sections form a line ON the warlord: first section at his left
         shoulder, second at his right, third further left, and so on — each
         one a section's width out, so two sections never share ground */
      const lane = ((u.sq & 1) ? 1 : -1) * Math.ceil((u.sq + 1) / 2) * SQUAD_N * FILE_W * 0.55;
      _sg.x = YOU.pos.x + s.dir * 7; _sg.z = YOU.pos.z + lane;
      return _sg;
    }
    if (ord === "flank") {
      /* THE WING IS THE SECTION'S, NOT THE MAN'S. flankAnchor() hangs the
         choice off m.i, so the old code could send half a section left and
         half right — ten men splitting down the middle of their own squad.
         One wing per unit is what makes a flank read as a wing. */
      const ax = Math.atan2(foe.comX - s.comX, foe.comZ - s.comZ);
      if (!u.wing) u.wing = ((u.sq + s.wingBias) & 1) ? 1 : -1;
      const wide = ax + u.wing * 1.15;
      const r = 46 + (u.sq % 5) * 5;
      _sg.x = foe.comX + Math.sin(wide) * r; _sg.z = foe.comZ + Math.cos(wide) * r;
      return _sg;
    }
    _sg.x = foe.comX; _sg.z = foe.comZ;
    return _sg;
  }

  function formedCount() {
    let n = 0;
    for (let i = 0; i < men.length; i++) if (men[i].formed) n++;
    return n;
  }
  function engagedUnits() {
    let n = 0;
    for (let i = 0; i < units.length; i++) if (units[i].live && !units[i].formed) n++;
    return n;
  }

  const _sqPos = { x: 0, y: 0, z: 0 };
  function stepSquad(u, sdt) {
    if (simT >= u.thinkAt) squadThink(u);
    if (!u.formed || !u.live) return;

    // ---- one goal, one march, for the whole section --------------------
    const g = squadGoal(u);
    const dx = g.x - u.x, dz = g.z - u.z;
    const d = Math.hypot(dx, dz);
    const ord = orderOf(u.side);
    /* THE MARCHING SPEED IS stepMan's OWN LADDER for the slot this formation
       is in, so a section under CHARGE crosses the sand at exactly the speed
       ten charging men crossed it at. Not a second movement model. */
    let spd = ord === "fallback" ? 5.2 : 6.2;
    if (d < 2) spd = 0;
    if (spd > 0) {
      const nx = dx / d, nz = dz / d;
      const step = spd * sdt;
      _sqPos.x = u.x + nx * step; _sqPos.z = u.z + nz * step;
      _sqPos.y = MAP.groundAt(_sqPos.x, _sqPos.z);
      /* ONE COLLIDER PROBE FOR THE SECTION, and the radius is NOT the section's
         width — that was the first version and it is wrong in a way worth
         recording. resolveCircle pushes a disc out of a box, so a twenty-metre
         disc clipping a two-metre rock gets shoved eleven metres sideways in
         one substep: the whole section teleports around a boulder it was going
         to walk past. The probe is the LEADING FILE's own footprint (a man plus
         a file's worth of give), so the section steers the way a section does —
         the man at the head of it goes round the rock and everyone follows the
         frame — and a man at the far end of a wide line may brush a rock. That
         is the honest trade and it is the smaller error: the old code's answer
         was that the section split in half around every obstacle and never
         re-formed. */
      micro.resolveCircle(_sqPos, 0.45 + FILE_W * 0.9, _sqPos.y, 1.8);
      u.x = _sqPos.x; u.z = _sqPos.z;
      const wantYaw = Math.atan2(nx, nz);
      /* THE FIRST HEADING IS SNAPPED, EVERY ONE AFTER IT IS TURNED. A unit is
         created with yaw 0 (facing +Z) and a battle is fought along X, so
         without this every section on the field spends its first half second
         swinging ninety degrees while its men rally into a line that is
         rotating under them — which photographs, on frame one of any capture,
         as an army standing sideways. */
      if (!u.turned) { u.yaw = wantYaw; u.turned = 1; }
      let dy = wantYaw - u.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      u.yaw += dy * Math.min(1, sdt * 3.2);      // a formation turns slower than a man
    }
    u.spd = spd;

    // ---- and the men are their slots -----------------------------------
    const cs = Math.cos(u.yaw), sn = Math.sin(u.yaw);
    const M = u.men;
    /* CLOSING ON THE SLOT RATHER THAN SNAPPING INTO IT. A section that has
       just broken contact is a scatter, and teleporting ten men into a line is
       the single most obviously fake thing this could do. They walk in at
       their own pace; the squad only counts as SEATED once the worst man is
       inside a stride of his place, and until then this is a RALLY — which is
       a real behaviour the game did not have and got for free. */
    let worst = 0;
    const rally = Math.max(spd, 4.2) * sdt;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      if (m.dead || m.fled) { m.formed = false; continue; }
      m.formed = true;
      const s = slotOf(u.form, m.sqSlot);
      // squad frame -> world: +u is the heading, +v is 90 degrees to its left
      const wx = u.x + sn * s.u - cs * s.v;
      const wz = u.z + cs * s.u + sn * s.v;
      const ex = wx - m.pos.x, ez = wz - m.pos.z;
      const e = Math.hypot(ex, ez);
      if (e > worst) worst = e;
      let nx = wx, nz = wz;
      if (e > rally) { nx = m.pos.x + (ex / e) * rally; nz = m.pos.z + (ez / e) * rally; }
      m.speed = e > rally ? Math.max(spd, 4.2) : spd;
      m.yaw = u.yaw;
      m.slot = spd > 0 ? "march" : "hold";
      m.pos.x = nx; m.pos.z = nz;
      seatMan(m, sdt);
    }
    u.err = worst;
    u.seated = worst < 1.2;
  }

  function think(m, now) {
    const thinkDt = Math.min(1.2, now - m.lastThink);
    m.lastThink = now;
    m.thinkAt = now + 0.14 + Math.min(0.42, men.length / 2600) + lcg() * 0.06;

    /* STANDING UP IS AN ORDER TOO. Any think that does not end in a fold
       clears the fold and the crouch — otherwise a man told to CHARGE walked
       across the open at 1 m of eye height, invisible to the enemy and unable
       to see them, which is a bug that would have read as "the charge just
       works now". Cleared first, re-set by the hold branch at the bottom. */
    if (m.hull && !m.routed) { m.hull = null; m.popT = 0; setStance(m, "stand"); }

    if (stepRout(m)) {
      /* A ROUTING MAN RUNS FOR HIS OWN EDGE AND DOES NOT SHOOT. He is not
         retreating in good order — that is FALL BACK, which is an order and
         still fires. This is the army coming apart. */
      const s = m.side;
      m.target.set(m.pos.x + s.dir * 40, 0, m.pos.z + (lcg() - 0.5) * 20);
      m.slot = "rout";
      m.tgt = null;
      return;
    }

    if (m.stepAsideT > 0 && m.tgt && !m.tgt.dead) { m.stepAsideT -= thinkDt; return; }
    if (!m.tgt || m.tgt.dead || m.tgt.fled) { m.tgt = pickTarget(m, SIGHT); m.losBadT = 0; }

    const ord = orderOf(m.side);
    const foe = SIDES[m.team === "mine" ? "them" : "mine"];
    const tgt = m.tgt;

    if (!tgt) {
      if (ord === "flank") { const a = flankAnchor(m); marchGoal(m, a.x, a.z); }
      else if (ord === "fallback") marchGoal(m, m.side.anchorX + m.side.dir * 60, m.side.anchorZ);
      else if (ord === "follow") { const f = followPoint(m); marchGoal(m, f.x, f.z); }
      else if (ord === "move") marchGoal(m, m.side.anchorX, m.side.anchorZ);
      else marchGoal(m, foe.comX, foe.comZ);
      return;
    }

    const sees = eyeLos(m, tgt);
    m.sees = sees;
    if (!sees) {
      m.losBadT += thinkDt;
      if (m.losBadT > 2.6) {
        if (m.losBadT > 7) { m.tgt = null; m.losBadT = 0; return; }
        m.target.set(tgt.pos.x, 0, tgt.pos.z);
        m.slot = "push";
        return;
      }
    } else m.losBadT = 0;

    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);

    /* ---- FOLLOW / MOVE, IN CONTACT: THE RALLY. A man with a target who is
       far from where the order put him RELOCATES first and fights from there —
       otherwise "follow me" moved only the men who happened to have nobody to
       shoot at, and the first storyboard had the warlord thirty metres off his
       own line's flank with the line still fighting where it stood. The leash
       below is for the man who has arrived; this is for the man who has not. */
    if (ord === "follow" || ord === "move") {
      const f = ord === "follow" ? followPoint(m) : { x: m.side.anchorX, z: m.side.anchorZ };
      const off = Math.hypot(f.x - m.pos.x, f.z - m.pos.z);
      if (off > (ord === "follow" ? 18 : 26)) { marchGoal(m, f.x, f.z); return; }
    }

    /* ---- FALL BACK: fighting backwards. He keeps his mark and keeps firing;
       he simply refuses to be where he is. A retreat that stops shooting is a
       rout, and the difference between the two is the entire point of having
       both a button and a morale system. */
    if (ord === "fallback") {
      m.target.set(m.pos.x + m.side.dir * 16, 0, m.pos.z + (lcg() - 0.5) * 5);
      m.slot = "fallback";
      spreadGoal(m);
      return;
    }

    /* ---- CHARGE: the band is ignored. combat_iq's posture() exists to hold a
       weapon's preferred distance, which is right and is exactly what a charge
       refuses to do — so a charge does not call it. Goal is the man himself,
       slot "push", which the trigger and the locomotion below already read as
       "close, at speed, shooting". */
    if (ord === "charge") {
      m.target.set(tgt.pos.x, 0, tgt.pos.z);
      m.slot = "push";
      spreadGoal(m);
      return;
    }

    /* ---- FLANK: wide until the wing is around, then fight from there. Men
       out of contact walk the arc; men in contact hand back to posture(), so
       the actual gunfight on the wing is still combat_iq's. */
    if (ord === "flank") {
      const a = flankAnchor(m);
      const da = Math.hypot(a.x - m.pos.x, a.z - m.pos.z);
      if (da > 24 && d > 34) {
        m.target.set(a.x, 0, a.z);
        m.slot = "flank";
        spreadGoal(m);
        return;
      }
    }

    // ---- HOLD (and a flanker who has arrived): the donor's own path.
    const slot = CBZ.combatIQ && CBZ.combatIQ.posture
      ? CBZ.combatIQ.posture(m, tgt, thinkDt) : "fire";
    m.slot = slot || "fire";

    /* HOLD PREFERS COVER OVER ANGLES. posture() hands a man without the fire
       token the "flank" slot — work an angle — which is right for a squad
       manoeuvring and wrong for a line under orders to HOLD. So on HOLD the
       angle-workers are sent to the nearest real cover instead (combat_iq's
       own cover search, not a second one), and only if there is none do they
       keep the angle. This is the "cover preference" the order changes. */
    /* HOLD, MOVE and FOLLOW fight the same way in contact: it is where the
       leash is tied that differs. */
    const holdish = ord === "hold" || ord === "move" || ord === "follow";
    if (holdish && slot === "flank" && CBZ.combatIQ && CBZ.combatIQ.cover) {
      const cv = CBZ.combatIQ.cover(m, tgt.pos.x, tgt.pos.z);
      if (cv) { m.target.set(cv.x, 0, cv.z); m.slot = "cover"; }
    }
    /* AND WHERE THERE IS NO BOX, THERE IS GROUND. combat_iq.cover() answers
       null on open sand by construction — it only understands colliders — and
       that null is exactly what the fake rocks existed to prevent. hullDown()
       is asked second, never first: a real slab in rock country is still
       better cover than a fold, and the search that finds it is cheaper.

       This runs for EVERY held man who is not already working a box, not only
       the ones posture() sent looking, because a reverse-slope position is
       what a line under fire on open dunes actually does. A man already in his
       fold keeps working it (workHull in stepMan) instead of re-deciding. */
    if (holdish && m.slot !== "cover" && MAP.folded) {
      const hd = hullFor(m, tgt, false);
      if (hd) { m.target.set(hd.x, 0, hd.z); m.slot = "hull"; }
      else if (m.hull) { m.hull = null; setStance(m, "stand"); }
    }
    /* AND HOLD MEANS HOLD *HERE*. A leash on the anchor the order was given
       at: without it a held line drifts forward one band at a time as men
       re-acquire nearer marks, and after a minute HOLD and CHARGE look the
       same on screen. 26 m is a band's worth of give. FOLLOW's anchor is the
       warlord himself and its leash is shorter — a line that is "with you"
       and forty metres ahead of you is not with you. */
    if (holdish) {
      const onYou = ord === "follow" && YOU && !YOU.dead;
      const ax = onYou ? YOU.pos.x : m.side.anchorX;
      const leash = onYou ? 14 : 26;
      const fwd = (m.target.x - ax) * -m.side.dir;
      if (fwd > leash) m.target.x = ax - m.side.dir * leash;
    }
    spreadGoal(m);
  }
  /* WHERE A MAN STANDS WHEN THE ORDER IS "FOLLOW ME": a rank just behind the
     warlord, fanned out across his front so the line forms on him rather
     than a queue behind him. Deterministic in m.i, so nobody swaps lanes. */
  const _fp = { x: 0, z: 0 };
  function followPoint(m) {
    const s = m.side;
    const you = YOU && !YOU.dead ? YOU.pos : { x: s.anchorX, z: s.anchorZ };
    const k = m.i % 24;
    const lat = ((k & 1) ? 1 : -1) * (1 + (k >> 1)) * FILE_W;
    _fp.x = you.x + s.dir * (4 + ((m.i / 24) | 0) * RANK_D);
    _fp.z = you.z + lat;
    return _fp;
  }

  /* ============================================================ FIRE
     The trigger is combat_iq's: reaction beat, settle, burst rhythm, token
     discipline, derived damage. This only draws the round and applies the
     number it was handed. */
  function fireShot(m, tgt, r) {
    const w = CBZ.weaponById(m.wid);
    m.mag--; m.lastShotT = simT;
    m.side.shots++;

    const cd2 = camDist2(m.pos);
    const seen = cd2 < 240 * 240;
    const hit = lcg() < r.hit;
    const head = hit && lcg() < 0.12;

    _v.set(tgt.pos.x, tgt.pos.y + (head ? tgt.headY : tgt.aimY), tgt.pos.z);
    if (!hit) {
      const slot = (w && w.slot) || "_def";
      const spread = (CBZ.NPC_SPREAD && (CBZ.NPC_SPREAD[slot] || CBZ.NPC_SPREAD._def)) || 0.055;
      const mul = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(m) : 1;
      const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
      const miss = spread * mul * dist * (0.5 + lcg() * 1.6);
      const ang = lcg() * Math.PI * 2;
      _v.x += Math.cos(ang) * miss;
      _v.y += (lcg() - 0.35) * miss * 0.8;
      _v.z += Math.sin(ang) * miss;
    }

    if (seen && fxBudget < 26) {
      fxBudget++;
      let from = null;
      if (cd2 < 130 * 130 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
      if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.5, m.pos.y + 1.42, m.pos.z + Math.cos(m.yaw) * 0.5);
      const lines = (w && w.pellets) ? 3 : 1;
      for (let i = 0; i < lines; i++) {
        _v2.copy(_v);
        if (i) { _v2.x += (lcg() - 0.5) * 1.6; _v2.y += (lcg() - 0.5) * 0.9; _v2.z += (lcg() - 0.5) * 1.6; }
        CBZ.tracer(from, _v2, { shooter: m, targetActor: tgt, muzzle: i === 0,
          muzzleScale: (w && w.flash ? 0.5 + w.flash : 0.9) });
      }
      const dCam = Math.sqrt(cd2);
      if (w && w.sfx && dCam < 230) {
        safe(function () {
          CBZ.sfx(w.sfx, { dist: dCam, ghost: true, volume: (w.sfxVol || 1) * 0.8,
            pitch: w.sfxPitch || 1, delay: dCam > 40 ? dCam / 343 : 0 });
        });
      }
      if (!hit) missImpact(from, _v, cd2);
    }

    if (hit) {
      m.side.hits++;
      if (CBZ.bodyWound && cd2 < 90 * 90) safe(function () { CBZ.bodyWound(tgt, _v, {}); });
      hurtMan(tgt, r.dmg * (head ? 2.2 : 1), { by: m, headshot: head });
    }
  }
  const _mq = [];
  function missImpact(from, to, cd2) {
    if (cd2 > 150 * 150) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return;
    const steps = Math.min(14, Math.ceil(len / 2.4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
      const g = MAP.groundAt(x, z);
      if (y <= g + 0.05) {
        _v2.set(x, g + 0.03, z);
        CBZ.bulletImpact(_v2, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.8 });
        return;
      }
      const cols = micro.queryColliders(x, z, 0.4, _mq);
      for (let c = 0; c < cols.length; c++) {
        const b = cols[c];
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (b.y0 != null && (y < b.y0 || y > b.y1)) continue;
        _v2.set(x, y, z);
        const nx = Math.abs(x - b.minX) < Math.abs(x - b.maxX) ? -1 : 1;
        CBZ.bulletImpact(_v2, { x: nx, y: 0.2, z: 0 }, { kind: "spark", power: 1 });
        return;
      }
    }
  }

  /* ============================================================ DAMAGE
     ARMOUR IS A FLAT SOAK, taken off before the health, which is core's own
     statement of what armour is. It is applied HERE rather than by raising hp
     because the two are not the same thing on screen: soak makes a pistol
     stop working and leaves a rifle working, and a health bonus makes both
     work slightly less well.

     THE 1.45 IS NOT UNIVERSAL, and this is where this file parts company with
     the donor. battle.html multiplies every landed round by 1.45 with the
     comment "combat_iq's ladder is authored for fights against the PLAYER,
     whose fairness cap this page has no player to need". This page HAS a
     player. So the hotter trade applies army-on-army, where it is what keeps a
     battle from taking four minutes, and NOT to rounds arriving at the
     warlord — against him the shipped ladder is exactly the balance it was
     measured as, DPS_CAP and all. */
  function hurtMan(m, dmg, imp) {
    if (!m || m.dead || !(dmg > 0) || over) return;
    const scaled = (imp && imp.raw) ? dmg : dmg * (m.isYou ? 1 : ARMY_MUL);
    const after = hurtOne(m, scaled);      // ONE soak formula — see hurtOne
    if (CBZ.combatIQ && CBZ.combatIQ.suppress && !m.isYou) CBZ.combatIQ.suppress(m, 0.9);
    if (imp && imp.by && imp.by.team && imp.by.team !== m.team && (!m.tgt || m.tgt.dead)) m.tgt = imp.by;
    /* A SECTION UNDER FIRE IS IN CONTACT, WHATEVER ITS OWN REACH SAYS. The
       deploy test asks "is there an enemy inside MY longest gun", which is the
       right question for opening fire and the wrong one for being shot at: a
       levy section with pistols reaches 55 m and a marksman on the ridge
       reaches 125, so the section could take rounds for two ticks while still
       marching in file. One round landing anywhere in the unit breaks it out,
       immediately, on the frame the round lands. */
    if (m.unit) {
      /* AND IT STAYS DEPLOYED FOR A WHILE. Without the timestamp the section
         re-forms on its very next think (0.4 s later) because the man who shot
         it is outside its own reach, and then breaks out again on the next
         round that lands — a marksman on a ridge makes a whole company flicker
         between column and firing line twice a second. Three seconds is the
         same order as combat_iq's own suppression decay, which is the other
         system in this game that answers "how long does being shot at stay
         true for". */
      m.unit.fireT = simT + 3;
      if (m.unit.formed) setFormed(m.unit, false);
    }
    if (m.isYou) {
      CBZ.shake && CBZ.shake(Math.min(1.2, after / 30));
      hurtFlash = 1;
    }
    if (m.hp <= 0) killMan(m, imp);
  }

  function killMan(m, imp) {
    m.dead = true; m.hp = 0;
    /* AND HE IS OUT OF THE FORMATION THE INSTANT HE IS HIT. frame() skips
       stepMan for a man carrying `formed`, and stepMan is what runs the fall
       and the ragdoll hand-off — so a man shot while standing in a section
       stayed bolt upright until his squad next thought. Cleared here rather
       than in stepSquad because the death is what ended his membership, and a
       state that is only correct on the next tick of something else is the
       kind of bug that photographs as "sometimes they die standing up". */
    m.formed = false;
    const by = imp && imp.by;
    if (by && by.team && by.team !== m.team) {
      by.kills = (by.kills || 0) + 1;
      if (by.s) by.s.kills = (by.s.kills || 0) + 1;
      if (by.isYou) { W.state.you.kills++; report.youKills++; }
      by.side.kills++;
    }
    if (m.isYou) {
      /* THE WARLORD GOES DOWN AND THE BATTLE IS OVER. Not "you respawn", not
         "your army fights on" — the brief is explicit, and it is also the only
         thing that makes standing in your own line a decision. */
      W.state.you.hp = 1;
      endBattle("lost", "YOU WENT DOWN");
      return;
    }
    m.side.deadN++;
    if (m.s) report.deadOf[m.team].push(m.s);
    /* HOW HE FALLS IS warlord/deaths.js's, ALL OF IT. This block used to be
       three lines — deathPose on frame zero, a coin-flip direction, and a
       one-axis plank — and the owner's report is exactly that: "death in
       warlord is instant". deaths.js's header carries the full diagnosis (the
       blood pack was never on this page, the hit-stop names belong to a frame
       loop this page does not run, and the pose landed before the fall). What
       is left here is what a BATTLE owns: that he died, who gets the credit,
       and that his rifle is now on the sand. */
    const D = DTH();
    if (D) D.fell(m, imp);
    // the rifle leaves his hands and lands like hardware — and it is the same
    // gun the aftermath will put in your cart
    const prop = m._weaponProp;
    if (prop && CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
      safe(function () {
        scene.attach(prop);
        m._weaponProp = null; m._weaponPropId = null;
        CBZ.weaponPhysics.drop(prop, {
          vx: (lcg() - 0.5) * 2.4, vy: 1.6 + lcg(), vz: (lcg() - 0.5) * 2.4,
          source: "warlord-death",
        });
        /* AND THE PROP REMEMBERS WHOSE IT WAS. Two facts, both needed by the
           pickup below and neither derivable from a mesh: what gun this is
           (actorweapons stamps userData.weaponId, so that one is free) and
           WHICH SOLDIER RECORD it came off. The aftermath builds your cart by
           walking every dead man's `s.wid` — so a rifle taken off the sand
           mid-fight has to be struck off its owner's row, or the same AK is
           counted twice: once in your hands and once in the baggage. */
        prop.userData.wlFrom = m.s || null;
        dropGuns.push(prop);
        if (dropGuns.length > 120) {
          const old = dropGuns.shift();
          if (old && old.parent) old.parent.remove(old);
        }
      });
    }
    m.armed = false;
    corpses.push(m);
    if (corpses.length > CORPSE_MAX) retireOldestCorpse();
    /* THE NAME IS NOT PRINTED ANY MORE. `feed(name + " DOWN")` said a word for
       a thing that should be a picture, and the word was the wrong one: you
       have not learned Hakim's name yet — the aftermath screen is where a name
       has time to be read — and the sentence never carried the one fact you
       would act on, which is WHERE your line is dying. deaths.js puts a red
       tick on the screen rim at his bearing instead. */
  }
  const SINK_NEAR2 = 45 * 45;
  function retireOldestCorpse() {
    let pick = -1;
    for (let i = 0; i < corpses.length; i++) if (camDist2(corpses[i].pos) > SINK_NEAR2) { pick = i; break; }
    if (pick < 0) pick = 0;
    const old = corpses.splice(pick, 1)[0];
    if (!old || !old.group) return;
    if (CBZ.ragdollDrop) safe(function () { CBZ.ragdollDrop(old); });
    const D = DTH(); if (D) D.forget(old);   // stop stepping a fall we are sinking
    if (old.ragdoll) { old.ragdoll = false; deadSolving = Math.max(0, deadSolving - 1); }
    old.retired = true;
    sinking.push({ g: old.group, t: 0 });
  }
  function stepSinking(dt) {
    for (let i = sinking.length - 1; i >= 0; i--) {
      const s = sinking[i];
      s.t += dt;
      s.g.position.y -= dt * 0.8;
      if (s.t > 2.2) { CBZ.studio.drop(s.g); sinking.splice(i, 1); }
    }
  }

  /* ============================================================ SIM STEP */
  function stepMan(m, sdt) {
    if (m.isYou) return;              // a thumb drives him, not this
    if (m.fled) return;
    if (m.dead) {
      if (m.ragdoll) return;          // the solver owns the transform
      /* THE FALL RUNS ON SIM TIME, which is why it is here and not on a frame
         hook: a battle at 8x has to bury its dead at 8x, and the studio's
         frozen clock has to advance them exactly as far as advance() asked
         for. deaths.js's four beats, ~6 float writes and one quaternion
         multiply per corpse per sub-step, and it stops writing the frame a
         corpse settles. */
      const D = DTH(); if (D) D.stepFall(m, sdt);
      return;
    }
    if (simT >= m.thinkAt) think(m, simT);
    if (m.reloadT > 0) { m.reloadT -= sdt; if (m.reloadT <= 0) m.mag = m.magSize; }
    m.cool -= sdt;

    const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const tgt0 = m.tgt;
    const tdist = tgt0 && !tgt0.dead ? Math.hypot(tgt0.pos.x - m.pos.x, tgt0.pos.z - m.pos.z) : 1e9;
    let spd = 0;
    if (d > 1.1) {
      const hurtish = m.hp < m.maxHp * 0.45;
      spd = m.slot === "rout" ? 7.6 :
            m.slot === "fallback" ? 5.2 :
            (m.slot === "push" || m.slot === "march" || m.slot === "flank") ? 6.2 :
            (m.slot === "cover" || hurtish) ? 7.0 : 4.6;
      // closing to the band is a RUN, whatever the slot says — battle.html's
      // own rule, and it is what stops a rifleman holding a fire token forty
      // metres out of his own range
      if (tdist < 1e9 && tdist > 42 && spd < 6.2) spd = 6.4;
      // ARMOUR COSTS YOU A STEP. core states `slow` per row and nothing was
      // spending it; a heavy kit that only ever helps is not a decision.
      spd *= (1 - (m.slow || 0));
      let nx = dx / d, nz = dz / d;
      if (m.detourT > 0) {
        m.detourT -= sdt;
        const sw = m.detourDir || 1;
        const tx = nz * sw, tz = -nx * sw;
        nx = tx; nz = tz;
      }
      const ox = m.pos.x, oz = m.pos.z;
      m.pos.x += nx * spd * sdt;
      m.pos.z += nz * spd * sdt;
      micro.resolveCircle(m.pos, m.rad, m.pos.y, 1.8);
      const got = Math.hypot(m.pos.x - ox, m.pos.z - oz);
      const want = spd * sdt;
      if (want > 0.001 && got < want * 0.25) {
        m.stuckT = (m.stuckT || 0) + sdt;
        if (m.stuckT > 0.8) {
          m.stuckT = 0;
          m.detourT = 1.5 + ((m.i % 5) * 0.35);
          m.detourDir = (m.i & 1) ? 1 : -1;
        }
      } else if (got > want * 0.6 && m.stuckT) m.stuckT = Math.max(0, m.stuckT - sdt * 2);
    } else {
      m.resT = (m.resT || 0) - sdt;
      if (m.resT <= 0) { m.resT = 0.25; micro.resolveCircle(m.pos, m.rad, m.pos.y, 1.8); }
    }
    m.speed = spd;
    /* WHERE HIS BOOTS MEET THE SAND — see THE BOOTS. sand.plant seats him on
       the drawn surface and leans him into the slope; it also stamps the
       print, which is what turns a charge across a dune into a road you can
       see from the ridge. MAP.groundAt stays the truth the sim uses for
       everything else — plant is a RENDERING answer, and seatMan is the
       relevance rule on it. */
    seatMan(m, sdt);

    // OFF THE EDGE OF THE WORLD. A routed man who reaches his own baseline has
    // left the battle: he lives, he is not a prisoner, and he is not a body
    // the sim has to keep stepping. This is what ENDS a broken army.
    if (m.routed && Math.abs(m.pos.x - MAP.cx) > FIELD_R * 0.95) {
      m.fled = true;
      if (m.s) report.fledOf[m.team].push(m.s);
      if (m.group) m.group.visible = false;
      return;
    }

    /* WORKING THE FOLD. Down behind the lip, up to shoot, down again. While
       he is down setStance has dropped his losY below the crest, so the enemy
       line's eyeLos to him fails: he is not "harder to hit", he is not there.
       `m.up` is what the trigger reads. */
    m.up = true;
    if (m.hull && m.slot === "hull" && !m.routed) m.up = workHull(m, sdt);

    const tgt = m.tgt;
    const engaged = tgt && !tgt.dead && m.sees;
    if (!engaged && spd > 0.1) {
      const want = Math.atan2(dx, dz);
      let dy = want - m.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      m.yaw += dy * Math.min(1, sdt * 7);
      /* THE YAW IS NOT WRITTEN HERE ANY MORE when sand.js is planting him:
         plant() sets a full orientation (yaw plus the lean into the slope)
         and a bare rotation.y assignment after it clobbers the lean on
         exactly the men who are moving — which is every man who matters. */
      if (!(W.sand && W.sand.plant)) m.group.rotation.y = m.yaw;
    }

    // ---- the trigger ----
    if (m.routed) return;             // a broken man is not fighting
    if (!tgt || tgt.dead || tgt.fled || m.reloadT > 0) return;
    const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    const p = CBZ.combatIQ && CBZ.combatIQ.profile ? CBZ.combatIQ.profile(m) : null;
    /* THE SIGHT ON HIS RIFLE SETS HOW FAR HE FIGHTS. combat_iq's WEAP columns
       were authored off weapon NAMES at a time when nothing in this engine had
       an optic, so `hi` describes a man over iron sights — see IQ.sight, which
       is a pure read and changes nobody's numbers by existing. reachMul is the
       square root of the ratio of aiming errors (a 2 mm front post at 60 cm
       subtends 3.3 mrad; a 10x mil-dot reticle 0.3), so the man you hand the
       sniper to is the man who can still shoot at 300 m and the man with the
       AK is not. REACH_CAP was a flat 125 for everybody. */
    const sg = (CBZ.combatIQ && CBZ.combatIQ.sight) ? CBZ.combatIQ.sight(m) : null;
    const rMul = sg ? sg.reachMul : 1;
    const fireMax = p ? Math.min(REACH_CAP * rMul, p.hi * rMul * 2.6 + 8) : 60;
    if (!m.sees || dist > fireMax) return;
    /* A FLANKING MAN SHOOTS. battle.html's trigger gate excludes the "flank"
       slot and it is right to: there, "flank" is combat_iq's word for "you do
       not hold the fire token, go work an angle", and a man without the token
       is supposed to be quiet.

       Here "flank" is also an ORDER — a manoeuvre a person chose — and under
       that order a man walks up to fifty metres around the enemy mass. With
       the donor's gate he made that entire walk without pulling a trigger
       once, which turns a flank into a column of free targets: MEASURED on the
       third before/after pair, ordering FLANK at t=28 in an even 34 v 34 lost
       the battle by t=39, and the same fight held on HOLD. A flank that cannot
       shoot is not a flank, it is a parade. */
    /* A MAN BEHIND A CREST IS NOT SHOOTING THROUGH IT. "hull" joins the list
       of slots that shoot — that is the whole point of a reverse-slope
       position — but only on the beat he is UP. Down, he holds his fire; the
       terrain would eat the round anyway (eyeLos below re-checks it against
       his dropped eye height), and firing from a position that hides you is
       the incoherence this replaces. */
    if (m.slot === "hull" && !m.up) return;
    if (m.slot !== "fire" && m.slot !== "peek" && m.slot !== "push" &&
        m.slot !== "sidestep" && m.slot !== "fallback" && m.slot !== "hull" &&
        m.slot !== "flank" && dist > 12) return;
    if (m.cool > 0) return;
    m.sees = eyeLos(m, tgt);
    if (!m.sees) { m.cool = 0.12; return; }
    const side = mateInLane(m, tgt);
    if (side) {
      // step off your own man's firing line rather than put a ghost round
      // through him — battle.html measured one round in five doing exactly that
      const ddx = tgt.pos.x - m.pos.x, ddz = tgt.pos.z - m.pos.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      const nx = ddx / dd, nz = ddz / dd, sg = -side;
      m.target.set(m.pos.x + nz * sg * 2.4, 0, m.pos.z - nx * sg * 2.4);
      m.slot = "sidestep"; m.stepAsideT = 0.55;
      m.cool = Math.max(m.cool, 0.18);
      return;
    }
    const w = CBZ.weaponById(m.wid);
    /* sdt, NOT 0. combat_iq's reaction beat (_iqReact) only drains inside
       aimTick, and aimTick only sees a dt from posture() — the HOLD path — or
       from this call. battle.html passes 0 here and gets away with it because
       every one of its men goes through posture() every think. Ours do not:
       CHARGE, FLANK, FALL BACK, FOLLOW and MOVE all return before posture(),
       so a man on any of those orders who picked up a NEW target had a
       reaction timer nobody was counting down, and shot() answered
       "not yet" forever. MEASURED in the duel: their champion walked 170 m
       under CHARGE to within one metre of the warlord, sees=true, slot=push,
       and fired zero rounds in sixty seconds. A charge that cannot shoot is
       the quiet charge the scale check kept measuring. */
    const r = CBZ.combatIQ && CBZ.combatIQ.shot
      ? CBZ.combatIQ.shot(m, tgt, dist, sdt, w ? w.damage : 14) : null;
    if (!r) { m.cool = 0.5; return; }
    m.cool = r.cd;
    if (!r.fire) return;
    /* AND THE SAME SIGHT PAYS THE HIT BACK. combat_iq.shot() already rolled
       hitChance with the class's own linear range falloff; the optic refunds
       the part of that falloff the glass removes. Applied HERE rather than
       inside combat_iq for one reason: that file is shared by every armed body
       in the city and this is a warlord balance decision. `hit` is a
       probability — battle.js rolls it itself in fireShot — so scaling it is a
       read-and-adjust, not a second dice. */
    if (rMul > 1 && p && dist > 10) {
      const refund = p.falloff * (dist - 10) * (1 - 1 / rMul);
      r.hit = Math.max(0.04, Math.min(0.92, r.hit + refund));
    }
    fireShot(m, tgt, r);
    if (m.mag <= 0) {
      m.reloadT = (w && (w.reloadTime || w.reload)) || 1.6;
    }
  }

  /* ============================================================ THE WARLORD
     WHAT IS LEFT OF HIM HERE. His body, his health, his spawn, and the command
     seat. HIS GUN IS NOT HERE and must never come back: warlord/gunplay.js
     mounts systems/fpsmode.js — the repo's one player weapon system, the same
     one games/index.html's jail and modes/gungame.js drive — and that file
     owns the aim, the trigger, the spread, the recoil pattern, ADS, the
     reload, the reticle, the hit marker, the falloff and the weapon switch.
     The old hand-rolled version of all of that lives on behind ?gunplay=old
     inside gunplay.js, which is where it can be deleted in one go.

     THE COMMAND SEAT stays here because it is not a gun: it is the Bannerlord
     chair over your own army, it belongs to the battle, and gunplay.js hands
     the lens back the moment the mode is "cmd". */
  const CAMS = ["fps", "third", "cmd"];
  let camMode = "fps";
  let hudSyncOrders = null;      // set by buildHud; keeps the order rail honest
  let hurtFlash = 0;
  /* THE COMMAND SEAT'S DEFAULTS, and the first draft's were a satellite photo:
   120 m out at 0.55 rad puts the lens 62 m up, which draws a 1.8 m man as two
   pixels and fills the frame with sand. A commander's shot is LOW and near
   enough that the two lines read as lines — 62 m at 0.32 rad is about 19 m up,
   which keeps the horizon in frame and the men legible. */
const cmd = { x: 0, z: 0, dist: 62, yaw: 0.9, pitch: 0.32, auto: true };

  /* DRIVING THE COMMAND SEAT. It flies, it does not fight, and that is exactly
     why it stayed in this file when the gun left: WASD here is not a man
     walking, it is a commander panning over his own army, and the wheel is not
     a weapon switch. This used to live inside stepYou() beside the trigger,
     which is the only reason it read as part of the player controller. */
  function stepCommand(dt) {
    const IN = micro.input, T = micro.touch;
    const fwd = 60 * dt * (cmd.dist / 90 + 0.4);
    let mx = IN ? IN.axis("KeyA", "KeyD") : 0, mz = IN ? IN.axis("KeyS", "KeyW") : 0;
    if (T && T.active && T.stick.mag > 0.05) { mx += T.stick.x; mz += -T.stick.y; }
    if (mx || mz) {
      cmd.x += (-Math.sin(cmd.yaw) * mz - Math.cos(cmd.yaw) * mx) * fwd;
      cmd.z += (-Math.cos(cmd.yaw) * mz + Math.sin(cmd.yaw) * mx) * fwd;
    }
    if (IN) {
      cmd.yaw -= IN.mx * 0.004;
      cmd.pitch = clamp(cmd.pitch - IN.mz * 0.003, 0.16, 1.4);
      if (IN.wheel) { cmd.auto = false; cmd.dist = clamp(cmd.dist * (IN.wheel > 0 ? 1.12 : 0.9), 24, 320); }
    }
    if (YOU) YOU.speed = 0;
  }

  /* THE SEAM gunplay.js drives the warlord through. Functions, not state: this
     is the only door out of the battle, so a gun system cannot reach in and
     change anything the battle did not offer. Every entry lands on a rule that
     already existed in this file. */
  function gunplayApi() {
    return {
      THREE: THREE, micro: micro, ctx: ctx, coarse: !!ctx.coarse,
      setCam: setCam,
      live: function () { return live && !over; },
      you: YOU,
      youRig: youRig,
      men: function () { return men; },
      groundAt: function (x, z) { return MAP.groundAt(x, z); },
      losBlockers: addedMeshes,        // the rocks. Your rounds stop on cover too.
      blocked: function (ax, ay, az, bx, by, bz) {
        return micro.segmentBlocked(ax, ay, az, bx, by, bz) ||
          (MAP.terrainLos && terrainBlocked(ax, ay, az, bx, by, bz));
      },
      /* A ROUND FROM THE WARLORD LANDS THROUGH THE SAME TWO FUNCTIONS AN NPC'S
         DOES. fpsmode has already taken the weapon's own damage off m.hp by
         the time hit() is called (gunplay.js's knockback shim explains the
         seam and puts the armour soak back); what is left is the part that is
         the BATTLE's: suppression, who he turns on, and the kill funnel with
         its ragdoll, dropped rifle, kill credit, morale and corpse budget. */
      /* THE ONE SOAK FORMULA, lent out rather than copied. gunplay.js has to
         re-apply the warlord's round through armour (fpsmode has no soak
         concept and takes the raw damage off itself), and a second
         `dmg - soak` written over there is exactly how two files start
         disagreeing about what a plate does. */
      soak: function (m, dmg) { return hurtOne(m, dmg); },
      /* AND THE ROUND SAYS WHERE IT LANDED. `head` rides through to killMan so
         warlord/deaths.js can spend the head treatment on it: the gore burst
         at 1.62 m instead of 1.15, the ragdoll kick seated at head height
         (which is the only way city/ragdoll.js can know to whip the skull —
         it decides that by whether the hit point is within 0.6 m of the head
         mass point), the "headshot" cue instead of the "hit" one, and
         doSlowmo(0.18). Before this, YOUR headshots were the only shots in the
         game that could not tell they were headshots: fpsmode's non-city
         gunHit builds no impulse record for a lethal round, so the flag died
         at the seam. gunplay.js's knockback shim recovers it. */
      hit: function (m, dealt, head) {
        if (!m || m.dead || over) return;
        if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(m, 0.9);
        if (!m.tgt || m.tgt.dead) m.tgt = YOU;
        SIDES.mine.hits++;
        if (m.hp <= 0) killMan(m, { by: YOU, headshot: !!head });
      },
      kill: function (m, head) {
        if (m && !m.dead && !over) killMan(m, { by: YOU, headshot: !!head });
      },
      shot: function (n) { SIDES.mine.shots += (n || 1); },
      hitCount: function () { SIDES.mine.hits++; },
      // the legacy controller's own damage call — one funnel, still
      legacyHurt: function (m, dmg) { hurtMan(m, dmg, { by: YOU, raw: true }); },
    };
  }
  const GP = function () { return W.gunplay || null; };

  /* ---- LOADING THE GUN, and why it is done from here.
     games/warlord.html's WARLORD list is the page's, not this file's, and
     gunplay.js arrived after it was written. That is fine and arguably right:
     this file is gunplay.js's only consumer, a campaign ride does not need a
     first-person weapon system, and the page's boot bar is already forty files
     long on a phone. So the module fetches its own dependency at boot and the
     first battle waits on it — one round trip, once, off the critical path of
     the title screen. (If the page ever DOES list it, the file's own family
     guard makes this a no-op.)
     The orchestrator may add "warlord/gunplay.js" to that list; nothing here
     needs to change if it does. */
  let gunplayReady = null;
  function loadGunplay() {
    if (gunplayReady) return gunplayReady;
    gunplayReady = new Promise(function (resolve) {
      if (W.gunplay) return resolve(true);
      const src = (CBZ.studio && CBZ.studio.root ? CBZ.studio.root : "../src/") + "warlord/gunplay.js";
      const el = document.createElement("script");
      el.src = src; el.async = false;
      el.onload = function () { resolve(true); };
      el.onerror = function () { console.warn("[warlord/battle] gunplay.js did not load"); resolve(false); };
      document.head.appendChild(el);
    }).then(function () {
      return W.gunplay ? W.gunplay.ensure() : false;
    });
    return gunplayReady;
  }
  let gunplayDone = false;

  /* ---- warlord/deaths.js — THE DEATH SEQUENCE ---------------------------
     Loaded the same way gunplay.js is, and for the same two reasons: this
     page's NEED list is games/warlord.html's and battle.js cannot edit it, and
     a campaign that never reaches a fight should not pay for the fight's
     files. deaths.js owns the whole death path (the beats, the tier budget,
     the blood, the hit-stop clock and the rim) — including the OLD one, under
     ?deaths=old, so this file carries exactly one way for a man to die.

     Every call site below is `const D = DTH(); if (D) …`. If the file never
     arrives the battle still runs: nobody falls over, which is a visible
     failure rather than a silent one, and the console says why. */
  let deathsReady = null;
  function loadDeaths() {
    if (deathsReady) return deathsReady;
    deathsReady = new Promise(function (resolve) {
      if (W.deaths) return resolve(true);
      const src = (CBZ.studio && CBZ.studio.root ? CBZ.studio.root : "../src/") + "warlord/deaths.js";
      const el = document.createElement("script");
      el.src = src; el.async = false;
      el.onload = function () { resolve(true); };
      el.onerror = function () { console.warn("[warlord/battle] deaths.js did not load"); resolve(false); };
      document.head.appendChild(el);
    });
    return deathsReady;
  }
  function DTH() { return W.deaths || null; }

  /* ============================================================ CAMERA */
  function camDist2(p) {
    const c = CBZ.camera.position;
    return (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) + (p.z - c.z) * (p.z - c.z);
  }
  function stepCamera(dt) {
    const c = CBZ.camera;
    if (camMode === "cmd") {
      /* THE COMMAND SEAT FOLLOWS THE FIGHT — and "the fight" is not the
         midpoint of the two masses. MEASURED on the first before/after pair:
         at t=11 the two lines were still 160 m apart, the midpoint was empty
         sand, and both armies sat 80 m off either side of the lens as a
         fifteen-pixel smudge. The midpoint is the right answer once they are
         IN contact and the wrong one for every second before that.

         So the focus is the midpoint and the RANGE is the spread: far enough
         back to hold both masses, never so far that a 1.8 m man stops being a
         man. `autoDist` is only used when nobody has set a distance by hand —
         a person driving the wheel keeps what they chose. */
      const fx = (SIDES.mine.comX + SIDES.them.comX) * 0.5;
      const fz = (SIDES.mine.comZ + SIDES.them.comZ) * 0.5;
      if (!cmd.init) { cmd.x = fx; cmd.z = fz; cmd.init = 1; }
      if (cmd.auto) {
        const sep = Math.hypot(SIDES.mine.comX - SIDES.them.comX, SIDES.mine.comZ - SIDES.them.comZ);
        cmd.dist = clamp(34 + sep * 0.62, 40, 210);
      }
      const k = 1 - Math.pow(0.06, dt);
      cmd.x += (fx - cmd.x) * k * 0.5;
      cmd.z += (fz - cmd.z) * k * 0.5;
      const fy = MAP.groundAt(cmd.x, cmd.z);
      const sx = Math.sin(cmd.yaw) * Math.cos(cmd.pitch), sz = Math.cos(cmd.yaw) * Math.cos(cmd.pitch);
      const sy = Math.sin(cmd.pitch);
      const px = cmd.x + sx * cmd.dist, pz = cmd.z + sz * cmd.dist;
      let py = fy + sy * cmd.dist;
      const g = MAP.groundAt(px, pz) + 3;
      if (py < g) py = g;
      c.position.set(px, py, pz);
      c.lookAt(cmd.x, fy + 1.2, cmd.z);
      if (youRig) youRig.visible = true;
      return;
    }
    /* THE OTHER TWO SEATS BELONG TO THE GUN. First person and over-the-
       shoulder are not camera modes here, they are the two ways fpsmode.js
       presents a weapon (fps.active vs shoulderActive), and the lens has to be
       exactly where the aim is or the reticle lies about where the round goes
       — which is precisely what the fork's third person did. gunplay.js places
       both from the aim direction fpsmode publishes, one frame ahead of
       fpsmode's own pass. Nothing to do here. */
  }
  function setCam(mode) {
    camMode = mode;
    /* AND THE LENS MOVES NOW, NOT NEXT FRAME. stepCamera()/gunplay place the
       camera and both only run inside a frame — so a tool that switches to
       first person and renders immediately (which is exactly what a screenshot
       preset does) photographed the PREVIOUS seat. MEASURED: the subject
       captioned "CHARGE, from inside the line" came back as a wide command
       shot with no viewmodel in it. One framing pass costs nothing and removes
       the whole class of stale-camera capture. */
    const gp = GP();
    if (gp && gp.on()) gp.camera(mode);
    if (mode === "cmd" && live && MAP && YOU) safe(function () { stepCamera(0.016); });
    /* AND EVERYBODY IN THE NEW FRAME IS RE-POSED. posePass skips men outside
       the lens's own cone, so the men behind the seat you just LEFT are
       carrying whatever pose they had when they were last on screen. In play
       that is one frame. In a still — and setCam exists partly for the stills
       — it is the whole picture. `force` also ignores the distance ladder for
       this one pass, so the far half of the field is posed too. */
    if (live && MAP) safe(function () { posePass(0, true); });
    /* THE BUTTON NAMES WHERE IT TAKES YOU, in both places that write it.
       syncOrderRail below has always labelled it as the DESTINATION ("THIRD
       PERSON" while you are in first) and this line labelled it as the CURRENT
       seat ("FIRST PERSON" while you are in first) — two conventions on one
       button, and whichever ran last won. Caught on the first before/after
       pair: a first-person frame with a button on it reading FIRST PERSON. */
    const b = document.getElementById("wbCam");
    if (b) b.textContent = camLabel(mode);
    if (mode === "cmd" && micro.lock && micro.unlock && !ctx.coarse) safe(function () { micro.unlock(); });
  }
  function cycleCam() { setCam(nextCam(camMode)); }
  function nextCam(m) { return CAMS[(CAMS.indexOf(m) + 1) % CAMS.length]; }
  // what the toggle takes you to next, named for the seat you will land in
  function camLabel(m) {
    const to = nextCam(m);
    return to === "fps" ? "FIRST PERSON" : to === "third" ? "OVER SHOULDER" : "COMMAND";
  }

  /* ============================================================ THE FLOOR
     TAKE THE GUN OFF THE SAND.

     OWNER, verbatim: "when u kill in battle guns already drops nicely add e to
     pickup or to switch guns each guy carries one and for touch a button to
     switch guns mid battle to whatever is on the ground in front of you."

     Everything this needs already existed and none of it was wired to
     anything. killMan reparents the dead man's ACTUAL rifle into the scene and
     hands it to CBZ.weaponPhysics, which bounces it off the ground and settles
     it on its own lowest vertex; actorweapons stamps `userData.weaponId` on
     every model it builds; and core.js's W.equip is already a SWAP that puts
     the gun you were holding back in the cart in the same call. `dropGuns` sat
     there push-only — a list of rifles nobody could touch. This is the reach.

     THREE RULES, and they are the whole design:

       · IT IS THE SAME GUN. Not a spawned pickup, not a loot roll — the mesh
         you walk up to is the model that came out of that man's hands, and the
         id you end up holding is the id he was carrying. That is why the
         prompt can name it.

       · IT COMES OFF HIS ROW. The aftermath cart is built by walking every
         dead soldier's `s.wid` (see report.loot), so taking a rifle off the
         sand strikes it from the man it belonged to. Without that line the
         same AK is in your hands AND in your baggage after the battle, which
         is a gun printer with extra steps.

       · YOUR OWN GUN IS NEVER LOST. W.equip stashes what you were holding, so
         a swap mid-firefight puts your old rifle in the cart rather than on
         the ground. You cannot pick up a worse gun and lose a better one to a
         corpse pile you will never find again.

     AND PICKING UP THE GUN YOU ALREADY HOLD IS AMMUNITION, not a no-op:
     W.equip returns early on a matching id, so the stash stands and the spare
     in the cart is what gunplay's setReserves() reads as another gun's worth
     of magazines. The prompt says AMMO instead of TAKE, because that is what
     it is, and it is the reason a dry warlord standing over four bodies has
     something to do.

     ONE INPUT PATH FOR BOTH DEVICES. The key is polled off microboot's own
     input (rising edge on KeyE) rather than listened for, because the touch
     button synthesises KeyE into exactly that input map — so the phone button
     and the keyboard land on the same line of code instead of two. The edge is
     tracked here rather than through IN.pressed() on purpose: microboot runs
     frame hooks once per SUBSTEP, and `pressed` stays true for every substep
     of the frame it fired on — which is up to twelve rifles off one tap.

     Flag: ?take=off reverts to the old push-only list. */
  const PICK_R = 2.6;              // arm's reach plus a step. A rifle is 1.1 m
                                   // long and settles across its own length.
  const PICK_R2 = PICK_R * PICK_R;
  const TAKE_OFF = function () { return Q && Q.get("take") === "off"; };
  let pickHeld = false;            // last frame's KeyE, for the rising edge
  let pickTgt = null;              // the mesh currently in reach
  let pickLbl = "";                // what the prompt last said
  let pickTook = 0;                // rifles taken off the sand this battle

  /* WHICH GUN IS IN REACH. Nearest wins, and only a gun that has stopped
     moving: a rifle still tumbling out of a man's hands is not a thing you
     have picked up, and a point-blank kill would otherwise put the prop inside
     the radius on the frame it spawns and swallow the whole toss. That is
     systems/prisondrops.js's `d.rest` guard, arrived at the same way. */
  function nearestDrop() {
    if (!YOU || YOU.dead || over) return null;
    const px = YOU.pos.x, py = YOU.pos.y, pz = YOU.pos.z;
    let best = null, bd = PICK_R2;
    for (let i = 0; i < dropGuns.length; i++) {
      const g = dropGuns[i];
      if (!g || !g.parent) continue;
      const b = g.userData && g.userData.weaponBody;
      if (b && !b.settled) continue;                 // still in the air
      const dx = g.position.x - px, dz = g.position.z - pz;
      const dy = g.position.y - py;
      // a rifle on a roof you are standing under is not in reach
      if (dy > 2.4 || dy < -2.4) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = g; }
    }
    return best;
  }

  function pickLabelFor(g) {
    const id = g && g.userData && g.userData.weaponId;
    if (!id) return "";
    const nm = W.gunLabel ? W.gunLabel(id) : gunName(id);
    return (id === W.state.you.wid ? "AMMO · " : "TAKE ") + String(nm).toUpperCase();
  }

  /* TAKING IT. Six lines of bookkeeping and every one of them is somebody
     else's rule being called rather than re-written here. */
  function takeDrop(g) {
    const id = g && g.userData && g.userData.weaponId;
    if (!id) return false;
    const gp = GP();
    // a gun fpsmode has no row for is a gun the warlord cannot hold — better
    // to leave it on the sand than to put an id in his hands that renders as
    // nothing and fires nothing.
    if (gp && gp.canHold && !gp.canHold(id)) return false;
    W.stash(id, 1);
    W.equip(W.state.you, id);
    /* HIS ROW LOSES THE RIFLE. See the header: the aftermath cart is built off
       the dead men's own wid fields, and this gun is no longer on the body. */
    const from = g.userData.wlFrom;
    if (from && from.wid === id) from.wid = "fists";
    if (CBZ.weaponPhysics && CBZ.weaponPhysics.release) safe(function () { CBZ.weaponPhysics.release(g); });
    if (g.parent) g.parent.remove(g);
    const at = dropGuns.indexOf(g);
    if (at >= 0) dropGuns.splice(at, 1);
    // the man in the roster carries what the man on the sand is carrying
    YOU.wid = W.state.you.wid;
    YOU.weapon = gunName(YOU.wid);
    if (gp && gp.rearm) safe(function () { gp.rearm(id); });
    pickTook++;
    /* NO "AK-47 OFF THE SAND" LINE EITHER, for the reason the panel above
       already stopped printing the magazine: systems/fpsmode.js's #ammo
       readout writes the weapon's NAME over its rounds and changes the frame
       gp.rearm() lands, so the sentence was the same fact eight inches away
       in a different font. The gun in your hands changing model IS the
       picture; the click is the confirmation. */
    if (CBZ.sfx) safe(function () { CBZ.sfx("pickup"); });
    pickTgt = null;
    return true;
  }

  function stepPickup() {
    if (TAKE_OFF() || !started || !live) return;
    const IN = micro && micro.input;
    const down = !!(IN && IN.isDown("KeyE"));
    const edge = down && !pickHeld;
    pickHeld = down;

    /* THE COMMAND SEAT HAS NO HANDS. You are looking down at your army from
       sixty metres up; the warlord's body is standing still wherever you left
       it and a reach prompt there would be a button that acts at a distance. */
    const g = camMode === "cmd" ? null : nearestDrop();
    pickTgt = g;

    const el = document.getElementById("wbPick");
    const lbl = g ? pickLabelFor(g) : "";
    if (el && lbl !== pickLbl) {
      pickLbl = lbl;
      el.innerHTML = lbl ? ('<b class="k">E</b>' + lbl) : "";
      el.classList.toggle("on", !!lbl);
    }
    const gp = GP();
    if (gp && gp.showPick) gp.showPick(!!g, lbl);

    if (edge && g) takeDrop(g);
  }

  /* ============================================================ THE HUD
     Four orders, a retreat, two morale bars and the two things a man in a
     firefight actually needs: how hurt he is and how many rounds are left.
     Built in code and REMOVED on teardown — the page's #stage belongs to the
     screens, and a battle is not a screen. */
  function buildHud() {
    const css = document.createElement("style");
    css.id = "wbCss";
    css.textContent =
      "#wb{position:fixed;inset:0;z-index:45;pointer-events:none;font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:#f4ecd8}" +
      "#wb .bar{position:absolute;left:50%;top:calc(var(--wl-safe-t, env(safe-area-inset-top,0px)) + 8px);transform:translateX(-50%);" +
        "display:flex;gap:10px;align-items:center;padding:7px 13px;border-radius:999px;white-space:nowrap;" +
        "background:rgba(12,10,7,.62);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(6px)}" +
      "#wb .cnt{font-weight:800;font-size:15px}" +
      "#wb .mo{width:min(19vw,120px);height:7px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden}" +
      "#wb .mo s{display:block;height:100%;transition:width .25s}" +
      "#wb .mid{font-size:10px;letter-spacing:.2em;opacity:.65;text-align:center;min-width:74px}" +
      /* width:max-content — an absolutely positioned box at left:50% shrink-fits
         into the HALF of the screen to its right, so five orders plus the seat
         toggle wrapped onto two rows at 1180 px with 500 px of empty screen
         either side. max-width still caps it at the viewport. */
      "#wb .ord{position:absolute;left:50%;bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 10px);transform:translateX(-50%);" +
        "display:flex;gap:7px;pointer-events:auto;flex-wrap:wrap;justify-content:center;width:max-content;max-width:96vw}" +
      "#wb .ord button{appearance:none;border:1px solid rgba(255,255,255,.2);background:rgba(12,10,7,.66);" +
        "color:inherit;border-radius:12px;padding:11px 14px;font:800 12px/1 inherit;letter-spacing:.1em;cursor:pointer;" +
        "backdrop-filter:blur(6px)}" +
      "#wb .ord button.on{background:rgba(255,138,61,.34);border-color:#ff8a3d}" +
      "#wb .ord button.bad{border-color:#c4453a}" +
      /* A PHONE HAS NO NUMBER KEYS, so the digits come off and the buttons
         get small enough to sit on ONE row. At 393 pt the four orders plus a
         camera toggle wrapped to five rows up the middle of the screen, on top
         of the trigger and on top of the warlord's own health panel — the
         touch cluster is drawn by warlord/gunplay.js above this rail and had
         nowhere to be. The repo's own touch doctrine says the movement and
         combat controls are ICONS and a prompt spells the VERB, never a
         keyboard letter; this rail was doing the opposite on the one device
         where the letter means nothing. */
      "body.coarse #wb .ord button{padding:12px 10px;font-size:11px;letter-spacing:.06em}" +
      "body.coarse #wb .ord{max-width:99vw;gap:5px;justify-content:center}" +
      "body.coarse #wb .ord button .k{display:none}" +
      "body.coarse #wb .me{bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 124px)}" +
      "body.coarse #wb .ret{bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 124px)}" +
      "#wb .me{position:absolute;left:calc(var(--wl-safe-l, env(safe-area-inset-left,0px)) + 14px);bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 74px);" +
        "padding:9px 12px;border-radius:12px;background:rgba(12,10,7,.55);border:1px solid rgba(255,255,255,.12)}" +
      "#wb .hp{width:132px;height:5px;border-radius:3px;background:rgba(255,255,255,.16);margin:6px 0 6px;overflow:hidden}" +
      "#wb .hp s{display:block;height:100%;background:#5aa86a}" +
      "#wb .ammo{font-variant-numeric:tabular-nums;letter-spacing:.14em;font-size:12px;opacity:.85}" +
      "#wb .ret{position:absolute;right:calc(var(--wl-safe-r, env(safe-area-inset-right,0px)) + 14px);bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 74px);pointer-events:auto}" +
      "#wb .ret button{appearance:none;border:1px solid #c4453a;background:rgba(12,10,7,.66);color:#ffc9c4;" +
        "border-radius:12px;padding:10px 13px;font:700 11px/1 inherit;letter-spacing:.14em;cursor:pointer}" +
      "#wb .hit{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 50%,transparent 45%,rgba(196,69,58,.55));opacity:0}" +
      "#wb .note{position:absolute;left:50%;top:20%;transform:translateX(-50%);font-size:clamp(16px,4.4vw,30px);" +
        "letter-spacing:.12em;opacity:0;transition:opacity .35s;text-shadow:0 2px 12px #000;white-space:nowrap}" +
      "#wb .note.on{opacity:.95}" +
      "#wb .cap{position:absolute;left:50%;top:calc(var(--wl-safe-t, env(safe-area-inset-top,0px)) + 44px);transform:translateX(-50%);" +
        "font-size:10px;letter-spacing:.16em;opacity:.55;white-space:nowrap}" +
      /* THE REACH PROMPT. Centred and just under the reticle, which is
         where a man looks when he is standing over the thing he wants —
         not in a corner panel he would have to leave the fight to read.
         The KEY CAP is a <b class="k">, the same class the order rail
         uses for its digits, so the one `body.coarse` rule below takes
         the letter off BOTH rails: on a phone the verb is the whole
         prompt and the button beside it is the key. */
      "#wb .pick{position:absolute;left:50%;top:calc(50% + 42px);transform:translateX(-50%);" +
        "display:flex;align-items:center;gap:9px;padding:7px 14px;border-radius:999px;white-space:nowrap;" +
        "font-size:12px;font-weight:800;letter-spacing:.14em;opacity:0;transition:opacity .12s;" +
        "background:rgba(12,10,7,.66);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px)}" +
      "#wb .pick.on{opacity:.96}" +
      "#wb .pick .k{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;" +
        "border-radius:5px;background:rgba(255,138,61,.34);border:1px solid #ff8a3d;font-size:11px;font-weight:800}" +
      /* AND ON A PHONE IT IS NOT HERE AT ALL. gunplay.js's reach control is a
         word pill that already says TAKE .50 DESERT EAGLE in the thumb column;
         printing the same sentence again under the reticle is the second
         readout, and the first capture had it landing on the AIM button. */
      "body.coarse #wb .pick{display:none}";
    document.head.appendChild(css);

    const root = document.createElement("div");
    root.id = "wb";
    root.innerHTML =
      '<div class="bar">' +
        '<span class="cnt" id="wbMine" style="color:#ffb347">0</span>' +
        '<span class="mo"><s id="wbMineMo" style="background:#ffb347;width:100%"></s></span>' +
        '<span class="mid"><span id="wbClock">0:00</span><br><span id="wbOrd">HOLD</span></span>' +
        '<span class="mo"><s id="wbThemMo" style="background:#c4593a;width:100%"></s></span>' +
        '<span class="cnt" id="wbThem" style="color:#e08a6a">0</span>' +
      '</div>' +
      '<div class="cap" id="wbCap"></div>' +
      '<div class="me"><div id="wbName">WARLORD</div><div class="hp"><s id="wbHp"></s></div>' +
        '<div class="ammo" id="wbAmmo"></div></div>' +
      '<div class="ret"><button id="wbRetreat">RETREAT</button></div>' +
      /* THE ORDERS ARE FOR AN ARMY, so they only exist when there is one.
         The owner rode out alone, picked a fight, and was handed CHARGE /
         HOLD / FLANK / FALL BACK with nobody to give them to — four buttons
         that could not do anything, on the one screen where a mis-tap costs
         you the run. Fighting alone is not a degenerate case in this game,
         it is DAY ONE and the whole opening: you start with no men and you
         earn them. So the command rail is built empty and filled by
         syncOrderRail() below, and a lone warlord gets a camera toggle and a
         trigger, which is the entire control surface he actually has. */
      '<div class="ord" id="wbOrders"></div>' +
      '<div class="pick" id="wbPick"></div>' +
      '<div class="hit" id="wbHit"></div>' +
      '<div class="note" id="wbNote"></div>';
    document.body.appendChild(root);
    hud = root;

    syncOrderRail();
    document.getElementById("wbRetreat").addEventListener("click", function (e) {
      e.stopPropagation(); endBattle("retreat", "YOU BREAK OFF");
    });

    /* Rebuilt whenever the size of your command changes — which in this game
       is constantly, because men die and prisoners join. It is cheap (five
       buttons) and it is the only way the rail can stay honest about what you
       can actually order. */
    function syncOrderRail() {
      /* wbOrders, NOT wbOrd — the header already owns wbOrd for the current
         order NAME, and the first draft of this rail reused that id. Two
         elements answered to it, getElementById returned the header span,
         and the rail and the order readout spent the battle overwriting each
         other: the buttons vanished and the header read "HOLD" as a div. */
      const ord = document.getElementById("wbOrders");
      if (!ord) return;
      // the men you can give an order to: your side, alive, not you
      let commanded = 0;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m && m.team === "mine" && !m.dead && !m.fled && !m.isYou) commanded++;
      }
      const had = ord.getAttribute("data-n");
      if (had === String(commanded)) return;          // nothing changed; don't churn the DOM
      ord.setAttribute("data-n", String(commanded));
      let h = "";
      // the digit is a KEYBOARD hint; on glass it is a lie taking up a third
      // of the button. See the coarse CSS above.
      const n = function (d, label) { return ctx.coarse ? label : (d + " " + label); };
      if (commanded > 0) {
        h += '<button data-o="charge">' + n(1, "CHARGE") + '</button>' +
             '<button data-o="hold" class="' + ((SIDES.mine && SIDES.mine.order === "hold") ? "on" : "") + '">' + n(2, "HOLD") + '</button>' +
             '<button data-o="flank">' + n(3, "FLANK") + '</button>' +
             '<button data-o="fallback">' + n(4, "FALL BACK") + '</button>' +
             /* the fifth verb. "FOLLOW", not "FOLLOW ME": with the camera
                toggle beside them six worded buttons wrapped onto two rows at
                1180 px, and on glass five have to share one 393 pt row. */
             '<button data-o="follow">' + n(5, "FOLLOW") + '</button>';
      }
      /* THE SEAT TOGGLE IS A BUTTON ONCE. gunplay.js draws a view icon in the
         thumb cluster on a coarse pointer, and a second worded one in the
         command rail is the same verb twice, in the row where a mis-tap
         changes your army's orders. */
      if (!ctx.coarse) h += '<button id="wbCam">' + camLabel(camMode) + '</button>';
      ord.innerHTML = h;
      ord.querySelectorAll("[data-o]").forEach(function (b) {
        b.addEventListener("click", function (e) { e.stopPropagation(); setOrder(b.dataset.o, "mine"); });
      });
      const cam = document.getElementById("wbCam");
      if (cam) cam.addEventListener("click", function (e) { e.stopPropagation(); cycleCam(); });
    }
    hudSyncOrders = syncOrderRail;
    /* THE TRIGGER, THE CROSSHAIR AND THE THUMB PAD ARE NOT DRAWN HERE ANY
       MORE. The reticle is the repo's own #crosshair (the one the jail and gun
       game aim with, with its .hot/.dry/.blocked/.locked states) and the touch
       cluster is microboot's thumb grammar wired to fpsmode's own verbs — both
       built by warlord/gunplay.js. A second FIRE button over the first is how
       two files start disagreeing about whether the trigger is down. */
    if (ctx.coarse && micro.touch && micro.touch.init) safe(function () { micro.touch.init(); });
  }
  function paintOrders() {
    if (!hud) return;
    const o = orderOf(SIDES.mine);
    hud.querySelectorAll("[data-o]").forEach(function (b) { b.classList.toggle("on", b.dataset.o === o); });
    const el = document.getElementById("wbOrd");
    if (el) el.textContent = ORDER_LABEL[o];
  }
  /* THE KILL FEED IS GONE, ELEMENT AND ALL. It carried four kinds of line and
     every one of them was a word standing in for something already on screen:
     "X DOWN" and "X BREAKS" (now a red / amber tick on the rim at the man's
     bearing — see warlord/deaths.js), "ORDER: FLANK" (the button you pressed
     is lit and #wbOrd says so), and "AK-47 OFF THE SAND" (fpsmode's own #ammo
     readout writes the weapon's name over its rounds). Deleting the box rather
     than emptying it, because a five-line text panel that only ever prints
     redundancies is a place the next redundancy goes. */
  let noteT = 0;
  function note(txt) {
    const n = document.getElementById("wbNote");
    if (!n) return;
    n.textContent = txt;
    n.classList.add("on");
    noteT = 2.6;
  }
  let uiT = 0;
  function paintHud(dt) {
    /* THE RAIL FOLLOWS THE ARMY. Orders appear the frame you actually have
       somebody to order and vanish the frame your last man goes down — which
       during a rout is a real transition the player should feel, not a set of
       buttons that keep pretending. syncOrderRail no-ops unless the count
       changed, so this costs a compare. */
    if (hudSyncOrders) hudSyncOrders();
    const h = document.getElementById("wbHit");
    if (h) { hurtFlash = Math.max(0, hurtFlash - dt * 1.6); h.style.opacity = hurtFlash.toFixed(2); }
    if (noteT > 0 && (noteT -= dt) <= 0) {
      const n = document.getElementById("wbNote"); if (n) n.classList.remove("on");
    }
    uiT -= dt;
    if (uiT > 0) return;
    uiT = 0.2;
    const M = SIDES.mine, Tm = SIDES.them;
    setText("wbMine", M.alive + (YOU.dead ? "" : "+1"));
    setText("wbThem", Tm.alive);
    setW("wbMineMo", M.morale);
    setW("wbThemMo", Tm.morale);
    /* THE CLOCK COUNTS DOWN WHEN IT MATTERS. A ceiling nobody can see is a
       battle that ends for no reason the player can name; inside the last
       forty seconds it stops being a stopwatch and starts being a deadline. */
    const leftT = BATTLE_MAX() - simT;
    const cel = document.getElementById("wbClock");
    if (cel) {
      if (leftT < 40) {
        cel.textContent = "-0:" + String(Math.max(0, Math.floor(leftT))).padStart(2, "0");
        cel.style.color = leftT < 15 ? "#ff8a3d" : "";
      } else {
        cel.textContent = Math.floor(simT / 60) + ":" + String(Math.floor(simT % 60)).padStart(2, "0");
        cel.style.color = "";
      }
    }
    setW2("wbHp", clamp(YOU.hp / YOU.maxHp, 0, 1));
    /* THE ROUNDS ARE NOT PRINTED HERE ANY MORE. fpsmode's own #ammo readout —
       the big tabular "30 / 30  RES 120" with the weapon's name over it that
       the jail and gun game use — is already on screen, and the first capture
       after the mount had BOTH: the same magazine written twice, eight inches
       apart, in two different fonts. This panel keeps the two things that are
       the WARLORD's rather than the gun's: how hurt he is, and his tally. */
    const gp = GP();
    setText("wbAmmo", gp && gp.on() ? gp.tally() : "");
    setText("wbName", W.state.you.name + (YOU.dead ? " — DOWN" : ""));
  }
  function setText(id, t) { const e = document.getElementById(id); if (e && e.textContent !== String(t)) e.textContent = t; }
  function setW(id, f) { const e = document.getElementById(id); if (e) e.style.width = Math.round(clamp(f, 0, 1) * 100) + "%"; }
  function setW2(id, f) {
    const e = document.getElementById(id);
    if (!e) return;
    e.style.width = Math.round(clamp(f, 0, 1) * 100) + "%";
    e.style.background = f > 0.55 ? "#5aa86a" : f > 0.28 ? "#e2c14a" : "#c4453a";
  }

  /* ============================================================ START */
  function start(opts) {
    if (live) return;
    opts = opts || {};
    /* THE FIGHT WAITS FOR THE GUN — AND FOR THE DEATHS. One await, only ever
       on the first battle of a session. A battle that begins before fpsmode
       has arrived is a battle the player spends silently falling back to the
       fork; a battle that begins before deaths.js has arrived is a battle
       whose first casualties never fall over, which is worse, because it
       looks like the bug rather than like a missing file. Both are one
       promise, resolved in parallel. */
    if (!gunplayDone) {
      Promise.all([loadGunplay(), loadDeaths()])
        .then(function () { gunplayDone = true; start(opts); });
      return;
    }
    startOpts = opts;
    band = opts.band || W.makeBand({ size: 20 });
    THREE = G.THREE;
    scene = CBZ.scene; micro = CBZ.micro;
    _v = V(); _v2 = V(); _muz = V();
    seedBattle((W.state.seed | 0) * 7919 + (W.state.day | 0) * 131 + (band.men.length | 0));

    simT = 0; over = false; started = false; live = true; lastWall = 0;
    men = []; corpses = []; sinking = []; dropGuns = []; addedCols = []; addedMeshes = [];
    pickHeld = false; pickTgt = null; pickLbl = ""; pickTook = 0;
    /* _claim IS A MAP, not the array it was: the spatial-hash rewrite of
       freeSpot (see its declaration) replaced an O(N^2) scan that cost 230
       MILLION distance tests to deploy 500 v 500 and read on screen as a hang.
       `.clear()` rather than `.length = 0` — the two waves that met here were
       resetting two different data structures. */
    _claim.clear(); deadSolving = 0; hurtFlash = 0;
    _shot = null;                     // the death studio's last execution
    units = [];
    /* ?squads=old — the formation/relevance layer off. Read once, here, rather
       than per frame: a query flag that is re-parsed inside the hot loop is a
       string compare per man per substep, which is exactly the kind of cost
       this rewrite exists to remove. */
    squadsOn = !(Q && Q.get("squads") === "old");
    printR = 90; plantR2 = printR * printR; printN = 0;
    cmd.init = 0;

    /* THE DEAD FELL LIKE PLANKS AND THE PAGE THOUGHT IT HAD FIXED THAT.
       warlord.html declares `if (C.RAGDOLL_ANY_MODE == null) C.RAGDOLL_ANY_MODE
       = true` inside start(), i.e. AFTER studio.need() has already loaded
       city/ragdoll.js — which defaults the flag to false on the way in. So the
       `== null` guard never fires and every corpse in this game took the canned
       single-axis topple: MEASURED, `solving: 0` across a whole 78-second
       battle with ten deaths in it. (battle.html declares its version BEFORE
       need() for exactly this reason; the ordering is the entire difference.)

       Set here, unconditionally, because this is the file that wants ragdoll
       corpses and it runs at battle time — long after any load order can bite.
       A ?cfg_ override still wins, so the flag stays revertible. */
    if (!Q || Q.get("cfg_RAGDOLL_ANY_MODE") == null) CBZ.CONFIG.RAGDOLL_ANY_MODE = true;

    /* ARM THE DEATH PATH. Five doors and nothing else — deaths.js must not be
       able to reach into the battle and change anything this file did not open
       on purpose. `decisive` is brokenSide(), the SAME rule checkEnd() runs, so
       "the death that decides the battle" cannot mean two different things
       depending on which file is asking. `rand` is the seeded lcg, so a seeded
       battle still dies the same way twice — which is what the A/B needs. */
    if (W.deaths) {
      W.deaths.arm({
        rand: lcg,
        you: function () { return YOU; },
        camDist2: camDist2,
        ground: function (x, z) { return MAP ? MAP.groundAt(x, z) : 0; },
        decisive: function (m) {
          const s = m.side;
          if (!s) return false;
          if (s.alive <= 1) return true;                       // the last man on his side
          return brokenSide(s, report.fledOf[m.team].length);  // the death that crosses it
        },
        solving: function (d) { deadSolving = Math.max(0, deadSolving + d); },
      });
    }

    W.setPhase("battle", { band: band });

    const cx = (W.state.you.x || 0), cz = (W.state.you.z || 0);
    MAP = buildGround(cx, cz);
    CBZ.groundAt = MAP.groundAt;      // the name city code asks the ground by

    /* THE AIR IS THE PLACE. The campaign's haze is authored for a 14 km island
       seen from 60 m up; a 340 m fight inside it has no depth at all and its
       flat skirt runs to a hard rim. Save the numbers, set battle-scale fog,
       restore on teardown — a change to the shared scene that this file owns
       and therefore this file returns. */
    if (scene.fog) {
      fogSave = { hex: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far };
      /* 420/2900: the near edge has to sit BEYOND the far end of the
         battlefield (170 m) or the enemy line photographs as haze — the first
         capture at 190/1500 washed a firing line 168 m away into the sky. Far
         enough out that the flat skirt still goes to nothing. */
      scene.fog.color.setHex(0xd8c49a);
      scene.fog.near = 420; scene.fog.far = 2900;
    }

    /* THE BATTLE OWNS ITS OWN NEAR PLANE, and this is a leak the fog save
       above was already the template for.

       campaign.js sets camera.near = 2.2 every frame it runs, for a good
       reason it documents: its lens looks at a 12 km coastline, and at
       near=0.35/far=16000 the depth buffer has about 11 m of resolution out
       there, so the sea and the sea bed traded pixels in stripes across the
       horizon. Correct — for a camera whose nearest subject is a man 16 m
       away. It is wrong the instant you are IN the fight, because the
       nearest subject is then a gun 31 cm from your eye, and nothing ever
       set it back on the way in.

       MEASURED: gunplay.audit() reported armed, sidearm, 17/17 in the mag,
       reticle dead centre — and the screenshot showed empty hands. The
       viewmodel was present, visible and correctly placed at (0, 0.075,
       -0.31); it was simply seven times inside the near plane. Nothing was
       broken except that the weapon was being drawn behind the lens.

       0.1 is city/scene.js's own value and its comment says why — "camera
       children are used for first-person viewmodels" — which is the file
       fpsmode.js was written against. Matching it rather than inventing a
       third number.

       AND THE FAR PLANE IS LEFT ALONE, which the first attempt got wrong and
       a screenshot caught. Pulling far in to 6000 looked free — battle fog
       ends at 2900, so nothing past 3 km is drawable anyway — except that
       micro.sky's dome has a radius of 15000, so a 6 km far plane clipped
       the SKY. The battle photographed under a flat sheet of fog colour with
       no horizon gradient at all. Depth precision out there costs nothing
       here because the fog has already eaten everything beyond 2900; the
       sky is the one thing at that distance that still has to draw. */
    const _cam = CBZ.camera;
    if (_cam) {
      camSave = { near: _cam.near, far: _cam.far };
      _cam.near = 0.1;
      _cam.updateProjectionMatrix();
    }

    SIDES.mine = makeSide("mine", -1, 0xffb347, 0);
    SIDES.them = makeSide("them", 1, band.colour || 0xc4593a, 1, band);
    SIDES.mine.order = "hold";
    SIDES.them.order = "hold";

    // ---- the rosters. THE CAP, and it is stated on screen.
    const cap = Math.max(1, parseInt((Q && Q.get("men")) || "", 10) || MEN_CAP_DEFAULT());
    /* SOLO: you walk out alone. events.js's duel — their champion against
       the warlord, with both lines watching — fields none of your men; they
       are the reserve, untouched, and come home whatever happens. checkEnd
       already knows what an empty men0 means (only your death or theirs). */
    const solo = !!opts.solo;
    const mine = solo ? [] : W.state.army.slice(0, cap);
    const theirs = band.men.slice(0, cap);
    capped.mine = solo ? 0 : W.state.army.length - mine.length;
    capped.them = band.men.length - theirs.length;

    report = {
      band: band, outcome: null, duration: 0, youKills: 0, solo: solo, duel: !!opts.duel,
      deadOf: { mine: [], them: [] }, fledOf: { mine: [], them: [] },
      reserveOf: { mine: solo ? W.state.army.slice() : W.state.army.slice(mine.length), them: band.men.slice(theirs.length) },
    };
    /* A DUEL HAS NO ROUT. One man at a third of his health is "an army that
       has lost two thirds of its power" to the morale model, and he would
       turn and run for the map edge on the first hit — which ends the fight
       as THEY BREAK with nobody dead. He stands. So do you. */
    if (opts.duel) { SIDES.them.noRout = true; SIDES.mine.noRout = true; }

    /* HOW MANY MEN THIS SIDE IS DRAWING UP, told to the side BEFORE the first
       body is built, because frontage() cannot shape a line it does not know
       the length of and spawnAt is called once per man from inside makeMan. */
    SIDES.mine.plan = mine.length;
    SIDES.them.plan = theirs.length;
    for (let i = 0; i < mine.length; i++) { const m = makeMan("mine", mine[i], i); if (m) men.push(m); }
    for (let i = 0; i < theirs.length; i++) { const m = makeMan("them", theirs[i], i); if (m) men.push(m); }

    YOU = makeYou();
    men.push(YOU);

    SIDES.mine.men0 = mine.slice();
    SIDES.them.men0 = theirs.slice();
    SIDES.mine.power0 = W.power(mine) + 14;     // +14: the warlord is worth a man
    SIDES.them.power0 = W.power(theirs);
    report.ratio = SIDES.mine.power0 / Math.max(0.001, SIDES.them.power0);

    /* A DEMAND THAT FAILED COSTS MORALE, and this is where it lands. Being
       laughed at and then charged is worth about the same as losing an eighth
       of your power before a shot is fired — enough that the odds on the card
       were not a lie about the fight you are now in. */
    SIDES.mine.moraleMalus = opts.surprised ? 0.2 : (opts.chased ? 0.1 : 0);

    updateCOM();
    updateMorale();

    // shadows pay twice; a big battle buys frames with the sun (battle.html's
    // own rule, at its own threshold)
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && R.shadowMap) {
      shadowSave = R.shadowMap.enabled;
      if (men.length > 170) R.shadowMap.enabled = false;
    }

    buildHud();
    /* THE GUN GOES ON BEFORE THE CAMERA IS CHOSEN. gunplay.mount() is what
       makes CBZ.fpsActive/shoulderActive mean anything, and setCam routes
       straight into it — asking for a seat before the gun exists is asking a
       system that is not there yet. */
    const gp = GP();
    if (gp) safe(function () { gp.mount(gunplayApi()); });
    setCam(ctx.coarse ? "third" : "fps");
    paintOrders();
    const capNote = (capped.mine + capped.them) > 0
      ? (capped.mine + capped.them) + " MEN HELD WITH THE BAGGAGE — FIELD CAP " + cap + " A SIDE (?men=N)"
      : "";
    setText("wbCap", capNote);
    note(opts.duel
      ? "YOU  V  " + ((band.men[0] && band.men[0].name) || "HIM").toUpperCase() + "  ·  ONE ON ONE"
      : W.armySize() + " V " + band.men.length + "  ·  " + (band.name || "").toUpperCase());

    started = true;
    frameFn = micro.onFrame(frame);
    /* ?frozen=1 — THE BATTLE BEGINS STOPPED. A tool that drives this fight
       through freeze()/advance() cannot freeze it before it exists, so between
       start() and the tool's first poll an unknown number of real frames run —
       MEASURED on the first before/after pair, one side had already taken a
       casualty at the beat the other was still at full strength, which makes a
       controlled A/B impossible. Beginning stopped removes the window
       entirely: both sides start at simT 0 and every simulated second after
       that is one somebody asked for. */
    if (Q && Q.get("frozen") === "1" && micro.stop) micro.stop();
    // a person who clicks the world wants to be IN it
    document.addEventListener("pointerdown", onWorldPointer);
    document.addEventListener("pointerup", onWorldRelease);
  }
  function onWorldPointer(e) {
    if (!live || over) return;
    if (e.target && e.target.closest && e.target.closest("#wb .ord,#wb .ret,#microTouch")) return;
    if (camMode !== "cmd" && micro.lock && !ctx.coarse) micro.lock();
    // the command seat: a press that does not move is a point on the sand
    if (camMode === "cmd") press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  }
  /* A TAP IN THE COMMAND SEAT IS AN ORDER. campaign.js's own rule for the
     ride ("a press that does not move is a destination; a press that moves
     is the camera. 8 px / 380 ms, mouse and thumb") — the same gate here, so
     panning the seat never moves the army and a tap always does. */
  let press = null;
  function onWorldRelease(e) {
    const p = press;
    press = null;
    if (!p || !live || over || camMode !== "cmd") return;
    if (e.pointerId != null && p.id != null && e.pointerId !== p.id) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 380) return;
    if (e.target && e.target.closest && e.target.closest("#wb .ord,#wb .ret,#microTouch,#verbs,#stage")) return;
    const g = groundPick(e.clientX, e.clientY);
    if (g) moveTo(g.x, g.z);
  }
  /* where on the field the pointer is: march the ray until it is under the
     battlefield's own height field */
  function groundPick(sx, sy) {
    const cam = CBZ.camera;
    if (!cam || !MAP) return null;
    const w = window.innerWidth, h = window.innerHeight;
    _v.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(cam);
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx = _v.x - ox, dy = _v.y - oy, dz = _v.z - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    let t = 1, hit = -1;
    for (let i = 0; i < 700 && t < 900; i++) {
      if (oy + dy * t <= MAP.groundAt(ox + dx * t, oz + dz * t)) { hit = t; break; }
      t += Math.max(0.6, t * 0.03);
    }
    if (hit < 0) return null;
    let lo = Math.max(0, hit - Math.max(0.6, hit * 0.03)), hi = hit;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) * 0.5;
      if (oy + dy * m <= MAP.groundAt(ox + dx * m, oz + dz * m)) hi = m; else lo = m;
    }
    const x = ox + dx * hi, z = oz + dz * hi;
    if (Math.hypot(x - MAP.cx, z - MAP.cz) > FIELD_R * 0.98) return null;   // off the field
    return { x: x, z: z };
  }
  /* MOVE: the line goes THERE and holds it. The ring on the sand is the only
     furniture the order has — it stands until another order replaces it. */
  let moveMark = null;
  function moveTo(x, z) {
    const s = SIDES.mine;
    if (!s) return null;
    s.order = "move";
    s.anchorX = x; s.anchorZ = z;
    if (!moveMark && THREE) {
      moveMark = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.4, 28),
        new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      moveMark.rotation.x = -Math.PI / 2;
      moveMark.renderOrder = 5;
      scene.add(moveMark);
    }
    if (moveMark) { moveMark.visible = true; moveMark.position.set(x, MAP.groundAt(x, z) + 0.18, z); }
    paintOrders();
    return { x: x, z: z };
  }
  function dropMoveMark() {
    if (!moveMark) return;
    if (moveMark.parent) moveMark.parent.remove(moveMark);
    if (moveMark.geometry) moveMark.geometry.dispose();
    if (moveMark.material) moveMark.material.dispose();
    moveMark = null;
  }
  function makeSide(key, dir, colour, vseed, band) {
    return {
      /* `band` is who these men ARE, and it is null on purpose for your side:
         outfits.js reads null as "the warlord's own", and dresses each of
         your men in the faction he was taken out of rather than a house
         uniform — which is what makes a conscripted army look like a
         conscripted army instead of a national one. */
      key: key, dir: dir, colour: colour, vseed: vseed, band: band || null, squads: [],
      order: "hold", morale: 1, alive: 0, routing: 0, deadN: 0, brokeN: 0,
      kills: 0, shots: 0, hits: 0, power0: 1, powerNow: 1,
      comX: 0, comZ: 0, anchorX: 0, anchorZ: 0, moraleMalus: 0,
      wingBias: key === "mine" ? 0 : 1,
    };
  }
  /* buildViewGun() IS GONE. The first-person gun in your hands and the
     carried gun on your back are both fpsmode.js's — built from the same
     weapons/appearances factories, posed by systems/gunhands.js so the off
     hand actually holds the handguard, and swapped when you switch guns. This
     file used to build a third copy and hand-pose it from a bounding box; that
     is one weapon model too many and it could never reload. */

  function updateCOM() {
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k];
      let x = 0, z = 0, n = 0;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.team !== k || m.dead || m.fled) continue;
        x += m.pos.x; z += m.pos.z; n++;
      }
      if (n) { s.comX = x / n; s.comZ = z / n; }
      else { s.comX = MAP.cx + s.dir * 60; s.comZ = MAP.cz; }
      if (!s.anchorSet) { s.anchorX = s.comX; s.anchorZ = s.comZ; s.anchorSet = 1; }
    });
  }

  /* ============================================================ FRAME */
  let comAt = -1, moraleAt = -1, cmdAt = -1, endAt = -1;
  /* ============================================================ THE LIGHT
     THE SAND WAS RENDERING AS PAPER, and battle.html wrote down why before this
     file existed: "the sun came down from 0.98: at that level the sand's own
     vertex colours clipped to white and the whole erg rendered as a sheet of
     paper". warlord.html's campaign light is HOTTER than the one that did that
     — sun 1.12, and a pale blue hemisphere fill on tan sand, which desaturates
     it on top. MEASURED on the first before/after pair: a battlefield with
     10.2 m of measured relief in it photographed as a flat wash with no crest,
     no trough and no shadow anywhere in the frame.

     THE RESTORE IS FREE, AND THAT IS WHY IT IS DONE THIS WAY. microboot's
     lights() registers an onAlways(9) hook that rewrites sun.intensity,
     hemi.intensity and both hemisphere colours to their captured base EVERY
     frame — it has to, because daynight.js's consumers multiply them. always-
     hooks run before frame-hooks (see microboot's tick and stepSim: both run
     CBZ.always, then frameHooks), so a battle that writes its own numbers at
     the top of its own frame gets exactly one frame of them and hands the
     campaign's light straight back the moment the battle stops running. No
     second light rig, no teardown to forget.

     The numbers are battle.html's own dunes venue: sun 0.84, hemi 0.42, and a
     WARM sky colour, because bounce off sand is warm and lighting an erg with a
     blue fill is what turns tan into grey. */
  function battleLight() {
    const sun = micro.sun, hemi = micro.hemiLight;
    if (sun) sun.intensity = 0.84;
    if (hemi) {
      hemi.intensity = 0.42;
      hemi.color.setHex(0xcfc2a4);
      hemi.groundColor.setHex(0x8f7850);
    }
    /* AND THE FOG COLOUR, HERE FOR THE SAME REASON. start() sets the battle's
       fog near/far once and they hold — but microboot's lights() hook restores
       the fog COLOUR alongside the intensities on every always-tick, so the
       battle's haze was being repainted the campaign's pale sky-bottom sixty
       times a second and the far half of every frame washed to white. Same
       trick, same free restore: written after the hook, gone the moment the
       battle stops running. */
    if (scene.fog) scene.fog.color.setHex(0xc8ad7e);
  }

  /* THE POSE CONE — see the render-side loop for why it exists. A cone that
     CONTAINS the view frustum, expressed as "the cosine of the angle off the
     lens axis past which a man cannot be on screen". Read off the live camera
     every frame because the fov changes (aiming down sights narrows it, the
     command seat is a different lens) and a cached one would cull men out of
     the shot the first time somebody zoomed.

     THE MARGIN IS 0.20 rad and it is the one number here that is a judgement.
     It has to cover: half a man's width at the near edge, the camera moving
     between this hook and the draw, and any post-effect that widens the frame.
     0.2 rad is about 11 degrees — roughly a tenth of a typical horizontal
     frame — which is generous, and generous is the correct direction to be
     wrong in: too wide costs a few poses nobody sees, too narrow is a man
     standing still at the edge of the screen. */
  const POSE_MARGIN = 0.20;
  const POSE_HUG2 = (0.55 / Math.tan(POSE_MARGIN)) * (0.55 / Math.tan(POSE_MARGIN));
  const _cone = { x: 0, y: 0, z: -1, cos: -1 };
  let _coneV = null;
  function poseCone() {
    const cam = CBZ.camera;
    if (!cam) { _cone.cos = -1; return _cone; }
    if (!_coneV) _coneV = new THREE.Vector3();
    cam.getWorldDirection(_coneV);
    _cone.x = _coneV.x; _cone.y = _coneV.y; _cone.z = _coneV.z;
    /* THE CORNER RAY. A perspective camera's widest direction is toward a
       corner of the frame, at atan(hypot(tan(v/2), tan(v/2)*aspect)) off the
       axis; anything inside the frustum is inside that cone. An orthographic
       or a broken camera falls through to "cull nothing". */
    const fov = cam.fov, asp = cam.aspect;
    if (!(fov > 0) || !(asp > 0)) { _cone.cos = -1; return _cone; }
    const tv = Math.tan((fov * Math.PI / 180) / 2);
    _cone.cos = Math.cos(Math.min(Math.PI, Math.atan(Math.hypot(tv, tv * asp)) + POSE_MARGIN));
    return _cone;
  }

  let lastWall = 0;
  function frame(dt) {
    if (!started || !live) return;
    battleLight();
    /* THE SIM CLOCK IS WALL TIME, NOT RENDER TIME — battle.html's finding, and
       it is not a nicety. microboot clamps the dt it hands a frame hook for
       animation stability, so on a machine that is struggling the battle
       quietly runs in slow motion: MEASURED here on the software rasteriser at
       53 bodies, thirty real seconds bought eleven simulated ones. A fight
       that takes three times as long on a slow phone is a different game on a
       slow phone. The sub-steps below keep the integration solid however long
       the frame took. */
    /* …and WALL TIME IS NOW W.clock.now(). Identical to performance.now() at
       1x — same units, same monotonic shape — but warped by the game-speed
       setting, so a fight and the island it is happening on cannot disagree
       about what time it is. Without this the campaign day burned at 8x while
       the men fought at 1x, which is not a slow battle, it is two worlds.

       THE FIGHT HAS ITS OWN CEILING AND IT IS HONEST. 12 substeps of 0.055 s
       is 0.66 s of battle per frame — about 40x at 60 fps and roughly 20x on
       the frame rate three hundred men actually cost. Past that the battle
       falls BEHIND the slider rather than taking a coarser step, because
       0.055 s is the step this separation solve and this morale model were
       measured against. The readout in games/warlord.html reports the
       achieved rate, so a battle that cannot keep up says so.

       THE CAPS ONLY MOVE WHEN THE SLIDER DOES. At 1x this is 0.25 s and six
       substeps — the numbers that were measured here — to the float. The
       wider ceiling is bought only when the player has asked for it. */
    const tScale = Math.max(1, W.clock.scale());
    const wall = W.clock.now();
    dt = lastWall ? Math.min(0.25 * Math.min(2.8, tScale), (wall - lastWall) / 1000) : dt;
    lastWall = wall;
    /* ONE LINE, TWO JOBS, AND THEY ARE THE SAME JOB. warpDt() is the only
       place in the game that sees a WHOLE frame of deaths, so it (a) spends
       last frame's kills in RANK order rather than in men[] order — see
       deaths.js's header for why array order was a raffle — and (b) advances
       the hit-stop / slow-mo clock and hands back the dt this frame should
       actually step. CBZ.doHitstop and CBZ.doSlowmo are declared in
       core/loop.js, which is the CITY's frame loop and is not on this page, so
       systems/fpsmode.js has been calling both into `undefined` on every
       landed round since the day gunplay.js mounted it. deaths.js declares
       them with loop.js's own semantics and this is where they are spent.
       ABOVE the injectDt override on purpose: a frozen studio clock still
       gets its drain and never gets its dt warped. */
    const _D = DTH(); if (_D) dt = _D.warpDt(dt);
    if (injectDt > 0) { dt = injectDt; lastWall = 0; injectDt = 0; }
    fxBudget = 0;

    if (PROF.on) PROF.frames++;
    if (!over) {
      const sub = Math.min(tScale > 1 ? 12 : 6, Math.max(1, Math.ceil(dt / 0.055)));
      const sdt = Math.min(0.055, dt / sub);
      for (let s = 0; s < sub; s++) {
        simT += sdt;
        CBZ.now += sdt * 1000;             // combat_iq's clocks follow this one
        tickPlantBudget();
        let _p = pNow();
        if (simT - gridAt > 0.35) rebuildGrid();
        pAdd("grid", _p);
        _p = pNow();
        if (simT - comAt > 0.6) { updateCOM(); comAt = simT; }
        if (simT - moraleAt > 0.5) { updateMorale(); moraleAt = simT; }
        if (simT - cmdAt > 6) { enemyCommand(); cmdAt = simT; }
        pAdd("morale", _p);
        _p = pNow();
        if (squadsOn) for (let i = 0; i < units.length; i++) stepSquad(units[i], sdt);
        pAdd("squads", _p);
        _p = pNow();
        for (let i = 0; i < men.length; i++) { const m = men[i]; if (!m.formed) stepMan(m, sdt); }
        pAdd("men", _p);
        /* THE WARLORD IS NOT STEPPED HERE. gunplay.js drives him from
           CBZ.onAlways(51.5) — immediately before systems/fpsmode.js's own
           onAlways(52) — because fpsmode's viewmodel, its reticle projection
           and its held-trigger auto fire all read the camera and the aim, so
           the lens must already be where this frame's input put it. Driven
           from here instead (a frame hook, which microboot runs AFTER every
           always-hook) every burst photographed the previous frame's aim. */
        _p = pNow();
        if (deadSolving > 0 && CBZ.ragdollStep) CBZ.ragdollStep(sdt);
        pAdd("ragdoll", _p);
        _p = pNow();
        rebuildFine();
        separateSolve(Math.min(0.9, sdt * 26));
        pAdd("separate", _p);
      }
    }

    if (sinking.length) stepSinking(dt);

    // ---- render-side: gait, aim pose, camera
    posePass(dt, false);
    const _pc = pNow();
    if (camMode === "cmd") stepCommand(dt);
    stepCamera(dt);
    stepPickup();
    paintHud(dt);
    pAdd("hud", _pc);
    frameTail(dt);
  }

  function posePass(dt, force) {
    const _pp = pNow();
    const camP = CBZ.camera.position;
    /* NOBODY IS POSED BEHIND THE CAMERA, AND THAT WAS HALF THE POSE BUDGET.
       MEASURED at 150 v 150 (301 bodies): this loop was 1.76 ms of a 3.8 ms
       simulated frame — the single most expensive thing in the file, more than
       the fighting — and it ran animChar and actorAimAt over every man on the
       field including the whole half of it standing behind the warlord's head.
       A rig that is not on screen has no pose worth computing; that is not a
       level of detail, it is arithmetic nobody can see the result of.

       THE CONE IS THE LENS'S OWN, NOT A TYPED ANGLE. The half-angle is the
       camera's CORNER ray — atan(hypot(tan(vfov/2), tan(vfov/2)*aspect)) —
       plus a margin, so the test is conservative by construction: a man inside
       the frustum can never be outside this cone whatever the aspect ratio, in
       portrait, on a phone, or in the command seat looking straight down.

       AND A SKIPPED MAN IS NOT A FROZEN MAN. Every man accumulates animT and
       aimT while he is off screen and they are handed to animChar and
       actorAimAt as their dt when he comes back — which is what animChar's own
       `dt * every` LOD was already doing for distance, generalised. So he
       walks and turns in at the pose he would have had rather than snapping to
       it.

       AND A CAMERA CUT RE-POSES EVERYONE. This runs as its own function, not
       inline in frame(), because setCam() and look() move the lens AFTER the
       frame's pose pass has already run: the men who were behind the old
       camera are in front of the new one, carrying whatever pose they last had
       on screen. In play that is one frame and nobody sees it. In a still —
       which is the entire output of tools/visual-presets/warlord-scale.mjs,
       and which frames every shot with look() and then draws — it is the whole
       picture. So both seats re-pose before they hand the lens back, with
       force, which ignores the distance ladder for that one pass. */
    const cone = poseCone();
    const cfx = cone.x, cfy = cone.y, cfz = cone.z, cCos = cone.cos;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.fled || m.retired) continue;
      if (m.dead && !m.isYou) continue;
      /* THE WARLORD IS POSED BY warlord/gunplay.js, at onAlways(51.5), which
         is BEFORE systems/fpsmode.js locks his barrel onto the reticle. Posing
         him here — a frame hook, i.e. after every always-hook — moved the hand
         socket out from under a barrel lock that had already been computed
         against it, and his rifle photographed pointing well above his own
         sights. gunplay.js's comment carries the measurement. */
      if (m.isYou) continue;
      const vx = m.pos.x - camP.x, vy = m.pos.y - camP.y, vz = m.pos.z - camP.z;
      const d2 = vx * vx + vz * vz;
      /* TWO CLOCKS, NOT ONE, and the first draft used one and was wrong. The
         gait and the aim are skipped by different rules — the gait by the
         distance LOD below, the aim by the 190 m gate — so a single "time
         since I was posed" accumulator gets consumed by whichever ran first
         and hands the other a dt that has already been spent. Two counters,
         each reset by its own consumer. */
      m.animT = (m.animT || 0) + dt;
      m.aimT = (m.aimT || 0) + dt;
      /* THE ONLY MEN EXEMPT FROM THE CONE ARE THE ONES CLOSE ENOUGH TO BE IN
         the peripheral third of a wide lens or to cast a shadow into shot.
         POSE_HUG is derived rather than picked: a man is ~1.1 m across, so the
         range at which the cone margin already covers his whole body is where
         his half-width subtends less than the margin — 0.55 / tan(0.2 rad). */
      if (d2 > POSE_HUG2) {
        const inv = 1 / Math.sqrt(d2 + vy * vy);
        if ((vx * cfx + vy * cfy + vz * cfz) * inv < cCos) continue;
      }
      pHit("posed");
      m.animF = ((m.animF || 0) + 1) & 1023;
      /* THE GAIT LADDER, AND IT NOW HAS A FOURTH RUNG BECAUSE THE FIRST THREE
         WERE WRITTEN FOR A HUNDRED MEN. animChar is the most expensive single
         thing in this file — MEASURED at 300 v 300, 2.60 ms of a 8.5 ms
         simulated frame across ~390 calls, which is 6.7 us a man — and the old
         ladder (1 / 2 / 4 at 70 m and 150 m) had every man on a 340 m field
         inside its coarsest rung.

         THE RUNGS ARE PIXELS, not distances. A leg is about 0.15 m across; on
         this lens (75 deg over ~900 rows) one pixel subtends 1.5e-3 rad, so a
         leg stops being a resolvable object past 0.15 / 1.5e-3 = ~90 m, and a
         whole man is under six pixels tall past ~180 m. Under 30 m limbs are
         the subject and he is posed every frame; to 90 m they are still
         countable; past 180 m the man is a silhouette with a bob and eight
         gait solves a second is more than the shape can show. The accumulated
         dt goes with it, so the stride covers the same ground either way — the
         only thing that changes is how often it is resampled. */
      const every = force ? 1 : d2 < 30 * 30 ? 1 : d2 < 90 * 90 ? 2 : d2 < 180 * 180 ? 4 : 8;
      if ((m.animF % every) === 0 && CBZ.animChar && m.char) {
        // A MAN IN COVER GETS SMALL — the rig's own flag, which nothing on
        // battle.html set until it was noticed that combat_iq could send a man
        // to real cover and he would stand up straight behind it.
        // THE POSE FOLLOWS THE STANCE, NOT THE SLOT. It used to read the slot
        // alone, which meant a man could be crouched on screen and standing in
        // the sim (and, once folds existed, hull-down in the sim and standing
        // on screen — the worse half of the same bug).
        m.char.crouch = m.stance === "crouch" || m.slot === "cover" || m.slot === "peek";
        const adt = m.animT; m.animT = 0;
        const _pa = pNow();
        safe(function () { CBZ.animChar(m.char, m.speed, adt); });
        pAdd("gait", _pa); pHit("gait");
      }
      /* THE AIM TAKES THE SAME DISTANCE LADDER THE GAIT ALREADY TOOK, and it
         is strange that it never did: `every` was applied to animChar and
         actorAimAt ran flat out for every engaged man inside 190 m, which is
         nearly the whole field. An aim pose is a damped turn toward a mark —
         at 150 m, four frames of it is 66 ms of lag on a motion that takes
         most of a second, and the man is eight pixels tall. Same ladder, same
         accumulated dt, so the turn covers the same ground in the same time
         however often it is asked. */
      const engaged = m.tgt && !m.tgt.dead && m.sees && !m.routed;
      if (engaged && d2 < 190 * 190 && (m.animF % every) === 0 && CBZ.actorAimAt) {
        const _pb = pNow();
        CBZ.actorAimAt(m, m.tgt, m.aimT);
        pAdd("aim", _pb); pHit("aim");
        m.aimT = 0;
        m.yaw = m.group.rotation.y;
      }
      if (m._weaponProp) {
        const show = d2 < 130 * 130;
        if (m._weaponProp.visible !== show) m._weaponProp.visible = show;
      }
    }
    pAdd("pose", _pp);
  }

  function frameTail(dt) {
    if (!over) {
      endAt -= dt;
      if (endAt <= 0) { endAt = 0.4; checkEnd(); }
      // THE CEILING. See BATTLE_MAX: at the cap the remainder is resolved
      // through the SAME attrition tick rather than simply cut off.
      if (!over && simT > BATTLE_MAX()) finishOnTheClock();
    }
  }

  /* ============================================================ THE END
     THREE WAYS A BATTLE ENDS, and two of them are morale.
       · nobody left standing on one side (the arithmetic ending)
       · a side is BROKEN — three quarters of it routing or already off the
         field. A routing army loses; it does not get to be ground down to the
         last levy first, because that is not what happens and because a player
         who has already won should not have to spend ninety seconds proving it.
       · you go down, or you press RETREAT. */
  /* AN ARMY IS BROKEN WHEN NOBODY IS STILL FIGHTING, and the first draft of
     this measured the wrong thing entirely.

     It asked whether three quarters of the side was routing OR already off the
     map — and routed men LEAVE the count as they die or reach the edge, so on
     a measured 26 v 26 the enemy hit "18 alive, 18 of them routing, nobody
     fighting" at t=45 and the flag stayed FALSE. The battle then ran another
     thirty-three seconds while every one of those eighteen jogged to the
     baseline and escaped, and the aftermath screen offered ZERO PRISONERS.
     That is not a tuning miss; it deleted a mechanic. A broken army is one
     with nothing left shooting, and the men standing on the field when that
     happens are exactly the men you capture — which is also the tension the
     four orders are for: end it fast and take prisoners, or let it run and
     watch them get away. */
  const broken = brokenSide;      // one rule, one function — see brokenSide
  function checkEnd() {
    const M = SIDES.mine, T = SIDES.them;
    if (T.alive === 0 || broken(T, report.fledOf.them.length)) {
      endBattle("won", T.alive ? "THEY BREAK" : "THE FIELD IS YOURS");
      return;
    }
    /* A LONE WARLORD IS NOT A BROKEN ARMY. `alive` counts your MEN, not you,
       so day one — one man and a pistol against six bandits, which is the
       game's own opening pitch — used to register as an instant defeat before
       the first shot. If you brought nobody, only YOUR death ends it. */
    if (!M.men0.length) return;
    if ((M.alive === 0 && !report.reserveOf.mine.length) || broken(M, report.fledOf.mine.length)) {
      endBattle("lost", M.alive ? "YOUR ARMY BREAKS" : "YOUR ARMY IS GONE");
    }
  }

  /* ============================================================ THE REPORT
     ONE BUILDER, TWO PRESENTATIONS. The 3D battle and the headless resolve()
     both end here, because the aftermath screen must not be able to tell which
     one it is reading — a fast-resolved fight that hands back a differently
     shaped result is a second battle model wearing the first one's name, and
     the moment those two disagree the multiplayer campaign has two truths.

     `units` is the only thing the two paths hand over differently: on the sand
     it is the live bodies, headless it is plain records with the same four
     fields. Everything below reads .s / .team / .dead / .fled / .hp / .maxHp
     and nothing else, which is exactly why the same function can serve both. */
  function buildReport(units, ctxR, outcome, dur) {
    const r = {
      band: ctxR.band, outcome: outcome, duration: dur, youKills: ctxR.youKills || 0,
      ratio: ctxR.ratio,
      yourDead: ctxR.deadOf.mine.slice(),
      yourFled: ctxR.fledOf.mine.slice(),
      theirDead: ctxR.deadOf.them.slice(),
      yourSurvivors: [], theirSurvivors: [],
      loot: {}, armourLoot: {}, gold: 0,
      resolved: !!ctxR.headless,
    };
    const stood = {};        // who was still FIGHTING at the end, by soldier id
    for (let i = 0; i < units.length; i++) {
      const m = units[i];
      if (m.isYou || !m.s) continue;
      if (m.dead || m.fled) continue;
      // THE MEN WHO ARE STILL STANDING keep the hp they finished on, and a man
      // who finished under a third is WOUNDED — core's own flag, and the reason
      // a win can still cost you next week.
      m.s.hp = Math.max(1, Math.round(m.hp));
      m.s.wounded = m.hp < m.maxHp * 0.34;
      if (m.team === "mine") { r.yourSurvivors.push(m.s); if (m.routed) stood[m.s.id] = 0; else stood[m.s.id] = 1; }
      else r.theirSurvivors.push(m.s);
    }
    // the reserve never fought and is unhurt
    for (let i = 0; i < ctxR.reserveOf.mine.length; i++) r.yourSurvivors.push(ctxR.reserveOf.mine[i]);
    for (let i = 0; i < ctxR.reserveOf.them.length; i++) r.theirSurvivors.push(ctxR.reserveOf.them[i]);

    /* THE LOOT IS EVERY BODY ON THE FIELD, YOURS INCLUDED. A warlord strips his
       own dead — the rifle Kaseem was carrying is worth exactly as much now as
       it was this morning, and leaving it in the sand is the sentimental
       version of throwing money away. army.js removes your dead with
       keepKit:false precisely so this is the only place their kit is counted. */
    if (outcome === "won" || outcome === "retreat") {
      const bodies = r.yourDead.concat(outcome === "won" ? r.theirDead : []);
      for (let i = 0; i < bodies.length; i++) {
        const s = bodies[i];
        if (s.wid && s.wid !== "fists") r.loot[s.wid] = (r.loot[s.wid] || 0) + 1;
        if (s.armour && s.armour !== "none") r.armourLoot[s.armour] = (r.armourLoot[s.armour] || 0) + 1;
      }
      if (outcome === "won") r.gold = (ctxR.band && ctxR.band.gold) | 0;
    }
    /* A RETREAT COSTS LOOT AND MEN, which is what makes it a decision rather
       than a free undo: your dead stay where they fell with their guns, and a
       quarter of the men still on the field do not make it out. */
    if (outcome === "retreat") {
      r.loot = {}; r.armourLoot = {};
      const lose = Math.floor(r.yourSurvivors.length * 0.28);
      for (let i = 0; i < lose; i++) {
        const s = r.yourSurvivors.pop();
        if (s) r.yourDead.push(s);
      }
    }
    /* LOSING COSTS YOU THE MEN WHO STOOD, NOT THE MEN WHO RAN — and the first
       draft had that exactly backwards.

       It moved EVERY survivor into the dead list, which on a measured 34-man
       defeat killed all thirty-four: nineteen who fell fighting plus fifteen
       who had already broken and were halfway to the map edge. The pair image
       is unambiguous — "YOU LOST 34 DEAD" with a run-over screen behind it —
       and it is nonsense twice over. A man who ran away is the ONE man who
       demonstrably survived, and an army that routs is supposed to be an army
       you can rebuild; wiping the roster on a loss makes every defeat a
       deleted save and makes the rout mechanic a suicide button.

       So: a man still holding the line when it collapses is lost (killed, or
       taken by them — the campaign has no shape for being someone's prisoner).
       A man who had already broken gets away, at the cost of everything the
       aftermath does NOT give you: no loot, no prisoners, no promotions. */
    if (outcome === "lost") {
      for (let i = 0; i < r.yourSurvivors.length; i++) {
        const s = r.yourSurvivors[i];
        if (ctxR.reserveOf.mine.indexOf(s) >= 0) continue;   // the baggage never fought
        if (stood[s.id]) { r.yourDead.push(s); r.yourSurvivors[i] = null; }
        else s.wounded = true;                               // he ran, and he is not fresh
      }
      r.yourSurvivors = r.yourSurvivors.filter(Boolean);
    }
    r.theirSurvivors = r.theirSurvivors.filter(function (s) { return s; });
    return r;
  }

  function endBattle(outcome, why) {
    if (over) return;
    over = true;
    report.outcome = outcome;
    report.duration = simT;
    note(why || "");
    W.toast(why || "", outcome === "won" ? "good" : "bad");

    const r = buildReport(men, report, outcome, simT);
    if (outcome === "lost") W.state.you.hp = Math.max(1, Math.round(W.state.you.maxHp * 0.25));
    else W.state.you.hp = Math.max(1, Math.round(YOU.hp));
    // the outcome, on the bus, for whoever was waiting on it (events.js's duel)
    if (W.emit) safe(function () { W.emit("battle:end", r); });

    // hand the screen over after a beat, so the last frame of the battle is a
    // frame of the battle and not a menu
    setTimeout(function () {
      if (W.army && W.army.aftermath) W.army.aftermath(r);
      else W.setPhase("campaign");
    }, outcome === "won" ? 1400 : 1100);
  }

  /* ============================================================ TEARDOWN
     EVERYTHING THIS FILE ADDED TO THE SCENE COMES OUT. A leaked battle is the
     bug that ends a run: three fights in and the page is holding two thousand
     rigs it will never draw. Every list added to above is emptied here, and
     the shared things it borrowed (the fog, the shadow map, the camera's
     child, CBZ.groundAt) are put back the way they were found. */
  function teardown() {
    enemyLocked = false;
    if (!live) return;
    live = false; over = true; started = false;
    if (frameFn) { micro.offFrame(frameFn); frameFn = null; }
    document.removeEventListener("pointerdown", onWorldPointer);
    document.removeEventListener("pointerup", onWorldRelease);
    press = null;
    dropMoveMark();
    if (micro.unlock) safe(function () { micro.unlock(); });

    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (CBZ.ragdollDrop) safe(function () { CBZ.ragdollDrop(m); });
      if (m._weaponProp && m._weaponProp.parent) m._weaponProp.parent.remove(m._weaponProp);
      if (m.group) safe(function () { CBZ.studio.drop(m.group); });
    }
    for (let i = 0; i < sinking.length; i++) safe(function () { CBZ.studio.drop(sinking[i].g); });
    for (let i = 0; i < dropGuns.length; i++) {
      const g = dropGuns[i];
      if (g && g.parent) g.parent.remove(g);
    }
    for (let i = 0; i < addedMeshes.length; i++) safe(function () { CBZ.studio.drop(addedMeshes[i]); });
    // the colliders: spliced out by identity, never by clearing the array —
    // the campaign and the outposts have boxes in there too
    if (micro.colliders) {
      for (let i = 0; i < addedCols.length; i++) {
        const k = micro.colliders.indexOf(addedCols[i]);
        if (k >= 0) micro.colliders.splice(k, 1);
      }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (micro.rebuildColliderGrid) micro.rebuildColliderGrid();

    const gp = GP();
    if (gp) safe(function () { gp.unmount(); });
    if (MAP && typeof MAP.clear === "function") safe(function () { MAP.clear(); });
    if (fogSave && scene.fog) {
      scene.fog.color.setHex(fogSave.hex);
      scene.fog.near = fogSave.near; scene.fog.far = fogSave.far;
    }
    fogSave = null;
    // and hand the lens back exactly as it was — campaign.js re-asserts its
    // own 2.2 on its next frame anyway, but a module that leaves the camera
    // changed is the bug this block exists to stop repeating
    if (camSave && CBZ.camera) {
      CBZ.camera.near = camSave.near; CBZ.camera.far = camSave.far;
      CBZ.camera.updateProjectionMatrix();
    }
    camSave = null;
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && R.shadowMap && shadowSave != null) R.shadowMap.enabled = shadowSave;
    shadowSave = null;

    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    const css = document.getElementById("wbCss");
    if (css && css.parentNode) css.parentNode.removeChild(css);
    hud = null;

    men = []; corpses = []; sinking = []; dropGuns = []; addedCols = []; addedMeshes = [];
    pickHeld = false; pickTgt = null; pickLbl = ""; pickTook = 0;
    grid.clear(); fine.clear(); _claim.clear();
    // the sections go with the men, and so does the height field — both hold
    // references to a battlefield that no longer exists
    units = []; fld = null; fldSrc = null;
    deadSolving = 0; _shot = null; YOU = null; youRig = null; MAP = null; band = null; report = null;
    if (W.deaths) W.deaths.disarm();   // the rim comes down, the hit-stop clock resets
    CBZ.groundAt = null;
  }

  /* ============================================================ KEYS */
  function keys() {
    window.addEventListener("keydown", function (e) {
      if (!live || over) return;
      if (e.code === "Digit1") setOrder("charge", "mine");
      else if (e.code === "Digit2") setOrder("hold", "mine");
      else if (e.code === "Digit3") setOrder("flank", "mine");
      else if (e.code === "Digit4") setOrder("fallback", "mine");
      else if (e.code === "Digit5") setOrder("follow", "mine");
      else if (e.code === "KeyC") cycleCam();
    });
  }

  /* ============================================================ */
  W.module("battle", {
    needs: ["army"],
    boot: function (c) {
      ctx = c;
      Q = c.Q;
      THREE = c.THREE;
      keys();
      loadGunplay().then(function () { gunplayDone = true; });
      loadDeaths();
      /* THE TEARDOWN LISTENER IS REGISTERED ONCE, AT BOOT — not in start().
         W.on() has no dedupe, so registering it per battle stacks a listener
         per fight: three encounters in and the bus is calling teardown three
         times on one phase change. It early-returns when the battle is already
         down, so nothing broke, which is exactly what makes this the kind of
         leak that survives to ship. */
      W.on("phase:leave:battle", teardown);

      /* THE PAGE'S CBZ.floorAt SHIM CALLS THESE TWO BY NAME. They must exist
         from boot, not from start(), or the first campaign frame asks a
         function that is not there yet. */

      /* ?battle=1 — the debug door, and it is not optional scaffolding:
         campaign.js is being written by another agent, and a battle that can
         only be reached through a file that may not exist is a battle nobody
         can test. */
      if (Q && Q.get("battle") === "1") {
        setTimeout(function () {
          const mine = parseInt(Q.get("mine") || "", 10) || 26;
          const them = parseInt(Q.get("them") || "", 10) || 26;
          /* ?bx / ?bz — FIGHT HERE. buildGround centres the field on the
             warlord's campaign position, so a storyboard that needs a
             particular piece of ground (a folded dune, for the hull-down
             still) has no way to ask for one: by the time a stage function
             runs, the battlefield is already built. Two numbers, read here,
             where the debug door already is. */
          const bx = parseFloat(Q.get("bx") || ""), bz = parseFloat(Q.get("bz") || "");
          if (isFinite(bx) && isFinite(bz)) { W.state.you.x = bx; W.state.you.z = bz; }
          /* BOTH ROSTERS COME OUT OF THE SAME CONSTRUCTOR. The first draft
             hand-rolled the player's army with makeSoldier and no armour at
             all, while the enemy came from makeBand — which puts about one man
             in five in a vest or a plate. That is not a test battle, it is a
             handicap match, and it is exactly what the second before/after pair
             photographed: a bare-shirted army losing five to one. Same faction
             on both sides by default, so the only asymmetry left is the
             warlord and his orders — which is the thing being demonstrated. */
          if (!W.state.army.length) {
            const mineBand = W.makeBand({ size: mine, faction: Q.get("myfaction") || "militia" });
            for (let i = 0; i < mineBand.men.length; i++) W.addSoldier(mineBand.men[i]);
          }
          W.state.you.wid = Q.get("gun") || "ak47";
          /* ?duel=1 — the solo fight, for the storyboard: one veteran, no
             army fielded, nobody routs. The same door events.js's WALK OUT
             goes through. */
          const duel = Q.get("duel") === "1";
          const b = W.makeBand({ size: duel ? 1 : them, faction: Q.get("faction") || "bandit" });
          if (duel) { b.name = "THEIR CHAMPION"; b.men[0] = W.makeSoldier("veteran", Q.get("hisgun") || "ak47", { battles: 14 }); }
          b.x = W.state.you.x + 40; b.z = W.state.you.z;
          W.state.bands.push(b);
          start(duel ? { band: b, solo: true, duel: true } : { band: b });
        }, 60);
      }
    },

    start: start,
    /* THE FAST PATH, PUBLIC. Same rosters, same morale, same report shape.
       W.battle.start(o) is the fight you play; W.battle.resolve(o) is the same
       fight, decided in one call, for a skip, a drop, an AI-on-AI battle, or a
       multiplayer turn that cannot wait. `apply:false` returns the report and
       changes nothing, which is what simulating somebody else's fight wants. */
    resolve: resolve,
    limit: BATTLE_MAX,
    live: function () { return live; },
    groundAt: function (x, z) { return MAP ? MAP.groundAt(x, z) : 0; },
    /* THE REVERSE-SLOPE SEARCH, PUBLIC. tools/warlord-cover-check.mjs asks the
       same question the AI asks rather than re-implementing the terrain rule
       in node and grading the game against a second copy of it. */
    hullDown: function (x, z, tx, tz, r) { return live ? hullDown(x, z, tx, tz, r) : null; },
    /* `side` is DRIVE-ONLY and defaults to your own army, which is every
       in-game caller. tools/warlord-cover-check.mjs needs to pin the ENEMY on
       HOLD while it charges at them — otherwise enemyCommand() reads the
       charge as weakness, orders its own, and the test is measuring two
       charges. `lock:true` stands enemyCommand down; `lock:false` hands the
       enemy commander his own army back. */
    order: function (o, side, opts) {
      if (side === "them" && opts && "lock" in opts) enemyLocked = !!opts.lock;
      setOrder(o, side === "them" ? "them" : "mine");
    },
    // the command seat's tap, callable: MOVE the line to a point on the field
    moveTo: function (x, z) { return live ? moveTo(x, z) : null; },
    // the sections, as numbers: where each frame is and what it is doing
    squads: function () {
      return units.map(function (u) {
        const g = u.live && u.formed ? squadGoal(u) : null;
        return { key: u.key, sq: u.sq, x: Math.round(u.x), z: Math.round(u.z), yaw: Math.round(u.yaw * 100) / 100,
                 formed: !!u.formed, live: u.live, reach: Math.round(u.reach), form: u.form, spd: u.spd,
                 gx: g ? Math.round(g.x) : null, gz: g ? Math.round(g.z) : null, err: Math.round(u.err * 10) / 10 };
      });
    },
    // the warlord's own record (pos is live) — for a tool that has to stand
    // him somewhere specific before asking what his line does about it
    you: function () { return live ? YOU : null; },
    /* every body on the field, as plain numbers — for a tool asking WHY a man
       is or is not shooting (target, sight, slot, magazine), which audit()'s
       side totals cannot answer */
    men: function () {
      const out = [];
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        out.push({ i: m.i, you: !!m.isYou, team: m.team, x: Math.round(m.pos.x * 10) / 10, z: Math.round(m.pos.z * 10) / 10,
                   hp: Math.round(m.hp), dead: !!m.dead, fled: !!m.fled, routed: !!m.routed, formed: !!m.formed,
                   slot: m.slot, sees: !!m.sees, tgt: m.tgt ? (m.tgt.isYou ? "you" : m.tgt.i) : null,
                   losBadT: Math.round((m.losBadT || 0) * 10) / 10, mag: m.mag, reloadT: Math.round((m.reloadT || 0) * 10) / 10,
                   cool: Math.round((m.cool || 0) * 100) / 100, wid: m.wid, armed: !!m.armed,
                   stance: m.stance || "stand", up: m.up !== false,
                   hull: m.hull ? 1 : 0, eyeH: Math.round((m.eyeH || 0) * 100) / 100,
                   tx: Math.round(m.target.x), tz: Math.round(m.target.z), detourT: Math.round((m.detourT || 0) * 10) / 10,
                   stuckT: Math.round((m.stuckT || 0) * 10) / 10, speed: Math.round((m.speed || 0) * 10) / 10 });
      }
      return out;
    },
    camera: setCam,
    retreat: function () { endBattle("retreat", "YOU BREAK OFF"); },

    /* ---- THE STUDIO SEAM, for tools/visual-presets/warlord-battle.mjs ------
       freeze() stops the rAF clock; advance(s) runs exactly s seconds of THIS
       page's frame through microboot's headless stepSim, so a screenshot is a
       statement about a MOMENT rather than about a frame rate; audit() is
       every number a preset might want to gate on. Drive-only. */
    freeze: function () { if (micro && micro.stop) micro.stop(); lastWall = 0; return true; },
    advance: function (sec, step) {
      const h = Math.max(1 / 240, Math.min(0.05, step || 1 / 60));
      let leftS = Math.max(0, +sec || 0), n = 0;
      while (leftS > 1e-4 && n < 6000) {
        const d = Math.min(h, leftS);
        injectDt = d;
        micro.stepSim(d);
        leftS -= d; n++;
      }
      return { frames: n, simT: Math.round(simT * 100) / 100 };
    },
    /* profile(true) arms the per-phase timers and zeroes them; profile()
       returns MILLISECONDS PER FRAME per phase (not totals — a total is a
       number about how long the tool ran) plus the counters, and leaves the
       timers armed so a second read is a second window. profile(false) disarms.
       tools/warlord-scale-check.mjs --prof is the consumer. */
    profile: function (on) {
      if (on === true || on === false) {
        PROF.on = on;
        PROF.frames = 0; PROF.t = Object.create(null); PROF.n = Object.create(null);
        return on;
      }
      const f = Math.max(1, PROF.frames);
      const out = { frames: PROF.frames };
      for (const k in PROF.t) out[k] = Math.round((PROF.t[k] / f) * 1000) / 1000;
      for (const k in PROF.n) out["#" + k] = Math.round((PROF.n[k] / f) * 100) / 100;
      PROF.frames = 0; PROF.t = Object.create(null); PROF.n = Object.create(null);
      return out;
    },
    render: function () {
      const R = CBZ.renderer || (micro && micro.renderer);
      if (R && CBZ.camera) safe(function () { R.render(scene, CBZ.camera); });
      return true;
    },

    /* ---- THE FLOOR, for tools/warlord-take-check.mjs ---------------------
       A tool cannot photograph the difference between a rifle you can pick up
       and a rifle you cannot, so it has to be able to find one, stand on it,
       and press the key. Three read-only verbs, and press() goes through
       microboot's OWN input map rather than a synthetic DOM event — which is
       not a convenience: it is the same map the phone's touch button writes
       into, so one test covers the key and the button. */
    floorGuns: function () {
      const out = [];
      for (let i = 0; i < dropGuns.length; i++) {
        const g = dropGuns[i];
        if (!g || !g.parent) continue;
        out.push({ id: i, wid: (g.userData && g.userData.weaponId) || null,
                   x: g.position.x, y: g.position.y, z: g.position.z,
                   settled: !(g.userData && g.userData.weaponBody && !g.userData.weaponBody.settled) });
      }
      return out;
    },
    press: function (code, down) {
      if (!micro || !micro.touch || !micro.touch.synth) return false;
      micro.touch.synth(code, !!down);
      return true;
    },
    /* WHAT THE AFTERMATH WOULD PUT IN THE CART, without ending the battle.
       report.loot is built by walking every dead man's own wid — so a rifle
       taken off the sand has to have been struck off its owner's row or the
       same AK is counted twice. This is that ledger, countable mid-fight. */
    spoilPeek: function () {
      let dead = 0, armedDead = 0, strippedDead = 0;
      const rows = [report.deadOf.mine, report.deadOf.them];
      for (let k = 0; k < rows.length; k++) {
        for (let i = 0; i < rows[k].length; i++) {
          const s = rows[k][i];
          dead++;
          if (s.wid && s.wid !== "fists") armedDead++; else strippedDead++;
        }
      }
      return { dead: dead, armedDead: armedDead, strippedDead: strippedDead,
               taken: pickTook, onFloor: dropGuns.length };
    },
    audit: function () {
      if (!live) return { live: false };
      const M = SIDES.mine, T = SIDES.them;
      return {
        live: true, over: over, outcome: report && report.outcome, simT: Math.round(simT * 10) / 10,
        order: orderOf(M), enemyOrder: T.order, cam: camMode,
        moraleOn: !MORALE_OFF(), ordersOn: !(Q && Q.get("orders") === "old"),
        mine: { alive: M.alive, morale: Math.round(M.morale * 100) / 100, routing: M.routing,
                dead: M.deadN, broke: M.brokeN || 0, fled: report.fledOf.mine.length,
                kills: M.kills, shots: M.shots, hits: M.hits, started: M.men0.length },
        them: { alive: T.alive, morale: Math.round(T.morale * 100) / 100, routing: T.routing,
                dead: T.deadN, broke: T.brokeN || 0, fled: report.fledOf.them.length,
                kills: T.kills, shots: T.shots, hits: T.hits, started: T.men0.length },
        you: { hp: Math.round(YOU.hp), kills: YOU.kills, dead: YOU.dead,
               x: Math.round(YOU.pos.x), z: Math.round(YOU.pos.z),
               /* the men within 40 m of the warlord — a thirty-man line on
                  him is sixty metres wide, so 25 m counted only the centre of
                  a line that had in fact formed on him. The number FOLLOW ME
                  exists to move; on a build without the order it is whatever
                  the line happens to be doing */
               escort: (function () {
                 let n = 0;
                 for (let i = 0; i < men.length; i++) {
                   const m = men[i];
                   if (m.isYou || m.team !== "mine" || m.dead || m.fled) continue;
                   if (Math.hypot(m.pos.x - YOU.pos.x, m.pos.z - YOU.pos.z) < 40) n++;
                 }
                 return n;
               })() },
        solo: !!(report && report.solo), duel: !!(report && report.duel),
        moveMark: !!(moveMark && moveMark.visible),
        anchor: { x: Math.round(SIDES.mine.anchorX), z: Math.round(SIDES.mine.anchorZ) },
        field: { cx: Math.round(MAP.cx), cz: Math.round(MAP.cz), relief: MAP.relief,
                 coreRelief: MAP.coreRelief, folded: !!MAP.folded,
                 terrainLos: MAP.terrainLos, cover: MAP.cover.length, gap: GAP(),
                 desert: !!MAP.fromDesert,
                 /* WHAT IS ACTUALLY STANDING ON THIS FIELD. `cover` has always
                    been a count, which cannot answer "are there fake rocks on
                    the dunes" — the question the 2026-09-04 pass exists to
                    settle. The biome and the kind tally can. */
                 biome: MAP.biome || null,
                 coverKinds: (function () {
                   const t = {};
                   for (let i = 0; i < MAP.cover.length; i++) {
                     const k = MAP.cover[i].kind || "boulder";
                     t[k] = (t[k] || 0) + 1;
                   }
                   return t;
                 })(),
                 /* AND HOW THE GROUND IS DOING THE JOB INSTEAD: how many
                    living men are in a fold right now, and how many of those
                    are down behind the lip on this frame. */
                 hull: (function () {
                   let n = 0, down = 0;
                   for (let i = 0; i < men.length; i++) {
                     const m = men[i];
                     if (m.dead || m.fled || m.isYou) continue;
                     if (m.hull) { n++; if (m.stance === "crouch") down++; }
                   }
                   return { men: n, down: down, probes: _hullQ, found: _hullHit };
                 })() },
        bodies: men.length, corpses: corpses.length, solving: deadSolving,
        /* HOW THE DEAD WERE SPENT. warlord/deaths.js's ledger: how many men
           fell, what tier each landed in, how many got blood and a body, and
           `denied` — how many WANTED a body and lost the rank. That last one
           is the only honest measure of whether the budget is a budget: zero
           at 300 v 300 means it is not doing anything. */
        deaths: (W.deaths && W.deaths.audit) ? W.deaths.audit() : null,
        /* THE FORMATION LAYER, COUNTABLE. `formed` is how many men are
           currently a slot in a section rather than an individual — the whole
           saving in one number — and `units`/`engaged` say how much of the
           army is actually in contact, which is the number that tells you
           whether a big battle is a battle or a queue. */
        squads: { on: squadsOn, units: units.length, formed: formedCount(),
                  engaged: engagedUnits(), printR: Math.round(printR) },
        /* THE FLOOR. `guns` is how many dropped rifles are lying on the sand,
           `reach` whether one is inside the warlord's arm, `taken` how many he
           has picked up this battle — the three numbers that say whether the
           pickup is a mechanic or a decoration. */
        floor: { guns: dropGuns.length, reach: !!pickTgt, taken: pickTook,
                 on: !TAKE_OFF(), label: pickLbl },
        fps: micro.fps || 0,
        reuse: {
          iq: !!(CBZ.combatIQ && CBZ.combatIQ.shot), gunfx: !!CBZ.tracer,
          rig: !!CBZ.makeCharacter, guns: !!(CBZ.weaponAppearance && CBZ.weaponAppearance.ak47),
          ragdoll: !!CBZ.cityRagdoll, gunPhysics: !!CBZ.weaponPhysics,
        },
      };
    },
    /* ---- THE DEATH STUDIO, for tools/visual-presets/warlord-death.mjs -----
       A death is the one event in this game that a storyboard cannot stage by
       waiting for it. It lasts under a second, it happens to a man the tool
       has no name for, and on the frame it happens the lens is looking
       somewhere else. So execute() names a man by WHERE HE IS STANDING, seats
       the camera on him, and pulls the trigger, in one call — which is what
       makes an A/B controlled: both builds kill the same man at the same
       simulated second from the same seat, and every pixel of difference
       after that is the flag.

       He is killed with `by: YOU`, which is true (the tool is standing in for
       the trigger) and which is also the tier-2 case in deaths.js — the death
       that is ABOUT you. That is deliberate: the budget's top tier is the one
       worth photographing, and the volley subject photographs the rest.

       DRIVE-ONLY. Nothing in the game calls this. */
    execute: function (o) {
      if (!live || over || !YOU) return null;
      o = o || {};
      const team = o.team || "them";
      const fx = o.x != null ? o.x : YOU.pos.x, fz = o.z != null ? o.z : YOU.pos.z;
      let best = null, bd = 1e9;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.dead || m.fled || m.isYou || m.team !== team) continue;
        const d = Math.hypot(m.pos.x - fx, m.pos.z - fz);
        if (d < bd) { bd = d; best = m; }
      }
      if (!best) return null;
      /* THE SEAT IS 3/4 OFF THE SHOT LINE. A man falling straight away from
         the lens is a man getting shorter — the whole subject of these
         pictures is WHICH WAY he goes down, and a fall directly along the
         view axis is the one angle that cannot show it. */
      const sh = Math.atan2(best.pos.x - YOU.pos.x, best.pos.z - YOU.pos.z);
      /* setCam, NOT `camMode = "cmd"`. THIS COST AN AFTERNOON AND IT IS THE
         SAME TRAP look() sits in: this file's camMode and warlord/gunplay.js's
         camMode are two variables, and gunplay re-places the lens from ITS one
         at onAlways(51.5) EVERY FRAME. Writing only this file's leaves gunplay
         still in first person, so the seat this call chose survived exactly
         until the next advance() — and then the camera snapped back to the
         warlord's eyes, 139 m away. MEASURED, and the symptom was not "the
         camera moved": it was systems/gore.js drawing nothing, because its
         70 m gate is measured from wherever the camera actually is. setCam
         tells both. */
      /* `cam: false` KILLS HIM WITHOUT MOVING THE LENS. Not every death is
         photographed as a close-up: the screen-rim casualty mark that replaced
         the kill feed is only legible in a WIDE frame, beside the men it is
         reporting on, and pointing the camera at the man defeats the point of
         a mark that tells you where he is. */
      if (o.cam !== false) {
        setCam("cmd");
        cmd.init = 1; cmd.auto = false;
        cmd.x = best.pos.x; cmd.z = best.pos.z;
        cmd.dist = o.dist == null ? 9 : o.dist;
        cmd.yaw = sh + (o.off == null ? 1.15 : o.off);
        cmd.pitch = o.pitch == null ? 0.12 : o.pitch;
        stepCamera(0.016);
      }
      _shot = { m: best, t0: simT,
                sx: Math.sin(sh), sz: Math.cos(sh),         // the round's own heading
                x: best.pos.x, y: best.pos.y, z: best.pos.z };
      killMan(best, { by: YOU, headshot: !!o.head });
      return { i: best.i, x: _shot.x, y: _shot.y, z: _shot.z,
               range: Math.round(bd * 10) / 10, cam: { x: cmd.x, z: cmd.z, yaw: cmd.yaw, dist: cmd.dist } };
    },
    /* WHAT IS HAPPENING TO HIM RIGHT NOW, in numbers a picture can be checked
       against. Everything here is read off the rig's actual world transform
       rather than off the bookkeeping that produced it, so a fall that is
       recorded but not DRAWN reads as zero. */
    shotAudit: function () {
      if (!_shot || !_shot.m || !_shot.m.group) return null;
      const m = _shot.m, g = m.group;
      /* HIS OWN UP AXIS, IN THE WORLD. A standing man's is (0,1,0); a man flat
         on the sand has it horizontal. So the angle off vertical IS how far
         over he is, in degrees, and the horizontal part of it is the compass
         bearing his head travelled — which is the thing the old coin flip got
         wrong. `alongShot` is the cosine between that bearing and the round's:
         +1 is a man knocked down by the bullet that killed him, 0 is
         sideways, -1 is a man who fell INTO the shot. */
      _v.set(0, 1, 0).applyQuaternion(g.quaternion);
      const hl = Math.hypot(_v.x, _v.z);
      const along = hl < 0.02 ? 0 : (_v.x / hl) * _shot.sx + (_v.z / hl) * _shot.sz;
      const f = m.fall || null;
      return {
        t: Math.round((simT - _shot.t0) * 1000) / 1000,
        tiltDeg: Math.round(Math.acos(clamp(_v.y, -1, 1)) * 180 / Math.PI * 10) / 10,
        alongShot: Math.round(along * 100) / 100,
        /* POSED is the whole show-don't-tell claim in one bit: was he already
           snapped into his final dead sprawl on the frame the round arrived?
           The old path answered YES on frame zero, every time. */
        posed: !!(f && f.posed), ragdoll: !!m.ragdoll, settled: !!(f && f.done),
        y: Math.round(g.position.y * 1000) / 1000,
      };
    },
    // where the bodies are, so a camera can be pointed at the fight
    look: function (o) {
      o = o || {};
      camMode = "cmd";
      cmd.init = 1;
      if (o.x != null) { cmd.x = o.x; cmd.z = o.z; }
      else {
        cmd.x = (SIDES.mine.comX + SIDES.them.comX) * 0.5;
        cmd.z = (SIDES.mine.comZ + SIDES.them.comZ) * 0.5;
      }
      cmd.auto = o.dist == null;
      if (o.dist != null) cmd.dist = o.dist;
      if (o.pitch != null) cmd.pitch = o.pitch;
      if (o.yaw != null) cmd.yaw = o.yaw;
      stepCamera(0.016);
      // see setCam: the lens has moved, so re-pose whoever is now in front of it
      safe(function () { posePass(0, true); });
      return { x: cmd.x, z: cmd.z, dist: cmd.dist, yaw: cmd.yaw, pitch: cmd.pitch };
    },
  });

  // and the probe hook the preset drives (the page's own name for it)
  G.__warlordBattle = W.battle;
})();
