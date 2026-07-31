/* ============================================================
   systems/predator.js — THE PREDATOR BLOCK.

   ONE shared answer to "something is hunting you, and then it takes you."

   WHY THIS FILE EXISTS (the failure mode it fixes):
   The repo's own ratchet says it plainly — "18-25 independent AI update loops
   (only 2 share code)". Every time a new dangerous animal shipped, it brought a
   private state machine, a private way of hitting the player, and a private idea
   of what tension sounds like. A shark written that way would have made it
   19-26. So the stalking brain lives HERE, once, medium-agnostic, and the
   shark file is allowed to own only what is genuinely new: its numbers, its fin,
   its swim animation. A land big cat, a wolf pack, a bear, a future human
   stalker all tick the SAME driver and get the whole grammar for free.

   THE FOUR THINGS IT OWNS
   -----------------------
   1. DREAD (the tension bus).  Any hunter reports "here is how scared you
      should be, and how far away I am" once per frame; the bus mixes every
      reporter into ONE global dread level and renders it as sound and a
      vignette. Nobody else is allowed to invent a tension sound.

      The audio is Jaws' ACTUAL mechanism, not a homage to it: a two-note low
      interval whose TEMPO is the distance readout. You do not need to see the
      thing to know it is closing — the notes get faster. Under that sits a
      35-45 Hz sub-bass bed (infrasound dread) and a heartbeat that walks from
      60 to 150 BPM. And on top of all of it, THE DROP-OUT: predatorDrop()
      ducks the entire bus to near-silence for a beat before a committed
      strike, so the strike lands into a hole in the mix. That single trick is
      the highest-value item in the whole research pile and it costs 6 lines.

      Underwater the bus low-passes to ~2.6 kHz and collapses its pan toward
      centre, because submerged humans genuinely lose directional hearing. A
      loud roar you cannot locate is free dread.

   2. SEIZE (the grab/maul state machine).  wind -> strike -> hold -> resolve.
      The victim is held at a jaw anchor on the attacker, the attacker thrashes,
      the camera is possessed, and the whole thing ends in exactly one of
      "escaped" / "killed" / "released" / "aborted".

      NO MASH METER. The base design called for one and the research came back
      firmly against it: mashing is fatigue, false difficulty and no decision.
      Instead: ONE well-telegraphed ~0.9s timed press (two at most per seize).
      Hit it and you are thrown clear. Miss the last one and you are dead. Less
      code AND better design.

      Deaths route through the kill bus (killfeed.js owns the only sanctioned
      HUD popup). This file never toasts a death. Corpses hand off to
      CBZ.ragdollPin so the verlet body whips off the jaw instead of standing
      politely inside it.

   3. HUNT (the generic stalking FSM).
      cruise -> scent -> circle -> bump -> vanish -> rush -> seize -> disengage.
      Two ideas make it medium-agnostic and non-boring:
        * THE LOCOMOTION SEAM. predatorHunt decides WHERE to go; opts.move
          decides HOW to get there. A shark passes waterField.moveInWater; a
          cat passes a floorAt+fence walk. Nothing in here knows about water.
        * THE MENACE GAUGE (Alien: Isolation's core mechanism). Pressure rises
          with proximity, line of sight and time spent committed; when it peaks
          the hunter is FORCED to withdraw and may not re-commit for seconds.
          That is what stops a shark camping on your face, and it is what makes
          the NEXT approach land again instead of being background noise.
        * FAKE-OUTS ARE THE POINT. From `circle` the roll is ~45% vanish /
          ~30% bump / ~25% rush — more than half of all circling ends in
          nothing. A dread cue that reliably precedes an attack stops being a
          dread cue within twenty minutes; players learn to read it as an alarm
          clock. The constants are at the top of the file, one line each.

      It sets hunter.state = "stalk" / "charge", which is EXACTLY what
      systems/markers.js's cityTargetsPlayer() already keys off — so the HUD
      chevron, the minimap blip and the full map light up with zero new code.
      Do not add a parallel threat-marker system.

   4. CAMERA. Trauma-squared shake (Squirrel Eiserloh's GDC formulation) driven
      by SMOOTH value noise, not per-frame Math.random — random-per-frame
      jitters incoherently and reads as a broken renderer, not as force. Small
      hits are gentle, big hits are disproportionately violent, rotation is
      capped at a couple of degrees (sustained rotational shake is what
      actually makes people sick), translation does the work, decay is
      sub-second. Plus a dolly-zoom on commit.
      EVERY FOV write yields to CBZ.fpsScopeFov(). A scope-blind FOV writer
      re-creates the "fake scope" bug; if a scope owns the lens we do the dolly
      translation only and leave the FOV alone.

   REVERT: CBZ.CONFIG.PREDATOR_HORROR = false turns the entire file into
   no-ops — every public entry point returns immediately, nothing is scheduled,
   nothing is drawn. Sub-flags below revert the pieces independently.

   DEPENDENCIES: all of them are guarded. This file must work standalone with
   any subset of gore.js / ragdoll.js / creature_combat.js / waterfield.js /
   audio.js present. If a neighbour is missing you lose a layer, never a frame.

   UPDATER ORDERS CLAIMED
     onAlways(9.9)   dread bus: decay, audio scheduling, vignette, trauma decay
     onUpdate(47.35) seize machine (after wildlife 47.1 so the attacker's
                     transform for the frame is final before we anchor to it)
     onAlways(52.5)  camera post-pass. AFTER camera.js's onAlways(50) AND after
                     systems/fpsmode.js's onAlways(52), which fully owns the FP
                     camera position/look/FOV. At 50.5 the trauma shake and the
                     dolly were silently overwritten by fpsmode every frame —
                     i.e. dead in city first person, the default combat view.
                     It is also the stale-seize watchdog: onAlways runs while
                     the gameplay updaters do NOT, so this is the only place
                     that can un-strand a possessed camera (see cameraPost).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || null;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS (declared here, never in config.js — one-line reverts) --------
  if (CFG.PREDATOR_HORROR == null) CFG.PREDATOR_HORROR = true;   // the whole file
  if (CFG.PREDATOR_AUDIO == null) CFG.PREDATOR_AUDIO = true;     // the dread mix
  if (CFG.PREDATOR_VIGNETTE == null) CFG.PREDATOR_VIGNETTE = true; // the overlay
  if (CFG.PREDATOR_CAMERA == null) CFG.PREDATOR_CAMERA = true;   // trauma + dolly
  if (CFG.PREDATOR_LOS == null) CFG.PREDATOR_LOS = true;         // menace LOS term
  if (CFG.PREDATOR_KIT == null) CFG.PREDATOR_KIT = true;         // derived opts bundles
  if (CFG.PREDATOR_PACK == null) CFG.PREDATOR_PACK = true;       // one-committer packs
  if (CFG.PREDATOR_AMBUSH == null) CFG.PREDATOR_AMBUSH = true;   // lie-in-wait hunters
  // panic tax: mashing break-free OUTSIDE its window feeds the thing holding
  // you. This is the ONE change in this wave that alters an existing shark
  // seize, so it gets its own revert.
  if (CFG.PREDATOR_PANIC == null) CFG.PREDATOR_PANIC = true;

  function on() { return CFG.PREDATOR_HORROR !== false; }

  // ============================================================
  //  TUNING — every number that changes how the horror FEELS lives here.
  //  These are the one-line adjustables the amendment asked for.
  // ============================================================

  // --- fake-out probabilities (§C). These must add to 1.0. More than half of
  //     all circling MUST end in nothing or the cue stops meaning anything.
  const P_CIRCLE_VANISH = 0.45;
  const P_CIRCLE_BUMP = 0.30;
  // remainder (0.25) -> rush
  const P_SCENT_FAKE = 0.20;   // scent that just decays back to cruise

  // --- menace gauge (§B)
  const MEN_PROX = 0.028;      // per second at zero distance
  const MEN_LOS = 0.018;       // per second while it can see you
  const MEN_CIRCLE = 0.035;    // per second while circling
  const MEN_RUSH = 0.150;      // per second while committed
  const MEN_HIT = 0.250;       // one-off when it lands damage on you
  const MEN_BLEED = 0.090;     // per second while disengaged/cruising
  const MEN_PEAK = 0.85;       // >= this forces disengage
  const MEN_COOL_MIN = 4.0, MEN_COOL_RAND = 6.0;  // seconds it may not re-commit

  // --- hunt defaults (a shark tunes the radii; a cat tunes them differently)
  const D_SENSE_R = 110, D_CHUM_R = 200, D_CIRCLE_R = 26, D_ORBIT_R = 18;
  const D_CIRCLE_T = 4, D_CIRCLE_T_RAND = 5;      // 4-9s. NEVER shorten this.
  const D_CRUISE_SPD = 3.0, D_RUSH_SPD = 10.5;
  const D_BUMP_DMG = 6;
  const D_TURN = 2.4;          // rad/s for the fallback locomotion
  const VANISH_MIN = 1.5, VANISH_RAND = 1.5;
  const RUSH_TIMEOUT = 4.5, BUMP_TIMEOUT = 3.0;
  const DROP_LEAD = 0.35;      // seconds before contact that the mix drops out
  // §J: the investigate pass. Each circle without a commit pulls the orbit in by
  // PASS_TIGHTEN, and after PASS_MAX passes it gives up and leaves — the
  // shrinking-radius search that reads as "it is working the area out" instead
  // of "it is stuck on a waypoint". Two numbers, and it costs nothing.
  const PASS_MAX = 3, PASS_TIGHTEN = 0.17;
  // §E ambush: an ambusher does not close in the open. It holds absolutely
  // still until you are inside this fraction of its sense radius, and the
  // longer it has been still the more likely the circle ends in a commit.
  const AMBUSH_WAKE = 0.5, AMBUSH_BIAS = 0.030, AMBUSH_BIAS_MAX = 0.28;

  // --- seize
  const S_WIND = 0.30, S_STRIKE = 0.10;
  const S_HOLD = 2.6, S_DPS = 22, S_ESCAPE = 0.35;
  const QTE_WINDOW = 0.90;     // generous by design (§D)
  const QTE_TELL = 0.35;       // telegraph before the window opens
  const QTE_MAX = 2;           // at most two windows per seize (opts.qteMax overrides)
  // THE PREDATOR LEARNS YOUR TRICK. Every window the player successfully beats
  // costs THAT hunter's next window a slice of time. Alien: Isolation's rule —
  // an escape that works forever stops being an escape and becomes a tax. The
  // floor is absolute: below ~0.55s a timed press is reflex-lottery, not skill.
  const QTE_LEARN = 0.09, QTE_FLOOR = 0.55;
  const CARRY_T = 1.5;         // §I: seconds a corpse rides in the jaws before the drop
  const SEIZE_ABORT_D = 26;    // distance at which the hold is obviously broken
  const MAX_SEIZES = 4;
  const JUDDER_V = 5.4;        // u/s of "shake" judder (= the old 0.09/frame @60)

  // --- camera
  const TRAUMA_DECAY = 1.9;    // sub-second decay from a typical hit
  const TRAUMA_FREQ = 21;      // Hz of the smooth noise
  const TRAUMA_TRANS = 0.42;   // metres at trauma == 1 (translation does the work)
  const TRAUMA_ROT = 0.035;    // radians (~2 degrees) HARD CAP
  const TRAUMA_SHAKE_FEED = 0.25; // fraction handed to camera.js's own shake
  const DOLLY_T = 0.40, DOLLY_FOV = 16, DOLLY_PUSH = 1.9;

  // --- audio
  const MOTIF_FAST = 0.105, MOTIF_SLOW = 0.62;   // seconds between notes
  const HEART_BPM_LO = 60, HEART_BPM_HI = 150;
  const SUB_LO = 35, SUB_HI = 45;                // Hz of the infrasound bed
  const WATER_LP = 2600, AIR_LP = 18000;         // §H: submerged low-pass

  // ============================================================
  //  §K. THE ARCHETYPE TABLE — the ONLY table in predatorKit.
  //
  //  Keyed on the style string creature_combat ALREADY derives
  //  (CBZ.creatureStyleFor), which is the one categorical fact about a predator
  //  we are willing to know. Everything else — every radius, speed, damage and
  //  hold in the bundle — is a CONTINUOUS function of the species' own physical
  //  numbers (scale / spd / bite). A grizzly and a jackal differ because their
  //  NUMBERS differ, never because this file knows their names. Adding a
  //  species must never mean adding a row.
  //
  //  The `lunge` row is not invented: it is wildlife_shark.js's hand-tuned
  //  opts, solved for. The great white (scale 1.2) and the megalodon (scale
  //  2.6) were tuned INDEPENDENTLY by hand, months apart, and the ratios
  //  between them turned out to fit clean power laws to within a few percent:
  //
  //     senseR/circleR/orbitR/chumR  ~ scale^0.5   (110 -> 159.5 observed)
  //     circleT                      ~ scale^0.7   (6.5 -> 11.05 observed)
  //     seize.hold                   ~ scale^0.9   (2.6 -> 5.2  observed)
  //     seize.escape                 ~ scale^-0.9  (0.35 -> 0.175 observed)
  //     seize.dps                    = 10 + bite*0.4  (22 / 34, EXACT)
  //     rush speed multiplier        ~ scale^-0.13 (big things are less nimble)
  //
  //  So the shark's authored feel IS the law, and every other predator now
  //  inherits it. That is the whole thesis of this wave: the shark made the
  //  bear cheap.
  //
  //  Columns: sense chum circle orbit circleT  cruiseK rushK  reachB reachK
  //           rate  hold  escape  ambush  seize(style|""|false)
  //  ("" = derive by mass; false = this archetype does not grab at all, its
  //   commit is a contact hit — a rhino does not carry you off.)
  // ============================================================
  const ARCH = {
    // open-water hunters: enormous sense radius, long patient circle, the
    // committed rush is the fastest thing in the game. Shark-authored.
    lunge:  { sense: 100, chum: 201, circle: 23.7, orbit: 16.4, circleT: 5.73,
              cruiseK: 2.4, rushK: 8.7, reachB: 2.2, reachK: 1.6,
              rate: 1.37, hold: 2.23, escape: 0.41, ambush: false, seize: "shake" },
    // big cats: they see you from a long way off and then STOP. Tight orbit,
    // almost no circling (a cat that circles you for six seconds is a shark),
    // ambush by default, and the grab is the throat-hold you rarely survive.
    // The fairness lives entirely in the silent stalk before it (RDR2 cougar).
    pounce: { sense: 88, chum: 55, circle: 13.5, orbit: 8.5, circleT: 2.4,
              cruiseK: 1.7, rushK: 3.4, reachB: 1.3, reachK: 1.4,
              rate: 1.05, hold: 1.55, escape: 0.24, ambush: true, seize: "pin" },
    // bears, wolves, dogs, crocodilians. The middle of everything, and the one
    // row whose seize style is chosen by MASS rather than named: a heavy
    // quadruped rears and slams (maul), a light one shakes the prey (worry).
    maul:   { sense: 70, chum: 92, circle: 20, orbit: 13, circleT: 4.2,
              cruiseK: 1.8, rushK: 3.6, reachB: 1.5, reachK: 1.5,
              rate: 0.95, hold: 2.35, escape: 0.40, ambush: false, seize: "" },
    // snakes: they do not stalk, they WAIT. Everything is tiny and the strike
    // is over before you read it. Constrictors get the long squeeze; vipers get
    // no hold at all (their threat is the venom afterwards, handled by the
    // caller) — predatorKit picks between them off sp.constrictor/sp.venom.
    strike: { sense: 22, chum: 14, circle: 6, orbit: 3.4, circleT: 0.3,
              cruiseK: 1.2, rushK: 3.2, reachB: 1.0, reachK: 0.9,
              rate: 1.4, hold: 1.1, escape: 0.62, ambush: true, seize: "" },
    // rhino / bison / buffalo. Wide, committed, no grab: the horror is the
    // approach and the impact, and then it is past you and turning.
    ram:    { sense: 62, chum: 20, circle: 30, orbit: 22, circleT: 5.0,
              cruiseK: 1.5, rushK: 3.9, reachB: 2.0, reachK: 1.6,
              rate: 1.3, hold: 1, escape: 1, ambush: false, seize: false },
    // boar / moose / elephant — same shape as ram, shorter and angrier.
    gore:   { sense: 55, chum: 20, circle: 26, orbit: 18, circleT: 4.0,
              cruiseK: 1.5, rushK: 3.3, reachB: 1.6, reachK: 1.4,
              rate: 1.15, hold: 1, escape: 1, ambush: false, seize: false },
    // horse / elk / bighorn — they warn, they kick, they leave.
    stomp:  { sense: 42, chum: 12, circle: 24, orbit: 17, circleT: 3.6,
              cruiseK: 1.4, rushK: 2.9, reachB: 1.4, reachK: 1.2,
              rate: 1.2, hold: 1, escape: 1, ambush: false, seize: false },
    // birds. Present for completeness; predatorIs() screens them out of the
    // hunt entirely, so this row is a safety net, not a behaviour.
    peck:   { sense: 26, chum: 10, circle: 8, orbit: 5, circleT: 1.2,
              cruiseK: 1.6, rushK: 2.6, reachB: 0.9, reachK: 0.8,
              rate: 1.6, hold: 1, escape: 1, ambush: false, seize: false },
  };
  // a plain bite (the fallback style) behaves like a small mauler.
  ARCH.bite = ARCH.maul;

  // The mass line between "rears and slams" and "shakes the prey". Brown bear
  // 1.35 and polar bear 1.45 sit above it; gray wolf 0.95, coyote 0.78 and the
  // stray dog 0.75 sit below. It is a threshold on a number, not a species list,
  // so a newly-authored 1.6-scale hyena rears without anyone editing this file.
  const MAUL_MASS = 1.15;
  // §K: which archetypes are predators at all, and how dangerous a species must
  // be before it hunts you. ONE definition, so wildlife.js and dogs.js stop
  // each re-deriving "is this thing after me".
  const PRED_STYLES = { lunge: 1, maul: 1, pounce: 1, strike: 1, ram: 1, gore: 1, stomp: 1, bite: 1 };
  const PRED_DANGER = 0.5;

  // ============================================================
  //  small helpers — zero allocation, all guarded
  // ============================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function nowS() { return (CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : Date.now())) / 1000; }
  function playing() { return !!(CBZ.game && CBZ.game.state === "playing"); }

  function shortAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function turnToward(cur, want, maxStep) {
    const d = shortAngle(want - cur);
    return cur + (d > maxStep ? maxStep : (d < -maxStep ? -maxStep : d));
  }
  function actorScale(a) {
    if (a && a.species && typeof a.species.scale === "number") return a.species.scale;
    if (a && typeof a.scale === "number") return a.scale;
    return 1;
  }
  function actorPos(a) {
    if (!a) return null;
    if (a.pos && a.pos.x != null) return a.pos;
    if (a.group && a.group.position) return a.group.position;
    return null;
  }
  function actorName(a) {
    if (!a) return "something";
    if (a === CBZ.player || a.isPlayer) return "You";
    if (a.name) return a.name;
    if (a.species) return a.species.name || a.species.id || "animal";
    return a.kind || "something";
  }

  // SMOOTH VALUE NOISE. The whole point of trauma shake is that it is coherent
  // motion, not white noise — Math.random() per frame reads as a bug. Integer
  // lattice + smoothstep, three independent channels, no allocation, no table.
  function hashF(i) {
    i = (i << 13) ^ i;
    return 1 - (((i * (i * i * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824);
  }
  function noise1(seed, t) {
    const i = Math.floor(t), f = t - i;
    const a = hashF((i * 374761393 + seed * 668265263) | 0);
    const b = hashF(((i + 1) * 374761393 + seed * 668265263) | 0);
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }

  // ============================================================
  //  1d. MEDIUM — the one shared water/air question.
  //  gore.js (Agent B) delegates to this with its own local fallback, so the
  //  answer can never disagree between the blood and the AI.
  // ============================================================
  function predatorMedium(x, y, z) {
    try {
      if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(x, z)) return "air";
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : null;
      if (sy == null || !isFinite(sy)) return "air";
      return (y <= sy + 0.4) ? "water" : "air";
    } catch (e) { return "air"; }
  }
  CBZ.predatorMedium = predatorMedium;

  function playerSubmerged() {
    if (CBZ.citySwimming) { try { if (CBZ.citySwimming()) return true; } catch (e) {} }
    if (CBZ.player && CBZ.player._swim) return true;
    return false;
  }

  // ============================================================
  //  1a. THE DREAD BUS
  //  Reporters are a fixed pool of slots — a hunting actor reports once per
  //  frame and goes quiet when it stops. Silence for DREAD_TTL auto-decays it
  //  to nothing, so a hunter that despawns mid-stalk cannot leave the mix
  //  screaming forever (the classic "stuck alarm" bug).
  // ============================================================
  const DREAD_TTL = 0.8;
  const MAX_REPORTERS = 8;
  const REP = [];
  for (let i = 0; i < MAX_REPORTERS; i++) REP.push({ src: null, level: 0, dist: 999, sub: false, t: -999 });

  let dread = 0;          // eased global dread 0..1
  let dreadRaw = 0;       // instantaneous max of live reporters
  let dreadDist = 999;    // distance of the loudest reporter (drives motif tempo)
  let dreadSub = false;   // submerged mix
  let dropUntil = -999;   // the DROP-OUT window end (seconds)

  function predatorDread(source, level, opts) {
    if (!on()) return;
    if (!(level > 0)) level = 0;
    if (level > 1) level = 1;
    const t = nowS();
    let slot = null, oldest = null;
    for (let i = 0; i < MAX_REPORTERS; i++) {
      const r = REP[i];
      if (r.src === source) { slot = r; break; }
      if (!oldest || r.t < oldest.t) oldest = r;
    }
    if (!slot) {
      // take a dead slot, else the stalest one — a louder newcomer always wins
      slot = oldest;
      if (!slot) return;
      if (t - slot.t < DREAD_TTL && slot.level > level) return;  // don't evict a scarier live reporter
      slot.src = source;
    }
    slot.level = level;
    slot.dist = (opts && opts.dist != null && isFinite(opts.dist)) ? opts.dist : 40;
    slot.sub = !!(opts && opts.submerged);
    slot.t = t;
  }
  CBZ.predatorDread = predatorDread;
  CBZ.predatorDreadLevel = function () { return on() ? dread : 0; };

  // reused so predatorHunt never allocates to report
  const _dreadOpts = { dist: 0, submerged: false, name: "" };

  function collectDread(dt) {
    const t = nowS();
    let best = 0, bestD = 999, sub = false;
    for (let i = 0; i < MAX_REPORTERS; i++) {
      const r = REP[i];
      if (!r.src) continue;
      if (t - r.t > DREAD_TTL) { r.src = null; r.level = 0; continue; }
      if (r.level > best) { best = r.level; bestD = r.dist; }
      if (r.sub) sub = true;
    }
    dreadRaw = best;
    dreadDist = bestD;
    dreadSub = sub || playerSubmerged();
    // asymmetric ease: dread arrives fast and leaves slowly. Tension that
    // evaporates the instant the threat turns away never accumulates.
    const k = (best > dread) ? (1 - Math.exp(-7 * dt)) : (1 - Math.exp(-1.35 * dt));
    dread += (best - dread) * k;
    if (dread < 0.002) dread = 0;
  }

  // ============================================================
  //  THE DREAD MIX (procedural WebAudio — no new assets)
  //
  //  Graph, built once and never rebuilt:
  //     motif -> gMotif -> pan -\
  //     bed   -> gBed   ---------+-> gDuck -> lpFilter -> destination
  //     heart -> gHeart ---------/
  //     stingers -> gSting ------/
  //  gDuck is THE DROP-OUT. lpFilter + pan are §H's underwater treatment.
  // ============================================================
  let AC = null, gDuck = null, lpF = null, panN = null;
  let gMotif = null, gBed = null, gHeart = null, gSting = null;
  let bedA = null, bedB = null, noiseBuf = null;
  let audioFailed = false;
  let nextMotif = 0, motifTock = 0, nextHeart = 0;
  let lastSting = -999, lastStingKind = "";
  let dreadBedDebugged = false;
  // every stinger gets its OWN gain node in front of gSting, so predatorDrop
  // can silence a stinger that is still sounding without touching the ones it
  // is about to frame. See predatorDrop().
  let curSting = null;
  let paramT = 0;   // throttle for AudioParam writes (never per-frame spam)

  function audioReady() {
    if (audioFailed || CFG.PREDATOR_AUDIO === false) return false;
    const ctx = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
    if (!ctx) return false;
    if (AC === ctx && gDuck) return true;
    try {
      AC = ctx;
      gDuck = ctx.createGain(); gDuck.gain.value = 1;
      lpF = ctx.createBiquadFilter(); lpF.type = "lowpass";
      lpF.frequency.value = AIR_LP; lpF.Q.value = 0.5;
      gDuck.connect(lpF); lpF.connect(ctx.destination);

      gMotif = ctx.createGain(); gMotif.gain.value = 0.0001;
      gBed = ctx.createGain(); gBed.gain.value = 0.0001;
      gHeart = ctx.createGain(); gHeart.gain.value = 0.0001;
      gSting = ctx.createGain(); gSting.gain.value = 0.9;

      // the motif is the only thing that carries direction — so it is the only
      // thing the underwater collapse can rob you of.
      if (ctx.createStereoPanner) {
        panN = ctx.createStereoPanner();
        gMotif.connect(panN); panN.connect(gDuck);
      } else {
        panN = null;
        gMotif.connect(gDuck);
      }
      gBed.connect(gDuck); gHeart.connect(gDuck);
      // STINGERS BYPASS THE DUCK ON PURPOSE. The drop-out is supposed to
      // silence the AMBIENCE so an EVENT can punch through the hole it leaves.
      // Routing the stinger through gDuck would mute the very hit the drop
      // exists to frame — the trick would cancel itself out.
      gSting.connect(lpF);

      // the infrasound bed: two near-unison sines that BEAT against each other.
      // A single tone reads as a hum; a slow beat reads as something breathing.
      bedA = ctx.createOscillator(); bedA.type = "sine"; bedA.frequency.value = SUB_LO;
      bedB = ctx.createOscillator(); bedB.type = "sine"; bedB.frequency.value = SUB_LO * 1.031;
      bedA.connect(gBed); bedB.connect(gBed);
      bedA.start(); bedB.start();

      const len = (ctx.sampleRate * 1.0) | 0;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) {
      audioFailed = true; AC = null; gDuck = null;
      return false;
    }
  }

  function noiseSrc(when, dur) {
    const s = AC.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(when, Math.random() * 0.7);
    s.stop(when + dur);
    return s;
  }

  // one motif note: a short low tone with a downward bend. Two of them,
  // alternating a minor second apart, IS the approach motif.
  function motifNote(when, freq, dur, vol) {
    try {
      const o = AC.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(freq, when);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.94), when + dur);
      const o2 = AC.createOscillator(); o2.type = "sawtooth";
      o2.frequency.setValueAtTime(freq * 0.5, when);
      const lp = AC.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.value = 240; lp.Q.value = 0.8;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      const g2 = AC.createGain(); g2.gain.value = 0.35;
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(gMotif);
      o.start(when); o2.start(when); o.stop(when + dur + 0.06); o2.stop(when + dur + 0.06);
      if (CBZ.debugSoundPlayed) CBZ.debugSoundPlayed("predator_motif", "procedural dread motif", when);
    } catch (e) {}
  }

  function thump(when, vol) {
    try {
      const o = AC.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(80, when);
      o.frequency.exponentialRampToValueAtTime(27, when + 0.13);
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.19);
      o.connect(g); g.connect(gHeart);
      o.start(when); o.stop(when + 0.24);
      if (CBZ.debugSoundPlayed) CBZ.debugSoundPlayed("predator_heartbeat", "procedural heartbeat synth", when);
    } catch (e) {}
  }

  function predatorStinger(kind) {
    if (!on()) return;
    const t = nowS();
    if (t - lastSting < 0.22 && kind === lastStingKind) return;
    lastSting = t; lastStingKind = kind;
    if (!audioReady()) return;
    const when = AC.currentTime + 0.005;
    // one gain per stinger, in front of the (un-ducked) stinger bus. It is what
    // gives predatorDrop() a handle to cut THIS sound and only this sound.
    let sg = null;
    try { sg = AC.createGain(); sg.gain.value = 1; sg.connect(gSting); curSting = sg; }
    catch (e) { sg = gSting; curSting = null; }
    let sounded = false;
    try {
      if (kind === "notice") {
        // a thin rising shimmer — "it knows". Quiet on purpose; the point is
        // that you half-hear it and are not sure.
        const s = noiseSrc(when, 0.55);
        const bp = AC.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.setValueAtTime(700, when);
        bp.frequency.exponentialRampToValueAtTime(2600, when + 0.5);
        bp.Q.value = 6;
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.16, when + 0.30);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
        s.connect(bp); bp.connect(g); g.connect(sg);
        sounded = true;
      } else if (kind === "commit") {
        // three detuned saws sliding DOWN through a lowpass: the brass cluster.
        for (let i = 0; i < 3; i++) {
          const o = AC.createOscillator(); o.type = "sawtooth";
          const f0 = 128 * (1 + i * 0.007);
          o.frequency.setValueAtTime(f0, when);
          o.frequency.exponentialRampToValueAtTime(f0 * 0.52, when + 0.85);
          const g = AC.createGain();
          g.gain.setValueAtTime(0.0001, when);
          g.gain.exponentialRampToValueAtTime(0.10, when + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
          const lp = AC.createBiquadFilter(); lp.type = "lowpass";
          lp.frequency.setValueAtTime(1800, when);
          lp.frequency.exponentialRampToValueAtTime(300, when + 0.9);
          o.connect(lp); lp.connect(g); g.connect(sg);
          o.start(when); o.stop(when + 0.95);
        }
        sounded = true;
      } else {   // "impact"
        const o = AC.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(150, when);
        o.frequency.exponentialRampToValueAtTime(34, when + 0.22);
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.5, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
        o.connect(g); g.connect(sg);
        o.start(when); o.stop(when + 0.34);
        const s = noiseSrc(when, 0.18);
        const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        const ng = AC.createGain();
        ng.gain.setValueAtTime(0.28, when);
        ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
        s.connect(lp); lp.connect(ng); ng.connect(sg);
        sounded = true;
      }
    } catch (e) {}
    if (sounded && CBZ.debugSoundPlayed) {
      CBZ.debugSoundPlayed("predator_stinger:" + kind, "procedural predator stinger", when);
    }
  }
  CBZ.predatorStinger = predatorStinger;

  // THE DROP-OUT. Call ~0.35s before a committed strike. Everything ducks to
  // near-silence and the strike lands into a hole. This is the single
  // highest-value horror trick in the file.
  //
  // IT MUST ALSO CUT THE STINGER THAT SET IT UP. The "commit" cluster is ~0.9s
  // of detuned saws and it fires when the hunter enters `rush`; the drop lands
  // ~0.28s later. Stingers deliberately bypass gDuck (that is what lets the
  // IMPACT punch through the hole) — so without this, the commit cluster sounds
  // straight through the silence and fills in the very hole the drop exists to
  // create. The cut is a ~60ms ramp, never an instant zero: a hard zero clicks.
  // New stingers created AFTER the drop are untouched, so the impact still hits.
  function predatorDrop(secs) {
    if (!on()) return;
    secs = clamp(secs == null ? 0.30 : secs, 0.05, 2.0);
    dropUntil = nowS() + secs;
    if (!audioReady()) return;
    try {
      const t = AC.currentTime;
      gDuck.gain.cancelScheduledValues(t);
      gDuck.gain.setTargetAtTime(0.012, t, 0.035);
      gDuck.gain.setTargetAtTime(1, t + secs, 0.10);
    } catch (e) {}
    if (curSting) {
      const sg = curSting;
      curSting = null;
      try {
        const t = AC.currentTime;
        sg.gain.cancelScheduledValues(t);
        sg.gain.setValueAtTime(sg.gain.value, t);
        sg.gain.linearRampToValueAtTime(0.0001, t + 0.06);
      } catch (e) {}
    }
  }
  CBZ.predatorDrop = predatorDrop;

  function tickAudio(dt) {
    if (!audioReady()) return;
    const t = AC.currentTime;
    const lvl = dread;
    const dropped = nowS() < dropUntil;
    const reviewing = !!(CBZ.soundDebug && CBZ.soundDebug.enabled && CBZ.soundDebug.enabled());
    if (lvl > 0.02 && reviewing && !dreadBedDebugged) {
      dreadBedDebugged = true;
      if (CBZ.debugSoundPlayed) CBZ.debugSoundPlayed("predator_dread_bed", "procedural infrasound bed", t);
    } else if (lvl <= 0.02 || !reviewing) {
      // Reset while silent or while the debugger is off. Turning F8 on during
      // an already-live bed will therefore identify it on the next audio tick.
      dreadBedDebugged = false;
    }
    paramT -= dt;
    const writeParams = paramT <= 0;
    if (writeParams) paramT = 0.08;

    if (writeParams) {
      try {
        // the bed swells with dread and its beat frequency widens — the room
        // itself gets more wrong as the thing gets closer.
        const bedV = lvl <= 0.02 ? 0.0001 : 0.020 + lvl * 0.085;
        gBed.gain.setTargetAtTime(bedV, t, 0.35);
        const f = SUB_LO + (SUB_HI - SUB_LO) * lvl;
        bedA.frequency.setTargetAtTime(f, t, 0.4);
        bedB.frequency.setTargetAtTime(f * (1.018 + lvl * 0.022), t, 0.4);
        gMotif.gain.setTargetAtTime(lvl < 0.2 ? 0.0001 : 0.55 + lvl * 0.45, t, 0.12);
        gHeart.gain.setTargetAtTime(lvl < 0.3 ? 0.0001 : 0.35 + lvl * 0.65, t, 0.2);
        // §H: submerged -> low-pass and collapse the pan toward centre. You can
        // hear it. You cannot tell where it is. That asymmetry is the scare.
        lpF.frequency.setTargetAtTime(dreadSub ? WATER_LP : AIR_LP, t, 0.25);
        if (panN) {
          // bearing of the threat relative to the camera, folded to -1..1
          let p = 0;
          if (!dreadSub && CBZ.camera && dreadDist < 400) {
            p = clamp(Math.sin(nowS() * 0.21) * 0.55, -0.8, 0.8);
          }
          panN.pan.setTargetAtTime(p, t, 0.3);
        }
      } catch (e) {}
    }

    if (dropped || lvl < 0.2) { nextMotif = 0; nextHeart = 0; return; }

    // THE JAWS LAW: tempo IS the distance readout. Level sets the floor, the
    // measured distance does the rest — the player learns to hear "closer"
    // without ever seeing the thing.
    const dk = clamp(1 - clamp(dreadDist, 0, 120) / 120, 0, 1);
    const closeness = clamp(lvl * 0.6 + dk * 0.4, 0, 1);
    const interval = MOTIF_SLOW + (MOTIF_FAST - MOTIF_SLOW) * (closeness * closeness);
    if (nextMotif <= 0 || nextMotif < t - 0.5) nextMotif = t + 0.02;
    let guard = 0;
    while (nextMotif <= t + 0.12 && guard++ < 8) {
      const lowNote = (motifTock & 1) === 0;
      motifNote(nextMotif, lowNote ? 41.2 : 43.65, Math.min(0.22, interval * 0.85),
        0.055 + lvl * 0.12);
      motifTock++;
      nextMotif += interval;
    }

    if (lvl >= 0.3) {
      const bpm = HEART_BPM_LO + (HEART_BPM_HI - HEART_BPM_LO) * lvl;
      const beat = 60 / bpm;
      if (nextHeart <= 0 || nextHeart < t - 0.5) nextHeart = t + 0.02;
      guard = 0;
      while (nextHeart <= t + 0.12 && guard++ < 6) {
        thump(nextHeart, 0.05 + lvl * 0.10);
        thump(nextHeart + Math.min(0.24, beat * 0.34), (0.05 + lvl * 0.10) * 0.68);
        nextHeart += beat;
      }
    }
  }

  // ============================================================
  //  THE VIGNETTE — a DOM overlay, exactly gore.js's ensureFlash() pattern
  //  (fixed, pointer-events:none, lazily created, opacity-only writes).
  //  z-index 24, deliberately BELOW gore's 26: blood is closer to your eye
  //  than atmosphere is.
  //
  //  We cannot desaturate (there is no post FX chain), so tension is carried
  //  by two stacked gradients cross-faded by opacity: a wide soft darkening
  //  for the low band, then a tight COLD BLUE closing iris for the high band.
  //  Two fixed layers means we never rebuild a gradient string per frame.
  // ============================================================
  let vigA = null, vigB = null, vigPulse = null, vigPrompt = null;
  let vigAOp = -1, vigBOp = -1, vigPOp = -1, promptHTML = "";

  function ensureVignette() {
    if (vigA || typeof document === "undefined" || !document.body) return vigA;
    vigA = document.createElement("div");
    vigA.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:24;opacity:0;" +
      "background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 44%,rgba(2,6,12,.72) 100%)";
    document.body.appendChild(vigA);
    vigB = document.createElement("div");
    vigB.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:24;opacity:0;" +
      "background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 18%,rgba(6,22,44,.55) 62%,rgba(1,4,10,.94) 100%)";
    document.body.appendChild(vigB);
    vigPulse = document.createElement("div");
    vigPulse.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:25;opacity:0;" +
      "background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,0) 55%,rgba(230,244,255,.30) 100%)";
    document.body.appendChild(vigPulse);
    vigPrompt = document.createElement("div");
    vigPrompt.style.cssText = "position:fixed;left:0;right:0;bottom:19%;text-align:center;" +
      "pointer-events:none;z-index:25;opacity:0;font:700 26px Fredoka,Arial,sans-serif;" +
      "color:#f2f6ff;text-shadow:0 2px 10px rgba(0,0,0,.85),0 0 22px rgba(80,150,255,.5);letter-spacing:.06em";
    document.body.appendChild(vigPrompt);
    return vigA;
  }

  function setOpacity(el, cur, want) {
    if (!el) return cur;
    if (Math.abs(want - cur) < 0.008 && !(want === 0 && cur !== 0)) return cur;
    el.style.opacity = want <= 0.001 ? "0" : String(Math.min(1, want));
    return want <= 0.001 ? 0 : want;
  }

  function tickVignette() {
    if (CFG.PREDATOR_VIGNETTE === false || !on()) {
      if (vigA) { vigAOp = setOpacity(vigA, vigAOp, 0); vigBOp = setOpacity(vigB, vigBOp, 0); vigPOp = setOpacity(vigPulse, vigPOp, 0); }
      return;
    }
    if (dread < 0.02 && vigAOp <= 0 && vigPOp <= 0) return;
    if (!ensureVignette()) return;
    const lvl = dread;
    vigAOp = setOpacity(vigA, vigAOp, clamp(lvl * 1.55, 0, 0.9));
    vigBOp = setOpacity(vigB, vigBOp, clamp((lvl - 0.45) * 1.8, 0, 0.92));
    // the QTE telegraph rides the same overlay — no floating card, no new HUD
    // surface (HUD doctrine: the killfeed owns the only popup).
    let pulse = 0, prompt = "";
    for (let i = 0; i < SEIZES.length; i++) {
      const h = SEIZES[i];
      if (!h.isPlayer) continue;
      if (h.qteState === "tell") pulse = Math.max(pulse, 0.25 + 0.35 * Math.abs(Math.sin(nowS() * 16)));
      else if (h.qteState === "open") { pulse = Math.max(pulse, 0.6); prompt = h.promptHTML; }
    }
    vigPOp = setOpacity(vigPulse, vigPOp, pulse);
    if (vigPrompt && prompt !== promptHTML) {
      promptHTML = prompt;
      vigPrompt.innerHTML = prompt;
      vigPrompt.style.opacity = prompt ? "1" : "0";
      // ON TOUCH THE PROMPT IS A REAL BUTTON, SO IT MUST REALLY BE PRESSABLE.
      // touchActionPrompt hands back a .tpill on touch; leaving the whole
      // subtree pointer-events:none made it a lie that only "worked" because a
      // touch anywhere on screen happened to count. The CONTAINER stays
      // pointer-events:none (it spans the full width and must never eat a
      // look-drag) and only the pill opts back in — touch.js's own capture
      // phase .tpill delegate then fires the same key the desktop listener
      // reads. No parallel touch handler; touch.js still owns the layer.
      if (prompt && vigPrompt.querySelector) {
        const pill = vigPrompt.querySelector(".tpill");
        if (pill) pill.style.pointerEvents = "auto";
      }
    }
  }

  // ============================================================
  //  1e/§E. CAMERA — trauma-squared shake + the commit dolly.
  //
  //  trauma is the stored energy; the APPLIED shake is trauma*trauma, which is
  //  what makes a graze feel like a graze and a bite feel like a car crash.
  //  Rotation is capped hard (~2 degrees) because sustained high-frequency
  //  rotational shake is what actually makes players nauseous — translation is
  //  where the violence should live.
  // ============================================================
  let trauma = 0;
  let dollyT = 0, dollyX = 0, dollyY = 0, dollyZ = 0;
  // THE BASE FOV THE DOLLY WIDENS FROM, and the seize that owns the dolly.
  // -1 means "not captured yet" (also the state while a scope owns the lens, in
  // which case we never touch the FOV at all).
  let dollyFov0 = -1, dollyOwner = 0;

  function predatorTrauma(a) {
    if (!on()) return;
    if (!(a > 0)) return;
    trauma = clamp(trauma + a, 0, 1);
    // hand a slice to camera.js's own shake so the existing camera path still
    // applies it (its jitter is Math.random-per-frame, so we only give it a
    // taste — the coherent motion below carries the character).
    if (CBZ.shake) { try { CBZ.shake(trauma * trauma * TRAUMA_SHAKE_FEED * 2.2); } catch (e) {} }
  }
  CBZ.predatorTrauma = predatorTrauma;

  function startDolly(x, y, z, owner) {
    if (CFG.PREDATOR_CAMERA === false) return;
    // restore whatever a previous dolly was still holding before re-basing
    endDolly();
    dollyT = DOLLY_T; dollyX = x; dollyY = y; dollyZ = z;
    dollyOwner = owner || 0;
  }

  // THE FOV MUST BE WRITTEN ABSOLUTELY, NEVER `+=`.
  // During a seize possessCamera() sets cineCam.active, and camera.js's cine
  // branch returns BEFORE any camera.fov write — so nothing restores the lens
  // and a per-frame `cam.fov += DOLLY_FOV * k` compounds: ~+246 degrees onto a
  // 66-degree lens across the 0.40s dolly. fov >= 180 is not representable and
  // the projection degenerates for exactly the length of the strike. So we
  // capture a base (lazily, on the first frame we are actually allowed to write
  // the FOV — a scope may own the lens at dolly start), write base + offset, and
  // put the base back when the dolly ends or the seize exits by any path.
  function endDolly() {
    dollyT = 0; dollyOwner = 0;
    if (dollyFov0 < 0) return;
    const cam = CBZ.camera;
    const base = dollyFov0;
    dollyFov0 = -1;
    if (!cam || cam.fov == null) return;
    if (cam.fov !== base) {
      cam.fov = base;
      if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
    }
  }

  function cameraPost(dt) {
    // ---- THE STALE-SEIZE WATCHDOG. This is an onAlways, which is the whole
    // point: core/loop.js runs CBZ.updaters (and therefore seizeTick) ONLY
    // while game.state === "playing". If the game leaves that state mid-seize
    // — pause, mode transition, the game-over card — seizeTick simply stops,
    // and the identical guard that used to live inside it was dead code: a
    // possessed cineCam stayed active forever, physics.js kept zeroing WASD off
    // CBZ.cineActive() and camera.js kept hard-returning to the cine branch.
    // Camera frozen on a jaw, player unable to move, no recovery. So the check
    // lives HERE, where it always runs.
    if (SEIZES.length) {
      const okState = playing();
      for (let i = SEIZES.length - 1; i >= 0; i--) {
        const h = SEIZES[i];
        if (!okState) { endSeize(h, "aborted"); continue; }
        if (h.mode0 && CBZ.game && CBZ.game.mode !== h.mode0) { endSeize(h, "aborted"); continue; }
      }
    }
    if (!on() || CFG.PREDATOR_CAMERA === false) { trauma = 0; endDolly(); return; }
    if (trauma > 0) trauma = Math.max(0, trauma - TRAUMA_DECAY * dt);
    const cam = CBZ.camera;
    if (!cam || !cam.position) return;

    if (trauma > 0.002) {
      const s = trauma * trauma;
      const t = nowS() * TRAUMA_FREQ;
      cam.position.x += noise1(1, t) * s * TRAUMA_TRANS;
      cam.position.y += noise1(2, t) * s * TRAUMA_TRANS * 0.8;
      cam.position.z += noise1(3, t) * s * TRAUMA_TRANS;
      // rotation LAST and TINY. camera.js has already run its lookAt, so this
      // roll survives the frame instead of being overwritten.
      cam.rotation.z += noise1(4, t) * s * TRAUMA_ROT;
    }

    if (dollyT > 0) {
      dollyT = Math.max(0, dollyT - dt);
      if (dollyT <= 0) { endDolly(); return; }         // the base fov goes back
      const k = Math.sin(clamp(1 - dollyT / DOLLY_T, 0, 1) * Math.PI);   // in and out
      // push the lens toward the attacker...
      let dx = dollyX - cam.position.x, dy = dollyY - cam.position.y, dz = dollyZ - cam.position.z;
      const l = Math.hypot(dx, dy, dz);
      if (l > 0.001) {
        const push = Math.min(DOLLY_PUSH * k, l * 0.5);
        cam.position.x += (dx / l) * push;
        cam.position.y += (dy / l) * push;
        cam.position.z += (dz / l) * push;
      }
      // ...while WIDENING the FOV. Vertigo without moving the subject.
      // A SCOPE ALWAYS WINS THE LENS. If fpsScopeFov() has an opinion we do the
      // dolly translation only — a scope-blind FOV writer is the "fake scope" bug.
      let scoped = null;
      if (CBZ.fpsScopeFov) { try { scoped = CBZ.fpsScopeFov(); } catch (e) { scoped = null; } }
      if (scoped == null && cam.isPerspectiveCamera !== false && cam.fov != null) {
        // capture the pre-dolly lens the first time we are allowed to write it
        if (dollyFov0 < 0) dollyFov0 = (isFinite(cam.fov) && cam.fov > 0) ? cam.fov : 66;
        const want = clamp(dollyFov0 + DOLLY_FOV * k, 5, 170);   // ABSOLUTE, never +=
        if (cam.fov !== want) {
          cam.fov = want;
          if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
        }
      }
    }
  }

  // ============================================================
  //  1b/1c. SEIZE — the grab/maul state machine.
  // ============================================================
  const SEIZES = [];
  const SEIZE_POOL = [];

  // module scratch — the hold path runs every frame and allocates nothing.
  // THE JAW ANCHOR IS PER HANDLE (h.jaw), NOT MODULE-GLOBAL. It used to be one
  // shared vector rewritten per handle inside seizeTick's loop, while the pin
  // callback handed to ragdoll.js closed over that same shared vector and is
  // called from onUpdate(25) — 22 orders EARLIER. So every pin read the LAST
  // handle processed on the PREVIOUS frame: with MAX_SEIZES = 4, two sharks
  // killing two peds dragged both corpses to one mouth.
  const _v3 = THREE ? new THREE.Vector3() : null;
  const _goreDir = { x: 0, y: 0, z: 0 };
  const _goreOpts = { amount: 1, dir: _goreDir, medium: "air", player: false, sfx: true, melee: "blade" };
  const _woundP = { x: 0, y: 0, z: 0 };
  const _woundOpts = { head: false, cal: 1.5, melee: "blade", fromX: 0, fromZ: 0 };
  const _sfxOpts = { volume: 1 };
  // the QTE tick must NEVER be eaten by the sample bank's per-name cooldown —
  // a missed instruction cue reads as an unfair death.
  const _sfxTick = { volume: 1, force: true };
  const _killImp = { fromX: 0, fromZ: 0, attacker: null, byPlayer: false };

  // ---- the escape input. EDGE-TRIGGERED ONLY: a polled key would let a
  //      player hold W and pass every window for free, which is exactly the
  //      "no real decision" failure the mash meter was rejected for.
  let pressStamp = -999;
  function markPress() { pressStamp = nowS(); }
  // ...but a POINTER press is only an escape attempt while a window is actually
  // open. These are capture-phase listeners on window, so without this gate any
  // click anywhere — a HUD button, the map, the phone — stamped a press, and a
  // player who happened to click something else during the window got out for
  // free. The keyboard listener needs no gate: a stamp outside the window can
  // never satisfy `pressStamp > h.qteOpenAt`.
  function qteWindowOpen() {
    for (let i = 0; i < SEIZES.length; i++) {
      const h = SEIZES[i];
      if (h.active && h.isPlayer && h.qteState === "open") return true;
    }
    return false;
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("keydown", function (e) {
      if (!e || e.repeat) return;
      const k = e.key ? String(e.key).toLowerCase() : "";
      if (k === " " || k === "w" || k === "spacebar") markPress();
    }, true);
    window.addEventListener("mousedown", function (e) {
      if (e && e.button !== 0) return;
      if (qteWindowOpen()) markPress();
    }, true);
    window.addEventListener("touchstart", function () {
      if (qteWindowOpen()) markPress();
    }, { passive: true, capture: true });
  }

  // IS THIS THE PLAYER? Identity alone is not enough: wildlife.js hands the
  // shared combat driver a reusable DECOY target whose .pos IS CBZ.player.pos
  // (that is how its hot path avoids allocating), and creature_combat.js's own
  // isPlayerTarget() already tests for exactly that. Without the third clause a
  // decoy slips past every "is it the player" gate in this file and lands on
  // the raw `target.hp -= dmg` fallbacks — i.e. player damage that bypasses
  // cityHurtPlayer and the kill bus entirely.
  function isPlayerActor(v) {
    if (!v) return false;
    const P = CBZ.player;
    if (v === P || v.isPlayer === true) return true;
    return !!(P && P.pos && v.pos === P.pos);
  }
  function playerRagdollTarget() {
    return (CBZ.city && CBZ.city.playerActor) || null;
  }

  function predatorSeized(victim) {
    if (!victim) return false;
    if (isPlayerActor(victim)) {
      for (let i = 0; i < SEIZES.length; i++) if (SEIZES[i].isPlayer) return true;
      return false;
    }
    return !!victim._seizedBy;
  }
  CBZ.predatorSeized = predatorSeized;
  CBZ.predatorSeizeCount = function () { return SEIZES.length; };

  // world position of the attacker's jaw anchor. Models in this repo are
  // authored nose-toward +X (the same convention wildlife.js's rigs use), so
  // the default anchor is simply "in front of the nose".
  //
  // THE ANCHOR IS IN LOCAL, PRE-SCALE UNITS. wildlife.js does
  // group.scale.setScalar(sp.scale), so g.matrixWorld ALREADY applies the
  // animal's scale to whatever we hand it. Baking a `* scale` into the default
  // as well put the default jaw at 1.15 * scale^2 — invisible today because
  // both live callers pass an explicit jaw, and exactly the trap a shared
  // block must not leave for the next adopter.
  //
  // RETURNS FALSE IF THE ANSWER IS NOT FINITE. A NaN anywhere in the attacker's
  // matrixWorld would otherwise be laundered straight into CBZ.player.pos by
  // anchorVictim — unrecoverable, and the source of exactly the
  // computeBoundingSphere noise the repo has learned to treat as baseline. Every
  // caller must bail the seize on false rather than use the number.
  function jawWorld(h, out) {
    const g = h.attacker && h.attacker.group;
    if (!g) { out.x = out.y = out.z = 0; return false; }
    const lx = h.jawX != null ? h.jawX : 1.15;
    const ly = h.jawY != null ? h.jawY : 0.25;
    const lz = h.jawZ != null ? h.jawZ : 0;
    let done = false;
    if (_v3 && g.matrixWorld) {
      try {
        g.updateMatrixWorld(true);
        _v3.set(lx, ly, lz).applyMatrix4(g.matrixWorld);
        out.x = _v3.x; out.y = _v3.y; out.z = _v3.z;
        done = true;
      } catch (e) { /* fall through to the yaw-only transform */ }
    }
    if (!done) {
      // No matrix available (no THREE at all): this branch is the ONE place
      // nothing else applies group.scale, so apply it by hand here.
      const s = actorScale(h.attacker) || 1;
      const yaw = -(g.rotation ? g.rotation.y : 0);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      out.x = g.position.x + (lx * c - lz * sn) * s;
      out.y = g.position.y + ly * s;
      out.z = g.position.z + (lx * sn + lz * c) * s;
    }
    return isFinite(out.x) && isFinite(out.y) && isFinite(out.z);
  }

  function hurtVictim(h, dmg) {
    if (dmg <= 0) return;
    const ap = actorPos(h.attacker);
    if (h.isPlayer) {
      // THE PLAYER IS NEVER DAMAGED BY A RAW `.hp -=`. cityHurtPlayer is the
      // only sanctioned sink: it stamps the killer, feeds armour/flash/hurt
      // cues and routes the death through the kill bus. Draining hp behind its
      // back leaves the player at hp<=0 but not `dead`, so the seize's own
      // resolve never fires and killfeed.js never learns what did it. If the
      // sink is absent there is no bus at all, and taking no damage is the
      // correct degrade.
      if (CBZ.cityHurtPlayer) {
        try {
          CBZ.cityHurtPlayer(dmg, ap ? ap.x : 0, ap ? ap.z : 0, h.cause, false, h.attacker, false);
        } catch (e) {}
      }
    } else {
      const v = h.victim;
      // AN ANIMAL'S HEALTH IS NOT OURS TO WRITE EITHER. The player has had a
      // sanctioned sink here since day one; wildlife got a raw `.hp -=` because
      // for this file's whole life the only thing it ever held was the player.
      // CBZ.cityWildlifeHit is that species' cityHurtPlayer — it owns the
      // flinch, the blood, the pelt quality and (the part that matters) the
      // corpse timeline, so draining hp behind its back produced exactly the
      // frozen-carcass class of bug killVictim's comment describes.
      if (v && v.animal && CBZ.cityWildlifeHit && !v.dead) {
        _killHit.point = h.jaw;
        _killHit.dir.x = 0; _killHit.dir.z = 0;
        _killHit.from.x = ap ? ap.x : 0; _killHit.from.z = ap ? ap.z : 0;
        _killW.damage = dmg; _killW.by = h.attacker; _killW.cause = h.cause;
        try { CBZ.cityWildlifeHit(v, _killHit, _killW); } catch (e) {}
        _killW.by = null;
        return;
      }
      if (v && v.hp != null) v.hp -= dmg;
    }
  }

  // reusable hit/weapon records for the wildlife bus (killVictim runs inside a
  // hot resolve; a fresh object per kill would allocate in the worst place).
  const _killHit = { head: false, point: null, dir: { x: 0, y: 0.35, z: 0 }, from: { x: 0, z: 0 } };
  const _killW = { damage: 0, knock: 1.5, by: null, cause: "" };
  function vDirX(from, v) {
    const p = actorPos(v); if (!p) return 0;
    const dx = p.x - from.x, dz = p.z - from.z, l = Math.hypot(dx, dz) || 1;
    return dx / l;
  }
  function vDirZ(from, v) {
    const p = actorPos(v); if (!p) return 0;
    const dx = p.x - from.x, dz = p.z - from.z, l = Math.hypot(dx, dz) || 1;
    return dz / l;
  }

  // EVERY death in this file goes through the kill bus. We never toast one —
  // killfeed.js owns the only sanctioned HUD popup and it already knows how to
  // phrase "X was mauled by a great white shark".
  function killVictim(h) {
    const v = h.victim;
    const ap = actorPos(h.attacker);
    _killImp.fromX = ap ? ap.x : 0;
    _killImp.fromZ = ap ? ap.z : 0;
    _killImp.attacker = h.attacker;
    _killImp.byPlayer = false;
    if (h.isPlayer) {
      if (CBZ.cityKillPlayer && !(CBZ.player && CBZ.player.dead)) {
        try { CBZ.cityKillPlayer(h.cause, _killImp); } catch (e) {}
      }
      return;
    }
    if (v && v.animal) {
      // AN ANIMAL HAS A KILL CONTRACT TOO, AND THIS BRANCH USED TO SKIP IT.
      // The comment this replaces said "wildlife has no cityKillPed contract",
      // which was simply wrong: CBZ.cityWildlifeHit is the ONE damage/death bus
      // for wildlife and it owns the entire corpse timeline. Setting `dead` from
      // out here bypassed all of it — the body got no death physics, never
      // entered wildlife's `carcasses` list, was left with an UNDEFINED skinT
      // (a NaN countdown that can never reach zero) and therefore stood frozen
      // mid-pose in the world forever, unskinnable and undespawnable. Every
      // predator kill in the game produced one. Route the death properly and it
      // ragdolls, bleeds, becomes skinnable and eventually fades, for free.
      if (!v.dead) {
        const ap2 = actorPos(h.attacker);
        if (CBZ.cityWildlifeHit) {
          _killHit.point = h.jaw;
          _killHit.dir.x = ap2 ? (vDirX(ap2, v)) : 0;
          _killHit.dir.z = ap2 ? (vDirZ(ap2, v)) : 0;
          _killHit.from.x = ap2 ? ap2.x : 0; _killHit.from.z = ap2 ? ap2.z : 0;
          _killW.damage = 1e9; _killW.by = h.attacker; _killW.cause = h.cause;
          try { CBZ.cityWildlifeHit(v, _killHit, _killW); } catch (e) {}
          _killW.by = null;
        }
        if (!v.dead) {                       // no wildlife bus at all: the old path
          v.dead = true; if (v.hp != null) v.hp = 0;
          if (CBZ.cityLogDeath) {
            try { CBZ.cityLogDeath(actorName(v), h.cause, { by: actorName(h.attacker) }); } catch (e) {}
          }
        }
      }
      return;
    }
    if (v && CBZ.cityKillPed && !v.dead) {
      try { CBZ.cityKillPed(v, _killImp, h.cause); } catch (e) {}
    } else if (v && !v.dead) {
      v.dead = true; if (v.hp != null) v.hp = 0;
      if (CBZ.cityLogDeath) {
        try { CBZ.cityLogDeath(actorName(v), h.cause, { by: actorName(h.attacker) }); } catch (e) {}
      }
    }
  }

  function goreAtJaw(h, amount) {
    if (!CBZ.gore) return;
    // A NON-LETHAL HOLD DRAWS NO BLOOD. `nonLethal` means the grab is a
    // TAKEDOWN, not a mauling — a cop tackling you does not open a wound, so
    // the gore/bite-wound layer is skipped wholesale here rather than being
    // gated at each of the four call sites. (Trauma, hit-stop and shake are
    // deliberately KEPT: a tackle is still a physical event.)
    if (h.nonLethal) return;
    const _jaw = h.jaw;
    const ap = actorPos(h.attacker);
    let dx = 0, dz = 0;
    if (ap) { dx = _jaw.x - ap.x; dz = _jaw.z - ap.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    _goreDir.x = dx; _goreDir.y = 0.2; _goreDir.z = dz;
    _goreOpts.amount = amount;
    _goreOpts.medium = h.medium;
    _goreOpts.player = !!h.isPlayer;
    _goreOpts.sfx = true;
    _goreOpts.melee = "blade";     // teeth open you like a blade, not a club
    try { CBZ.gore(_jaw.x, _jaw.y, _jaw.z, _goreOpts); } catch (e) {}
    if (CBZ.bodyWound) {
      const target = h.isPlayer ? playerRagdollTarget() : h.victim;
      if (target) {
        _woundP.x = _jaw.x; _woundP.y = _jaw.y; _woundP.z = _jaw.z;
        _woundOpts.cal = 1.2 + amount * 0.4;
        _woundOpts.fromX = ap ? ap.x : 0; _woundOpts.fromZ = ap ? ap.z : 0;
        try { CBZ.bodyWound(target, _woundP, _woundOpts); } catch (e) {}
      }
    }
  }

  // CAMERA POSSESSION — we write CBZ.cineCam directly (the seam camera.js
  // yields to at the top of updateCamera), but we NEVER race the authored
  // director in city/cinematics.js. If a scene is already playing (the mob-boss
  // summons, the car ride — permadeath story beats), the seize simply runs
  // without a camera: two writers to cineCam in one frame produce a lens that
  // jitters between two shots and would corrupt the scene.
  //
  // The check cannot be a one-off at seize start, either: cinematics.js's
  // startScene() does not ask US anything, so a scene beginning mid-hold would
  // otherwise have both directors writing cineCam every frame. yieldCamera()
  // re-asks every frame and, the moment an authored scene takes over, we stop
  // writing FOR GOOD and never touch cc.active again — the scene owns the flag
  // from then on and clearing it on our way out would soft-lock it.
  //
  // (cc.active is false whenever we can take the lens at all — the guard above
  // returns otherwise — so there is no prior value worth restoring.)
  function possessCamera(h) {
    const cc = CBZ.cineCam;
    if (!cc) return false;
    if (CBZ.cineBusy) { try { if (CBZ.cineBusy()) return false; } catch (e) {} }
    if (cc.active) return false;
    cc.active = true; cc.snap = false;
    h.camOwned = true; h.camYield = false;
    return true;
  }
  // true once an authored scene has taken the lens: we are out, permanently.
  function yieldCamera(h) {
    if (h.camYield) return true;
    if (CBZ.cineBusy) {
      try { if (CBZ.cineBusy()) { h.camYield = true; h.camOwned = false; return true; } } catch (e) {}
    }
    return false;
  }
  function releaseCamera(h) {
    const owned = h.camOwned, yielded = h.camYield;
    h.camOwned = false;
    if (!owned || yielded) return;   // never clear a flag an authored scene owns
    const cc = CBZ.cineCam;
    if (cc) cc.active = false;
  }

  function driveCamera(h, dt) {
    if (!h.camOwned) return;
    if (yieldCamera(h)) return;
    const cc = CBZ.cineCam;
    const ap = actorPos(h.attacker);
    if (!cc || !ap) return;
    const _jaw = h.jaw;
    // orbit slowly around the jaw, looking straight down the attacker's throat.
    h.camPh += dt * (0.55 + h.thrash * 0.5);
    const s = actorScale(h.attacker) || 1;
    const r = 2.4 + s * 1.1;
    cc.x = _jaw.x + Math.cos(h.camPh) * r;
    cc.y = _jaw.y + 1.15 + Math.sin(h.camPh * 0.7) * 0.35;
    cc.z = _jaw.z + Math.sin(h.camPh) * r;
    cc.lx = ap.x + (_jaw.x - ap.x) * 0.55;
    cc.ly = ap.y + 0.6 * s;
    cc.lz = ap.z + (_jaw.z - ap.z) * 0.55;
  }

  function newHandle() {
    const h = {
      active: false, phase: "", t: 0, id: 0,
      attacker: null, victim: null, isPlayer: false,
      jawX: null, jawY: null, jawZ: null,
      // THIS handle's jaw anchor in world space. Allocated ONCE, here, and
      // never re-allocated (handles are pooled), so the hot path stays
      // allocation-free while concurrent seizes stop stealing each other's mouth.
      jaw: { x: 0, y: 0, z: 0 },
      dps: S_DPS, hold: S_HOLD, escape: S_ESCAPE, thrash: 1,
      // NON-LETHAL HOLDS (opts.nonLethal). A hold whose worst outcome is being
      // TAKEN, never killed: resolveSeize maps its "killed" branch to "taken",
      // goreAtJaw draws nothing, and killVictim is never reached. Defaults
      // FALSE, so every existing caller is byte-identical.
      nonLethal: false,
      medium: "air", cam: true, cause: "", style: "shake",
      onEnd: null, mode0: "", result: "",
      camOwned: false, camYield: false, camPh: 0,
      qteN: 0, qteState: "", qteAt: 0, qteOpenAt: 0, qteOpenT: 0, promptHTML: "",
      pulseT: 0, thrashPh: 0, pinned: false, atFn: null,
      dmgAcc: 0, dmgT: 0,
      baseRotX: 0, baseRotZ: 0,
      // ---- land-style state (the saw rhythms). The four original styles are
      //      continuous rotations driven by thrashPh; maul/worry/constrict are
      //      CYCLES with beats, so they need a seconds clock and a beat counter
      //      rather than a phase angle.
      styT: 0, styN: 0, styBeat: -1, swatSide: 1, beatHit: 0,
      // per-handle QTE shape. QTE_WINDOW/QTE_MAX are the DEFAULTS; a constrictor
      // wants more, smaller windows and a hunter that has been beaten before
      // wants a shorter one (see QTE_LEARN).
      qteWin: QTE_WINDOW, qteMax: QTE_MAX, panic: 0, qtePanicAt: -999,
      // the Euler order we swapped the attacker into for the hold, so endSeize
      // can put it back exactly (see thrashAttacker's ROLL note).
      rotOrder: "",
    };
    // the ragdoll pin callback, bound to THIS handle for the handle's whole
    // life. It closes over `h`, not over a module scratch, so a pooled reuse
    // keeps pointing at the same (correct) jaw and never needs clearing.
    h.atFn = function (out) { const j = h.jaw; out.x = j.x; out.y = j.y; out.z = j.z; };
    return h;
  }

  let seizeId = 0;

  function predatorSeize(attacker, victim, opts) {
    if (!on()) return null;
    if (!attacker || !victim || !attacker.group) return null;
    if (SEIZES.length >= MAX_SEIZES) return null;
    if (attacker.dead || attacker._seizing) return null;
    if (predatorSeized(victim)) return null;
    const isP = isPlayerActor(victim);
    if (isP) {
      if (!CBZ.player || CBZ.player.dead) return null;
      if (CBZ.game && (CBZ.game.invuln || 0) > 0) return null;
    } else if (victim.dead) return null;
    const ap = actorPos(attacker), vp = actorPos(victim);
    if (!ap || !vp) return null;
    opts = opts || {};

    const h = SEIZE_POOL.pop() || newHandle();
    h.active = true; h.phase = "wind"; h.t = 0; h.id = ++seizeId;
    h.attacker = attacker; h.victim = isP ? CBZ.player : victim; h.isPlayer = isP;
    h.jawX = opts.jaw ? opts.jaw.x : null;
    h.jawY = opts.jaw ? opts.jaw.y : null;
    h.jawZ = opts.jaw ? opts.jaw.z : null;
    h.dps = opts.dps != null ? opts.dps : S_DPS;
    h.hold = opts.hold != null ? opts.hold : S_HOLD;
    h.escape = opts.escape != null ? clamp(opts.escape, 0, 1) : S_ESCAPE;
    h.thrash = opts.thrash != null ? clamp(opts.thrash, 0, 2) : 1;
    h.medium = opts.medium || predatorMedium(ap.x, ap.y != null ? ap.y : 0, ap.z);
    h.cam = opts.cam != null ? !!opts.cam : isP;
    h.cause = opts.cause || ("mauled by a " + actorName(attacker));
    h.nonLethal = !!opts.nonLethal;
    h.style = opts.style || "shake";
    h.onEnd = typeof opts.onEnd === "function" ? opts.onEnd : null;
    h.mode0 = (CBZ.game && CBZ.game.mode) || "";
    h.result = ""; h.camOwned = false; h.camYield = false; h.camPh = Math.random() * 6.283;
    h.qteN = 0; h.qteState = ""; h.qteAt = 0; h.qteOpenAt = 0; h.qteOpenT = 0;
    h.pulseT = 0; h.thrashPh = 0; h.pinned = false;
    h.dmgAcc = 0; h.dmgT = 0.28;
    h.styT = 0; h.styN = 0; h.styBeat = -1; h.swatSide = 1; h.beatHit = 0;
    h.panic = 0; h.qtePanicAt = nowS();   // presses from BEFORE this grab are not panic
    h.qteMax = (opts.qteMax != null && opts.qteMax > 0) ? (opts.qteMax | 0) : QTE_MAX;
    // THE PREDATOR LEARNS YOUR TRICK. Every window this particular hunter has
    // already lost to you costs it a slice of the next one. Per-hunter, never
    // global: escaping a wolf must not make an unrelated bear faster. Floored,
    // because below QTE_FLOOR a timed press stops being a decision.
    const learn = attacker._predLearn || 0;
    h.qteWin = Math.max(QTE_FLOOR, QTE_WINDOW - learn * QTE_LEARN);
    h.baseRotX = attacker.group.rotation ? attacker.group.rotation.x : 0;
    h.baseRotZ = attacker.group.rotation ? attacker.group.rotation.z : 0;
    // ROLL/REAR NEED A BODY AXIS, AND 'XYZ' DOES NOT HAVE ONE.
    // Only the LAND/body styles take the order swap. `shake` and `drag` — the
    // two the shark actually uses — are left on whatever order they had, so
    // this change cannot move the shark's feel by a single frame.
    // THREE's default Euler order 'XYZ' composes R = Rx*Ry*Rz, so Rz acts in
    // MODEL space (with the nose at +X that is pitch — correct for a rear-up)
    // but Rx is applied AFTER the yaw, i.e. about the WORLD x axis. The death
    // roll asked for a spin about the animal's long axis and got a world tilt
    // whose meaning changed with heading — the reason the croc "roll" never
    // read as a roll. Under 'YXZ' the yaw is outermost, so rotation.x becomes
    // local ROLL and rotation.z stays local PITCH. We take that order for the
    // duration of the hold (predator.js owns the body while it has you) and
    // endSeize puts the original back, so no other writer is affected.
    if (attacker.group.rotation && BODY_AXIS_STYLE[h.style]) {
      h.rotOrder = attacker.group.rotation.order || "XYZ";
      try { attacker.group.rotation.order = "YXZ"; } catch (e) { h.rotOrder = ""; }
    } else h.rotOrder = "";
    h.promptHTML = CBZ.touchActionPrompt
      ? CBZ.touchActionPrompt(" ", "BREAK FREE", "[SPACE] BREAK FREE")
      : "[SPACE] BREAK FREE";

    attacker._seizing = h;
    if (!isP) victim._seizedBy = h;
    SEIZES.push(h);

    // A NON-FINITE JAW IS A POISONED ANCHOR — anchorVictim would write it
    // straight into CBZ.player.pos. Refuse the seize rather than launder a NaN
    // into the world (and produce the computeBoundingSphere noise downstream).
    if (!jawWorld(h, h.jaw)) { endSeize(h, "aborted"); return null; }

    // PHASE 1 STAGING — the tell. EVERYTHING goes quiet before the contact so
    // the contact lands into a hole in the mix. No damage yet: this beat is the
    // player's last chance to read what is happening. Note there is deliberately
    // NO stinger here — the "commit" cluster already fired when the hunter
    // entered `rush`; stacking one on top of the drop-out would fill in the
    // silence the drop-out exists to create.
    // ...but only when the player is IN it or NEAR it. A grab is the loudest
    // thing this file does — a drop-out in the mix, a trauma shake, a full dread
    // report — and with a food chain running across the map it now happens to
    // animals you will never see. Same law as the FSM's cue gate above, off the
    // same radius; a seize on YOU short-circuits before any distance is taken.
    if (isP || scoring(attacker, false)) {
      predatorDrop(S_WIND);
      predatorTrauma(0.30);
      predatorDread(attacker, 1, dreadOptsFor(attacker, 0, h.medium === "water"));
    }
    if (h.cam && isP) possessCamera(h);
    startDolly(h.jaw.x, h.jaw.y + 0.8, h.jaw.z, h.id);
    return h;
  }
  CBZ.predatorSeize = predatorSeize;

  function dreadOptsFor(src, dist, sub) {
    _dreadOpts.dist = dist; _dreadOpts.submerged = !!sub; _dreadOpts.name = "";
    return _dreadOpts;
  }

  function endSeize(h, result) {
    if (!h || !h.active) return;
    h.active = false; h.result = result;
    const a = h.attacker, v = h.victim;
    if (a && a._seizing === h) a._seizing = null;
    if (v && v._seizedBy === h) v._seizedBy = null;
    releaseCamera(h);
    // EVERY exit path puts the lens back: aborted, escaped, killed, released.
    // Leaving a live dolly behind is how the FOV used to survive the seize.
    if (dollyOwner === h.id) endDolly();
    h.qteState = "";
    // hand the attacker's pose back to whoever owns it (creature_combat's
    // restPose or the caller's own animator) — never leave it rolled over.
    if (a && a.group && a.group.rotation) {
      a.group.rotation.x = h.baseRotX;
      a.group.rotation.z = h.baseRotZ;
      // and put the Euler order back before anyone else reads x/z (see the
      // 'YXZ' note in predatorSeize). A stranded order would silently change
      // what gaitAnimate's bob means for the rest of this animal's life.
      if (h.rotOrder) { try { a.group.rotation.order = h.rotOrder; } catch (e) {} }
    }
    h.rotOrder = "";
    // release the limb/jaw layer too, or a bear walks away mid-rear.
    if (CBZ.predatorPose && a) { try { CBZ.predatorPose(a, h.style, 0, 0, 0); } catch (e) {} }
    // AND HAND THE STRIKE CLOCK BACK. creature_combat sets `_atkAnim` at the
    // strike frame; if that strike won a seize, predatorHunt stops calling
    // creatureFight and its endAttack never runs, so the flag stayed latched
    // for the rest of the animal's life — and every consumer that yields to it
    // (gaitAnimate's body sway, wildlife's pitch decay, the gait-ordering gate)
    // silently stayed switched off on any animal that had ever grabbed anyone.
    if (a && a._atkAnim != null && a._atkAnim >= 0) { a._atkAnim = -1; a._atkStyle = null; }
    if (h.pinned) unpinCorpse(h.isPlayer ? playerRagdollTarget() : v);
    h.pinned = false;
    const i = SEIZES.indexOf(h);
    if (i >= 0) SEIZES.splice(i, 1);
    const cb = h.onEnd; h.onEnd = null;
    h.attacker = null; h.victim = null;
    if (SEIZE_POOL.length < MAX_SEIZES + 2) SEIZE_POOL.push(h);
    if (cb) { try { cb(result); } catch (e) {} }
  }

  function predatorRelease(what, reason) {
    if (!what) return;
    if (what.active !== undefined && what.phase !== undefined && SEIZES.indexOf(what) >= 0) {
      endSeize(what, reason || "released");
      return;
    }
    for (let i = SEIZES.length - 1; i >= 0; i--) {
      const h = SEIZES[i];
      if (h.victim === what || (isPlayerActor(what) && h.isPlayer) || h.attacker === what) {
        endSeize(h, reason || "released");
      }
    }
  }
  CBZ.predatorRelease = predatorRelease;

  // ============================================================
  //  §C. THE SEIZE STYLE VOCABULARY
  //
  //  The first cut of this file had four styles and all four were ocean-shaped:
  //  whole-group rotations at a single frequency. A bear rearing and slamming, a
  //  wolf worrying a limb backwards off your feet, a cat going STILL on your
  //  throat and a constrictor's tightening pulse are none of them a sine wave,
  //  and a shark's roll is not a bear's rhythm.
  //
  //  What every land style has in common is that it is a CYCLE WITH BEATS, not a
  //  continuous oscillation — and the beat is the horror. You can hear the next
  //  slam coming and you cannot stop it. So the land styles run off `h.styT`
  //  (seconds inside one cycle) and `h.styN` (which cycle), raise `h.beatHit`
  //  when a beat lands, and let seizeTick turn that into pain and blood. The
  //  1/sqrt(scale) law survives everywhere: big things are SLOWER, which is most
  //  of what makes a grizzly read as a grizzly instead of a large dog.
  //
  //  The limb/jaw layer is predator_anim.js's `CBZ.predatorPose`. It is optional
  //  by construction: every style below is authored to read correctly from the
  //  group transform ALONE, so a missing or flag-off predator_anim.js costs
  //  detail and never correctness.
  // ============================================================

  // which styles need a model-local roll/pitch axis (and therefore the scoped
  // 'YXZ' Euler swap). `shake`/`drag` — the shark's two — deliberately excluded.
  const BODY_AXIS_STYLE = { roll: 1, maul: 1, worry: 1, pin: 1, constrict: 1 };
  const MAUL_CYCLE = 0.97;     // s at scale 1: rear (0.57) -> slam (0.13) -> worry
  const MAUL_REAR_END = 0.57, MAUL_SLAM_END = 0.70;
  const WORRY_CYCLE = 0.90;    // s between release-and-re-bite (dog/wolf)
  const WORRY_HZ = 8.0;        // 7-9 Hz head/body yaw, the researched band
  const CONSTRICT_CYCLE = 1.15; // s per squeeze pulse
  // fraction of the hold at which the cat's ONE hard yank lands. It sits at the
  // very end deliberately: predator_anim's `pin` pose fires its own yank layer
  // above f > 0.88 off the SAME number we pass it, so body and limbs move
  // together, and a yank immediately before the resolve is the last thing you
  // see rather than a beat you sit through.
  const PIN_YANK_A = 0.88, PIN_YANK_B = 0.99;

  function smooth(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)); }

  // drive the optional limb/jaw layer. Guarded twice: predator_anim.js may not
  // be loaded at all, and it may throw on a rig it cannot discover.
  function poseAttacker(h, p, k, dt) {
    if (!CBZ.predatorPose) return;
    try { CBZ.predatorPose(h.attacker, h.style, p, k, dt); } catch (e) {}
  }

  // ---- the thrash. Big things thrash SLOWER — that 1/sqrt(scale) is what
  //      makes a megalodon read as a megalodon instead of a fast fish.
  function thrashAttacker(h, dt) {
    const g = h.attacker && h.attacker.group;
    if (!g || !g.rotation) return;
    const s = Math.max(0.35, actorScale(h.attacker) || 1);
    const sq = Math.sqrt(s);
    const F = (22 - 8 * clamp(s / 4, 0, 1)) / sq;
    const A = (0.25 + 0.20 * h.thrash) / sq;

    // ---- MAUL — the bear. An asymmetric SAW, never a sine: a long slow rear
    //      (you watch it stand up over you), a fast slam, then a short press and
    //      worry, then it does it again. The asymmetry is the whole point: a
    //      symmetric shake is a fish, a saw is a mammal deciding to kill you.
    if (h.style === "maul") {
      const per = MAUL_CYCLE * sq;
      h.styT += dt;
      if (h.styT >= per) { h.styT -= per; h.styN++; h.swatSide = -h.swatSide; h.styBeat = -1; }
      const u = h.styT / per;
      let rear;
      if (u < MAUL_REAR_END) {
        rear = smooth(u / MAUL_REAR_END) * 0.88;      // the slow lift
      } else if (u < MAUL_SLAM_END) {
        const sp = (u - MAUL_REAR_END) / (MAUL_SLAM_END - MAUL_REAR_END);
        rear = 0.88 * (1 - sp * sp);                  // and the fast fall
        // THE SLAM LANDS. Once per cycle, latched on styBeat so a long frame
        // cannot fire it twice and a short one cannot skip it.
        if (h.styBeat !== h.styN && sp > 0.55) {
          h.styBeat = h.styN; h.beatHit = 1;
          predatorTrauma(0.8);
          if (CBZ.doHitstop) { try { CBZ.doHitstop(0.05); } catch (e) {} }
          if (CBZ.sfx) { try { CBZ.sfx("punch", _sfxOpts); } catch (e) {} }
        }
      } else {
        const wp = (u - MAUL_SLAM_END) / (1 - MAUL_SLAM_END);
        rear = 0.10 * (1 - wp);                       // pressed down, worrying
      }
      // rotation.z is model-local PITCH with the nose at +X: positive = reared.
      g.rotation.z = h.baseRotZ + rear * 1.05 * h.thrash;
      g.rotation.x = h.baseRotX + Math.sin(h.styT * 9) * 0.03 * h.thrash;
      // THE POSE LAYER GETS THE RAW CYCLE FRACTION, never a remapped one.
      // predator_anim splits the same cycle itself (0.55 / 0.67 against our
      // 0.57 / 0.70); handing it a pre-warped phase would slide the limbs out
      // of step with the body they are attached to. One clock, two readers.
      poseAttacker(h, u, h.thrash, dt);
      return;
    }

    // ---- WORRY — the dog and the wolf. It does not lift you, it DRAGS you off
    //      your feet: body low, driving backward, head yawing hard. Then it lets
    //      go and bites again somewhere worse. Small fast animals only; the mass
    //      threshold that picks this over `maul` lives in predatorKit.
    if (h.style === "worry") {
      const per = WORRY_CYCLE * sq;
      h.styT += dt;
      if (h.styT >= per) { h.styT -= per; h.styN++; h.beatHit = 1; }  // the re-bite
      const u = h.styT / per;
      h.thrashPh += dt * (WORRY_HZ / sq) * 6.283;
      // body roll (local x under the YXZ swap) is the shoulder-driven yaw you
      // see from outside; the head's own thrash is predator_anim's job.
      g.rotation.x = h.baseRotX + Math.sin(h.thrashPh) * A * 0.9 * h.thrash;
      g.rotation.z = h.baseRotZ - 0.12 * h.thrash;    // head down, hindquarters up
      // BACKWARD, not forward — it is taking you somewhere. Integrated, so it
      // carries dt (the bug the shake branch's JUDDER_V comment records).
      const hd = h.attacker.heading != null ? h.attacker.heading : -g.rotation.y;
      const back = (0.9 + Math.sin(h.styT * 3.1) * 0.45) * h.thrash * dt;
      g.position.x -= Math.cos(hd) * back;
      g.position.z -= Math.sin(hd) * back;
      poseAttacker(h, u, h.thrash, dt);
      return;
    }

    // ---- PIN — the big cat. THE BODY STOPS MOVING. That is the scare, and it
    //      is the exact opposite of every other style here: no saw, no sine you
    //      can read, just a held throat and a micro-shudder that says the thing
    //      on top of you is still alive. Then, once, it yanks.
    if (h.style === "pin") {
      h.thrashPh += dt * (26 / sq);
      const hf = h.hold > 0.1 ? (h.t / h.hold) : 0;
      let yank = 0;
      if (hf > PIN_YANK_A && hf < PIN_YANK_B) {
        yank = Math.sin((hf - PIN_YANK_A) / (PIN_YANK_B - PIN_YANK_A) * Math.PI);
        if (h.styBeat < 0) { h.styBeat = 0; h.beatHit = 1; predatorTrauma(0.65); }
      }
      g.rotation.x = h.baseRotX + Math.sin(h.thrashPh) * 0.014 * h.thrash + yank * 0.10;
      g.rotation.z = h.baseRotZ + 0.10 * h.thrash - yank * 0.30;
      // CLAMPED. thrashAttacker runs BEFORE the `h.t >= h.hold` resolve check,
      // so on the last frame hf slips just past 1; predator_anim takes frac(p),
      // which wraps it to ~0.01 and snaps the pose from full yank back to the
      // resting pin for one frame immediately before the kill.
      poseAttacker(h, hf > 1 ? 1 : hf, h.thrash, dt);
      return;
    }

    // ---- CONSTRICT — the snake. NO thrash at all; the horror is that nothing
    //      is happening and you are dying anyway. It tightens in slow pulses and
    //      each one costs more than the last (seizeTick's rising-step damage).
    //      Real constriction kills by circulatory arrest in SECONDS, not by slow
    //      suffocation — so this must read fast and escalating, not as a drain.
    if (h.style === "constrict") {
      const per = CONSTRICT_CYCLE * sq;
      h.styT += dt;
      if (h.styT >= per) { h.styT -= per; h.styN++; h.beatHit = 1; predatorTrauma(0.35); }
      const u = h.styT / per;
      const tight = smooth(u < 0.5 ? u * 2 : 1);
      g.rotation.z = h.baseRotZ + tight * 0.06 * h.thrash;
      // the pose layer gets the raw pulse fraction (it runs its own squeeze
      // wave off it) and the ESCALATION rides in the weight: each pulse coils a
      // little tighter than the last, which is the whole style.
      poseAttacker(h, u, clamp(0.45 + h.styN * 0.14, 0, 1) * h.thrash, dt);
      return;
    }

    h.thrashPh += dt * F;
    if (h.style === "roll") {
      // THE CROCODILIAN DEATH ROLL. ~1.6 Hz about the animal's own long axis,
      // driven purely by angular momentum with the limbs pressed flat — the
      // sourced biomechanics number, and the reason big crocs dismember while
      // small ones only drown. It used to be written to rotation.z, which under
      // the default 'XYZ' order is model PITCH, so the "roll" was a nose-over-
      // tail tumble; predatorSeize's scoped 'YXZ' swap is what finally makes
      // rotation.x the long axis this was always supposed to spin about.
      g.rotation.x = h.baseRotX + h.thrashPh * 0.55 * h.thrash;
      g.rotation.z = h.baseRotZ + Math.sin(h.thrashPh * 0.4) * A * 0.35;
      poseAttacker(h, (h.thrashPh * 0.55 / 6.283) % 1, h.thrash, dt);
    } else if (h.style === "drag") {
      g.rotation.z = h.baseRotZ + Math.sin(h.thrashPh * 0.5) * A * 0.4;
      const hd = h.attacker.heading != null ? h.attacker.heading : -g.rotation.y;
      // LOW-frequency speed modulation. Constant velocity reads as a bug;
      // irregular speed reads as something working against resistance.
      const spd = 1.4 * (0.72 + 0.38 * Math.sin(h.thrashPh * 0.31)) * h.thrash;
      g.position.x += Math.cos(hd) * spd * dt;
      g.position.z += Math.sin(hd) * spd * dt;
      poseAttacker(h, (h.thrashPh * 0.1) % 1, h.thrash, dt);
    } else {   // "shake"
      g.rotation.z = h.baseRotZ + Math.sin(h.thrashPh) * A;
      g.rotation.x = h.baseRotX + Math.sin(h.thrashPh * 0.61) * A * 0.45;
      const hd = h.attacker.heading != null ? h.attacker.heading : -g.rotation.y;
      // INTEGRATED, so it must carry dt. This is a per-frame += on position, not
      // a set: without dt the attacker drifted twice as far at 120fps as at 60
      // (the "drag" branch above already had this right). JUDDER_V is the old
      // per-frame 0.09 expressed as the u/s it was at 60fps, so the feel at
      // 60fps is byte-for-byte what it was.
      const jud = Math.sin(h.thrashPh * 1.7) * JUDDER_V * h.thrash * dt;
      g.position.x += Math.cos(hd) * jud;
      g.position.z += Math.sin(hd) * jud;
      // the gape. For a swimmer this lands on CBZ.swimJaw exactly as before —
      // predatorPose delegates aquatic rigs straight back to it — so the shark's
      // mouth keeps working with no change on its side.
      poseAttacker(h, (h.thrashPh * 0.16) % 1, h.thrash, dt);
    }
  }

  // ---- slave the victim to the jaw ---------------------------------------
  // A HELD BODY HAS A SOLVER, AND WHICH ONE DEPENDS ON WHAT IT IS.
  // city/ragdoll.js is the HUMANOID one and refuses anything without a `char`,
  // so before today every animal a predator killed and kept was carried by a
  // raw position write — the corpse slid through the air perfectly rigid, in
  // the one shot the camera is guaranteed to be looking at. Ask the human
  // solver first (identical behaviour for every existing caller), and only then
  // systems/quadruped_ragdoll.js, which is the animal sibling.
  function pinCorpse(v, atFn, until) {
    if (!v) return false;
    if (CBZ.ragdollPin) {
      try { if (CBZ.ragdollPin(v, { point: "torso", at: atFn, until: until, stiff: 1 })) return true; } catch (e) {}
    }
    if (v.animal && CBZ.quadRagdollPin) {
      try { if (CBZ.quadRagdollPin(v, { point: "torso", at: atFn, until: until, stiff: 1 })) return true; } catch (e) {}
    }
    return false;
  }
  function unpinCorpse(v) {
    if (!v) return;
    if (CBZ.ragdollUnpin) { try { CBZ.ragdollUnpin(v); } catch (e) {} }
    if (v.animal && CBZ.quadRagdollUnpin) { try { CBZ.quadRagdollUnpin(v); } catch (e) {} }
  }

  function anchorVictim(h) {
    const _jaw = h.jaw;
    if (h.isPlayer) {
      const P = CBZ.player;
      if (!P || !P.pos) return;
      P.pos.x = _jaw.x; P.pos.z = _jaw.z;
      P.pos.y = _jaw.y - 0.85;
      P.vy = 0; P.grounded = true; P.speed = 0;
      if (P._phys) { P._phys.vx = P._phys.vz = 0; P._phys.vy = 0; }
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      }
      return;
    }
    const v = h.victim;
    if (!v) return;
    if (v.dead) {
      // A CORPSE IS NOT FURNITURE. Pin the torso to the jaw and let the verlet
      // body whip off it — this is the whole reason ragdollPin exists.
      if (!h.pinned) h.pinned = pinCorpse(v, h.atFn, 2.2);
      if (h.pinned) return;   // the ragdoll owns the transform now
    }
    const p = actorPos(v);
    if (p) { p.x = _jaw.x; p.y = _jaw.y - 0.4; p.z = _jaw.z; }
    if (v.group && v.group.position !== p) v.group.position.set(_jaw.x, _jaw.y - 0.4, _jaw.z);
  }

  // KNOCK THE PLAYER BACK — and NOT ballistically if they are swimming.
  //
  // systems/physics.js's `_phys.air` branch integrates a ballistic arc against
  // groundAt() (in open water: the SEABED) and is not gated on player._swim,
  // while city/swim.js (onUpdate 45.8) is writing P.pos from its own buoyancy
  // state in the same frame. Handing a swimmer to that path dragged them tens
  // of metres DOWN to the seabed and "landed" them there. So a swimmer gets a
  // horizontal shove through the water and swim.js keeps ownership of Y — its
  // own wall resolve and current still apply on its next tick.
  // Returns true when the ballistic (land) path was used.
  function knockPlayer(dx, dz, spd, vy, spin) {
    const P = CBZ.player;
    if (!P || !P.pos) return false;
    if (playerSubmerged()) {
      const push = spd * 0.26;                 // metres of shove, not a launch
      P.pos.x += dx * push; P.pos.z += dz * push;
      const ph = P._phys;
      if (ph) { ph.air = false; ph.vx = 0; ph.vz = 0; ph.vy = 0; }
      P.grounded = false;
      if (CBZ.doHitstop) { try { CBZ.doHitstop(0.05); } catch (e) {} }
      predatorTrauma(0.35);
      return false;
    }
    const ph = P._phys = P._phys || {};
    ph.air = true; ph.down = 0; ph.kx = ph.kz = 0;
    ph.vx = dx * spd; ph.vz = dz * spd; ph.vy = vy;
    if (spin != null) ph.spin = spin;
    P.grounded = false;
    return true;
  }

  function flingClear(h) {
    const ap = actorPos(h.attacker);
    if (h.isPlayer) {
      const P = CBZ.player;
      if (!P || !P.pos) return;
      let dx = 0, dz = 0;
      if (ap) { dx = P.pos.x - ap.x; dz = P.pos.z - ap.z; }
      let l = Math.hypot(dx, dz);
      if (l < 0.01) { dx = 1; dz = 0; l = 1; }
      dx /= l; dz /= l;
      if (knockPlayer(dx, dz, 9.5, 6.2, (Math.random() < 0.5 ? -1 : 1) * 4.2)) P.vy = 0;
      if (CBZ.game) CBZ.game.invuln = Math.max(CBZ.game.invuln || 0, 1.2);
      return;
    }
    const v = h.victim;
    if (v && CBZ.cityRagdoll && !v.animal) {
      const _jaw = h.jaw;
      _woundP.x = _jaw.x; _woundP.y = _jaw.y; _woundP.z = _jaw.z;
      _goreDir.x = 0; _goreDir.y = 1; _goreDir.z = 0;
      try { CBZ.cityRagdoll(v, _woundP, _goreDir, 9); } catch (e) {}
    }
  }

  function seizeTick(dt) {
    if (!SEIZES.length) return;
    if (!on()) { for (let i = SEIZES.length - 1; i >= 0; i--) endSeize(SEIZES[i], "aborted"); return; }
    for (let i = SEIZES.length - 1; i >= 0; i--) {
      const h = SEIZES[i];
      const a = h.attacker, v = h.victim;

      // ---- abort conditions. A seize that survives its own preconditions is
      //      how you get a corpse dragged through the terrain forever.
      //      (the game.state / mode checks live in cameraPost, which is an
      //      onAlways and therefore still runs when this updater does not —
      //      here they were unreachable dead code, see cameraPost.)
      if (!a || !a.group || a.dead || !v) { endSeize(h, "aborted"); continue; }
      if (h.isPlayer && CBZ.player && CBZ.player.dead && h.phase !== "resolve") { resolveSeize(h, "killed", true); continue; }
      const ap = actorPos(a), vp = actorPos(v);
      if (!ap || !vp) { endSeize(h, "aborted"); continue; }
      if (h.phase !== "wind") {
        const dd = Math.hypot(vp.x - ap.x, vp.z - ap.z);
        if (dd > SEIZE_ABORT_D) { endSeize(h, "aborted"); continue; }
      }

      h.t += dt;
      // a poisoned jaw would be written into the player's position — bail out
      // of the seize rather than launder a NaN into the world.
      if (!jawWorld(h, h.jaw)) { endSeize(h, "aborted"); continue; }
      driveCamera(h, dt);
      // the seize keeps the bus pinned at maximum for as long as it lasts
      predatorDread(a, 1, dreadOptsFor(a, 0, h.medium === "water"));

      if (h.phase === "wind") {
        // whip the lens toward the attacker; no damage yet.
        if (h.t >= S_WIND) { h.phase = "strike"; h.t = 0; enterStrike(h); }
        continue;
      }

      if (h.phase === "strike") {
        thrashAttacker(h, dt);
        anchorVictim(h);
        if (h.t >= S_STRIKE) { h.phase = "hold"; h.t = 0; scheduleQTE(h); }
        continue;
      }

      if (h.phase === "hold") {
        thrashAttacker(h, dt);
        anchorVictim(h);
        // damage lands in CHUNKS, not per frame. cityHurtPlayer is an EVENT
        // sink (it stamps the killer, flashes, plays a hurt cue, wakes armor) —
        // calling it sixty times a second turns a maul into a strobing siren
        // and buries the killfeed's actual cause. One bite every 0.28s reads
        // like teeth; sixty tiny bites read like a bug.
        //
        // TWO MODULATIONS ON TOP OF THE FLAT RATE:
        //  * RISING STEPS (constrict). A constrictor does not deal a constant
        //    number: each squeeze is worse than the one before it, because it
        //    only ever tightens. That escalation is the entire reason the style
        //    is frightening rather than a slow bar.
        //  * PANIC (all styles). Thrashing is what tells a predator you are
        //    prey — real shark-attack literature is explicit that a victim's
        //    panic escalates the attack. So mashing the break-free key OUTSIDE
        //    its window is not free: it feeds the thing holding you. This is
        //    also what stops the single timed press degenerating into a mash.
        const step = (h.style === "constrict") ? (0.5 + h.styN * 0.55) : 1;
        h.dmgAcc += h.dps * dt * step * (1 + clamp(h.panic * 0.10, 0, 0.4));
        h.dmgT -= dt;
        // a beat (the bear's slam, the wolf's re-bite, the snake's squeeze, the
        // cat's one yank) lands the pain ON the beat instead of on a timer, plus
        // its own bite of extra. Pain that arrives off-rhythm reads as a leak.
        if (h.beatHit) {
          h.beatHit = 0; h.dmgT = 0.28;
          hurtVictim(h, h.dmgAcc + h.dps * 0.35); h.dmgAcc = 0;
          goreAtJaw(h, 0.85 * (CBZ.qScale ? CBZ.qScale(0.6, 1) : 1));
          if (CBZ.sfx) { try { CBZ.sfx("hit", _sfxTick); } catch (e) {} }
          h.pulseT = 0.45;   // don't double up with the ambient wet beat below
        } else if (h.dmgT <= 0) { h.dmgT = 0.28; hurtVictim(h, h.dmgAcc); h.dmgAcc = 0; }
        if (h.isPlayer && CBZ.player && CBZ.player.dead) { resolveSeize(h, "killed", true); continue; }
        // `v.dead` is now a real outcome mid-hold: hurtVictim routes an animal's
        // damage through its own bus, and that bus can kill it. Resolving on
        // `hp <= 0 && !dead` alone would MISS that and grind on to the hold
        // timeout with a corpse in its mouth. Pass alreadyDead so killVictim is
        // not asked to kill it a second time.
        if (!h.isPlayer && (v.dead || (v.hp != null && v.hp <= 0))) { resolveSeize(h, "killed", !!v.dead); continue; }

        // a wet beat every ~0.45s: sound, a blood pulse, a fresh wound. The
        // hold has to keep COSTING something or it reads as a cutscene.
        h.pulseT -= dt;
        if (h.pulseT <= 0) {
          h.pulseT = 0.45;
          if (CBZ.sfx) { try { CBZ.sfx("hit", _sfxTick); } catch (e) {} }
          goreAtJaw(h, 0.55 * (CBZ.qScale ? CBZ.qScale(0.6, 1) : 1));
          predatorTrauma(0.30);
        }

        tickQTE(h, dt);
        if (!h.active) continue;

        if (h.t >= h.hold) { resolveSeize(h, null, false); continue; }
        continue;
      }

      if (h.phase === "carry") {
        // §I: THE CORPSE RIDES IN THE JAWS. The kill used to create the ragdoll
        // pin and destroy it in the same call (resolveSeize pinned, then
        // endSeize unpinned one line later), so the pin lived zero frames and
        // the whole "carried and thrashed before it is dropped" beat did not
        // exist. It exists here: the handle stays alive for CARRY_T, the pin
        // keeps tracking the jaw through h.atFn, and the attacker keeps
        // working. Player victims never reach this phase — the death cam owns
        // the lens the instant they die.
        thrashAttacker(h, dt);
        anchorVictim(h);
        if (h.t >= CARRY_T) { endSeize(h, "killed"); }
        continue;
      }
    }
  }

  function enterStrike(h) {
    if (CBZ.doHitstop) { try { CBZ.doHitstop(0.07); } catch (e) {} }
    predatorStinger("impact");
    predatorTrauma(0.85);
    if (CBZ.shake) { try { CBZ.shake(1.2); } catch (e) {} }
    if (jawWorld(h, h.jaw)) goreAtJaw(h, 1.4);
  }

  // §D: ONE well-telegraphed timed press, generous window, two at most.
  function scheduleQTE(h) {
    if (!h.isPlayer) { h.qteState = ""; return; }
    h.qteN = 0;
    h.qteAt = h.hold * 0.30;      // first window
    h.qteState = "wait";
  }

  function tickQTE(h, dt) {
    if (!h.isPlayer) return;
    // PANIC ACCOUNTING. A press while no window is open is not a free retry —
    // it is thrashing, and the hold branch charges you for it. Edge-triggered
    // off the same stamp the real check uses, so one press counts once.
    // ...but NOT during the tell. The telegraph exists to make you want to
    // press; charging for the response it is engineered to provoke punishes
    // reading it correctly, which is the opposite of the lesson. Panic is a
    // press with no cue on screen at all.
    if (CFG.PREDATOR_PANIC !== false && h.qteState !== "open" && h.qteState !== "tell"
        && pressStamp > h.qtePanicAt) {
      h.qtePanicAt = pressStamp; h.panic++;
    }
    if (h.qteState === "wait") {
      if (h.t >= h.qteAt - QTE_TELL) { h.qteState = "tell"; }
      return;
    }
    if (h.qteState === "tell") {
      if (h.t >= h.qteAt) {
        h.qteState = "open";
        h.qteOpenAt = nowS();   // real-time stamp: only a press AFTER this counts
        h.qteOpenT = h.t;       // phase clock: hit-stop must not shrink the window
        // The visible tell owns this timing window. A generic metal hit here
        // was an out-of-world UI instruction masquerading as physical sound.
      }
      return;
    }
    if (h.qteState === "open") {
      // strictly AFTER the open: CBZ.now is stamped once per frame, so every
      // press inside a frame shares its timestamp — `>=` would let a press
      // that happened BEFORE the window opened pass it for free.
      if (pressStamp > h.qteOpenAt) { resolveSeize(h, "escaped", false); return; }
      if (h.t - h.qteOpenT >= h.qteWin) {
        h.qteN++;
        if (h.qteN >= h.qteMax || h.t + QTE_TELL + h.qteWin + 0.2 >= h.hold) {
          // missed the last one. That is the whole decision, and it is over.
          resolveSeize(h, "killed", false);
        } else {
          h.qteState = "wait";
          h.qteAt = h.t + 0.55 + QTE_TELL;
        }
      }
    }
  }

  function resolveSeize(h, forced, alreadyDead) {
    // resolve can be reached from an early abort guard, before this frame's
    // jaw solve — re-solve it so the final gore/ragdoll pin never lands on a
    // stale anchor. A non-finite answer means the attacker's transform is
    // broken: end the hold rather than stamp gore at NaN.
    if (!jawWorld(h, h.jaw)) { endSeize(h, "aborted"); return; }
    let result = forced;
    if (!result) {
      // non-player victims (and a player whose windows never ran) fall back to
      // the probability roll — runtime FX/behaviour may use Math.random.
      result = (Math.random() < h.escape) ? "escaped" : "killed";
    }
    // A NON-LETHAL HOLD CANNOT KILL, BY CONSTRUCTION — not by the caller
    // remembering to check. Every road into the lethal branch (the hold timing
    // out, the probability roll, a missed final window) lands here first, so
    // "killed" is rewritten to "taken" BEFORE killVictim is anywhere in reach.
    // "taken" is a real third outcome, reported to onEnd, and it is what an
    // arrest tackle waits for. The one path that still says "killed" on a
    // nonLethal hold is `alreadyDead` — the victim died of something else
    // mid-hold, and lying about that would hide a real death from the bus.
    if (h.nonLethal && result === "killed" && !alreadyDead) {
      h.phase = "resolve";
      forceDisengage(h.attacker, 0.6);
      if (dread > 0.4) dread = 0.4;
      endSeize(h, "taken");
      return;
    }
    h.phase = "resolve";
    if (result === "escaped") {
      // IT REMEMBERS. A player who beats the same window on the same animal
      // forever has found a tax, not a mechanic — Alien: Isolation's answer is
      // that the predator's repertoire grows with your habits. Ours is the
      // cheap version: this hunter's next window is a little shorter, floored
      // at QTE_FLOOR so it can never become a reflex lottery. Only a window the
      // PLAYER actually beat counts; a probability roll teaches nothing.
      if (h.isPlayer && forced === "escaped" && h.attacker) {
        h.attacker._predLearn = (h.attacker._predLearn || 0) + 1;
      }
      flingClear(h);
      predatorStinger("impact");
      predatorTrauma(0.55);
      if (CBZ.creatureFlinch) { try { CBZ.creatureFlinch(h.attacker); } catch (e) {} }
      // the attacker is REPELLED, not merely finished: force it out of the
      // hunt so it cannot instantly re-grab. It comes back harder, later.
      forceDisengage(h.attacker, 0.45);
      if (dread > 0.4) dread = 0.4;
      endSeize(h, "escaped");
      return;
    }
    // KILLED
    if (!alreadyDead) killVictim(h);
    goreAtJaw(h, 1.8);
    predatorTrauma(0.7);
    if (h.isPlayer) {
      // the death cam owns the lens from here; get out of its way immediately
      // (camera.js gives cineCam priority over cityCam.death).
      releaseCamera(h);
      endSeize(h, "killed");
      return;
    }
    // NPC / ANIMAL CORPSE: it does NOT get cleaned up on the kill frame. The
    // handle stays alive in `carry` for CARRY_T with the torso pinned to the
    // jaw, the attacker still thrashing, and only then is it dropped
    // (endSeize unpins). Instant cleanup is what makes violence read as
    // inconsequential (§I), and it also meant CBZ.ragdollPin's entire
    // implementation was never exercised: the pin was created and destroyed in
    // the same call and lived exactly zero frames.
    const target = h.victim;
    if (target) h.pinned = pinCorpse(target, h.atFn, CARRY_T + 0.3);
    h.phase = "carry"; h.t = 0;
  }

  // ============================================================
  //  §A. predatorHunt — THE GENERIC STALKING FSM.
  //
  //  cruise -> scent -> circle -> {vanish | bump | rush} -> seize -> disengage
  //
  //  It knows nothing about water, land, air or species. It decides WHERE the
  //  hunter wants to be and how scared you should be; opts.move decides how a
  //  body of that kind actually gets there. That seam is the entire reason a
  //  shark and a big cat can share this file.
  // ============================================================

  const EMPTY_OPTS = {};

  function huntScratch(hunter) {
    let h = hunter._hunt;
    if (h) return h;
    h = hunter._hunt = {
      st: "cruise", prev: "", t: 0,
      menace: 0, cool: 0, commits: 0,
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      circleDur: 0, vanishDur: 0, scentFake: false,
      dropped: false, seizeWait: false,
      chumT: 0, chumX: 0, chumZ: 0, chumHit: false,
      losT: 0, los: true,
      state0: null, dive: 0,
      fightOpts: null, seizeOpts: null, userOnHit: null, userMove: null,
      // §E ambush: seconds spent motionless, and the "I am not moving" hint the
      // caller's own idle/wander code reads so it does not walk the hunter out
      // of its cover while we are pretending it is hidden.
      stillT: 0, still: 0,
      // §J shrinking investigate passes: how many circles this approach has made
      // without committing. Each pass orbits TIGHTER, and after PASS_MAX it
      // leaves — a searcher that never gives up is a treadmill, not a threat.
      passes: 0,
      // set by the fight onHit when an archetype that does not grab (ram / gore /
      // stomp) actually connects, so its rush can end on the impact instead of
      // grinding on for RUSH_TIMEOUT.
      struck: false,
      // §D pack: which bearing slot around the target this hunter owns.
      packSlot: -1, packT: -999, packRole: "commit",
    };
    return h;
  }

  function setState(hunter, h, st, opts) {
    if (h.st === st) return;
    h.prev = h.st; h.st = st; h.t = 0;
    // markers.js's cityTargetsPlayer() reads exactly these two strings — the
    // HUD chevron, minimap blip and full map light up with no new code.
    if (st === "scent" || st === "circle" || st === "vanish") hunter.state = "stalk";
    else if (st === "bump" || st === "rush" || st === "seize") hunter.state = "charge";
    else if (st === "disengage") hunter.state = "flee";
    else if (st === "cruise") hunter.state = h.state0 || "wander";
    if (opts && typeof opts.onState === "function") {
      try { opts.onState(st, h.prev); } catch (e) {}
    }
  }

  function defaultMove(hunter, wantH, speed, dt) {
    const g = hunter.group;
    if (!g) return;
    const cur = hunter.heading != null ? hunter.heading : -(g.rotation ? g.rotation.y : 0);
    const nh = turnToward(cur, wantH, D_TURN * dt);
    hunter.heading = nh;
    g.position.x += Math.cos(nh) * speed * dt;
    g.position.z += Math.sin(nh) * speed * dt;
    if (CBZ.floorAt) {
      const fy = CBZ.floorAt(g.position.x, g.position.z);
      if (typeof fy === "number" && isFinite(fy)) g.position.y = fy;
    }
    if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(hunter, nh); } catch (e) { if (g.rotation) g.rotation.y = -nh; } }
    else if (g.rotation) g.rotation.y = -nh;
  }

  // throttled line-of-sight for the menace gauge. Underwater LOS through
  // building colliders is meaningless, so the water medium simply says "yes".
  const _ray = (THREE && THREE.Raycaster) ? new THREE.Raycaster() : null;
  const _rayO = THREE ? new THREE.Vector3() : null;
  const _rayD = THREE ? new THREE.Vector3() : null;
  function checkLOS(hunter, hp, tp, medium) {
    if (CFG.PREDATOR_LOS === false || medium === "water") return true;
    if (!_ray || !CBZ.losRaycast || !CBZ.losBlockers) return true;
    try {
      const dx = tp.x - hp.x, dy = (tp.y != null ? tp.y : 0) + 1.2 - ((hp.y != null ? hp.y : 0) + 0.6), dz = tp.z - hp.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      _rayO.set(hp.x, (hp.y != null ? hp.y : 0) + 0.6, hp.z);
      _rayD.set(dx / l, dy / l, dz / l);
      _ray.set(_rayO, _rayD);
      _ray.near = 0; _ray.far = l - 0.4;
      const hits = CBZ.losRaycast(_ray, CBZ.losBlockers);
      return !(hits && hits.length);
    } catch (e) { return true; }
  }

  // HOW LONG IT CIRCLES. opts.circleT is the caller's BASE (a great white sets
  // 6.5s, a megalodon 11.05s — "circles roughly twice as long" is most of what
  // makes a megalodon read as a megalodon), and the jitter rides on top of it
  // so two passes are never the same length. No opinion from the caller falls
  // back to the shared 4-9s. Hard-coding the default here, as this used to,
  // silently threw away every caller's identity.
  function circleTime(opts) {
    const base = (opts && opts.circleT != null && isFinite(opts.circleT) && opts.circleT > 0)
      ? opts.circleT : D_CIRCLE_T;
    return base + Math.random() * D_CIRCLE_T_RAND;
  }

  // PUBLIC: "let go of the target, and stay off it for `secs`."
  //
  // The one sanctioned way for a caller to break its own hunt off — a shark
  // wedged in the shallows, a scripted beat, a tamed animal changing hands.
  // It is a hunt-state change, NOT a reset: `menace` and `commits` survive
  // untouched, because those two numbers ARE the anti-habituation mechanism.
  // Zeroing them (which is exactly what the callers' `hunter._hunt = null`
  // fallback did while this function did not exist) hands the player a fresh,
  // un-escalated predator every time one gets stuck — the opposite of §B.
  function predatorDisengage(hunter, secs) {
    if (!hunter) return;
    const h = huntScratch(hunter);
    if (!h) return;
    const cool = (secs != null && isFinite(secs) && secs > 0)
      ? secs : (MEN_COOL_MIN + Math.random() * MEN_COOL_RAND);
    if (cool > h.cool) h.cool = cool;
    h.prev = h.st;
    h.st = "disengage"; h.t = 0; h.dropped = false; h.seizeWait = false;
    hunter.state = "flee";
    // menace / commits deliberately left alone.
  }
  CBZ.predatorDisengage = predatorDisengage;

  function forceDisengage(hunter, extraMenace) {
    if (!hunter || !hunter._hunt) return;   // never spin up a hunt just to end it
    hunter._hunt.menace = clamp(hunter._hunt.menace + (extraMenace || 0), 0, 1);
    predatorDisengage(hunter, null);
  }

  function predatorMenace(hunter) {
    return (hunter && hunter._hunt) ? hunter._hunt.menace : 0;
  }
  CBZ.predatorMenace = predatorMenace;

  // PUBLIC: "is this hunter holding absolutely still right now?" (§E ambush).
  // A caller MUST consult this before running its own idle/wander step, or its
  // cougar strolls out of the long grass while we are telling the player it is
  // hidden — an ambush the caller quietly walks out of is worse than none.
  function predatorStill(hunter) {
    return !!(hunter && hunter._hunt && hunter._hunt.still);
  }
  CBZ.predatorStill = predatorStill;

  function chumNear(h, hp, chumR, dt) {
    h.chumT -= dt;
    if (h.chumT > 0) return h.chumHit;
    h.chumT = 0.4;
    h.chumHit = false;
    if (!CBZ.goreChumList) return false;
    let list = null;
    try { list = CBZ.goreChumList(); } catch (e) { return false; }
    if (!list || !list.length) return false;
    let best = chumR * chumR;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      const dx = c.x - hp.x, dz = c.z - hp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; h.chumX = c.x; h.chumZ = c.z; h.chumHit = true; }
    }
    return h.chumHit;
  }

  // A HUNT THAT IS NOT ABOUT YOU ONLY SCORES ITSELF WHEN YOU ARE THERE TO SEE
  // IT. The dread bus, the stingers, the drop-out and the trauma shake are the
  // PLAYER's tension mix — the Jaws law, where the approach motif's tempo IS the
  // distance readout. That was safe while every one of this file's four callers
  // handed it the player. It stops being safe the moment a food chain runs
  // across the whole map: a wolf working a deer three fields away would have the
  // motif screaming at a threat the player cannot see, and the anti-habituation
  // rule would be spent on encounters he never had. Player-targeted hunts are
  // NEVER gated — `isP` short-circuits before any distance is computed.
  const SCORE_R = 55;
  // the silent twins. Swapping the FUNCTION rather than branching at each of the
  // fourteen cue sites keeps the hot path one indirection and, more importantly,
  // means a cue added to the FSM later cannot forget to ask.
  function noDread() {} function noStinger() {} function noTrauma() {} function noDrop() {}
  function scoring(hunter, isP) {
    if (isP) return true;
    const P = CBZ.player && CBZ.player.pos, hp2 = actorPos(hunter);
    if (!P || !hp2) return false;
    const dx = hp2.x - P.x, dz = hp2.z - P.z;
    return dx * dx + dz * dz < SCORE_R * SCORE_R;
  }

  function predatorHunt(hunter, target, dt, opts) {
    if (!on()) return "cruise";
    if (!hunter || !hunter.group || !target || !(dt > 0)) return "cruise";
    if (hunter.dead) return "cruise";
    opts = opts || EMPTY_OPTS;

    const h = huntScratch(hunter);
    if (h.state0 == null) h.state0 = hunter.state || "wander";
    h._fightTarget = target;   // for the creature_combat onHit fallback closure

    const hp = actorPos(hunter), tp = actorPos(target);
    if (!hp || !tp) return h.st;

    const senseR = opts.senseR != null ? opts.senseR : D_SENSE_R;
    const chumR = opts.chumR != null ? opts.chumR : D_CHUM_R;
    const circleR = opts.circleR != null ? opts.circleR : D_CIRCLE_R;
    const orbitR = opts.orbitR != null ? opts.orbitR : D_ORBIT_R;
    const cruiseSpd = opts.cruiseSpeed != null ? opts.cruiseSpeed : D_CRUISE_SPD;
    const rushSpd = opts.rushSpeed != null ? opts.rushSpeed : D_RUSH_SPD;
    const medium = opts.medium || predatorMedium(hp.x, hp.y != null ? hp.y : 0, hp.z);
    const reach = opts.reach != null ? opts.reach : (1.6 + actorScale(hunter) + actorScale(target));
    const move = typeof opts.move === "function" ? opts.move : defaultMove;
    const sub = (medium === "water");

    const dx = tp.x - hp.x, dz = tp.z - hp.z;
    const dist = Math.hypot(dx, dz);
    const toT = Math.atan2(dz, dx);
    const isP = isPlayerActor(target);
    // one distance test per frame; every player-facing cue below reads it.
    const score = scoring(hunter, isP);
    const dreadFor = score ? predatorDread : noDread;
    const stinger = score ? predatorStinger : noStinger;
    const trauma = score ? predatorTrauma : noTrauma;
    const drop = score ? predatorDrop : noDrop;

    let reachable = true;
    if (typeof opts.canReach === "function") {
      try { reachable = !!opts.canReach(target); } catch (e) { reachable = true; }
    }

    h.t += dt;
    if (h.cool > 0) h.cool -= dt;
    h.dive = 0;

    // §E. AMBUSH. Not a state — an OPT, because a big cat and a gator run the
    // same eight states as everything else; the only difference is that they
    // spend the open-ground part of them motionless. `h.still` is published for
    // the caller's own wander code (a hunter whose idle loop keeps strolling
    // while we claim it is hidden in the grass is worse than no ambush at all).
    const ambush = !!opts.ambush && CFG.PREDATOR_AMBUSH !== false;
    h.still = 0;

    // ---- LOS (throttled) + MENACE ----------------------------------------
    h.losT -= dt;
    if (h.losT <= 0) { h.losT = 0.25; h.los = checkLOS(hunter, hp, tp, medium); }
    const engaged = h.st !== "cruise" && h.st !== "disengage";
    if (engaged) {
      const prox = clamp(1 - dist / Math.max(1, senseR), 0, 1);
      let rise = MEN_PROX * prox + (h.los ? MEN_LOS : 0);
      if (h.st === "circle") rise += MEN_CIRCLE;
      else if (h.st === "rush" || h.st === "seize") rise += MEN_RUSH;
      h.menace = clamp(h.menace + rise * dt, 0, 1);
    } else {
      h.menace = clamp(h.menace - MEN_BLEED * dt, 0, 1);
    }
    // THE ANTI-CAMPING LAW. Nothing may sit on YOU forever; the withdrawal is
    // what recharges the next approach.
    //
    // AND IT IS SCOPED TO THE PLAYER ON PURPOSE. §B is a FAIRNESS rule — it
    // exists so an encounter stays frightening on the tenth meeting instead of
    // becoming a tax. Applied to a hunt on another animal the same arithmetic
    // is not fairness, it is starvation: prey flees in a straight line at a
    // speed close to its hunter's, so a commit needs whole seconds to close,
    // while the gauge peaks in about a third of one. Measured, with a wolf and
    // a deer herd in a meadow and no player within 600u: EVERY rush was vetoed
    // at ~0.35s, closest approach 5.1u against a 2.9u reach, and zero kills in
    // 20,000 frames — the food chain could not exist. The gauge still rises and
    // still bleeds for a non-player hunt (predatorMenace stays truthful); it
    // simply does not get to veto the commit. `isP` short-circuits first, so
    // every player-facing behaviour is byte-identical.
    if (engaged && isP && h.st !== "seize" && h.menace >= MEN_PEAK) {
      setState(hunter, h, "disengage", opts);
      h.cool = MEN_COOL_MIN + Math.random() * MEN_COOL_RAND;
    }

    // ---- the machine ------------------------------------------------------
    switch (h.st) {

      case "cruise": {
        // the caller owns idle/wander — we only decide when to wake up.
        if (h.cool > 0 || !reachable) break;
        const chum = chumNear(h, hp, chumR, dt);
        // AN AMBUSHER WAKES LATE AND CLOSE. It will not cross open ground to
        // reach you at 88u the way a bear will; it waits until you walk into
        // half its sense radius, and every second it waits makes the eventual
        // commit more likely (the bias below). That is why a cougar is
        // terrifying at 12u and irrelevant at 60u without a single line of
        // cougar-specific code.
        if (ambush) { h.still = 1; h.stillT += dt; }
        const wake = ambush ? senseR * AMBUSH_WAKE : senseR;
        if (dist < wake || chum) {
          h.scentFake = Math.random() < P_SCENT_FAKE;
          h.passes = 0;
          setState(hunter, h, "scent", opts);
          stinger("notice");
        }
        break;
      }

      case "scent": {
        // it knows. It turns and closes, and the motif starts.
        dreadFor(hunter, 0.25, dreadOptsFor(hunter, dist, sub));
        // keep tasting the water: a bleeding target that is still WAY outside
        // sense range must not bounce this state back to cruise on frame two —
        // blood is exactly the thing that pulls a predator in from far away.
        chumNear(h, hp, chumR, dt);
        if (!reachable || (dist > senseR * 1.4 && !h.chumHit)) { setState(hunter, h, "cruise", opts); break; }
        let wantH = toT;
        if (h.chumHit && dist > circleR * 2) wantH = Math.atan2(h.chumZ - hp.z, h.chumX - hp.x);
        move(hunter, wantH, cruiseSpd * 1.3, dt);
        if (dist < circleR) {
          // §C: a fifth of all approaches are nothing at all.
          if (h.scentFake) { setState(hunter, h, "cruise", opts); h.cool = 3 + Math.random() * 4; }
          else {
            h.circleDur = circleTime(opts);
            setState(hunter, h, "circle", opts);
          }
        }
        break;
      }

      case "circle": {
        // THE TEASE. Inside circleR it does NOT attack. This is the single most
        // important state in the file and shortening it is the one change that
        // would flatten the whole system.
        dreadFor(hunter, 0.55, dreadOptsFor(hunter, dist, sub));
        if (!reachable || dist > circleR * 2.4) { setState(hunter, h, "scent", opts); break; }
        // §J. THE PASS SHRINKS. Every circle that ends in nothing comes back
        // tighter than the last, so a long stalk has a shape — it is closing in
        // on you, not looping a fixed rail. Alien: Isolation's investigate
        // passes, and the same two lines also fix the thing that made a long
        // stalk read as a treadmill.
        const oR = orbitR * (1 - PASS_TIGHTEN * Math.min(h.passes, PASS_MAX - 1));
        // tangent + a radial correction toward the (shrinking) orbit radius
        const err = clamp((dist - oR) / Math.max(1, oR), -1, 1);
        const wantH = toT + h.orbitDir * (Math.PI * 0.5) * (1 - err * 0.75);
        move(hunter, wantH, cruiseSpd * 1.15, dt);
        if (h.t >= h.circleDur) {
          // an ambusher that has been sitting still is WOUND UP: the longer the
          // wait, the likelier this pass is the real one. Everything else keeps
          // the flat 45/30/25 split exactly.
          const bias = ambush ? clamp(h.stillT * AMBUSH_BIAS, 0, AMBUSH_BIAS_MAX) : 0;
          const r = Math.max(0, Math.random() - bias);
          if (r < P_CIRCLE_VANISH) {
            h.vanishDur = VANISH_MIN + Math.random() * VANISH_RAND;
            setState(hunter, h, "vanish", opts);
          } else if (r < P_CIRCLE_VANISH + P_CIRCLE_BUMP) {
            setState(hunter, h, "bump", opts);
          } else {
            h.dropped = false;
            h.commits++;
            h.stillT = 0; h.passes = 0; h.struck = false;
            // ARM THE BITE. creature_combat seeds a fresh attacker with
            // _atkT = rate * (0.3..0.8) — 0.45-1.20s for a shark — and that
            // clock only ticks while creatureFight is actually being called,
            // which during a rush is the ~0.23s the hunter spends inside
            // reach*1.25 at 22 u/s. So a committed rush kept arriving with a
            // cooldown still running and the shark went whole minutes without
            // ever biting. A COMMITTED RUSH STRIKES ON ITS FIRST PASS. The
            // ordinary land-attack pacing (the 0.9-1.15x rate re-arm after a
            // swing) is owner-tuned and deliberately untouched.
            hunter._atkT = 0;
            setState(hunter, h, "rush", opts);
            stinger("commit");   // the brass cluster IS the commitment
          }
        }
        break;
      }

      case "bump": {
        // ONE investigatory shoulder-nudge, then it VEERS OFF. A fake-out that
        // is also real animal behaviour, and it teaches the tell for free.
        dreadFor(hunter, 0.7, dreadOptsFor(hunter, dist, sub));
        move(hunter, toT, rushSpd * 0.72, dt);
        if (dist <= reach * 1.15) {
          const dmg = opts.bumpDmg != null ? opts.bumpDmg : D_BUMP_DMG;
          if (isP && CBZ.cityHurtPlayer && !(CBZ.player && CBZ.player.dead)) {
            try {
              CBZ.cityHurtPlayer(dmg, hp.x, hp.z, "struck by a " + actorName(hunter), false, hunter, true);
            } catch (e) {}
            const P = CBZ.player;
            if (P && P.pos) {
              let sx = P.pos.x - hp.x, sz = P.pos.z - hp.z;
              const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
              // a swimmer is shoved through the water, never launched on the
              // ballistic path — that one integrates against the SEABED.
              knockPlayer(sx, sz, 8.2, 4.2, null);
            }
          } else if (!isP) {
            // A NON-PLAYER VICTIM'S DAMAGE BELONGS TO THE CALLER'S SINK. The
            // raw `target.hp -= dmg` this replaces bypassed whatever bus the
            // victim's own file runs — for wildlife that is cityWildlifeHit,
            // the ONE thing that turns lethal damage into a real carcass — so a
            // shoulder-bump could kill a deer into a frozen, unskinnable prop.
            // Invisible while the only victim this file ever had was the player.
            if (typeof opts.onHit === "function") { try { opts.onHit(dmg); } catch (e) {} }
            else if (target.hp != null) target.hp -= dmg;
          }
          stinger("impact");
          trauma(0.6);
          if (CBZ.sfx) { try { score && CBZ.sfx("punch", _sfxOpts); } catch (e) {} }
          h.menace = clamp(h.menace + MEN_HIT, 0, 1);
          h.orbitDir = -h.orbitDir;
          h.circleDur = circleTime(opts);
          setState(hunter, h, "circle", opts);
        } else if (h.t > BUMP_TIMEOUT) {
          h.circleDur = circleTime(opts);
          setState(hunter, h, "circle", opts);
        }
        break;
      }

      case "vanish": {
        // MAXIMUM DREAD THROUGH ABSENCE. It leaves, the mix goes almost silent,
        // the fin drops. What you cannot see is worse than what you can.
        dreadFor(hunter, 0.06, dreadOptsFor(hunter, dist, sub));
        h.dive = 1;   // a hint the caller's move() may read (dive / break LOS)
        // A SWIMMER VANISHES BY LEAVING; AN AMBUSHER VANISHES BY STOPPING.
        // Same state, same dread, opposite locomotion — a cougar that swam
        // away from you would be a shark with fur. h.dive stays 1 either way,
        // so aquatic callers are untouched.
        if (ambush) { h.still = 1; h.stillT += dt; }
        else move(hunter, toT + Math.PI, cruiseSpd * 1.25, dt);
        if (h.t >= h.vanishDur) {
          // it comes back HARDER (escalation, not habituation)
          h.menace = clamp(h.menace - 0.18, 0, 1);
          h.scentFake = false;
          h.passes++;
          // ...but not forever. After PASS_MAX fruitless passes it gives up and
          // leaves, which is what makes the NEXT time it finds you mean
          // something. A predator that never leaves is furniture.
          if (h.passes >= PASS_MAX) {
            setState(hunter, h, "disengage", opts);
            h.cool = MEN_COOL_MIN + Math.random() * MEN_COOL_RAND;
            h.passes = 0;
          } else setState(hunter, h, "scent", opts);
        }
        break;
      }

      case "rush": {
        // COMMITTED. Straight, fast, from below/behind where the caller's move
        // lets it. This is the only state that is allowed to actually hurt you
        // badly, and it is the rarest outcome of circling.
        dreadFor(hunter, 0.9 + clamp(1 - dist / Math.max(1, circleR), 0, 1) * 0.1,
          dreadOptsFor(hunter, dist, sub));
        if (!reachable) { setState(hunter, h, "disengage", opts); break; }
        move(hunter, toT, rushSpd, dt);
        // THE DROP-OUT, timed off closing speed rather than a fixed radius.
        if (!h.dropped && dist <= rushSpd * DROP_LEAD + reach) {
          h.dropped = true;
          drop(0.30);
        }
        // CONTACT AT `reach`, NOT `reach * 1.25`. The wider band overlapped
        // creature_combat's own approach branch (which moves the body whenever
        // dist > reach), so for the last frame or two of a rush BOTH movers ran
        // and the closing speed doubled — a visible pop right on the bite.
        // One owner per metre.
        if (dist <= reach) {
          // NOT EVERYTHING CARRIES YOU OFF. A rhino, a bison, a moose and a
          // kicking elk commit exactly as hard as a bear does, but the commit
          // ENDS at the impact — they hit you and they are past you and
          // turning. `opts.seize === false` is how an archetype says so, and it
          // is the difference between "this game has one grab animation on
          // everything" and a bestiary. seizeOptsFor returns null for those, and
          // the fight driver is handed a null seize so it lands a plain strike.
          const so = seizeOptsFor(hunter, h, opts, medium);
          if (CBZ.creatureFight) {
            // hand the last stretch to the shared combat driver: it owns the
            // strike choreography. If it understands opts.seize it seizes; if
            // it does not, our onHit does it instead. Degrade-safe both ways.
            const fo = fightOptsFor(hunter, h, opts, so, medium);
            try { CBZ.creatureFight(hunter, target, dt, fo); } catch (e) {}
            if (hunter._seizing) { h.seizeWait = true; setState(hunter, h, "seize", opts); }
            // a non-grabbing archetype has spent its commit the moment it
            // connects. Without this it kept grinding through the target for
            // the full RUSH_TIMEOUT, which is how a charging rhino turns into a
            // lawnmower.
            else if (h.struck) { h.struck = false; setState(hunter, h, "disengage", opts); }
          } else if (so) {
            const handle = CBZ.predatorSeize ? CBZ.predatorSeize(hunter, target, so) : null;
            if (handle) { h.seizeWait = true; setState(hunter, h, "seize", opts); }
            else { setState(hunter, h, "disengage", opts); }
          } else {
            // no combat driver AND no grab: the bare contact hit, so a charger
            // still hurts on a build where creature_combat.js is absent.
            const bd = opts.bumpDmg != null ? opts.bumpDmg : D_BUMP_DMG;
            if (typeof opts.onHit === "function") { try { opts.onHit(bd * 2); } catch (e) {} }
            else if (isP && CBZ.cityHurtPlayer && !(CBZ.player && CBZ.player.dead)) {
              try { CBZ.cityHurtPlayer(bd * 2, hp.x, hp.z, "struck by a " + actorName(hunter), false, hunter, true); } catch (e) {}
            } else if (!isP && target.hp != null) target.hp -= bd * 2;
            stinger("impact"); trauma(0.7);
            setState(hunter, h, "disengage", opts);
          }
        } else if (h.t > RUSH_TIMEOUT) {
          setState(hunter, h, "disengage", opts);   // a miss is still a commit
        }
        break;
      }

      case "seize": {
        dreadFor(hunter, 1, dreadOptsFor(hunter, 0, sub));
        if (!hunter._seizing) {
          // whatever the outcome, the commit is spent. §B is absolute.
          setState(hunter, h, "disengage", opts);
          h.cool = MEN_COOL_MIN + Math.random() * MEN_COOL_RAND;
          h.menace = clamp(h.menace + 0.3, 0, 1);
        }
        break;
      }

      case "disengage": {
        // MANDATORY after every commit, hit or miss.
        dreadFor(hunter, clamp(0.25 - h.t * 0.12, 0, 0.25), dreadOptsFor(hunter, dist, sub));
        h.dive = 0.6;
        move(hunter, toT + Math.PI, cruiseSpd * 1.15, dt);
        if (dist > orbitR * 2.5 || h.t > 8) {
          if (h.cool <= 0) h.cool = MEN_COOL_MIN + Math.random() * MEN_COOL_RAND;
          setState(hunter, h, "cruise", opts);
        }
        break;
      }
    }

    return h.st;
  }
  CBZ.predatorHunt = predatorHunt;

  function seizeOptsFor(hunter, h, opts, medium) {
    // `seize: false` means "this archetype does not grab" — see the rush state.
    // Null (not an empty object) so every downstream truthiness check reads it
    // the same way, including creature_combat's own `opts.seize` branch.
    if (opts.seize === false) { h.seizeOpts = null; return null; }
    let so = h.seizeOpts;
    if (!so) so = h.seizeOpts = {};
    const src = opts.seize || EMPTY_OPTS;
    so.jaw = src.jaw;
    so.dps = src.dps;
    so.hold = src.hold;
    so.escape = src.escape;
    so.thrash = src.thrash;
    so.style = src.style;
    so.cam = src.cam;
    so.onEnd = src.onEnd;
    so.qteMax = src.qteMax;
    so.medium = src.medium || medium;
    so.cause = src.cause || ("mauled by a " + actorName(hunter));
    return so;
  }

  function fightOptsFor(hunter, h, opts, so, medium) {
    let fo = h.fightOpts;
    if (!fo) {
      fo = h.fightOpts = {
        reach: 0, rate: 1.1, dmg: 12, speed: 0, style: "bite", seize: null,
        move: null,
        // THE LOCOMOTION SEAM, FORWARDED. creature_combat's approach branch
        // used to write g.position.x/z/y RAW — no medium, no water mask, no
        // shore clearance, no seabed test — while predatorHunt had ALREADY
        // moved the hunter this frame through opts.move. For a shark that
        // meant a second mover shoving it up to 2.3u/frame closer to shore
        // than moveInWater ever allowed (defeating the whole CLEAR table) and
        // snapping its Y to restY() while the swim depth was easing somewhere
        // else. So the hunter's OWN locomotion is handed down: the combat
        // driver says how far and which way, the caller's move() decides how a
        // body of that kind gets there and owns its own depth. A hunter with
        // no opts.move (every land creature today) leaves fo.move null and
        // creature_combat's original path runs byte-for-byte.
        _mv: function (actor, dx, dz, step, dt2) {
          const mv = h.userMove;
          if (!mv || !(dt2 > 0)) return;
          try { mv(actor, Math.atan2(dz, dx), step / dt2, dt2); } catch (e) {}
        },
        onHit: function (dmg) {
          // the commit connected. A non-grabbing archetype uses this to end its
          // own rush (see the rush state); grabbers ignore it.
          h.struck = true;
          // creature_combat did NOT understand opts.seize (older build) — do the
          // seize ourselves at the strike frame, and if even that is refused,
          // fall back to plain contact damage. Never a dropped hit.
          // `seizeOpts === null` is the deliberate "does not grab" answer, and
          // must NOT be laundered into predatorSeize's own defaults.
          const handle = (CBZ.predatorSeize && h.seizeOpts)
            ? CBZ.predatorSeize(hunter, h._fightTarget, h.seizeOpts) : null;
          if (handle) return;
          // THE CALLER'S OWN SINK WINS. A hunter that passes opts.onHit (the
          // shark passes cityAnimalStrikePlayer) is telling us where its damage
          // belongs; silently substituting our own — or worse, creature_combat's
          // default `target.hp -= dmg` — routes damage around the kill bus.
          if (h.userOnHit) { try { h.userOnHit(dmg); return; } catch (e) {} }
          if (isPlayerActor(h._fightTarget)) {
            if (CBZ.cityAnimalStrikePlayer) { try { CBZ.cityAnimalStrikePlayer(hunter, dmg, fo.style); return; } catch (e) {} }
            if (CBZ.cityHurtPlayer) {
              try { CBZ.cityHurtPlayer(dmg, hunter.pos ? hunter.pos.x : 0, hunter.pos ? hunter.pos.z : 0,
                "mauled by a " + actorName(hunter), false, hunter, false); } catch (e) {}
            }
          } else if (h._fightTarget && h._fightTarget.hp != null) {
            h._fightTarget.hp -= dmg;
          }
        },
      };
    }
    const sp = hunter.species;
    // read live every frame: the caller's sink is part of its opts, not ours
    h.userOnHit = (typeof opts.onHit === "function") ? opts.onHit : null;
    h.userMove = (typeof opts.move === "function") ? opts.move : null;
    fo.move = h.userMove ? fo._mv : null;
    fo.reach = opts.reach != null ? opts.reach : (1.6 + actorScale(hunter) + 1);
    fo.rate = opts.rate != null ? opts.rate : 1.1;
    fo.dmg = opts.dmg != null ? opts.dmg : ((sp && sp.bite) || 18);
    fo.speed = opts.rushSpeed != null ? opts.rushSpeed : D_RUSH_SPD;
    fo.style = opts.style || (CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : "bite");
    // PROPAGATE THE INTENT, NOT JUST ITS ABSENCE. A null here would be
    // indistinguishable from "this caller has never heard of seizes", and
    // creature_combat's trySeize treats that as licence to roll its own 35%
    // MAUL_SEIZE_P grab with a hand-authored bundle. `false` says NO out loud.
    fo.seize = (opts.seize === false) ? false : so;
    fo.medium = medium;
    return fo;
  }

  // ============================================================
  //  §K. predatorKit — THE HEADLINE LEVER.
  //
  //  wildlife_shark.js hand-writes ~25 lines of opts. If every predator has to
  //  do that, the block saved nobody anything: it is a place to put your numbers,
  //  not a reason not to have them. predatorKit derives the WHOLE bundle from
  //  the species' own physical fields, so adopting the predator grammar costs a
  //  caller two lines — its kit and its mover — and nothing else.
  //
  //  Read the ARCH table's header comment for where these power laws came from.
  //  The short version: the great white and the megalodon were hand-tuned months
  //  apart by a human who was not thinking about laws, and the ratios between
  //  their numbers turned out to BE laws. So the shark's authored feel is now
  //  the engine every land predator runs on. That is the answer to "did the
  //  shark make the bear cheaper" — the bear's numbers are the shark's curve
  //  evaluated at scale 1.35.
  //
  //  NO SPECIES NAME APPEARS BELOW THIS LINE. The one categorical input is the
  //  style string creature_combat already derives; everything else is continuous
  //  in scale / spd / bite. Adding a species must never mean editing this file.
  // ============================================================

  function inWaterOnly(t) {
    // aquatic hunters simply cannot reach you on land. predatorHunt turns a
    // false canReach into rush->disengage / circle->scent for free.
    const p = actorPos(t);
    if (!p) return false;
    return predatorMedium(p.x, p.y != null ? p.y : 0, p.z) === "water";
  }

  // THE SHORTEST HOLD THAT CAN ACTUALLY DELIVER `n` ESCAPE WINDOWS.
  //
  // Read straight off tickQTE/scheduleQTE, so it can never drift from them:
  //   * window 1 opens at hold * 0.30 and closes QTE_WINDOW later;
  //   * each next window is scheduled 0.55 + QTE_TELL after the last one shut,
  //     and closes QTE_WINDOW after that — a step of QTE_WINDOW+QTE_TELL+0.55;
  //   * tickQTE REFUSES to open one unless QTE_TELL+QTE_WINDOW+0.2 still fits
  //     inside the hold, which is the clause that was silently eating them.
  // Solving the tightest constraint (the last window) for `hold`. Uses the full
  // QTE_WINDOW rather than a learned one: learning only ever shortens windows,
  // so a budget built on the maximum is always sufficient.
  function qteBudget(n) {
    if (!(n > 1)) return 0;
    const step = QTE_WINDOW + QTE_TELL + 0.55;
    const tail = QTE_TELL + QTE_WINDOW + 0.2;
    return (((n - 2) * step + QTE_WINDOW + tail) / 0.70) * 1.05;   // +5% margin
  }

  function styleOf(sp) {
    if (CBZ.creatureStyleFor) {
      try { const s = CBZ.creatureStyleFor(sp); if (s) return s; } catch (e) {}
    }
    return "bite";
  }

  function buildKit(actor) {
    const sp = actor.species || EMPTY_OPTS;
    const style = styleOf(sp);
    const A = ARCH[style] || ARCH.maul;

    // the three physical facts. Guarded, because a caller may hand us a bare
    // actor with no species at all and a throw here would take out its tick.
    const sc = (typeof sp.scale === "number" && sp.scale > 0) ? sp.scale : 1;
    const spd = (typeof sp.spd === "number" && sp.spd > 0) ? sp.spd : 2.5;
    const bite = (typeof sp.bite === "number" && sp.bite > 0) ? sp.bite : 12;

    const rs = Math.sqrt(sc);            // radii: a bigger animal owns more water
    const ct = Math.pow(sc, 0.7);        // patience: a bigger animal circles longer
    const hs = Math.pow(sc, 0.9);        // hold: a bigger animal keeps you longer
    const nimble = Math.pow(sc, -0.13);  // and accelerates worse

    const kit = {
      senseR: A.sense * rs,
      chumR: A.chum * rs,
      circleR: A.circle * rs,
      orbitR: A.orbit * rs,
      circleT: A.circleT * ct,
      // NOTE ON UNITS: `spd` is a base gait number in the 1.2-4.0 band for every
      // authored wildlife species. A caller whose actor stores an already-final
      // u/s speed (dogs.js's stray is 6.2) should override cruiseSpeed/rushSpeed
      // rather than have this multiply it again — hence the clamps, which are a
      // guard rail, not a tuning knob.
      cruiseSpeed: clamp(spd * A.cruiseK, 0.6, 9),
      rushSpeed: clamp(spd * A.rushK * nimble, 2.5, 24),
      bumpDmg: bite * 0.2,
      reach: A.reachB + sc * A.reachK,
      rate: A.rate * rs,
      dmg: bite,
      style: style,
      ambush: !!A.ambush,
      seize: false,
    };
    if (sp.aquatic) { kit.medium = "water"; kit.canReach = inWaterOnly; }

    // ---- WHICH GRAB. Three inputs, none of them a name.
    let ss = A.seize;
    if (ss === "") {
      // MASS decides. A heavy quadruped has the leverage to rear over you and
      // slam down; a light one can only get its teeth in and shake. The
      // threshold sits between a gray wolf (0.95) and a black bear (1.25), and
      // a newly-authored 1.6-scale animal rears without anyone editing this.
      ss = (sc >= MAUL_MASS) ? "maul" : "worry";
      if (style === "strike") {
        // a snake either wraps you or it does not hold you at all. A viper
        // strikes and withdraws — the threat is the venom afterwards, which is
        // the caller's business, so it gets NO seize and stays cheap.
        ss = sp.constrictor ? "constrict" : (sp.venom ? false : "worry");
      }
    }
    // creature_combat already has an opinion for the animals whose grab is a
    // ROLL. Respect it — except for a constrictor, whose squeeze we now model
    // properly and which its regex lumps in with crocodilians.
    if (ss !== false && CBZ.creatureSeizeStyleFor && !(sp.snake && sp.constrictor)) {
      try { const cs = CBZ.creatureSeizeStyleFor(sp); if (cs && cs !== "shake") ss = cs; } catch (e) {}
    }

    if (ss !== false) {
      let jaw = null;
      if (CBZ.creatureJawPoint) { try { jaw = CBZ.creatureJawPoint(actor); } catch (e) { jaw = null; } }
      // §D of the QTE research: MORE, SMALLER chances for the escapable styles;
      // ONE forgiving chance for the big ones you were never meant to
      // out-wrestle. The window length itself is never shortened here.
      const qteMax = (ss === "constrict") ? 3 : (ss === "worry" ? 2 : 1);
      // a constrictor holds you far longer than it "should" for its mass,
      // because the whole style is a long squeeze rather than a set of bites.
      let hold = A.hold * hs * (ss === "constrict" ? 2.0 : 1);
      // ...AND THE HOLD MUST ACTUALLY BUY THE WINDOWS IT PROMISES. This is the
      // bug that made qteMax decorative: tickQTE refuses to open a window that
      // cannot finish before the hold ends, and every mass-derived hold was too
      // short for a second one. So a wolf (qteMax 2) and an anaconda (3) got
      // exactly one chance each — identical to a grizzly, and the precise
      // inversion of the design, which wants the ESCAPABLE styles to be the
      // generous ones. Raise the hold to the window budget rather than quietly
      // dropping the promise.
      const need = qteBudget(qteMax);
      if (hold < need) hold = need;
      kit.seize = {
        jaw: jaw,                         // null is fine: jawWorld falls back
        dps: 10 + bite * 0.4,             // the shark/megalodon pair, exactly
        hold: hold,
        escape: clamp(A.escape * Math.pow(sc, -0.9), 0.05, 0.9),
        thrash: 1,
        style: ss,
        qteMax: qteMax,
      };
      if (sp.aquatic) kit.seize.medium = "water";
    }
    return kit;
  }

  // PUBLIC. Cached per actor; `overrides` shallow-merges on top (and merges the
  // seize sub-object rather than replacing it, so a caller that only wants its
  // own death message does not lose the derived jaw and dps).
  function predatorKit(actor, overrides) {
    if (!actor || CFG.PREDATOR_KIT === false) return null;   // one-line revert
    let base = actor._predKit;
    if (!base) { try { base = actor._predKit = buildKit(actor); } catch (e) { return null; } }
    if (!overrides) return base;
    let out = actor._predOpts;
    if (!out) out = actor._predOpts = {};
    for (const k in base) out[k] = base[k];
    for (const k in overrides) {
      if (k === "seize" && overrides.seize && overrides.seize !== true && base.seize) {
        const s = out._seizeMerge || (out._seizeMerge = {});
        for (const j in base.seize) s[j] = base.seize[j];
        for (const j in overrides.seize) s[j] = overrides.seize[j];
        out.seize = s;
      } else out[k] = overrides[k];
    }
    return out;
  }
  CBZ.predatorKit = predatorKit;

  // PUBLIC. "Does this thing hunt the player at all?" — ONE definition, so
  // wildlife.js and dogs.js stop each re-deriving a danger threshold that then
  // drifts apart. Birds are screened out here rather than in the table.
  function predatorIs(actor) {
    const sp = actor && actor.species;
    if (!sp) return false;
    // A DELIVERY APPARATUS OVERRIDES THE DANGER DIAL. `danger` is an authored
    // opinion and the bestiary's is not always consistent — the rattlesnake is
    // written 0.4, below the threshold, which would have left exactly ONE snake
    // running a parallel venom-bite path while every other predator migrated.
    // That is the failure this whole wave exists to close, so venom and
    // constriction qualify on their own. Both are physical fields on the
    // species, not names, so this stays a continuous-facts test.
    if (sp.venom || sp.constrictor) return true;
    if (!((sp.danger || 0) >= PRED_DANGER)) return false;
    return !!PRED_STYLES[styleOf(sp)];
  }
  CBZ.predatorIs = predatorIs;

  // PUBLIC: "you just shot it — it knows, and it is coming."
  //
  // Without this there is a real gap on every migrated caller: a predator that
  // no longer pokes its own legacy `state = "charge"` has to be picked up by
  // predatorHunt's ordinary senseR sweep, and the 20% scentFake means a SHOT
  // BEAR CAN SHRUG FOR SEVERAL SECONDS. Being ignored by something you just put
  // a bullet into is the one failure that reads as broken rather than tense.
  // So provocation is a first-class entry point: skip straight to `scent`, with
  // the fake-out disabled and the cooldown cleared. It deliberately does NOT
  // touch menace or commits — those two numbers ARE the anti-habituation rule
  // (see predatorDisengage), and a rifle must not reset them.
  function predatorProvoke(hunter, target) {
    if (!on() || !hunter || !hunter.group || hunter.dead) return false;
    const h = huntScratch(hunter);
    if (!h) return false;
    h.cool = 0;
    h.scentFake = false;
    h.passes = 0;
    h.stillT = 0;
    if (h.st === "seize") return true;      // already has you; nothing to escalate
    if (h.st !== "scent" && h.st !== "circle" && h.st !== "rush" && h.st !== "bump") {
      setState(hunter, h, "scent", null);
      predatorStinger("notice");
    }
    return true;
  }
  CBZ.predatorProvoke = predatorProvoke;

  // ============================================================
  //  §D. predatorPack — WHY A WOLF PACK IS NOT FOUR WOLVES.
  //
  //  Real coursing predators divide labour: the light fast ones herd and block
  //  escape routes while ONE commits to the takedown. Four animals all running
  //  the same "charge the player" brain is not a pack, it is a queue, and it is
  //  what every one of these AIs did before today.
  //
  //  The whole mechanism is: at most one hunter near a target holds the commit
  //  token; everyone else is told to flank, and gets steered to its OWN bearing
  //  slot around the target so they surround you instead of stacking. A caller
  //  uses the answer by passing `opts.canReach = () => false` on flank/hold —
  //  which predatorHunt already honours (rush -> disengage, circle -> scent).
  //  That is deliberately ZERO new plumbing inside the FSM: a coordination layer
  //  that had to reach into the state machine would be a second state machine.
  //
  //  It also subsumes wildlife.js's HUNTER_CAP — a global "no more than 3
  //  hunters" counter that was a second, independent answer to this exact
  //  problem. Keeping the cap's effect and deleting the duplicate concept is
  //  the point of the exercise.
  // ============================================================
  const PACK_R = 35;          // u — inside this you count as on the same target
  const PACK_STALE = 1.2;     // s of silence before a member is forgotten
  const PACK_LEAD_MAX = 9;    // s any one hunter may hold the commit token
  const PACK_FLANK_MAX = 3;   // engaged flankers; the rest hold (was HUNTER_CAP)
  const PACK_DEAD = 0.5;      // rad of deadband, or the flankers oscillate
  const PACK = [];            // {hunter, target, t}
  const PACK_LEADS = [];      // {target, hunter, since}
  const MAX_LEADS = 6;

  function leadRec(target) {
    for (let i = 0; i < PACK_LEADS.length; i++) if (PACK_LEADS[i].target === target) return PACK_LEADS[i];
    if (PACK_LEADS.length >= MAX_LEADS) PACK_LEADS.shift();   // bounded, never grows
    const r = { target: target, hunter: null, since: -999 };
    PACK_LEADS.push(r);
    return r;
  }

  function predatorPack(hunter, target, dt) {
    if (CFG.PREDATOR_PACK === false || !on()) return "commit";
    if (!hunter || !target) return "commit";
    const hp = actorPos(hunter), tp = actorPos(target);
    if (!hp || !tp) return "commit";
    const t = nowS();
    const dist = Math.hypot(tp.x - hp.x, tp.z - hp.z);

    // ---- prune the stale and the dead, and make sure I am registered. The
    //      list is tiny (a pack is 3-7) so a linear pass is cheaper than any
    //      bookkeeping that would keep it sorted.
    let mine = null;
    for (let i = PACK.length - 1; i >= 0; i--) {
      const r = PACK[i];
      if (!r.hunter || r.hunter.dead || (t - r.t) > PACK_STALE) { PACK.splice(i, 1); continue; }
      if (r.hunter === hunter) mine = r;
    }
    if (!mine) { mine = { hunter: hunter, target: target, t: t }; PACK.push(mine); }
    else { mine.t = t; mine.target = target; }

    // ---- how many of us are on this target, and where do I sit in the queue?
    //      A stable ordering with no sort and no ids: my slot is simply how many
    //      live packmates registered BEFORE me, which is their index in PACK.
    let n = 0, idx = 0;
    for (let i = 0; i < PACK.length; i++) {
      const r = PACK[i];
      if (r.target !== target) continue;
      const p = actorPos(r.hunter);
      if (!p || Math.hypot(tp.x - p.x, tp.z - p.z) > PACK_R) continue;
      if (r === mine) { idx = n; continue; }
      n++;
    }

    const L = leadRec(target);
    // ---- is the current token-holder still fit to hold it? A lead that has
    //      wandered off, died, or gone back to cruising is holding the pack
    //      hostage; so is one that has held it too long without resolving.
    if (L.hunter) {
      const lh = L.hunter._hunt;
      const lp = actorPos(L.hunter);
      if (L.hunter.dead || !lp ||
          Math.hypot(tp.x - lp.x, tp.z - lp.z) > PACK_R * 1.4 ||
          (t - L.since) > PACK_LEAD_MAX ||
          !lh || lh.st === "cruise" || lh.st === "disengage") {
        L.hunter = null;
      }
    }
    if (!L.hunter && dist <= PACK_R) { L.hunter = hunter; L.since = t; }
    if (L.hunter === hunter) { const s = huntScratch(hunter); if (s) s.packRole = "commit"; return "commit"; }

    // ---- I am not the one going in. Take my bearing slot.
    const s = huntScratch(hunter);
    // A HUNTER OUTSIDE PACK_R IS NOT IN A PACK FIGHT AND HAS NOTHING TO
    // ARBITRATE. Returning "hold" for it — which this did — was catastrophic:
    // consumers wire the answer into `canReach`, and predatorHunt's cruise case
    // refuses to wake on an unreachable target, so EVERY land predator's sense
    // radius was silently amputated to 35u. A brown bear senses at 81u and an
    // ambushing tiger wakes at ~48u; both are outside PACK_R, so the entire
    // pounce archetype — whose fairness argument IS the long silent stalk —
    // could never begin one. Distance gates commitment, never awareness.
    if (dist > PACK_R) { s.packRole = "commit"; return "commit"; }
    if (idx >= PACK_FLANK_MAX) { s.packRole = "hold"; return "hold"; }
    if (s) {
      s.packRole = "flank";
      const lp = actorPos(L.hunter);
      const lead = lp ? Math.atan2(lp.z - tp.z, lp.x - tp.x) : 0;
      const ang = Math.atan2(hp.z - tp.z, hp.x - tp.x);
      const want = lead + (idx + 1) * (6.283 / Math.max(2, n + 1));
      const diff = shortAngle(want - ang);
      // WHICH WAY IS "TOWARD MY SLOT"? In the circle state the heading is
      // toT + orbitDir*(PI/2), and toT points hunter->target, i.e. bearing+PI.
      // So orbitDir = +1 sends the hunter around the target with its BEARING
      // DECREASING. To raise my bearing I therefore need -1. Getting this sign
      // backwards would spread the pack the long way round and read as four
      // animals fleeing in formation.
      if (Math.abs(diff) > PACK_DEAD) s.orbitDir = (diff > 0) ? -1 : 1;
      s.packSlot = idx; s.packT = t;
    }
    return "flank";
  }
  CBZ.predatorPack = predatorPack;

  // ============================================================
  //  1e. THE RATCHET (BLOCK LAW #5)
  //
  //  legacy  = independent "a predator lands a hit on the player" code paths
  //            that have NOT adopted this block.
  //  adopted = the ones that have.
  //
  //  ADOPTION IS DECLARED, NOT SNIFFED. The first cut of this audit tried to
  //  detect migration by probing globals and by reading a function's source
  //  (String(CBZ.creatureFight).indexOf("seize")). Both were wrong, in the two
  //  ways this kind of probe is always wrong:
  //    * The globals it probed (cityAnimalStrikePlayer, cityDogs) are permanent
  //      exports. They are true whether or not the site behind them migrated,
  //      so those entries were tautologies that could never retire.
  //    * The source sniff was simply FALSE. creature_combat.js's source spells
  //      it `trySeize` and `SEIZE`, never a bare lowercase "seize", so the one
  //      site that genuinely DID migrate was counted as legacy — the audit
  //      miscounting its own migration is worse than not auditing at all.
  //  Only the migrating file knows whether it migrated. So each adopted site
  //  says so itself, in one guarded line at load:
  //
  //      if (CBZ.predatorAdopt) CBZ.predatorAdopt("<id>");
  //      else (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("<id>");
  //
  //  The `else` is what makes it script-order-proof: a site that loads BEFORE
  //  this file buffers its id on CBZ._predatorAdopted and we drain the buffer
  //  below. Nothing about the count depends on index.html's ordering.
  //  The number may only ever go DOWN.
  // ============================================================
  const ADOPTED = {};
  function predatorAdopt(id) { if (id) ADOPTED[String(id)] = true; }
  CBZ.predatorAdopt = predatorAdopt;

  // drain adoptions registered before this file loaded
  (function drainAdoptions() {
    const pre = CBZ._predatorAdopted;
    if (!pre) return;
    try {
      if (pre.length != null) { for (let i = 0; i < pre.length; i++) predatorAdopt(pre[i]); }
      else { for (const k in pre) if (pre[k]) predatorAdopt(k); }
    } catch (e) {}
  })();

  // Every independent "a predator lands a hit on the player" path we know of.
  // An id in ADOPTED is migrated; everything else is legacy, by definition.
  const LEGACY_SITES = [
    // wildlife.js ~1193: the land-predator charge hands the strike to
    // creatureFight and lands it through onHit -> animalStrikePlayer.
    "wildlife:predator-charge",
    // wildlife.js ~1618: the generic charging-animal contact strike.
    "wildlife:herd-charge",
    // wildlife.js ~1063: the anaconda's grabT constrict — a grab that is not a seize.
    "wildlife:snake-constrict",
    // wildlife.js ~1074: viper/cobra/mamba venom strike.
    "wildlife:snake-strike",
    // dogs.js ~516: the aggro stray's maul, damage straight to cityHurtPlayer.
    "dogs:aggro-maul",
    // games/ocean.js ~582: updateShark's OWN patrol/circle/bump/strike FSM — a
    // second shark brain that predates this file and knows nothing about it.
    // wildlife_shark.js's header calls it out by name as the reason a third
    // must never exist. Counting it is the honest thing: it was always a legacy
    // predator-hits-player path, the audit simply had not admitted it.
    "ocean:shark-fsm",
    // wildlife_shark.js: fully migrated since the day it shipped and never
    // declared it. Adding the id and the one-line declaration is free honesty —
    // an audit that undercounts its own consumers is as useless as one that
    // undercounts its debt.
    "wildlife_shark:hunt",
    // creature_combat.js: the opts.seize seam + the maul opt-in. MIGRATED — it
    // adopts from its own file, which is the only place that can say so honestly.
    "creature_combat:seize-seam",
    // police.js: THE ARREST TACKLE. A human grappler, and the first NON-LETHAL
    // consumer of the seize — running from an officer inside reach gets you put
    // on the pavement through the same wind->strike->hold->resolve FSM every
    // animal uses, with `nonLethal` so its worst outcome is "taken". MIGRATED in
    // the change that added the id; nothing here was ever hand-rolled.
    "police:arrest-tackle",
    // piracy.js: THE BOARDING GRAB. The SECOND non-lethal human consumer — a
    // crew takes somebody off a deck through the same wind->strike->hold FSM,
    // resolving to "taken" rather than "killed", with the drag style so being
    // hauled off your own boat feels different from being tackled on a
    // pavement. MIGRATED in the change that added the id; nothing hand-rolled.
    "piracy:boarding-seize",
  ];

  CBZ.predatorAudit = function () {
    let legacy = 0, adopted = 0;
    for (let i = 0; i < LEGACY_SITES.length; i++) {
      if (ADOPTED[LEGACY_SITES[i]]) adopted++; else legacy++;
    }
    return { legacy: legacy, adopted: adopted };
  };

  // ============================================================
  //  UPDATERS
  // ============================================================

  // onAlways(9.9): the dread bus keeps decaying and the vignette keeps closing
  // even while the game is paused — tension that snaps off at a pause menu is
  // not tension. Free order (9.5-9.8 taken, gore is 8).
  if (CBZ.onAlways) {
    CBZ.onAlways(9.9, function (dt) {
      if (!on()) {
        if (dread !== 0) { dread = 0; dreadRaw = 0; tickVignette(); }
        return;
      }
      if (!(dt > 0)) dt = 0;
      collectDread(dt);
      tickAudio(dt);
      tickVignette();
    });
  }

  // onUpdate(47.35): gameplay. AFTER wildlife.js (47.1) and its combat hand-off
  // so the attacker's transform for this frame is final before we anchor a
  // victim to its jaw — anchoring to a stale transform is what makes a held
  // body swim a frame behind the mouth.
  if (CBZ.onUpdate) CBZ.onUpdate(47.35, seizeTick);

  // onAlways(52.5): AFTER camera.js's onAlways(50) AND after fpsmode.js's
  // onAlways(52). At 50.5 this only beat camera.js — but in city FIRST PERSON,
  // which is the default combat view, fpsmode fully owns camera position, look
  // and FOV at 52 and simply overwrote the trauma shake and the dolly every
  // frame. The amendment's core camera technique was silently dead exactly
  // where it matters most. 52.5 lands after every lens writer in the chain and
  // still composes with the seize's cineCam possession (camera.js's cine branch
  // runs at 50 and returns; we add our offset on top of whatever won).
  if (CBZ.onAlways) CBZ.onAlways(52.5, cameraPost);
})();
