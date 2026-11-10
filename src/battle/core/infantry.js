/* ============================================================
   battle/core/infantry.js — THE INFANTRY. Every soldier on the field, at
   every scale from one man to millions, is a ROW here and is simulated by
   the same rules. There are no tiers of brain, no hit chance, no damage
   multiplier, no aggregate battle standing in for men. Scale comes from data
   layout (typed columns, grids, counting sorts, lazy kinematics) and from
   exact shortcuts (a man with no enemy inside sight range has nothing to
   see, so he does not look), never from simplified rules far from the lens.

   WHAT A MAN DOES (every rule here is the same for every row):
     SEES       detection is a hazard: the exposed area of the enemy
                (geometry: sight lines from his eye to points on the enemy's
                body, over the real ground and cover, in the enemy's real
                posture) over the range squared, times movement and a muzzle
                signature, times his own skill and optic. Nobody is "seen"
                by a distance check.
     REACTS     contact (seeing him, or a round cracking past) -> he takes
                the lowest posture that still has a line (prone, kneeling),
                in the best fold or cover he can reach in a few strides
     AIMS       acquisition (shoulder, find the mark in the sight), then the
                aim settles on the training's time constant. The shot is
                pressed when the sight picture is good enough for this range
                and this target (a trained man waits for it, a conscript
                jerks it off)
     FIRES      a flown round: the weapon's mechanical group, his hold in
                his posture, recoil not yet recovered, his range estimate
                (and the correction he makes after seeing a miss strike), his
                lead on a mover, his suppression. Muzzle velocity, drag, drop
                and time of flight are weapons/ballistics.js
     HITS       the round is traced through the ground and cover at launch and
                through the BODIES near its line when it arrives (the bodies
                have moved during its flight). A body is ballistics.js's
                zones in his real posture; a plate is a real plate where a
                plate is worn; the wound is what the round reached and the
                energy it left. A near miss rattles everybody it passes
     IS HURT    capacity, not an hp bar: a wound takes what it takes now and
                bleeds; below half he is down (out of the fight, bleeding,
                calling for help); a mate gives buddy aid
     BREAKS     stress from cracks, wounds, mates down beside him, his leader
                down, being alone; training sets how much he takes
   THE SQUAD (ten men: a leader and two fire teams) decides on its own
   clock: advance in formation, react to contact, base of fire + bound,
   assault a suppressed enemy, break contact.

   TRAINING IS NOT A NUMBER ON THE DAMAGE. It is DOCTRINE below: how fast a
   man finds a mark, how fast his aim settles, how still he holds, how well
   he reads range, how long he waits for the shot, how he uses ground, how
   much fire he takes before his head goes down, how short his rushes are.
   tools/npcwar-duel-check.mjs measures what that buys, by range.

   Page-independent: no DOM, no THREE. Runs in the page, in node and in a
   worker. Needs CBZ.ballistics (src/weapons/ballistics.js); CBZ.armour
   (src/systems/armour.js) when anybody wears a plate.

   PUBLIC  CBZ.battleInfantry.create(S, cfg) -> I
     cfg.ground   { x0, z0, cell, w, h, hgt }   the field's heights (or cfg.groundAt)
     cfg.cover    { x0, z0, cell, w, h, top, mat } optional: cover heights above
                  the ground (sandbags, walls, rocks, hulls) and their material
     cfg.seed     the dice (every draw in this file comes from it)
     I.unitType(spec) -> type index   spec: { trn, gun, optic, kit } (DOCTRINE id,
                  ballistics GUN id, sight magnification (0 iron), armour kit
                  { plates, sides, helmet } of CBZ.armour.CLASSES ids)
     I.add(row, type, squadId, slot)  a row the host allocated in S
     I.order(side, o)        the side's order: { kind: "advance"|"hold", x, z }
     I.step(dt)              one step of the whole field (dt <= 0.1 s)
     I.events / I.nEv        [type, a, b, v] x nEv (EV)
     I.shots / I.nShot       rounds for the renderer (SHOT_F floats each)
     I.hurt(row, imp)        a round or blast from outside this sim (the host's
                             vehicles, animals, the player): imp = { kind:
                             "round", ox,oy,oz,dx,dy,dz, cart, v, by } or
                             { kind: "blast", x, y, z, W (kg TNT), by }
     I.audit()               the ledger: rounds, hits, by range, organs, ...
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});

  const LIFE = { free: 0, alive: 1, routed: 2, fled: 3, dead: 4 };
  const POST = { stand: 0, kneel: 1, prone: 2 };
  const POST_NAME = ["stand", "crouch", "prone"];      // ballistics.MAN's names
  const MOVE = { hold: 0, walk: 1, rush: 2, crawl: 3, run: 4, march: 5 };
  // (strike: a blow in the press, a = who struck, b = whom, v = 1 it went in, 0.5 on the shield, 0 a miss;
  //  throw: a = who let his spear go; shield: a's shield took a spear and he let it fall)
  const EV = { kill: 1, down: 2, hit: 3, fled: 4, rout: 5, rally: 6, shot: 7, aid: 8, post: 9, crack: 10, strike: 11, throw: 12, shield: 13 };
  // a row the host owns (its own body, synced into the store each step): what it is
  const EXT = { none: 0, man: 1, beast: 2, vehicle: 3 };
  // a round for the renderer: shooter, origin, unit direction, where it stopped
  // (metres along the line), muzzle velocity, drag, cartridge idx, tracer, hit row
  const SHOT_F = 13;

  /* ============================================================ DOCTRINE
     One row per training level (NPC War's TRAININGS ids). Every field is a
     behaviour or a skill with a unit; none of them is damage.
       detect   1/s: detection hazard for a standing man in the open at 100 m
                (exposure 0.7 m2), looking into his sector. Scales with the
                exposed area and 1/range^2 (src: target acquisition studies,
                FM 3-21.8 ch. 2 "searching"; a trained observer's systematic
                scan finds a still prone man at 300 m in tens of seconds)
       acq      s: from detection to the rifle on the mark (mount, find it)
       settle   s: time constant of the aim settling once on the mark
       hold     mil 1-sigma per axis, settled and calm: standing / kneeling /
                prone (rested on the ground or a lip). FM 3-22.9 groups: a
                qualified rifleman holds 4 MOA prone supported (0.4 mil
                sigma); an untrained one 3x that
       recover  s: time constant of the muzzle coming back after a shot
       press    trigger discipline 0..1. He presses when his aim has settled
                to within (1 + slack) of his steady hold, slack = 3 (1 - press);
                a trained man also takes longer over a long shot (breathing,
                natural point of aim: settle x (1 + press x range / 400))
       burst    rounds per trigger pull past 50 m (fire discipline)
       rangeErr 1-sigma share of the range in his estimate (iron sights)
       adjust   the share of his miss he corrects when he sees it strike
       lead     mean, sd: the share of the true lead on a crossing mover
       drop     s: down to prone; rise s: up from prone
       rushMax  s: the longest he stays up in a rush under fire
       coverR   m: how far he looks for a better firing position at contact
       suppK    how much a crack past him rattles him (stress per crack)
       pinAt    the rattle at which his head stays down and he stops shooting
       calm     s: time constant of the rattle wearing off
       reload   s: a magazine change; tac: he changes it in cover before it runs dry
       nerve    the stress at which he breaks
       aid      he goes to a downed mate within this many metres
       moveFire he fires on the move (0 never, 1 always)
       ammoDisc share of a mag he keeps back before he stops to reload
       fear     mil, 1-sigma: the aiming error the fight itself puts on
                every shot while rounds are passing his squad, on top of his
                hold (in quadrature). `hold` above is a qualification-range
                number, and no army has ever shot like its range scores in
                contact: a snatched sight picture, a rifle fired from an
                awkward lie, a head that will not stay up. Rowland, The
                Stress of Battle (2006; British Army operational analysis of
                real engagements against field trials) puts rifle fire in
                combat at about a tenth of its trial effectiveness, less for
                the best, far worse for the worst; US counts of small-arms
                rounds per casualty run to the thousands. With these rows a
                trained man in contact hits a standing man about one round
                in sixty at 400 m, one in six at 100 m, and almost every
                time at 20 m: at range rifle fire PINS, and it kills when
                somebody closes. Before this the core fought at range-day
                accuracy: 30 v 30 between equals at 400 m was over in 28 s
                at six rounds a hit, without either side moving
                (tools/npcwar-squad-check.mjs, tools/npcwar-timeline.mjs). A
                man nobody is shooting at (the first volley of an ambush)
                shoots as he qualifies. */
  const DOCTRINE = {
    civ:   { fear: 17, detect: 0.16, acq: 2.1, settle: 1.00, hold: [3.4, 2.5, 1.5], recover: 0.60, press: 0.00, burst: 4, rangeErr: 0.30, adjust: 0.10, lead: [0.30, 0.50], drop: 2.2, rise: 1.6, rushMax: 9, coverR: 0, suppK: 1.7, pinAt: 0.55, calm: 6.0, reload: 6.0, tac: 0, nerve: 0.35, aid: 0, moveFire: 1, ammoDisc: 0 },
    thug:  { fear: 13, detect: 0.24, acq: 1.6, settle: 0.75, hold: [2.7, 1.9, 1.15], recover: 0.45, press: 0.30, burst: 3, rangeErr: 0.22, adjust: 0.25, lead: [0.50, 0.40], drop: 1.7, rise: 1.4, rushMax: 7, coverR: 3, suppK: 1.35, pinAt: 0.85, calm: 4.5, reload: 4.4, tac: 0, nerve: 0.48, aid: 6, moveFire: 1, ammoDisc: 0 },
    pro:   { fear: 8.5, detect: 0.36, acq: 1.15, settle: 0.55, hold: [1.95, 1.35, 0.80], recover: 0.33, press: 0.58, burst: 2, rangeErr: 0.15, adjust: 0.45, lead: [0.75, 0.25], drop: 1.3, rise: 1.1, rushMax: 5, coverR: 6, suppK: 1.00, pinAt: 1.25, calm: 3.2, reload: 3.0, tac: 1, nerve: 0.62, aid: 15, moveFire: 0.4, ammoDisc: 0.25 },
    elite: { fear: 6, detect: 0.52, acq: 0.80, settle: 0.38, hold: [1.35, 0.95, 0.52], recover: 0.24, press: 0.80, burst: 1, rangeErr: 0.10, adjust: 0.65, lead: [0.90, 0.15], drop: 1.0, rise: 0.9, rushMax: 4, coverR: 10, suppK: 0.72, pinAt: 1.8, calm: 2.2, reload: 2.4, tac: 1, nerve: 0.76, aid: 25, moveFire: 0.15, ammoDisc: 0.33 },
    swat:  { fear: 5, detect: 0.62, acq: 0.62, settle: 0.30, hold: [1.10, 0.80, 0.45], recover: 0.20, press: 0.86, burst: 1, rangeErr: 0.08, adjust: 0.75, lead: [0.95, 0.10], drop: 0.9, rise: 0.8, rushMax: 3.5, coverR: 12, suppK: 0.60, pinAt: 2.2, calm: 1.8, reload: 2.1, tac: 1, nerve: 0.85, aid: 25, moveFire: 0.1, ammoDisc: 0.33 },
  };
  const TRN_IDS = ["civ", "thug", "pro", "elite", "swat"];

  /* ============================================================ THE LINE OF BATTLE: DRILL
     An ancient army's men (countries.js era "ancient") fight in CLOSE ORDER:
     blocks of men in files and ranks that move, wheel and fight as one body,
     because a man alone with a sword is dead and a wall of shields is not.
     One row per training level (the same TRAININGS ids: a levy, a warband, a
     citizen militia, a professional legion, a guard). Units:
       march quick charge   m/s of the block: in step on the approach, the
                            quick step inside bowshot, the run into contact
                            (a legion marched ~4.8 km/h; Caesar's men ran the
                            last stretch, BG 1.52)
       fileW rankD          m a man takes across and in depth in fighting order
                            (Polybius 18.30: three feet of his own and three
                            between him and the next, ~1.8 m; we take 1.5)
       closeW closeD        the locked shield wall at contact
       testW testD          the testudo (Dio 49.30, Plutarch Antony 45): the
                            shields locked over the head and round the sides,
                            the men packed to a shield's width
       testudo              he knows it (1) or not (0)
       pilumR               m: the throwing spear is let go inside this
                            (effective 15-20 m, Connolly; the heavy one first)
       skill                0..1: how he fights with the sword and shield
       strikeT              s between blows in the press (a fight of minutes,
                            not seconds: men held off behind the shields)
       nerve                the pressure (losses + strain) the block breaks at
       suppK                how much the crack of a round frightens him (a
                            noise nobody in his world had heard)
       drill                0..1: how hard the block holds its order (it waits
                            for its stragglers, it closes its gaps)
       relief               the front rank is relieved by the next (1) or not
       turn                 rad/s the block wheels at                       */
  const ANC = {
    civ:   { march: 1.05, quick: 1.4, charge: 3.4, fileW: 1.3, rankD: 1.7, closeW: 1.15, closeD: 1.4, testW: 1.0, testD: 1.0, testudo: 0, pilumR: 0,  skill: 0.22, strikeT: 2.6, nerve: 0.42, suppK: 1.5, drill: 0.25, relief: 0, turn: 0.16 },
    thug:  { march: 1.2,  quick: 1.7, charge: 4.2, fileW: 1.6, rankD: 1.8, closeW: 1.3,  closeD: 1.5, testW: 1.0, testD: 1.0, testudo: 0, pilumR: 16, skill: 0.45, strikeT: 1.9, nerve: 0.62, suppK: 1.25, drill: 0.35, relief: 0, turn: 0.22 },
    pro:   { march: 1.15, quick: 1.55, charge: 3.8, fileW: 1.4, rankD: 1.7, closeW: 1.0,  closeD: 1.3, testW: 0.85, testD: 0.95, testudo: 0, pilumR: 18, skill: 0.5,  strikeT: 2.0, nerve: 0.72, suppK: 1.15, drill: 0.6, relief: 0, turn: 0.26 },
    elite: { march: 1.25, quick: 1.6, charge: 4.0, fileW: 1.5, rankD: 1.8, closeW: 1.0,  closeD: 1.25, testW: 0.74, testD: 0.86, testudo: 1, pilumR: 20, skill: 0.66, strikeT: 1.7, nerve: 0.9, suppK: 1.0, drill: 0.9, relief: 1, turn: 0.32 },
    swat:  { march: 1.25, quick: 1.65, charge: 4.1, fileW: 1.5, rankD: 1.8, closeW: 1.0,  closeD: 1.25, testW: 0.74, testD: 0.86, testudo: 1, pilumR: 20, skill: 0.76, strikeT: 1.6, nerve: 0.97, suppK: 0.9, drill: 0.95, relief: 1, turn: 0.34 },
  };
  /* THE BLADES. reach: m of blade and arm past his shoulder; the wound a blow
     that lands does by where it lands (now: the share of him it takes at once;
     bleed: per second); pen: the odds a thrust goes through iron (mail, the
     segmented plates) where a cut would not. The gladius was a thrusting
     sword (Vegetius 1.12: "a thrust of two inches is fatal"). The bayonet and
     the butt are what a rifleman has when the magazine is empty. */
  const MELEE = {
    gladius: { reach: 0.78, now: [0.5, 0.9], bleed: 0.045, pen: 0.45, thrust: true },
    spear:   { reach: 1.6,  now: [0.45, 0.85], bleed: 0.04, pen: 0.4, thrust: true },
    bayonet: { reach: 0.95, now: [0.4, 0.8], bleed: 0.04, pen: 0.35, thrust: true },
  };
  /* THE SHIELDS. A scutum (Fayum find): 1.28 x 0.63 m, curved, three layers
     of birch strips (~6-10 mm) under calf hide, an iron boss: 7-10 kg. It turns
     a blade, a stone and most arrows; it stops a throwing spear's head, which
     then hangs in it (and the man drops it, which was the point of the pilum).
     It does not stop a rifle round: that goes through 10 mm of wood and keeps
     nearly all of its speed (the round is flown through it, below).
       w h y0   its size and its bottom edge over the ground, carried
       block    the odds a blow he sees coming lands on it               */
  const SHIELDS = {
    scutum: { w: 0.64, h: 1.06, y0: 0.32, block: 0.66, wood: 0.01 },
    aspis:  { w: 0.9,  h: 0.9,  y0: 0.55, block: 0.6,  wood: 0.012 },
  };
  // what a man of the line is doing, for the renderer (G.stc)
  const STC = { carry: 0, wall: 1, roof: 2, fight: 3, charge: 4, throw: 5, rout: 6, side: 7 };
  // the block's state
  const BM = { march: 0, testudo: 1, quick: 2, volley: 3, charge: 4, melee: 5, rout: 6, hold: 7 };

  // the body for the eye: where on him a sight line is aimed (height above
  // his feet, m) and the area that point stands for (m2), by posture. A prone
  // man end-on shows his helmet and shoulders; side-on his whole length.
  const LOOK = [
    [[1.66, 0.05], [1.30, 0.17], [0.92, 0.15], [0.45, 0.30]],        // stand
    [[1.08, 0.05], [0.78, 0.15], [0.38, 0.12]],                       // kneel
    [[0.30, 0.045], [0.18, 0.07]],                                    // prone (end-on)
  ];
  const EYE = [1.62, 1.05, 0.33];            // eye height by posture
  const LOOK_ALL = [0.67, 0.32, 0.52];      // the most of him that can show, by posture (prone: side-on)
  const MUZ = [1.45, 0.98, 0.27];            // the muzzle
  const AIMY = [1.28, 0.80, 0.22];           // a centre-of-mass aim
  const HALF = [[0.20, 0.55], [0.20, 0.38], [0.22, 0.14]];   // half width, half height of the mass he aims at
  // (walk: a tactical pace in formation, eyes out; march: a route march with
  // kit, far from the enemy; run and rush: under fire or catching up)
  const SPEED = { walk: 1.45, march: 1.75, rush: 4.2, crawl: 0.45, run: 3.4 };
  const SIGHT_R = 700;                       // nobody is looked for past this

  // an army's morale record, in CBZ.brain.morale.armyStep's shape
  function armyRec() { return { p0: 0, pNow: 0, men0: 0, morale: 1, shock: 0, alive: 0, routing: 0, fled: 0, broken: false }; }
  function create(S, cfg) {
    cfg = cfg || {};
    const B = CBZ.ballistics;
    if (!B) throw new Error("battleInfantry needs CBZ.ballistics");
    const AR = CBZ.armour || null;
    let seed = (cfg.seed >>> 0) || 0x2545F491;
    // the day's wind (m/s, a horizontal vector): the host's, else a breeze off the seed
    // the dice: mulberry32 (xorshift32's consecutive outputs are correlated, and the two
    // sides' men draw alternately within a step)
    function rnd() { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    function gauss() { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); }
    // who each man is (his habits) is the battle's, not his row number's
    const SALT = Math.imul((cfg.seed >>> 0) || 1, 0x27D4EB2F) | 0;

    const C = S.cols;
    const F = Float32Array, I32 = Int32Array, U8 = Uint8Array, I16 = Int16Array;
    function cols() {
      S.col("typ", U8); S.col("sqd", I32, -1); S.col("slot", U8);
      S.col("post", U8); S.col("postTo", U8); S.col("postT", F);
      S.col("mv", U8); S.col("gx", F); S.col("gz", F); S.col("rushT", F); S.col("face", F);
      S.col("tgt", I32, -1); S.col("tgtT", F); S.col("seenT", F, -99); S.col("lkx", F); S.col("lkz", F); S.col("lkT", F, -99);
      S.col("cand", I32, -1); S.col("det", F); S.col("detN", F); S.col("expo", F); S.col("scan", U8); S.col("spotT", F); S.col("clT", F, -99); S.col("cl0", I32, -1); S.col("cl1", I32, -1); S.col("cl2", I32, -1); S.col("cl3", I32, -1);
      for (const s of ["e0", "e1"]) { S.col(s + "o", I32, -1); S.col(s + "t", F); S.col(s + "v", F); S.col(s + "k", U8); S.col(s + "x", F); S.col(s + "z", F); S.col(s + "X", F); S.col(s + "Z", F); }
      S.col("acqT", F); S.col("aimT", F); S.col("cool", F); S.col("burst", U8);
      S.col("mag", I16); S.col("ammo", I16); S.col("reloadT", F); S.col("heat", F); S.col("rngE", F); S.col("rngTgt", I32, -1);
      S.col("supp", F); S.col("stress", F); S.col("cap", F); S.col("bleed", F); S.col("down", U8); S.col("aidBy", I32, -1); S.col("aidOn", I32, -1); S.col("aidEnd", F);
      S.col("pin", U8); S.col("flashT", F, -99); S.col("thinkAt", F); S.col("contactT", F, -99); S.col("crackT", F, -99);
      S.col("hitX", F); S.col("hitZ", F); S.col("shots", I32); S.col("hits", I32);
      S.col("plF", U8); S.col("plB", U8); S.col("plS", U8); S.col("helm", U8);
      S.col("inF", F, 1); S.col("inB", F, 1); S.col("inS", F, 1); S.col("inH", F, 1); S.col("plSo", U8); S.col("inSo", F, 1);
      S.col("vx", F); S.col("vz", F);
      S.col("ext", U8); S.col("extW", F); S.col("extH", F); S.col("extMM", F);
      // THE LINE OF BATTLE (an ancient army's men): his block and his place in
      // it (file, rank as formed, rank now), the slot's offset off the block's
      // front, his shield, his throwing spears, how tired his arm is, what he
      // is doing (STC), his next blow, when he lets his spear go, engaged
      S.col("anc", U8); S.col("blk", I32, -1); S.col("bfl", U8); S.col("brk0", U8); S.col("brk", U8);
      S.col("bsx", F); S.col("bsb", F); S.col("shd", U8); S.col("pil", U8); S.col("pvol", U8);
      S.col("fat", F); S.col("stc", U8); S.col("swT", F); S.col("thrT", F, -99); S.col("eng", U8);
    }
    cols();
    /* THE COLUMNS, AS A FAST OBJECT. The store's `cols` collects its ~90
       columns one at a time, and an object grown that way is a hash table to
       V8: every G.x[r] was a dictionary lookup. One literal naming them all
       has a fixed shape. Rebuilt whenever the store grows. */
    function bindG(c) {
      return {
        x: c.x, y: c.y, z: c.z, heading: c.heading, hp: c.hp, maxHp: c.maxHp, side: c.side, kind: c.kind, tier: c.tier, life: c.life, squad: c.squad,
        typ: c.typ, sqd: c.sqd, slot: c.slot, post: c.post, postTo: c.postTo, postT: c.postT, mv: c.mv, gx: c.gx, gz: c.gz, rushT: c.rushT, face: c.face,
        tgt: c.tgt, tgtT: c.tgtT, seenT: c.seenT, lkx: c.lkx, lkz: c.lkz, lkT: c.lkT, cand: c.cand, det: c.det, detN: c.detN, expo: c.expo, scan: c.scan, spotT: c.spotT, clT: c.clT, cl0: c.cl0, cl1: c.cl1, cl2: c.cl2, cl3: c.cl3,
        e0o: c.e0o, e0t: c.e0t, e0v: c.e0v, e0k: c.e0k, e0x: c.e0x, e0z: c.e0z, e0X: c.e0X, e0Z: c.e0Z,
        e1o: c.e1o, e1t: c.e1t, e1v: c.e1v, e1k: c.e1k, e1x: c.e1x, e1z: c.e1z, e1X: c.e1X, e1Z: c.e1Z,
        acqT: c.acqT, aimT: c.aimT, cool: c.cool, burst: c.burst, mag: c.mag, ammo: c.ammo, reloadT: c.reloadT, heat: c.heat, rngE: c.rngE, rngTgt: c.rngTgt,
        supp: c.supp, stress: c.stress, cap: c.cap, bleed: c.bleed, down: c.down, aidBy: c.aidBy, aidOn: c.aidOn, aidEnd: c.aidEnd, pin: c.pin,
        flashT: c.flashT, thinkAt: c.thinkAt, contactT: c.contactT, crackT: c.crackT, hitX: c.hitX, hitZ: c.hitZ, shots: c.shots, hits: c.hits,
        plF: c.plF, plB: c.plB, plS: c.plS, helm: c.helm, inF: c.inF, inB: c.inB, inS: c.inS, inH: c.inH, plSo: c.plSo, inSo: c.inSo, vx: c.vx, vz: c.vz, ext: c.ext, extW: c.extW, extH: c.extH, extMM: c.extMM,
        anc: c.anc, blk: c.blk, bfl: c.bfl, brk0: c.brk0, brk: c.brk, bsx: c.bsx, bsb: c.bsb, shd: c.shd, pil: c.pil, pvol: c.pvol,
        fat: c.fat, stc: c.stc, swT: c.swT, thrT: c.thrT, eng: c.eng,
      };
    }
    let G = bindG(S.cols);
    S.onGrow(function () { G = bindG(S.cols); });

    const I = {
      S: S, simT: 0, types: [], events: new F(4096 * 4), nEv: 0, shots: new F(1024 * SHOT_F), nShot: 0,
      ms: { grid: 0, think: 0, move: 0, fire: 0, rounds: 0, squad: 0, total: 0 },
      stats: { shots: [0, 0], hits: [0, 0], kills: [0, 0], downs: [0, 0], fled: [0, 0], thinks: 0, los: 0, rounds: 0 },
      led: { shotsAt: [0, 0, 0, 0, 0, 0, 0], hitsAt: [0, 0, 0, 0, 0, 0, 0], organs: { brain: 0, spine: 0, vital: 0, gut: 0, torso: 0, head: 0, limb: 0, plate: 0 },
        plate: 0, platePen: 0, firstShot: [-1, -1], firstHit: [-1, -1], firstSee: [-1, -1], firstSeeD: [0, 0], cracks: 0, aids: 0, posts: 0, rushes: 0, pins: 0 },
      order: [{ kind: "advance", x: 0, z: 0 }, { kind: "advance", x: 0, z: 0 }],
      // the army's morale: the host's (it steps one over every body it has: I.armySelf = false),
      // else this sim's own, by the same rule (CBZ.brain.morale.armyStep) over its own men
      army: [armyRec(), armyRec()], armySelf: true,
      camX: 0, camZ: 0, shotR: 0, EV: EV, POST: POST, LIFE: LIFE, MOVE: MOVE, DOCTRINE: DOCTRINE,
    };
    const now = (typeof performance !== "undefined" && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };
    {
      const wa = rnd() * 6.283185, ws = rnd() * 4.5;          // calm to a fresh breeze
      I.wind = cfg.wind ? { x: cfg.wind.x, z: cfg.wind.z } : { x: Math.sin(wa) * ws, z: Math.cos(wa) * ws };
    }

    /* ------------------------------------------------------------ unit types
       spec: { trn, gun, optic, kit: { plates, sides, helmet }, look } */
    const PLATE_IDX = { none: 0 };
    const PLATES = [null];
    function plateIdx(id) {
      if (!id || !AR || !AR.CLASSES[id]) return 0;
      if (PLATE_IDX[id] != null) return PLATE_IDX[id];
      PLATES.push(AR.CLASSES[id]); PLATE_IDX[id] = PLATES.length - 1;
      return PLATE_IDX[id];
    }
    I.unitType = function (spec) {
      const key = JSON.stringify(spec);
      for (let i = 0; i < I.types.length; i++) if (I.types[i].key === key) return i;
      const D = DOCTRINE[spec.trn] || DOCTRINE.pro;
      const g = B.gun(spec.gun) || B.gun("carbine");
      const c = g && g.cart ? B.CART[g.cart] : B.CART["556"];
      const w = CBZ.weaponById ? CBZ.weaponById(spec.gun) : null;
      const kit = spec.kit || {};
      const t = {
        key: key, spec: spec, D: D, trn: spec.trn, g: g, c: c, gunId: spec.gun,
        v0: B.muzzleV(spec.gun, w), k: B.dragOf(spec.gun, w),
        magSize: (w && (w.magSize || w.mag)) || (g.cls === "lmg" ? 100 : 30),
        interval: Math.max(0.06, (w && (w.fireDelay || w.interval)) || 0.09),
        optic: spec.optic || 0, mech: B.moaSigma(g.moa || 4),
        plate: plateIdx(kit.plates), side: plateIdx(kit.sides), helm: plateIdx(kit.helmet), soft: plateIdx(kit.soft),
        armed: spec.gun && spec.gun !== "fists",
        thr: AR && c ? (AR.ROUNDS[c === B.CART["556"] ? "556" : c === B.CART["762x39"] ? "762x39" : c === B.CART["762x51"] ? "762x51" : c === B.CART["9x19"] ? "9mm" : "556"] || null) : null,
      };
      t.carry = g.carry || 180;
      /* A MAN OF THE LINE OF BATTLE (spec.anc: { sword, pila, shield, body,
         helmet }): no rifle. His doctrine is ANC[trn] (the drill of his
         training), his rifle-shaped doctrine row is kept for the shared rules
         (the rattle, the nerve, the calm) with his own nerve and fear of the
         noise; his armour is the real iron (systems/armour.js classes). */
      if (spec.anc) {
        const A = ANC[spec.trn] || ANC.elite, a = spec.anc;
        t.anc = true; t.armed = false; t.A = A;
        t.M = MELEE[a.sword] || MELEE.gladius;
        t.pila = a.pila | 0;
        t.SH = SHIELDS[a.shield] || null;
        t.D = Object.assign({}, D, { pinAt: 99, suppK: A.suppK, nerve: A.nerve, calm: 5, aid: 0, coverR: 0 });
        t.plate = 0; t.side = 0;
        t.soft = plateIdx(a.body); t.helm = plateIdx(a.helmet);
        t.magSize = 0; t.carry = 0;
      } else t.M = MELEE.bayonet;
      t.idx = I.types.length;
      I.types.push(t);
      return t.idx;
    };

    /* ------------------------------------------------------------ squads
       ten men: slot 0 leads, 1-4 alpha, 5-9 bravo. The host names the id. */
    const SQ = { n: 0, side: new U8(0), mem: new I32(0), cnt: new U8(0), task: new U8(0), at: new F(0), lead: new I32(0),
      cx: new F(0), cz: new F(0), contact: new F(0), bound: new U8(0), boundT: new F(0), thx: new F(0), thz: new F(0), hurt: new U8(0), fx: new F(0), fz: new F(0),
      lostT: new F(0), brkX: new F(0), brkZ: new F(0), brkT: new F(0), lastC: new F(0),
      oK: new U8(0), oX: new F(0), oZ: new F(0), fireT: new F(0), flX: new F(0), flZ: new F(0), flT: new F(0), anc: new U8(0) };
    const TASK = { advance: 0, contact: 1, base: 2, bound: 3, assault: 4, hold: 5, breakc: 6, gone: 7, overwatch: 8, flank: 9 };
    I.TASK = TASK;
    let sqCap = 0;
    function sqGrow(n) {
      if (n <= SQ.n) return;
      if (n > sqCap) {
        const cap = Math.max(n, sqCap * 2, 16);
        for (const k in SQ) {
          if (k === "n" || k === "mem") continue;
          const a = new SQ[k].constructor(cap); if (k === "lead") a.fill(-1); a.set(SQ[k].subarray(0, Math.min(SQ[k].length, cap))); SQ[k] = a;      // (a squad has no leader until its first tick names one)
        }
        const m = new I32(cap * 10).fill(-1); m.set(SQ.mem.subarray(0, Math.min(SQ.mem.length, cap * 10))); SQ.mem = m;
        sqCap = cap;
      }
      SQ.n = n;
    }
    I.squads = SQ;
    /* A SQUAD'S OWN ORDER (a host that fields forces: Gang City): march on
       (x, z) and fight there ("advance"), or go there and hold it ("hold").
       null hands it back to its side's order. */
    const _sqo = { kind: "advance", x: 0, z: 0 };
    I.squadOrder = function (sq, o) {
      if (sq < 0) return;
      sqGrow(sq + 1);
      if (!o) { SQ.oK[sq] = 0; return; }
      SQ.oK[sq] = o.kind === "hold" ? 2 : o.kind === "move" ? 3 : 1; SQ.oX[sq] = o.x; SQ.oZ[sq] = o.z;
    };
    function orderOf(sq, side) {
      if (sq >= 0 && SQ.oK[sq]) { _sqo.kind = SQ.oK[sq] === 2 ? "hold" : SQ.oK[sq] === 3 ? "move" : "advance"; _sqo.x = SQ.oX[sq]; _sqo.z = SQ.oZ[sq]; return _sqo; }
      return I.order[side];
    }

    I.add = function (r, type, sq, slot, side) {
      const t = I.types[type];
      G.typ[r] = type; G.sqd[r] = sq == null ? -1 : sq; G.slot[r] = slot | 0;
      G.post[r] = POST.stand; G.postTo[r] = POST.stand; G.postT[r] = 0;
      G.mv[r] = MOVE.hold; G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; G.rushT[r] = 0; G.face[r] = G.heading[r];
      G.tgt[r] = -1; G.tgtT[r] = 0; G.seenT[r] = -99; G.lkT[r] = -99; G.cand[r] = -1; G.det[r] = 0; G.expo[r] = 0;
      G.e0o[r] = -1; G.e1o[r] = -1; G.scan[r] = 0; G.clT[r] = -99; G.spotT[r] = 0;
      G.acqT[r] = 0; G.aimT[r] = 0; G.cool[r] = 0; G.burst[r] = 0;
      G.mag[r] = t.armed ? t.magSize : 0; G.ammo[r] = t.armed ? t.carry : 0; G.reloadT[r] = 0; G.heat[r] = 0; G.rngE[r] = 0; G.rngTgt[r] = -1;
      G.supp[r] = 0; G.stress[r] = 0; G.cap[r] = 1; G.bleed[r] = 0; G.down[r] = 0; G.aidBy[r] = -1; G.aidOn[r] = -1; G.aidEnd[r] = 0;
      G.flashT[r] = -99; G.thinkAt[r] = I.simT + rnd() * 0.25; G.contactT[r] = -99; G.crackT[r] = -99;
      G.shots[r] = 0; G.hits[r] = 0; G.vx[r] = 0; G.vz[r] = 0;
      G.plF[r] = t.plate; G.plB[r] = t.plate; G.plS[r] = t.side; G.helm[r] = t.helm;
      G.inF[r] = 1; G.inB[r] = 1; G.inS[r] = 1; G.inH[r] = 1; G.plSo[r] = t.soft; G.inSo[r] = 1;
      G.hp[r] = G.maxHp[r] = 100;
      if (side != null) G.side[r] = side;
      G.life[r] = LIFE.alive;
      G.y[r] = hAt(G.x[r], G.z[r]);
      G.anc[r] = t.anc ? 1 : 0; G.blk[r] = -1; G.eng[r] = 0; G.fat[r] = 0; G.swT[r] = 0; G.thrT[r] = -99; G.pvol[r] = 0;
      G.shd[r] = t.anc && t.SH ? 1 : 0; G.pil[r] = t.anc ? t.pila : 0; G.stc[r] = 0;
      if (t.anc) I.ancN = (I.ancN || 0) + 1;
      if (sq != null && sq >= 0) {
        sqGrow(sq + 1);
        SQ.side[sq] = G.side[r];
        if (t.anc) SQ.anc[sq] = 1;
        const s = slot | 0;
        if (s < 10) SQ.mem[sq * 10 + s] = r;
        if (SQ.cnt[sq] < s + 1) SQ.cnt[sq] = s + 1;
      }
      I.nRows = Math.max(I.nRows || 0, r + 1);
      { const A = I.army[G.side[r]]; A.p0 += manW(r); A.men0++; }
    };
    I.order = function (side, o) { I.order[side] = o; I.orders[side] = o; };
    I.orders = I.order;   // (the same array: order[side])
    I.order[0] = { kind: "advance", x: 0, z: 0 }; I.order[1] = { kind: "advance", x: 0, z: 0 };

    /* ------------------------------------------------------------ the ground and the cover */
    const ground = cfg.ground || null, groundFn = typeof cfg.groundAt === "function" ? cfg.groundAt : null;
    // a height array made in another realm (a tool's, a worker's message) is
    // adopted into this one: a foreign typed array makes every read polymorphic
    if (ground && !(ground.hgt instanceof F)) ground.hgt = new F(ground.hgt);
    const gX0 = ground ? ground.x0 : 0, gZ0 = ground ? ground.z0 : 0, gIC = ground ? 1 / ground.cell : 1;
    const gW = ground ? ground.w : 0, gH = ground ? ground.h : 0, GH = ground ? ground.hgt : null;
    function hAt(x, z) {
      if (!GH) return groundFn ? groundFn(x, z) : 0;
      const fx = (x - gX0) * gIC, fz = (z - gZ0) * gIC;
      let ix = fx | 0, iz = fz | 0;                  // (the field is laid from its corner: no negatives inside it)
      if (fx < 0) ix = 0; else if (ix > gW - 2) ix = gW - 2;
      if (fz < 0) iz = 0; else if (iz > gH - 2) iz = gH - 2;
      let tx = fx - ix, tz = fz - iz;
      tx = tx < 0 ? 0 : tx > 1 ? 1 : tx; tz = tz < 0 ? 0 : tz > 1 ? 1 : tz;
      const k = iz * gW + ix;
      const h0 = GH[k], h1 = GH[k + gW];
      const a = h0 + (GH[k + 1] - h0) * tx, b = h1 + (GH[k + gW + 1] - h1) * tx;
      return a + (b - a) * tz;
    }
    I.groundAt = hAt;
    const cover = cfg.cover || null;
    // the cover standing on the ground here (m above it) and its material index
    function coverAt(x, z) {
      if (!cover) return 0;
      const ix = Math.floor((x - cover.x0) / cover.cell), iz = Math.floor((z - cover.z0) / cover.cell);
      if (ix < 0 || iz < 0 || ix >= cover.w || iz >= cover.h) return 0;
      return cover.top[iz * cover.w + ix];
    }
    function coverMat(x, z) {
      const ix = Math.floor((x - cover.x0) / cover.cell), iz = Math.floor((z - cover.z0) / cover.cell);
      return cover.mats[cover.mat[iz * cover.w + ix]] || "concrete";
    }
    I.coverAt = coverAt;
    /* A SIGHT LINE over the ground and the cover. The ends are sampled fine
       (a lip of earth a stride in front of a prone man is what hides him)
       and the middle coarse. The two footings never count. */
    /* THE HIGHEST POINT OF EACH 8 m CELL (ground + cover), so a sight line
       or a round skips every cell it passes over clear of: the same answer
       as sampling it, without the samples. Built once; a host that changes
       the ground (a crater) calls I.groundChanged(x0, z0, x1, z1). */
    const MIPC = 8;
    let mip = null, slp = null, cov = null, mw = 0, mh = 0, mx0 = 0, mz0 = 0;
    function mipCell(ix, iz) {
      const x0 = mx0 + ix * MIPC, z0 = mz0 + iz * MIPC;
      let m = -1e9;
      const st = ground ? Math.min(MIPC, ground.cell) : MIPC;
      for (let z = z0 - st; z <= z0 + MIPC + st + 1e-6; z += st) for (let x = x0 - st; x <= x0 + MIPC + st + 1e-6; x += st) {
        const h = hAt(x, z) + (cover ? coverAt(x, z) : 0);
        if (h > m) m = h;
      }
      return m;
    }
    // from the vertex array: every ground cell's four corners into each 8 m
    // cell it overlaps (bilinear ground never rises above its corners), then
    // the cover, conservatively (the cell's highest ground plus the cover's top)
    function buildMip() {
      if (!ground) return;
      mx0 = ground.x0; mz0 = ground.z0;
      const gc = ground.cell, gw = ground.w, gh = ground.h, H = ground.hgt;
      mw = Math.ceil((gw - 1) * gc / MIPC) + 1; mh = Math.ceil((gh - 1) * gc / MIPC) + 1;
      mip = new F(mw * mh).fill(-1e9);
      slp = new F(mw * mh);
      cov = new U8(mw * mh);
      for (let iz = 0; iz < gh - 1; iz++) {
        const c0 = Math.floor(iz * gc / MIPC), c1 = Math.min(mh - 1, Math.floor((iz + 1) * gc / MIPC));
        for (let ix = 0; ix < gw - 1; ix++) {
          const k = iz * gw + ix;
          const h00 = H[k], h10 = H[k + 1], h01 = H[k + gw], h11 = H[k + gw + 1];
          let m = h00; if (h10 > m) m = h10; if (h01 > m) m = h01; if (h11 > m) m = h11;
          // the bilinear patch's steepest slope: its gradient's parts are the edge differences
          const gx = Math.max(Math.abs(h10 - h00), Math.abs(h11 - h01)) / gc, gz = Math.max(Math.abs(h01 - h00), Math.abs(h11 - h10)) / gc;
          const s = Math.sqrt(gx * gx + gz * gz);
          const a0 = Math.floor(ix * gc / MIPC), a1 = Math.min(mw - 1, Math.floor((ix + 1) * gc / MIPC));
          for (let cz = c0; cz <= c1; cz++) for (let cx = a0; cx <= a1; cx++) { const q = cz * mw + cx; if (m > mip[q]) mip[q] = m; if (s > slp[q]) slp[q] = s; }
        }
      }
      if (cover) {
        const top = new F(mw * mh);
        for (let iz = 0; iz < cover.h; iz++) for (let ix = 0; ix < cover.w; ix++) {
          const t = cover.top[iz * cover.w + ix];
          if (!(t > 0)) continue;
          const x0 = cover.x0 + ix * cover.cell, z0 = cover.z0 + iz * cover.cell;
          const a0 = Math.max(0, Math.floor((x0 - mx0) / MIPC)), a1 = Math.min(mw - 1, Math.floor((x0 + cover.cell - mx0) / MIPC));
          const c0 = Math.max(0, Math.floor((z0 - mz0) / MIPC)), c1 = Math.min(mh - 1, Math.floor((z0 + cover.cell - mz0) / MIPC));
          for (let cz = c0; cz <= c1; cz++) for (let cx = a0; cx <= a1; cx++) { const q = cz * mw + cx; if (t > top[q]) top[q] = t; cov[q] = 1; }
        }
        for (let q = 0; q < mip.length; q++) mip[q] += top[q];
      }
    }
    // one pyramid per field: battles fought on the same ground share it (the cover is part of it)
    if (ground && ground._mip && ground._mipCover === cover) { mip = ground._mip; slp = ground._mipS; cov = ground._mipC; mx0 = ground.x0; mz0 = ground.z0; mw = ground._mipW; mh = ground._mipH; }
    else { buildMip(); if (ground) { ground._mip = mip; ground._mipS = slp; ground._mipC = cov; ground._mipCover = cover; ground._mipW = mw; ground._mipH = mh; } }
    I.groundChanged = function (x0, z0, x1, z1) {
      if (!mip) return;
      const a = Math.max(0, Math.floor((x0 - mx0) / MIPC) - 1), b = Math.min(mw - 1, Math.floor((x1 - mx0) / MIPC) + 1);
      const c = Math.max(0, Math.floor((z0 - mz0) / MIPC) - 1), e = Math.min(mh - 1, Math.floor((z1 - mz0) / MIPC) + 1);
      for (let iz = c; iz <= e; iz++) for (let ix = a; ix <= b; ix++) mip[iz * mw + ix] = mipCell(ix, iz);
    };
    /* A SIGHT LINE over the ground and the cover. The ends are sampled fine
       (a lip of earth a stride in front of a prone man is what hides him),
       the rest at the ground's own resolution, and only where the line is
       not clear above the cell's highest point. The two footings never count. */
    // who asked for a sight line (the cost ledger: I.stats.losBy)
    const LOS_TAG = ["eye", "glance", "spot", "post", "area", "round"];
    let losTag = 0;
    I.stats.losBy = new F(LOS_TAG.length);
    I.LOS_TAG = LOS_TAG;
    function lineClear(ax, ay, az, bx, by, bz) {
      I.stats.los++;
      I.stats.losBy[losTag]++;
      const dx = bx - ax, dz = bz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.8) return true;
      const dy = by - ay;
      const s0 = 0.35, s1 = d - 0.35;
      const fine = Math.min(7, d * 0.5);
      const coarse = ground ? Math.max(ground.cell * 0.8, Math.min(3, d / 100)) : Math.max(1.5, Math.min(4, d / 80));
      if (!mip) {
        let s = s0;
        while (s < s1) {
          const t = s / d, x = ax + dx * t, z = az + dz * t;
          if (hAt(x, z) + (cover ? coverAt(x, z) : 0) > ay + dy * t) return false;
          s += (s < fine || s > d - fine) ? 0.5 : coarse;
        }
        return true;
      }
      // walk the 8 m cells the line crosses (DDA), sampling only the ones it is not clear over
      const ux = dx / d, uz = dz / d, slope = dy / d;
      let s = s0;
      while (s < s1) {
        const x = ax + ux * s, z = az + uz * s;
        let ix = Math.floor((x - mx0) / MIPC), iz = Math.floor((z - mz0) / MIPC);
        // where the line leaves this cell
        let sx = Infinity, sz = Infinity;
        if (ux > 1e-9) sx = ((mx0 + (ix + 1) * MIPC) - x) / ux; else if (ux < -1e-9) sx = ((mx0 + ix * MIPC) - x) / ux;
        if (uz > 1e-9) sz = ((mz0 + (iz + 1) * MIPC) - z) / uz; else if (uz < -1e-9) sz = ((mz0 + iz * MIPC) - z) / uz;
        let se = s + Math.min(sx, sz) + 1e-4;
        if (se > s1) se = s1;
        if (ix < 0) ix = 0; else if (ix >= mw) ix = mw - 1;
        if (iz < 0) iz = 0; else if (iz >= mh) iz = mh - 1;
        const q = iz * mw + ix;
        const lo = ay + slope * (slope > 0 ? s : se);
        if (lo > mip[q]) { s = se; continue; }
        if (cov[q]) {
          // cover in this cell (walls are not slopes): sample it
          while (s < se) {
            const xx = ax + ux * s, zz = az + uz * s;
            if (hAt(xx, zz) + coverAt(xx, zz) > ay + slope * s) return false;
            s += (s < fine || s > d - fine) ? 0.5 : coarse;
          }
        } else {
          /* bare ground: sphere-trace it. From a point where the line is c
             over the ground, the ground (no steeper than slp) cannot reach
             the line within c / (slp + |line slope|): step that far. */
          const k = slp[q] + Math.abs(slope) + 1e-3;
          while (s < se) {
            // (the bilinear ground, inline: this loop is most of the sim's time)
            const fx = (ax + ux * s - gX0) * gIC, fz = (az + uz * s - gZ0) * gIC;
            let ix2 = fx | 0, iz2 = fz | 0;
            if (fx < 0) ix2 = 0; else if (ix2 > gW - 2) ix2 = gW - 2;
            if (fz < 0) iz2 = 0; else if (iz2 > gH - 2) iz2 = gH - 2;
            let tx = fx - ix2, tz = fz - iz2;
            tx = tx < 0 ? 0 : tx > 1 ? 1 : tx; tz = tz < 0 ? 0 : tz > 1 ? 1 : tz;
            const kk = iz2 * gW + ix2, h0 = GH[kk], h1 = GH[kk + gW];
            const ga = h0 + (GH[kk + 1] - h0) * tx, gb = h1 + (GH[kk + gW + 1] - h1) * tx;
            const c = ay + slope * s - (ga + (gb - ga) * tz);
            if (c < 0) return false;
            s += c > 0.2 * k ? c / k : 0.2;
          }
        }
        s = se;
      }
      return true;
    }
    I.lineClear = lineClear;

    /* ------------------------------------------------------------ the grids
       per side, 32 m cells, rebuilt by counting sort: who a man may look for.
       The body grid, 4 m cells, both sides: who a round may hit, who a near
       miss rattles. The presence grid, 128 m cells per side: "is there any
       enemy within sight range at all" in one lookup (an exact shortcut). */
    function mkGrid(cell) { return { cell: cell, ic: 1 / cell, x0: 0, z0: 0, w: 0, h: 0, start: new I32(2), list: new I32(0), n: 0 }; }
    const GE = [mkGrid(32), mkGrid(32)], GP = [mkGrid(128), mkGrid(128)];
    let ext = { x0: -1000, z0: -1000, x1: 1000, z1: 1000 };
    let keys = new I32(0), fillA = new I32(0);
    function fitGrid(g) {
      g.x0 = ext.x0; g.z0 = ext.z0;
      g.w = Math.max(1, Math.ceil((ext.x1 - ext.x0) * g.ic) + 1);
      g.h = Math.max(1, Math.ceil((ext.z1 - ext.z0) * g.ic) + 1);
      const sz = g.w * g.h + 1;
      if (g.start.length !== sz) g.start = new I32(sz);
    }
    function cellOf(g, x, z) {
      let cx = Math.floor((x - g.x0) * g.ic), cz = Math.floor((z - g.z0) * g.ic);
      if (cx < 0) cx = 0; else if (cx >= g.w) cx = g.w - 1;
      if (cz < 0) cz = 0; else if (cz >= g.h) cz = g.h - 1;
      return cz * g.w + cx;
    }
    function build(g, rows, n) {
      const st = g.start, sz = st.length - 1;
      st.fill(0);
      if (keys.length < n) keys = new I32(Math.max(n, keys.length * 2));
      for (let i = 0; i < n; i++) { const r = rows[i]; const k = cellOf(g, G.x[r], G.z[r]); keys[i] = k; st[k + 1]++; }
      for (let k = 0; k < sz; k++) st[k + 1] += st[k];
      if (fillA.length < sz) fillA = new I32(sz * 2);
      fillA.set(st.subarray(0, sz));
      if (g.list.length < n) g.list = new I32(Math.max(n, g.list.length * 2));
      const L = g.list;
      for (let i = 0; i < n; i++) L[fillA[keys[i]]++] = rows[i];
      g.n = n;
    }
    let live = [new I32(0), new I32(0)], liveN = [0, 0], all = new I32(0), allN = 0, gridAt = -1;
    let eyeGridAt = -1, calmDt = -1, CALM_K = new F(0);
    const sideX = [0, 0], sideZ = [0, 0];
    function rebuild(eyes) {
      const t0 = now();
      const n = I.nRows || 0;
      if (all.length < n) { all = new I32(Math.max(n, 1024)); live[0] = new I32(all.length); live[1] = new I32(all.length); }
      // the field's extent (with room)
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, na = 0, n0 = 0, n1 = 0, sx0 = 0, sz0 = 0, sx1 = 0, sz1 = 0;
      for (let r = 0; r < n; r++) {
        const l = G.life[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        const x = G.x[r], z = G.z[r];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
        all[na++] = r;
        if (G.down[r]) continue;              // a downed man is a body to hit, not a man to look for
        if (G.side[r] === 0) { live[0][n0++] = r; sx0 += x; sz0 += z; } else { live[1][n1++] = r; sx1 += x; sz1 += z; }
      }
      allN = na; liveN[0] = n0; liveN[1] = n1;
      // each army's middle (a squad's flank is the side of it the squad stands on)
      if (n0) { sideX[0] = sx0 / n0; sideZ[0] = sz0 / n0; } if (n1) { sideX[1] = sx1 / n1; sideZ[1] = sz1 / n1; }
      if (na) {
        const pad = 160;
        if (x0 - pad < ext.x0 || z0 - pad < ext.z0 || x1 + pad > ext.x1 || z1 + pad > ext.z1 || gridAt < 0) {
          ext = { x0: x0 - pad * 2, z0: z0 - pad * 2, x1: x1 + pad * 2, z1: z1 + pad * 2 };
          for (let s = 0; s < 2; s++) { fitGrid(GE[s]); fitGrid(GP[s]); }
          eyes = true;
        }
      }
      // who a man looks for (32 m cells) and whether anybody is there at all
      // (128 m): a man walks 2 m in the half second these are kept
      if (eyes) {
        build(GE[0], live[0], n0); build(GE[1], live[1], n1);
        build(GP[0], live[0], n0); build(GP[1], live[1], n1);
        eyeGridAt = I.simT;
      }
      buildHB(all, na);
      gridAt = I.simT;
      I.ms.grid += now() - t0;
    }
    // any enemy of `side` (rows of side 1-side) within R of (x,z)? (presence grid: exact)
    function enemyNear(side, x, z, R) {
      const g = GP[side ? 0 : 1];
      const cx0 = Math.max(0, Math.floor((x - R - g.x0) * g.ic)), cx1 = Math.min(g.w - 1, Math.floor((x + R - g.x0) * g.ic));
      const cz0 = Math.max(0, Math.floor((z - R - g.z0) * g.ic)), cz1 = Math.min(g.h - 1, Math.floor((z + R - g.z0) * g.ic));
      const st = g.start;
      for (let cz = cz0; cz <= cz1; cz++) {
        const b = cz * g.w;
        if (st[b + cx1 + 1] - st[b + cx0] > 0) return true;
      }
      return false;
    }
    /* THE BODY GRID, hashed: 4 m cells keyed by (cx, cz) into a table twice
       the number of bodies, so its memory follows the men and not the field
       (a dense 4 m grid over a 1M-a-side front would be a quarter of a GB).
       Two cells may share a bucket: every caller re-tests the distance, and a
       bucket stamp keeps a walk from visiting one twice. */
    const HB = { mask: 0, start: new I32(2), list: new I32(0), stamp: new I32(0), n: 0 };
    let hbStamp = 1;
    function hkey(cx, cz) { return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & HB.mask; }
    function buildHB(rows, n) {
      let sz = 1024; while (sz < n * 2) sz <<= 1;
      if (HB.start.length !== sz + 1) { HB.start = new I32(sz + 1); HB.stamp = new I32(sz); }
      HB.mask = sz - 1;
      const st = HB.start; st.fill(0);
      if (keys.length < n) keys = new I32(Math.max(n, keys.length * 2));
      for (let i = 0; i < n; i++) { const r = rows[i]; const k = hkey(Math.floor(G.x[r] * 0.25), Math.floor(G.z[r] * 0.25)); keys[i] = k; st[k + 1]++; }
      for (let k = 0; k < sz; k++) st[k + 1] += st[k];
      if (fillA.length < sz) fillA = new I32(sz * 2);
      fillA.set(st.subarray(0, sz));
      if (HB.list.length < n) HB.list = new I32(Math.max(n, HB.list.length * 2));
      const L = HB.list;
      for (let i = 0; i < n; i++) L[fillA[keys[i]]++] = rows[i];
      HB.n = n;
    }
    // the bodies in the cells round (x, z) out to W (fn(row) returns true to stop);
    // `stamp` is the walk's: one bucket is visited once per stamp
    function forCells(x, z, W, stamp, fn) {
      const st = HB.start, L = HB.list, S = HB.stamp;
      const cx0 = Math.floor((x - W) * 0.25), cx1 = Math.floor((x + W) * 0.25);
      const cz0 = Math.floor((z - W) * 0.25), cz1 = Math.floor((z + W) * 0.25);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = hkey(cx, cz);
        if (S[k] === stamp) continue;
        S[k] = stamp;
        for (let i = st[k], e = st[k + 1]; i < e; i++) if (fn(L[i]) === true) return true;
      }
      return false;
    }
    function forDiscB(x, z, R, fn) { forCells(x, z, R, ++hbStamp, fn); }
    // visit rows of a grid inside a disc (fn returns true to stop)
    function forDisc(g, x, z, R, fn) {
      const cx0 = Math.max(0, Math.floor((x - R - g.x0) * g.ic)), cx1 = Math.min(g.w - 1, Math.floor((x + R - g.x0) * g.ic));
      const cz0 = Math.max(0, Math.floor((z - R - g.z0) * g.ic)), cz1 = Math.min(g.h - 1, Math.floor((z + R - g.z0) * g.ic));
      const st = g.start, L = g.list;
      for (let cz = cz0; cz <= cz1; cz++) {
        const b = cz * g.w;
        for (let i = st[b + cx0], e = st[b + cx1 + 1]; i < e; i++) if (fn(L[i]) === true) return;
      }
    }

    /* ------------------------------------------------------------ helpers */
    function alive(r) { return r >= 0 && (G.life[r] === LIFE.alive || G.life[r] === LIFE.routed); }
    function fighting(r) { return r >= 0 && G.life[r] === LIFE.alive && !G.down[r]; }
    function D_(r) { return I.types[G.typ[r]].D; }
    function T_(r) { return I.types[G.typ[r]]; }
    function ev(type, a, b, v) {
      if (I.nEv * 4 + 4 > I.events.length) { const g = new F(I.events.length * 2); g.set(I.events); I.events = g; }
      const o = I.nEv * 4;
      I.events[o] = type; I.events[o + 1] = a; I.events[o + 2] = b; I.events[o + 3] = v;
      I.nEv++;
    }
    // a stable personal trait in [0,1) for this man and this question (never a fresh roll)
    function trait(r, salt) {
      let h = Math.imul(r + 1, 0x9E3779B1) ^ Math.imul(salt, 0x85EBCA77) ^ SALT;
      h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
      return (h >>> 0) / 4294967296;
    }
    function bandOf(d) { return d < 25 ? 0 : d < 50 ? 1 : d < 100 ? 2 : d < 200 ? 3 : d < 400 ? 4 : 5; }

    /* ============================================================ SEEING
       How much of b the eye of a can see: the area (m2) of b's body points
       with a clear line. A prone man side-on shows his length. */
    function exposure(a, b) {
      const ax = G.x[a], az = G.z[a], ay = G.y[a] + EYE[G.post[a]];
      const bx = G.x[b], bz = G.z[b], by = G.y[b];
      const ek = G.ext[b];
      if (ek && ek !== EXT.man) {
        // a hull or an animal: its top, its middle, its foot, each a third of its face
        const h = G.extH[b], A3 = G.extW[b] * h / 3;
        let ar = 0;
        if (lineClear(ax, ay, az, bx, by + h * 0.92, bz)) ar += A3;
        if (lineClear(ax, ay, az, bx, by + h * 0.55, bz)) ar += A3;
        if (lineClear(ax, ay, az, bx, by + h * 0.18, bz)) ar += A3;
        return ar;
      }
      const p = G.post[b];
      const L = LOOK[p];
      let area = 0;
      // the visible points, from the top down: a hidden top hides what is under it from most angles
      for (let i = 0; i < L.length; i++) {
        let A = L[i][1];
        if (p === POST.prone) {
          // side-on he shows his length (1.8 m) instead of his width
          const dx = ax - bx, dz = az - bz, dl = Math.sqrt(dx * dx + dz * dz) || 1;
          const s = Math.abs((dx * Math.cos(G.heading[b]) - dz * Math.sin(G.heading[b])) / dl);
          A *= 1 + s * 3.5;
        }
        if (lineClear(ax, ay, az, bx, by + L[i][0], bz)) area += A;
        else if (i === 0 && p !== POST.prone) { /* head hidden: he is in defilade; check the rest anyway */ }
      }
      return area;
    }
    /* WHAT HE CAN SEE OF A MAN HE IS WATCHING, remembered: recomputed only
       when either of them has moved 30 cm, changed posture, or 1.5 s have
       passed. Two slots: his mark (0) and the man he is studying (1). Two men
       lying still trading shots do not re-trace the same ground every think. */
    function expoC(a, b, s) {
      const O = s ? G.e1o : G.e0o, T = s ? G.e1t : G.e0t, V = s ? G.e1v : G.e0v, K = s ? G.e1k : G.e0k;
      const X = s ? G.e1x : G.e0x, Z = s ? G.e1z : G.e0z, BX = s ? G.e1X : G.e0X, BZ = s ? G.e1Z : G.e0Z;
      const key = G.post[a] * 3 + G.post[b];
      if (O[a] === b && K[a] === key && I.simT - T[a] < 1.5) {
        const dx = G.x[a] - X[a], dz = G.z[a] - Z[a], ex = G.x[b] - BX[a], ez = G.z[b] - BZ[a];
        if (dx * dx + dz * dz < 0.09 && ex * ex + ez * ez < 0.09) return V[a];
      }
      const e = exposure(a, b);
      O[a] = b; T[a] = I.simT; V[a] = e; K[a] = key; X[a] = G.x[a]; Z[a] = G.z[a]; BX[a] = G.x[b]; BZ[a] = G.z[b];
      return e;
    }
    /* DETECTION HAZARD, per second, of b by a. 0.7 m2 is a standing man. */
    function hazard(a, b, d, area) {
      if (area <= 0) {
        // nothing of him in view: only the flash and the noise of his rifle
        // say where he is, and only roughly (handled as a last-known point)
        return 0;
      }
      const D = D_(a), t = T_(a);
      let S = (area / 0.7) * (10000 / Math.max(400, d * d));
      // movement draws the eye; a man in a rush is seen at once
      const sp = Math.sqrt(G.vx[b] * G.vx[b] + G.vz[b] * G.vz[b]);
      if (sp > 0.2) S *= 1 + Math.min(4, sp * 1.1);
      // he just fired: the flash, the blast, the dust off the ground in front of him
      const fa = I.simT - G.flashT[b];
      if (fa < 1.5) S *= 6 + (d < 300 ? 4 : 0);
      // a magnifying sight finds small things far off
      if (t.optic > 1 && d > 60) S *= 1 + Math.min(2, (t.optic - 1) * d / 300);
      // looking where he knows the enemy is (a last-known point within a few m)
      if (I.simT - G.lkT[a] < 20) {
        const ex = G.lkx[a] - G.x[b], ez = G.lkz[a] - G.z[b];
        if (ex * ex + ez * ez < 100) S *= 3;
      }
      // a man on the move scans worse than one who has stopped to look
      if (G.mv[a] !== MOVE.hold) S *= G.mv[a] === MOVE.walk || G.mv[a] === MOVE.crawl ? 0.6 : 0.3;
      // his own head down: he is not looking
      const sup = G.supp[a];
      if (sup > D.pinAt) S *= 0.12; else S *= 1 / (1 + sup * 1.4);
      return D.detect * Math.min(S, 60);
    }

    /* ============================================================ THINKING
       Every man, on a staggered clock: contact men every 0.25 s, the rest
       every 0.6 s (a man with nobody in reach of his sight has nothing to see
       and the presence grid says so exactly). */
    const _cand = new I32(8), _cd = new F(8);
    let _nc = 0, _cx = 0, _cz = 0, _cs = 0, _fx = 0, _fz = 0, _cr2 = 0, _self = -1, _wide = false;
    let CL8 = new I32(0);                 // each man's short list of the nearest eight in his sector (stride 8)
    function visitCand(o) {
      if (o === _self) return;
      const dx = G.x[o] - _cx, dz = G.z[o] - _cz, d2 = dx * dx + dz * dz;
      if (d2 > _cr2) return;
      // his sector: 200 degrees off his facing, all round inside 25 m or once in contact
      if (!_wide && d2 > 625) { const d = Math.sqrt(d2); if ((_fx * dx + _fz * dz) / d < -0.17) return; }
      if (_nc < 8) { _cand[_nc] = o; _cd[_nc] = d2; _nc++; return; }
      let wi = 0, worst = _cd[0];
      for (let i = 1; i < 8; i++) if (_cd[i] > worst) { worst = _cd[i]; wi = i; }
      if (d2 < worst) { _cand[wi] = o; _cd[wi] = d2; }
    }
    // the nearest few enemies in his sector (ring walk of the enemy's grid)
    function candidates(r, R) {
      _nc = 0; _self = r; _cx = G.x[r]; _cz = G.z[r]; _cr2 = R * R;
      _fx = Math.sin(G.face[r]); _fz = Math.cos(G.face[r]);
      _wide = I.simT - G.contactT[r] < 30;
      const g = GE[G.side[r] ? 0 : 1];
      const c0x = Math.floor((_cx - g.x0) * g.ic), c0z = Math.floor((_cz - g.z0) * g.ic);
      const maxRing = Math.ceil(R * g.ic);
      const st = g.start, L = g.list;
      for (let ring = 0; ring <= maxRing; ring++) {
        for (let dz = -ring; dz <= ring; dz++) {
          const zz = c0z + dz;
          if (zz < 0 || zz >= g.h) continue;
          const edge = dz === -ring || dz === ring, step = edge ? 1 : Math.max(1, 2 * ring);
          for (let dx = -ring; dx <= ring; dx += step) {
            const xx = c0x + dx;
            if (xx < 0 || xx >= g.w) { if (!ring) break; continue; }
            const k = zz * g.w + xx;
            for (let i = st[k], e = st[k + 1]; i < e; i++) visitCand(L[i]);
            if (!ring) break;
          }
        }
        if (_nc >= 8 && ring >= 1) break;
      }
      // nearest first
      for (let i = 1; i < _nc; i++) {
        const c = _cand[i], d = _cd[i];
        let j = i - 1;
        while (j >= 0 && _cd[j] > d) { _cand[j + 1] = _cand[j]; _cd[j + 1] = _cd[j]; j--; }
        _cand[j + 1] = c; _cd[j + 1] = d;
      }
      return _nc;
    }

    function think(r, dt) {
      I.stats.thinks++;
      if (G.anc[r]) { ancThink(r, dt); return; }          // a man of the line of battle (below)
      const D = D_(r), t = T_(r);
      if (G.down[r]) { downThink(r, dt); return; }
      if (G.life[r] === LIFE.routed) { routThink(r); return; }
      if (I.ancN) closeThreat(r);                          // a sword at arm's length is no search
      const x = G.x[r], z = G.z[r];
      // ---- what he sees
      let tg = G.tgt[r];
      if (tg >= 0 && (!fighting(tg) || G.down[tg])) {
        // his mark is down or gone: he looks for the next
        if (tg >= 0 && G.down[tg] && alive(tg)) { G.lkx[r] = G.x[tg]; G.lkz[r] = G.z[tg]; }
        G.tgt[r] = tg = -1;
      }
      const near = enemyNear(G.side[r], x, z, SIGHT_R);
      if (tg >= 0) {
        const e = expoC(r, tg, 0);
        G.expo[r] = e;
        if (e > 0) {
          G.seenT[r] = I.simT; G.lkx[r] = G.x[tg]; G.lkz[r] = G.z[tg]; G.lkT[r] = I.simT;
        } else if (I.simT - G.seenT[r] > 6) {
          // lost: he keeps watching the spot, and looks for anybody else
          G.tgt[r] = tg = -1;
        }
      }
      if (near) {
        /* THE SEARCH, as an eye does it: he studies one man at a time (his
           candidate) and glances at one more each think, round the nearest
           few in his sector. Detection is a hazard on the one he studies:
           P(found in dt) = 1 - e^(-h dt), against a fresh threshold drawn
           when a new man comes under his eye. A glance that finds a man
           far easier to see (moving, firing, closer) turns his eye to him. */
        // his short list of the nearest few in his sector, kept for a scan
        // cycle (1.5 s); the distances are the men's real ones every think
        let n = 0;
        if (CL8.length < (I.nRows || 0) * 8) { const g = new I32(Math.max(1024, (I.nRows || 0) * 16)).fill(-1); g.set(CL8); CL8 = g; }
        const c8 = r * 8;
        if (I.simT - G.clT[r] < 1.5) {
          for (let i = 0; i < 8; i++) {
            const o = CL8[c8 + i];
            if (o < 0 || !fighting(o)) continue;
            const dx = G.x[o] - x, dz = G.z[o] - z;
            _cand[n] = o; _cd[n] = dx * dx + dz * dz; n++;
          }
        }
        if (!n) {
          n = candidates(r, SIGHT_R);
          G.clT[r] = I.simT;
          for (let i = 0; i < 8; i++) CL8[c8 + i] = i < n ? _cand[i] : -1;
        }
        let cur = G.cand[r];
        if (cur >= 0 && (!fighting(cur) || cur === tg)) { cur = G.cand[r] = -1; }
        let hCur = 0;
        if (cur >= 0) {
          const dc = Math.hypot(G.x[cur] - x, G.z[cur] - z);
          if (dc > SIGHT_R) { cur = G.cand[r] = -1; }
          else hCur = hazard(r, cur, dc, expoC(r, cur, 1));
        }
        const sc = G.scan[r]++;
        if (n && ((sc & 1) === 0 || cur < 0)) {
          // where he looks: where the fire came from (the man nearest it), every
          // other glance while it is fresh; otherwise round the nearest eight
          let ki = (sc >> 1) % n;
          if (I.simT - G.lkT[r] < 8 && ((sc >> 1) & 1)) {
            let bd = 1e18;
            for (let i = 0; i < n; i++) {
              const o = _cand[i], ex = G.x[o] - G.lkx[r], ez = G.z[o] - G.lkz[r], e2 = ex * ex + ez * ez;
              if (e2 < bd && o !== cur) { bd = e2; ki = i; }
            }
          }
          const o = _cand[ki];
          const d = Math.sqrt(_cd[ki]);
          // a man he could not notice in hours even fully in the open is not looked at
          if (o !== tg && o !== cur && hazard(r, o, d, LOOK_ALL[G.post[o]]) > 1e-4) {
            losTag = 1; const h = hazard(r, o, d, exposure(r, o)); losTag = 0;
            if (h > hCur * 1.5) {
              cur = G.cand[r] = o; hCur = h; G.det[r] = 0; G.detN[r] = -Math.log(1 - rnd() * 0.99999);
              G.e1o[r] = -1;
            }
          }
        }
        if (cur >= 0 && hCur > 0) {
          G.det[r] += hCur * dt;
          if (G.det[r] >= G.detN[r]) {
            const ec = expoC(r, cur, 1);
            if (tg < 0 || ec > G.expo[r] * 1.5) acquire(r, cur, ec);
            G.det[r] = 0; G.cand[r] = -1;
          }
        }
      }
      // ---- contact: what he does about it
      // his own contact (he sees one, a round cracked past, he knows where they are),
      // or his squad's: he heard the fire and the shout, and he knows the bearing.
      // (The squad's, once the squad is fighting: a squad still travelling, or
      // bounding forward in overwatch, that only HEARS the platoon's fight on
      // the net keeps moving to it. Before, every man in it took the heard
      // contact as his own and went to ground with nothing to shoot, while the
      // squad, none of whose men had seen anything, kept ordering the bound:
      // a 60 v 25 attack lay 160 m short of the line for four minutes.)
      const own = tg >= 0 || I.simT - G.crackT[r] < 8 || I.simT - G.lkT[r] < 12;
      const sqd = G.sqd[r];
      const sqT = sqd >= 0 ? SQ.task[sqd] : TASK.advance;
      const inContact = own || (sqd >= 0 && sqT !== TASK.advance && sqT !== TASK.overwatch && SQ.lastC[sqd] > 0 && I.simT - SQ.lastC[sqd] < 10);
      if (own) G.contactT[r] = I.simT;
      decide(r, D, t, inContact);
    }
    function acquire(r, o, e) {
      const D = D_(r);
      // A RIFLE DOES NOT SHOOT AT A TANK: armour his round cannot go through at
      // this range (its thinnest face: he can hope for a flank) is a threat he
      // knows about and gets down from, not a mark
      if (G.extMM[o] > 0) {
        const t = T_(r), d = Math.hypot(G.x[o] - G.x[r], G.z[o] - G.z[r]);
        if (B.penRHA(t.c, B.vAt(t.v0, t.k, d), t.v0) < G.extMM[o]) {
          G.lkx[r] = G.x[o]; G.lkz[r] = G.z[o]; G.lkT[r] = I.simT;
          // and it frightens him: nothing he carries can touch it (a squad
          // with no answer to armour breaks contact long before it is killed)
          if (d < 500) G.stress[r] += 0.06 * D.suppK * (1 - d / 600);
          return;
        }
      }
      const prev = G.tgt[r];
      if (I.led.firstSee[G.side[r]] < 0) { I.led.firstSee[G.side[r]] = I.simT; I.led.firstSeeD[G.side[r]] = Math.hypot(G.x[o] - G.x[r], G.z[o] - G.z[r]); }
      G.tgt[r] = o; G.expo[r] = e; G.seenT[r] = I.simT;
      G.lkx[r] = G.x[o]; G.lkz[r] = G.z[o]; G.lkT[r] = I.simT;
      if (prev !== o) {
        // a new mark: the rifle comes onto it, the aim starts over
        // (an optic is on the mark sooner: no front sight to line up with a rear)
        const t = T_(r);
        G.acqT[r] = D.acq * (0.75 + 0.5 * rnd()) * (t.optic ? 0.82 : 1); G.aimT[r] = 0;
        // his range estimate for this mark (iron sights; a ranging reticle halves it)
        const err = D.rangeErr * (t.optic > 1 ? 0.5 : 1);
        G.rngE[r] = gauss() * err; G.rngTgt[r] = o;
        if (G.contactT[r] < I.simT - 30) { G.contactT[r] = I.simT; }
      }
    }

    /* ---- the decision: posture, position, movement ---- */
    // how good a spot is for a man in posture p facing threat (tx,tz): he
    // can see the threat from it (his eye clears), and how little of him shows
    function spotScore(x, z, p, tx, tz) {
      const gy = hAt(x, z);
      const dx = tx - x, dz = tz - z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      const ux = dx / d, uz = dz / d;
      // the lip: the highest ground (or cover) in the first 4 m toward him
      let lip = -9;
      for (let s = 0.6; s <= 4.2; s += 0.6) {
        const xx = x + ux * s, zz = z + uz * s;
        const h = hAt(xx, zz) + (cover ? coverAt(xx, zz) : 0) - gy;
        if (h > lip) lip = h;
      }
      const eye = EYE[p];
      // he must see over it (or it is a full wall he will have to step out from)
      if (lip > eye - 0.06) return { ok: false, lip: lip };
      // the body below the lip is covered; what shows is the part above it
      const show = p === POST.prone ? Math.max(0.04, (0.36 - Math.max(0, lip)) / 0.36) :
        p === POST.kneel ? Math.max(0.1, (1.15 - Math.max(0, lip)) / 1.15) : Math.max(0.2, (1.75 - Math.max(0, lip)) / 1.75);
      return { ok: true, lip: lip, show: show };
    }
    const _sp = { x: 0, z: 0, p: 2, show: 1 };
    // the best firing position within R of him against a threat: the lowest
    // posture that keeps a line, the least of him showing, the nearest
    function bestSpot(r, R, tx, tz) {
      const tag0 = losTag; losTag = 2; try { return bestSpot_(r, R, tx, tz); } finally { losTag = tag0; }
    }
    function bestSpot_(r, R, tx, tz) {
      const x = G.x[r], z = G.z[r];
      let best = null, bs = 1e9;
      const pref = [POST.prone, POST.kneel];
      const n = R > 0 ? 12 : 0;
      for (let k = -1; k < n; k++) {
        let px = x, pz = z;
        if (k >= 0) {
          const a = (k / n) * 6.283185 + trait(r, 0x51) * 6.283;
          const rr = R * (0.35 + 0.65 * ((k % 3) + 1) / 3);
          px = x + Math.sin(a) * rr; pz = z + Math.cos(a) * rr;
        }
        for (let q = 0; q < pref.length; q++) {
          const p = pref[q];
          const s = spotScore(px, pz, p, tx, tz);
          if (!s.ok) continue;
          // can he actually see the threat from there, in that posture
          const ey = hAt(px, pz) + EYE[p];
          if (!lineClear(px, ey, pz, tx, hAt(tx, tz) + 0.6, tz)) continue;
          const dd = Math.hypot(px - x, pz - z);
          const score = s.show * (p === POST.kneel ? 1.6 : 1) + dd * 0.025;
          if (score < bs) { bs = score; best = _sp; _sp.x = px; _sp.z = pz; _sp.p = p; _sp.show = s.show; }
          break;
        }
      }
      return best;
    }

    function setPost(r, p) {
      if (G.post[r] === p && G.postT[r] <= 0) return;
      if (G.postTo[r] === p && G.postT[r] > 0) return;
      const D = D_(r);
      const from = G.post[r];
      let tt = 0;
      if (p === POST.prone) tt = from === POST.kneel ? D.drop * 0.6 : D.drop;
      else if (from === POST.prone) tt = p === POST.kneel ? D.rise * 0.7 : D.rise;
      else tt = 0.45;
      G.postTo[r] = p; G.postT[r] = tt;
      // the aim is lost while he moves
      G.aimT[r] = 0;
    }

    function decide(r, D, t, inContact) {
      const sq = G.sqd[r];
      const task = sq >= 0 ? SQ.task[sq] : TASK.advance;
      const tg = G.tgt[r];
      // the threat: his mark, else where he last knew them, else where the cracks came from
      let tx = NaN, tz = NaN;
      if (tg >= 0) { tx = G.x[tg]; tz = G.z[tg]; }
      else if (I.simT - G.lkT[r] < 30) { tx = G.lkx[r]; tz = G.lkz[r]; }
      else if (I.simT - G.crackT[r] < 15) { tx = G.hitX[r]; tz = G.hitZ[r]; }
      else if (sq >= 0 && SQ.lastC[sq] > 0 && I.simT - SQ.lastC[sq] < 10) { tx = SQ.thx[sq]; tz = SQ.thz[sq]; }
      if (tx === tx) G.face[r] = Math.atan2(tx - G.x[r], tz - G.z[r]);
      // ---- reload: in cover before he is dry (trained), or when dry
      if (t.armed && G.reloadT[r] <= 0 && G.ammo[r] > 0) {
        const low = G.mag[r] <= Math.floor(t.magSize * D.ammoDisc);
        if (G.mag[r] <= 0 || (D.tac && low && (tg < 0 || G.expo[r] <= 0 || G.supp[r] > D.pinAt * 0.6))) {
          const need = Math.min(t.magSize - G.mag[r], G.ammo[r]);
          if (need > 0) { G.reloadT[r] = D.reload * (0.9 + 0.2 * rnd()) * (G.mv[r] === MOVE.rush ? 1.4 : 1); G.burst[r] = 0; }
        }
      }
      // a rush in progress runs out wherever he is (in a fight or out of one): he drops
      if (G.mv[r] === MOVE.rush) {
        const pinned0 = G.supp[r] > D.pinAt;
        const arrived = Math.hypot(G.gx[r] - G.x[r], G.gz[r] - G.z[r]) < 0.8;
        if (arrived || G.rushT[r] > D.rushMax * (0.8 + 0.4 * trait(r, 0x7A)) || (pinned0 && G.rushT[r] > 1.2)) {
          G.mv[r] = MOVE.hold; G.rushT[r] = 0; G.gx[r] = G.x[r]; G.gz[r] = G.z[r];
          setPost(r, inContact ? POST.prone : POST.kneel);
        }
        return;
      }
      if (!inContact) {
        // ---- no contact: the order (march, hold, bounding overwatch). A man
        // who was in a fight stays down for a while after it goes quiet.
        const quiet = I.simT - G.contactT[r] > 40;
        if (task === TASK.hold || task === TASK.base) {
          G.mv[r] = MOVE.hold;
          if (G.post[r] === POST.stand && G.postT[r] <= 0) setPost(r, POST.kneel);    // a held position is held low
          return;
        }
        if (task === TASK.overwatch && sq >= 0 && !boundingTeam(sq, r)) {
          // the watching team: down on a knee, eyes on the ground ahead
          G.mv[r] = MOVE.hold; G.gx[r] = G.x[r]; G.gz[r] = G.z[r];
          if (G.post[r] === POST.stand && G.postT[r] <= 0) setPost(r, POST.kneel);
          const o = orderOf(sq, G.side[r]);
          if (o.x === o.x) G.face[r] = Math.atan2(o.x - G.x[r], o.z - G.z[r]);
          return;
        }
        if (G.post[r] !== POST.stand) {
          // (unless his team has the bound: then he gets up and goes, which is
          // what the watching team is down there for. Before, a squad whose men
          // had taken a crack in the last 40 s lay in "overwatch" for minutes,
          // both teams down, and never closed.)
          if (G.post[r] === POST.prone && !quiet && task !== TASK.overwatch) { G.mv[r] = MOVE.hold; return; }
          if (G.postT[r] <= 0) setPost(r, POST.stand);
          G.mv[r] = MOVE.hold;
          return;
        }
        march(r);
        return;
      }
      // ---- contact
      const pinned = G.supp[r] > D.pinAt;
      if (pinned && !G.pin[r]) I.led.pins++;
      G.pin[r] = pinned ? 1 : 0;
      // squad orders under fire: the bounding team moves, the base fires
      const bounding = sq >= 0 && (task === TASK.bound || task === TASK.assault || task === TASK.flank) && boundingTeam(sq, r);
      if (bounding && !pinned && tx === tx) {
        // (a flank bounds toward the flank point, still facing where the enemy is)
        const go = task === TASK.flank ? boundToward(r, sq, SQ.flX[sq], SQ.flZ[sq], tx, tz) : boundGoal(r, sq, tx, tz);
        if (go) {
          G.gx[r] = go.x; G.gz[r] = go.z;
          setPost(r, POST.stand);
          G.mv[r] = task === TASK.assault && Math.hypot(tx - G.x[r], tz - G.z[r]) < 40 ? MOVE.rush : MOVE.rush;
          G.rushT[r] = 0;
          I.led.rushes++;
          return;
        }
      }
      /* BREAK CONTACT, by bounds: the moving team gets up and rushes back to
         the best spot 20-30 m behind, the other stays down and fires; they
         swap on the squad's clock. Nobody turns his back on the enemy all at once. */
      if (task === TASK.breakc && !pinned && tx === tx && boundingTeam(sq, r)) {
        const dx = G.x[r] - tx, dz = G.z[r] - tz, d = Math.hypot(dx, dz) || 1;
        const L = 20 + 10 * trait(r, 0xBAC);
        const go = spotNear(r, G.x[r] + dx / d * L, G.z[r] + dz / d * L, tx, tz);
        G.gx[r] = go.x; G.gz[r] = go.z;
        setPost(r, POST.stand); G.mv[r] = MOVE.rush; G.rushT[r] = 0;
        I.led.rushes++;
        return;
      }
      /* BUDDY AID. A mate down within reach, the squad not pinned, and he is
         the nearest man free to go: he gets to him (low), works on him (the
         bleeding is packed and tied off; he is out of the fight while he does
         it), and the wounded man lives longer for it. */
      if (aidStep(r, D, sq, pinned)) return;
      // ---- a firing position. At first contact he takes the best spot he
      // can reach (training: how far he looks, and whether he looks at all);
      // after that he stays put and fights from it
      if (G.mv[r] === MOVE.crawl) {
        if (Math.hypot(G.gx[r] - G.x[r], G.gz[r] - G.z[r]) < 0.5) { G.mv[r] = MOVE.hold; }
        return;
      }
      if (G.mv[r] === MOVE.walk || G.mv[r] === MOVE.run || G.mv[r] === MOVE.march) { G.mv[r] = MOVE.hold; G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; }
      if (tx === tx) {
        const usesGround = D.coverR > 0 && trait(r, 0xC0E) < 0.35 + D.coverR / 16;
        if (G.post[r] === POST.stand && G.postT[r] <= 0) {
          /* REACT TO CONTACT. Shot at, or close: get down where he is and
             return fire (a run to a better spot under aimed fire is a man
             standing in the open for two seconds). Not yet shot at, and far
             enough that the enemy may not have him: he takes the best spot
             within reach first. Close in, kneeling is quicker than going flat. */
          const dd = Math.hypot(tx - G.x[r], tz - G.z[r]);
          // where he stands: the lowest posture that keeps a line; inside
          // 75 m (or with the enemy already shooting at him inside 150) he
          // kneels and shoots first, the faster of the two
          let p = firePost(r, tx, tz, usesGround ? 0 : 1);
          if (p === POST.prone && (dd < 75 || (dd < 150 && I.simT - G.crackT[r] < 2))) p = POST.kneel;
          setPost(r, p);
          return;
        }
        const dd = Math.hypot(tx - G.x[r], tz - G.z[r]);
        // kneeling to trade, past 40 m: once taking fire, or once the mark is
        // gone from view, he goes flat if the ground still gives him the line
        if (G.post[r] === POST.kneel && G.postT[r] <= 0 && usesGround && dd > 75 &&
            (G.supp[r] > 0.3 || I.simT - G.seenT[r] > 1.5) && firePost(r, tx, tz, 0) === POST.prone) {
          setPost(r, POST.prone);
          return;
        }
        // ...and flat with no line, he comes up to a knee if that gives him one (and the fire allows it)
        if (G.post[r] === POST.prone && G.postT[r] <= 0 && I.simT - G.seenT[r] > 3 && G.supp[r] < D.pinAt * 0.6 &&
            I.simT > G.spotT[r] - 3 && !lineClear(G.x[r], G.y[r] + EYE[2], G.z[r], tx, hAt(tx, tz) + 0.6, tz) &&
            lineClear(G.x[r], G.y[r] + EYE[1], G.z[r], tx, hAt(tx, tz) + 0.6, tz)) {
          setPost(r, POST.kneel);
          return;
        }
        /* A BETTER SPOT. He is down; the fold he dropped into may show too
           much of him, or no longer give him the line. While the mark is out
           of his sight (he has nothing to shoot, the enemy has nothing to see)
           and he is not pinned, a trained man crawls to the best spot within a
           few strides: lower behind a lip, still with the line. */
        if (G.postT[r] <= 0 && usesGround && !pinned && G.post[r] !== POST.stand && G.reloadT[r] <= 0 &&
            (I.simT - G.seenT[r] > 2.5 || G.expo[r] <= 0) && G.supp[r] < D.pinAt * 0.7 && I.simT > G.spotT[r]) {
          G.spotT[r] = I.simT + 6 + 4 * trait(r, 0x5907);           // he looked: not again for a while
          /* NO LINE, NO FIGHT. A man who cannot see where the fire comes from
             (flat behind a crest, a wall between) is not in the fight: he
             goes to where he can be. A few strides, low; farther, a short
             rush when the fire on him is light. */
          const blind = I.simT - G.seenT[r] > 4 && !lineClear(G.x[r], G.y[r] + EYE[G.post[r]], G.z[r], tx, hAt(tx, tz) + 0.6, tz);
          const sp = bestSpot(r, blind ? D.coverR : Math.min(5, D.coverR), tx, tz);
          if (sp && Math.hypot(sp.x - G.x[r], sp.z - G.z[r]) > 0.8) {
            const far = Math.hypot(sp.x - G.x[r], sp.z - G.z[r]) > 3.5;
            G.gx[r] = sp.x; G.gz[r] = sp.z;
            if (far && G.supp[r] < D.pinAt * 0.4) { setPost(r, POST.stand); G.mv[r] = MOVE.rush; G.rushT[r] = 0; I.led.rushes++; }
            else { G.mv[r] = MOVE.crawl; if (G.post[r] !== sp.p && sp.p !== POST.stand) setPost(r, sp.p); }
            I.led.posts++;
            return;
          }
        }
        if (pinned) { if (G.post[r] === POST.stand) setPost(r, POST.prone); }
      }
    }
    // the lowest posture from which his eye still sees the threat; a man who
    // does not use the ground (habit 1) kneels or stands
    function firePost(r, tx, tz, habit) {
      const tag0 = losTag; losTag = 3; try { return firePost_(r, tx, tz, habit); } finally { losTag = tag0; }
    }
    function firePost_(r, tx, tz, habit) {
      const x = G.x[r], z = G.z[r], gy = hAt(x, z), ty = hAt(tx, tz) + 0.9;
      if (habit) return lineClear(x, gy + EYE[1], z, tx, ty, tz) || !lineClear(x, gy + EYE[0], z, tx, ty, tz) ? POST.kneel : POST.stand;
      if (lineClear(x, gy + EYE[2], z, tx, ty, tz)) return POST.prone;
      if (lineClear(x, gy + EYE[1], z, tx, ty, tz)) return POST.kneel;
      // standing is the only line: he stands to fight; no line from anywhere: he gets down
      return lineClear(x, gy + EYE[0], z, tx, ty, tz) ? POST.stand : POST.prone;
    }

    /* ---- the march: the squad's formation slot on its leader ---- */
    function march(r) {
      const sq = G.sqd[r];
      const o = orderOf(G.sqd[r], G.side[r]);
      let gx = o.x, gz = o.z;
      if (gx !== gx) { G.mv[r] = MOVE.hold; return; }       // an order to hold where he stands
      if (sq >= 0) {
        const lead = SQ.lead[sq];
        const s = G.slot[r];
        if (lead >= 0 && lead !== r && alive(lead)) {
          // a wedge: alpha left, bravo right, 6 m between men
          const fx = SQ.fx[sq], fz = SQ.fz[sq];
          const rx = fz, rz = -fx;
          const side = s <= 4 ? -1 : 1, k = s <= 4 ? s : s - 5;
          const back = 4 + k * 4.2, lat = side * (5 + k * 4.2);
          gx = G.x[lead] - fx * back + rx * lat; gz = G.z[lead] - fz * back + rz * lat;
        }
      }
      G.gx[r] = gx; G.gz[r] = gz;
      const d = Math.hypot(gx - G.x[r], gz - G.z[r]);
      // the point man walks (an advance to contact is a patrol, not a race); a man
      // well off his place in the wedge jogs to it
      const lead = sq < 0 || SQ.lead[sq] === r || SQ.lead[sq] < 0;
      // (a squad travelling, far from any enemy, route-marches; near him it walks)
      const travel = sq >= 0 && SQ.task[sq] === TASK.advance;
      G.mv[r] = d < 1 ? MOVE.hold : (!lead && d > 12) ? MOVE.run : travel ? MOVE.march : MOVE.walk;
      if (d > 0.5) G.face[r] = Math.atan2(gx - G.x[r], gz - G.z[r]);
    }

    /* ---- the wounded ---- */
    function downThink(r, dt) {
      void dt;
      G.mv[r] = MOVE.hold;
      if (G.post[r] !== POST.prone) { G.post[r] = POST.prone; G.postT[r] = 0; }
    }
    function routThink(r) {
      /* away from the enemy, as fast as he can, until he is out of it: 400 m
         from the nearer of where he last saw them and the middle of their
         army. (A man who had never seen one ran from a point a metre in front
         of him, which went with him: he never got clear and never left.) */
      const e = G.side[r] ? 0 : 1;
      let tx = sideX[e], tz = sideZ[e];
      if (G.lkT[r] > -50 && Math.hypot(G.lkx[r] - G.x[r], G.lkz[r] - G.z[r]) < Math.hypot(tx - G.x[r], tz - G.z[r])) { tx = G.lkx[r]; tz = G.lkz[r]; }
      const dx = G.x[r] - tx, dz = G.z[r] - tz, d = Math.hypot(dx, dz) || 1;
      G.gx[r] = G.x[r] + dx / d * 40; G.gz[r] = G.z[r] + dz / d * 40;
      if (G.post[r] !== POST.stand) setPost(r, POST.stand);
      G.mv[r] = MOVE.run;
      if (d > 400) { G.life[r] = LIFE.fled; I.stats.fled[G.side[r]]++; ev(EV.fled, r, -1, 0); }
    }

    /* ============================================================ THE TRIGGER */
    const _poi = { x: 0, y: 0, z: 0 };
    function trigger(r, dt) {
      const t = T_(r), D = t.D;
      if (!t.armed || G.down[r] || G.life[r] !== LIFE.alive || G.aidOn[r] >= 0) return;
      if (I.ancN && closeFight(r, t, D, dt)) return;      // the bayonet, empty or reloading with a sword on him
      if (G.reloadT[r] > 0) {
        G.reloadT[r] -= dt;
        if (G.reloadT[r] <= 0) {
          const need = Math.min(t.magSize - G.mag[r], G.ammo[r]);
          G.mag[r] += need; G.ammo[r] -= need; G.reloadT[r] = 0;
        }
        return;
      }
      if (G.cool[r] > 0) G.cool[r] -= dt;
      const tg = G.tgt[r];
      if (tg < 0 || (G.expo[r] <= 0 && G.acqT[r] <= 0)) { if (G.postT[r] <= 0) areaFire(r, t, D); }
      if (tg < 0 || G.postT[r] > 0) { G.aimT[r] = 0; return; }
      if (G.acqT[r] > 0) { G.acqT[r] -= dt; return; }
      if (G.expo[r] <= 0) { G.aimT[r] = Math.max(0, G.aimT[r] - dt); return; }
      const moving = G.mv[r] !== MOVE.hold;
      if (moving && (G.mv[r] === MOVE.rush || trait(r, 0xF1E) > D.moveFire)) return;
      // pinned: his head is down. An untrained man still sticks the rifle up and fires blind
      const pinned = G.supp[r] > D.pinAt;
      if (pinned && D.press > 0.1) { G.aimT[r] = 0; return; }
      G.aimT[r] += dt;
      if (G.cool[r] > 0) return;
      if (G.mag[r] <= 0) return;
      // the sight picture: his angular error now (mil), against the size of
      // what he can see of the mark at this range
      const dx = G.x[tg] - G.x[r], dz = G.z[tg] - G.z[r];
      const d = Math.sqrt(dx * dx + dz * dz) || 0.01;
      if (G.burst[r] === 0) {
        // he waits for his aim to settle, as far as his discipline makes him;
        // a long shot takes a trained man longer (breath, natural point of aim)
        const tau = D.settle * (1 + D.press * d / 400);
        if (2.4 * Math.exp(-G.aimT[r] / tau) > 3 * (1 - D.press) + 0.12) return;
      }
      const sig = sigmaNow(r, t, d);
      fire(r, tg, t, D, d, sig, pinned);
    }
    /* AREA FIRE. Nobody in his sight, but he knows (or believes) where they
       are: the last place he saw one, where the cracks came from, the
       squad's bearing. A trained man fires there only as covering fire (his
       squad has a team on the move) at a sustained rate, a round every few
       seconds; an untrained one sprays toward the noise. The rounds are flown
       like any other and hit whoever is really there; their cracks keep heads
       down, which is the point. */
    function areaFire(r, t, D) { losTag = 4; areaFire_(r, t, D); losTag = 0; }
    function areaFire_(r, t, D) {
      if (G.cool[r] > 0 || G.mag[r] <= 0 || G.mv[r] !== MOVE.hold || G.post[r] === POST.stand && G.postT[r] > 0) return;
      if (I.simT - G.lkT[r] > 10) return;
      const sq = G.sqd[r];
      // a base of fire: the squad down and fighting (win the firefight), and the team
      // that stays put while the other moves (covering fire)
      const task = sq >= 0 ? SQ.task[sq] : TASK.base;
      const cover = (task === TASK.base || task === TASK.bound || task === TASK.assault || task === TASK.breakc || task === TASK.flank) && (sq < 0 || !boundingTeam(sq, r) || task === TASK.base);
      const undisciplined = D.press < 0.5;
      if (!cover && !undisciplined) return;
      const pinned = G.supp[r] > D.pinAt;
      if (pinned && !undisciplined) return;
      // a reserve he keeps for a real target (fire discipline)
      if (!undisciplined && G.mag[r] <= t.magSize * D.ammoDisc + 1) return;
      const x = G.x[r], z = G.z[r];
      const ax = G.lkx[r], az = G.lkz[r];
      const d = Math.hypot(ax - x, az - z);
      if (d < 8 || d > (t.g.area || 600)) return;
      // over the lip he is behind? (a man flat behind a fold fires into its face)
      const p = G.post[r], oy = G.y[r] + MUZ[p], gy = hAt(ax, az);
      if (!lineClear(x, oy, z, ax, gy + 0.8, az)) return;
      G.aimT[r] = 0;
      // his point: the spot, with the error of not seeing it (a few metres, more far off)
      // (a trained man puts it on the spot; an untrained one sprays toward the noise)
      const err = D.press < 0.5 ? 3 + d * 0.05 : 1.5 + d * 0.012;
      const px = ax + gauss() * err, pz = az + gauss() * err;
      const sig = sigmaNow(r, t, d) + (pinned ? 18 : 2);
      G.mag[r]--; G.shots[r]++;
      I.stats.shots[G.side[r]]++;
      I.led.area = (I.led.area || 0) + 1;
      const hd = Math.hypot(px - x, pz - z) || 1;
      const ox = x + (px - x) / hd * 0.5, oz = z + (pz - z) / hd * 0.5;
      const poi = B.poi(t.v0, t.k, hd, t.g.zero, t.g.sightH);
      const k = hd / 1000, ex = gauss() * sig, ey = gauss() * sig;
      const hx = (px - ox) / hd, hz = (pz - oz) / hd;
      launch(r, ox, oy, oz, px - hz * ex * k, gy + 0.45 + poi + ey * k, pz + hx * ex * k, t, -1);
      G.flashT[r] = I.simT;
      G.heat[r] = G.heat[r] * Math.exp(-(I.simT - G.flashT[r]) / D.recover) + (t.g.recoil || 3);
      // the rate: sustained covering fire, or a spray
      if (undisciplined) {
        if (G.burst[r] + 1 < D.burst) { G.burst[r]++; G.cool[r] = t.interval; }
        else { G.burst[r] = 0; G.cool[r] = 0.8 + rnd() * 1.2; }
      } else G.cool[r] = 2.2 + rnd() * 2.0;
    }
    // when rounds last passed a man of each squad (sigmaNow: DOCTRINE.fear)
    const sqHot = [];
    // does the man he is shooting at know he is in a fight? (looking for
    // somebody, has a mark of his own, or was shot at in the last minute)
    function tgAware(r) {
      const tg = G.tgt[r];
      if (tg < 0) return false;
      if (G.ext[tg]) return true;
      return G.tgt[tg] >= 0 || I.simT - G.contactT[tg] < 60 || I.simT - G.crackT[tg] < 60;
    }
    // his angular error in mil (1-sigma per axis) right now
    function sigmaNow(r, t, d) {
      const D = t.D, p = G.post[r];
      let hold = D.hold[p];
      // a magnifying sight takes the aiming error out of the hold at range; irons cover the mark past 200 m
      // (a red dot does not cover the mark like a front post; it does not magnify either)
      if (t.optic > 1) hold *= 0.82;
      else if (d > 150) hold *= 1 + (d - 150) / (t.optic === 1 ? 900 : 450);
      // the aim settling
      hold *= 1 + 2.4 * Math.exp(-G.aimT[r] / (D.settle * (1 + D.press * d / 400)));
      // moving
      if (G.mv[r] !== MOVE.hold) hold += G.mv[r] === MOVE.walk ? 4 : 9;
      // THE RANGE SHOOTS BACK (DOCTRINE.fear): rounds have passed him in the
      // last half minute. It comes on with the first crack and wears off
      // slowly once nobody is shooting at him any more.
      // Rounds past HIM, or past anybody in his squad: a section under
      // fire is under fire, not just the man the last burst was meant for.
      const sqh = G.sqd[r] >= 0 ? sqHot[G.sqd[r]] : undefined;
      const quiet = I.simT - Math.max(G.crackT[r], sqh === undefined ? -99 : sqh);
      let fear = quiet >= 0 && quiet < 40 ? D.fear * (quiet < 8 ? 1 : Math.exp(-(quiet - 8) / 10)) : 0;
      // An armed enemy in sight is already not the range, before his first
      // round arrives: most of it comes on at contact (the first volley of
      // a meeting engagement used to be fired at qualification accuracy,
      // and broke a conscript platoon at 400 m inside eight seconds).
      // The ambusher, whose mark has not seen him, has none of it.
      if (fear < D.fear * 0.6 && tgAware(r)) fear = D.fear * 0.6;
      // the rattle, and a wound
      hold *= 1 + 0.55 * Math.min(3, G.supp[r]) * D.suppK;
      hold *= 1 + (1 - G.cap[r]) * 2.2;
      const heat = G.heat[r] * Math.exp(-(I.simT - G.flashT[r]) / D.recover);
      return Math.sqrt(hold * hold + t.mech * t.mech + heat * heat + fear * fear);
    }
    function fire(r, tg, t, D, d, sig, pinned) {
      G.mag[r]--;
      G.shots[r]++;
      const sd = G.side[r];
      I.stats.shots[sd]++;
      if (I.led.firstShot[sd] < 0) I.led.firstShot[sd] = I.simT;
      I.led.shotsAt[bandOf(d)]++;
      const heat = G.heat[r] * Math.exp(-(I.simT - G.flashT[r]) / D.recover);
      // the muzzle
      const p = G.post[r];
      const ox = G.x[r] + Math.sin(G.face[r]) * 0.5, oz = G.z[r] + Math.cos(G.face[r]) * 0.5, oy = G.y[r] + MUZ[p];
      // the aim point: centre of what he can see of him (a prone man's head and shoulders)
      const pt = G.post[tg];
      let ax = G.x[tg], az = G.z[tg], ay = G.y[tg] + AIMY[pt];
      if (G.expo[r] < 0.12 && pt !== POST.prone) ay = G.y[tg] + LOOK[pt][0][0] - 0.06;   // only the head shows
      // the lead on a mover: his estimate of its velocity x time of flight
      const tf = B.tof(t.v0, t.k, d);
      const lf = D.lead[0] + gauss() * D.lead[1];
      ax += G.vx[tg] * tf * lf; az += G.vz[tg] * tf * lf;
      const hd = Math.hypot(ax - ox, az - oz) || 0.01;
      // the holdover he applies: for the range he THINKS it is
      const est = Math.max(1, hd * (1 + G.rngE[r]));
      const g = t.g;
      const poiTrue = B.poi(t.v0, t.k, hd, g.zero, g.sightH);
      const poiEst = B.poi(t.v0, t.k, est, g.zero, g.sightH);
      const hold = D.press > 0.25 ? -poiEst : 0;         // a man who does not hold over aims centre
      let s = sig;
      if (pinned) s += 18;                                // the rifle stuck up over the lip
      const ex = gauss() * s + (rnd() - 0.5) * heat * 0.5;
      const ey = gauss() * s + heat * 0.6;
      const k = hd / 1000;
      const hx = (ax - ox) / hd, hz = (az - oz) / hd;
      /* THE WIND. The crosswind moves a round by W x (time of flight - range
         / muzzle velocity) (the point-mass lag rule). He holds off for the
         wind he reads: a trained man reads it to within a third, and corrects
         after a miss he sees; an untrained one does not hold off at all. */
      const wc = I.wind.x * hz - I.wind.z * hx;              // the crosswind, m/s (+ = to his right)
      const lag = Math.max(0, tf - hd / t.v0);
      const read = D.adjust > 0.3 ? 1 + gauss() * (1 - D.adjust) * 0.6 : 0;
      const ew = wc * lag * (1 - read);                       // the drift he did not hold off for (m)
      const px = ax - hz * (ex * k - ew), pz = az + hx * (ex * k - ew), py = ay + hold + poiTrue + ey * k;
      launch(r, ox, oy, oz, px, py, pz, t, tg);
      // the gun on his shoulder
      G.heat[r] = heat + (g.recoil || 3) * (p === POST.prone ? 0.55 : p === POST.kneel ? 0.8 : 1);
      G.flashT[r] = I.simT;
      // the rhythm: the next shot in the burst, or the next aimed shot
      const burst = d < 40 ? Math.max(D.burst, 2) : D.burst;
      if (G.burst[r] + 1 < burst) { G.burst[r]++; G.cool[r] = t.interval; }
      else {
        G.burst[r] = 0;
        // a trained man re-aims every round (aimT drops with the recoil);
        // an untrained one fires as fast as the trigger comes back
        G.cool[r] = t.interval + (D.press > 0 ? 0.12 : 0.18 + rnd() * 0.25);
        if (D.press > 0) G.aimT[r] = Math.min(G.aimT[r], D.settle * 0.5);
      }
    }

    /* ============================================================ THE ROUND
       Traced against the ground and the cover at launch; against the bodies
       when it arrives. A ring of rounds in flight. */
    const RF = 16;                       // floats per round
    let RB = new F(4096 * RF), nR = 0;
    // [0 shooter, 1 ox, 2 oy, 3 oz, 4 dx, 5 dy, 6 dz, 7 sStop, 8 tRes, 9 v0, 10 k, 11 type, 12 sT, 13 hk, 14 mark, 15 matStop]
    function launch(r, ox, oy, oz, px, py, pz, t, tg) {
      if ((nR + 1) * RF > RB.length) { const g = new F(RB.length * 2); g.set(RB); RB = g; }
      let dx = px - ox, dy = py - oy, dz = pz - oz;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      dx /= L; dy /= L; dz /= L;
      const hk = Math.sqrt(dx * dx + dz * dz) || 1;
      const g = t.g;
      let sEnd = Math.min((g.max || 900) / hk, L + 1200);
      if (t.k > 1e-4) sEnd = Math.min(sEnd, (t.v0 / t.k) * 0.97 / hk);
      // the world: the first point along the line under the ground or into cover
      const stop = traceWorld(ox, oy, oz, dx, dy, dz, sEnd, L, t, hk);
      const o = nR * RF;
      RB[o] = r; RB[o + 1] = ox; RB[o + 2] = oy; RB[o + 3] = oz; RB[o + 4] = dx; RB[o + 5] = dy; RB[o + 6] = dz;
      RB[o + 7] = stop; RB[o + 9] = t.v0; RB[o + 10] = t.k; RB[o + 11] = G.typ[r]; RB[o + 12] = L; RB[o + 13] = hk; RB[o + 14] = tg;
      RB[o + 15] = _stopMat;
      // it is resolved when it reaches the mark's plane (or where the world stopped it)
      RB[o + 8] = I.simT + B.tof(t.v0, t.k, Math.min(stop, L + 0.5) * hk);
      nR++;
      I.stats.rounds++;
    }
    // the round's height at s along its line (the straight line, and the fall past the mark's plane)
    function roundY(o, s) {
      let y = RB[o + 2] + RB[o + 5] * s;
      const sT = RB[o + 12];
      if (s > sT) {
        const v0 = RB[o + 9], k = RB[o + 10], hk = RB[o + 13];
        y -= Math.max(0, B.drop(v0, k, s * hk) - B.drop(v0, k, sT * hk));
      }
      return y;
    }
    let _stopMat = 0;
    const MATS = ["ground", "sand", "dirt", "wood", "cinder", "brick", "concrete", "steel", "rha"];
    function traceWorld(ox, oy, oz, dx, dy, dz, sEnd, sT, t, hk) {
      _stopMat = 0;
      let s = 1.0, prev = s;
      const fine = 6;
      let crossC = 0, crossMat = "";
      while (s < sEnd) {
        const x = ox + dx * s, z = oz + dz * s;
        let y = oy + dy * s;
        if (s > sT) y -= Math.max(0, B.drop(t.v0, t.k, s * hk) - B.drop(t.v0, t.k, sT * hk));
        const gy = hAt(x, z);
        if (y <= gy) {
          // bisect once between the last clear sample and this one
          let a = prev, b = s;
          for (let i = 0; i < 4; i++) {
            const m = (a + b) * 0.5;
            let ym = oy + dy * m;
            if (m > sT) ym -= Math.max(0, B.drop(t.v0, t.k, m * hk) - B.drop(t.v0, t.k, sT * hk));
            if (ym <= hAt(ox + dx * m, oz + dz * m)) b = m; else a = m;
          }
          _stopMat = 0;
          return b;
        }
        if (cover) {
          const ct = coverAt(x, z);
          if (ct > 0 && y <= gy + ct) {
            // through cover: its material, the metres of it along the line
            const mat = coverMat(x, z);
            if (mat !== crossMat) { crossMat = mat; crossC = 0; }
            crossC += s - prev;
            const v = B.vAt(t.v0, t.k, s * hk);
            if (B.pierce(t.c, mat, crossC, v, t.v0) < 60) { _stopMat = Math.max(1, MATS.indexOf(mat)); return s; }
          } else crossC = 0;
        }
        prev = s;
        // fine near the muzzle and around the mark, coarser between
        s += (s < fine || Math.abs(s - sT) < 8) ? 0.5 : Math.max(1.5, Math.min(4, (sEnd - s) / 60));
        // a round more than 2.5 m over the ground cannot hit anybody and does not land:
        // skip ahead while it is high (exact for a heightfield that changes slowly)
      }
      return sEnd;
    }
    const _hitList = [], _hitA = [];
    const _tr = { z: [], n: 0 }, _wr = {}, _pl = { z: [], n: 0 };
    const MAN_AN = { mass: 80, hide: 0, skull: 7, ribs: 10, plan: "man" };
    function resolveRounds() {
      const t0 = now();
      let w = 0;
      for (let i = 0; i < nR; i++) {
        const o = i * RF;
        if (RB[o + 8] > I.simT) {
          if (w !== i) RB.copyWithin(w * RF, o, o + RF);
          w++;
          continue;
        }
        resolve(o, I.types[RB[o + 11] | 0], false);
      }
      nR = w;
      I.ms.rounds += now() - t0;
    }
    /* A ROUND ARRIVES. o: its slot in RB; t: what fired it ({ c: cartridge,
       D: the shooter's doctrine, or null for a round from the host's world});
       outside: the round is the host's (it does not wound the host's own
       bodies through here; the host resolves those). Returns where it stopped. */
    function resolve(o, t, outside) {
      const sh = RB[o] | 0, typ = RB[o + 11] | 0;
      const ox = RB[o + 1], oz = RB[o + 3], dx = RB[o + 4], dz = RB[o + 6], hk = RB[o + 13];
      let stop = RB[o + 7];
      const sT = RB[o + 12];
      const sd = outside ? _outSide : G.side[sh];
      // the bodies along the line: everyone within 1.2 m of it in the ground
      // plane, from the muzzle to where it stopped (the body grid, 4 m cells)
      _hitList.length = 0; _hitA.length = 0;
      const ux = dx / hk, uz = dz / hk;
      const hEnd = stop * hk;
      const stamp = ++_stampN, cst = ++hbStamp;
      // the band of cells within 3.2 m of its path (a hit within 1.25 m, a crack
      // within the cartridge's suppression radius), walked a cell at a time
      _rv.o = o; _rv.sh = sh; _rv.side = sd; _rv.ox = ox; _rv.oz = oz; _rv.ux = ux; _rv.uz = uz; _rv.hEnd = hEnd; _rv.hk = hk; _rv.stop = stop; _rv.t = t; _rv.stamp = stamp; _rv.outside = outside;
      for (let hs = 2; hs <= hEnd + 4; hs += 4) {
        const x = ox + ux * hs, z = oz + uz * hs;
        // the round high over the ground cannot hit or rattle anybody here
        if (hs > 12) { const yy = roundY(o, hs / hk); if (yy - hAt(x, z) > 4.5) continue; }
        forCells(x, z, 3.2, cst, visitBody);
      }
      // in the order it meets them
      for (let i = 1; i < _hitList.length; i++) {
        const b = _hitList[i], a = _hitA[i];
        let j = i - 1;
        while (j >= 0 && _hitA[j] > a) { _hitList[j + 1] = _hitList[j]; _hitA[j + 1] = _hitA[j]; j--; }
        _hitList[j + 1] = b; _hitA[j + 1] = a;
      }
      let vk = 1;
      let hitRow = -1;
      for (let i = 0; i < _hitList.length; i++) {
        const b = _hitList[i], a = _hitA[i];
        if (!alive(b)) continue;
        const v = B.vAt(RB[o + 9], RB[o + 10], a * hk) * vk;
        if (v < 60) { stop = a; break; }
        if (G.ext[b]) {
          // one of the host's own bodies (its men, an animal, a hull): the host
          // flies this round into it with its own anatomy and armour
          extHit(o, b, a, v, sh, typ);
          if (hitRow < 0) hitRow = b;
          stop = a + 0.1;
          break;
        }
        traceMan(o, b, a);
        const vOut = woundMan(o, b, v, t, sh);
        if (hitRow < 0) hitRow = b;
        if (vOut < 60) { stop = a + 0.2; break; }
        vk *= vOut / v;
      }
      if (outside) return stop;
      // the strike: where a miss lands tells a trained shooter how far off he was
      if (hitRow < 0) {
        const mk = RB[o + 14] | 0;
        if (mk >= 0 && G.rngTgt[sh] === mk && t.D) {
          const D = t.D;
          // he sees the dust kick (not in the dark, not off his own suppression)
          if (stop < sT + 60 && G.supp[sh] < D.pinAt) G.rngE[sh] *= 1 - D.adjust;
        }
        // it lands near somebody: the strike rattles him too
        const sx = ox + dx * stop, sz = oz + dz * stop;
        forDiscB(sx, sz, 2.5, function (b) {
          if (G.side[b] === sd || !alive(b)) return;
          const ddx = G.x[b] - sx, ddz = G.z[b] - sz, dd = Math.sqrt(ddx * ddx + ddz * ddz);
          if (dd < 2.5) crack(b, 0.5 * (1 - dd / 2.5), ox, oz);
        });
      }
      // the renderer's copy: the whole line, its real stop
      if (I.shotR > 0) {
        const ddx = ox - I.camX, ddz = oz - I.camZ, ex = ox + dx * stop - I.camX, ez = oz + dz * stop - I.camZ;
        const R2 = I.shotR * I.shotR;
        if (ddx * ddx + ddz * ddz < R2 || ex * ex + ez * ez < R2) {
          if ((I.nShot + 1) * SHOT_F > I.shots.length) { const g = new F(I.shots.length * 2); g.set(I.shots); I.shots = g; }
          const q = I.nShot * SHOT_F;
          I.shots[q] = sh; I.shots[q + 1] = ox; I.shots[q + 2] = RB[o + 2]; I.shots[q + 3] = oz;
          I.shots[q + 4] = dx; I.shots[q + 5] = RB[o + 5]; I.shots[q + 6] = dz; I.shots[q + 7] = stop;
          I.shots[q + 8] = RB[o + 9]; I.shots[q + 9] = RB[o + 10]; I.shots[q + 10] = typ; I.shots[q + 11] = hitRow;
          I.shots[q + 12] = RB[o + 15];
          I.nShot++;
        }
      }
    }
    let _stampN = 1, _stampA = new I32(0);
    const _rv = { o: 0, sh: 0, side: 0, ox: 0, oz: 0, ux: 0, uz: 0, hEnd: 0, hk: 1, stop: 0, t: null, stamp: 0, outside: false };
    let _outSide = 0;
    function visitBody(b) {
      const R = _rv;
      if (b === R.sh || _stampA[b] === R.stamp) return;
      _stampA[b] = R.stamp;
      const bx = G.x[b] - R.ox, bz = G.z[b] - R.oz;
      const along = bx * R.ux + bz * R.uz;
      if (along < 0.5 || along > R.hEnd + 1) return;
      const off = Math.abs(bx * R.uz - bz * R.ux);
      const ek = G.ext[b];
      if (ek) {
        // the host's body: a hull or an animal by its footprint, its men as men
        if (R.outside) return;                         // (the host flies its own rounds into its own bodies)
        if (ek !== EXT.man) {
          const reach = G.extW[b] * 0.5 + 0.3;
          if (off > reach) { return; }
          const y = roundY(R.o, along / R.hk) - G.y[b];
          if (y < -0.2 || y > G.extH[b] + 0.2) return;
          const a = Math.max(0, along - reach) / R.hk;
          if (a >= R.stop) return;
          _hitList.push(b); _hitA.push(a);
          return;
        }
      }
      if (off > 1.25) { if (off < 6) nearMiss(R.o, b, along, off, R.t); return; }
      // the line through his body, in his posture
      const a = traceMan(R.o, b, along / R.hk);
      if (a < 0) { nearMiss(R.o, b, along, off, R.t); return; }
      if (a >= R.stop) return;
      _hitList.push(b); _hitA.push(a);
    }
    /* A ROUND OF OURS REACHED ONE OF THE HOST'S BODIES: handed over whole (the
       line, where it met him, its speed, who fired, what fired) for the host
       to fly into him with its own anatomy and armour. */
    const EXT_F = 12;
    I.extHits = new F(256 * EXT_F); I.nExt = 0;
    function extHit(o, b, a, v, sh, typ) {
      if ((I.nExt + 1) * EXT_F > I.extHits.length) { const g = new F(I.extHits.length * 2); g.set(I.extHits); I.extHits = g; }
      const q = I.nExt * EXT_F, E = I.extHits;
      E[q] = b; E[q + 1] = sh; E[q + 2] = RB[o + 1]; E[q + 3] = RB[o + 2]; E[q + 4] = RB[o + 3];
      E[q + 5] = RB[o + 4]; E[q + 6] = RB[o + 5]; E[q + 7] = RB[o + 6]; E[q + 8] = Math.max(0, a - 1.5); E[q + 9] = v; E[q + 10] = typ; E[q + 11] = I.simT;
      I.nExt++;

    }
    I.EXT_F = EXT_F;
    // the zones the line crosses in man b (into _tr); returns the first entry (m along the line) or -1
    function traceMan(o, b, s0) {
      const ox = RB[o + 1], oy = RB[o + 2], oz = RB[o + 3], dx = RB[o + 4], dy = RB[o + 5], dz = RB[o + 6];
      const s = Math.max(0, s0 - 3);
      const by = roundY(o, s0) - (oy + dy * s0);           // the drop at his plane, applied as an offset
      const qx = ox + dx * s - G.x[b], qy = oy + dy * s + by - G.y[b], qz = oz + dz * s - G.z[b];
      const h = G.heading[b];
      const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
      const of = qx * fx + qz * fz, orr = qx * rx + qz * rz;
      const df = dx * fx + dz * fz, dr = dx * rx + dz * rz;
      const plan = B.MAN[POST_NAME[G.post[b]]];
      if (!B.traceZones(plan, of, orr, qy, df, dr, dy, 1, 1, 1, _tr)) return -1;
      let a = Infinity;
      for (let i = 0; i < _tr.n; i++) { _tr.z[i].a += s; _tr.z[i].b += s; if (_tr.z[i].kind === "outer" && _tr.z[i].a < a) a = _tr.z[i].a; }
      if (a === Infinity) return -1;
      // the plates: real boxes where he wears them (front and back of the chest,
      // the sides, the helmet's shell), traced on the same line
      _pl.n = 0;
      if (G.plF[b] || G.plS[b] || G.helm[b] || G.plSo[b]) {
        const P = PLATE_BOX[G.post[b]];
        let n = 0;
        for (let i = 0; i < P.length; i++) {
          const box = P[i];
          if (box.kind === "front" && !G.plF[b]) continue;
          if (box.kind === "back" && !G.plB[b]) continue;
          if (box.kind === "side" && !G.plS[b]) continue;
          if (box.kind === "helm" && !G.helm[b]) continue;
          if (box.kind === "soft" && !G.plSo[b]) continue;
          _plOne.length = 0;
          if (B.traceZones(box.z, of, orr, qy, df, dr, dy, 1, 1, 1, _plT)) {
            let e = _pl.z[n] || (_pl.z[n] = { kind: "", a: 0 });
            e.kind = box.kind; e.a = _plT.z[0].a + s; n++;
          }
        }
        _pl.n = n;
      }
      return a;
    }
    const _plOne = [], _plT = { z: [], n: 0 }, _piece = { kind: "", mat: "", rating: 0, deflect: 0, integrity: 1 };
    function Zb(f0, f1, r0, r1, y0, y1) { return [{ name: "plate", f0: f0, f1: f1, r0: r0, r1: r1, y0: y0, y1: y1, kind: "outer" }]; }
    /* THE PLATES IN THE BODY'S FRAME. A medium SAPI/ESAPI is 24 x 32 cm over
       the upper chest; an ESBI side plate 15 x 20 cm under the arm; the
       helmet shell covers the skull above the brow line (the face is open). */
    const PLATE_BOX = [
      [ { kind: "front", z: Zb(0.115, 0.135, -0.12, 0.12, 1.12, 1.44) }, { kind: "back", z: Zb(-0.135, -0.115, -0.12, 0.12, 1.12, 1.44) },
        { kind: "side", z: Zb(-0.075, 0.075, -0.21, -0.19, 1.10, 1.30) }, { kind: "side", z: Zb(-0.075, 0.075, 0.19, 0.21, 1.10, 1.30) },
        { kind: "helm", z: Zb(-0.115, 0.115, -0.105, 0.105, 1.69, 1.81) },
        { kind: "soft", z: Zb(0.10, 0.12, -0.17, 0.17, 0.86, 1.44) }, { kind: "soft", z: Zb(-0.12, -0.10, -0.17, 0.17, 0.86, 1.44) } ],
      [ { kind: "front", z: Zb(0.135, 0.155, -0.12, 0.12, 0.64, 0.96) }, { kind: "back", z: Zb(-0.135, -0.115, -0.12, 0.12, 0.64, 0.96) },
        { kind: "side", z: Zb(-0.06, 0.09, -0.21, -0.19, 0.62, 0.82) }, { kind: "side", z: Zb(-0.06, 0.09, 0.19, 0.21, 0.62, 0.82) },
        { kind: "helm", z: Zb(-0.095, 0.135, -0.105, 0.105, 1.11, 1.23) },
        { kind: "soft", z: Zb(0.12, 0.14, -0.17, 0.17, 0.42, 0.96) }, { kind: "soft", z: Zb(-0.12, -0.10, -0.17, 0.17, 0.42, 0.96) } ],
      [ { kind: "front", z: Zb(0.32, 0.64, -0.12, 0.12, 0.0, 0.03) }, { kind: "back", z: Zb(0.32, 0.64, -0.12, 0.12, 0.27, 0.30) },
        { kind: "side", z: Zb(0.36, 0.56, -0.23, -0.21, 0.04, 0.24) }, { kind: "side", z: Zb(0.36, 0.56, 0.21, 0.23, 0.04, 0.24) },
        { kind: "helm", z: Zb(0.78, 0.97, -0.105, 0.105, 0.26, 0.40) },
        { kind: "soft", z: Zb(0.0, 0.70, -0.17, 0.17, 0.0, 0.025) }, { kind: "soft", z: Zb(0.0, 0.70, -0.17, 0.17, 0.255, 0.28) } ],
    ];
    function plateOf(b, kind) {
      return kind === "front" ? G.plF[b] : kind === "back" ? G.plB[b] : kind === "side" ? G.plS[b] : kind === "soft" ? G.plSo[b] : G.helm[b];
    }
    /* THE HIT: what the round does to him. Returns the velocity it leaves with. */
    function woundMan(o, b, v, t, sh) {
      // the first outer zone it enters, and any plate in front of it
      let first = null;
      for (let i = 0; i < _tr.n; i++) if (_tr.z[i].kind === "outer" && (!first || _tr.z[i].a < first.a)) first = _tr.z[i];
      if (!first) return v;
      let layer = null, plateKind = null;
      for (let i = 0; i < _pl.n; i++) {
        const e = _pl.z[i];
        // a hard piece (a plate, the helmet) before the soft panel behind it
        if (e.a <= first.a + 0.25 && (!plateKind || (plateKind === "soft" && e.kind !== "soft") || (e.kind !== "soft" && e.a < layer))) { plateKind = e.kind; layer = e.a; }
      }
      const c = t.c;
      let lay = null;
      if (plateKind && AR) {
        const P = PLATES[plateOf(b, plateKind)];
        if (P) {
          I.led.plate++;
          // CBZ.armour's own rule (versus): the round's steel-equivalent
          // penetration now against this piece's rating, cracked as it is
          const col = plateKind === "front" ? G.inF : plateKind === "back" ? G.inB : plateKind === "side" ? G.inS : plateKind === "soft" ? G.inSo : G.inH;
          const pc = _piece;
          pc.kind = P.kind; pc.mat = P.mat; pc.rating = P.rating; pc.deflect = P.deflect || 0; pc.integrity = col[b];
          const out = AR.versus(pc, c, v, c.v0, rnd);
          const ej = B.energy(c, v);
          const cost = ej * AR.RULES.crackPerJ * (AR.RULES.crack[P.mat] || 0.5);
          if (out === "pen") {
            lay = { mat: "steel", mm: Math.min(AR.rateMM(AR.ratingOf(pc)), B.depth(c, "steel", v, c.v0) * 700) };
            I.led.platePen++;
            col[b] = Math.max(0, col[b] - cost * 1.6);
          } else {
            lay = { mat: "steel", mm: 999 };
            col[b] = Math.max(0, col[b] - (out === "deflect" ? 0.18 : cost));
          }
        }
      }
      // A SHIELD IN THE WAY (a man of the line facing the shot): the round goes
      // through a centimetre of boards and hide first, and keeps nearly all of its speed
      if (G.anc[b] && G.shd[b] && !G.down[b]) {
        const SH = T_(b).SH, hb = G.heading[b];
        const facing = -(Math.sin(hb) * RB[o + 4] + Math.cos(hb) * RB[o + 6]) / (RB[o + 13] || 1);
        const hy = roundY(o, first.a) - G.y[b];
        if (SH && facing > 0.3 && hy > SH.y0 && hy < SH.y0 + SH.h) {
          v = B.pierce(c, "wood", SH.wood / Math.max(0.3, facing), v, c.v0);
          I.led.shieldHits = (I.led.shieldHits || 0) + 1;
          if (v < 60) return 0;
        }
      }
      const res = B.wound(_tr, MAN_AN, c, v, c.v0, lay, _wr);
      if (!res.hit) return v;
      const H = B.harm(res, MAN_AN, true);
      const sd = _rv.side;
      I.stats.hits[sd]++;
      if (sh >= 0) G.hits[sh]++;
      if (I.led.firstHit[sd] < 0) I.led.firstHit[sd] = I.simT;
      const dist = Math.hypot(G.x[b] - RB[o + 1], G.z[b] - RB[o + 3]);
      I.led.hitsAt[bandOf(dist)]++;
      if ((RB[o + 14] | 0) < 0) I.led.areaHits = (I.led.areaHits || 0) + 1;      // a round fired at a place, not a man
      const org = res.plate ? "plate" : res.organ || (res.zone === "head" ? "head" : res.zone && (res.zone.indexOf("arm") === 0 || res.zone.indexOf("leg") === 0) ? "limb" : "torso");
      if (I.led.organs[org] != null) I.led.organs[org]++;
      // what it does to him
      /* WHAT IT DOES TO HIM, AS A MAN. ballistics.harm is per unit of a whole
         body; for a man the wound takes him out of the fight (now) and the
         blood loss kills him over time. A round through the brain kills on
         the spot; through the chest he is down at once and dies over tens of
         seconds (the heart) to minutes (the lungs) unless his mates pack and
         tie it off; the gut takes longer; a limb longer still. */
      hurt(b, H.kill ? 2 : Math.min(0.9, H.now), H.bleed * 0.25, sh, res.plate);
      return res.vOut;
    }
    function hurt(b, now_, bleed, by, plate) {
      if (!alive(b)) return;
      G.cap[b] -= now_;
      G.bleed[b] += bleed;
      G.hp[b] = Math.max(0, G.cap[b] * 100);
      // a hit is a big jolt to the nerve, a plate stop a smaller one
      G.supp[b] += plate ? 0.8 : 1.6;
      G.stress[b] += plate ? 0.08 : 0.25;
      G.aimT[b] = 0;
      if (G.anc[b] && G.blk[b] >= 0 && by >= 0 && !G.anc[by]) BK.fireT[G.blk[b]] = I.simT;
      if (by >= 0) { G.crackT[b] = I.simT; G.hitX[b] = G.x[by]; G.hitZ[b] = G.z[by]; if (G.tgt[b] < 0 && G.lkT[b] < I.simT - 2) { G.lkx[b] = G.x[by]; G.lkz[b] = G.z[by]; G.lkT[b] = I.simT - 3; } }
      // HE IS HIT, AND HIS SQUAD KNOWS IT (the shout, the man going down): contact, and a
      // bearing on where it came from (the crack and the thump give it, roughly)
      const sqb = G.sqd[b];
      if (sqb >= 0 && by >= 0) {
        const d = Math.hypot(G.x[by] - G.x[b], G.z[by] - G.z[b]), e = 3 + d * 0.08;
        SQ.lastC[sqb] = I.simT; SQ.thx[sqb] = G.x[by] + gauss() * e; SQ.thz[sqb] = G.z[by] + gauss() * e;
      }
      ev(EV.hit, b, by, now_);
      if (G.cap[b] <= 0) { kill(b, by); return; }
      if (!G.down[b] && G.cap[b] < 0.5) downMan(b, by);
    }
    function downMan(b, by) {
      G.down[b] = 1; G.tgt[b] = -1; G.mv[b] = MOVE.hold; G.post[b] = POST.prone; G.postT[b] = 0;
      I.stats.downs[by >= 0 ? G.side[by] : (G.side[b] ? 0 : 1)]++;
      ev(EV.down, b, by, 0);
      shock(b, 0.3);
      armyLoss(b);
    }
    function kill(b, by) {
      if (G.life[b] === LIFE.dead) return;
      G.life[b] = LIFE.dead; G.cap[b] = 0; G.hp[b] = 0; G.vx[b] = 0; G.vz[b] = 0; G.mv[b] = MOVE.hold;
      I.stats.kills[by >= 0 ? G.side[by] : (G.side[b] ? 0 : 1)]++;
      ev(EV.kill, b, by, 0);
      if (!G.down[b]) { shock(b, 0.45); armyLoss(b); }
    }
    /* THE ARMY'S OWN MORALE (when the host has none to hand in): the shared
       rule, CBZ.brain.morale (shock decays, losses against theirs, men seen
       running, the odds), over this sim's men: each weighs his training. */
    function manW(r) {
      const MO = CBZ.brain && CBZ.brain.morale, K = MO && MO.K;
      const t = I.types[G.typ[r]];
      return (K && K.TIER_W && K.TIER_W[t.trn]) || 1;
    }
    function armyLoss(b) {
      if (!I.armySelf || G.ext[b]) return;
      const MO = CBZ.brain && CBZ.brain.morale;
      if (MO && MO.deathShock) MO.deathShock(I.army[G.side[b]], manW(b));
    }
    let armyAt = -1;
    function armyTick() {
      const MO = CBZ.brain && CBZ.brain.morale;
      if (!I.armySelf || !MO || !MO.armyStep) return;
      const dt = armyAt < 0 ? 0 : I.simT - armyAt;
      if (armyAt >= 0 && dt < 0.6) return;
      armyAt = I.simT;
      const A0 = I.army[0], A1 = I.army[1];
      A0.pNow = A1.pNow = 0; A0.alive = A1.alive = 0; A0.routing = A1.routing = 0;
      const n = I.nRows || 0;
      for (let r = 0; r < n; r++) {
        const l = G.life[r];
        if ((l !== LIFE.alive && l !== LIFE.routed) || G.ext[r] || G.down[r]) continue;
        const A = I.army[G.side[r]];
        A.alive++;
        if (l === LIFE.routed) A.routing++;
        A.pNow += manW(r) * (0.45 + 0.55 * Math.max(0, Math.min(1, G.cap[r])));
      }
      MO.armyStep(A0, A1, dt, null);
      MO.armyStep(A1, A0, dt, null);
    }
    // the men round a man who goes down feel it
    function shock(b, k) {
      const x = G.x[b], z = G.z[b], sd = G.side[b];
      forDiscB(x, z, 15, function (o) {
        if (o === b || G.side[o] !== sd || G.ext[o] || !fighting(o)) return;
        const dx = G.x[o] - x, dz = G.z[o] - z, d2 = dx * dx + dz * dz;
        if (d2 > 225) return;
        // (a man in close order has a hundred men within 15 m of him and was
        // drilled to expect the front rank to fall: it is the man beside him
        // who counts, and the block's losses, counted by the block)
        const g = G.anc[o] ? (d2 < 4 ? 0.35 : 0.06) : 1;
        G.stress[o] += k * 0.4 * (1 - Math.sqrt(d2) / 15) * D_(o).suppK * g;
      });
      const sq = G.sqd[b];
      if (sq >= 0) SQ.hurt[sq] = Math.min(255, SQ.hurt[sq] + 1);
    }
    // A ROUND CRACKS PAST HIM
    function nearMiss(o, b, along, off, t) {
      if (G.side[b] === _rv.side || !alive(b)) return;
      if (G.ext[b] && (G.ext[b] !== EXT.man || _rv.outside)) return;
      const v = B.vAt(RB[o + 9], RB[o + 10], along);
      const R = B.suppressR(t.c, v);
      const y = roundY(o, along / RB[o + 13]) - (G.y[b] + EYE[G.post[b]]);
      const miss = Math.sqrt(off * off + y * y);
      if (miss > R) return;
      crack(b, 1 - miss / R, RB[o + 1], RB[o + 3]);
    }
    function crack(b, k, fx, fz) {
      // one of the host's men: the host rattles him (its own suppression)
      if (G.ext[b]) { if (G.ext[b] === EXT.man) ev(EV.crack, b, -1, k); return; }
      if (G.anc[b] && G.blk[b] >= 0) BK.fireT[G.blk[b]] = I.simT;     // his block is under missiles
      const D = D_(b);
      // (it saturates: the fifth round past his head is not five times as frightening as the first)
      G.supp[b] += D.suppK * (0.35 + 0.65 * k) * Math.max(0.1, 1 - G.supp[b] / (D.pinAt * 2.5));
      if (G.sqd[b] >= 0) sqHot[G.sqd[b]] = I.simT;
      G.stress[b] += 0.012 * D.suppK * k;
      I.led.cracks++;
      if (I.simT - G.crackT[b] > 3 || G.tgt[b] < 0) { G.hitX[b] = fx; G.hitZ[b] = fz; }
      G.crackT[b] = I.simT;
      // the crack and the thump say roughly where it came from: a point with an error
      if (G.tgt[b] < 0 && I.simT - G.lkT[b] > 4) {
        const dx = fx - G.x[b], dz = fz - G.z[b], d = Math.sqrt(dx * dx + dz * dz) || 1;
        const err = d * (0.06 + 0.12 * (1 - D.adjust));
        G.lkx[b] = fx + gauss() * err; G.lkz[b] = fz + gauss() * err; G.lkT[b] = I.simT;
      }
    }

    /* ============================================================ OUTSIDE ROUNDS AND BLASTS
       a round from the host's world (a vehicle's gun, the player): traced
       through the rows exactly as one of ours */
    I.hurt = function (imp) {
      if (!imp) return;
      if (imp.kind === "blast") { blast(imp); return; }
    };
    /* A BLAST. The charge W (kg TNT) does two things to a man: the
       overpressure, lethal inside a scaled distance Z = d / W^(1/3) of ~1.5
       (blast-lung, the body thrown), and the FRAGMENTS, which are the killer
       at range. Calibrated on the M67 (0.18 kg Comp B): ~2000 effective
       fragments, ~50% casualties at its 5 m kill radius and ~15% at its 15 m
       casualty radius against a standing man. The number of fragments that
       find a man is the count over the sphere times the area he shows: a man
       flat on the ground presents a third (that is why men go flat), the
       ground itself shields him past the shell's own height. Each one is a
       small wound; enough of them is a casualty. */
    function blast(imp) {
      const Wk = Math.max(0.005, imp.W || 0.18), Rk = 18 * Math.cbrt(Wk / 0.18), N0 = 2000 * Wk / 0.18;
      const by = imp.by == null ? -1 : imp.by;
      forDiscB(imp.x, imp.z, Rk, function (b) {
        if (!alive(b) || G.ext[b]) return;                 // (the host blasts its own bodies)
        const d = Math.max(0.3, Math.hypot(G.x[b] - imp.x, G.z[b] - imp.z));
        if (d > Rk) return;
        const Z = d / Math.cbrt(Wk);
        if (Z < 1.5) { hurt(b, 2, 0, by, false); return; }
        const show = G.post[b] === POST.prone ? 0.22 : G.post[b] === POST.kneel ? 0.45 : 0.7;
        const mean = N0 * show / (4 * Math.PI * d * d);
        // Poisson, by inversion (the mean is small past a few metres)
        let n = 0, p = Math.exp(-Math.min(30, mean)), s = p;
        const u = rnd();
        while (u > s && n < 40) { n++; p *= mean / n; s += p; }
        for (let k = 0; k < n && alive(b); k++) hurt(b, 0.05 + rnd() * 0.22, 0.004 + rnd() * 0.01, by, false);
        G.supp[b] += 3 * (1 - d / Rk);
        G.crackT[b] = I.simT; G.hitX[b] = imp.x; G.hitZ[b] = imp.z;
      });
    }

    /* ============================================================ BODIES MOVE */
    let moveN = 0;
    function moveAll(dt) {
      const t0 = now();
      const n = I.nRows || 0;
      moveN++;
      const LF = G.life, PT = G.postT, SU = G.supp, ST = G.stress, BL = G.bleed, EX = G.ext, AC = G.anc;
      // the stress of it wears off over a minute or so (faster out of contact)
      const kIn = Math.exp(-dt / 90), kOut = Math.exp(-dt / 30);
      for (let r = 0; r < n; r++) {
        const l = LF[r];
        if ((l !== LIFE.alive && l !== LIFE.routed) || EX[r]) continue;
        // the body's clocks
        if (PT[r] > 0) { PT[r] -= dt; if (PT[r] <= 0) { PT[r] = 0; G.post[r] = G.postTo[r]; } }
        if (SU[r] > 0) { SU[r] *= CALM_K[G.typ[r]]; if (SU[r] < 0.01) SU[r] = 0; }
        if (ST[r] > 0) ST[r] *= I.simT - G.contactT[r] < 10 ? kIn : kOut;
        if (AC[r]) { ancMove(r, dt); continue; }             // the line of battle: his slot in the frame
        if (BL[r] <= 0 && G.mv[r] === MOVE.hold) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        if (G.bleed[r] > 0) {
          G.cap[r] -= G.bleed[r] * dt;
          G.hp[r] = Math.max(0, G.cap[r] * 100);
          if (G.cap[r] <= 0) { kill(r, -1); continue; }
          if (!G.down[r] && G.cap[r] < 0.5) downMan(r, -1);
        }
        const m = G.mv[r];
        if (m === MOVE.hold || G.postT[r] > 0 || G.down[r]) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        // a man moves in his posture: up to rush, flat to crawl
        let sp = m === MOVE.rush ? SPEED.rush : m === MOVE.run ? SPEED.run : m === MOVE.crawl ? SPEED.crawl : m === MOVE.march ? SPEED.march : SPEED.walk;
        if (m === MOVE.crawl && G.post[r] !== POST.prone) sp = 0.9;     // a crouched shuffle
        if ((m === MOVE.rush || m === MOVE.run || m === MOVE.walk || m === MOVE.march) && G.post[r] !== POST.stand) { setPost(r, POST.stand); G.vx[r] = 0; G.vz[r] = 0; continue; }
        sp *= 0.55 + 0.45 * Math.min(1, G.cap[r] / 0.8);
        const dx = G.gx[r] - G.x[r], dz = G.gz[r] - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.05) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        const st = Math.min(d, sp * dt);
        const vx = dx / d * sp, vz = dz / d * sp;
        G.vx[r] = vx; G.vz[r] = vz;
        G.x[r] += dx / d * st; G.z[r] += dz / d * st;
        G.y[r] = hAt(G.x[r], G.z[r]);
        if (m === MOVE.rush) G.rushT[r] += dt;
        // his facing follows his path (four times a second is all a body turns)
        if (((r + moveN) & 1) === 0) G.heading[r] = Math.atan2(dx, dz);
      }
      I.ms.move += now() - t0;
    }

    /* ============================================================ THE SQUAD */
    function boundingTeam(sq, r) {
      const s = G.slot[r];
      const team = s === 0 ? 0 : s <= 4 ? 1 : 2;
      return SQ.bound[sq] === team || (SQ.bound[sq] === 1 && team === 0);
    }
    // the next bound: 20-35 m toward the threat, to the best spot there
    const _bg = { x: 0, z: 0 };
    function boundGoal(r, sq, tx, tz) {
      const x = G.x[r], z = G.z[r];
      const dx = tx - x, dz = tz - z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (d < 18) return null;
      const L = Math.min(d - 12, SQ.task[sq] === TASK.assault ? 30 : 22 + 10 * trait(r, 0xB0));
      const cx = x + dx / d * L, cz = z + dz / d * L;
      // a spot there that hides him: the best of a few
      let best = -1, bx = cx, bz = cz;
      for (let k = 0; k < 6; k++) {
        const a = k * 1.047 + trait(r, k + 0x99) * 0.5, rr = k ? 4 : 0;
        const px = cx + Math.sin(a) * rr, pz = cz + Math.cos(a) * rr;
        const s = spotScore(px, pz, POST.prone, tx, tz);
        const v = s.ok ? 1 - s.show : -1;
        if (v > best) { best = v; bx = px; bz = pz; }
      }
      _bg.x = bx; _bg.z = bz;
      return _bg;
    }
    // a bound of 20-30 m toward (gx, gz), to the best spot there against the threat (tx, tz)
    function boundToward(r, sq, gx, gz, tx, tz) {
      const x = G.x[r], z = G.z[r];
      const dx = gx - x, dz = gz - z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (d < 6) return null;
      const L = Math.min(d, 20 + 10 * trait(r, 0xF1A));
      void sq;
      return spotNear(r, x + dx / d * L, z + dz / d * L, tx, tz);
    }
    // the best prone spot round (cx, cz) against a threat: a lip that hides him
    const _sn = { x: 0, z: 0 };
    function spotNear(r, cx, cz, tx, tz) {
      let best = -1, bx = cx, bz = cz;
      for (let k = 0; k < 6; k++) {
        const a = k * 1.047 + trait(r, k + 0x9A) * 0.5, rr = k ? 4 : 0;
        const px = cx + Math.sin(a) * rr, pz = cz + Math.cos(a) * rr;
        const s = spotScore(px, pz, POST.prone, tx, tz);
        const v = s.ok ? 1 - s.show : -1;
        if (v > best) { best = v; bx = px; bz = pz; }
      }
      _sn.x = bx; _sn.z = bz;
      return _sn;
    }
    /* BUDDY AID (decide calls it). Returns true while he is busy with it. */
    function aidStep(r, D, sq, pinned) {
      const p = G.aidOn[r];
      if (p >= 0) {
        if (!alive(p) || !G.down[p] || G.aidBy[p] !== r) { G.aidOn[r] = -1; return false; }
        const dx = G.x[p] - G.x[r], dz = G.z[p] - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
        if (d > 1.0) {
          G.gx[r] = G.x[p] - dx / (d || 1) * 0.7; G.gz[r] = G.z[p] - dz / (d || 1) * 0.7;
          // the last strides low (a crawl under fire), the rest a rush
          if (d < 6 && (pinned || I.simT - G.crackT[r] < 3)) { if (G.post[r] === POST.stand) setPost(r, POST.prone); G.mv[r] = MOVE.crawl; }
          else { setPost(r, POST.stand); G.mv[r] = MOVE.rush; G.rushT[r] = 0; }
          G.aidEnd[r] = 0;
          return true;
        }
        G.mv[r] = MOVE.hold;
        if (G.post[r] === POST.stand) setPost(r, POST.kneel);
        if (G.aidEnd[r] <= 0) G.aidEnd[r] = I.simT + 18 + 20 * (1 - D.press) + rnd() * 10;
        if (I.simT >= G.aidEnd[r]) {
          // packed, tied off: the bleeding mostly stopped
          G.bleed[p] *= 0.12;
          I.led.aids++;
          ev(EV.aid, p, r, 0);
          G.aidOn[r] = -1; G.aidEnd[r] = 0;
          return false;
        }
        return true;
      }
      if (D.aid <= 0 || pinned || sq < 0) return false;
      const task = SQ.task[sq];
      if (task === TASK.assault || task === TASK.breakc || task === TASK.gone) return false;
      if (G.slot[r] === 0 && SQ.cnt[sq] > 2) return false;          // the leader runs the fight
      const base = sq * 10;
      for (let j = 0; j < 10; j++) {
        const w = SQ.mem[base + j];
        if (w < 0 || w === r || !alive(w) || !G.down[w] || G.aidBy[w] >= 0 && alive(G.aidBy[w]) && G.aidOn[G.aidBy[w]] === w) continue;
        if (G.bleed[w] < 0.002) continue;                          // he is not bleeding out
        const d = Math.hypot(G.x[w] - G.x[r], G.z[w] - G.z[r]);
        if (d > D.aid) continue;
        // the nearest free mate goes
        let nearer = false;
        for (let k = 0; k < 10 && !nearer; k++) {
          const o = SQ.mem[base + k];
          if (o < 0 || o === r || o === w || !fighting(o) || G.aidOn[o] >= 0 || (G.slot[o] === 0 && SQ.cnt[sq] > 2)) continue;
          if (Math.hypot(G.x[w] - G.x[o], G.z[w] - G.z[o]) < d - 0.5) nearer = true;
        }
        if (nearer) continue;
        G.aidOn[r] = w; G.aidBy[w] = r; G.aidEnd[r] = 0;
        return aidStep(r, D, sq, pinned);
      }
      return false;
    }
    // the side's contact, by 250 m cell: when, and the threat's bearing point
    const PCN = [new Map(), new Map()];
    function pkey(x, z) { return (Math.floor(x / 250) + 32768) * 65536 + (Math.floor(z / 250) + 32768); }
    function platoonSay(side, x, z, tx, tz) {
      const k = pkey(x, z), M = PCN[side];
      let e = M.get(k);
      if (!e) { e = { t: 0, x: 0, z: 0 }; M.set(k, e); }
      e.t = I.simT; e.x = tx; e.z = tz;
    }
    function platoonHear(side, x, z) {
      const M = PCN[side], cx = Math.floor(x / 250), cz = Math.floor(z / 250);
      let best = null, bt = I.simT - 10;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const e = M.get((cx + dx + 32768) * 65536 + (cz + dz + 32768));
        if (e && e.t > bt && Math.hypot(e.x - x, e.z - z) < 700) { bt = e.t; best = e; }
      }
      return best;
    }
    // the squad runs: every man of it still on his feet
    function routSquad(sq) {
      const base = sq * 10;
      for (let j = 0; j < 10; j++) {
        const r = SQ.mem[base + j];
        if (r >= 0 && fighting(r) && G.life[r] === LIFE.alive) { G.life[r] = LIFE.routed; ev(EV.rout, r, -1, 0); }
      }
      SQ.task[sq] = TASK.gone;
    }
    function squadTick(sq) {
      if (SQ.anc[sq]) return;                     // (a file of the line of battle: its block decides)
      const base = sq * 10;
      let lead = -1, nAlive = 0, nFight = 0, cx = 0, cz = 0, inContact = 0, pinned = 0, tx = 0, tz = 0, nt = 0, stress = 0, firing = 0;
      for (let j = 0; j < 10; j++) {
        const r = SQ.mem[base + j];
        if (r < 0 || !alive(r)) continue;
        nAlive++;
        if (!fighting(r)) continue;
        nFight++;
        cx += G.x[r]; cz += G.z[r];
        stress += G.stress[r];
        if (lead < 0 || (G.slot[r] === 0)) lead = lead < 0 || G.slot[r] === 0 ? r : lead;
        if (I.simT - G.contactT[r] < 6) inContact++;
        if (G.supp[r] > D_(r).pinAt) pinned++;
        if (I.simT - G.flashT[r] < 5) firing++;
        const tg = G.tgt[r];
        if (tg >= 0) { tx += G.x[tg]; tz += G.z[tg]; nt++; }
        else if (I.simT - G.lkT[r] < 20) { tx += G.lkx[r]; tz += G.lkz[r]; nt++; }
      }
      if (!nFight) { SQ.task[sq] = TASK.gone; return; }
      /* THE LEADER: slot 0, else the next man takes it. Losing him is felt by
         every man, and for a while nobody is giving orders: the squad goes to
         ground and fights where it is until the next man has taken charge
         (a trained squad knows who is next; a conscript one waits longer). */
      const D = D_(lead);
      if (SQ.lead[sq] >= 0 && SQ.lead[sq] !== lead && !fighting(SQ.lead[sq])) {
        for (let j = 0; j < 10; j++) { const r = SQ.mem[base + j]; if (r >= 0 && fighting(r)) G.stress[r] += 0.1 * D_(r).suppK; }
        SQ.lostT[sq] = I.simT + 4 + 22 * (1 - D.press);
      }
      SQ.lead[sq] = lead;
      cx /= nFight; cz /= nFight;
      SQ.cx[sq] = cx; SQ.cz[sq] = cz;
      const o = orderOf(sq, SQ.side[sq]);
      // the march direction
      let fx = o.x - cx, fz = o.z - cz;
      const fl = Math.hypot(fx, fz) || 1;
      SQ.fx[sq] = fx / fl; SQ.fz[sq] = fz / fl;
      if (nt) { SQ.thx[sq] = tx / nt; SQ.thz[sq] = tz / nt; if (inContact) SQ.lastC[sq] = I.simT; }
      /* THE PLATOON HEARS IT. A squad in a fight says so on the net (and the
         squads beside it hear the guns): its side's contact, by 250 m cell,
         with the bearing. A squad within a cell of one that is fighting is in
         contact too. Only squads with contact of their own write it. */
      if (inContact && nt) platoonSay(SQ.side[sq], cx, cz, SQ.thx[sq], SQ.thz[sq]);
      else if (!inContact && !(SQ.lastC[sq] > 0 && I.simT - SQ.lastC[sq] < 10)) {
        const p = platoonHear(SQ.side[sq], cx, cz);
        if (p) { SQ.lastC[sq] = I.simT; SQ.thx[sq] = p.x; SQ.thz[sq] = p.z; }
      }
      const losses = 1 - nFight / Math.max(1, SQ.cnt[sq]);
      /* MORALE. The pressure on the squad is its losses (men down and dead,
         the ones they can see) plus the mean stress its men carry (cracks,
         wounds, mates falling beside them). Past its nerve it breaks contact
         (an ordered withdrawal by bounds); far past it, it routs. */
      /* ...and the ARMY's: the host steps one army morale over every man it has
         (CBZ.brain.morale, the same one every army in the game shares) and
         hands it in (I.army). A losing army weighs on every squad in it; a
         broken one takes them all with it. */
      const A = I.army[SQ.side[sq]];
      const P = losses + stress / nFight + (A ? Math.max(0, 0.4 - A.morale) * 0.8 + (A.broken ? 0.4 : 0) : 0);
      const task0 = SQ.task[sq];
      /* A BROKEN ARMY (half of it running, or its morale gone: under 0.2 with
         the shock of the last deaths left out, an army that has lost half its
         power and is losing, not one that has just taken a bad minute) goes. A squad that is shaken itself
         runs with it; a steady one pulls out in order (breaking contact by
         bounds), and once it is clear it keeps going: there is nothing left
         to hold the line with. Before, only a squad far past its own nerve
         went, and ten steady men sat on a lost field for good. */
      if (A && (A.broken || A.morale + (A.shock || 0) < 0.2) && task0 !== TASK.gone) {
        if (P > D.nerve * 0.8 || !inContact) { routSquad(sq); return; }
        if (task0 !== TASK.breakc) { SQ.task[sq] = TASK.breakc; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; SQ.brkX[sq] = cx; SQ.brkZ[sq] = cz; SQ.brkT[sq] = I.simT; }
        if (Math.hypot(cx - SQ.brkX[sq], cz - SQ.brkZ[sq]) > 150) { routSquad(sq); return; }
        if (I.simT - SQ.boundT[sq] > 5) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      /* A HORDE AT ARM'S LENGTH. Men with swords and spears coming on in close
         order, many more of them than of us: a squad does not lie there and
         wait to be overrun. It falls back by bounds, one team firing while the
         other runs, to keep the distance its rifles need, and keeps doing it
         while they keep coming. (Untrained men just run: below.) */
      if (inContact && I.ancN && task0 !== TASK.gone) {
        const nh = hordeNear(SQ.side[sq], cx, cz, 55, 64);
        if (nh > Math.max(5, nFight * 2)) {
          if (task0 !== TASK.breakc) { SQ.task[sq] = TASK.breakc; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; SQ.brkX[sq] = cx; SQ.brkZ[sq] = cz; SQ.brkT[sq] = I.simT; I.led.fallbacks = (I.led.fallbacks || 0) + 1; }
          else if (Math.hypot(cx - SQ.brkX[sq], cz - SQ.brkZ[sq]) > 110) { SQ.brkX[sq] = cx; SQ.brkZ[sq] = cz; }
          if (I.simT - SQ.boundT[sq] > 4) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
          return;
        }
      }
      if (inContact && (P > D.nerve || task0 === TASK.breakc)) {
        if (P > D.nerve * 1.45 || (task0 === TASK.breakc && P > D.nerve * 1.25)) { routSquad(sq); return; }
        if (task0 !== TASK.breakc) { SQ.task[sq] = TASK.breakc; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; SQ.brkX[sq] = cx; SQ.brkZ[sq] = cz; SQ.brkT[sq] = I.simT; }
        // out of it: 150 m back from where it broke, or out of contact
        if (Math.hypot(cx - SQ.brkX[sq], cz - SQ.brkZ[sq]) > 150) { SQ.task[sq] = TASK.hold; return; }
        if (I.simT - SQ.boundT[sq] > 5) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      if (task0 === TASK.breakc && !inContact) { SQ.task[sq] = TASK.hold; return; }
      if (task0 === TASK.hold && I.simT - SQ.brkT[sq] < 120 && SQ.brkT[sq] > 0) return;    // it has withdrawn: it holds there
      if (!inContact) {
        // a hold with a place goes there first (more than 15 m off it), then holds it; one without holds where it stands
        if ((o.kind === "hold" || o.kind === "move") && !(o.x === o.x && Math.hypot(o.x - cx, o.z - cz) > (o.kind === "move" ? 8 : 15))) { SQ.task[sq] = TASK.hold; SQ.bound[sq] = 0; return; }
        /* THE MOVEMENT TECHNIQUE. Far from the enemy, a squad travels (the
           wedge, at a route march). Close to where he is, it moves by
           BOUNDING OVERWATCH (within 300 m: contact expected): one team goes forward while the other kneels
           and watches the ground ahead, ready to fire; then they swap. The
           team that halts is the one that sees the enemy first. */
        const dEn = o.x === o.x ? Math.hypot(o.x - cx, o.z - cz) : 1e9;
        // (a MOVE is a march to a place, not an advance on the enemy: no overwatch on it)
        if (o.kind === "advance" && dEn < 300 && nFight >= 4) {
          if (task0 !== TASK.overwatch) { SQ.task[sq] = TASK.overwatch; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; }
          else if (I.simT - SQ.boundT[sq] > (SQ.bound[sq] === 1 ? 20 : 14)) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
          return;
        }
        SQ.task[sq] = TASK.advance;
        SQ.bound[sq] = 0;
        return;
      }
      // in contact
      if (o.kind === "hold" || o.kind === "move" || nFight < 2 || I.simT < SQ.lostT[sq]) { SQ.task[sq] = TASK.base; return; }
      const dTh = nt ? Math.hypot(SQ.thx[sq] - cx, SQ.thz[sq] - cz) : 999;
      /* FIRE AND MOVEMENT: one team moves while the other fires, and only
         while the fire is not too heavy to move under; the teams swap on the
         squad's clock. A base of fire comes first (the squad down and
         shooting for a few seconds). Inside 45 m of the enemy: the assault. */
      if (firing) SQ.fireT[sq] = I.simT;
      if (pinned >= Math.ceil(nFight * 0.5)) { SQ.task[sq] = TASK.base; SQ.bound[sq] = 0; return; }
      /* THE FLANK. A squad that cannot fight from where it is (nobody in it
         has had anything to shoot at for 25 s: the enemy is over a crest,
         behind a wall) moves round: 90 degrees off the line to the threat,
         on the side the squad already leans to, by bounds, and fights from
         there. It gives up the flank when it is there, or has been at it for
         a minute and a half. */
      if (task0 === TASK.flank) {
        if (Math.hypot(SQ.flX[sq] - cx, SQ.flZ[sq] - cz) < 15 || I.simT - SQ.flT[sq] > 90 || I.simT - SQ.fireT[sq] < 2) { SQ.task[sq] = TASK.base; SQ.contact[sq] = I.simT - 4; return; }
        if (I.simT - SQ.boundT[sq] > 8) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      if (nt && nFight >= 3 && I.simT - SQ.fireT[sq] > 25 && I.simT - SQ.contact[sq] > 25 && dTh > 40) {
        const ax = cx - SQ.thx[sq], az = cz - SQ.thz[sq], al = Math.hypot(ax, az) || 1;
        // the side: the one the squad already stands toward, off its own army's
        // middle, across the line to the threat (the outer squads go round the outside)
        const sd0 = SQ.side[sq];
        const lat = (cx - sideX[sd0]) * (-az / al) + (cz - sideZ[sd0]) * (ax / al);
        const sideK = lat >= 0 ? 1 : -1;
        const px = -az / al * sideK, pz = ax / al * sideK;
        const R = Math.min(140, Math.max(50, dTh * 0.8));
        SQ.flX[sq] = SQ.thx[sq] + (ax / al * 0.35 + px * 0.94) * R;
        SQ.flZ[sq] = SQ.thz[sq] + (az / al * 0.35 + pz * 0.94) * R;
        SQ.task[sq] = TASK.flank; SQ.flT[sq] = I.simT; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT;
        I.led.flanks = (I.led.flanks || 0) + 1;
        return;
      }
      if (task0 !== TASK.bound && task0 !== TASK.assault) {
        SQ.task[sq] = TASK.base;
        if (SQ.contact[sq] <= 0) SQ.contact[sq] = I.simT;
        // the first bound goes once the base of fire is working (men down and shooting)
        const baseOn = firing >= Math.max(1, Math.ceil(nFight / 4));
        if (baseOn && I.simT - SQ.contact[sq] > 6 + 8 * (1 - D.press) && I.simT - SQ.boundT[sq] > 6) { SQ.task[sq] = TASK.bound; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      // no fire covering the move: the move stops, the squad gets its base of fire going again
      if (firing < Math.max(1, Math.ceil(nFight / 5)) && dTh > 45) { SQ.task[sq] = TASK.base; SQ.contact[sq] = I.simT - 4; return; }
      if (I.simT - SQ.boundT[sq] > 6 + 4 * (1 - D.press)) {
        SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT;
      }
      SQ.task[sq] = dTh < 45 ? TASK.assault : TASK.bound;
    }

    /* ============================================================ THE LINE OF BATTLE
       An ancient army fights as BLOCKS (a Roman century: 80 men, ten files of
       eight, the contubernium being one file). The block is a frame: a front
       centre, a facing, a frontage per man and a depth per rank. Every man
       steers to his slot in it every step, faces where it faces, and closes
       up when the man in front of him falls (his file's ranks are counted off
       again from the front: nobody steps over a gap). The block decides on
       its own clock what it is doing:
         MARCH      in step toward the enemy (or its order's point)
         TESTUDO    shields locked over and round, packed, slow: under missile
                    fire inside bowshot (a crack is a missile to a man who has
                    never heard a rifle)
         QUICK      the quick step inside 80 m, back in fighting order
         VOLLEY     a halt inside spear range: the front two ranks throw (the
                    heavy pilum, then the light one), each man on his own beat
         CHARGE     the run into contact
         MELEE      the press: the front rank fights man to man over the
                    shields, the ranks behind hold the line and step up into
                    every gap; a tired front-ranker is relieved by the man
                    behind him (the drill); the block leans in at a walk
         ROUT       losses and strain past its nerve: it runs
       A man in the press picks the enemy at his front, closes to reach and
       strikes on his own clock: a blow is aimed (his skill, his tiredness),
       seen and taken on the shield (the other man's skill, the shield's
       arc), and what lands is a wound where it lands, through whatever iron
       is there (systems/armour.js's real classes). A rifleman whose magazine
       is empty fights back with the bayonet by the same rule.
       THE PILUM is flown: a 2 kg spear let go at 18-23 m/s on the arc that
       carries it to his mark, with his errors; it is swept against every body
       in its path each step. It hangs in a shield it strikes (and the man
       drops the shield), or goes into a man through what he wears. The ones
       that miss stand in the ground where they fell (I.stuck: the renderer
       draws every one). */
    const BCAP = 128;
    const BK = { n: 0, side: new U8(0), files: new U8(0), ranks: new U8(0), mem: new I32(0), typ: new I32(0), init: new U8(0),
      cx: new F(0), cz: new F(0), fx: new F(0), fz: new F(0), wf: new F(0), mode: new U8(0), modeT: new F(0), sp: new F(0), at: new F(0),
      fireT: new F(0), vol: new U8(0), volT: new F(0), ex: new F(0), ez: new F(0), ed: new F(0), n0: new I32(0), nf: new I32(0),
      w: new F(0), d: new F(0), err: new F(0), px: new F(0), pz: new F(0), freeT: new F(0), wcut: new F(0), dep: new F(0) };
    let bkCap = 0;
    function bkGrow(n) {
      if (n <= BK.n) return;
      if (n > bkCap) {
        const cap = Math.max(n, bkCap * 2, 16);
        for (const k in BK) {
          if (k === "n" || k === "mem") continue;
          const a = new BK[k].constructor(cap); a.set(BK[k].subarray(0, Math.min(BK[k].length, cap))); BK[k] = a;
        }
        const m = new I32(cap * BCAP).fill(-1); m.set(BK.mem.subarray(0, Math.min(BK.mem.length, cap * BCAP))); BK.mem = m;
        bkCap = cap;
      }
      BK.n = n;
    }
    I.blocks = BK; I.BM = BM; I.STC = STC; I.BCAP = BCAP;
    // the host names the blocks: b on side, files x ranks
    I.block = function (b, side, files, ranks) {
      bkGrow(b + 1);
      BK.side[b] = side; BK.files[b] = Math.min(files, 32); BK.ranks[b] = Math.max(1, Math.min(ranks, Math.floor(BCAP / Math.min(files, 32))));
      BK.init[b] = 0; BK.mode[b] = BM.march; BK.at[b] = 0; BK.fireT[b] = -99; BK.vol[b] = 0; BK.ed[b] = 1e9; BK.typ[b] = -1;
    };
    // ...and put a man in his place in it: file f, rank k
    I.setBlock = function (r, b, f, k) {
      if (b < 0 || b >= BK.n || !G.anc[r]) return;
      const F_ = BK.files[b], R_ = BK.ranks[b];
      if (f >= F_ || k >= R_) return;
      G.blk[r] = b; G.bfl[r] = f; G.brk0[r] = k; G.brk[r] = k;
      BK.mem[b * BCAP + f * R_ + k] = r;
      BK.n0[b]++; BK.nf[b]++;
      if (BK.typ[b] < 0) BK.typ[b] = G.typ[r];
      const A = I.types[G.typ[r]].A;
      G.bsx[r] = (f - (F_ - 1) / 2) * A.fileW; G.bsb[r] = k * A.rankD;
      BK.init[b] = 0;
    };
    function bA(b) { const t = I.types[BK.typ[b]]; return t && t.A ? t.A : ANC.elite; }
    // the frame off where its men stand (they were laid in their slots)
    function blockInit(b) {
      const F_ = BK.files[b], R_ = BK.ranks[b], base = b * BCAP;
      let h = NaN, sx = 0, sz = 0, n = 0;
      for (let q = 0; q < F_ * R_; q++) { const r = BK.mem[base + q]; if (r < 0 || !alive(r)) continue; if (h !== h) h = G.heading[r]; }
      if (h !== h) h = 0;
      const fx = Math.sin(h), fz = Math.cos(h), lx = fz, lz = -fx;
      for (let q = 0; q < F_ * R_; q++) {
        const r = BK.mem[base + q];
        if (r < 0 || !alive(r)) continue;
        sx += G.x[r] - lx * G.bsx[r] + fx * G.bsb[r]; sz += G.z[r] - lz * G.bsx[r] + fz * G.bsb[r]; n++;
      }
      if (n) { BK.cx[b] = sx / n; BK.cz[b] = sz / n; }
      BK.fx[b] = fx; BK.fz[b] = fz; BK.wf[b] = h;
      const A = bA(b);
      BK.w[b] = A.fileW; BK.d[b] = A.rankD; BK.dep[b] = (R_ - 1) * A.rankD;
      BK.init[b] = 1;
    }
    /* THE NEAREST ENEMY to a point: the presence grid says whether anybody is
       within R at all (exact), then the body grid's rings, nearest first. */
    let _nfD = 0;
    function nearestFoe(side, x, z, R) {
      _nfD = 1e9;
      if (!enemyNear(side, x, z, R)) return -1;
      const g = GE[side ? 0 : 1];
      const c0x = Math.floor((x - g.x0) * g.ic), c0z = Math.floor((z - g.z0) * g.ic);
      const maxRing = Math.ceil(R * g.ic) + 1, st = g.start, L = g.list;
      let best = -1, bd = R * R;
      for (let ring = 0; ring <= maxRing; ring++) {
        if (best >= 0 && (ring - 1) * g.cell > Math.sqrt(bd)) break;
        for (let dz = -ring; dz <= ring; dz++) {
          const zz = c0z + dz;
          if (zz < 0 || zz >= g.h) continue;
          const edge = dz === -ring || dz === ring, step = edge ? 1 : Math.max(1, 2 * ring);
          for (let dx = -ring; dx <= ring; dx += step) {
            const xx = c0x + dx;
            if (xx >= 0 && xx < g.w) {
              const k = zz * g.w + xx;
              for (let i = st[k], e = st[k + 1]; i < e; i++) {
                const o = L[i];
                const ox = G.x[o] - x, oz = G.z[o] - z, d2 = ox * ox + oz * oz;
                if (d2 < bd) { bd = d2; best = o; }
              }
            }
            if (!ring) break;
          }
        }
      }
      _nfD = best >= 0 ? Math.sqrt(bd) : 1e9;
      return best;
    }
    // how many of the line's men of the other side are within R of a point (capped)
    function hordeNear(side, x, z, R, cap) {
      const g = GE[side ? 0 : 1];
      const cx0 = Math.max(0, Math.floor((x - R - g.x0) * g.ic)), cx1 = Math.min(g.w - 1, Math.floor((x + R - g.x0) * g.ic));
      const cz0 = Math.max(0, Math.floor((z - R - g.z0) * g.ic)), cz1 = Math.min(g.h - 1, Math.floor((z + R - g.z0) * g.ic));
      const st = g.start, L = g.list, R2 = R * R;
      let n = 0;
      for (let cz = cz0; cz <= cz1; cz++) {
        const b = cz * g.w;
        for (let i = st[b + cx0], e = st[b + cx1 + 1]; i < e; i++) {
          const o = L[i];
          if (!G.anc[o]) continue;
          const ox = G.x[o] - x, oz = G.z[o] - z;
          if (ox * ox + oz * oz < R2 && ++n >= cap) return n;
        }
      }
      return n;
    }
    // the friendly blocks near each other: a 64 m grid of their fronts, rebuilt twice a second
    const BG = new Map();
    let bgAt = -9;
    function blockGrid() {
      BG.forEach(function (a) { a.length = 0; });
      for (let b = 0; b < BK.n; b++) {
        if (!BK.nf[b] || BK.mode[b] === BM.rout) continue;
        const k = (Math.floor(BK.cx[b] / 64) + 32768) * 65536 + (Math.floor(BK.cz[b] / 64) + 32768);
        let a = BG.get(k); if (!a) { a = []; BG.set(k, a); } a.push(b);
      }
      bgAt = I.simT;
    }
    /* THE BLOCK DECIDES (its own clock: a quarter second in a fight, longer
       far from one) */
    function blockTick(b) {
      const A = bA(b), F_ = BK.files[b], R_ = BK.ranks[b], base = b * BCAP, sd = BK.side[b];
      if (!BK.init[b]) blockInit(b);
      const fx = BK.fx[b], fz = BK.fz[b], lx = fz, lz = -fx;
      // ---- its men: who is still in the line, counted off from the front of each file
      let nf = 0, stress = 0, err = 0, occ = 0, frontN = 0, engaged = 0;
      for (let f = 0; f < F_; f++) {
        let k = 0;
        for (let k0 = 0; k0 < R_; k0++) { const r = BK.mem[base + f * R_ + k0]; if (r >= 0 && G.life[r] === LIFE.alive && !G.down[r]) k++; }
        if (k) occ++;
      }
      const mode0 = BK.mode[b];
      // the frontage it wants: fighting order, the shield wall in contact, the testudo
      const wantW = mode0 === BM.testudo ? A.testW : (mode0 === BM.melee || mode0 === BM.charge) ? A.closeW : A.fileW;
      const wantD = mode0 === BM.testudo ? A.testD : (mode0 === BM.melee || mode0 === BM.charge) ? A.closeD : A.rankD;
      BK.w[b] += (wantW - BK.w[b]) * 0.5; BK.d[b] += (wantD - BK.d[b]) * 0.5;
      const w = BK.w[b], d = BK.d[b];
      let li = 0, maxK = 0;
      for (let f = 0; f < F_; f++) {
        let k = 0;
        const lat = (li - (occ - 1) / 2) * w;
        for (let k0 = 0; k0 < R_; k0++) {
          const r = BK.mem[base + f * R_ + k0];
          if (r < 0 || G.life[r] !== LIFE.alive || G.down[r]) continue;
          G.brk[r] = k; G.bsx[r] = lat; G.bsb[r] = k * d;
          nf++; stress += G.stress[r];
          if (k === 0) { frontN++; if (G.eng[r]) engaged++; }
          const gx = BK.cx[b] + lx * lat - fx * k * d, gz = BK.cz[b] + lz * lat - fz * k * d;
          const ex = G.x[r] - gx, ez = G.z[r] - gz;
          if (!G.eng[r]) err += Math.sqrt(ex * ex + ez * ez);
          k++;
        }
        if (k) { li++; if (k > maxK) maxK = k; }
      }
      BK.nf[b] = nf;
      BK.dep[b] = Math.max(0, maxK - 1) * d;
      if (!nf) { BK.mode[b] = BM.rout; return; }
      BK.err[b] = err / Math.max(1, nf - engaged);
      // ---- the enemy: the nearest man to its front, and how far
      const R = 1500;
      let e = nearestFoe(sd, BK.cx[b], BK.cz[b], R);
      let ed = _nfD;
      BK.ed[b] = ed;
      if (e >= 0) { BK.ex[b] = G.x[e]; BK.ez[b] = G.z[e]; }
      // ---- its nerve: what it has lost and what its men carry, and the army's
      const Ar = I.army[sd];
      const losses = 1 - nf / Math.max(1, BK.n0[b]);
      const P = losses * 1.15 + stress / nf + (Ar ? Math.max(0, 0.35 - Ar.morale) * 0.9 + (Ar.broken ? 0.5 : 0) : 0);
      if (mode0 !== BM.rout && (P > A.nerve || (Ar && Ar.broken && ed < 300))) {
        BK.mode[b] = BM.rout; BK.modeT[b] = I.simT;
        for (let q = 0; q < F_ * R_; q++) {
          const r = BK.mem[base + q];
          if (r >= 0 && G.life[r] === LIFE.alive && !G.down[r]) { G.life[r] = LIFE.routed; G.eng[r] = 0; G.stc[r] = STC.rout; ev(EV.rout, r, -1, 0); }
        }
        return;
      }
      if (mode0 === BM.rout) return;
      // ---- where it faces: the enemy nearest its front; far off, the order's point
      const o = orderOf(-1, sd);
      let tx = NaN, tz = NaN;
      if (e >= 0 && ed < 600) { tx = BK.ex[b]; tz = BK.ez[b]; }
      else if (o.x === o.x) { tx = o.x; tz = o.z; }
      if (tx === tx) {
        const dx = tx - BK.cx[b], dz = tz - BK.cz[b];
        if (dx * dx + dz * dz > 4) BK.wf[b] = Math.atan2(dx, dz);
      }
      // ---- what it does
      let mode = mode0;
      const fresh = I.simT - BK.fireT[b] < 5;               // missiles (rounds) striking it or cracking past
      const hold = o.kind === "hold" || (e < 0 && !(o.x === o.x));
      const pila = A.pilumR > 0 && BK.vol[b] < 2;
      if (ed < 2.6 || (mode0 === BM.melee && ed < 9)) { mode = BM.melee; BK.freeT[b] = I.simT; }
      else if (mode0 === BM.melee && I.simT - BK.freeT[b] < 2.5) mode = BM.melee;
      else if (mode0 === BM.charge && ed < 40) mode = BM.charge;
      else if (mode0 === BM.volley) {
        // the second volley 2.5 s after the first, then the charge
        if (BK.vol[b] < 2 && I.simT - BK.volT[b] > 2.5 && ed < A.pilumR + 8) { BK.vol[b]++; BK.volT[b] = I.simT; }
        else if (I.simT - BK.volT[b] > 2.0 || ed > A.pilumR + 12) mode = BM.charge;
      }
      else if (pila && ed < A.pilumR && (mode0 === BM.quick || mode0 === BM.march || mode0 === BM.testudo)) { mode = BM.volley; BK.vol[b]++; BK.volT[b] = I.simT; }
      else if (!pila && ed < 30) mode = BM.charge;
      else if (hold) mode = BM.hold;
      else if (ed < 80) mode = BM.quick;
      else if (A.testudo && fresh && ed < 260) mode = BM.testudo;
      else mode = BM.march;
      if (mode !== mode0) { BK.mode[b] = mode; BK.modeT[b] = I.simT; }
      // ---- the relief: a spent front-ranker drops back behind the next man of his file
      if (mode === BM.melee && A.relief) {
        for (let f = 0; f < F_; f++) {
          let a = -1, a0 = -1, c = -1, c0 = -1;
          for (let k0 = 0; k0 < R_; k0++) {
            const r = BK.mem[base + f * R_ + k0];
            if (r < 0 || G.life[r] !== LIFE.alive || G.down[r]) continue;
            if (a < 0) { a = r; a0 = k0; } else { c = r; c0 = k0; break; }
          }
          if (a >= 0 && c >= 0 && G.fat[a] > 0.62 && G.fat[c] < 0.3 && G.swT[a] > 0.4) {
            BK.mem[base + f * R_ + a0] = c; BK.mem[base + f * R_ + c0] = a;
            G.brk0[a] = c0; G.brk0[c] = a0; G.eng[a] = 0; G.tgt[a] = -1;
            I.led.reliefs = (I.led.reliefs || 0) + 1;
          }
        }
      }
      // ---- room: a friendly block too close beside it is shouldered off; one right ahead is followed, not walked into
      if (I.simT - bgAt > 0.5) blockGrid();
      const cx = BK.cx[b], cz = BK.cz[b], hw = occ * w * 0.5 + 1.5, dep = BK.dep[b];
      const gx0 = Math.floor(cx / 64), gz0 = Math.floor(cz / 64);
      let px = 0, pz = 0, ahead = false;
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
        const L = BG.get((gx0 + a + 32768) * 65536 + (gz0 + c + 32768));
        if (!L) continue;
        for (let i = 0; i < L.length; i++) {
          const o2 = L[i];
          if (o2 === b || BK.side[o2] !== sd) continue;
          const rx = BK.cx[o2] - cx, rz = BK.cz[o2] - cz;
          const along = rx * fx + rz * fz, lat = rx * lx + rz * lz;
          const hw2 = BK.w[o2] * BK.files[o2] * 0.5 + 1.5;
          const ov = hw + hw2 - Math.abs(lat);
          if (ov <= 0) continue;
          if (along > -BK.dep[o2] - 2 && along < dep + 2) {
            // side by side and overlapping: shoulder apart (half each)
            const s = lat > 0 ? -1 : 1;
            px += lx * s * Math.min(ov, 6) * 0.5; pz += lz * s * Math.min(ov, 6) * 0.5;
          } else if (along > 0 && along < BK.dep[o2] + 8) ahead = true;
        }
      }
      BK.px[b] = px; BK.pz[b] = pz;
      BK.wcut[b] = ahead && mode !== BM.melee ? 0.25 : 1;
      // its clock
      BK.at[b] = I.simT + (ed < 120 || mode === BM.melee ? 0.25 : ed < 450 ? 0.5 : 1.0) * (0.85 + 0.3 * trait(b + 0x70000, (I.simT * 4) | 0));
    }
    // the frames move every step: wheel toward the mark, then forward at the block's pace
    function moveBlocks(dt) {
      for (let b = 0; b < BK.n; b++) {
        if (!BK.nf[b]) continue;
        if (!BK.init[b]) blockInit(b);
        const mode = BK.mode[b];
        if (mode === BM.rout) { BK.sp[b] = 0; continue; }
        const A = bA(b);
        let h = Math.atan2(BK.fx[b], BK.fz[b]);
        let dh = BK.wf[b] - h;
        while (dh > Math.PI) dh -= 6.283185307; while (dh < -Math.PI) dh += 6.283185307;
        const tr = A.turn * (mode === BM.testudo ? 0.5 : 1) * dt;
        h += dh > tr ? tr : dh < -tr ? -tr : dh;
        BK.fx[b] = Math.sin(h); BK.fz[b] = Math.cos(h);
        let s = mode === BM.march ? A.march : mode === BM.testudo ? A.march * 0.6 : mode === BM.quick ? A.quick :
          mode === BM.charge ? A.charge : mode === BM.melee ? (BK.ed[b] > 1.7 ? 0.35 : 0) : 0;
        if (Math.abs(dh) > 0.5) s *= 0.35;                       // wheeling: the outer files have the long way round
        // a drilled block waits for its men; a mob does not
        const er = BK.err[b];
        if (er > 2.2) s *= Math.max(0, 1 - (er - 2.2) / 2.5 * A.drill);
        s *= BK.wcut[b];
        // (inside its last stride it stops: it does not walk its front rank onto the enemy)
        if (mode !== BM.melee && BK.ed[b] < 3) s = Math.min(s, 0.3);
        BK.sp[b] = s;
        BK.cx[b] += BK.fx[b] * s * dt + BK.px[b] * Math.min(1, 0.8 * dt);
        BK.cz[b] += BK.fz[b] * s * dt + BK.pz[b] * Math.min(1, 0.8 * dt);
      }
    }
    /* A MAN OF THE LINE THINKS: whom to fight at his front, his spear. */
    function ancThink(r, dt) {
      void dt;
      if (G.down[r]) { G.eng[r] = 0; downThink(r, dt); return; }
      if (G.life[r] === LIFE.routed) { G.eng[r] = 0; G.stc[r] = STC.rout; routThink(r); return; }
      const b = G.blk[r];
      const mode = b >= 0 ? BK.mode[b] : BM.melee;
      const near = b < 0 || BK.ed[b] < 45 || mode === BM.melee || mode === BM.charge;
      // the enemy within a stride or two of him (front ranks; anybody once they are among the ranks)
      let e = -1, best = 1e9;
      if (near) {
        const x = G.x[r], z = G.z[r], sd = G.side[r];
        const hx = b >= 0 ? BK.fx[b] : Math.sin(G.heading[r]), hz = b >= 0 ? BK.fz[b] : Math.cos(G.heading[r]);
        const rank = G.brk[r];
        const R = rank === 0 ? 3.2 : 2.2;
        forDiscB(x, z, R, function (o) {
          if (G.side[o] === sd || !alive(o) || (G.ext[o] && G.ext[o] !== EXT.man)) return;
          const ox = G.x[o] - x, oz = G.z[o] - z, d2 = ox * ox + oz * oz;
          if (d2 > R * R) return;
          // in front of him (or anywhere, if he is in among them)
          const dd = Math.sqrt(d2) || 0.01, fwd = (ox * hx + oz * hz) / dd;
          let s = d2 * (fwd > 0.2 ? 1 : 2.5) * (G.down[o] ? 6 : 1);
          if (s < best) { best = s; e = o; }
        });
      }
      if (e >= 0) {
        if (G.tgt[r] !== e) { G.tgt[r] = e; if (G.swT[r] < 0.35) G.swT[r] = 0.35 + rnd() * 0.5; }
        G.eng[r] = 1; G.contactT[r] = I.simT;
      } else { G.eng[r] = 0; G.tgt[r] = -1; }
      // his spear: in a volley, the front two ranks, each on his own beat
      if (b >= 0 && mode === BM.volley && G.pil[r] > 0 && G.brk[r] < 2 && G.pvol[r] < BK.vol[b] && !G.eng[r] && G.thrT[r] < I.simT - 1) {
        G.thrT[r] = I.simT + 0.15 + rnd() * 0.9 + G.brk[r] * 0.35; G.pvol[r] = BK.vol[b];
      }
      // what he looks like doing it
      if (G.thrT[r] > I.simT - 0.6 && G.thrT[r] < I.simT + 2) G.stc[r] = STC.throw;
      else if (G.eng[r]) G.stc[r] = STC.fight;
      else if (mode === BM.testudo) {
        const F_ = b >= 0 ? BK.files[b] : 1, li = G.bsx[r] / Math.max(0.3, BK.w[b]) + (F_ - 1) / 2;
        G.stc[r] = G.brk[r] === 0 ? STC.wall : (li < 0.6 || li > F_ - 1.6) ? STC.side : STC.roof;
      } else if (mode === BM.charge) G.stc[r] = STC.charge;
      else if (mode === BM.melee) G.stc[r] = G.brk[r] < 2 ? STC.wall : STC.carry;
      else G.stc[r] = STC.carry;
    }
    /* HIS HANDS: the spear let go on its beat, the blow when it is his */
    function ancTrigger(r, dt) {
      const t = T_(r);
      if (G.swT[r] > 0) G.swT[r] -= dt;
      if (G.down[r]) return;
      if (G.thrT[r] > 0 && I.simT >= G.thrT[r] && G.thrT[r] > I.simT - dt - 1e-6 && G.pil[r] > 0) throwPilum(r, t);
      const tg = G.tgt[r];
      if (tg < 0 || !G.eng[r] || !alive(tg)) return;
      const dx = G.x[tg] - G.x[r], dz = G.z[tg] - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
      if (d > t.M.reach + 0.62 || G.swT[r] > 0) return;
      blow(r, tg, t.M, t.A.skill, t.A.strikeT);
    }
    /* A RIFLEMAN AT ARM'S LENGTH: empty, or reloading, with a man of the line
       on him, he fights with the bayonet (and the butt) */
    function closeFight(r, t, D, dt) {
      if (G.swT[r] > 0) G.swT[r] -= dt;
      const tg = G.tgt[r];
      if (tg < 0 || !G.anc[tg] || !fighting(tg)) return false;
      if (G.mag[r] > 0 && G.reloadT[r] <= 0) return false;
      const dx = G.x[tg] - G.x[r], dz = G.z[tg] - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
      if (d > MELEE.bayonet.reach + 0.6) return false;
      if (G.swT[r] > 0) return true;
      G.reloadT[r] = Math.max(G.reloadT[r], 0);
      blow(r, tg, MELEE.bayonet, 0.25 + 0.45 * D.press, 2.2 - D.press * 0.6);
      return true;
    }
    // a man of the line close to a rifleman: the rifleman knows he is there (no search, no detection)
    function closeThreat(r) {
      const x = G.x[r], z = G.z[r], sd = G.side[r];
      let e = -1, bd = 36;
      forDiscB(x, z, 6, function (o) {
        if (G.side[o] === sd || !G.anc[o] || !fighting(o)) return;
        const ox = G.x[o] - x, oz = G.z[o] - z, d2 = ox * ox + oz * oz;
        if (d2 < bd) { bd = d2; e = o; }
      });
      if (e < 0) return;
      if (G.tgt[r] !== e) {
        G.tgt[r] = e; G.acqT[r] = Math.min(G.acqT[r] > 0 ? G.acqT[r] : 0.3, 0.3); G.aimT[r] = 0;
        G.rngE[r] = 0; G.rngTgt[r] = e;
      }
      G.expo[r] = LOOK_ALL[G.post[e]]; G.seenT[r] = I.simT; G.lkx[r] = G.x[e]; G.lkz[r] = G.z[e]; G.lkT[r] = I.simT; G.contactT[r] = I.simT;
      G.face[r] = Math.atan2(G.x[e] - x, G.z[e] - z);
      // nobody lies down with a sword over him: he comes up to fight
      if (G.post[r] === POST.prone && G.postT[r] <= 0 && bd < 9) setPost(r, POST.kneel);
    }
    /* WHAT IRON STOPS A POINT. zone: 0 head, 1 chest, 2 belly, 3 a limb;
       spear: a throwing spear (heavier: it drives through more) */
    function pointStopped(b, zone, pen, spear) {
      if (zone === 0) {
        const h = PLATES[G.helm[b]];
        if (!h) return false;
        // the face is open (a third of the head); the shell turns most points that meet it
        return rnd() < 0.66 * (h.mat === "steel" ? (spear ? 0.6 : 0.8) : (spear ? 0.5 : 0.7));
      }
      if (zone === 3) return false;
      // the hard plate (ceramic, steel or PE, front and back) over the upper chest: stops any blade or spear
      const P = PLATES[G.plF[b]];
      if (zone === 1 && P && P.rating >= 3 && rnd() < 0.55) return true;
      const So = PLATES[G.plSo[b]];
      if (So) {
        // iron bands or mail: a cut is turned, a thrust may get through; aramid is not stab-rated
        const p = So.mat === "steel" ? 1 - pen * (spear ? 1.3 : 1) : (spear ? 0.25 : 0.35);
        return rnd() < Math.max(0, Math.min(0.95, p * (zone === 2 ? 0.75 : 1)));
      }
      return false;
    }
    // where a thrust lands on a standing man (over the shield or under it, or round it)
    function thrustZone() { const u = rnd(); return u < 0.1 ? 0 : u < 0.6 ? 1 : u < 0.8 ? 2 : 3; }
    function woundAt(b, zone, M, by, spearK) {
      const k = spearK || 1;
      let now_ = 0, bleed = 0;
      if (zone === 0) { now_ = rnd() < 0.35 ? 2 : 0.7 + rnd() * 0.5; bleed = 0.02; }
      else if (zone === 1) { now_ = (M.now[0] + rnd() * (M.now[1] - M.now[0])) * k; bleed = M.bleed * 1.2; }
      else if (zone === 2) { now_ = (M.now[0] * 0.8 + rnd() * (M.now[1] - M.now[0]) * 0.7) * k; bleed = M.bleed * 1.4; }
      else { now_ = (0.18 + rnd() * 0.22) * k; bleed = M.bleed * 0.4; }
      hurt(b, Math.min(2, now_), bleed, by, false);
    }
    /* THE BLOW. a strikes b with M at skill sk: the shield, the iron, the wound */
    function blow(a, b, M, sk, beat) {
      const fa = G.fat[a];
      G.swT[a] = beat * (0.7 + 0.6 * rnd()) * (1 + fa * 0.8);
      G.fat[a] = Math.min(1, fa + 0.035);
      I.led.blows = (I.led.blows || 0) + 1;
      // he has to land it at all: a moving, guarded man (his skill against the other's)
      const tb = T_(b);
      const skB = tb.anc ? tb.A.skill : 0.2 + 0.3 * tb.D.press;
      const aim = sk * (1 - 0.45 * fa) * (0.55 + 0.45 * Math.max(0.2, G.cap[a]));
      if (rnd() > 0.35 + 0.55 * aim - 0.2 * skB * (1 - G.fat[b])) { ev(EV.strike, a, b, 0); return; }
      // the shield: a blow he sees coming lands on it
      if (G.shd[b] && tb.SH && !G.down[b]) {
        const hb = G.heading[b], dx = G.x[a] - G.x[b], dz = G.z[a] - G.z[b], dd = Math.hypot(dx, dz) || 1;
        const facing = (Math.sin(hb) * dx + Math.cos(hb) * dz) / dd;
        if (facing > 0.2 && rnd() < tb.SH.block * (0.55 + 0.45 * skB) * (1 - 0.35 * G.fat[b])) {
          G.fat[b] = Math.min(1, G.fat[b] + 0.015);
          ev(EV.strike, a, b, 0.5);
          return;
        }
      }
      I.led.blowsIn = (I.led.blowsIn || 0) + 1;
      if (G.down[b]) { woundAt(b, 1, M, a, 1); ev(EV.strike, a, b, 1); return; }
      const z = thrustZone();
      if (pointStopped(b, z, M.pen, false)) { G.stress[b] += 0.05; ev(EV.strike, a, b, 0.5); return; }
      woundAt(b, z, M, a, 1);
      ev(EV.strike, a, b, 1);
    }

    /* ---- THE PILUM, flown ---- */
    const JF = 12;
    // [0 x, 1 y, 2 z, 3 vx, 4 vy, 5 vz, 6 by, 7 side, 8 heavy, 9 t0, 10 _, 11 _]
    let JV = new F(512 * JF), nJ = 0;
    const SF = 7, SCAP = 6000;
    // the spears that came down: [x, y, z, dx, dy, dz, kind (0 ground, 1 in a man, 2 in a dropped shield)]
    I.stuck = new F(SCAP * SF); I.nStuck = 0; I.SF = SF; I.SCAP = SCAP;
    I.javs = function () { return { buf: JV, n: nJ, F: JF }; };
    function stick(x, y, z, dx, dy, dz, kind) {
      const q = (I.nStuck % SCAP) * SF, S2 = I.stuck;
      S2[q] = x; S2[q + 1] = y; S2[q + 2] = z; S2[q + 3] = dx; S2[q + 4] = dy; S2[q + 5] = dz; S2[q + 6] = kind;
      I.nStuck++;
    }
    function throwPilum(r, t) {
      G.thrT[r] = -99;
      const x = G.x[r], z = G.z[r], sd = G.side[r];
      // his mark: the man he is facing, nearest the line of his file, inside his reach
      const b = G.blk[r];
      const hx = b >= 0 ? BK.fx[b] : Math.sin(G.heading[r]), hz = b >= 0 ? BK.fz[b] : Math.cos(G.heading[r]);
      let e = -1, bs = 1e9;
      forDiscB(x + hx * 16, z + hz * 16, 18, function (o) {
        if (G.side[o] === sd || !fighting(o)) return;
        const ox = G.x[o] - x, oz = G.z[o] - z, d2 = ox * ox + oz * oz;
        if (d2 > 34 * 34 || d2 < 9) return;
        const along = ox * hx + oz * hz;
        if (along < 3) return;
        const lat = Math.abs(ox * hz - oz * hx);
        const s = lat * 3 + Math.sqrt(d2);
        if (s < bs) { bs = s; e = o; }
      });
      if (e < 0) return;                                  // nobody in reach: he keeps it
      G.pil[r]--;
      const heavy = G.pil[r] >= 1 ? 1 : 0;               // the heavy one goes first (he carried two)
      const A = t.A;
      // where he aims: the man's middle, led a little for a mover
      let ax = G.x[e] + G.vx[e] * 0.9, az = G.z[e] + G.vz[e] * 0.9;
      const ay = G.y[e] + AIMY[G.post[e]];
      const oy = G.y[r] + 1.75;
      const ox = x + hx * 0.3, oz = z + hz * 0.3;
      let dx = ax - ox, dz = az - oz;
      const D0 = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= D0; dz /= D0;
      // the speed and the arc that carries it there (the low one), with his errors
      const err = (1 - A.skill * 0.6) * (1 + 0.6 * Math.min(2, G.stress[r]));
      const v = (heavy ? 18.5 : 22) * (1 + gauss() * 0.04);
      const dist = D0 * (1 + gauss() * 0.07 * err);
      const g9 = 9.81, dy = ay - oy;
      // tan(th) for a projectile through (dist, dy): the lower root
      const v2 = v * v, disc = v2 * v2 - g9 * (g9 * dist * dist + 2 * dy * v2);
      let th = disc > 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g9 * dist)) : 0.7;
      th += gauss() * 0.025 * err;
      const yaw = Math.atan2(dx, dz) + gauss() * 0.03 * err;
      if ((nJ + 1) * JF > JV.length) { const g2 = new F(JV.length * 2); g2.set(JV); JV = g2; }
      const q = nJ * JF;
      JV[q] = ox; JV[q + 1] = oy; JV[q + 2] = oz;
      JV[q + 3] = Math.sin(yaw) * Math.cos(th) * v; JV[q + 4] = Math.sin(th) * v; JV[q + 5] = Math.cos(yaw) * Math.cos(th) * v;
      JV[q + 6] = r; JV[q + 7] = sd; JV[q + 8] = heavy; JV[q + 9] = I.simT;
      nJ++;
      I.led.pila = (I.led.pila || 0) + 1;
      ev(EV.throw, r, e, heavy);
    }
    // the closest the segment p0->p1 comes to the vertical axis of man b, over his height
    const _ph = { hit: -1, y: 0, s: 0 };
    let _pj = 0, _jx0 = 0, _jy0 = 0, _jz0 = 0, _jx1 = 0, _jy1 = 0, _jz1 = 0, _jside = 0, _jby = -1;
    function visitPil(o) {
      if (o === _jby || G.side[o] === _jside || !alive(o)) return;
      if (G.ext[o] && G.ext[o] !== EXT.man) return;
      const sx = _jx1 - _jx0, sz = _jz1 - _jz0, L2 = sx * sx + sz * sz || 1e-6;
      let s = ((G.x[o] - _jx0) * sx + (G.z[o] - _jz0) * sz) / L2;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const px = _jx0 + sx * s - G.x[o], pz = _jz0 + sz * s - G.z[o];
      if (px * px + pz * pz > 0.27 * 0.27) return;
      const y = _jy0 + (_jy1 - _jy0) * s - G.y[o];
      const top = G.down[o] ? 0.35 : G.post[o] === POST.prone ? 0.35 : G.post[o] === POST.kneel ? 1.2 : 1.8;
      if (y < 0.02 || y > top) return;
      if (_ph.hit < 0 || s < _ph.s) { _ph.hit = o; _ph.y = y; _ph.s = s; }
    }
    function stepJav(dt) {
      let w = 0;
      for (let i = 0; i < nJ; i++) {
        const q = i * JF;
        const x0 = JV[q], y0 = JV[q + 1], z0 = JV[q + 2];
        const vx = JV[q + 3], vz = JV[q + 5];
        const vy = JV[q + 4] - 9.81 * dt;
        const x1 = x0 + vx * dt, y1 = y0 + (JV[q + 4] + vy) * 0.5 * dt, z1 = z0 + vz * dt;
        JV[q + 4] = vy;
        _jx0 = x0; _jy0 = y0; _jz0 = z0; _jx1 = x1; _jy1 = y1; _jz1 = z1; _jside = JV[q + 7]; _jby = JV[q + 6] | 0;
        _ph.hit = -1;
        const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5, half = Math.hypot(x1 - x0, z1 - z0) * 0.5 + 0.4;
        forCells(mx, mz, half, ++hbStamp, visitPil);
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        if (_ph.hit >= 0) { pilumHit(q, _ph.hit, _ph.y, sp); continue; }
        const gy = hAt(x1, z1);
        if (y1 <= gy || I.simT - JV[q + 9] > 6) {
          // into the ground at its angle, a third of its length in
          stick(x1, gy, z1, vx / sp, vy / sp, vz / sp, 0);
          continue;
        }
        JV[q] = x1; JV[q + 1] = y1; JV[q + 2] = z1;
        if (w !== i) JV.copyWithin(w * JF, q, q + JF);
        w++;
      }
      nJ = w;
    }
    function pilumHit(q, b, y, sp) {
      const by = JV[q + 6] | 0, heavy = JV[q + 8] > 0.5;
      const dx = JV[q + 3] / sp, dy = JV[q + 4] / sp, dz = JV[q + 5] / sp;
      I.led.pilaHit = (I.led.pilaHit || 0) + 1;
      // a man of the line with his shield up, facing it, the point at shield height: it takes it
      const tb = T_(b);
      if (G.shd[b] && tb.SH && !G.down[b]) {
        const hb = G.heading[b], facing = -(Math.sin(hb) * dx + Math.cos(hb) * dz);
        const sy = G.post[b] === POST.kneel ? -0.45 : 0;
        if (facing > 0.25 && y > tb.SH.y0 + sy - 0.05 && y < tb.SH.y0 + tb.SH.h + sy + (G.stc[b] === STC.roof || G.stc[b] === STC.wall ? 0.6 : 0.1)) {
          // the head goes through the boards and hangs there, the shank bent: he lets the shield go
          if (rnd() < (heavy ? 0.75 : 0.55)) {
            G.shd[b] = 0;
            ev(EV.shield, b, by, heavy ? 1 : 0);
            stick(G.x[b] + Math.sin(hb) * 0.6, G.y[b], G.z[b] + Math.cos(hb) * 0.6, dx, dy, dz, 2);
            // ...and sometimes on into the arm behind it
            if (rnd() < 0.12) hurt(b, 0.2 + rnd() * 0.15, 0.01, by, false);
          } else stick(G.x[b] - dx * 0.8, hAt(G.x[b] - dx * 0.8, G.z[b] - dz * 0.8), G.z[b] - dz * 0.8, dx * 0.4, -0.9, dz * 0.4, 0);
          G.stress[b] += 0.03;
          return;
        }
      }
      // the man: where it strikes him, and what he wears there
      const top = G.post[b] === POST.kneel ? 1.2 : G.post[b] === POST.prone || G.down[b] ? 0.35 : 1.8;
      const u = y / top;
      const zone = G.post[b] === POST.prone || G.down[b] ? (rnd() < 0.5 ? 1 : 3) : u > 0.86 ? 0 : u > 0.58 ? 1 : u > 0.46 ? 2 : 3;
      if (pointStopped(b, zone, heavy ? 0.6 : 0.45, true)) {
        G.supp[b] += 0.6; G.stress[b] += 0.08;
        stick(G.x[b] - dx * 0.5, hAt(G.x[b], G.z[b]), G.z[b] - dz * 0.5, dx * 0.5, -0.85, dz * 0.5, 0);
        return;
      }
      woundAt(b, zone, PILUM_M, by, heavy ? 1.15 : 1);
      stick(G.x[b], G.y[b] + y, G.z[b], dx, dy, dz, 1);
    }
    const PILUM_M = { reach: 0, now: [0.55, 0.95], bleed: 0.05, pen: 0.55 };

    /* ---- the man of the line moves: to his slot in the frame, or to the man he is fighting ---- */
    function ancMove(r, dt) {
      if (G.bleed[r] > 0) {
        G.cap[r] -= G.bleed[r] * dt;
        G.hp[r] = Math.max(0, G.cap[r] * 100);
        if (G.cap[r] <= 0) { kill(r, -1); return; }
        if (!G.down[r] && G.cap[r] < 0.5) downMan(r, -1);
      }
      if (G.down[r]) { G.vx[r] = 0; G.vz[r] = 0; return; }
      const b = G.blk[r];
      const routed = G.life[r] === LIFE.routed;
      let gx = G.gx[r], gz = G.gz[r], base = 0, top = SPEED.run, fh = NaN;
      const eng = G.eng[r] && G.tgt[r] >= 0 && alive(G.tgt[r]);
      if (!routed && b >= 0) {
        const fx = BK.fx[b], fz = BK.fz[b];
        gx = BK.cx[b] + fz * G.bsx[r] - fx * G.bsb[r];
        gz = BK.cz[b] - fx * G.bsx[r] - fz * G.bsb[r];
        base = BK.sp[b];
        fh = Math.atan2(fx, fz);
        const md = BK.mode[b];
        if (md === BM.charge) top = bA(b).charge * 1.1;
        if (eng) {
          // into reach of his man, no further than a couple of strides off his place
          const tg = G.tgt[r], tx = G.x[tg] - G.x[r], tz = G.z[tg] - G.z[r], td = Math.sqrt(tx * tx + tz * tz) || 0.01;
          const stand = T_(r).M.reach + 0.42;
          let ex = G.x[tg] - tx / td * stand, ez = G.z[tg] - tz / td * stand;
          const ox = ex - gx, oz = ez - gz, ol = Math.sqrt(ox * ox + oz * oz);
          const lim = G.brk[r] === 0 ? 2.8 : 1.6;
          if (ol > lim) { ex = gx + ox / ol * lim; ez = gz + oz / ol * lim; }
          gx = ex; gz = ez;
          fh = Math.atan2(tx, tz);
        }
        if (G.fat[r] > 0) G.fat[r] = Math.max(0, G.fat[r] - (eng ? 0.002 : 0.02) * dt);
      } else if (routed) { top = SPEED.run * (0.95 + 0.1 * trait(r, 0x40)); base = top; }
      const dx = gx - G.x[r], dz = gz - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.04) {
        G.vx[r] = 0; G.vz[r] = 0;
        if (fh === fh) G.heading[r] = fh;
        return;
      }
      let sp = Math.min(top, base + 1.6 * d) * (0.55 + 0.45 * Math.min(1, G.cap[r] / 0.8));
      if (G.mv[r] !== MOVE.walk) G.mv[r] = MOVE.walk;
      let st = Math.min(d, sp * dt);
      let nx = dx / d, nz = dz / d;
      // nobody walks into the man in front of him: an enemy within a body's width ahead stops the stride
      if (!routed && (eng || (b >= 0 && BK.ed[b] < 6))) {
        const px = G.x[r] + nx * st, pz = G.z[r] + nz * st, sd = G.side[r];
        let blocked = false;
        forCells(px, pz, 0.75, ++hbStamp, function (o) {
          if (o === r || G.side[o] === sd || !alive(o) || G.down[o]) return false;
          const ox = G.x[o] - px, oz = G.z[o] - pz;
          if (ox * ox + oz * oz < 0.62 * 0.62 && ox * nx + oz * nz > -0.1) { blocked = true; return true; }
          return false;
        });
        if (blocked) { st = 0; }
      }
      G.vx[r] = st > 0 ? nx * sp : 0; G.vz[r] = st > 0 ? nz * sp : 0;
      G.x[r] += nx * st; G.z[r] += nz * st;
      G.y[r] = hAt(G.x[r], G.z[r]);
      // he faces his block's front (or his man); only a man running to catch up looks where he goes
      G.heading[r] = (routed || (d > 3 && !eng) || fh !== fh) ? Math.atan2(dx, dz) : fh;
    }

    /* ============================================================ THE STEP */
    let stepN = 0;
    const SQ_DT = 0.5;
    I.step = function (dt) {
      const T0 = now();
      I.simT += dt;
      const n = I.nRows || 0;
      if (_stampA.length < n) _stampA = new I32(Math.max(n, 1024));
      if (dt !== calmDt || CALM_K.length !== I.types.length) {
        calmDt = dt; CALM_K = new F(I.types.length);
        for (let i = 0; i < I.types.length; i++) CALM_K[i] = Math.exp(-dt / I.types[i].D.calm);
      }
      // the grids: the bodies every 0.2 s, who-can-see-whom every 0.5 s
      if (gridAt < 0 || I.simT - gridAt >= 0.2) rebuild(gridAt < 0 || I.simT - eyeGridAt >= 0.5);
      /* THE SQUADS, each on its own clock: twice a second, at a phase of its
         own drawn off the battle's seed. Before, one round went up the squad
         list and back down it; the side whose squads were laid first always
         decided first after the turn at the bottom, and lost a 30 v 30 mirror
         58-42 over 400 seeds (60-40 the other way with the list reversed). */
      const t1 = now();
      if (SQ.n) {
        const asc0 = (stepN & 1) === 0, SA = SQ.at, simT0 = I.simT;
        for (let k = 0; k < SQ.n; k++) {
          const q = asc0 ? k : SQ.n - 1 - k;
          if (simT0 < SA[q]) continue;
          if (SA[q] <= 0) { SA[q] = simT0 + SQ_DT * trait(q + 0x40000, 0x5A7); continue; }    // (its first tick: a phase of its own)
          squadTick(q);
          SA[q] = simT0 + SQ_DT * (0.8 + 0.4 * trait(q + 0x40000, (simT0 * 2) | 0));
        }
      }
      // THE BLOCKS of the line of battle, each on its own clock
      if (BK.n) {
        const simT0 = I.simT;
        for (let b = 0; b < BK.n; b++) {
          if (!BK.nf[b] || simT0 < BK.at[b]) continue;
          if (BK.at[b] <= 0) { BK.at[b] = simT0 + 0.3 * trait(b + 0x70000, 0x5B1); continue; }
          blockTick(b);
        }
      }
      const t2 = now(); I.ms.squad += t2 - t1;
      // the men: his think on his own clock, then his trigger
      const LF = G.life, TA = G.thinkAt, TG = G.tgt, RT = G.reloadT, LK = G.lkT, EX = G.ext, AN = G.anc, simT = I.simT;
      /* THE ORDER MEN ARE WALKED IN ALTERNATES, step by step. Inside one step
         the first man walked acts on a world the second has not acted in yet;
         walked always low row to high, the side whose rows were laid first won
         a mirror match 19 times in 23 (measured on the dunes, 30 v 30). */
      const asc = (++stepN & 1) === 0;
      for (let k = 0; k < n; k++) {
        const r = asc ? k : n - 1 - k;
        const l = LF[r];
        if ((l !== LIFE.alive && l !== LIFE.routed) || EX[r]) continue;
        if (simT >= TA[r]) {
          const contact = simT - G.contactT[r] < 20;
          const step = contact ? 0.25 : 0.6;
          think(r, step);
          TA[r] = simT + step * (0.9 + 0.2 * trait(r, (simT * 4) | 0));
        }
        if (AN[r]) { if (l === LIFE.alive) ancTrigger(r, dt); continue; }
        if (l !== LIFE.alive || (TG[r] < 0 && RT[r] <= 0 && simT - LK[r] > 10)) continue;
        trigger(r, dt);
      }
      const t4 = now(); I.ms.think += t4 - t2;
      if (BK.n) moveBlocks(dt);
      moveAll(dt);
      if (nJ) stepJav(dt);
      resolveRounds();
      armyTick();
      I.ms.total += now() - T0;
    };
    /* ============================================================ THE HOST'S BODIES
       A body the host owns (its own man: a crew, the player's man, a man
       with bare hands; an animal; a hull) has a row too, written by the host
       every step (x y z heading vx vz post life). Our men see it, shoot at
       it and are shot by it; it never thinks or moves here. kind: EXT.*;
       w, h: its size (m); mm: its thinnest armour (RHA mm; 0 = none). */
    I.addExt = function (r, side, kind, w, h, mm) {
      G.typ[r] = 0; G.sqd[r] = -1; G.side[r] = side;
      G.ext[r] = kind; G.extW[r] = w || 0.5; G.extH[r] = h || 1.8; G.extMM[r] = mm || 0;
      G.life[r] = LIFE.alive; G.down[r] = 0; G.tgt[r] = -1; G.post[r] = G.post[r] || POST.stand;
      G.cap[r] = 1; G.bleed[r] = 0; G.supp[r] = 0;
      I.nRows = Math.max(I.nRows || 0, r + 1);
    };
    // one of our men becomes the host's (the player took him): he keeps his row
    I.release = function (r) { G.ext[r] = EXT.man; G.tgt[r] = -1; G.mv[r] = MOVE.hold; G.aidOn[r] = -1; };
    // and is handed back: he picks up where the host left him (the host wrote his body)
    I.adopt = function (r) {
      G.ext[r] = EXT.none; G.thinkAt[r] = I.simT; G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; G.mv[r] = MOVE.hold;
      G.postT[r] = 0; G.postTo[r] = G.post[r]; G.e0o[r] = -1; G.e1o[r] = -1; G.clT[r] = -99;
    };
    /* A ROUND FROM THE HOST'S WORLD (a hull's machine gun, the player's rifle)
       through our men: the same band walk, the same zones, plates and
       wounds. The host has already traced its world (ground, walls) and
       passes where it stopped (sMax, metres along the line). by: the
       shooter's row (or -1), side: his side, cart: a ballistics CART row.
       Returns where one of our men stopped it (or sMax). */
    const _outT = { c: null, D: null };
    I.traceRound = function (ox, oy, oz, dx, dy, dz, v0, k, cart, sMax, by, side) {
      if (!cart) return sMax;
      if (gridAt < 0) rebuild(true);
      if ((nR + 1) * RF > RB.length) { const g = new F(RB.length * 2); g.set(RB); RB = g; }
      const o = nR * RF;                              // a scratch slot past the live rounds
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= L; dy /= L; dz /= L;
      RB[o] = by == null ? -1 : by; RB[o + 1] = ox; RB[o + 2] = oy; RB[o + 3] = oz; RB[o + 4] = dx; RB[o + 5] = dy; RB[o + 6] = dz;
      RB[o + 7] = sMax; RB[o + 8] = 0; RB[o + 9] = v0; RB[o + 10] = k; RB[o + 11] = -1; RB[o + 12] = sMax; RB[o + 13] = Math.sqrt(dx * dx + dz * dz) || 1;
      RB[o + 14] = -1; RB[o + 15] = 0;
      _outT.c = cart; _outSide = side | 0;
      return resolve(o, _outT, true);
    };
    // the wounds the host resolved on a man of ours (its own anatomy pass): now, bleed, by row
    I.wound = function (r, nowFrac, bleed, by) { if (alive(r) && !G.ext[r]) hurt(r, nowFrac, bleed || 0, by == null ? -1 : by, false); };
    I.EXT = EXT;
    I.alive = alive; I.fighting = fighting;
    I.audit = function () {
      return { simT: I.simT, stats: I.stats, led: I.led, ms: I.ms, rounds: nR };
    };
    I.roundsInFlight = function () { return nR; };
    // the line of battle at a glance: blocks by state, men in it, spears in the air and down
    I.lineAudit = function () {
      const by = {}, names = Object.keys(BM);
      let men = 0, shields = 0, pila = 0, eng = 0;
      for (let b = 0; b < BK.n; b++) {
        if (!BK.nf[b]) continue;
        const k = names[BK.mode[b]];
        by[k] = (by[k] || 0) + 1;
        men += BK.nf[b];
      }
      for (let r = 0, n = I.nRows || 0; r < n; r++) {
        if (!G.anc[r] || G.life[r] !== LIFE.alive) continue;
        if (G.shd[r]) shields++;
        pila += G.pil[r];
        if (G.eng[r]) eng++;
      }
      return { blocks: by, men: men, shields: shields, pila: pila, engaged: eng, inFlight: nJ, stuck: Math.min(I.nStuck, SCAP),
        thrown: I.led.pila || 0, pilaHit: I.led.pilaHit || 0, blows: I.led.blows || 0, blowsIn: I.led.blowsIn || 0,
        reliefs: I.led.reliefs || 0, shieldHits: I.led.shieldHits || 0, fallbacks: I.led.fallbacks || 0 };
    };
    return I;
  }
  /* WHAT HE WEARS, as armour: his nation's kit row (countries.js `kit`, or
     combatkit's NATIONS), through the same mapping the rig wears
     (CBZ.armour.kitSpec). An untrained man and an irregular wear none; a real
     army's men wear their issue at any training; a regular's issue is the
     second-line grade (combatkit.js `grade`, men.js kitUp). */
  function kitFor(N, trn, real) {
    if (!N || trn === "civ" || N.irregular) return {};
    if (trn === "thug" && !real) return {};
    if (!CBZ.armour || !CBZ.armour.kitSpec) return {};
    return CBZ.armour.kitSpec(N, ["plates", "soft", "helmet"], trn === "pro" ? "second" : null);
  }
  CBZ.battleInfantry = { create: create, DOCTRINE: DOCTRINE, TRN_IDS: TRN_IDS, EV: EV, POST: POST, LIFE: LIFE, MOVE: MOVE, SHOT_F: SHOT_F,
    EYE: EYE, MUZ: MUZ, kitFor: kitFor, EXT: EXT, ANC: ANC, MELEE: MELEE, SHIELDS: SHIELDS, STC: STC, BM: BM };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleInfantry;
})();
