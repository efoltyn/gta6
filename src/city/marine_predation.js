/* ============================================================
   city/marine_predation.js — THE SEA EATS ITSELF.

   THREE OWNER ASKS, ONE BLOCK:
     1. "bleeding in the water should attract sharks — not show up on HUD but
        just show in game"
     2. "how megalodon eating small ship looks"
     3. "how orcas attacking a megladon and enough orcas should beat a megladon"

   WHAT WAS ACTUALLY MISSING (measured before writing a line):

   • CHUM HAD NO PRODUCERS. systems/gore.js publishes goreChum/goreChumList,
     systems/predator.js's chumNear() polls it at 2.5 Hz and every shark's
     chumR is 200+ units — and the entire game contained THREE producers
     (gore.js's own wet-kill branch, city/swim.js's wounded player, and
     city/fishing.js's bait station). A shot NPC who falls off a pier, a corpse
     dumped over the side, a harpooned whale, a fish another fish just bit —
     none of them chummed anything. §7 is the fix, and it is ONE poll over the
     seams that already know who is in the water, not N copies of a water test.

   • ANIMAL-VS-ANIMAL COMBAT DID NOT EXIST AT SEA. city/wildlife.js has a real
     land food chain (pickPrey -> predatorHunt), but the aquatic branch returns
     BEFORE it, handing every dangerous swimmer to CBZ.sharkBrain — which hunts
     exactly one thing, CBZ.player. So nothing in the ocean has ever hunted
     anything else. And wildlife.js's own preyOk() would have refused an orca
     hunting a megalodon three separate ways (legendary, bigger, more
     dangerous), which is correct for "a wolf picks a deer" and exactly wrong
     for "a pod mobs an apex".

   THE SHAPE, AND WHY IT IS NOT AN ORCA-VS-MEGALODON SPECIAL CASE
   ---------------------------------------------------------------
   §2 is a PREDATION GRAPH with no species name in it. Two relations fall out
   of facts the bestiary already carries (scale, danger, bite, hp, herd):

     PREY  a loner takes it alone  — smaller and less dangerous than me
     MOB   only numbers take it    — up to MOB_MAX my size, dangerous in its
                                     own right, and I am a POD animal

   great white -> seal/tuna/dolphin, barracuda -> sardine, meg -> everything
   are PREY rows. orca -> megalodon and orca -> great white are MOB rows. Not
   one of them is typed out anywhere; they are the same two inequalities read
   against different rows of the bestiary, so the 46th species is priced for
   free and adding one must never mean editing this file.

   AND THE NUMBERS DECIDE IT (§4). "Enough orcas beat a megalodon" is not a
   hardcoded 5. podNeeded() solves the two time-to-kills against each other:

       dpsAgainst(A,B) = kitDps(A) * size(A)^1.6 / size(B)^2.2
       ttk(A,B)        = hp(B) / dpsAgainst(A,B)
       ratio           = ttk(pod member -> quarry) / ttk(quarry -> pod member)
       needed          = ratio >= 1 ? ceil(ratio) + 1 : max(1, ceil(ratio))

   For the authored rows that is FOUR orcas against a megalodon (1200 hp /
   bite 60 against 620 hp / bite 42), ONE against a great white, and — because
   size is in the expression on BOTH sides — ELEVEN against a monster meg, and
   TWO if the pod is big bulls. A pod short of `needed` still fights, harries
   and bleeds it; what it can never do is unlock the ROLL-OVER (§5), which is
   the only thing that actually finishes an apex. That is the difference
   between the stalemate the owner asked for and the kill he asked for, and it
   is one comparison.

   PODS ARE NOT N LONERS (§4). Real orcas killing a big shark harry it from
   several bearings so it cannot face them all, ram the flank, and roll it
   belly-up into tonic immobility. predator.js ALREADY had the first half —
   predatorPack hands out bearing slots and one commit token — so this file
   contributes the two it did not have: the RAM (a committed non-bite pass
   that STAGGERS the quarry, CBZ.predatorStagger, added to the shared driver
   rather than to a private loop) and the ROLL-OVER FINISHER
   (CBZ.creatureTonicRoll, added to creature_combat.js, which is the file that
   owns animal animation). NO FOURTH AI LOOP: every actor here is ticked by
   CBZ.predatorHunt and strikes through CBZ.creatureFight, exactly like the
   shark, the wolf and the bear.

   THE SEAM WE TICK ON. wildlife.js's aquatic branch calls CBZ.sharkBrain and
   hands it the transform when it returns true. This file CAPTURES AND WRAPS
   that export (the same pattern ten files in this repo use on cityKillPed),
   so a marine hunt gets first refusal on an actor and anything we decline
   falls straight through to the shark's own player hunt, byte for byte. We do
   not edit wildlife.js or wildlife_shark.js, and we borrow the shark's OWN
   locomotion seam (a._shark.opts.move) rather than writing a second swimmer.

   NO HUD. ANYWHERE. Owner said it twice. The only signals this file produces
   are in the world: gore.js's plume and slick, waterSplashAt's white water,
   the animals themselves, and a boat going down. There is no toast, no feed
   line, no marker, no icon, and CBZ.citySwimBleeding() is never read here.

   ALLOCATION-FREE PER FRAME. Per-actor scratch lives on the actor (`a._mp`),
   maths uses module-scope temps, the chum poll writes into fixed arrays, and
   nothing returns a fresh object.

   DISTANCE-GATED HARD. Every entry point does at most two Math.hypot calls
   before it decides a fight 8 km away costs nothing this frame.

   FLAGS (one-line reverts, declared here, never in config.js):
     CBZ.CONFIG.MARINE_PREDATION  the whole file
     CBZ.CONFIG.MARINE_POD        pod tactics: bearings, ram, roll-over
                                  (CFG.ORCA_POD = false still reverts it too)
     CBZ.CONFIG.MEG_SHIP_BITE     a big shark taking a small boat
     CBZ.CONFIG.WATER_CHUM_ALL    the chum producers of §7

   PUBLIC API — the graph
     CBZ.marineRelation(hunterSp, targetSp) -> 0 none | 1 prey | 2 mob
     CBZ.marinePodNeeded(hunter, target)    -> how many it takes
     CBZ.marinePodNeededFor(hSp,tSp,hS,tS)  -> the same, off bestiary rows alone
     CBZ.marineGape(actor)                  -> metres its jaws can span
     CBZ.marineBiteableHull(actor, car)     -> can it take that boat
     CBZ.marineBleed(ref, severity)         -> put blood in the water (§7)

   PUBLIC API — the pod primitives (§5b). A species file that wants its own
   signature tactics SPENDS these; it does not re-implement them.
     CBZ.marinePodRole(a,t,dt) commit/flank/hold   CBZ.marinePodMembers(a,t,out)
     CBZ.marinePodCount(a,t)   CBZ.marinePodEnough(a,t)
     CBZ.marinePodRamReady(a,t)   CBZ.marinePodRam(a,t,dt)
     CBZ.marinePodRollReady(a,t)  CBZ.marinePodRoll(a,t)  CBZ.marinePodRolling(t)
     CBZ.marinePodBreakOff(a,s)   CBZ.marinePodJoin(a,t)
     CBZ.marineHurt(v,dmg,by,cause)  CBZ.marineDpsAgainst(a,b)
     CBZ.marineBodyLen(a)            CBZ.marineSurfaceHit(x,z,power)

   CBZ.marineAudit()                        -> the probe (no gameplay reads it)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || null;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS ---------------------------------------------------------------
  if (CFG.MARINE_PREDATION == null) CFG.MARINE_PREDATION = true;
  /* MARINE_POD, not ORCA_POD. The mechanism is "a pod mobs something one of
     them could not take", and naming the flag after the one species that
     currently qualifies is how a general system quietly becomes a special
     case. `ORCA_POD` is still honoured when somebody explicitly sets it false
     so an older revert line keeps working. */
  if (CFG.MARINE_POD == null) CFG.MARINE_POD = true;
  if (CFG.MEG_SHIP_BITE == null) CFG.MEG_SHIP_BITE = true;
  if (CFG.WATER_CHUM_ALL == null) CFG.WATER_CHUM_ALL = true;
  if (CFG.MARINE_FRENZY == null) CFG.MARINE_FRENZY = true;
  function ON() { return CFG.MARINE_PREDATION !== false; }
  function PODS() { return ON() && CFG.MARINE_POD !== false && CFG.ORCA_POD !== false; }
  function SHIPS() { return ON() && CFG.MEG_SHIP_BITE !== false; }
  function CHUMS() { return CFG.WATER_CHUM_ALL !== false; }

  // ---- tuning --------------------------------------------------------------
  const SIM_R = 900;           // u — beyond this nothing thinks. Two hypots.
  const SIM_R2 = SIM_R * SIM_R;
  const FIGHT_R = 1400;        // a fight ALREADY running keeps running further out
  const FIGHT_R2 = FIGHT_R * FIGHT_R;
  const SEE_R = 420;           // inside this the combatants are forced visible
  const RESCAN = 1.7;          // s between target re-scans (jittered per actor)
  const POD_R = 90;            // u — inside this you are in the same pod fight
  const SHADOW_K = 0.85;       // × the FSM's wake radius: how close a shadowing pod closes to
  const PREY_MAX = 1.05;       // a loner's quarry may be at most this × its size
  const MOB_MAX = 2.4;         // a POD's quarry may be at most this × its size
  const POD_HERD_MIN = 3;      // herd[1] this big or more = a pod animal
  const RAM_EVERY = 2.6;       // s — a flanker's ram cadence at scale 1
  const STAGGER_S = 1.15;      // s the quarry loses its facing after a ram
  const ROLL_HP = 0.3;         // quarry hp fraction that unlocks the finisher
  const ROLL_S = 5.4;          // s the roll-over takes end to end
  const BREAKOFF_HP = 0.55;    // a pod member below this and outnumbered leaves
  const CHUM_HZ = 0.4;         // s between chum polls (2.5 Hz, matches chumNear)
  const CHUM_SLOTS = 6;        // handles we will hold (gore.js caps at 12 total)
  const CHUM_R = 260;          // u — no point trailing blood nobody can smell

  // ---- module-scope temps (never allocated per frame) ----------------------
  let _t0 = 0, _t1 = 0, _t2 = 0, _t3 = 0;
  const _box = THREE ? new THREE.Box3() : null;
  const _v = THREE ? new THREE.Vector3() : null;
  const AUDIT = {
    shadowed: 0,        // frames a committed pod spent crossing water to its quarry
    hunts: 0, rams: 0, rolls: 0, kills: 0, casualties: 0, brokeOff: 0,
    shipBites: 0, shipsSunk: 0, chumOpened: 0, chumLive: 0, hudWrites: 0, chunks: 0,
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function shortAngle(a) {
    while (a > Math.PI) a -= 6.283185307;
    while (a < -Math.PI) a += 6.283185307;
    return a;
  }
  function actorPos(a) { return a && (a.pos || (a.group && a.group.position)) || null; }
  function playerPos() { return (CBZ.player && CBZ.player.pos) || null; }

  // ============================================================
  //  §1. THE THREE PHYSICAL FACTS, derived once per actor and cached.
  //
  //  NOTHING HERE IS A TABLE. length is MEASURED off the model the species
  //  actually built, gape is read off the authored mouth contract, mass is a
  //  power law on length. `size` consumes CBZ.wildlifeSize if a neighbour
  //  publishes it and degrades to 1 if it never lands — the defensive-consume
  //  contract, so this file works whether that API arrives before or after it.
  // ============================================================
  function mp(a) {
    return a._mp || (a._mp = {
      len: 0, gape: 0, jitter: 0, scanT: 0, target: null, kind: 0,
      role: "commit", rollT: -1, rolling: null, held: false,
      opts: null, ram: null, shipTarget: null, shipScan: 0, shipT: 0,
      podN: 0, podT: 0, ramRun: 0,
    });
  }

  /* HOW BIG IS THIS INDIVIDUAL, as a multiplier on its species' own scale.

     `_sizeMul` is an EXPLICIT statement about this one animal — whoever put
     it there (a stager, a spawner, a future "this is the big bull" pass) was
     being specific, so it wins outright. Otherwise a neighbour is asked:
     CBZ.wildlifeSize is another block's API and may land before or after this
     file, so it is consumed defensively and everything degrades to 1 if it
     never arrives. Every place size matters in this file goes through here. */
  function sizeOf(a) {
    const own = +(a && a._sizeMul);
    if (own > 0 && isFinite(own)) return own;
    if (typeof CBZ.wildlifeSize === "function") {
      try { const s = +CBZ.wildlifeSize(a); if (s > 0 && isFinite(s)) return s; } catch (e) {}
    }
    return 1;
  }
  function hungerOf(a) {
    if (typeof CBZ.wildlifeHunger === "function") {
      try { const h = +CBZ.wildlifeHunger(a); if (h >= 0 && isFinite(h)) return h; } catch (e) {}
    }
    return 0.6;                 // no neighbour: ordinarily interested in food
  }

  /* HOW LONG IS THIS ANIMAL, REALLY. Measured off the built model, in its own
     local frame, ONCE. The rotation is zeroed for the measurement and put back
     before we return, so nothing can render in between and no species has to
     declare a number it already drew. */
  function bodyLen(a) {
    const m = mp(a);
    if (m.len > 0) return m.len;
    let L = 0;
    const g = a && a.group;
    if (g && _box) {
      const rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z;
      try {
        g.rotation.set(0, 0, 0);
        g.updateMatrixWorld(true);
        _box.setFromObject(g);
        if (isFinite(_box.max.x) && isFinite(_box.min.x)) L = _box.max.x - _box.min.x;
      } catch (e) { L = 0; }
      g.rotation.set(rx, ry, rz);
      try { g.updateMatrixWorld(true); } catch (e) {}
    }
    // NOTE THE ABSENCE OF A sizeOf() MULTIPLY. Individual size is applied to
    // the GROUP's scale by whoever set it, so the bounding box already carries
    // it; multiplying again here would have made a 1.5x megalodon measure 2.25x
    // and quietly rewritten every reach, gape and tonnage derived from it. The
    // fallback (no THREE, no group) is the only path that has to do it by hand.
    if (!(L > 0)) L = 4 * ((a.species && a.species.scale) || 1) * sizeOf(a);
    return (m.len = L);
  }

  /* HOW WIDE IS THE BODY ITSELF. The whole-group box is the wrong answer by
     a factor of three — a megalodon's PECTORAL FINS span ~13 m of z — so the
     beam is measured off the named hull mesh alone (sharkHull / cetaceanHull
     / fishHull, the marine-overhaul naming convention), rotation zeroed,
     once. This is the surface the bite pass is capped at: teeth stop AT the
     flank, not at the fin tips and not at the centre line. */
  function bodyBeam(a) {
    const m = mp(a);
    if (m.beam > 0) return m.beam;
    let B = 0;
    const g = a && a.group;
    if (g && _box) {
      let hull = null;
      g.traverse(function (o) { if (!hull && o.isMesh && /hull$/i.test(o.name || "")) hull = o; });
      if (hull) {
        const rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z;
        try {
          g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
          _box.setFromObject(hull);
          if (isFinite(_box.max.z) && isFinite(_box.min.z)) B = _box.max.z - _box.min.z;
        } catch (e) { B = 0; }
        g.rotation.set(rx, ry, rz);
        try { g.updateMatrixWorld(true); } catch (e) {}
      }
    }
    if (!(B > 0)) B = bodyLen(a) * 0.19;
    return (m.beam = B);
  }

  /* HOW WIDE CAN IT OPEN. The authored aquatic mouth publishes its hinge and
     its bite point, so the jaw LENGTH is a fact; a shark's tooth ring is a U
     about as wide as it is long, hence the 1.15. This is the number the ship
     gate is built on (§6): the jaws have to be able to close ACROSS THE BEAM,
     which is what makes a speedboat food and a tanker scenery without anybody
     writing down a list of boat names. */
  function gapeOf(a) {
    const m = mp(a);
    if (m.gape > 0) return m.gape;
    let span = 0;
    const g = a && a.group;
    const mouth = g && g.userData && g.userData.aquaticMouth;
    if (mouth && mouth.hinge && mouth.bite) {
      // the contract is in MODEL-LOCAL units, so the group's live scale — which
      // already carries this individual's size — is the only conversion needed.
      span = Math.abs(mouth.bite.x - mouth.hinge.x) * 1.15;
      span *= (g.scale && g.scale.x > 0) ? g.scale.x : 1;
    }
    if (!(span > 0)) span = bodyLen(a) * 0.19;      // bodyLen already carries size
    return (m.gape = span);
  }

  // Displacement, as a power law on length. Never used as physics — only ever
  // as one half of a RATIO (can this animal move that hull), so the constant
  // only has to be consistent with itself.
  function tonnesOf(a) { const L = bodyLen(a); return 0.014 * Math.pow(L, 2.8); }

  function kitOf(a) {
    // THE BASE, never a merged bundle. predatorKit caches exactly ONE merged
    // object per actor and wildlife_shark.js is already holding that pointer —
    // asking for overrides here would silently rewrite the shark's own opts.
    if (typeof CBZ.predatorKit !== "function") return null;
    try { return CBZ.predatorKit(a); } catch (e) { return null; }
  }
  function dpsOf(a) {
    const k = kitOf(a);
    const sp = a.species || {};
    const dmg = (k && k.dmg > 0) ? k.dmg : (sp.bite || 10);
    const rate = (k && k.rate > 0) ? k.rate : 1.4;
    return dmg / rate;
  }
  function maxHpOf(a) {
    const h = +(a && a.maxHp);
    if (h > 0) return h;
    return ((a && a.species && a.species.hp) || 40);
  }

  /* THE ONE EXPRESSION IN WHICH SIZE MATTERS BOTH WAYS. A bigger attacker
     hits harder (^1.6, roughly a linear-dimension bite force) and a bigger
     defender soaks more (^2.2, roughly its mass). It is used for the damage
     that is actually applied AND for the threshold that decides how many it
     takes, so the two can never disagree — a monster meg is genuinely harder
     to kill and podNeeded genuinely says so. */
  function dpsAgainst(att, def) {
    return dpsOf(att) * Math.pow(sizeOf(att), 1.6) / Math.pow(sizeOf(def), 2.2);
  }

  // ============================================================
  //  §2. THE PREDATION GRAPH. No species name appears in this function.
  // ============================================================
  // The largest group this species is ever authored to appear in. It is the
  // ceiling on what a "pod" of it can physically be, and §2 uses it as a
  // reality check rather than as a flavour note.
  function maxPack(sp) {
    const h = sp && sp.herd;
    const a = (Array.isArray(h) ? (+h[1] || 0) : 0);
    const b = (+(sp && sp.packs) || 0);
    return a > b ? a : b;
  }
  function isPodSpecies(sp) { return maxPack(sp) >= POD_HERD_MIN; }

  /* HOW MANY DOES IT TAKE — the closed form, and it is closed on purpose.

     Time-to-kill each way is  hp(B) · rate(A) / bite(A) · size(B)^2.2 / size(A)^1.6,
     and predator.js derives every aquatic hunter's rate as k·sqrt(scale) off
     ONE archetype row, so when the two are divided the archetype constant k
     cancels completely:

         ratio = ( hp(B)·bite(B)·sqrt(scale(A)) ) / ( hp(A)·bite(A)·sqrt(scale(B)) )
                 × ( size(B) / size(A) ) ^ 3.8

     That matters for two reasons. It means the threshold is a fact about the
     BESTIARY ROWS and needs no actor to evaluate — so §2's taxonomy can ask
     it — and it means the 3.8 exponent (1.6 of attack plus 2.2 of bulk, twice
     over because it applies to both sides) is the single place individual size
     enters. A megalodon half again as big does not need a special case; the
     exponent does it.

     needed = ratio >= 1 ? ceil(ratio) + 1 : max(1, ceil(ratio))
     — one spare over the break-even, because a fight is not an average. */
  function needFor(hsp, tsp, hSize, tSize) {
    const hHp = +hsp.hp || 40, tHp = +tsp.hp || 40;
    const hBite = +hsp.bite || 1, tBite = +tsp.bite || 1;
    const hSc = +hsp.scale || 1, tSc = +tsp.scale || 1;
    let ratio = (tHp * tBite * Math.sqrt(hSc)) / (hHp * hBite * Math.sqrt(tSc));
    ratio *= Math.pow((tSize || 1) / (hSize || 1), 3.8);
    if (!isFinite(ratio) || ratio <= 0) return 12;
    const n = ratio >= 1 ? Math.ceil(ratio) + 1 : Math.max(1, Math.ceil(ratio));
    return clamp(n, 1, 12);
  }

  function marineRelation(hsp, tsp) {
    if (!hsp || !tsp || hsp === tsp) return 0;
    if (!hsp.aquatic || !tsp.aquatic) return 0;
    if (!((hsp.bite || 0) > 0)) return 0;            // no teeth, no predation
    const r = (tsp.scale || 1) / (hsp.scale || 1);
    const hd = hsp.danger || 0, td = tsp.danger || 0;
    // PREY: smaller than me and less dangerous than me. A loner takes it.
    if (r <= PREY_MAX && td < hd) return 1;
    // MOB: I am a pod animal, it is up to MOB_MAX my size, and it is itself a
    // predator. That is the whole of "what a pod does that a loner does not".
    //
    // ...AND ENOUGH OF ME HAS TO BE POSSIBLE. Without the last clause the
    // taxonomy produced a great barracuda (herd of up to four, scale 0.6)
    // mobbing a great white, because 1.2/0.6 is inside MOB_MAX and a great
    // white is a predator — the numbers said it would take TEN barracuda,
    // which the species can never field. An animal that could not assemble
    // enough of itself does not have this relation at all, and that is one
    // comparison against a number the bestiary already states. It also, for
    // free, stops a pack of three great whites deciding to take a megalodon.
    if (isPodSpecies(hsp) && r <= MOB_MAX && td >= 0.5 &&
        needFor(hsp, tsp, 1, 1) <= maxPack(hsp)) return 2;
    return 0;
  }
  CBZ.marineRelation = marineRelation;

  // The live answer for two actual animals — same function, their own sizes.
  function podNeeded(hunter, target) {
    if (!hunter || !target || !hunter.species || !target.species) return 12;
    return needFor(hunter.species, target.species, sizeOf(hunter), sizeOf(target));
  }
  CBZ.marinePodNeeded = podNeeded;
  CBZ.marinePodNeededFor = needFor;
  CBZ.marineGape = gapeOf;

  // ============================================================
  //  §3. WHO IS FIGHTING WHOM — target selection, throttled and gated.
  // ============================================================
  function alive(a) {
    if (!a || a.dead || a.external || !a.species || !a.species.aquatic || !a.group) return false;
    // A tamed or ridden animal is the player's and the sea leaves it alone —
    // EXCEPT when it says otherwise: modes/shark_sim.js marks the player's
    // own shark `huntable`, because being mobbed by the pod is that game's
    // whole threat curve. Nothing else sets the flag.
    if ((a.tamed || a.ridden) && !a.huntable) return false;
    return true;
  }

  // how many live packmates of `hunter`'s own species are inside POD_R of the
  // target. Linear over the wildlife list, run at most every RESCAN seconds
  // per hunter — a pod is 3-7 and the list is bounded.
  // Throttled: the sweep is O(animals) and a pod does not need to recount
  // itself sixty times a second. Same discipline as wildlife.js's pickPrey.
  function podCount(hunter, target, dt) {
    const m = mp(hunter);
    m.podT -= (dt || 0);
    if (m.podT > 0 && m.podN > 0) return m.podN;
    m.podT = 0.5;
    return (m.podN = podCountNow(hunter, target));
  }
  function podCountNow(hunter, target) {
    const list = CBZ.cityWildlife;
    const tp = actorPos(target);
    if (!list || !tp) return 1;
    const sp = hunter.species;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!alive(o) || o.species !== sp) continue;
      const p = actorPos(o);
      if (!p) continue;
      _t0 = p.x - tp.x; _t1 = p.z - tp.z;
      if (_t0 * _t0 + _t1 * _t1 <= POD_R * POD_R) n++;
    }
    return n || 1;
  }

  function pickTarget(a, dt) {
    const m = mp(a);
    if (m.target && alive(m.target)) {
      // keep it while it is still in reach of the fight
      const tp = actorPos(m.target), hp = actorPos(a);
      if (tp && hp) {
        _t0 = tp.x - hp.x; _t1 = tp.z - hp.z;
        if (_t0 * _t0 + _t1 * _t1 < FIGHT_R2) return m.target;
      }
    }
    m.target = null; m.kind = 0;
    m.scanT -= dt;
    if (m.scanT > 0) return null;
    if (!m.jitter) m.jitter = 0.6 + Math.random() * 0.8;
    m.scanT = RESCAN * m.jitter;

    const hsp = a.species, hp = actorPos(a);
    const list = CBZ.cityWildlife;
    if (!hp || !list) return null;
    const k = kitOf(a);
    const hunger = hungerOf(a);
    // a hunter reaches further for a MOB target than for a snack: an apex is
    // the thing a pod crosses water for.
    const senseR = (k && k.senseR > 0 ? k.senseR : 110) * 2.2;
    let best = null, bestKind = 0, bestScore = -1;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === a || !alive(o)) continue;
      const rel = marineRelation(hsp, o.species);
      if (!rel) continue;
      const p = actorPos(o);
      if (!p) continue;
      _t0 = p.x - hp.x; _t1 = p.z - hp.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 > senseR * senseR) continue;
      /* A FULL PREDATOR DOES NOT HUNT. `hungerOf` consumes a neighbour's
         CBZ.wildlifeHunger defensively (0..1, higher = hungrier) and degrades
         to "ordinarily interested" when that API is absent, so this file works
         whichever order the two land in. It gates PREY only: eating is what
         hunger is about, whereas a pod mobbing an apex is opportunity and
         territory — a fed pod still runs a great white off. */
      if (rel === 1 && hunger < 0.15) continue;
      // a MOB target is the event; prey is the background. A bleeding one is
      // worth more than a healthy one (that is what the chum is FOR).
      const hurt = 1 - clamp((o.hp || 0) / maxHpOf(o), 0, 1);
      const score = (rel === 2 ? 3 : 1) * (1 + hurt) * (rel === 1 ? 0.4 + hunger : 1)
        / (1 + Math.sqrt(d2) * 0.01);
      if (score <= bestScore) continue;
      // never two loners on one snack; a MOB target is explicitly shared.
      if (rel === 1 && o._mpHuntedBy && o._mpHuntedBy !== a && !o._mpHuntedBy.dead) continue;
      bestScore = score; best = o; bestKind = rel;
    }
    if (best && bestKind === 2) {
      // a MOB only happens if the mobber is a pod animal AND has company —
      // one orca does not decide to take a megalodon on its own.
      if (!PODS()) { best = null; bestKind = 0; }
    }
    if (!best) return null;
    if (bestKind === 1) best._mpHuntedBy = a;
    m.target = best; m.kind = bestKind;
    AUDIT.hunts++;
    return best;
  }

  // ============================================================
  //  §4. THE POD. predatorPack already hands out bearings and one commit
  //  token; this is the layer above it that decides what a flanker DOES with
  //  its bearing, which is the part real orcas are famous for: it holds
  //  station until the quarry's nose is somewhere else, then rams the flank.
  // ============================================================
  function podRole(a, target, dt) {
    const m = mp(a);
    if (!PODS() || m.kind !== 2 || typeof CBZ.predatorPack !== "function") {
      m.role = "commit"; return "commit";
    }
    let role = "commit";
    try { role = CBZ.predatorPack(a, target, dt) || "commit"; } catch (e) { role = "commit"; }
    m.role = role;
    return role;
  }

  /* THE FLANK PASS, AND IT IS A BITE (owner, 2026-08-21: "orca attack is
     legit just head butting … it doesn't bite, it headbutts"). The pass
     itself is unchanged pod grammar — leave the bearing, drive in across the
     quarry's beam, carry through, rejoin — and what it does mechanically is
     still the STAGGER: take the quarry's facing away for a beat so the next
     orca is free to come in. But the blow lands with the MOUTH now: jaws
     riding the bite curve, teeth arriving at the flank, and the whole drive
     capped by creature_combat's body-stops-at-body law so the two animals
     COLLIDE at their surfaces instead of passing through each other.

     IT IS A creatureFight STRIKE, not a private animation. The shared combat
     driver already owns the facing, the cadence, the strike window, the
     damage frame, the blood from the contact point and the pose hand-back;
     `bite_flank` lives THERE (creature_combat.js) and this file supplies the
     numbers. ?bitepass=off (CBZ.CONFIG.MARINE_BITE_PASS=false) reverts to
     the old shut-mouth ram_flank, drive-through and all — that is the
     before/after preset's BEFORE column.

     THE GATE IS A BEARING. Coming in on the quarry's nose gets an orca
     killed — so a flanker will not commit until it is more than ~50 degrees
     off the quarry's heading. That single test is what makes the pod LOOK
     like a pod: they slide around it and hit it from the sides while it
     turns. */
  function bitePassOn() {
    return typeof CBZ.creatureBitePass === "function" ? !!CBZ.creatureBitePass() : true;
  }

  /* THE FIGHT LEAVES SOMETHING BEHIND (owner, 2026-08-25: "I want to get part
     of my tail ripped off by an orca bite").

     Before this, a pod could eat a shark alive and the only evidence was a
     health bar: the blows did damage, made white water, put one puff of blood
     in the sea, and the BODY was untouched. Ride that shark and you could not
     tell a landed bite from a near miss.

     So a landed blow takes MATERIAL now, through systems/wounds.js's
     creatureBiteChunk — persistent, deepening with every further bite in the
     same place, and restored only when the rig leaves the scene. Nothing here
     is orca- or shark-specific: it hangs off §7's damage bus, so anything the
     graph lets bite anything gets it.

     WHERE THE TEETH LAND. Not the target's origin — that is the middle of the
     body and a mouth cannot reach it. The attacker's own bearing is projected
     onto the quarry's long axis and clamped to its measured length, then
     pushed out to the measured flank: an orca coming in from behind takes the
     TAIL, one crossing the beam takes the flank, which is both correct and
     the shot the owner asked for.

     ?cfg_CREATURE_BITE_CHUNK=0 (systems/wounds.js) turns it back off. */
  const CHUNK_EVERY = 1.1;             // s per victim — a wound, not a grinder
  // returns TRUE when a wound actually landed — the caller uses that to decide
  // whether it still owes the hit a blood burst of its own.
  function biteChunkOn(a, t, tp, frac) {
    if (typeof CBZ.creatureBiteChunk !== "function") return false;
    if (!a || !t || !tp || !a.species || !t.species) return false;
    if (a.species === t.species) return false;        // a pod squabble is not a meal
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    if (now - (t._mpChunkT || -1e9) < CHUNK_EVERY) return false;
    t._mpChunkT = now;
    const hp = actorPos(a);
    if (!hp) return false;
    const face = (t.heading != null) ? t.heading : (t.group ? -t.group.rotation.y : 0);
    const fx = Math.cos(face), fz = Math.sin(face);
    const L = bodyLen(t) * 0.5, B = bodyBeam(t) * 0.5;
    // along the body: how far back the attacker is, clamped to the real length
    let along = (hp.x - tp.x) * fx + (hp.z - tp.z) * fz;
    along = clamp(along, -L * 0.92, L * 0.6);
    // and out to the flank on the side it came from
    let side = (hp.x - tp.x) * -fz + (hp.z - tp.z) * fx;
    side = side >= 0 ? B : -B;
    _ck.x = tp.x + fx * along - fz * side;
    _ck.z = tp.z + fz * along + fx * side;
    _ck.y = (tp.y || 0) + (Math.random() - 0.5) * B * 0.5;
    let took = false;
    try {
      took = CBZ.creatureBiteChunk(t, _ck, {
        jaw: gapeOf(a) * 0.45,
        sev: clamp((frac || 0.1) * 6 + sizeOf(a) / Math.max(0.2, sizeOf(t)) * 0.4, 0.3, 1),
        bleedS: 16,
      });
      if (took) AUDIT.chunks = (AUDIT.chunks || 0) + 1;
    } catch (e) { took = false; }
    return !!took;
  }
  const _ck = { x: 0, y: 0, z: 0 };
  function ramOpts(a) {
    const m = mp(a);
    if (m.ram) return m.ram;
    const k = kitOf(a);
    const bite = bitePassOn();
    const o = m.ram = {
      style: bite ? "bite_flank" : "ram_flank",
      seize: false,
      speed: (k && k.rushSpeed > 0) ? k.rushSpeed * 0.8 : 10,
      rate: RAM_EVERY * Math.sqrt(sizeOf(a)),
      reach: 0,                                  // set live: it scales with the quarry
      dmg: 0,                                    // set live: sizes on both sides
      onHit: function (d) {
        const t = mp(a).target;
        if (!t || t.dead) return;
        /* BILL THE NUMBER THE DRIVER HANDED US. This used to recompute
           dpsAgainst() and throw the argument away, which was harmless while
           `o.dmg` was the same expression — and became a silent hole the
           moment anything upstream started SHAPING that number. The angle
           contest (systems/bite_angles.js) is exactly that: creature_combat
           scales `dmg` by the geometry at contact before it calls this, so a
           pod bite taken on the quarry's nose is supposed to cost less than
           one taken on its tail. Ignoring `d` would have made the pod the one
           attacker in the game exempt from the law it is meant to teach.
           The recompute stays as the fallback for a caller with no number. */
        hurt(t, (d > 0 ? d : dpsAgainst(a, t) * 1.6), a,
          (bite ? "bitten by a " : "rammed by a ") + label(a));
        if (typeof CBZ.predatorStagger === "function") {
          try { CBZ.predatorStagger(t, STAGGER_S * clamp(sizeOf(a), 0.5, 2)); } catch (e) {}
        }
        const tp = actorPos(t);
        if (tp) {
          // THE READ AT DISTANCE: white water where a three-tonne animal just
          // hit another one.
          //
          // THE BLOOD USED TO BE HERE TOO, AND IT NEVER RAN. This onHit is
          // creature_combat's flank-pass callback, and the note at hurt()'s
          // biteChunkOn call already records the measurement: a pod that took
          // 23% of a great white's health landed exactly ZERO flank passes
          // doing it. So the one bloom that was supposed to be a pod bite's
          // blood in the water was dead code, and every landed blow in this
          // file went through hurt() with no burst at all. The burst now lives
          // there, on the bus every attack actually arrives on. (surfaceHit
          // stays: white water IS ram-specific and would double if it moved.)
          surfaceHit(tp.x, tp.z, 1.6 + sizeOf(a) * 0.9);
        }
        if (CBZ.creatureFlinch) { try { CBZ.creatureFlinch(t); } catch (e) {} }
        AUDIT.rams++;
      },
    };
    const sh = a._shark;
    if (sh && sh.opts && typeof sh.opts.move === "function") o.move = sh.opts.move;
    return o;
  }

  // Contact range for the blow itself: the two bodies' own measured lengths.
  function ramReach(a, target) {
    return bodyLen(a) * 0.55 + bodyLen(target) * 0.42;
  }
  // The attacker's teeth, forward of its group origin, in world metres — the
  // authored mouth's own bite point when there is one. This is the standoff
  // the roll-over hold is measured from, so the jaws ride ON the quarry
  // instead of the two bodies sharing the same water.
  function jawFwdOf(a) {
    const g = a && a.group;
    const mouth = g && g.userData && g.userData.aquaticMouth;
    if (mouth && mouth.bite && mouth.bite.x > 0) {
      return mouth.bite.x * ((g.scale && g.scale.x > 0) ? g.scale.x : 1);
    }
    return bodyLen(a) * 0.5;
  }

  /* WHEN DOES A FLANKER DECIDE TO MAKE A PASS.

     Not "when it is already touching the quarry" — measured, that never
     happens: predatorHunt parks a circling hunter on its orbit radius, which
     for an orca on a megalodon is about 20 m, and the two bodies only reach
     about 12 m. A gate written at contact range fires zero times in a
     ninety-second fight and the pod just circles. So the DECISION is taken
     from a commit distance a bit wider than the orbit, and the closing is
     handed to creature_combat's own approach branch (which drives through the
     shark's water mover, not a raw position write). That is what a pass looks
     like: it leaves the ring, drives in, hits, and rejoins. */
  const RAM_COMMIT_K = 2.6;      // × contact reach: how far out it decides
  const RAM_RUN_MAX = 4.0;       // s it is allowed to spend closing before it gives up

  function ramGate(a, target) {
    if ((a._atkT || 0) > 0) return false;                 // creatureFight's own cadence
    const hp = actorPos(a), tp = actorPos(target);
    if (!hp || !tp) return false;
    // A RAM IS A FLANK BLOW. Coming in on the quarry's nose is a bite, not a
    // ram, and it is the one bearing that gets an orca killed.
    const toMe = Math.atan2(hp.z - tp.z, hp.x - tp.x);
    const face = (target.heading != null) ? target.heading
      : (target.group ? -target.group.rotation.y : 0);
    if (Math.abs(shortAngle(toMe - face)) < 0.9) return false;   // still out in front
    _t0 = tp.x - hp.x; _t1 = tp.z - hp.z;
    const R = ramReach(a, target) * RAM_COMMIT_K;
    return (_t0 * _t0 + _t1 * _t1) <= R * R;
  }

  // Returns true while the ram owns this actor's frame — through the run-in AND
  // the swing. Everything else — station-keeping at its bearing slot — stays on
  // predatorHunt, so the two never drive the same body in the same frame.
  function ramTick(a, target, dt) {
    if (typeof CBZ.creatureFight !== "function") return false;
    const m = mp(a);
    const swinging = (a._atkAnim >= 0);
    if (!swinging) {
      if (!(m.ramRun > 0)) {
        if (!ramGate(a, target)) return false;
        m.ramRun = RAM_RUN_MAX;
        // §L's trick, for the same reason: a fresh attacker is seeded with a
        // cooldown that only ticks while creatureFight is actually being
        // called, so a pass that has already lined up would otherwise wait out
        // a clock that is not running.
        a._atkT = 0;
      } else m.ramRun -= dt;
    }
    const o = ramOpts(a);
    o.reach = ramReach(a, target);
    o.targetRad = bodyBeam(target) * 0.5;      // teeth stop at the measured flank
    o.dmg = dpsAgainst(a, target) * 1.6;
    try { CBZ.creatureFight(a, target, dt, o); } catch (e) {}
    if (a._atkAnim >= 0) { m.ramRun = 0; return true; }   // committed: the swing owns it
    return m.ramRun > 0;                                   // still closing
  }

  // ============================================================
  //  §5. THE ROLL-OVER FINISHER. A shark held upside down goes into tonic
  //  immobility and stops fighting; that is how a pod actually kills one, and
  //  it is the animation that makes this feature. It is GATED ON THE NUMBER
  //  (§ podNeeded) — that single comparison is what turns three orcas into a
  //  stalemate and four into a kill.
  // ============================================================
  function rollReady(a, target, dt) {
    if (!PODS()) return false;
    if (target._mpRoll) return false;                       // already going over
    if ((target.hp || 0) / maxHpOf(target) > ROLL_HP) return false;
    // THE ONE COMPARISON THAT DECIDES THE WHOLE FEATURE. Below the number the
    // pod can harry an apex forever and never finish it (the stalemate); at or
    // above it, the finisher unlocks and the animal dies.
    return podCount(a, target, dt) >= podNeeded(a, target);
  }

  /* THE LATE PASS, and it is not a stylistic choice.

     wildlife.js's animateSwim writes grp.rotation.x (a +X-forward body's ROLL)
     and grp.rotation.z (its pitch) on every aquatic actor every frame, and it
     only yields those two to a flinch or a creature_combat strike. A roll-over
     written from inside the tick loop is therefore overwritten by animateSwim
     on whichever iteration comes later — which is decided by the ORDER OF THE
     ANIMALS ARRAY, i.e. it works or it does not depending on who spawned
     first. So the inversion is applied from this file's own updater at 47.15,
     AFTER wildlife's 47.1, which makes it unconditionally the last writer.
     ROLLING is bounded by the number of concurrent finishers (in practice 1). */
  const ROLLING = [];
  function beginRoll(a, target) {
    const m = mp(a);
    target._mpRoll = { by: a, t: 0, dur: ROLL_S };
    m.rolling = target; m.rollT = 0;
    if (ROLLING.indexOf(target) < 0 && ROLLING.length < 8) ROLLING.push(target);
    AUDIT.rolls++;
    if (typeof CBZ.predatorStagger === "function") {
      try { CBZ.predatorStagger(target, ROLL_S + 1.5); } catch (e) {}
    }
    if (CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(target); } catch (e) {} }
  }

  /* The roll itself. The attacker holds station at the quarry's flank with its
     jaws on the pectoral; the quarry inverts over ROLL_S and takes the whole
     of the rest of its health while it is upside down and not fighting. The
     inversion is creature_combat's CBZ.creatureTonicRoll — the animation owner
     — not a rotation written from here. */
  function stepRoll(a, dt) {
    const m = mp(a);
    const t = m.rolling;
    if (!t || t.dead || !t._mpRoll || t._mpRoll.by !== a) {
      if (t && t._mpRoll && t._mpRoll.by === a) { t._mpRoll = null; clearTonic(t); }
      m.rolling = null; m.rollT = -1; return false;
    }
    const R = t._mpRoll;
    R.t += dt;
    const p = clamp(R.t / R.dur, 0, 1);
    // (the inversion itself is written by tonicPass() at 47.15 — see ROLLING)
    // hold the attacker on the flank, jaws ON the pectoral, riding it over.
    // The station is measured from the TEETH: the orca's own bite point plus
    // a fraction of the quarry's beam, so the mouth grips the fin line and
    // the body stays outside the body it is rolling.
    const hp = actorPos(a), tp = actorPos(t);
    if (hp && tp) {
      const face = (t.heading != null) ? t.heading : -t.group.rotation.y;
      const side = (R.side || (R.side = (Math.random() < 0.5 ? 1 : -1)));
      const br = face + side * 1.35;
      const rr = jawFwdOf(a) + bodyBeam(t) * 0.45;
      const wx = tp.x + Math.cos(br) * rr, wz = tp.z + Math.sin(br) * rr;
      const k = Math.min(1, dt * 3.2);
      hp.x += (wx - hp.x) * k; hp.z += (wz - hp.z) * k;
      hp.y += ((tp.y || 0) + 0.4 - (hp.y || 0)) * k;
      a.heading = Math.atan2(tp.z - hp.z, tp.x - hp.x);
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, a.heading); } catch (e) {} }
      // the grip is a mouth: half-open on the fin for the whole ride
      if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 0.5); } catch (e) {} }
    }
    // the bleed while it is being worked: this is a chum source, and the whole
    // point of §7 is that other sharks come to it.
    if (tp && CBZ.goreBloom && Math.random() < dt * 5) {
      try { CBZ.goreBloom(tp.x, (tp.y || 0) + 0.5, tp.z, { amount: 0.9, arterial: true }); } catch (e) {}
    }
    // damage delivered across the roll, so it dies AT the inversion.
    hurt(t, dpsAgainst(a, t) * 2.4 * dt, a, "drowned by a pod of " + label(a) + "s");
    if (p >= 1 || t.dead) {
      if (!t.dead) hurt(t, maxHpOf(t), a, "drowned by a pod of " + label(a) + "s");
      t._mpRoll = null; m.rolling = null; m.rollT = -1;
      if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 0); } catch (e) {} }   // let go
      return false;                       // hurt() books the kill, once
    }
    return true;
  }

  function tonicPass(dt) {
    for (let i = ROLLING.length - 1; i >= 0; i--) {
      const t = ROLLING[i];
      const R = t && t._mpRoll;
      if (!t || !R) {
        // A DEAD ONE KEEPS THE POSE. It died belly-up; putting it back the
        // right way round on the frame it stops being rolled is the worst
        // possible read, and wildlife.js's own death tumble takes the corpse
        // from here. Only an ABANDONED roll (the roller died, the pod broke
        // off) is unwound.
        if (t && t._tonic && !t.dead) clearTonic(t);
        ROLLING.splice(i, 1);
        continue;
      }
      if (typeof CBZ.creatureTonicRoll === "function") {
        try { CBZ.creatureTonicRoll(t, clamp(R.t / R.dur, 0, 1), dt); } catch (e) {}
      }
    }
  }

  function clearTonic(t) {
    if (typeof CBZ.creatureTonicClear === "function") {
      try { CBZ.creatureTonicClear(t); } catch (e) {}
    }
  }

  // ============================================================
  //  §5b. THE PUBLISHED POD PRIMITIVES — the only reason §4 and §5 are not
  //  private. Everything above is species-blind on purpose, and a file that
  //  wants to give ONE species a signature move (city/wildlife_orca.js, which
  //  owns the orca's own tactics) must be able to spend these rather than
  //  grow a second copy of them. THIS is the seam: general mechanism here,
  //  species flavour there, and orca-vs-megalodon stays a derived row of §2
  //  rather than a special case in either file.
  //
  //  The whole vocabulary, and it is deliberately small:
  //    marinePodRole(a,t,dt)      bearings + one commit token -> commit/flank/hold
  //    marinePodMembers(a,t,out)  who else of my kind is on this quarry
  //    marinePodCount(a,t)        how many of us there are   (live)
  //    marinePodNeeded(a,t)       how many it takes           (the number)
  //    marinePodEnough(a,t)       count >= needed             (the comparison)
  //    marinePodRamReady(a,t)     am I off its nose and inside commit range
  //    marinePodRam(a,t,dt)       take the pass; true while it owns the frame
  //    marinePodRollReady(a,t)    is the finisher unlocked
  //    marinePodRoll(a,t)         start it
  //    marinePodRolling(t)        0..1 while it is going over, else -1
  //    marinePodBreakOff(a,s)     leave, bleeding; re-forms on the next scan
  //    marinePodJoin(a,t)         adopt a quarry explicitly -> 0/1/2
  //    marineHurt(v,dmg,by,cause) the ONE damage path (never write .hp)
  //  plus the three measurements callers keep needing: marineDpsAgainst,
  //  marineBodyLen, marineSurfaceHit.
  // ============================================================
  CBZ.marinePodRole = function (a, t, dt) {
    if (!a || !t) return "commit";
    return podRole(a, t, dt || 0);
  };
  function podMembers(hunter, target, out) {
    out = out || [];
    out.length = 0;
    const list = CBZ.cityWildlife;
    const tp = actorPos(target);
    if (!list || !tp || !hunter || !hunter.species) return out;
    const sp = hunter.species;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!alive(o) || o.species !== sp) continue;
      const p = actorPos(o);
      if (!p) continue;
      _t0 = p.x - tp.x; _t1 = p.z - tp.z;
      if (_t0 * _t0 + _t1 * _t1 <= POD_R * POD_R) out.push(o);
    }
    return out;
  }
  CBZ.marinePodMembers = podMembers;
  CBZ.marinePodCount = function (a, t) { return (a && t) ? podCountNow(a, t) : 0; };
  CBZ.marinePodEnough = function (a, t) {
    if (!a || !t) return false;
    return podCountNow(a, t) >= podNeeded(a, t);
  };
  // Both gated on PODS() so CFG.MARINE_POD = false is a REAL revert for a
  // consumer too — a species file spending these must not keep ramming after
  // the flag that owns pod tactics has been turned off.
  CBZ.marinePodRamReady = function (a, t) { return PODS() && !!(a && t) && ramGate(a, t); };
  CBZ.marinePodRam = function (a, t, dt) { return PODS() && !!(a && t && dt > 0) && ramTick(a, t, dt); };
  // the measured half-beam's owner — systems/predator.js asks for it so a
  // committed rush can stop at the SURFACE of a body this file has measured
  CBZ.marineBodyBeam = bodyBeam;
  CBZ.marinePodRollReady = function (a, t) { return !!(a && t) && rollReady(a, t, 0); };
  CBZ.marinePodRoll = function (a, t) {
    if (!PODS() || !a || !t || t._mpRoll || t.dead) return false;
    beginRoll(a, t);
    return true;
  };
  CBZ.marinePodRolling = function (t) {
    const R = t && t._mpRoll;
    return R ? clamp(R.t / R.dur, 0, 1) : -1;
  };
  /* BREAK OFF AND RE-FORM. Leaving is a real event — it bleeds, it spends
     predator.js's own disengage timer, and it forgets the quarry — and
     re-forming needs no API at all: the next §3 scan after the timer expires
     picks the same quarry back up, which is exactly what a pod that has
     regrouped looks like. */
  CBZ.marinePodBreakOff = function (a, secs) {
    if (!a) return false;
    bleedInWater(a, 0.8);
    if (typeof CBZ.predatorBreakOff === "function") {
      try { CBZ.predatorBreakOff(a, secs > 0 ? secs : 12); } catch (e) {}
    }
    drop(a);
    AUDIT.brokeOff++;
    return true;
  };
  /* ADOPT A QUARRY. For a caller that has already decided who is fighting whom
     (a scripted encounter, a stager, a species file with its own trigger) and
     wants the shared drive to take it from there. Returns the §2 relation it
     was accepted as, or 0 if the graph says these two do not fight. */
  CBZ.marinePodJoin = function (a, t) {
    if (!a || !t || !a.species || !t.species) return 0;
    const rel = marineRelation(a.species, t.species);
    if (!rel) return 0;
    const m = mp(a);
    m.target = t; m.kind = rel; m.scanT = RESCAN;
    if (rel === 1) t._mpHuntedBy = a;
    return rel;
  };
  CBZ.marineHurt = function (v, dmg, by, cause) { hurt(v, dmg, by, cause); };
  CBZ.marineDpsAgainst = dpsAgainst;
  CBZ.marineBodyLen = bodyLen;
  CBZ.marineSurfaceHit = surfaceHit;

  // ============================================================
  //  DAMAGE goes through the ONE animal bus. cityWildlifeHit is what turns a
  //  lethal hit into a real carcass, a pelt and a flinch; writing .hp here
  //  would make a killed orca a frozen prop.
  // ============================================================
  const _hit = { head: false, point: null, dir: null, from: null };
  const _w = { damage: 0, by: null, cause: "" };
  function label(a) {
    const sp = a && a.species;
    return String((sp && (sp.name || sp.id)) || "animal").toLowerCase();
  }
  /* YOU CANNOT BITE AN APEX TO DEATH — YOU HAVE TO TURN IT OVER.

     This is the rule that makes the numbers mean anything, and without it the
     whole design collapses into arithmetic: three orcas landing flank rams do
     about 43 damage a second between them, so they would grind a megalodon's
     1200 hp down and kill it in half a minute, and "enough orcas" would mean
     nothing because ANY orcas would eventually do. It is also what actually
     happens: a pod does not chew a big shark to death, it immobilises it.

     So a MOB relation (§2 — the pod-only row) cannot take its quarry below
     MOB_FLOOR by ordinary damage. Everything above that is real: the animal
     visibly loses the fight, bleeds, and is worn down to the edge. The last
     fraction belongs to the roll-over, and the roll-over belongs to the
     number. A pod one short of it can fight forever and never finish.

     PREY rows are untouched — a great white eating a tuna is not a siege. */
  const MOB_FLOOR = ROLL_HP - 0.06;
  function hurt(victim, dmg, by, cause) {
    if (!victim || victim.dead || !(dmg > 0)) return;
    /* A HIT ON A BALLED-UP SCHOOL EATS THE SCHOOL, NOT THE FISH. One guarded
       call into city/marine_frenzy.js, which owns the ball and therefore owns
       what its remaining mass is. Without it the anchor fish (3 hp) dies to the
       first bite and the whole event is over before the player can see it. */
    if (typeof CBZ.marineFrenzyAbsorb === "function") {
      let ate = false;
      try { ate = CBZ.marineFrenzyAbsorb(victim, dmg); } catch (e) { ate = false; }
      if (ate) return;
    }
    if (by && by.species && victim.species && !victim._mpRoll &&
        marineRelation(by.species, victim.species) === 2) {
      const floor = maxHpOf(victim) * MOB_FLOOR;
      dmg = Math.min(dmg, Math.max(0, (victim.hp || 0) - floor));
      if (!(dmg > 0)) { bleedInWater(victim, 0.6); return; }
    }
    const was = victim.hp;
    if (typeof CBZ.cityWildlifeHit === "function") {
      _hit.from = actorPos(by); _hit.point = actorPos(victim);
      _w.damage = dmg; _w.by = by; _w.cause = cause || ("killed by a " + label(by));
      try { CBZ.cityWildlifeHit(victim, _hit, _w); } catch (e) { victim.hp -= dmg; }
    } else {
      victim.hp -= dmg;
      if (victim.hp <= 0) victim.dead = true;
    }
    if (was > 0 && victim.dead) {
      if (by && victim.species !== by.species) {
        AUDIT.kills++;
        // A POD MEMBER THAT DIED. Recorded as a casualty rather than a kill of
        // the pod's, because "how many did it cost" is the number that says
        // whether a pod that small should have tried at all.
        if (marineRelation(victim.species, by.species) === 2) AUDIT.casualties++;
      }
      const m = victim._mp;
      if (m) { m.target = null; m.rolling = null; }
      if (victim._mpRoll) { victim._mpRoll = null; clearTonic(victim); }
      /* THE KILL PAYOFF. A death is the moment the whole hunt was for, and
         until now it looked identical to a nick: the same 0.3s puff, then
         nothing. gore.js's kill cloud is the other shape — a full burst, a
         slow haze shell around the corpse that is still there when you swim
         back, and a slick on the surface directly above it, which from a boat
         IS the kill. Sized by the body: a tuna is a puff, an orca is weather.
         Once per animal (systems/wounds.js sets the same flag for kills that
         arrive by any other path), and a no-op out of the water. */
      if (typeof CBZ.goreKillCloud === "function" && !victim._cbzKillCloud) {
        victim._cbzKillCloud = 1;
        const vp = actorPos(victim);
        if (vp) {
          const L = bodyLen(victim);
          try {
            CBZ.goreKillCloud(vp.x, (vp.y || 0) + 0.2, vp.z,
              { size: clamp((L > 0 ? L : 4) * 0.22, 0.5, 2.6) });
          } catch (e) {}
        }
      }
    }
    // WHOEVER JUST BLED IS CHUM. One call into §7 — never a second blood system.
    const frac = dmg / Math.max(1, maxHpOf(victim));
    bleedInWater(victim, clamp(frac * 3.2, 0.25, 1));
    // AND WHOEVER JUST GOT BITTEN IS SMALLER. Same placement, same reasoning:
    // this is the one bus every marine blow arrives on, so the body-damage
    // call belongs here and not at any one attack's call site. Measured the
    // hard way — hung off the flank pass's own onHit first, and a pod that
    // took 23% of a great white's health in a staged fight landed exactly
    // zero flank passes doing it: the roll-over row and predatorHunt's own
    // strikes are the paths that actually connect, and they all end here.
    /* AND THE BURST. The chum trail above is the SLOW half — a puff every
       0.35s wherever the body is — so on its own a landed bite from a
       three-tonne animal read as a leak rather than as a blow.

       creatureBiteChunk already fires the better version of this burst: it
       knows the wound's real position on the flank and the outward normal of
       the surface it opened, so its plume erupts OUT of the body instead of
       ballooning around the body's centre. So this is the FALLBACK, fired
       only when the chunk did not land (out of the camera's band, the rig has
       its four wounds already, no part under the teeth) — never both, because
       two blooms on one bite is the red-lens failure wildlife_tame.js already
       measured and tuned away from.

       The `frac > 0.03` gate is what keeps either off the roll-over finisher,
       which calls hurt() every frame with a sliver of damage and would
       otherwise stack six clouds a second in front of a chase camera. */
    if (frac > 0.03) {
      const took = biteChunkOn(by, victim, actorPos(victim), frac);
      if (!took && typeof CBZ.goreBloom === "function") {
        const bp = actorPos(victim);
        if (bp) {
          try {
            CBZ.goreBloom(bp.x, (bp.y || 0) + 0.3, bp.z,
              { amount: clamp(0.5 + frac * 4, 0.5, 1.8), arterial: frac > 0.12 });
          } catch (e) {}
        }
      }
    }
  }

  function surfaceHit(x, z, power) {
    if (typeof CBZ.waterSplashAt !== "function") return;
    let y = 0;
    if (typeof CBZ.citySeaHeightAt === "function") { try { y = CBZ.citySeaHeightAt(x, z); } catch (e) { y = 0; } }
    try { CBZ.waterSplashAt(x, y, z, clamp(power, 0.5, 4)); } catch (e) {}
  }

  // ============================================================
  //  §6. A BIG SHARK TAKES A SMALL BOAT.
  //
  //  THE GATE IS THE JAWS, NOT A LIST OF BOAT NAMES. water_hulls.js registers
  //  every hull's real LOA, beam and tonnage; gapeOf() knows how wide this
  //  animal's tooth ring opens. It can take the hull if the jaws close ACROSS
  //  THE BEAM and the animal outweighs it. A Speedboat (beam 2.1 m, 1.6 t)
  //  against a megalodon (gape ~2.9 m, ~29 t) is food; a Bellamar cruiser
  //  (beam 4.2 m) and a 34 m Nordholm are not, and nobody had to say so.
  // ============================================================
  function hullSpec(car) {
    if (!car) return null;
    if (car._hullSpec) return car._hullSpec;
    if (CBZ.marineHulls && CBZ.marineHulls.specFor) {
      try { return CBZ.marineHulls.specFor(car); } catch (e) { return null; }
    }
    return null;
  }
  function biteableHull(a, car) {
    if (!SHIPS() || !a || !car || car.dead) return false;
    const s = hullSpec(car);
    if (!s || !(s.beam > 0)) return false;
    if (gapeOf(a) < s.beam) return false;                 // the jaws do not span it
    if ((s.massT || 0) > tonnesOf(a) * 1.4) return false; // and it cannot move it
    return true;
  }
  CBZ.marineBiteableHull = biteableHull;

  /* DID THE TEETH REACH THE HULL. creature_combat solved this for flesh —
     jawReaches() asks where the animal's OWN teeth are at the frame they close
     and whether that point is inside the victim's body — and a boat deserves
     the same discipline, except a boat is not a circle: it is an oriented box
     LOA long and `beam` wide. So the jaw point is taken into the hull's own
     frame and tested against that box. A short bite MISSES. */
  function jawInHull(a, car, spec) {
    if (typeof CBZ.creatureJawWorld !== "function") return false;
    let J = null;
    try { J = CBZ.creatureJawWorld(a); } catch (e) { J = null; }
    if (!J) return false;
    const p = car.pos || (car.group && car.group.position);
    if (!p) return false;
    const h = (car.heading != null) ? car.heading
      : (car.group ? -car.group.rotation.y : 0);
    _t0 = J.x - p.x; _t1 = J.z - p.z;
    const c = Math.cos(h), s = Math.sin(h);
    // hull-local: +u along the keel, +v across the beam
    const u = _t0 * c + _t1 * s;
    const v = -_t0 * s + _t1 * c;
    const tol = 0.35 + gapeOf(a) * 0.25;                 // a snout is a box, be fair
    return Math.abs(u) <= spec.loa * 0.5 + tol && Math.abs(v) <= spec.beam * 0.5 + tol;
  }

  /* THE BITE ITSELF. Everything visible about it is composed from primitives
     that already exist: crashfx's ejecta cone throws the splinters, the marine
     hull registry's own damage bus (cityDamageCar with `bite:true`) crushes the
     boat and — the moment its engine is gutted — hands the intact wreck to
     water_float's flooding/sinking owner, which is why there is no explosion.
     The occupants go into the sea, where §7 makes them bleed, which is what
     brings the rest of the sharks. The systems compose; none of them is
     re-written here. */
  function biteHull(a, car) {
    const spec = hullSpec(car);
    if (!spec) return false;
    if (!jawInHull(a, car, spec)) return false;
    const m = mp(a);
    const p = car.pos || car.group.position;
    let J = null;
    try { J = CBZ.creatureJawWorld(a); } catch (e) { J = null; }
    const bx = J ? J.x : p.x, bz = J ? J.z : p.z;
    let by = J ? J.y : 0;
    if (typeof CBZ.citySeaHeightAt === "function") { try { by = CBZ.citySeaHeightAt(bx, bz); } catch (e) {} }

    // the jaws close ACROSS the beam — the bite axis is the animal's heading
    const hd = (a.heading != null) ? a.heading : -a.group.rotation.y;
    const nx = Math.cos(hd), nz = Math.sin(hd);

    // 1. STRUCTURE. The shared vehicle damage bus, told it was a bite: no
    //    fireball, engine gutted, and vehicles.js hands the hull to the sinking
    //    owner the frame it dies. Scaled so a megalodon needs two or three
    //    passes on a speedboat rather than one.
    // Sized so a megalodon needs two or three passes on a speedboat rather
    // than deleting it in one — the sequence IS the feature, and a one-frame
    // kill has no sequence in it.
    const dmg = Math.max(45, Math.round(dpsOf(a) * 2.2 * Math.pow(sizeOf(a), 1.6)));
    if (typeof CBZ.cityDamageCar === "function") {
      _shipOpts.byPlayer = false; _shipOpts.bite = true; _shipOpts.crumple = true;
      _shipPt.x = bx; _shipPt.y = by; _shipPt.z = bz;
      _shipN.x = -nx; _shipN.y = 0; _shipN.z = -nz;
      _shipOpts.point = _shipPt; _shipOpts.normal = _shipN;
      try { CBZ.cityDamageCar(car, dmg, _shipOpts); } catch (e) {}
    }
    // 2. THE HULL CRUSHES AT THE BITE LINE. crashdeform owns the crater loop;
    //    `hull:true` is how a caller declares a structural bite so the boat
    //    exclusion (written for open frames) steps aside for this one case.
    if (typeof CBZ.cityCarImpact === "function" && _shipPt && _shipN) {
      try {
        CBZ.cityCarImpact(car, _shipPt, _shipN, 16 + sizeOf(a) * 10,
          { r: Math.max(0.6, gapeOf(a) * 0.45), hull: true });
      } catch (e) {}
    }
    // 3. SPLINTERS. The repo's own directed-debris primitive, aimed along the
    //    bite line and out of the water.
    if (typeof CBZ.cityEjectaCone === "function") {
      try { CBZ.cityEjectaCone(bx, by + 0.5, bz, nx, nz, 1.4 + sizeOf(a) * 0.5, { spread: 0.85 }); } catch (e) {}
    }
    // 4. THE BOAT IS LIFTED AND SHAKEN. Impulse into the fields the hull
    //    physics already integrates; the roll is the shake.
    const lift = 2.2 + sizeOf(a) * 1.4;
    car.vx = (car.vx || 0) + nx * lift;
    car.vz = (car.vz || 0) + nz * lift;
    car.v = Math.max(0, (car.v || 0) * 0.3);
    if (car.group) car.group.rotation.z += (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.12);
    surfaceHit(bx, bz, 3.2);
    if (CBZ.shake) { try { CBZ.shake(Math.min(0.9, 0.3 + sizeOf(a) * 0.2)); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("hit"); } catch (e) {} }
    // 5. THE MEN GO IN THE WATER, where §7 makes them bleed and the sea does
    //    the rest. Never our own damage path: cityKillPed / the ped bus owns it.
    throwOccupants(car, bx, bz, nx, nz);
    /* 6. AND THE WATER BOILS. A sinking boat with men in the water is a
       frenzy site by any definition, and city/marine_frenzy.js already owns
       "white water over a point in the sea" — so this is one guarded call
       rather than a second copy of it. It is also the only thing in this
       sequence that is visible from the far side of the bay. */
    if (typeof CBZ.marineFrenzyAt === "function") {
      try { CBZ.marineFrenzyAt(bx, bz, { boil: true, seconds: 40, press: 0.9 }); } catch (e) {}
    }
    car._mpBites = (car._mpBites || 0) + 1;
    m.shipT = 1.4;
    AUDIT.shipBites++;
    if (car.dead) AUDIT.shipsSunk++;
    return true;
  }
  const _shipOpts = { byPlayer: false, bite: true, crumple: true, point: null, normal: null };
  const _shipPt = { x: 0, y: 0, z: 0 };
  const _shipN = { x: 0, y: 0, z: 0 };

  function throwOccupants(car, bx, bz, nx, nz) {
    const peds = CBZ.cityPeds;
    if (!peds) return;
    const p = car.pos || (car.group && car.group.position);
    if (!p) return;
    const R = 5.5;
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q || q.dead || !q.pos) continue;
      _t0 = q.pos.x - p.x; _t1 = q.pos.z - p.z;
      if (_t0 * _t0 + _t1 * _t1 > R * R) continue;
      if (q.inCar) q.inCar = null;
      // over the side, along the bite line
      q.pos.x += nx * (1.4 + Math.random() * 2.2) + (Math.random() - 0.5) * 2;
      q.pos.z += nz * (1.4 + Math.random() * 2.2) + (Math.random() - 0.5) * 2;
      if (CBZ.body && CBZ.body.hit) {
        try {
          CBZ.body.hit(q, { fromX: bx, fromZ: bz, force: 8, knockdown: 1.6 });
        } catch (e) {}
      }
      /* THEY GO IN HURT, AND THEY GO IN ALIVE. Killing them here would be
         two mistakes at once. It would put a killfeed line on the screen for
         an event the owner explicitly wants to read with no UI, and it would
         throw away the whole composition: what makes this sequence land is
         that the men are IN THE WATER, BLEEDING — which §7 turns into chum,
         which draws the sharks, which is the ending. The sea finishes them,
         not this function. Floored well above zero so the impact can never be
         the thing that kills somebody. */
      const mx = (+q.maxHp > 0) ? +q.maxHp : 100;
      const hurtTo = mx * (0.18 + Math.random() * 0.22);
      if (q.hp == null || q.hp > hurtTo) q.hp = Math.round(hurtTo);
      surfaceHit(q.pos.x, q.pos.z, 1.1);
    }
  }

  // A boat is only a target while it is ON the water, near this animal, small
  // enough, and this animal is big enough to be interested at all.
  function pickHull(a) {
    if (!SHIPS()) return null;
    const cars = CBZ.cityCars;
    const hp = actorPos(a);
    if (!cars || !hp) return null;
    const R = bodyLen(a) * 8;
    let best = null, bd = R * R;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.pos) continue;
      const p = c.pos;
      _t0 = p.x - hp.x; _t1 = p.z - hp.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 > bd) continue;
      if (!biteableHull(a, c)) continue;
      bd = d2; best = c;
    }
    return best;
  }

  // ============================================================
  //  §7. BLOOD IN THE WATER — THE PRODUCERS.
  //
  //  ONE helper and ONE poll. `bleedInWater(ref, severity)` is the single
  //  answer to "is this bleeding thing genuinely in water, and how badly" —
  //  every producer below calls it and nothing anywhere re-implements a water
  //  test. Handles are pooled and re-used, their x/y/z are FUNCTIONS so a
  //  trail follows a moving body (gore.js's own `cval` contract), and we hold
  //  at most CHUM_SLOTS of gore.js's 12 so swim.js's wounded player and
  //  fishing.js's bait station can always still open one.
  //
  //  NOTHING BELOW WRITES TO ANY HUD. Not a toast, not a marker, not a feed
  //  line. The plume, the slick and the animals that turn up ARE the signal.
  // ============================================================
  const SLOTS = [];
  for (let i = 0; i < CHUM_SLOTS; i++) SLOTS.push({ ref: null, h: null, sev: 0, t: 0, fx: null, fy: null, fz: null });

  function inWater(x, y, z) {
    if (typeof CBZ.goreMedium === "function") {
      try { return CBZ.goreMedium(x, y, z) === "water"; } catch (e) {}
    }
    if (typeof CBZ.predatorMedium === "function") {
      try { return CBZ.predatorMedium(x, y, z) === "water"; } catch (e) {}
    }
    if (typeof CBZ.cityWaterAt === "function") {
      try { return !!CBZ.cityWaterAt(x, z); } catch (e) {}
    }
    return false;
  }

  /* WHICH SLOT. Mine if I already hold one; otherwise a free one; otherwise —
     and this is the part that matters — the WEAKEST trail currently running,
     but only if I am meaningfully worse off than it. gore.js caps the whole
     game at twelve chum sources and we deliberately hold at most six, so with
     a boatload of wounded in the water the question "which six" has to have an
     answer, and "the six that happened to bleed first" is the wrong one. */
  function slotFor(ref, sev) {
    let free = -1, weak = -1, weakSev = 1e9;
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      if (s.ref === ref) return s;
      if (!s.ref) { if (free < 0) free = i; continue; }
      if (s.sev < weakSev) { weakSev = s.sev; weak = i; }
    }
    if (free >= 0) return SLOTS[free];
    if (weak >= 0 && sev > weakSev * 1.35) { releaseSlot(SLOTS[weak]); return SLOTS[weak]; }
    return null;
  }
  function releaseSlot(s) {
    if (!s) return;
    if (s.h && typeof CBZ.goreChumStop === "function") { try { CBZ.goreChumStop(s.h); } catch (e) {} }
    s.ref = null; s.h = null; s.sev = 0; s.t = 0;
  }

  /* THE ONE PRODUCER. `ref` is whatever is bleeding (an animal record, a ped,
     a car): its live position is read through the closures we build once and
     keep on the slot, so the trail follows it for free. Severity 0..1.
     Refuses when: the flag is off, gore has no chum, the point is not water,
     or nothing near enough to smell it is anywhere close. */
  function bleedInWater(ref, sev) {
    if (!CHUMS() || !ref || typeof CBZ.goreChum !== "function") return false;
    const p = ref.pos || (ref.group && ref.group.position);
    if (!p) return false;
    if (!inWater(p.x, p.y || 0, p.z)) return false;
    // distance gate: a trail nothing can reach is 12 slots wasted.
    const P = playerPos();
    if (P) {
      _t0 = p.x - P.x; _t1 = p.z - P.z;
      if (_t0 * _t0 + _t1 * _t1 > (CHUM_R * 3) * (CHUM_R * 3)) return false;
    }
    sev = clamp(sev, 0.15, 1);
    const s = slotFor(ref, sev);
    if (!s) return false;
    // still running with time on it: top up the severity and leave it alone.
    // (reopened at 2 s rather than at 0 so the handle never actually lapses —
    // gore.js gives it a 7 s ttl and we hold the slot for 6.)
    if (s.ref === ref && s.h && s.t > 2) { if (sev > s.sev) s.sev = sev; return true; }
    if (s.h) { try { CBZ.goreChumStop(s.h); } catch (e) {} s.h = null; }
    if (s.ref !== ref) {
      s.ref = ref;
      s.fx = function () { const q = ref.pos || (ref.group && ref.group.position); return q ? q.x : 0; };
      s.fy = function () { const q = ref.pos || (ref.group && ref.group.position); return q ? (q.y || 0) + 0.4 : 0; };
      s.fz = function () { const q = ref.pos || (ref.group && ref.group.position); return q ? q.z : 0; };
    }
    s.sev = sev;
    s.t = 6;
    try { s.h = CBZ.goreChum(s.fx, s.fy, s.fz, sev, 7); } catch (e) { s.h = null; }
    if (s.h) AUDIT.chumOpened++; else s.ref = null;
    return !!s.h;
  }
  CBZ.marineBleed = bleedInWater;

  /* THE POLL. 2.5 Hz. It asks the two seams that already know who is in the
     water rather than inventing a third:
       • CBZ.waterOccupants() — water_float.js's live list of everything in or
         on the sea: corpses, peds, the player, boats, drifting props. That one
         call covers the shot NPC who fell off the pier, the body dumped over
         the side, and the crew member bleeding on a deck awash.
       • CBZ.cityWildlife — a wounded or dead marine animal. A harpooned whale,
         a fish a bigger fish just bit, an orca that took a megalodon's bite.
     The player is deliberately SKIPPED: city/swim.js already owns that trail
     and two producers on one body is exactly the duplication this repo bans. */
  const _occ = [];
  let chumT = 0;
  function chumPoll(dt) {
    if (!CHUMS()) {
      for (let i = 0; i < SLOTS.length; i++) if (SLOTS[i].ref) releaseSlot(SLOTS[i]);
      return;
    }
    for (let i = 0; i < SLOTS.length; i++) {
      const s = SLOTS[i];
      if (!s.ref) continue;
      s.t -= dt;
      const r = s.ref;
      const gone = (r.dead && r.skinT != null && r.skinT <= 0) || r._despawned;
      if (s.t <= 0 || gone) releaseSlot(s);
    }
    chumT -= dt;
    if (chumT > 0) { AUDIT.chumLive = liveSlots(); return; }
    chumT = CHUM_HZ;

    const P = playerPos();
    // 1. everything already floating (water_float.js's own seam)
    if (typeof CBZ.waterOccupants === "function") {
      try {
        CBZ.waterOccupants(_occ);
        for (let i = 0; i < _occ.length; i++) {
          const o = _occ[i];
          if (!o || !o.ref) continue;
          if (o.kind === "player") continue;          // swim.js owns that trail
          if (o.kind === "boat" || o.kind === "car" || o.kind === "prop") continue;
          if (P) {
            _t0 = o.x - P.x; _t1 = o.z - P.z;
            if (_t0 * _t0 + _t1 * _t1 > CHUM_R * CHUM_R) continue;
          }
          if (o.kind === "corpse") { bleedInWater(o.ref, 0.75); continue; }
          // alive: only a genuinely hurt one bleeds. Same threshold shape
          // swim.js uses on the player — below 72% of your health you trail.
          const q = o.ref;
          const mx = (+q.maxHp > 0) ? +q.maxHp : 100;
          const hpf = (q.hp == null) ? 1 : clamp(q.hp / mx, 0, 1);
          if (hpf < 0.72) bleedInWater(q, clamp((0.72 - hpf) * 1.6 + 0.22, 0.2, 1));
        }
      } catch (e) {}
    }
    // 2. marine animals — the sea's own wounded and dead
    const list = CBZ.cityWildlife;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.species || !a.species.aquatic || a.external) continue;
        const p = a.pos || (a.group && a.group.position);
        if (!p) continue;
        if (P) {
          _t0 = p.x - P.x; _t1 = p.z - P.z;
          if (_t0 * _t0 + _t1 * _t1 > CHUM_R * CHUM_R) continue;
        }
        if (a.dead) {
          // a carcass in the water is the strongest chum there is, and it
          // stops being one once wildlife.js has skinned or retired it.
          if (a.skinned) continue;
          bleedInWater(a, 0.9);
          continue;
        }
        const hpf = clamp((a.hp || 0) / maxHpOf(a), 0, 1);
        if (hpf < 0.72) bleedInWater(a, clamp((0.72 - hpf) * 1.6 + 0.22, 0.2, 1));
      }
    }
    AUDIT.chumLive = liveSlots();
  }
  function liveSlots() { let n = 0; for (let i = 0; i < SLOTS.length; i++) if (SLOTS[i].h) n++; return n; }

  // ============================================================
  //  §8. THE DRIVE. One function, called from the sharkBrain wrapper, which is
  //  itself called by wildlife.js's aquatic branch. Returns true when a marine
  //  hunt owns this actor's transform for the frame — same contract sharkBrain
  //  already has with wildlife.js, so nothing downstream changes.
  // ============================================================
  function optsFor(a) {
    const m = mp(a);
    if (m.opts) return m.opts;
    const base = kitOf(a);
    const out = m.opts = {};
    if (base) for (const k in base) out[k] = base[k];
    // THE MOVER IS THE SHARK'S OWN. wildlife_shark.js published exactly one
    // water mover and this file is not going to write a second; ensure() has
    // already built it as a closure over this actor.
    const sh = a._shark;
    if (sh && sh.opts) {
      if (typeof sh.opts.move === "function") out.move = sh.opts.move;
      // depth + shoreline clearance follow the shark's own state table
      if (typeof sh.opts.onState === "function") out.onState = sh.opts.onState;
    }
    // damage sink: an ANIMAL, never the player's health bar. (wildlife.js
    // documents this exact trap — one merged kit object per actor — which is
    // why `out` is ours and predatorKit was only ever asked for its base.)
    out.onHit = function (d) {
      const t = mp(a).target;
      if (!t || t.dead) return;
      hurt(t, d * Math.pow(sizeOf(a), 1.6) / Math.pow(sizeOf(t), 2.2), a,
        "killed by a " + label(a));
    };
    out.canReach = function (t) { return !!t && !t.dead && !mp(a).held; };
    out.seize = false;              // animals do not get the player grab machine
    return out;
  }

  function marineStep(a, dt, P) {
    if (!ON() || !a || !dt || a.dead || a.tamed || a.ridden || a.external) return false;
    const sp = a.species;
    if (!sp || !sp.aquatic) return false;
    const grp = a.group;
    if (!grp) return false;
    const m = mp(a);

    // ---- THE DISTANCE GATE. Two hypots, and out. ---------------------------
    const pp = P || playerPos();
    let pd2 = 0;
    if (pp) {
      _t0 = grp.position.x - pp.x; _t1 = grp.position.z - pp.z;
      pd2 = _t0 * _t0 + _t1 * _t1;
      const busy = !!(m.target || m.rolling || m.shipTarget);
      if (pd2 > (busy ? FIGHT_R2 : SIM_R2)) { if (m.target) drop(a); return false; }
    }

    // ---- ROLL-OVER in progress owns everything ------------------------------
    if (m.rolling) { if (stepRoll(a, dt)) { show(a, pd2); return true; } }

    // ---- the quarry is being rolled: it does not fight, it goes over --------
    if (a._mpRoll) { show(a, pd2); return true; }        // the roller drives us

    // ---- A BOAT IS A BIGGER EVENT THAN A FISH -------------------------------
    if (SHIPS()) {
      m.shipT -= dt;
      if (!m.shipTarget || m.shipTarget.dead || !biteableHull(a, m.shipTarget)) {
        m.shipScan = (m.shipScan || 0) - dt;
        if (m.shipScan <= 0) { m.shipScan = 1.1; m.shipTarget = pickHull(a); }
      }
      if (m.shipTarget && !m.shipTarget.dead) {
        if (stepShip(a, m.shipTarget, dt)) { show(a, pd2); return true; }
      }
    }

    // ---- ordinary marine predation -----------------------------------------
    const target = pickTarget(a, dt);
    if (!target) {
      /* NOTHING LIVING TO HUNT — BUT A CARCASS IS STILL FOOD. One seam, and it
         is a seam rather than code here because city/marine_frenzy.js owns the
         carcass sites and drives a scavenger through the SAME CBZ.predatorHunt
         this function does. Guarded: without that file the actor falls through
         to the shark's own player hunt exactly as before. */
      if (typeof CBZ.marineScavengeStep === "function") {
        let ate = false;
        try { ate = CBZ.marineScavengeStep(a, dt); } catch (e) { ate = false; }
        if (ate) { a.state = "wander"; show(a, pd2); return true; }
      }
      return false;                                     // the player hunt gets it
    }

    // A POD MEMBER THAT IS LOSING LEAVES, AND IT LEAVES BLEEDING. That is what
    // makes one orca against a megalodon a visible defeat rather than a draw.
    if (m.kind === 2) {
      const hpf = clamp((a.hp || 0) / maxHpOf(a), 0, 1);
      if (hpf < BREAKOFF_HP && podCount(a, target, dt) < podNeeded(a, target)) {
        bleedInWater(a, 0.8);
        if (typeof CBZ.predatorBreakOff === "function") { try { CBZ.predatorBreakOff(a, 12); } catch (e) {} }
        drop(a);
        AUDIT.brokeOff++;
        return false;
      }
    }

    /* THE POD'S THREE ROLES, and what each one is allowed to do.

       predatorPack answers "commit" / "flank" / "hold" — one animal holds the
       commit token, up to PACK_FLANK_MAX take a bearing slot around the
       quarry (it also sets their orbitDir so they SPREAD instead of stacking),
       and the rest stand off. What a caller does with that answer is its own
       business, and the documented land recipe — wire flank AND hold into
       `canReach = () => false` — is wrong here for a reason worth writing
       down: predatorHunt's `scent` case bounces an unreachable target
       straight back to `cruise`, and the LAND callers survive that because
       wildlife.js's own wander keeps driving the body. This file OWNS the
       transform while it is hunting, so an unreachable flanker would simply
       stop dead in the water. Measured, not assumed: it freezes on the frame
       the token changes hands.

       So only `hold` is made unreachable — and a held animal deliberately
       returns the actor to wildlife.js's wander below, which is the correct
       owner for something that is not currently in the fight. A flanker stays
       reachable, circles at the bearing predatorPack gave it, and rams. */
    const role = podRole(a, target, dt);
    const opts = optsFor(a);
    m.held = (role === "hold");

    // A FLANKER THAT HAS A PASS LINED UP TAKES IT, and while that swing is in
    // flight the shared combat driver owns the body outright — calling the
    // hunt FSM's mover in the same frame is the two-writers bug this repo's
    // own headers keep indicting. Any frame the ram is not swinging falls
    // straight through to predatorHunt, which is what keeps the flanker on
    // its bearing slot instead of standing still between passes.
    if (role === "flank" && ramTick(a, target, dt)) { show(a, pd2); return true; }

    // THE FINISHER. Checked before the hunt tick so the frame it unlocks is the
    // frame it starts — a pod that has earned the kill does not circle again.
    if (m.kind === 2 && role === "commit" && rollReady(a, target, dt)) {
      const hp = actorPos(a), tp = actorPos(target);
      _t0 = tp.x - hp.x; _t1 = tp.z - hp.z;
      if (_t0 * _t0 + _t1 * _t1 < Math.pow(bodyLen(a) * 0.9 + bodyLen(target) * 0.5, 2)) {
        beginRoll(a, target);
        show(a, pd2);
        return true;
      }
    }

    let st = "cruise";
    if (typeof CBZ.predatorHunt === "function") {
      try { st = CBZ.predatorHunt(a, target, dt, opts) || "cruise"; } catch (e) { st = "cruise"; }
    }

    /* ============================================================
       A POD DOES NOT LOSE ITS QUARRY BY DRIFTING AWAY FROM IT.

       MEASURED, and it is why the pod's flank pass had fired zero times since
       it was written. Staged as an arena — four orcas, one shark, nothing
       else in that sea — and run for 150 game seconds, the orcas finished the
       fight 190, 304 and 322 metres from a quarry they were all still
       correctly targeting. Two bites landed in two and a half minutes.

       The mechanism is a seam, not a bug in either half. predatorHunt's
       `disengage` and `vanish` states deliberately DRIVE THE HUNTER AWAY —
       that gap is the whole horror grammar and it must not be shortened — and
       its `cruise` state says in as many words that "the caller owns
       idle/wander: we only decide when to wake up". For a land predator the
       caller IS a wander that keeps the animal in its own territory. Here the
       caller is this file, which hands a cruising body back to wildlife.js's
       open-sea wander — and an orca that vanishes at 12 m/s for six seconds,
       twice, is 200 m out and past predatorHunt's wake radius, at which point
       nothing in the game is pointing it at the shark any more. §3 keeps the
       target out to FIGHT_R (1400 m). The FSM wakes at senseR (~110 m). The
       band between those two numbers is where the pod quietly dissolved.

       So a pod that has committed to an apex SHADOWS it: while the FSM is
       cruising, a MOB hunter closes to just inside the wake radius and no
       further. It never shortens the gap between passes — the FSM still owns
       every decision to commit, and inside the wake radius this branch does
       nothing at all — it only refuses to let the quarry be forgotten. That
       is exactly what §4's own header already claims a pod is ("an apex is
       the thing a pod crosses water for"); the crossing was simply never
       implemented.

       ONE MOVER, as everywhere else in this file: the shark's own water mover
       out of opts.move, at the FSM's own cruise speed. PREY hunts are
       untouched — a loner that loses interest in a snack SHOULD lose it.

       ?cfg_MARINE_POD_SHADOW=0 restores the drift.
       ============================================================ */
    if (st === "cruise" && m.kind === 2 && CFG.MARINE_POD_SHADOW !== false &&
        typeof opts.move === "function") {
      const tp2 = actorPos(target), hp2 = actorPos(a);
      if (tp2 && hp2) {
        _t0 = tp2.x - hp2.x; _t1 = tp2.z - hp2.z;
        const wake = ((opts.senseR > 0 ? opts.senseR : 110) * SHADOW_K);
        if (_t0 * _t0 + _t1 * _t1 > wake * wake) {
          const spd = (opts.cruiseSpeed > 0 ? opts.cruiseSpeed : 4) * 1.3;
          try { opts.move(a, Math.atan2(_t1, _t0), spd, dt); } catch (e) {}
          AUDIT.shadowed++;
          a.state = "wander";        // never the player's threat chevron
          show(a, pd2);
          return true;
        }
      }
    }
    // markers.js keys the HUD off a.state === stalk/charge and that is for the
    // PLAYER's hunters only. A fight between two animals must never light the
    // player's threat chevron, so this hunt reports itself as wandering.
    a.state = "wander";
    // Nothing to drive: hand the body back to wildlife.js's own aquatic
    // wander rather than owning a frame in which we move nothing.
    if (st === "cruise") return false;
    show(a, pd2);
    return true;
  }

  function drop(a) {
    const m = mp(a);
    if (m.target && m.target._mpHuntedBy === a) m.target._mpHuntedBy = null;
    m.target = null; m.kind = 0; m.held = false;
    if (m.rolling && m.rolling._mpRoll && m.rolling._mpRoll.by === a) {
      m.rolling._mpRoll = null; clearTonic(m.rolling);
    }
    m.rolling = null;
  }

  /* THE PLAYER HAS TO BE ABLE TO SEE IT. wildlife.js's LOD hides an aquatic
     body whenever the shark brain is not driving it, and a pod fight you
     cannot see is a pod fight that did not happen. Inside SEE_R the
     combatants are forced visible; outside it they go back to the LOD's
     answer, and the white water and the blood are what carry at range.
     NO HUD — this is the whole of the "read it with no UI" contract. */
  function show(a, pd2) {
    if (!a.group) return;
    a.group.visible = pd2 < SEE_R * SEE_R;
  }

  // ---- the ship sequence, as its own small state machine -------------------
  // approach from below and behind -> surface break -> jaws across the beam.
  function stepShip(a, car, dt) {
    const m = mp(a);
    const hp = actorPos(a), tp = car.pos || (car.group && car.group.position);
    if (!hp || !tp) return false;
    _t0 = tp.x - hp.x; _t1 = tp.z - hp.z;
    const d = Math.sqrt(_t0 * _t0 + _t1 * _t1);
    const spec = hullSpec(car);
    if (!spec) return false;
    const loa = spec.loa || 6, beam = spec.beam || 2;
    const opts = optsFor(a);
    const k = kitOf(a);
    const rushSpd = (k && k.rushSpeed > 0) ? k.rushSpeed : 14;
    const cruise = (k && k.cruiseSpeed > 0) ? k.cruiseSpeed : 6;
    const reach = gapeOf(a) * 0.9 + beam * 0.5 + bodyLen(a) * 0.42;

    // WHERE IT COMES FROM. A shark taking a surface target comes up from below
    // and behind — so the approach bearing is the boat's own stern quarter,
    // and the dive target is deep until the last moment.
    const hd = (car.heading != null) ? car.heading : (car.group ? -car.group.rotation.y : 0);
    const sternX = tp.x - Math.cos(hd) * (loa * 0.8);
    const sternZ = tp.z - Math.sin(hd) * (loa * 0.8);
    const sh = a._shark;

    if (d > reach) {
      const far = d > loa * 2.2;
      const wx = far ? sternX : tp.x, wz = far ? sternZ : tp.z;
      const want = Math.atan2(wz - hp.z, wx - hp.x);
      if (sh) sh.diveWant = (a.swimDepth || 2.5) * (far ? 3.2 : 0.85);   // deep, then rising
      if (typeof opts.move === "function") {
        try { opts.move(a, want, far ? cruise * 1.25 : rushSpd, dt); } catch (e) {}
      }
      if (!far && CBZ.swimJaw) { try { CBZ.swimJaw(a, clamp(1 - (d - reach) / 8, 0, 1)); } catch (e) {} }
      return true;
    }
    // CONTACT. The jaws are open and the tooth ring has to actually be on the
    // hull — jawInHull() is the boat's version of creature_combat's jawReaches,
    // and a short bite MISSES and closes the last step next frame.
    if (sh) sh.diveWant = (a.swimDepth || 2.5) * 0.45;                    // surface break
    if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 1); } catch (e) {} }
    if (m.shipT > 0) {
      // riding the bite: hold on, shake, do not re-drive into the hull
      if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 0.25 + Math.sin(m.shipT * 22) * 0.2); } catch (e) {} }
      if (a.group) a.group.rotation.x = Math.sin(m.shipT * 19) * 0.22;
      return true;
    }
    if (a.group) a.group.rotation.x *= Math.max(0, 1 - dt * 5);
    const want = Math.atan2(tp.z - hp.z, tp.x - hp.x);
    if (typeof opts.move === "function") { try { opts.move(a, want, rushSpd * 0.55, dt); } catch (e) {} }
    biteHull(a, car);
    return true;
  }

  // ============================================================
  //  THE WRAP. Capture-and-wrap of CBZ.sharkBrain — the same pattern ten
  //  files in this repo already use on cityKillPed. A marine hunt gets first
  //  refusal on the actor; anything we decline falls straight through to the
  //  shark's own player hunt with the original arguments, unchanged.
  //
  //  Re-armed lazily because script order is not ours to depend on: if
  //  wildlife_shark.js has not loaded yet we install anyway and pick up the
  //  original the first time it exists.
  //
  //  THE PING-PONG, AND WHY THE CHAIN IS TAGGED (2026-08-21). The re-arm test
  //  used to be `CBZ.sharkBrain === wrapped` — "am I the OUTERMOST link?" —
  //  and wildlife_orca.js asks the same question from its own per-frame pass
  //  at 47.2. So every single frame each file decided the other had displaced
  //  it and wrapped again: two new closures per frame, forever, each holding
  //  the last as its `orig`. Ninety seconds into any match with sea life the
  //  chain was ~11,000 links deep and the next call died with
  //  `RangeError: Maximum call stack size exceeded` inside the wildlife tick —
  //  which is exactly what tools/disaster-check.mjs caught on the island.
  //
  //  The question a link should ask is not "am I on top?" but "am I in the
  //  chain AT ALL?", so each wrapper carries who owns it (`_brainLink`) and
  //  what it falls through to (`_brainNext`), and installWrap walks the chain
  //  looking for itself. Re-arming still works the moment it should: when
  //  wildlife_shark.js publishes a fresh CBZ.sharkBrain, our link is no longer
  //  in the chain and we install exactly once more.
  // ============================================================
  const BRAIN_LINK = "marine_predation";
  let orig = null, wrapped = null;
  function inChain() {
    for (let f = CBZ.sharkBrain, n = 0; typeof f === "function" && n < 64; f = f._brainNext, n++) {
      if (f._brainLink === BRAIN_LINK) return true;
    }
    return false;
  }
  function installWrap() {
    if (inChain()) return;
    orig = (typeof CBZ.sharkBrain === "function") ? CBZ.sharkBrain : null;
    wrapped = function (a, dt, P) {
      // let wildlife_shark.js build its own per-actor state (and, with it, the
      // ONE water mover we borrow) before we ever try to own the actor. dt=0
      // makes that call a pure ensure: predatorHunt bails on !(dt>0) and the
      // proxy draws nothing new.
      if (orig && a && !a._shark) { try { orig(a, 0, P); } catch (e) {} }
      let owned = false;
      try { owned = marineStep(a, dt, P); } catch (e) { owned = false; }
      if (owned) return true;
      return orig ? orig(a, dt, P) : false;
    };
    wrapped._brainLink = BRAIN_LINK;
    wrapped._brainNext = orig;
    CBZ.sharkBrain = wrapped;
  }
  installWrap();

  // ============================================================
  //  THE UPDATER. onUpdate(47.15): AFTER wildlife.js's tick (47.1), which is
  //  where the per-actor drive above is called from, and BEFORE predator.js's
  //  seize machine (47.35). All this pass owns is the chum poll and the
  //  re-arm; the fights themselves are ticked inside wildlife's own loop, so
  //  there is exactly one place per frame that moves a body.
  // ============================================================
  if (CBZ.onUpdate) {
    CBZ.onUpdate(47.15, function (dt) {
      if (!(dt > 0)) return;
      installWrap();
      tonicPass(dt);
      chumPoll(dt);
    });
  }

  // ============================================================
  //  THE PROBE. Read by tools/visual-presets/marine-predation.mjs. NOTHING in
  //  the game reads it, and it renders nothing: `hudWrites` is here so the
  //  no-HUD promise is a measured number rather than a claim.
  // ============================================================
  CBZ.marineAudit = function () {
    return {
        hunts: AUDIT.hunts, rams: AUDIT.rams, rolls: AUDIT.rolls, shadowed: AUDIT.shadowed,
      kills: AUDIT.kills, casualties: AUDIT.casualties, brokeOff: AUDIT.brokeOff,
      shipBites: AUDIT.shipBites, shipsSunk: AUDIT.shipsSunk,
      chumOpened: AUDIT.chumOpened, chumLive: liveSlots(),
      chumSources: (typeof CBZ.goreChumList === "function" && CBZ.goreChumList()) ? CBZ.goreChumList().length : 0,
      hudWrites: AUDIT.hudWrites,
      chunks: AUDIT.chunks,          // flank bites that took material off the quarry
      wrapped: inChain(),
      // THE RATCHET (see the wrap note above): how many links deep the shark
      // brain chain is. Two files wrap it, so this is 3 with wildlife_shark.js
      // loaded and it MAY NOT GROW — a per-frame re-wrap regression pushes it
      // up every frame until the stack overflows.
      brainChain: (function () { let n = 0; for (let f = CBZ.sharkBrain; typeof f === "function" && n < 64; f = f._brainNext) n++; return n; })(),
    };
  };
  CBZ.marineAuditReset = function () {
    AUDIT.hunts = AUDIT.rams = AUDIT.rolls = AUDIT.kills = AUDIT.casualties = AUDIT.brokeOff = 0;
    AUDIT.shadowed = 0;
    AUDIT.shipBites = AUDIT.shipsSunk = AUDIT.chumOpened = 0;
  };

  // The predator block's ratchet: this file ticks CBZ.predatorHunt and strikes
  // through CBZ.creatureFight rather than owning a loop of its own, so it says
  // so itself in the one guarded line the audit reads.
  if (typeof CBZ.predatorAdopt === "function") {
    try { CBZ.predatorAdopt("marine_predation:hunt"); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("marine_predation:hunt"); } catch (e) {}
  }
})();
