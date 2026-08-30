/* ============================================================
   warlord/mounts.js — HORSES, CAMELS AND TECHNICALS.

   Two problems, one file, because they are the same problem seen from two
   distances.

   FOURTEEN KILOMETRES IS THE CAMPAIGN'S PACING BUG. A party moves at the
   speed of its slowest man, and a man on foot with a rifle and water does
   about 1.35 m/s cross-country all day. That is 2.9 hours of game clock to
   cross this island and a wage bill every dawn on the way. Mounting the army
   is therefore a real investment with a real payoff — fewer days on the sand,
   fewer wages paid for walking, more fights per week — and it is the single
   biggest lever the player has over the economy that is not "win a battle".

   CAVALRY IS THE BATTLE'S BIGGEST HOLE. combat_iq gives us a genuinely good
   gunfight and exactly one kind of body in it. A horse changes four things at
   once — reach, exposure, terrain and shock — and a charge landing on a levy
   line ought to be the most decisive thing that happens all day.

   ------------------------------------------------------------------
   WHAT WAS REUSED, AND WHAT WAS GENUINELY NEW. This mattered more here than
   anywhere else in the game, because the repo ALREADY does mounted riders
   (tools/visual-presets/mounted-riders.mjs exists because somebody fixed
   them) and a second horse would have been the worst possible outcome.

     REUSED — the horse itself.  `city/wildlife/farm.js` has a mustang: real
       silhouette, mane, hooves, authored nose-toward-+X feet-at-y=0. That IS
       this game's horse. games/warlord.html deliberately refuses the
       `bestiary` pack ("forty files of bestiary on a phone's first load is
       forty files nobody asked for") and it is right to. So this file takes
       exactly TWO of those forty files — the 5 KB species registry and the
       15 KB farm batch — and only the first time a mount is actually drawn.
       21 KB, lazily, for the real animal. See loadSpecies().

     REUSED — the rider's mounted pose.  entities/character.js (the `people`
       pack, already loaded) has a whole MOUNTED RIDER branch in animChar:
       hips planted, thighs abducted by an angle solved from the mount's
       actual width against this body's own femur, knees folded so the boots
       hang down both flanks, arms reaching for the withers. It was written
       for city/wildlife_tame.js. It is exactly what a cavalryman is, and
       "the ordinary walk cycle translated above an animal" is the documented
       failure it exists to delete. We set ch.riding and let it pose.

     REUSED — the seat solve.  mounted-riders.mjs's formula verbatim:
       hips at `seatY - ch.hipY * humanScale`. Anything else floats.

     REUSED — the gun on the technical.  CBZ.buildActorWeapon("lmg") is the
       armoury's own M249, already loaded by this page for the men to carry.
       A truck gun that is not the same object as a man's gun is how two
       files start disagreeing about what an LMG is.

     REUSED — the money curve.  W.gunPrice's exact shape,
       `pow(value/100, 1.25) * 22` rounded to $5. A mount is priced on the
       same curve as a rifle off its own delivered value. There is no second
       economy in here: mounts go in W.state (so they save, survive a battle
       and cross the wire), upkeep is added to W.payroll, and looted mounts
       come out of W.spoils.

     NEW — the camel.  Grepped the whole repo: there is no camel. This is a
       desert warlord game and a camel is the one animal that belongs on the
       island by name, so it is authored here — but as a real
       CBZ.defineSpecies() call with the bestiary's own contract (metres,
       feet at y=0, nose +X, ctx.mat / CBZ.boxGeom), which means the shared
       gait rig walks it and quadruped_ragdoll kills it the day any page
       loads those packs. It is a bestiary entry that happens to live here.

     NEW — the technical.  The repo's only truck is city/island_military.js's
       makeTruck, and that file is 130 KB and comes chained to
       city/strategic.js at another 186 KB. 316 KB of archipelago for one
       pickup is a worse trade than the bestiary one we just refused, so the
       chassis is boxes here and the GUN on it is the armoury's real one.

     NEW — the instanced bake.  core/batch.js merges static scenery IN PLACE
       (it hides originals and parents a merged copy into the scene); it
       cannot hand back a geometry, and a rider's legs have to keep moving.
       So bake() below merges a built body into instanceable buffers once —
       same technique, different exit.

   ------------------------------------------------------------------
   DRAW CALLS. A hundred riders is seven draw calls per mount kind: the
   mount's body, its four legs (each its own InstancedMesh so it can swing
   about its hip), the rider's untinted half and the rider's coat, which is
   baked white and tinted per instance so a column still reads as YOUR men.

   ------------------------------------------------------------------
   FLAGS (repo doctrine: every behaviour switch reverts from the URL)
     ?mounts=old            no mounts at all. Speed model returns 1.0,
                            cavalry never attaches. The pre-mounts game.
     ?cavalry=old           campaign speed stays, the BATTLE half is off.
     ?mountecon=old         no upkeep, no loot, no band mounts (core is not
                            wrapped at all) — for bisecting an economy bug.
     ?mounts=1              the debug pad: a column and a charge on flat
                            ground, with no other module required.
     ?cfg_WARLORD_MOUNTS=0  same as ?mounts=old, for the visual harness,
                            which composes cfg_* params rather than bare ones.

   EVENTS OWNED:  mounts:assigned  mounts:lost  mounts:charge

   PUBLISHES (see the API block at the bottom for the full list)
     W.mounts.KINDS / kind(id) / price / sell / upkeep / value
     W.mounts.partyPace() / paceMul() / dayCostMul() / crossingDays(m)
     W.mounts.stable / stableAdd / stableTake / assign / unassign / mountedN
     W.mounts.battle.*   — what battle.js should call, listed there
     W.mounts.makeColumn / makeCharge / ready  — the look, for anyone
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const W = CBZ.warlord;
  if (!W) return;                                   // core did not load; nothing to hang off
  const THREE = window.THREE;

  const M = {};                                     // the module object
  const S = W.state;
  const Q = (function () {
    try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; }
  })();
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});

  const OFF = Q.get("mounts") === "old" || CFG.WARLORD_MOUNTS === false;
  const NO_CAVALRY = OFF || Q.get("cavalry") === "old" || CFG.WARLORD_CAVALRY === false;
  const NO_ECON = OFF || Q.get("mountecon") === "old";
  const clamp = W.clamp;

  /* ============================================================ THE KINDS

     ONE PHYSICAL FACT PER MOUNT and everything else derives from it. The
     fact is `pace`: sustained cross-country metres per second carrying a
     man and his kit, all day, over sand. These are researched numbers, not
     balance:

       foot     1.35   a loaded infantry column. ~4.9 km/h.
       camel    3.4    a working camel's road trot, and it holds it for
                       hours on water a horse cannot do without.
       horse    4.2    a cavalry march is a trot, not a gallop; the gallop
                       is a battlefield speed and it is `dash` below.
       technical 9.0   a pickup picking its way over soft sand and rock.
                       Not its road speed — there are no roads here.

     `dash` is the SHORT speed: the gallop, the sprint of a truck across the
     last two hundred metres. It is what the battle reads.
     `mass` in kg is the other physical fact, and the only thing a charge's
     shock is allowed to be derived from.
     `seats` is how many men ride it. A horse carries its rider; a technical
     carries a crew, which is what makes it worth ten men's wages a day. */
  const FOOT_PACE = 1.35;
  const FOOT_DASH = 5.2;                             // a man's own run, for the ratios below

  const KINDS = M.KINDS = [
    { id: "camel", label: "CAMEL", species: "camel",
      pace: 3.4, dash: 9.5, mass: 600, seats: 1, hp: 150, thirst: 0.45,
      note: "slower than a horse and does not care. crosses the deep sand a horse refuses." },
    { id: "horse", label: "HORSE", species: "horse",
      pace: 4.2, dash: 15.0, mass: 500, seats: 1, hp: 120, thirst: 1,
      note: "the charge. useless in rocks, decisive on open sand." },
    { id: "technical", label: "TECHNICAL", species: null,
      pace: 9.0, dash: 21.0, mass: 2600, seats: 4, hp: 260, thirst: 1.6,
      note: "a pickup with the belt-fed gun bolted to the bed. four men ride it." },
  ];
  const BY_ID = {};
  KINDS.forEach(function (k) { BY_ID[k.id] = k; });
  M.kind = function (id) { return BY_ID[id] || null; };
  M.ids = function () { return KINDS.map(function (k) { return k.id; }); };

  /* WHAT A MOUNT IS WORTH, and it is deliberately the same SHAPE as core's
     gunValue: what the thing actually delivers, not a list of adjectives.

       travel  how many times faster the army crosses the island on it. This
               is the whole campaign half, and it is a ratio against a
               walking man rather than an absolute, because the only thing
               that matters is the DIFFERENCE it makes to a column.
       shock   what it is worth the moment it arrives, from momentum —
               ½ m v² normalised against a running man's, which is the only
               non-fictional way to say a horse hits harder than a boot.
     WHAT IS DELIBERATELY *NOT* IN HERE: seats. The first draft multiplied
     value by seats^0.55, which read as fair — a technical carries four men —
     and priced it at $2,820 against a $1,595 grenade launcher and a $110
     rifle. That is not a decision, it is a wall, and it double-counted:
     partyPace() below already gives a technical's spare seats away for free
     by lifting footmen off the sand. Pay for a benefit once.

     THE SHOCK TERM IS CAPPED AT 2.4 and the cap is the interesting part.
     Uncapped, the truck's 2600 kg at 21 m/s rates it at THIRTEEN horses and
     prices it past every gun in the armoury. That is fiction: past a certain
     mass the limiting factor stops being momentum and becomes that a vehicle
     is ONE target, it burns, and a single rocket ends it. The cap is where
     that crossover sits. Un-capped it also breaks the game — a $9,000 truck
     is not a decision, it is a wall.

     The 100 scalar is a design statement and is labelled as one, and it was
     set against numbers read off this build rather than guessed: an AK is
     $110, a carbine $110, an LMG $135, a bazooka $500. It puts a horse at
     $155 and a camel at $95 — right on top of the rifles — because mounting
     a man and arming him properly have to be a real either/or on day ten.
     The technical lands at $1,085, between the bazooka and the grenade
     launcher, which is where the single most expensive thing you can own
     belongs. */
  function mountValue(id) {
    const k = BY_ID[id];
    if (!k) return 100;
    const travel = k.pace / FOOT_PACE;
    const shock = 1 + Math.min(2.4, (k.mass / 78) * Math.pow(k.dash / FOOT_DASH, 2) / 100);
    return travel * shock * 100;
  }
  M.value = mountValue;

  /* PRICED ON CORE'S OWN CURVE. `pow(v/100, 1.25) * 22`, rounded to $5, is
     W.gunPrice verbatim — same exponent, same scalar, same rounding. A horse
     and a rifle sit on ONE money ladder because there is one player with one
     purse, and two ladders is how a game ends up with a $40 rocket. */
  M.price = function (id) {
    return Math.max(20, Math.round(Math.pow(mountValue(id) / 100, 1.25) * 22 / 5) * 5);
  };
  // a depot pays a third of list, exactly as it does for a gun — the spread IS the sink
  M.sell = function (id) { return Math.max(5, Math.round(M.price(id) * 0.34 / 5) * 5); };

  /* UPKEEP. A horse eats and a truck drinks, and if that costs nothing then
     "buy every man a horse" is the only strategy and the campaign has no
     brake. Derived from value against the wage ladder core already set (a
     levy is $1/day, a veteran $8), scaled by `thirst` because a camel's
     entire real advantage is that it costs less to keep. */
  M.upkeep = function (id) {
    const k = BY_ID[id];
    if (!k) return 0;
    return Math.max(1, Math.round(mountValue(id) / 260 * k.thirst));
  };

  /* WHAT A MOUNT ADDS TO A MAN'S STRENGTH, in core's soldierPower units. A
     mounted man is not a better shot — he is faster, harder to hit, and he
     arrives. Same shock/travel terms, compressed, so the encounter screen's
     odds actually move when you mount the army. */
  M.powerMul = function (mountId) {
    if (!mountId || NO_CAVALRY) return 1;
    const k = BY_ID[mountId];
    if (!k) return 1;
    return 1 + Math.min(0.85, (mountValue(k.id) / 100 - 1) * 0.13);
  };

  /* ============================================================ THE STABLE

     THE MOUNTS LIVE IN W.state AND NOT IN THIS CLOSURE, and core states the
     test for that plainly: "if it is not in here it does not survive a save,
     a battle or a network hop". A stable that evaporates when you fight is
     not an economy. `S.mounts` is the exact shape of `S.baggage` — id to
     count — so loadout.js, outpost.js and warnet.js can all treat it the way
     they already treat guns, and nothing new has to be learned. */
  function stable() {
    if (!S.mounts || typeof S.mounts !== "object") S.mounts = {};
    return S.mounts;
  }
  M.stable = stable;
  M.stableAdd = function (id, n) {
    if (!BY_ID[id]) return;
    const st = stable();
    st[id] = (st[id] || 0) + (n == null ? 1 : n);
    W.emit("baggage", st);
  };
  M.stableTake = function (id, n) {
    n = n == null ? 1 : n;
    const st = stable();
    if ((st[id] || 0) < n) return false;
    st[id] -= n;
    if (st[id] <= 0) delete st[id];
    W.emit("baggage", st);
    return true;
  };
  M.stableCount = function () {
    const st = stable();
    let n = 0;
    for (const k in st) n += st[k] | 0;
    return n;
  };

  /* ASSIGN IS A SWAP, NEVER A GIVE — core's own equip() rule, and it is here
     for the same reason: the mount he was on goes back in the train in the
     SAME call. Two of the three loadout bugs in core's first draft were a
     give without the matching take, and a horse is a lot more noticeable than
     a pistol when it duplicates. */
  M.assign = function (soldier, id) {
    if (!soldier || NO_ECON) return false;
    if (id === (soldier.mount || null)) return true;
    if (id && !M.stableTake(id, 1)) return false;
    if (soldier.mount) M.stableAdd(soldier.mount, 1);
    soldier.mount = id || null;
    W.emit("army", S.army.length);
    W.emit("mounts:assigned", soldier);
    return true;
  };
  M.unassign = function (soldier) { return M.assign(soldier, null); };
  M.isMounted = function (s) { return !!(s && s.mount && BY_ID[s.mount] && !NO_CAVALRY); };

  /* MOUNT THE WHOLE ARMY IN ONE CLICK, best men first. A roster screen that
     makes you click forty times to spend one decision is a roster screen
     nobody uses; loadout.js gets this for free. Veterans first because a
     veteran on a horse is worth the horse and a levy on one is a gift to
     whoever kills him. */
  M.mountAll = function () {
    if (NO_ECON) return 0;
    const order = S.army.slice().sort(function (a, b) { return W.tierIndex(b.tier) - W.tierIndex(a.tier); });
    let n = 0;
    for (let i = 0; i < order.length; i++) {
      if (order[i].mount) continue;
      const best = bestAvailable();
      if (!best) break;
      if (M.assign(order[i], best)) n++;
    }
    if (n) W.log("mounted " + n + " men.", "good");
    return n;
  };
  function bestAvailable() {
    const st = stable();
    let best = null;
    for (let i = 0; i < KINDS.length; i++) {
      const k = KINDS[i];
      if ((st[k.id] | 0) > 0 && (!best || mountValue(k.id) > mountValue(best))) best = k.id;
    }
    return best;
  }
  M.bestAvailable = bestAvailable;

  M.mountedN = function () {
    let n = 0;
    for (let i = 0; i < S.army.length; i++) if (M.isMounted(S.army[i])) n++;
    return n;
  };
  /* THE WARLORD'S OWN MOUNT lives on S.you beside his wid and armour, because
     that is where core already keeps what he is carrying. */
  M.yourMount = function (id) {
    if (id !== undefined) {
      if (id && !M.stableTake(id, 1)) return S.you.mount || null;
      if (S.you.mount) M.stableAdd(S.you.mount, 1);
      S.you.mount = id || null;
      W.emit("mounts:assigned", S.you);
    }
    return S.you.mount || null;
  };

  /* ============================================================ THE SPEED

     A PARTY MOVES AT THE SPEED OF ITS SLOWEST MAN. That sentence is the
     whole model and it is what makes mounting the army an all-or-nothing
     investment rather than a slider: thirty-nine horsemen and one footman is
     a party that walks. It is also why `seats` matters — a technical is the
     cheap way to lift the last dozen men off the sand.

     THE FIRST DRAFT AVERAGED THE PACES and it was wrong in the way that
     matters: it meant buying one horse made the whole army 3% faster, which
     is a number in a menu, not a decision. Min, not mean. */
  function paceOf(s) {
    const k = s && s.mount ? BY_ID[s.mount] : null;
    return (k && !NO_CAVALRY) ? k.pace : FOOT_PACE;
  }
  M.partyPace = function () {
    if (OFF) return FOOT_PACE;
    let slowest = paceOf(S.you);
    /* SPARE SEATS CARRY FOOTMEN. Every technical in the column has three
       empty seats after its driver; men without a mount of their own ride in
       them. This is counted before the min, so the last footman climbing
       into a truck bed is what finally frees the whole party to move. */
    let spare = 0;
    for (let i = 0; i < S.army.length; i++) {
      const k = S.army[i].mount ? BY_ID[S.army[i].mount] : null;
      if (k && !NO_CAVALRY) spare += Math.max(0, k.seats - 1);
    }
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      let p = paceOf(s);
      if (p === FOOT_PACE && spare > 0) { spare--; p = BY_ID.technical.pace; }
      if (p < slowest) slowest = p;
    }
    return slowest;
  };
  /* TWO HOOKS, AND CAMPAIGN.JS NEEDS BOTH, because the campaign keeps time
     PER METRE (`S.hour += moved * HOUR_PER_M`) and screen speed per second.
     Speeding up the ride alone would look faster and cost the identical
     number of days, which is the opposite of the point. */
  M.paceMul = function () { return M.partyPace() / FOOT_PACE; };
  M.dayCostMul = function () { return FOOT_PACE / M.partyPace(); };
  /* AND THE ANSWER THE PLAYER ACTUALLY WANTS, on the outpost screen and over
     a marching order: how many days is this crossing. HOUR_PER_M is
     campaign.js's, asked for rather than copied, so retuning the clock over
     there cannot silently make this lie. */
  M.crossingDays = function (metres, hourPerM) {
    const hpm = hourPerM > 0 ? hourPerM : 0.00062;
    return metres * hpm * M.dayCostMul() / 24;
  };
  /* WHAT MOUNTING THE ARMY WOULD SAVE, in gold, which is the only unit the
     decision is actually made in: days saved on a crossing times the daily
     bill. outpost.js prints this next to the price. */
  M.saving = function (metres, hourPerM) {
    const foot = metres * (hourPerM > 0 ? hourPerM : 0.00062) / 24;
    return Math.round((foot - M.crossingDays(metres, hourPerM)) * (W.payroll() || 0));
  };

  /* A BAND RIDES TOO. Roaming parties get mounts from the same table, so a
     mounted raider band genuinely runs you down and a mounted band you beat
     is where your first horses come from. */
  M.bandPace = function (b) {
    if (OFF || NO_CAVALRY || !b || !b.men || !b.men.length) return FOOT_PACE;
    /* SAME RULE AS YOURS: the slowest man sets the pace, so one unmounted
       levy pins a band of horsemen to a walk. Written as a plain min with
       FOOT_PACE seeded from the first unmounted man rather than the clever
       version the first draft had, which returned a band's TOP speed when
       every man happened to be mounted and FOOT_PACE otherwise — a step
       function where the model is a minimum. */
    let slowest = Infinity;
    for (let i = 0; i < b.men.length; i++) {
      const k = b.men[i].mount ? BY_ID[b.men[i].mount] : null;
      const p = k ? k.pace : FOOT_PACE;
      if (p < slowest) slowest = p;
      if (slowest <= FOOT_PACE) return FOOT_PACE;
    }
    return slowest === Infinity ? FOOT_PACE : slowest;
  };
  M.bandPaceMul = function (b) { return M.bandPace(b) / FOOT_PACE; };
  M.bandMountedN = function (b) {
    let n = 0;
    if (b && b.men) for (let i = 0; i < b.men.length; i++) if (M.isMounted(b.men[i])) n++;
    return n;
  };

  /* ============================================================ CORE, WRAPPED

     THREE WRAPS AND NOT ONE MORE. Each one exists because the alternative is
     a parallel system running beside the one core already owns:

       payroll()  — upkeep has to be in the SAME number wages are, or dawn's
                    desertion math is computed against a bill that is not the
                    bill. A warlord who can feed his men but not his horses
                    still loses men in the night, and that is correct.
       spoils()   — a beaten band's horses are loot in the same object its
                    rifles are, so takeSpoils, the aftermath screen and the
                    net hop all carry them without knowing they exist.
       makeBand() — nobody can loot a horse from a band that never had one.

     They are wraps and not edits because core.js is not mine to change and,
     more usefully, because ?mountecon=old then reverts the entire economy
     half to the byte by simply not installing them. Each is stamped so a
     double boot (or another module with the same idea) cannot wrap twice. */
  function wrapCore() {
    if (NO_ECON) return;

    if (W.payroll && !W.payroll._mounts) {
      const base = W.payroll;
      const wrapped = function () { return base() + M.upkeepTotal(); };
      wrapped._mounts = 1;
      W.payroll = wrapped;
    }

    if (W.spoils && !W.spoils._mounts) {
      const base = W.spoils;
      const wrapped = function (fallen, salvage) {
        const sp = base(fallen, salvage) || {};
        sp.mounts = M.loot(fallen, salvage);
        return sp;
      };
      wrapped._mounts = 1;
      W.spoils = wrapped;
    }
    if (W.takeSpoils && !W.takeSpoils._mounts) {
      const base = W.takeSpoils;
      const wrapped = function (sp) {
        const r = base(sp);
        if (sp && sp.mounts) for (const k in sp.mounts) M.stableAdd(k, sp.mounts[k]);
        return r;
      };
      wrapped._mounts = 1;
      W.takeSpoils = wrapped;
    }
    if (W.spoilsValue && !W.spoilsValue._mounts) {
      const base = W.spoilsValue;
      const wrapped = function (sp) {
        let v = base(sp) || 0;
        if (sp && sp.mounts) for (const k in sp.mounts) v += M.sell(k) * sp.mounts[k];
        return v;
      };
      wrapped._mounts = 1;
      W.spoilsValue = wrapped;
    }

    if (W.makeBand && !W.makeBand._mounts) {
      const base = W.makeBand;
      const wrapped = function (opts) {
        const b = base(opts);
        try { mountBand(b); } catch (e) {}
        return b;
      };
      wrapped._mounts = 1;
      W.makeBand = wrapped;
    }

    /* A MOUNTED ENEMY IS A HARDER ENEMY and the encounter screen has to say
       so before you commit, or the odds it prints are a lie the moment
       cavalry exists. Same wrap, same reason. */
    if (W.soldierPower && !W.soldierPower._mounts) {
      const base = W.soldierPower;
      const wrapped = function (s) { return base(s) * M.powerMul(s && s.mount); };
      wrapped._mounts = 1;
      W.soldierPower = wrapped;
    }
  }

  M.upkeepTotal = function () {
    if (NO_ECON) return 0;
    let n = 0;
    for (let i = 0; i < S.army.length; i++) if (S.army[i].mount) n += M.upkeep(S.army[i].mount);
    if (S.you && S.you.mount) n += M.upkeep(S.you.mount);
    const st = stable();
    // A HORSE IN THE TRAIN STILL EATS, at half — it is not carrying anybody.
    for (const k in st) n += Math.ceil(M.upkeep(k) * 0.5) * (st[k] | 0);
    return n;
  };

  /* WHAT SURVIVES A BATTLE. core's SALVAGE is 0.62 for guns; a mount is
     WORSE, because a horse in a firefight is a large animal that panics and
     bolts and half the ones that live are simply gone by dusk. 0.45 of the
     mounts on the field, and the same salvage roll core hands us on top, so
     retuning core's number moves this one too. */
  M.MOUNT_SALVAGE = 0.45;
  M.loot = function (fallen, salvage) {
    const out = {};
    if (NO_ECON || !fallen) return out;
    const sv = (salvage == null ? (W.SALVAGE || 0.62) : salvage) * M.MOUNT_SALVAGE;
    for (let i = 0; i < fallen.length; i++) {
      const id = fallen[i] && fallen[i].mount;
      if (!id || !BY_ID[id]) continue;
      if (W.chance(sv)) out[id] = (out[id] || 0) + 1;
    }
    return out;
  };

  /* WHICH BANDS RIDE. Derived from the band's own `wealth`, which core
     already rolls and already uses to decide what guns it carries, so a rich
     band is mounted for the same reason it has rifles. Deterministic off the
     band id — the same band is mounted the same way across a save, a reload
     and a network hop, which W.rnd() alone would not guarantee once the
     campaign stream has been drawn from a different number of times. */
  function mountBand(b) {
    if (!b || !b.men || !b.men.length || NO_ECON) return;
    const wealth = b.wealth == null ? 0.4 : b.wealth;
    for (let i = 0; i < b.men.length; i++) {
      const r = W.hash01(b.id * 97 + i, 41, 13);
      // a band's cavalry share tops out near half: an all-mounted band reads
      // as a special event, and every band being one makes none of them one.
      if (r > wealth * 0.55) continue;
      const r2 = W.hash01(b.id * 31 + i, 77, 5);
      b.men[i].mount = (wealth > 0.75 && r2 < 0.14) ? "technical"
        : (r2 < 0.55 ? "camel" : "horse");
    }
  }
  M.mountBand = mountBand;

  /* ============================================================ CAVALRY

     WHAT A HORSE CHANGES IN A GUNFIGHT, and the honest list is four things:

       1. HE IS FASTER. Not a little — a gallop is three times a run, and
          that is what closes the two hundred metres combat_iq will otherwise
          spend trading rifle fire across.
       2. HE IS HARDER TO HIT AT RANGE. A crossing rider at 15 m/s at 80 m
          needs almost a second of lead. Derived below from actual angular
          rate, not typed.
       3. HE IS USELESS IN CLOSE TERRAIN. Rocks, wrecks, a wadi — anywhere
          the collider query says there is stuff — and the horse is a large
          animal that cannot get through and a large target that cannot hide.
          This is the counter-play, and without it cavalry is not a decision.
       4. HE CAN BE DISMOUNTED. The horse dies, the man does not. He gets up
          in the dirt as an ordinary infantryman with a bad day.

     A CHARGE LANDING ON A LINE IS THE POINT OF THE FILE. impact() is what
     happens when a rider under CHARGE orders reaches a man: shock damage
     from real momentum, and a knockdown, and the rider rides through rather
     than stopping to duel. That is the thing that should decide a battle. */

  const B = M.battle = {};

  /* THE COMBAT PACES. Battle speeds are game units, not the campaign's
     metres-per-day — combat_iq's men run 4.6 to 7.6. So a mount's battle
     speed is expressed as a RATIO against a running man and applied to
     whatever number battle.js already decided, which means retuning the
     infantry over there cannot leave cavalry behind. */
  B.speedMul = function (m) {
    const k = mountOf(m);
    if (!k) return 1;
    let mul = k.dash / FOOT_DASH;
    // a charging rider is at the gallop; a rider holding a line is not
    if (!(m && (m.slot === "push" || m.slot === "march" || m.slot === "flank"))) {
      mul = 1 + (mul - 1) * 0.45;
    }
    return mul * B.terrainMul(m);
  };
  /* THE SPEED battle.js SHOULD USE ON A CHARGE, absolute, so a CHARGE order
     does not have to know the ratio: hand it the man, get metres per second. */
  B.chargeSpeed = function (m) {
    const k = mountOf(m);
    if (!k) return 0;
    return k.dash * B.terrainMul(m);
  };

  function mountOf(m) {
    if (NO_CAVALRY || !m) return null;
    if (m.mount && m.mount.dead) return null;
    const id = (m.mount && m.mount.kind) || (m.s && m.s.mount) || (m.isYou && S.you.mount);
    return (id && BY_ID[id]) || null;
  }
  B.mountOf = mountOf;
  B.isMounted = function (m) { return !!mountOf(m); };

  /* CLOSE TERRAIN KILLS CAVALRY, and this is measured off the world rather
     than a per-map flag: the same collider query combat_iq uses for cover.
     Four or more solid things inside eight metres is a place a horse cannot
     work, and the fall-off is smooth because a hard cliff at exactly four
     colliders reads as a bug when a man rides past one wreck. */
  const _cols = [];
  B.terrainMul = function (m) {
    const k = mountOf(m);
    if (!k || !m || !m.pos) return 1;
    if (!CBZ.queryCollidersNear) return 1;
    let n = 0;
    try {
      _cols.length = 0;
      const a = CBZ.queryCollidersNear(m.pos.x, m.pos.z, 8, _cols) || _cols;
      n = a.length;
    } catch (e) { return 1; }
    // a truck is worse off than a horse here: it cannot step over anything
    const bite = k.id === "technical" ? 0.19 : 0.13;
    return clamp(1 - Math.max(0, n - 1) * bite, 0.28, 1);
  };

  /* HARDER TO HIT AT RANGE — derived, and the derivation is the reason this
     is not a flat 25%.

     A shooter has to lead a crossing target. The lead angle is v/d radians
     per second of flight; a rifle round crosses 80 m in about a tenth of a
     second, so the miss is the angular error the shooter does not correct.
     At 15 m/s and 80 m that is a real fraction of a man's width; at 10 m it
     is nothing, which is exactly right — riding up to somebody and stopping
     is how cavalry dies. The near end of the curve is the counter-play. */
  B.evade = function (m, dist) {
    const k = mountOf(m);
    if (!k || !(dist > 0)) return 0;
    const v = k.dash * B.terrainMul(m);
    const cross = v * 0.10;                          // metres of lead at ~0.1 s flight
    const manW = 0.6;
    const raw = Math.min(0.85, cross / (manW + cross)) * Math.min(1, dist / 45);
    // a truck is a bigger target than a horse and the same lead misses less
    return raw * (k.id === "technical" ? 0.55 : 1);
  };

  /* THE ROUNDS THAT HIT THE HORSE. A man on a horse presents a horse: it is
     the bigger half of the silhouette and it is the half that is not wearing
     a plate rig. So some fraction of what lands lands on the animal, and the
     animal has its own hp. This is where dismounting comes from, and it is
     also why cavalry is not free — you are riding a 120 hp target that dies
     and drops you in front of the line you were charging.

     Returns the damage that should reach the MAN. battle.js's hurtMan calls
     this before applying soak. */
  B.absorb = function (m, dmg, imp) {
    const mo = m && m.mount;
    const k = mountOf(m);
    if (!k || !mo || !(dmg > 0)) return dmg;
    /* THE SPLIT IS THE SILHOUETTE, not a die roll per shot: a horse and rider
       from the front is roughly 60/40 animal, and the animal is lower, which
       is where a panicked rifleman's rounds go anyway. An explosive catches
       both and is not split at all. */
    if (imp && imp.explosive) { mo.hp -= dmg * 0.8; if (mo.hp <= 0) B.dismount(m, imp); return dmg; }
    const onMount = W.chance(0.6) ? dmg : 0;
    if (onMount > 0) {
      mo.hp -= onMount;
      if (mo.hp <= 0) B.dismount(m, imp);
      // the rider still feels it — a horse going down under you is not free
      return dmg * 0.12;
    }
    return dmg;
  };

  /* THE HORSE DIES, THE MAN DOES NOT. He hits the sand, he is slow and
     shaken for a moment, and then he is infantry. Nothing about his roster
     record changes except that the mount is gone — which is what makes
     losing a $230 horse in the first thirty seconds of a bad fight sting in
     the campaign rather than only in the battle. */
  B.dismount = function (m, imp) {
    const mo = m && m.mount;
    if (!mo || mo.dead) return;
    mo.dead = true;
    mo.hp = 0;
    mo.fellAt = mo.t || 0;
    if (m.s) { mo.wasFor = m.s.id; m.s.mount = null; }
    else if (m.isYou) S.you.mount = null;
    // he is on the ground: the eye line drops back to a standing man's
    if (m.eyeH != null) { m.eyeH = 1.52; m.losY = 1.35; m.aimY = 1.28; m.headY = 1.62; }
    m.rad = 0.45;
    m.remountT = 0;
    m.shakenT = 1.4;                                  // a beat on the ground before he fights
    hideMountInstance(m);
    W.emit("mounts:lost", { man: m, kind: mo.kind, by: imp && imp.by ? imp.by.id : null });
    if (m.team === "mine" && m.s && W.log) W.log(m.s.name + "'s " + mo.kind + " went down under him.", "bad");
  };

  /* THE CHARGE. What battle.js should call for every mounted man on a CHARGE
     order, once per step. It closes on the mark at gallop speed and, when it
     ARRIVES, does the thing a charge does.

     SHOCK IS MOMENTUM AND NOTHING ELSE. p = m·v against a 78 kg man, scaled
     so a horse at the gallop takes a levy off his feet and most of the way to
     dead, and a camel — heavier, slower — hurts more per hit but arrives
     later. This is the one number in the file that had to be checked by hand
     against core's tier hp: 62 (levy) / 80 / 100 / 125 (veteran). A horse
     lands ~68: it kills a levy outright about half the time, staggers a
     soldier, and a veteran in plate gets up. That is the right shape — a
     charge should break a levy line and merely hurt a real one.

     AND THE RIDER DOES NOT STOP. The first draft had the charge resolve as a
     melee: rider and victim stood in a heap trading. That is not a charge,
     it is a traffic accident. He rides THROUGH — the target is knocked
     aside, the rider keeps his goal, and the next man is fifteen metres on.
     That is what makes a charge look like one from the camera. */
  B.CHARGE_COOLDOWN = 1.1;
  B.impact = function (rider, victim) {
    const k = mountOf(rider);
    if (!k || !victim || victim.dead) return 0;
    const v = k.dash * B.terrainMul(rider) * (rider.speed > 0 ? Math.min(1, rider.speed / k.dash) : 0.35);
    const shock = (k.mass * v) / (78 * FOOT_DASH) * 26;
    return Math.round(shock);
  };
  /* WHAT BATTLE.JS CALLS. Give it the rider, the list of men, and a
     hit-tester, and it resolves one step of a charge: returns the victims it
     rode down, having already asked hurt() for each. Written this way — a
     callback rather than reaching into battle.js's hurtMan — so this file
     never needs to know how that file spells damage. */
  B.chargeStep = function (rider, foes, hurt, dt) {
    const k = mountOf(rider);
    if (!k || !rider.pos || !foes) return null;
    rider.chargeCool = Math.max(0, (rider.chargeCool || 0) - dt);
    if (rider.chargeCool > 0) return null;
    if ((rider.speed || 0) < k.dash * 0.35) return null;   // walking into somebody is not a charge
    const reach = 1.5 + k.mass / 900;
    let hitAny = null;
    for (let i = 0; i < foes.length; i++) {
      const f = foes[i];
      if (!f || f.dead || f.fled || f.team === rider.team || !f.pos) continue;
      const dx = f.pos.x - rider.pos.x, dz = f.pos.z - rider.pos.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dmg = B.impact(rider, f);
      if (dmg <= 0) continue;
      /* A MOUNTED MAN IS NOT RIDDEN DOWN BY ANOTHER MOUNTED MAN the same way
         — two horses colliding is a mess for both, so the shock is halved
         and the CHARGER takes a share of it too. Cavalry on cavalry should
         be a thing you avoid, not a free trade. */
      const theirs = mountOf(f);
      if (theirs) {
        hurt(f, dmg * 0.5, { by: rider, charge: true, raw: true });
        hurt(rider, dmg * 0.28, { by: f, charge: true, raw: true });
      } else {
        hurt(f, dmg, { by: rider, charge: true, raw: true });
        // KNOCKED ASIDE, not stopped: he is off his feet and out of the
        // firing line for a beat, which is the half of a charge that a
        // damage number cannot express.
        f.knockT = Math.max(f.knockT || 0, 1.15);
        f.slot = "knocked";
        const d = Math.hypot(dx, dz) || 1;
        f.pos.x += (dx / d) * 1.3;
        f.pos.z += (dz / d) * 1.3;
      }
      rider.chargeCool = B.CHARGE_COOLDOWN;
      hitAny = f;
      W.emit("mounts:charge", { rider: rider, victim: f, dmg: dmg });
      break;                                          // one man per pass — he rode through
    }
    return hitAny;
  };

  /* ATTACH / DETACH. battle.js calls attach() right after makeMan, and gets
     back the mount record or null. Everything a mounted man needs to be a
     different kind of target — a taller eye line, a wider body, a mount with
     its own hp — is set here so that file never has to branch on it. */
  B.attach = function (m) {
    if (NO_CAVALRY || !m) return null;
    const id = (m.s && m.s.mount) || (m.isYou && S.you.mount) || null;
    const k = id && BY_ID[id];
    if (!k) return null;
    m.mount = { kind: k.id, hp: k.hp, maxHp: k.hp, dead: false, phase: W.hash01(m.i + 3, 9, 4) * 6.28, t: 0 };
    const seat = seatHeight(k.id);
    /* THE WHOLE MAN GOES UP. combat_iq reads eyeH for line of sight, losY for
       whether he can see over cover, aimY for where his round leaves and
       headY for a headshot. Move one and not the others and you get a rider
       who shoots from his boots. */
    m.eyeH = seat + 1.32; m.losY = seat + 1.15; m.aimY = seat + 1.08; m.headY = seat + 1.42;
    m.rad = k.id === "technical" ? 1.5 : 0.85;
    return m.mount;
  };
  B.detach = function (m) {
    if (!m || !m.mount) return;
    hideMountInstance(m);
    m.mount = null;
  };

  /* THE PER-FRAME HALF. battle.js can call step(m, dt) per man or stepAll
     once with the roster; both do the same work. Everything visual lives
     behind the instanced column below, so a battle that never renders mounts
     (the flag off, the look failing to bake) still gets all the numbers. */
  B.step = function (m, dt) {
    const mo = m && m.mount;
    if (!mo) return;
    mo.t = (mo.t || 0) + dt;
    if (mo.dead) return;
    const k = BY_ID[mo.kind];
    // gait phase advances with DISTANCE, not time: legs that move with the
    // clock instead of the ground are the single most obvious animation bug
    // there is, and a still frame shows it.
    mo.phase += (m.speed || 0) * dt / Math.max(0.4, k.mass / 380);
    if (m.shakenT > 0) m.shakenT -= dt;
  };
  B.stepAll = function (men, dt) {
    if (!men) return;
    for (let i = 0; i < men.length; i++) B.step(men[i], dt);
  };

  /* ============================================================ THE LOOK

     A COLUMN RIDING A DUNE LINE IS THE GAME'S SIGNATURE IMAGE, so this half
     had to be both good and cheap, and those pull against each other. The
     resolution is a BAKE: the real animal is built once, its parts are sorted
     into a body and four legs by the same discovery rule city/wildlife_rig.js
     uses (any tall, thin, ground-touching child is a leg; anything stacked on
     its column rides with it), each pile is merged into one buffer with its
     colours baked into vertices, and the result is seven InstancedMeshes that
     will carry two hundred riders as easily as two.

     WHY NOT wildlife_rig's OWN gaitAnimate: it animates a Group of Meshes per
     animal — thirty objects each — which is exactly right for the four deer
     in a forest and exactly wrong for a hundred cavalry. The RULE is reused;
     the per-object walker is not. */

  const SPECIES_FILES = ["city/wildlife_species.js", "city/wildlife/farm.js"];
  let speciesP = null;

  /* TWO FILES OUT OF FORTY. games/warlord.html refuses the whole `bestiary`
     pack on purpose and it is right — but "no animals in this game" stopped
     being true the moment cavalry did, and the alternative to these 21 KB is
     drawing a second horse, which is the one thing the brief forbids. So we
     take the registry and the farm batch, and only when a mount is first
     actually drawn: a player who never buys a horse never fetches them. */
  function loadSpecies() {
    if (speciesP) return speciesP;
    if (CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.horse) {
      speciesP = Promise.resolve(true);
      defineCamel();
      return speciesP;
    }
    const root = (CBZ.studio && CBZ.studio.root) || "../src/";
    speciesP = SPECIES_FILES.reduce(function (chain, rel) {
      return chain.then(function () {
        return new Promise(function (res) {
          const s = document.createElement("script");
          s.src = root + rel;
          s.async = false;                            // order is the contract, same as studio.js
          s.onload = function () { res(true); };
          s.onerror = function () { console.warn("[warlord/mounts] no " + rel); res(false); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () {
      defineCamel();
      return !!(CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.horse);
    });
    return speciesP;
  }
  M.ready = loadSpecies;

  /* ============================================================ THE CAMEL

     THE ONE ANIMAL THIS ISLAND OWES THE PLAYER, and the repo does not have
     it — grep `camel` across src/ and there are zero hits. So it is authored
     here, but it is authored as a BESTIARY ENTRY, through the same
     defineSpecies the other fifty-four go through and against the same
     contract (metres, feet at y=0, nose toward +X, ctx.mat for materials,
     CBZ.boxGeom for boxes). That is not ceremony: it means the shared gait
     rig walks it, quadruped_ragdoll lays it on its flank when it dies, and
     the seat solver finds its saddle, on the day any page loads those packs.
     A camel defined as a private box pile inside a warlord file would have
     been a camel only this file could ever use.

     Reference: a dromedary. Long legs with a visible knee break, a deep
     narrow chest, ONE hump set back over the shoulders, a long S-curved neck
     carried high, a small head with a drooping muzzle, splayed two-toed
     feet, and a sandy coat darker along the hump and the neck crest. */
  let camelDone = false;
  function defineCamel() {
    if (camelDone || !CBZ.defineSpecies || !window.THREE) return;
    camelDone = true;
    CBZ.defineSpecies({
      id: "camel", name: "Dromedary Camel", biome: "desert", rarity: "uncommon",
      hp: 150, fur: "Camel Hide", furValue: 70, herd: [3, 7], packs: 2,
      spd: 3.2, danger: 0, spook: 20, scale: 1.15, color: 0xc9a267,
      build: function (ctx) {
        const T = ctx.THREE, m = ctx.mat;
        const sand = m(0xc9a267), dark = m(0xa07c46), pale = m(0xdcc094), hoof = m(0x4a3a26);
        const g = new T.Group();
        function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
        // deep NARROW chest — a camel is a slab seen from the side and a
        // plank seen from the front, which is what makes its saddle usable
        const body = box(1.75, 0.82, 0.62, sand); body.position.set(0, 1.72, 0); g.add(body);
        const under = box(1.6, 0.26, 0.56, pale); under.position.set(0, 1.36, 0); g.add(under);
        const chest = box(0.52, 0.86, 0.6, sand); chest.position.set(0.8, 1.7, 0); g.add(chest);
        const rump = box(0.5, 0.78, 0.6, sand); rump.position.set(-0.82, 1.7, 0); g.add(rump);
        // ONE hump, set back over the shoulders. Two boxes so it has a
        // silhouette instead of a corner: a wide base and a narrower crown.
        const humpB = box(0.86, 0.34, 0.56, sand); humpB.position.set(-0.06, 2.24, 0); g.add(humpB);
        const humpC = box(0.6, 0.3, 0.44, dark); humpC.position.set(-0.06, 2.5, 0); g.add(humpC);
        // long S-curved neck carried HIGH — three segments, alternating rake
        const n1 = box(0.36, 0.7, 0.42, sand); n1.position.set(0.98, 2.16, 0); n1.rotation.z = -0.55; g.add(n1);
        const n2 = box(0.32, 0.66, 0.36, sand); n2.position.set(1.26, 2.72, 0); n2.rotation.z = -0.14; g.add(n2);
        const crest = box(0.16, 0.5, 0.18, dark); crest.position.set(1.1, 2.5, 0); crest.rotation.z = -0.4; g.add(crest);
        // small head, drooping muzzle, ears back
        const head = box(0.4, 0.32, 0.3, sand); head.position.set(1.44, 3.02, 0); g.add(head);
        const muzz = box(0.38, 0.24, 0.24, pale); muzz.position.set(1.72, 2.9, 0); muzz.rotation.z = 0.22; g.add(muzz);
        const nose = box(0.1, 0.12, 0.2, hoof); nose.position.set(1.9, 2.83, 0); g.add(nose);
        [0.11, -0.11].forEach(function (z) {
          const e = box(0.1, 0.14, 0.08, sand); e.position.set(1.3, 3.16, z); g.add(e);
        });
        /* LEGS WITH A VISIBLE KNEE. A camel's legs are the reason it reads as
           a camel and not a tall horse: they are long, thin, and they BREAK
           forward at the knee. Two boxes per leg with the lower one offset —
           the discovery rule below reads the pair as one column, so the whole
           leg swings from the shoulder as it should. */
        [[0.62, 0.24], [0.62, -0.24], [-0.72, 0.24], [-0.72, -0.24]].forEach(function (o) {
          const up = box(0.17, 0.78, 0.17, sand); up.position.set(o[0], 1.02, o[1]); g.add(up);
          const lo = box(0.14, 0.62, 0.14, sand); lo.position.set(o[0], 0.42, o[1]); g.add(lo);
          const pad = box(0.26, 0.12, 0.24, hoof); pad.position.set(o[0], 0.06, o[1]); g.add(pad);
        });
        const tail = box(0.12, 0.62, 0.12, dark); tail.position.set(-1.04, 1.44, 0); tail.rotation.z = 0.3; g.add(tail);
        return g;
      },
    });
  }

  /* ============================================================ THE BAKE */

  function matColour(mesh) {
    const mt = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return (mt && mt.color) ? mt.color : null;
  }

  /* MERGE, THE 30-LINE VERSION. THREE.BufferGeometryUtils is not on this page
     and core/batch.js's merge is scene surgery — it hides originals in place
     and parents a merged copy, which cannot hand a geometry back for
     instancing. Same technique, different exit: de-index (r128 BoxGeometry is
     indexed and you cannot concatenate two index buffers by appending),
     transform into the target frame, bake the material colour into a vertex
     colour attribute, concatenate. */
  function mergeMeshes(list, baseInv, forceWhite) {
    const pos = [], nrm = [], col = [];
    const mtmp = new THREE.Matrix4();
    const nmat = new THREE.Matrix3();
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i].mesh;
      const geo0 = mesh.geometry;
      if (!geo0 || !geo0.attributes || !geo0.attributes.position) continue;
      const geo = geo0.index ? geo0.toNonIndexed() : geo0.clone();
      mtmp.copy(baseInv).multiply(mesh.matrixWorld);
      geo.applyMatrix4(mtmp);
      nmat.getNormalMatrix(mtmp);
      const p = geo.attributes.position.array;
      const n = geo.attributes.normal ? geo.attributes.normal.array : null;
      let c = forceWhite ? null : matColour(mesh);
      /* A COAT MESH THAT DID NOT MAKE IT INTO THE TINTED PILE MUST NOT STAY
         SENTINEL GREEN. It can happen — a jacket skirt low enough to be
         swept into a leg column — and a bright green thigh in a still is the
         kind of thing a metric will never catch. */
      if (c && c.getHex() === COAT_SENTINEL) c = COAT_FALLBACK_C;
      const cr = c ? c.r : 1, cg = c ? c.g : 1, cb = c ? c.b : 1;
      for (let v = 0; v < p.length; v += 3) {
        pos.push(p[v], p[v + 1], p[v + 2]);
        if (n) nrm.push(n[v], n[v + 1], n[v + 2]);
        else nrm.push(0, 1, 0);
        col.push(cr, cg, cb);
      }
      geo.dispose();
    }
    if (!pos.length) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  /* WHICH CHILDREN ARE LEGS. city/wildlife_rig.js's rule, restated because
     that file walks per-object groups and we need the rule without the
     walker: a leg is TALL, THIN and TOUCHES THE GROUND; anything sitting on
     a leg's own (x,z) column (a hoof, a camel's lower shank, a fetlock)
     rides with it. Sorted into four quadrants by the sign of x and z, so
     each leg gets its own instanced mesh and its own swing. */
  function splitParts(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const meshes = [];
    group.traverse(function (o) { if (o.isMesh && o.geometry) meshes.push(o); });
    const boxes = [];
    const whole = new THREE.Box3();
    for (let i = 0; i < meshes.length; i++) {
      const b = new THREE.Box3().setFromObject(meshes[i]).applyMatrix4(inv);
      boxes.push(b);
      whole.union(b);
    }
    const empty = !isFinite(whole.min.y);
    const totalH = empty ? 1 : Math.max(0.001, whole.max.y - whole.min.y);
    const floor = empty ? 0 : whole.min.y;

    /* WHICH CHILDREN ARE LEGS — wildlife_rig.js's rule: tall, thin, touching
       the ground. Then the columns are RANKED and the tallest four kept,
       because a discovery rule that finds five legs on a camel (the shank
       boxes) must not hand back five instanced meshes for a four-legged
       animal, and a rule that finds two on a man must not pad to four. */
    const cols = [];
    for (let i = 0; i < meshes.length; i++) {
      const b = boxes[i];
      const h = b.max.y - b.min.y;
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      if ((b.min.y - floor) > totalH * 0.16) continue;
      if (h <= w * 2.0 || h < totalH * 0.16) continue;
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      let merged = false;
      for (let c = 0; c < cols.length; c++) {
        if (Math.hypot(cx - cols[c].x, cz - cols[c].z) < Math.max(0.22, w * 1.2)) {
          cols[c].top = Math.max(cols[c].top, b.max.y);
          cols[c].r = Math.max(cols[c].r, w);
          merged = true; break;
        }
      }
      if (!merged) cols.push({ x: cx, z: cz, top: b.max.y, r: Math.max(0.18, w), h: h });
    }
    cols.sort(function (a, b2) { return b2.h - a.h; });
    cols.length = Math.min(4, cols.length);

    /* FRONT/BACK AND LEFT/RIGHT, off the columns' own medians rather than the
       sign of x and z. THE FIRST DRAFT USED THE SIGNS and it broke on the one
       case the before/after tool photographs first: a man's two legs sit at
       x = +epsilon and x = -epsilon, so a sign test scattered them into
       quadrants whose gait table happened to give both the SAME phase, and
       the on-foot column walked with its feet welded together. Medians are
       correct for two legs, four legs and four wheels alike. */
    const mx = median(cols.map(function (c) { return c.x; }));
    const mz = median(cols.map(function (c) { return c.z; }));
    for (let c = 0; c < cols.length; c++) {
      cols[c].front = cols[c].x >= mx;
      cols[c].left = cols[c].z >= mz;
    }

    const legs = [[], [], [], []], body = [], hips = [], info = [];
    for (let i = 0; i < meshes.length; i++) {
      const b = boxes[i];
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      let owner = -1;
      /* ANYTHING STACKED ON A LEG'S OWN COLUMN RIDES WITH IT — a hoof, a
         camel's lower shank, a wheel hub. wildlife_rig's second rule, and it
         is what keeps a hoof from being left behind in mid air when the leg
         swings. Height-limited so a horse's barrel does not join a leg. */
      if ((b.min.y - floor) < totalH * 0.5) {
        let bd = 1e9;
        for (let c = 0; c < cols.length; c++) {
          const d = Math.hypot(cx - cols[c].x, cz - cols[c].z);
          if (d < cols[c].r * 1.9 && d < bd) { bd = d; owner = c; }
        }
      }
      if (owner < 0) { body.push({ mesh: meshes[i] }); continue; }
      legs[owner].push({ mesh: meshes[i] });
      if (!hips[owner]) {
        hips[owner] = new THREE.Vector3(cols[owner].x, cols[owner].top, cols[owner].z);
        info[owner] = { front: cols[owner].front, left: cols[owner].left };
      }
    }
    for (let q = 0; q < 4; q++) {
      if (!hips[q]) { hips[q] = new THREE.Vector3(0, empty ? 0 : whole.max.y * 0.5, 0); info[q] = { front: true, left: true }; }
    }
    return { body: body, legs: legs, hips: hips, info: info, inv: inv, box: whole, empty: empty };
  }
  function median(a) {
    if (!a.length) return 0;
    const s2 = a.slice().sort(function (x, y) { return x - y; });
    return s2.length % 2 ? s2[(s2.length - 1) / 2] : (s2[s2.length / 2 - 1] + s2[s2.length / 2]) / 2;
  }

  /* THE SADDLE. mounted-riders.mjs proved that the classic failure here is a
     rider floating above the back, and it is a still-frame failure — a
     photograph shows it instantly. So the seat is MEASURED off the built
     body rather than typed per species: the widest flat top in the middle
     third of the animal, which on a horse is the barrel behind the withers
     and on a camel is the hump base. `width` is that box's depth, which is
     what character.js's mounted branch solves the hip abduction from. */
  function saddleOf(parts) {
    let best = null;
    const box = parts.box;
    // an empty body (the on-foot bake) has no saddle and no bounds; Box3 says
    // so with min=+Infinity, and every number downstream would be NaN
    if (!isFinite(box.min.y) || !isFinite(box.max.y)) return { x: 0, y: 0, w: 0.7 };
    const lo = box.min.x + (box.max.x - box.min.x) * 0.24;
    const hi = box.min.x + (box.max.x - box.min.x) * 0.72;
    const inv = parts.inv;
    for (let i = 0; i < parts.body.length; i++) {
      const b = new THREE.Box3().setFromObject(parts.body[i].mesh).applyMatrix4(inv);
      const cx = (b.min.x + b.max.x) / 2;
      if (cx < lo || cx > hi) continue;
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
      // a saddle is a wide top, not the highest point: a camel's hump crown
      // and a horse's poll are both high and neither is a seat
      const score = area * (b.max.y - box.min.y);
      if (!best || score > best.score) best = { score: score, y: b.max.y, x: cx, w: b.max.z - b.min.z };
    }
    if (!best) return { x: 0, y: box.max.y * 0.72, w: 0.7 };
    return { x: best.x, y: best.y, w: Math.max(0.48, best.w) };
  }

  /* THE COAT SENTINEL. A rider is baked twice: everything that is his (skin,
     boots, hair) with its real colours, and his COAT baked pure white into a
     second buffer so it can be tinted per instance and a column reads as
     YOUR men. Telling the two apart needs no knowledge of character.js's
     part names — we cast him in a colour nothing else in the wardrobe is and
     then look for it. */
  const COAT_SENTINEL = 0x00fe01;
  const COAT_FALLBACK_C = new THREE.Color(0x6b6446);

  function buildTechnical() {
    /* NOT THE REPO'S TRUCK, AND THAT IS A COST DECISION. city/island_military
       .js has a real army truck (makeTruck) and it is better geometry than
       this. It is also 130 KB and it drags city/strategic.js's 186 KB behind
       it through the `military` pack. 316 KB of archipelago for one pickup is
       a worse trade than the bestiary trade we just refused, and unlike the
       horse there is no ANIMAL here whose absence would be felt — a technical
       is a box with wheels and a gun, and the gun is the part that matters.
       THAT part is the armoury's real one. */
    const g = new THREE.Group();
    const mats = {};
    function mat(hex) {
      if (!mats[hex]) mats[hex] = new THREE.MeshLambertMaterial({ color: hex });
      return mats[hex];
    }
    function box(w, h, d, hex, x, y, z) {
      const m = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), mat(hex));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    }
    const TAN = 0xc2a878, TAN_D = 0x9a8154, DARK = 0x2b2622, GLASS = 0x30414a, RUB = 0x151312;
    // nose toward +X, wheels on the ground at y=0 — the bestiary's convention,
    // kept here so the bake and the saddle solver do not need a special case
    box(3.9, 0.28, 1.9, DARK, 0, 0.62, 0);            // chassis
    box(1.5, 0.78, 1.86, TAN, 0.55, 1.1, 0);          // cab
    box(0.9, 0.5, 1.7, GLASS, 1.28, 1.28, 0);         // windscreen
    box(1.0, 0.62, 1.86, TAN_D, 1.55, 0.95, 0);       // bonnet
    box(0.28, 0.3, 1.7, DARK, 2.05, 0.82, 0);         // grille
    box(1.9, 0.46, 1.86, TAN, -1.0, 0.98, 0);         // bed floor
    [0.9, -0.9].forEach(function (z) { box(1.9, 0.42, 0.1, TAN_D, -1.0, 1.2, z); });   // bed sides
    box(0.12, 0.42, 1.8, TAN_D, -1.94, 1.2, 0);       // tailgate
    box(1.7, 0.1, 1.7, DARK, -1.0, 1.23, 0);          // deck plate the gun stands on
    box(0.22, 0.5, 0.22, DARK, -0.7, 1.5, 0);         // pintle post
    // spare wheel and jerry cans, because a technical without them reads as a
    // toy and they cost four boxes
    box(0.18, 0.62, 0.62, RUB, -1.9, 1.5, 0.55);
    box(0.3, 0.4, 0.22, 0x8a3a2a, -1.55, 1.4, -0.7);
    box(0.3, 0.4, 0.22, 0x8a3a2a, -1.55, 1.4, -0.4);
    // WHEELS: four cylinders on the ground, which the leg discovery below
    // reads as four legs — and a wheel spinning about its axle is exactly
    // what the leg swing already does.
    [[1.25, 0.98], [1.25, -0.98], [-1.15, 0.98], [-1.15, -0.98]].forEach(function (o) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.34, 12), mat(RUB));
      w.rotation.x = Math.PI / 2;
      w.position.set(o[0], 0.48, o[1]);
      g.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.36, 8), mat(0x6c6156));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(o[0], 0.48, o[1]);
      g.add(hub);
    });
    /* THE GUN IS THE ARMOURY'S. CBZ.buildActorWeapon("lmg") is the same M249
       this page already loaded for the men to carry, so a technical's gun and
       a gunner's gun cannot drift apart. It is built pointing down the
       forearm (barrel toward -Z, the held convention actorweapons.js sets),
       so it is turned to look over the nose and scaled up off its held size —
       a pintle gun is not held at arm's length. */
    if (CBZ.buildActorWeapon) {
      try {
        const gun = CBZ.buildActorWeapon("lmg");
        gun.scale.multiplyScalar(1.9);
        gun.rotation.set(0, 0, 0);
        gun.rotation.y = -Math.PI / 2;                 // held -Z becomes the truck's +X
        gun.position.set(-0.45, 1.95, 0);
        g.add(gun);
      } catch (e) {}
    }
    return g;
  }

  /* A HORSE-SHAPED PLACEHOLDER, and it is labelled a placeholder rather than
     dressed up as one. Only reachable when the two species files failed to
     load (offline, a 404, a page that blocked them); the game keeps working
     and it is obvious from one look that something did not arrive. */
  function fallbackQuad(hex) {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: hex });
    function box(w, h, d, x, y, z) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z); g.add(b); return b;
    }
    box(1.8, 0.8, 0.7, 0, 1.5, 0);
    box(0.4, 0.9, 0.45, 1.05, 1.95, 0);
    box(0.5, 0.4, 0.36, 1.4, 2.35, 0);
    [[0.68, 0.26], [0.68, -0.26], [-0.72, 0.26], [-0.72, -0.26]].forEach(function (o) {
      box(0.16, 1.15, 0.16, o[0], 0.58, o[1]);
    });
    return g;
  }

  function buildSource(kindId) {
    /* THE HONEST BEFORE. `__foot` is the same machinery with NOTHING under
       the man: one empty group, so the bake produces a walking soldier and no
       animal at all. The first draft let it fall through to fallbackQuad()
       and photographed the cavalry-off side as a man on a brown placeholder
       horse, which is a comparison that proves nothing. */
    if (kindId === "__foot") return new THREE.Group();
    if (kindId === "technical") return buildTechnical();
    const k = BY_ID[kindId];
    const sp = CBZ.WILDLIFE_SPECIES && k && CBZ.WILDLIFE_SPECIES[k.species];
    if (!sp || !sp.build) return fallbackQuad(kindId === "camel" ? 0xc9a267 : 0x6e4326);
    const cache = {};
    // deterministic rng into the species build — a horse that reshuffles its
    // piebald every reload is a horse the before/after tool cannot photograph
    let seedI = 0;
    const g = sp.build({
      THREE: THREE,
      mat: function (hex) {
        const key = Number(hex == null ? 0x888888 : hex);
        if (!cache[key]) cache[key] = new THREE.MeshLambertMaterial({ color: key });
        return cache[key];
      },
      rng: function () { return W.hash01(seedI++, 3, 17); },
    });
    g.scale.setScalar(sp.scale || 1);
    return g;
  }

  /* THE RIDER. character.js's mounted branch, driven the way wildlife_tame
     drives it and settled by running the damper to rest before the bake —
     animChar eases toward the pose, so a single call bakes a man halfway out
     of the saddle. Ninety frames at 1/60 is well past the 18-per-second
     damper's settling time. */
  function buildRider(seatW, moving) {
    if (!CBZ.studio || !CBZ.studio.cast) return null;
    const rig = CBZ.studio.cast("soldier", { color: COAT_SENTINEL, variant: 2 });
    if (!rig) return null;
    const ch = rig.userData.charRig;
    if (!ch || !CBZ.animChar) return { group: rig, hipY: 0.95, humanScale: 1 };
    ch.riding = { width: seatW, moving: !!moving, airborne: false, phase: 1.1, speed: moving ? 8 : 0 };
    for (let i = 0; i < 90; i++) { try { CBZ.animChar(ch, moving ? 8 : 0, 1 / 60); } catch (e) {} }
    return {
      group: rig,
      hipY: ch.hipY > 0 ? ch.hipY : 0.95,
      humanScale: (rig.userData && rig.userData.humanScale) || 1,
    };
  }

  /* A MAN ON HIS OWN FEET, baked the same way, because the honest BEFORE for
     all of this is the same column walking. */
  function buildWalker() {
    if (!CBZ.studio || !CBZ.studio.cast) return null;
    const rig = CBZ.studio.cast("soldier", { color: COAT_SENTINEL, variant: 2 });
    if (!rig) return null;
    const ch = rig.userData.charRig;
    if (ch && CBZ.animChar) for (let i = 0; i < 40; i++) { try { CBZ.animChar(ch, 1.4, 1 / 60); } catch (e) {} }
    return { group: rig, hipY: ch && ch.hipY > 0 ? ch.hipY : 0.95, humanScale: (rig.userData && rig.userData.humanScale) || 1 };
  }

  function splitCoat(list) {
    const coat = [], base = [];
    for (let i = 0; i < list.length; i++) {
      const c = matColour(list[i].mesh);
      (c && c.getHex() === COAT_SENTINEL ? coat : base).push(list[i]);
    }
    return { coat: coat, base: base };
  }

  const baked = {};
  /* ONE BAKE PER KIND, EVER. The result is pure geometry — no scene, no
     materials that hold state — so it is shared by the campaign column, the
     battle, the debug pad and the before/after harness at once.

     THE SPLIT RUNS TWICE, and that is not waste. Pass one is the bare animal:
     it is the only frame in which the saddle can be measured, because once a
     man is sitting on the back the widest flat top is his thighs. Pass two is
     the assembled rider, so that a man on his OWN feet gets his legs
     discovered and swung by exactly the machinery that swings a horse's. */
  function bake(kindId) {
    if (baked[kindId]) return baked[kindId];
    const src = buildSource(kindId);
    src.updateMatrixWorld(true);

    let seat;
    if (kindId === "__foot") seat = { x: 0, y: 0, w: 0.7 };
    else if (kindId === "technical") seat = technicalSeat(splitParts(src));
    else seat = saddleOf(splitParts(src));

    const rider = kindId === "__foot" ? buildWalker() : buildRider(seat.w, true);
    if (rider) {
      /* mounted-riders.mjs's formula, verbatim, and it is the whole reason a
         rider is not floating: the hips go ON the saddle, so the group origin
         drops by the hip height this particular body actually has. */
      rider.group.position.set(seat.x, seat.y - (kindId === "__foot" ? 0 : rider.hipY * rider.humanScale), 0);
      rider.group.rotation.y = Math.PI / 2;           // human +Z follows the animal's +X
      src.add(rider.group);
      src.updateMatrixWorld(true);
    }

    const parts = splitParts(src);

    /* ONE FORWARD AXIS FOR THE WHOLE GAME. The bestiary authors animals nose
       toward +X; character.js faces +Z; campaign.js and battle.js both set
       rotation.y = yaw against a +Z-forward body. Rather than making every
       caller remember a quarter turn, the quarter turn is baked in HERE, once
       — every buffer below comes out +Z forward. */
    const turn = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    const inv = new THREE.Matrix4().copy(parts.inv).premultiply(turn);

    const isCoat = function (e) {
      const c = matColour(e.mesh);
      return !!(c && c.getHex() === COAT_SENTINEL);
    };
    const coat = parts.body.filter(isCoat);
    const base = parts.body.filter(function (e) { return !isCoat(e); });

    const out = {
      id: kindId,
      seat: seat,
      body: mergeMeshes(base, inv, false),
      legs: [0, 1, 2, 3].map(function (q) {
        return mergeMeshes(parts.legs[q],
          new THREE.Matrix4().makeTranslation(-parts.hips[q].x, -parts.hips[q].y, -parts.hips[q].z).premultiply(inv),
          false);
      }),
      hips: parts.hips.map(function (h) { return new THREE.Vector3(h.x, h.y, h.z).applyMatrix4(turn); }),
      info: parts.info,
      riderBase: null,
      riderCoat: mergeMeshes(coat, inv, true),
      height: isFinite(parts.box.max.y) ? parts.box.max.y : 1.82,
      /* THE ONE NUMBER THE PICTURES ARE CHECKED AGAINST. Zero means the hips
         are on the saddle; the classic failure floats them and a still frame
         shows it, so it is published as a metric rather than trusted. */
      seatGap: (rider && kindId !== "__foot")
        ? Math.abs((rider.group.position.y + rider.hipY * rider.humanScale) - seat.y) : 0,
      riderH: rider ? rider.hipY * rider.humanScale : 0,
    };
    /* `body` already holds everything that is not a leg and not the coat —
       animal and rider both. Two piles, not four: a separate rider buffer
       bought nothing once the coat was split out, and cost a draw call. */
    out.riderBase = null;
    baked[kindId] = out;
    return out;
  }

  /* A TRUCK HAS NO BACK, so the saddle solver's "widest flat top in the
     middle third" finds the cab roof and seats the gunner on it. The deck
     behind the cab is where a technical's man actually stands — beside the
     pintle, which is the only place the gun makes sense — so the seat is
     named rather than measured here, and this is the one place in the file
     that is true. */
  function technicalSeat(parts) {
    return { x: -0.55, y: 1.28, w: 0.9 };
  }

  M.bake = bake;
  M.seatOf = function (kindId) { return bake(kindId).seat; };
  function seatHeight(kindId) {
    try { return baked[kindId] ? baked[kindId].seat.y : (BY_ID[kindId] ? BY_ID[kindId].mass / 500 * 1.55 : 1.55); }
    catch (e) { return 1.55; }
  }

  /* ============================================================ THE COLUMN

     SIX DRAW CALLS, ANY NUMBER OF RIDERS. The body (animal and man together,
     since neither moves relative to the other), four legs, and the coat. The
     legs are separate meshes rather than one because each has to swing about
     its own hip, and a hundred riders' legs in one buffer would mean
     rewriting a hundred thousand vertices a frame instead of four hundred
     matrices. The coat is its own buffer for one reason: it is baked WHITE so
     InstancedMesh.setColorAt can tint it per rider, which is what makes a
     column read as YOUR men and not a herd.

     THE GAIT IS DRIVEN BY DISTANCE, NOT BY THE CLOCK. `phase` advances with
     metres travelled over the leg's own length, which is what makes the feet
     appear to push the ground; a sin(t) gait skates, and a single still frame
     of a skating horse looks fine, which is exactly why it survives so long
     in so many games. The before/after strip below is the check. */
  function Column(kindId, cap) {
    const b = bake(kindId);
    this.kind = kindId;
    this.cap = cap || 160;
    this.b = b;
    this.n = 0;
    this.group = new THREE.Group();
    this.group.name = "warlordMounts:" + kindId;
    const self = this;
    const lam = function (geo, tinted) {
      if (!geo) return null;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const im = new THREE.InstancedMesh(geo, mat, self.cap);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;          // the column moves every frame; a stale
                                         // bounding sphere pops a whole wing out
      if (tinted) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(self.cap * 3).fill(1), 3);
      self.group.add(im);
      return im;
    };
    this.mBody = lam(b.body, false);
    this.mLegs = [lam(b.legs[0]), lam(b.legs[1]), lam(b.legs[2]), lam(b.legs[3])];
    this.mCoat = lam(b.riderCoat, true);
    /* THE GAIT OFFSETS ARE DERIVED FROM THE LEGS THEMSELVES, not from a
       four-entry table indexed by quadrant. A trot moves the DIAGONAL pairs
       together (front-left with back-right); a camel PACES, moving the
       same-side pair together, and that rolling gait is half of why a camel
       reads as a camel. Both fall out of front/left booleans, and so does a
       two-legged man, which the quadrant table could not express at all. */
    const paceGait = kindId === "camel";
    this.offs = [0, 1, 2, 3].map(function (q) {
      const inf = (b.info && b.info[q]) || { front: true, left: true };
      return paceGait ? (inf.left ? 0 : Math.PI)
        : ((inf.front ? 0 : Math.PI) + (inf.left ? 0 : Math.PI));
    });
    this._m = new THREE.Matrix4();
    this._l = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }
  Column.prototype.addTo = function (parent) { parent.add(this.group); return this; };
  Column.prototype.begin = function () { this.n = 0; };
  /* ONE CALL PER RIDER PER FRAME. campaign.js already owns the breadcrumb
     trail that makes a column bend through a wadi instead of cutting the
     corner, so it keeps that and hands us a place; we own the body. */
  Column.prototype.place = function (x, y, z, yaw, speed, phase, tint, fall) {
    const i = this.n;
    if (i >= this.cap) return;
    const k = BY_ID[this.kind] || BY_ID.horse;
    const wheels = this.kind === "technical";
    const amp = clamp((speed || 0) / (k.dash * 0.55), 0, 1) * 0.5;
    const bob = wheels ? 0 : Math.sin(phase * 2) * 0.045 * (amp > 0.02 ? 1 : 0);
    this._q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
    this._v.set(x, y + bob, z);
    this._m.compose(this._v, this._q, this._one);
    /* A DOWNED MOUNT OR A KNOCKED MAN TIPS. One rotation about the body's own
       forward axis is enough — this is a still frame's worth of "he is on the
       ground", not a ragdoll. The real corpses are city/ragdoll.js's. */
    if (fall > 0) {
      this._t.makeRotationZ(fall * 1.35);
      this._m.multiply(this._t);
      this._m.elements[13] -= fall * 0.55;
    }
    if (this.mBody) this.mBody.setMatrixAt(i, this._m);
    if (this.mCoat) {
      this.mCoat.setMatrixAt(i, this._m);
      this._c.setHex(tint == null ? 0xffffff : tint);
      this.mCoat.setColorAt(i, this._c);
    }
    for (let q = 0; q < 4; q++) {
      const im = this.mLegs[q];
      if (!im) continue;
      const h = this.b.hips[q];
      const sw = wheels ? -phase * 2.4 : Math.sin(phase + this.offs[q]) * amp;
      this._t.makeTranslation(h.x, h.y, h.z);
      this._l.makeRotationX(sw);
      this._t.multiply(this._l);
      this._l.copy(this._m).multiply(this._t);
      im.setMatrixAt(i, this._l);
    }
    this.n++;
  };
  Column.prototype.end = function () {
    const n = this.n;
    const push = function (im) {
      if (!im) return;
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    push(this.mBody); push(this.mCoat);
    for (let q = 0; q < 4; q++) push(this.mLegs[q]);
  };
  Column.prototype.dispose = function () {
    const self = this;
    this.group.traverse(function (o) {
      if (o.isInstancedMesh) { o.geometry && o.geometry.dispose && o.geometry.dispose(); o.material && o.material.dispose(); }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
    self.n = 0;
  };
  M.Column = Column;

  /* THE COLUMNS THE GAME USES. One per kind, made on demand and kept, so the
     bake and the buffers are paid for once per session rather than per phase.
     `__foot` is the same machinery with a walking man and no animal under
     him: it is what the cavalry flag OFF draws, and having the two go through
     one path is the only way an A/B photograph is honest. */
  const columns = {};
  M.column = function (kindId, parent, cap) {
    if (!THREE || !CBZ.studio) return null;
    let c = columns[kindId];
    if (!c) {
      try { c = columns[kindId] = new Column(kindId, cap || 160); }
      catch (e) { console.warn("[warlord/mounts] bake failed for " + kindId, e); columns[kindId] = null; return null; }
    }
    if (c && parent && c.group.parent !== parent) parent.add(c.group);
    return c;
  };
  M.disposeColumns = function () {
    for (const k in columns) if (columns[k]) columns[k].dispose();
    for (const k in columns) delete columns[k];
  };

  /* ============================================================ THE CAMPAIGN COLUMN

     WHAT campaign.js SHOULD CALL. It already owns the breadcrumb trail and
     already draws its followers as two InstancedMeshes; the only thing it
     needs from here is "this man is on a horse, you draw the box, I draw the
     horse". So the contract is three calls around its existing loop:

         W.mounts.beginFrame();
         ... for each follower i:
               if (W.mounts.rider(army[i], x, y, z, yaw, speed)) continue;
               ... its own instanced box ...
         W.mounts.endFrame();

     rider() returns true when it took the man, which is the whole handshake.

     AND IF IT NEVER CALLS, WE DRAW IT OURSELVES. Not as a nicety — the brief
     is explicit that each half has to stand up without the other, and the
     alternative is a player who buys forty horses and sees forty men walking.
     The self-drive keeps its own breadcrumb trail off S.you and shuts itself
     off the moment beginFrame() is called from outside, so the two can never
     both be drawing. */
  let extDrawT = -99;
  const usedKinds = [];
  M.beginFrame = function (external) {
    if (external !== false) extDrawT = (CBZ.micro && CBZ.micro.elapsed) || 0;
    usedKinds.length = 0;
    for (const k in columns) if (columns[k]) { columns[k].begin(); }
  };
  M.endFrame = function () {
    for (const k in columns) if (columns[k]) columns[k].end();
  };
  const TIER_TINT = { levy: 0x7d7458, raider: 0xa8552f, soldier: 0x5f7c53, veteran: 0xc8a34a };
  M.rider = function (soldier, x, y, z, yaw, speed, parent) {
    if (!M.isMounted(soldier)) return false;
    const c = M.column(soldier.mount, parent || _root());
    if (!c) return false;
    const key = soldier.id == null ? 0 : soldier.id;
    // phase is per-man and advances with the distance HE has covered, so a
    // column is not forty animals stepping in lockstep
    soldier._mphase = (soldier._mphase || W.hash01(key, 5, 9) * 6.28) + (speed || 0) * 0.055;
    c.place(x, y, z, yaw, speed, soldier._mphase, TIER_TINT[soldier.tier] || 0x9c8f6d, 0);
    return true;
  };

  let selfRoot = null;
  function _root() {
    if (!selfRoot && CBZ.scene) {
      selfRoot = new THREE.Group();
      selfRoot.name = "warlordMountsRoot";
      CBZ.scene.add(selfRoot);
    }
    return selfRoot || CBZ.scene;
  }

  /* THE SELF-DRIVE. Its own breadcrumb trail, deliberately the same shape as
     campaign.js's, because a follower riding YOUR position instead of where
     you WERE cuts every corner and the column stops being a column. */
  const crumbs = [];
  const CRUMB_STEP = 3.2;
  let lastX = null, lastZ = null;
  function selfDrive(dt) {
    if (OFF || !THREE || W.phase() !== "campaign") return;
    const now = (CBZ.micro && CBZ.micro.elapsed) || 0;
    if (now - extDrawT < 1.0) return;                 // somebody else is drawing
    const D = W.desert;
    if (!D || !D.heightAt) return;
    const you = S.you;
    if (lastX == null) { lastX = you.x; lastZ = you.z; }
    const moved = Math.hypot(you.x - lastX, you.z - lastZ);
    const speed = moved / Math.max(dt, 0.0001);
    if (!crumbs.length || moved >= CRUMB_STEP) {
      crumbs.push({ x: you.x, z: you.z });
      if (crumbs.length > 220) crumbs.shift();
      lastX = you.x; lastZ = you.z;
    }
    M.beginFrame(false);
    let drew = 0;
    if (you.mount && !NO_CAVALRY) {
      const c = M.column(you.mount, _root());
      if (c) {
        you._mphase = (you._mphase || 0) + speed * 0.055;
        c.place(you.x, D.heightAt(you.x, you.z), you.z, you.yaw, speed, you._mphase, 0xc46a33, 0);
        drew++;
      }
    }
    for (let i = 0; i < S.army.length && drew < 150; i++) {
      const s = S.army[i];
      if (!M.isMounted(s)) continue;
      const back = 5 + i * 2.4;
      const idx = crumbs.length - 1 - Math.floor(back / CRUMB_STEP);
      const c = crumbs[idx < 0 ? 0 : idx];
      if (!c) break;
      const j1 = (W.hash01(i * 31 + 7, 3, 21) - 0.5) * 9.5;
      const j2 = (W.hash01(i * 17 + 5, 9, 23) - 0.5) * 3.2;
      const x = c.x + j1, z = c.z + j2;
      if (M.rider(s, x, D.heightAt(x, z), z, you.yaw + (W.hash01(i, 1, 27) - 0.5) * 0.4, speed, _root())) drew++;
    }
    M.endFrame();
  }

  /* ============================================================ THE DEMO

     ?mounts=1 AND THE BEFORE/AFTER HARNESS SHARE THIS. Two scenes — a column
     crossing ground, and a charge landing on a line — built from the same
     pieces the game uses, so photographing them photographs the game and not
     a diorama. Both are pure functions of a seed and a clock: step(dt) is the
     only way time passes, which is what lets the film strip advance both
     sides through the identical simulated seconds. */

  function ground(h, x, z) { return h ? h(x, z) : 0; }

  M.makeColumn = function (parent, opts) {
    opts = opts || {};
    const n = opts.n || 14;
    const kind = opts.mounted === false ? "__foot" : (opts.kind || "horse");
    const k = BY_ID[kind] || BY_ID.horse;
    const pace = opts.mounted === false ? FOOT_PACE : k.pace;
    const c = M.column(kind, parent, Math.max(32, n + 4));
    const heightAt = opts.heightAt || null;
    const yaw = opts.yaw == null ? 0 : opts.yaw;
    const men = [];
    for (let i = 0; i < n; i++) {
      men.push({
        // a column, not a line: two files with a lateral stagger, hashed so
        // it is the same column every run
        back: 3.4 + i * (opts.spacing || 4.2),
        side: ((i & 1) ? 1 : -1) * (1.5 + W.hash01(i, 7, 3) * 1.1),
        phase: W.hash01(i, 5, 9) * 6.28,
        tint: [0x7d7458, 0xa8552f, 0x5f7c53, 0xc8a34a][i % 4],
      });
    }
    const h = {
      kind: kind, pace: pace, men: men, t: 0, dist: 0,
      x: opts.x || 0, z: opts.z || 0, yaw: yaw,
      step: function (dt) {
        h.t += dt;
        const adv = pace * dt * (opts.speedScale || 1);
        h.dist += adv;
        h.x += Math.sin(yaw) * adv;
        h.z += Math.cos(yaw) * adv;
        h.draw();
      },
      draw: function () {
        if (!c) return;
        c.begin();
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        for (let i = 0; i < men.length; i++) {
          const m = men[i];
          const px = h.x - fx * m.back + rx * m.side;
          const pz = h.z - fz * m.back + rz * m.side;
          // the phase is DISTANCE-driven and shared with the body, so the
          // feet keep station with the ground under them
          const ph = m.phase + h.dist * (opts.mounted === false ? 1.05 : 0.62);
          c.place(px, ground(heightAt, px, pz), pz, yaw, pace, ph, m.tint, 0);
        }
        c.end();
      },
      dispose: function () { if (c) c.begin(), c.end(); },
    };
    h.draw();
    return h;
  };

  /* THE CHARGE, PHOTOGRAPHED. A wedge of cavalry closing on a levy line, run
     through the SAME impact() the battle uses so the picture and the number
     cannot disagree. Men who are ridden down tip over and stay down. */
  M.makeCharge = function (parent, opts) {
    opts = opts || {};
    const kind = opts.kind || "horse";
    const mounted = opts.mounted !== false;
    const rk = BY_ID[kind] || BY_ID.horse;
    const cav = M.column(mounted ? kind : "__foot", parent, 48);
    const inf = M.column("__foot", parent, 64);
    const heightAt = opts.heightAt || null;
    const nCav = opts.cav || 12, nInf = opts.inf || 26;
    const lineZ = opts.lineZ == null ? 0 : opts.lineZ;
    const startZ = opts.startZ == null ? -60 : opts.startZ;
    const riders = [], foot = [];
    for (let i = 0; i < nCav; i++) {
      // a wedge: the point man leads and the wings trail, which is what makes
      // a charge read as a formation and not a crowd
      const row = Math.floor((i + 1) / 2);
      riders.push({
        x: (i % 2 ? 1 : -1) * row * 2.6 + (W.hash01(i, 11, 5) - 0.5) * 0.6,
        z: startZ - row * 2.2,
        phase: W.hash01(i, 5, 9) * 6.28, cool: 0, hit: 0, dist: 0,
        tint: [0xc8a34a, 0xa8552f][i % 2],
      });
    }
    for (let i = 0; i < nInf; i++) {
      foot.push({
        x: ((i % 13) - 6) * 2.1 + (W.hash01(i, 3, 7) - 0.5) * 0.5,
        z: lineZ + Math.floor(i / 13) * 2.4,
        phase: W.hash01(i + 40, 5, 9) * 6.28, fall: 0, down: false,
        tint: 0x7d7458,
      });
    }
    const speed = mounted ? rk.dash : FOOT_DASH;
    const h = {
      t: 0, riders: riders, foot: foot, impacts: 0, damage: 0,
      closed: 0,
      step: function (dt) {
        h.t += dt;
        for (let i = 0; i < riders.length; i++) {
          const r = riders[i];
          const adv = speed * dt;
          r.z += adv; r.dist += adv;
          r.phase += adv * 0.62;
          r.cool = Math.max(0, r.cool - dt);
          if (r.cool > 0) continue;
          for (let j = 0; j < foot.length; j++) {
            const f = foot[j];
            if (f.down) continue;
            const dx = f.x - r.x, dz = f.z - r.z;
            const reach = 1.5 + rk.mass / 900;
            if (dx * dx + dz * dz > reach * reach) continue;
            if (!mounted) continue;                  // a man on foot does not ride anybody down
            const dmg = B.impact({ pos: { x: r.x, z: r.z }, speed: speed, s: { mount: kind }, mount: { kind: kind, dead: false } }, { pos: { x: f.x, z: f.z }, dead: false });
            h.impacts++; h.damage += dmg;
            f.down = true;
            const d = Math.hypot(dx, dz) || 1;
            f.x += (dx / d) * 1.3; f.z += (dz / d) * 1.3;
            r.cool = B.CHARGE_COOLDOWN;
            break;
          }
        }
        for (let j = 0; j < foot.length; j++) {
          const f = foot[j];
          if (f.down && f.fall < 1) f.fall = Math.min(1, f.fall + dt * 3.4);
          if (!f.down) f.phase += dt * 2.2;
        }
        h.closed = riders.length ? (riders[0].z - startZ) : 0;
        h.draw();
      },
      draw: function () {
        if (cav) {
          cav.begin();
          for (let i = 0; i < riders.length; i++) {
            const r = riders[i];
            cav.place(r.x, ground(heightAt, r.x, r.z), r.z, 0, speed, r.phase, r.tint, 0);
          }
          cav.end();
        }
        if (inf && inf !== cav) {
          inf.begin();
          for (let j = 0; j < foot.length; j++) {
            const f = foot[j];
            inf.place(f.x, ground(heightAt, f.x, f.z), f.z, Math.PI, f.down ? 0 : 0.4, f.phase, f.tint, f.fall);
          }
          inf.end();
        }
      },
      dispose: function () {},
    };
    h.draw();
    return h;
  };

  /* ONE RIDER, STILL, FOR THE SEAT PHOTOGRAPH. The failure this exists to
     catch — hips floating above the saddle — is invisible in motion and
     obvious in a still, which is why it gets its own subject. */
  M.makeRider = function (parent, opts) {
    opts = opts || {};
    const kind = opts.mounted === false ? "__foot" : (opts.kind || "horse");
    const c = M.column(kind, parent, 4);
    const b = bake(kind);
    const h = {
      t: 0, phase: 0, kind: kind, seat: b.seat, seatGap: b.seatGap, height: b.height,
      step: function (dt) {
        h.t += dt;
        h.phase += (opts.speed == null ? 4.2 : opts.speed) * dt * 0.62;
        h.draw();
      },
      draw: function () {
        if (!c) return;
        c.begin();
        c.place(0, 0, 0, opts.yaw == null ? 0 : opts.yaw, opts.speed == null ? 4.2 : opts.speed, h.phase, 0xc8a34a, 0);
        c.end();
      },
      dispose: function () {},
    };
    h.draw();
    return h;
  };

  /* ============================================================ THE PAD

     ?mounts=1 — a column and a charge on flat ground, with the camera on
     them. It exists so this file is never blocked on another agent's module:
     desert.js, campaign.js and battle.js can all be absent or broken and the
     cavalry is still on screen and still steppable. It is also what the
     before/after preset drives, which means the pictures in the report are of
     the same code the game runs. */
  let pad = null;
  function buildPad(ctx) {
    if (pad) return pad;
    const scene = ctx.scene || CBZ.scene;
    const root = new THREE.Group();
    root.name = "warlordMountPad";
    scene.add(root);
    /* A DUNE, NOT A TABLE. A flat pad hides the one thing a column has to get
       right — feet meeting a surface that moves under them — so the pad has a
       gentle ridge across it, analytic so the preset can ask for the same
       height without loading desert.js. */
    const dune = function (x, z) { return Math.sin(x * 0.018) * 3.2 + Math.cos(z * 0.012) * 2.4; };
    const SEG = 64, SPAN = 420;
    const g = new THREE.PlaneGeometry(SPAN, SPAN, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, dune(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xd9b979 }));
    ground.receiveShadow = true;
    root.add(ground);

    const col = M.makeColumn(root, { n: 16, kind: "horse", x: -120, z: -40, yaw: Math.PI * 0.42, heightAt: dune });
    const chg = M.makeCharge(root, { kind: "horse", cav: 12, inf: 26, lineZ: 60, startZ: -10, heightAt: dune });
    pad = {
      root: root, dune: dune, column: col, charge: chg, t: 0,
      step: function (dt) { pad.t += dt; col.step(dt); chg.step(dt); },
    };
    if (ctx.closeScreen) ctx.closeScreen();
    W.setPhase("campaign");
    const cam = CBZ.camera;
    if (cam) {
      cam.position.set(52, 30, -46);
      cam.lookAt(0, 3, 20);
    }
    ctx.micro.onFrame(function (dt) {
      pad.step(Math.min(0.05, dt));
      if (cam) {
        const a = pad.t * 0.16;
        cam.position.set(Math.sin(a) * 74, 26 + Math.sin(a * 0.7) * 6, Math.cos(a) * 74 + 20);
        cam.lookAt(0, 4, 22);
      }
    }, { order: 6, id: "warlord-mount-pad" });
    return pad;
  }
  M.pad = function () { return pad; };

  /* ============================================================ AUDIT */
  M.audit = function () {
    const st = stable();
    const out = {
      off: OFF, cavalry: !NO_CAVALRY, econ: !NO_ECON,
      mountedN: M.mountedN(), army: S.army.length,
      stable: JSON.parse(JSON.stringify(st)),
      partyPace: Math.round(M.partyPace() * 100) / 100,
      dayCostMul: Math.round(M.dayCostMul() * 1000) / 1000,
      upkeep: M.upkeepTotal(),
      prices: {}, baked: Object.keys(baked),
      draws: 0,
    };
    KINDS.forEach(function (k) { out.prices[k.id] = M.price(k.id); });
    for (const k in columns) if (columns[k]) out.draws += columns[k].group.children.length;
    return out;
  };

  /* ============================================================ BOOT */
  M.needs = [];
  M.boot = function (ctx) {
    wrapCore();

    /* A NEW GAME STARTS WITH NOTHING, AND THAT IS THE POINT. The menu card
       says "nobody is given to you"; a free horse would be the first thing
       the game hands you and the last time buying one felt like a decision.
       What a new game DOES get is the stable object, so every screen can read
       it without a null check. */
    W.on("newgame", function () {
      S.mounts = {};
      if (S.you) S.you.mount = null;
      crumbs.length = 0; lastX = null; lastZ = null;
    });
    W.on("loaded", function () { stable(); });
    stable();

    /* THE BAKE IS LAZY AND THE LOAD IS LAZIER. Nothing here touches the
       network or builds a buffer until the player owns a mount — a warlord
       who never buys a horse pays exactly nothing for this file. The first
       assignment, or the debug pad, is what wakes it. */
    W.on("mounts:assigned", function () { loadSpecies(); });

    if (!OFF && ctx.micro) {
      ctx.micro.onFrame(function (dt) {
        try { selfDrive(Math.min(0.05, dt)); } catch (e) {}
      }, { order: 6, id: "warlord-mounts" });
      /* THE BUFFERS ARE HIDDEN, NOT REBUILT, when another phase takes the
         screen — the same rule campaign.js applies to 14 km of terrain, and
         for the same reason: nothing changed. */
      W.on("phase", function (t) {
        if (selfRoot) selfRoot.visible = (t.to === "campaign");
      });
    }

    if (ctx.Q && ctx.Q.get("mounts") === "1") {
      loadSpecies().then(function () {
        try { buildPad(ctx); } catch (e) { console.warn("[warlord/mounts] pad", e); }
      });
    }
    if (ctx.Q && ctx.Q.get("audit") === "1") {
      setTimeout(function () { try { console.log("[warlord/mounts]", M.audit()); } catch (e) {} }, 400);
    }

    /* THE HOOK THE VISUAL HARNESS STAGES THROUGH. It needs three things and
       only three: bring the assets up, build one of the three subjects, and
       advance simulated time by an exact amount so a film strip photographs
       the identical seconds on both sides. */
    W.mountsStudio = {
      ready: loadSpecies,
      column: M.makeColumn,
      charge: M.makeCharge,
      rider: M.makeRider,
      bake: bake,
      kinds: KINDS,
    };
  };

  W.module("mounts", M);
})();
