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
  const MOVE = { hold: 0, walk: 1, rush: 2, crawl: 3, run: 4 };
  const EV = { kill: 1, down: 2, hit: 3, fled: 4, rout: 5, rally: 6, shot: 7, aid: 8, post: 9 };
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
       ammoDisc share of a mag he keeps back before he stops to reload  */
  const DOCTRINE = {
    civ:   { detect: 0.16, acq: 2.1, settle: 1.00, hold: [3.4, 2.5, 1.5], recover: 0.60, press: 0.00, burst: 4, rangeErr: 0.30, adjust: 0.10, lead: [0.30, 0.50], drop: 2.2, rise: 1.6, rushMax: 9, coverR: 0, suppK: 1.7, pinAt: 0.55, calm: 6.0, reload: 6.0, tac: 0, nerve: 0.35, aid: 0, moveFire: 1, ammoDisc: 0 },
    thug:  { detect: 0.24, acq: 1.6, settle: 0.75, hold: [2.7, 1.9, 1.15], recover: 0.45, press: 0.30, burst: 3, rangeErr: 0.22, adjust: 0.25, lead: [0.50, 0.40], drop: 1.7, rise: 1.4, rushMax: 7, coverR: 3, suppK: 1.35, pinAt: 0.85, calm: 4.5, reload: 4.4, tac: 0, nerve: 0.48, aid: 6, moveFire: 1, ammoDisc: 0 },
    pro:   { detect: 0.36, acq: 1.15, settle: 0.55, hold: [1.95, 1.35, 0.80], recover: 0.33, press: 0.58, burst: 2, rangeErr: 0.15, adjust: 0.45, lead: [0.75, 0.25], drop: 1.3, rise: 1.1, rushMax: 5, coverR: 6, suppK: 1.00, pinAt: 1.25, calm: 3.2, reload: 3.0, tac: 1, nerve: 0.62, aid: 15, moveFire: 0.4, ammoDisc: 0.25 },
    elite: { detect: 0.52, acq: 0.80, settle: 0.38, hold: [1.35, 0.95, 0.52], recover: 0.24, press: 0.80, burst: 1, rangeErr: 0.10, adjust: 0.65, lead: [0.90, 0.15], drop: 1.0, rise: 0.9, rushMax: 4, coverR: 10, suppK: 0.72, pinAt: 1.8, calm: 2.2, reload: 2.4, tac: 1, nerve: 0.76, aid: 25, moveFire: 0.15, ammoDisc: 0.33 },
    swat:  { detect: 0.62, acq: 0.62, settle: 0.30, hold: [1.10, 0.80, 0.45], recover: 0.20, press: 0.86, burst: 1, rangeErr: 0.08, adjust: 0.75, lead: [0.95, 0.10], drop: 0.9, rise: 0.8, rushMax: 3.5, coverR: 12, suppK: 0.60, pinAt: 2.2, calm: 1.8, reload: 2.1, tac: 1, nerve: 0.85, aid: 25, moveFire: 0.1, ammoDisc: 0.33 },
  };
  const TRN_IDS = ["civ", "thug", "pro", "elite", "swat"];

  // the body for the eye: where on him a sight line is aimed (height above
  // his feet, m) and the area that point stands for (m2), by posture. A prone
  // man end-on shows his helmet and shoulders; side-on his whole length.
  const LOOK = [
    [[1.66, 0.05], [1.30, 0.17], [0.92, 0.15], [0.45, 0.30]],        // stand
    [[1.08, 0.05], [0.78, 0.15], [0.38, 0.12]],                       // kneel
    [[0.30, 0.045], [0.18, 0.07]],                                    // prone (end-on)
  ];
  const EYE = [1.62, 1.05, 0.33];            // eye height by posture
  const MUZ = [1.45, 0.98, 0.27];            // the muzzle
  const AIMY = [1.28, 0.80, 0.22];           // a centre-of-mass aim
  const HALF = [[0.20, 0.55], [0.20, 0.38], [0.22, 0.14]];   // half width, half height of the mass he aims at
  const SPEED = { walk: 1.45, rush: 4.2, crawl: 0.45, run: 3.4 };
  const SIGHT_R = 700;                       // nobody is looked for past this

  function create(S, cfg) {
    cfg = cfg || {};
    const B = CBZ.ballistics;
    if (!B) throw new Error("battleInfantry needs CBZ.ballistics");
    const AR = CBZ.armour || null;
    let seed = (cfg.seed >>> 0) || 0x2545F491;
    // the day's wind (m/s, a horizontal vector): the host's, else a breeze off the seed
    function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
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
      S.col("cand", I32, -1); S.col("det", F); S.col("detN", F); S.col("expo", F);
      S.col("acqT", F); S.col("aimT", F); S.col("cool", F); S.col("burst", U8);
      S.col("mag", I16); S.col("ammo", I16); S.col("reloadT", F); S.col("heat", F); S.col("rngE", F); S.col("rngTgt", I32, -1);
      S.col("supp", F); S.col("stress", F); S.col("cap", F); S.col("bleed", F); S.col("down", U8); S.col("aidBy", I32, -1); S.col("aidOn", I32, -1); S.col("aidEnd", F);
      S.col("pin", U8); S.col("flashT", F, -99); S.col("thinkAt", F); S.col("contactT", F, -99); S.col("crackT", F, -99);
      S.col("hitX", F); S.col("hitZ", F); S.col("shots", I32); S.col("hits", I32);
      S.col("plF", U8); S.col("plB", U8); S.col("plS", U8); S.col("helm", U8);
      S.col("inF", F, 1); S.col("inB", F, 1); S.col("inS", F, 1); S.col("inH", F, 1);
      S.col("vx", F); S.col("vz", F);
    }
    cols();
    let G = S.cols;
    S.onGrow(function () { G = S.cols; });

    const I = {
      S: S, simT: 0, types: [], events: new F(4096 * 4), nEv: 0, shots: new F(1024 * SHOT_F), nShot: 0,
      ms: { grid: 0, think: 0, move: 0, fire: 0, rounds: 0, squad: 0, total: 0 },
      stats: { shots: [0, 0], hits: [0, 0], kills: [0, 0], downs: [0, 0], fled: [0, 0], thinks: 0, los: 0, rounds: 0 },
      led: { shotsAt: [0, 0, 0, 0, 0, 0, 0], hitsAt: [0, 0, 0, 0, 0, 0, 0], organs: { brain: 0, spine: 0, vital: 0, gut: 0, torso: 0, head: 0, limb: 0, plate: 0 },
        plate: 0, platePen: 0, firstShot: [-1, -1], firstHit: [-1, -1], cracks: 0, aids: 0, posts: 0, rushes: 0, pins: 0 },
      order: [{ kind: "advance", x: 0, z: 0 }, { kind: "advance", x: 0, z: 0 }],
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
        plate: plateIdx(kit.plates), side: plateIdx(kit.sides), helm: plateIdx(kit.helmet),
        armed: spec.gun && spec.gun !== "fists",
        thr: AR && c ? (AR.ROUNDS[c === B.CART["556"] ? "556" : c === B.CART["762x39"] ? "762x39" : c === B.CART["762x51"] ? "762x51" : c === B.CART["9x19"] ? "9mm" : "556"] || null) : null,
      };
      t.carry = g.carry || 180;
      t.idx = I.types.length;
      I.types.push(t);
      return t.idx;
    };

    /* ------------------------------------------------------------ squads
       ten men: slot 0 leads, 1-4 alpha, 5-9 bravo. The host names the id. */
    const SQ = { n: 0, side: new U8(0), mem: new I32(0), cnt: new U8(0), task: new U8(0), at: new F(0), lead: new I32(0),
      cx: new F(0), cz: new F(0), contact: new F(0), bound: new U8(0), boundT: new F(0), thx: new F(0), thz: new F(0), hurt: new U8(0), fx: new F(0), fz: new F(0),
      lostT: new F(0), brkX: new F(0), brkZ: new F(0), brkT: new F(0), lastC: new F(0) };
    const TASK = { advance: 0, contact: 1, base: 2, bound: 3, assault: 4, hold: 5, breakc: 6, gone: 7 };
    I.TASK = TASK;
    function sqGrow(n) {
      if (n <= SQ.n) return;
      const cap = Math.max(n, SQ.n * 2, 16);
      for (const k in SQ) {
        if (k === "n" || k === "mem") continue;
        const a = new SQ[k].constructor(cap); a.set(SQ[k].subarray(0, Math.min(SQ[k].length, cap))); SQ[k] = a;
      }
      const m = new I32(cap * 10).fill(-1); m.set(SQ.mem.subarray(0, Math.min(SQ.mem.length, cap * 10))); SQ.mem = m;
      SQ.n = n;
    }
    I.squads = SQ;

    I.add = function (r, type, sq, slot, side) {
      const t = I.types[type];
      G.typ[r] = type; G.sqd[r] = sq == null ? -1 : sq; G.slot[r] = slot | 0;
      G.post[r] = POST.stand; G.postTo[r] = POST.stand; G.postT[r] = 0;
      G.mv[r] = MOVE.hold; G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; G.rushT[r] = 0; G.face[r] = G.heading[r];
      G.tgt[r] = -1; G.tgtT[r] = 0; G.seenT[r] = -99; G.lkT[r] = -99; G.cand[r] = -1; G.det[r] = 0; G.expo[r] = 0;
      G.acqT[r] = 0; G.aimT[r] = 0; G.cool[r] = 0; G.burst[r] = 0;
      G.mag[r] = t.armed ? t.magSize : 0; G.ammo[r] = t.armed ? t.carry : 0; G.reloadT[r] = 0; G.heat[r] = 0; G.rngE[r] = 0; G.rngTgt[r] = -1;
      G.supp[r] = 0; G.stress[r] = 0; G.cap[r] = 1; G.bleed[r] = 0; G.down[r] = 0; G.aidBy[r] = -1; G.aidOn[r] = -1; G.aidEnd[r] = 0;
      G.flashT[r] = -99; G.thinkAt[r] = I.simT + rnd() * 0.25; G.contactT[r] = -99; G.crackT[r] = -99;
      G.shots[r] = 0; G.hits[r] = 0; G.vx[r] = 0; G.vz[r] = 0;
      G.plF[r] = t.plate; G.plB[r] = t.plate; G.plS[r] = t.side; G.helm[r] = t.helm;
      G.inF[r] = 1; G.inB[r] = 1; G.inS[r] = 1; G.inH[r] = 1;
      G.hp[r] = G.maxHp[r] = 100;
      if (side != null) G.side[r] = side;
      G.life[r] = LIFE.alive;
      G.y[r] = hAt(G.x[r], G.z[r]);
      if (sq != null && sq >= 0) {
        sqGrow(sq + 1);
        SQ.side[sq] = G.side[r];
        const s = slot | 0;
        if (s < 10) SQ.mem[sq * 10 + s] = r;
        if (SQ.cnt[sq] < s + 1) SQ.cnt[sq] = s + 1;
      }
      I.nRows = Math.max(I.nRows || 0, r + 1);
    };
    I.order = function (side, o) { I.order[side] = o; I.orders[side] = o; };
    I.orders = I.order;   // (the same array: order[side])
    I.order[0] = { kind: "advance", x: 0, z: 0 }; I.order[1] = { kind: "advance", x: 0, z: 0 };

    /* ------------------------------------------------------------ the ground and the cover */
    const ground = cfg.ground || null, groundFn = typeof cfg.groundAt === "function" ? cfg.groundAt : null;
    function hAt(x, z) {
      if (!ground) return groundFn ? groundFn(x, z) : 0;
      const fx = (x - ground.x0) / ground.cell, fz = (z - ground.z0) / ground.cell;
      let ix = Math.floor(fx), iz = Math.floor(fz);
      const w = ground.w, h = ground.h;
      if (ix < 0) ix = 0; else if (ix > w - 2) ix = w - 2;
      if (iz < 0) iz = 0; else if (iz > h - 2) iz = h - 2;
      let tx = fx - ix, tz = fz - iz;
      tx = tx < 0 ? 0 : tx > 1 ? 1 : tx; tz = tz < 0 ? 0 : tz > 1 ? 1 : tz;
      const H = ground.hgt, k = iz * w + ix;
      const a = H[k] + (H[k + 1] - H[k]) * tx, b = H[k + w] + (H[k + w + 1] - H[k + w]) * tx;
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
    function lineClear(ax, ay, az, bx, by, bz) {
      I.stats.los++;
      const dx = bx - ax, dz = bz - az, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.8) return true;
      const dy = by - ay;
      const fine = Math.min(7, d * 0.5), coarse = Math.max(1.5, Math.min(4, d / 80));
      let s = 0.35;
      while (s < d - 0.35) {
        const t = s / d, x = ax + dx * t, z = az + dz * t;
        const top = hAt(x, z) + (cover ? coverAt(x, z) : 0);
        if (top > ay + dy * t) return false;
        s += (s < fine || s > d - fine) ? 0.5 : coarse;
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
    const GE = [mkGrid(32), mkGrid(32)], GB = mkGrid(4), GP = [mkGrid(128), mkGrid(128)];
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
    function rebuild() {
      const t0 = now();
      const n = I.nRows || 0;
      if (all.length < n) { all = new I32(Math.max(n, 1024)); live[0] = new I32(all.length); live[1] = new I32(all.length); }
      // the field's extent (with room)
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, na = 0, n0 = 0, n1 = 0;
      for (let r = 0; r < n; r++) {
        const l = G.life[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        const x = G.x[r], z = G.z[r];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
        all[na++] = r;
        if (G.down[r]) continue;              // a downed man is a body to hit, not a man to look for
        if (G.side[r] === 0) live[0][n0++] = r; else live[1][n1++] = r;
      }
      allN = na; liveN[0] = n0; liveN[1] = n1;
      if (na) {
        const pad = 160;
        if (x0 - pad < ext.x0 || z0 - pad < ext.z0 || x1 + pad > ext.x1 || z1 + pad > ext.z1 || gridAt < 0) {
          ext = { x0: x0 - pad * 2, z0: z0 - pad * 2, x1: x1 + pad * 2, z1: z1 + pad * 2 };
          for (let s = 0; s < 2; s++) { fitGrid(GE[s]); fitGrid(GP[s]); }
          fitGrid(GB);
        }
      }
      build(GE[0], live[0], n0); build(GE[1], live[1], n1);
      build(GP[0], live[0], n0); build(GP[1], live[1], n1);
      build(GB, all, na);
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
      const D = D_(r), t = T_(r);
      if (G.down[r]) { downThink(r, dt); return; }
      if (G.life[r] === LIFE.routed) { routThink(r); return; }
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
        const d = Math.hypot(G.x[tg] - x, G.z[tg] - z);
        const e = exposure(r, tg);
        G.expo[r] = e;
        if (e > 0) {
          G.seenT[r] = I.simT; G.lkx[r] = G.x[tg]; G.lkz[r] = G.z[tg]; G.lkT[r] = I.simT;
        } else if (I.simT - G.seenT[r] > 6) {
          // lost: he keeps watching the spot, and looks for anybody else
          G.tgt[r] = tg = -1;
        }
        void d;
      }
      if (near) {
        // the search: the nearest few in his sector; detection accumulates
        // on the best of them (a hazard: P(found in dt) = 1 - e^-h dt)
        const n = candidates(r, SIGHT_R);
        let bestH = 0, best = -1, bestE = 0;
        const lim = Math.min(n, tg >= 0 ? 2 : 4);
        for (let i = 0; i < lim; i++) {
          const o = _cand[i];
          if (o === tg) continue;
          const d = Math.sqrt(_cd[i]);
          const e = exposure(r, o);
          const h = hazard(r, o, d, e);
          if (h > bestH) { bestH = h; best = o; bestE = e; }
        }
        if (best >= 0 && bestH > 0) {
          // an exponential clock: a fresh threshold (-ln U) when a new man
          // comes under his eye, the hazard integrated against it
          if (G.cand[r] !== best) { G.cand[r] = best; G.det[r] = 0; G.detN[r] = -Math.log(1 - rnd() * 0.99999); }
          G.det[r] += bestH * dt;
          if (G.det[r] >= G.detN[r]) {
            const better = tg < 0 || (bestE > G.expo[r] * 1.5 && _cd[0] < 1e9);
            if (better) acquire(r, best, bestE);
            G.det[r] = 0; G.cand[r] = -1;
          }
        }
      }
      // ---- contact: what he does about it
      // his own contact (he sees one, a round cracked past, he knows where they are),
      // or his squad's: he heard the fire and the shout, and he knows the bearing
      const own = tg >= 0 || I.simT - G.crackT[r] < 8 || I.simT - G.lkT[r] < 12;
      const sqd = G.sqd[r];
      const inContact = own || (sqd >= 0 && SQ.lastC[sqd] > 0 && I.simT - SQ.lastC[sqd] < 10);
      if (own) G.contactT[r] = I.simT;
      decide(r, D, t, inContact);
    }
    function acquire(r, o, e) {
      const D = D_(r);
      const prev = G.tgt[r];
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
      if (!inContact) {
        // ---- no contact: the order (march, hold)
        G.post[r] === POST.prone && G.postT[r] <= 0 && I.simT - G.contactT[r] > 40 ? setPost(r, POST.stand) : 0;
        if (task === TASK.hold || task === TASK.base) { G.mv[r] = MOVE.hold; return; }
        if (G.post[r] !== POST.stand) { if (I.simT - G.contactT[r] > 40) setPost(r, POST.stand); else { G.mv[r] = MOVE.hold; return; } }
        march(r);
        return;
      }
      // ---- contact
      const pinned = G.supp[r] > D.pinAt;
      if (pinned && !G.pin[r]) I.led.pins++;
      G.pin[r] = pinned ? 1 : 0;
      // a rush in progress runs out (he drops wherever he is)
      if (G.mv[r] === MOVE.rush) {
        const arrived = Math.hypot(G.gx[r] - G.x[r], G.gz[r] - G.z[r]) < 0.8;
        if (arrived || G.rushT[r] > D.rushMax * (0.8 + 0.4 * trait(r, 0x7A)) || (pinned && G.rushT[r] > 1.2)) {
          G.mv[r] = MOVE.hold; G.rushT[r] = 0; G.gx[r] = G.x[r]; G.gz[r] = G.z[r];
          setPost(r, POST.prone);
        }
        return;
      }
      // squad orders under fire: the bounding team moves, the base fires
      const bounding = sq >= 0 && (task === TASK.bound || task === TASK.assault) && boundingTeam(sq, r);
      if (bounding && !pinned && tx === tx) {
        const go = boundGoal(r, sq, tx, tz);
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
      if (G.mv[r] === MOVE.walk || G.mv[r] === MOVE.run) { G.mv[r] = MOVE.hold; G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; }
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
        /* A BETTER SPOT. He is down; the fold he dropped into may show too
           much of him, or no longer give him the line. While the mark is out
           of his sight (he has nothing to shoot, the enemy has nothing to see)
           and he is not pinned, a trained man crawls to the best spot within a
           few strides: lower behind a lip, still with the line. */
        if (G.postT[r] <= 0 && usesGround && !pinned && G.post[r] !== POST.stand && G.reloadT[r] <= 0 &&
            (I.simT - G.seenT[r] > 2.5 || G.expo[r] <= 0) && I.simT - G.crackT[r] > 1.5) {
          const sp = bestSpot(r, Math.min(5, D.coverR), tx, tz);
          if (sp && Math.hypot(sp.x - G.x[r], sp.z - G.z[r]) > 0.8) {
            G.gx[r] = sp.x; G.gz[r] = sp.z; G.mv[r] = MOVE.crawl;
            if (G.post[r] !== sp.p && sp.p !== POST.stand) setPost(r, sp.p);
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
      const x = G.x[r], z = G.z[r], gy = hAt(x, z), ty = hAt(tx, tz) + 0.9;
      if (habit) return lineClear(x, gy + EYE[1], z, tx, ty, tz) ? POST.kneel : POST.stand;
      if (lineClear(x, gy + EYE[2], z, tx, ty, tz)) return POST.prone;
      if (lineClear(x, gy + EYE[1], z, tx, ty, tz)) return POST.kneel;
      return POST.stand;
    }

    /* ---- the march: the squad's formation slot on its leader ---- */
    function march(r) {
      const sq = G.sqd[r];
      const o = I.order[G.side[r]];
      let gx = o.x, gz = o.z;
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
      G.mv[r] = d < 1 ? MOVE.hold : d > 12 ? MOVE.run : MOVE.walk;
      if (d > 0.5) G.face[r] = Math.atan2(gx - G.x[r], gz - G.z[r]);
    }

    /* ---- the wounded ---- */
    function downThink(r, dt) {
      void dt;
      G.mv[r] = MOVE.hold;
      if (G.post[r] !== POST.prone) { G.post[r] = POST.prone; G.postT[r] = 0; }
    }
    function routThink(r) {
      // away from the enemy, as fast as he can, until he is far enough
      const o = I.order[G.side[r] ? 0 : 1];
      void o;
      const tx = G.lkT[r] > -50 ? G.lkx[r] : G.x[r], tz = G.lkT[r] > -50 ? G.lkz[r] : G.z[r] + 1;
      const dx = G.x[r] - tx, dz = G.z[r] - tz, d = Math.hypot(dx, dz) || 1;
      G.gx[r] = G.x[r] + dx / d * 40; G.gz[r] = G.z[r] + dz / d * 40;
      if (G.post[r] !== POST.stand) setPost(r, POST.stand);
      G.mv[r] = MOVE.run;
      if (d > 600) { G.life[r] = LIFE.fled; I.stats.fled[G.side[r]]++; ev(EV.fled, r, -1, 0); }
    }

    /* ============================================================ THE TRIGGER */
    const _poi = { x: 0, y: 0, z: 0 };
    function trigger(r, dt) {
      const t = T_(r), D = t.D;
      if (!t.armed || G.down[r] || G.life[r] !== LIFE.alive || G.aidOn[r] >= 0) return;
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
    function areaFire(r, t, D) {
      if (G.cool[r] > 0 || G.mag[r] <= 0 || G.mv[r] !== MOVE.hold || G.post[r] === POST.stand && G.postT[r] > 0) return;
      if (I.simT - G.lkT[r] > 10) return;
      const sq = G.sqd[r];
      const cover = sq >= 0 && (SQ.task[sq] === TASK.bound || SQ.task[sq] === TASK.assault || SQ.task[sq] === TASK.breakc) && !boundingTeam(sq, r);
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
      const err = 1.5 + d * 0.012;
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
      // the rattle, and a wound
      hold *= 1 + 0.55 * Math.min(3, G.supp[r]) * D.suppK;
      hold *= 1 + (1 - G.cap[r]) * 2.2;
      const heat = G.heat[r] * Math.exp(-(I.simT - G.flashT[r]) / D.recover);
      return Math.sqrt(hold * hold + t.mech * t.mech + heat * heat);
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
        resolve(o);
      }
      nR = w;
      I.ms.rounds += now() - t0;
    }
    function resolve(o) {
      const sh = RB[o] | 0, typ = RB[o + 11] | 0, t = I.types[typ];
      const ox = RB[o + 1], oz = RB[o + 3], dx = RB[o + 4], dz = RB[o + 6], hk = RB[o + 13];
      let stop = RB[o + 7];
      const sT = RB[o + 12];
      const sd = G.side[sh];
      // the bodies along the line: everyone within 1.2 m of it in the ground
      // plane, from the muzzle to where it stopped (the body grid, 4 m cells)
      _hitList.length = 0; _hitA.length = 0;
      const ux = dx / hk, uz = dz / hk;
      const hEnd = stop * hk;
      let stamp = ++_stampN;
      for (let hs = 2; hs <= hEnd + 4; hs += 3) {
        const x = ox + ux * hs, z = oz + uz * hs;
        // the round high over the ground cannot hit anybody here
        if (hs > 12) { const yy = roundY(o, hs / hk); if (yy - hAt(x, z) > 2.4) continue; }
        const c = cellOf(GB, x, z);
        const st = GB.start, L = GB.list;
        for (let i = st[c], e = st[c + 1]; i < e; i++) {
          const b = L[i];
          if (b === sh || _stampA[b] === stamp) continue;
          _stampA[b] = stamp;
          const bx = G.x[b] - ox, bz = G.z[b] - oz;
          const along = bx * ux + bz * uz;
          if (along < 0.5 || along > hEnd + 1) continue;
          const off = Math.abs(bx * uz - bz * ux);
          if (off > 1.25) { if (off < 6) nearMiss(o, b, along, off, t); continue; }
          // the line through his body, in his posture
          const a = traceMan(o, b, along / hk);
          if (a < 0) { nearMiss(o, b, along, off, t); continue; }
          if (a >= stop) continue;
          _hitList.push(b); _hitA.push(a);
        }
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
        traceMan(o, b, a);
        const vOut = woundMan(o, b, v, t, sh);
        if (hitRow < 0) hitRow = b;
        if (vOut < 60) { stop = a + 0.2; break; }
        vk *= vOut / v;
      }
      // the strike: where a miss lands tells a trained shooter how far off he was
      if (hitRow < 0) {
        const mk = RB[o + 14] | 0;
        if (mk >= 0 && G.rngTgt[sh] === mk) {
          const D = t.D;
          // he sees the dust kick (not in the dark, not off his own suppression)
          if (stop < sT + 60 && G.supp[sh] < D.pinAt) G.rngE[sh] *= 1 - D.adjust;
        }
        // it lands near somebody: the strike rattles him too
        const sx = ox + dx * stop, sz = oz + dz * stop;
        forDisc(GB, sx, sz, 2.5, function (b) {
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
      if (G.plF[b] || G.plS[b] || G.helm[b]) {
        const P = PLATE_BOX[G.post[b]];
        let n = 0;
        for (let i = 0; i < P.length; i++) {
          const box = P[i];
          if (box.kind === "front" && !G.plF[b]) continue;
          if (box.kind === "back" && !G.plB[b]) continue;
          if (box.kind === "side" && !G.plS[b]) continue;
          if (box.kind === "helm" && !G.helm[b]) continue;
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
        { kind: "helm", z: Zb(-0.115, 0.115, -0.105, 0.105, 1.69, 1.81) } ],
      [ { kind: "front", z: Zb(0.135, 0.155, -0.12, 0.12, 0.64, 0.96) }, { kind: "back", z: Zb(-0.135, -0.115, -0.12, 0.12, 0.64, 0.96) },
        { kind: "side", z: Zb(-0.06, 0.09, -0.21, -0.19, 0.62, 0.82) }, { kind: "side", z: Zb(-0.06, 0.09, 0.19, 0.21, 0.62, 0.82) },
        { kind: "helm", z: Zb(-0.095, 0.135, -0.105, 0.105, 1.11, 1.23) } ],
      [ { kind: "front", z: Zb(0.32, 0.64, -0.12, 0.12, 0.0, 0.03) }, { kind: "back", z: Zb(0.32, 0.64, -0.12, 0.12, 0.27, 0.30) },
        { kind: "side", z: Zb(0.36, 0.56, -0.23, -0.21, 0.04, 0.24) }, { kind: "side", z: Zb(0.36, 0.56, 0.21, 0.23, 0.04, 0.24) },
        { kind: "helm", z: Zb(0.78, 0.97, -0.105, 0.105, 0.26, 0.40) } ],
    ];
    function plateOf(b, kind) {
      return kind === "front" ? G.plF[b] : kind === "back" ? G.plB[b] : kind === "side" ? G.plS[b] : G.helm[b];
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
        if (e.a <= first.a + 0.25 && (!plateKind || e.a < layer)) { plateKind = e.kind; layer = e.a; }
      }
      const c = t.c;
      let lay = null;
      if (plateKind && AR) {
        const P = PLATES[plateOf(b, plateKind)];
        if (P) {
          I.led.plate++;
          // CBZ.armour's own rule (versus): the round's steel-equivalent
          // penetration now against this piece's rating, cracked as it is
          const col = plateKind === "front" ? G.inF : plateKind === "back" ? G.inB : plateKind === "side" ? G.inS : G.inH;
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
      const res = B.wound(_tr, MAN_AN, c, v, c.v0, lay, _wr);
      if (!res.hit) return v;
      const H = B.harm(res, MAN_AN, true);
      const sd = G.side[sh];
      I.stats.hits[sd]++;
      G.hits[sh]++;
      if (I.led.firstHit[sd] < 0) I.led.firstHit[sd] = I.simT;
      const dist = Math.hypot(G.x[b] - RB[o + 1], G.z[b] - RB[o + 3]);
      I.led.hitsAt[bandOf(dist)]++;
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
      if (by >= 0) { G.crackT[b] = I.simT; G.hitX[b] = G.x[by]; G.hitZ[b] = G.z[by]; if (G.tgt[b] < 0 && G.lkT[b] < I.simT - 2) { G.lkx[b] = G.x[by]; G.lkz[b] = G.z[by]; G.lkT[b] = I.simT - 3; } }
      ev(EV.hit, b, by, now_);
      if (G.cap[b] <= 0) { kill(b, by); return; }
      if (!G.down[b] && G.cap[b] < 0.5) downMan(b, by);
    }
    function downMan(b, by) {
      G.down[b] = 1; G.tgt[b] = -1; G.mv[b] = MOVE.hold; G.post[b] = POST.prone; G.postT[b] = 0;
      I.stats.downs[by >= 0 ? G.side[by] : (G.side[b] ? 0 : 1)]++;
      ev(EV.down, b, by, 0);
      shock(b, 0.3);
    }
    function kill(b, by) {
      if (G.life[b] === LIFE.dead) return;
      G.life[b] = LIFE.dead; G.cap[b] = 0; G.hp[b] = 0; G.vx[b] = 0; G.vz[b] = 0; G.mv[b] = MOVE.hold;
      I.stats.kills[by >= 0 ? G.side[by] : (G.side[b] ? 0 : 1)]++;
      ev(EV.kill, b, by, 0);
      if (!G.down[b]) shock(b, 0.45);
    }
    // the men round a man who goes down feel it
    function shock(b, k) {
      const x = G.x[b], z = G.z[b], sd = G.side[b];
      forDisc(GB, x, z, 15, function (o) {
        if (o === b || G.side[o] !== sd || !fighting(o)) return;
        const dx = G.x[o] - x, dz = G.z[o] - z, d2 = dx * dx + dz * dz;
        if (d2 > 225) return;
        G.stress[o] += k * 0.4 * (1 - Math.sqrt(d2) / 15) * D_(o).suppK;
      });
      const sq = G.sqd[b];
      if (sq >= 0) SQ.hurt[sq] = Math.min(255, SQ.hurt[sq] + 1);
    }
    // A ROUND CRACKS PAST HIM
    function nearMiss(o, b, along, off, t) {
      const sh = RB[o] | 0;
      if (G.side[b] === G.side[sh] || !alive(b)) return;
      const v = B.vAt(RB[o + 9], RB[o + 10], along);
      const R = B.suppressR(t.c, v);
      const y = roundY(o, along / RB[o + 13]) - (G.y[b] + EYE[G.post[b]]);
      const miss = Math.sqrt(off * off + y * y);
      if (miss > R) return;
      crack(b, 1 - miss / R, RB[o + 1], RB[o + 3]);
    }
    function crack(b, k, fx, fz) {
      const D = D_(b);
      G.supp[b] += D.suppK * (0.35 + 0.65 * k);
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
    function blast(imp) {
      // the munition's charge W (kg TNT): overpressure and fragments by scaled distance
      const Wk = Math.max(0.01, imp.W || 0.2), Rk = 12 * Math.cbrt(Wk / 0.18);
      forDisc(GB, imp.x, imp.z, Rk, function (b) {
        if (!alive(b)) return;
        const d = Math.hypot(G.x[b] - imp.x, G.z[b] - imp.z);
        if (d > Rk) return;
        // fragments: the chance a man takes one falls with the area he shows
        // (a prone man presents a third) and with the square of the range
        const show = G.post[b] === POST.prone ? 0.3 : G.post[b] === POST.kneel ? 0.6 : 1;
        const frags = 300 * Wk / 0.18 * show * 0.7 / (4 * Math.PI * Math.max(1, d * d)) ;
        let n = 0; for (let k = 0; k < 6 && rnd() < frags / 6; k++) n++;
        const Z = d / Math.cbrt(Wk);
        if (Z < 1.6) { hurt(b, 2, 0, imp.by == null ? -1 : imp.by, false); return; }
        for (let k = 0; k < n; k++) hurt(b, 0.15 + rnd() * 0.45, 0.01, imp.by == null ? -1 : imp.by, false);
        G.supp[b] += 3 * (1 - d / Rk);
      });
    }

    /* ============================================================ BODIES MOVE */
    function moveAll(dt) {
      const t0 = now();
      const n = I.nRows || 0;
      for (let r = 0; r < n; r++) {
        const l = G.life[r];
        if (l !== LIFE.alive && l !== LIFE.routed) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        // the body's clocks
        if (G.postT[r] > 0) { G.postT[r] -= dt; if (G.postT[r] <= 0) { G.postT[r] = 0; G.post[r] = G.postTo[r]; } }
        if (G.supp[r] > 0) { const D = D_(r); G.supp[r] *= Math.exp(-dt / D.calm); if (G.supp[r] < 0.01) G.supp[r] = 0; }
        // the stress of it wears off over a minute or so (faster out of contact)
        if (G.stress[r] > 0) G.stress[r] *= Math.exp(-dt / (I.simT - G.contactT[r] < 10 ? 90 : 30));
        if (G.bleed[r] > 0) {
          G.cap[r] -= G.bleed[r] * dt;
          G.hp[r] = Math.max(0, G.cap[r] * 100);
          if (G.cap[r] <= 0) { kill(r, -1); continue; }
          if (!G.down[r] && G.cap[r] < 0.5) downMan(r, -1);
        }
        const m = G.mv[r];
        if (m === MOVE.hold || G.postT[r] > 0 || G.down[r]) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        // a man moves in his posture: up to rush, flat to crawl
        let sp = m === MOVE.rush ? SPEED.rush : m === MOVE.run ? SPEED.run : m === MOVE.crawl ? SPEED.crawl : SPEED.walk;
        if (m === MOVE.crawl && G.post[r] !== POST.prone) sp = 0.9;     // a crouched shuffle
        if ((m === MOVE.rush || m === MOVE.run || m === MOVE.walk) && G.post[r] !== POST.stand) { setPost(r, POST.stand); G.vx[r] = 0; G.vz[r] = 0; continue; }
        sp *= 0.55 + 0.45 * Math.min(1, G.cap[r] / 0.8);
        const dx = G.gx[r] - G.x[r], dz = G.gz[r] - G.z[r], d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.05) { G.vx[r] = 0; G.vz[r] = 0; continue; }
        const st = Math.min(d, sp * dt);
        const vx = dx / d * sp, vz = dz / d * sp;
        G.vx[r] = vx; G.vz[r] = vz;
        G.x[r] += dx / d * st; G.z[r] += dz / d * st;
        G.y[r] = hAt(G.x[r], G.z[r]);
        if (m === MOVE.rush) G.rushT[r] += dt;
        G.heading[r] = Math.atan2(dx, dz);
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
    function squadTick(sq) {
      const base = sq * 10;
      let lead = -1, nAlive = 0, nFight = 0, cx = 0, cz = 0, inContact = 0, pinned = 0, tx = 0, tz = 0, nt = 0, stress = 0;
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
      const o = I.order[SQ.side[sq]];
      // the march direction
      let fx = o.x - cx, fz = o.z - cz;
      const fl = Math.hypot(fx, fz) || 1;
      SQ.fx[sq] = fx / fl; SQ.fz[sq] = fz / fl;
      if (nt) { SQ.thx[sq] = tx / nt; SQ.thz[sq] = tz / nt; if (inContact) SQ.lastC[sq] = I.simT; }
      const losses = 1 - nFight / Math.max(1, SQ.cnt[sq]);
      /* MORALE. The pressure on the squad is its losses (men down and dead,
         the ones they can see) plus the mean stress its men carry (cracks,
         wounds, mates falling beside them). Past its nerve it breaks contact
         (an ordered withdrawal by bounds); far past it, it routs. */
      const P = losses + stress / nFight;
      const task0 = SQ.task[sq];
      if (inContact && (P > D.nerve || task0 === TASK.breakc)) {
        if (P > D.nerve * 1.45 || (task0 === TASK.breakc && P > D.nerve * 1.25)) {
          for (let j = 0; j < 10; j++) {
            const r = SQ.mem[base + j];
            if (r >= 0 && fighting(r) && G.life[r] === LIFE.alive) { G.life[r] = LIFE.routed; ev(EV.rout, r, -1, 0); }
          }
          SQ.task[sq] = TASK.gone;
          return;
        }
        if (task0 !== TASK.breakc) { SQ.task[sq] = TASK.breakc; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; SQ.brkX[sq] = cx; SQ.brkZ[sq] = cz; SQ.brkT[sq] = I.simT; }
        // out of it: 150 m back from where it broke, or out of contact
        if (Math.hypot(cx - SQ.brkX[sq], cz - SQ.brkZ[sq]) > 150) { SQ.task[sq] = TASK.hold; return; }
        if (I.simT - SQ.boundT[sq] > 5) { SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      if (task0 === TASK.breakc && !inContact) { SQ.task[sq] = TASK.hold; return; }
      if (task0 === TASK.hold && I.simT - SQ.brkT[sq] < 120 && SQ.brkT[sq] > 0) return;    // it has withdrawn: it holds there
      if (!inContact) {
        SQ.task[sq] = o.kind === "hold" ? TASK.hold : TASK.advance;
        SQ.bound[sq] = 0;
        return;
      }
      // in contact
      if (o.kind === "hold" || nFight < 2 || I.simT < SQ.lostT[sq]) { SQ.task[sq] = TASK.base; return; }
      const dTh = nt ? Math.hypot(SQ.thx[sq] - cx, SQ.thz[sq] - cz) : 999;
      /* FIRE AND MOVEMENT: one team moves while the other fires, and only
         while the fire is not too heavy to move under; the teams swap on the
         squad's clock. A base of fire comes first (the squad down and
         shooting for a few seconds). Inside 45 m of the enemy: the assault. */
      if (pinned >= Math.ceil(nFight * 0.5)) { SQ.task[sq] = TASK.base; SQ.bound[sq] = 0; return; }
      if (task0 !== TASK.bound && task0 !== TASK.assault) {
        SQ.task[sq] = TASK.base;
        if (SQ.contact[sq] <= 0) SQ.contact[sq] = I.simT;
        if (I.simT - SQ.contact[sq] > 6 + 8 * (1 - D.press) && I.simT - SQ.boundT[sq] > 6) { SQ.task[sq] = TASK.bound; SQ.bound[sq] = 1; SQ.boundT[sq] = I.simT; }
        return;
      }
      if (I.simT - SQ.boundT[sq] > 6 + 4 * (1 - D.press)) {
        SQ.bound[sq] = SQ.bound[sq] === 1 ? 2 : 1; SQ.boundT[sq] = I.simT;
      }
      SQ.task[sq] = dTh < 45 ? TASK.assault : TASK.bound;
    }

    /* ============================================================ THE STEP */
    let sqCur = 0;
    I.step = function (dt) {
      const T0 = now();
      I.simT += dt;
      const n = I.nRows || 0;
      if (_stampA.length < n) _stampA = new I32(Math.max(n, 1024));
      if (gridAt < 0 || I.simT - gridAt >= 0.2) rebuild();
      // the squads, each once a second, staggered
      const t1 = now();
      if (SQ.n) {
        let k = Math.max(1, Math.ceil(SQ.n * dt));
        while (k-- > 0) { squadTick(sqCur); sqCur = (sqCur + 1) % SQ.n; }
      }
      const t2 = now(); I.ms.squad += t2 - t1;
      // the men's thinks on their clocks
      for (let r = 0; r < n; r++) {
        const l = G.life[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        if (I.simT >= G.thinkAt[r]) {
          const contact = I.simT - G.contactT[r] < 20;
          const step = contact ? 0.25 : 0.6;
          think(r, step);
          G.thinkAt[r] = I.simT + step * (0.9 + 0.2 * trait(r, (I.simT * 4) | 0));
        }
      }
      const t3 = now(); I.ms.think += t3 - t2;
      // the triggers
      for (let r = 0; r < n; r++) {
        if (G.life[r] !== LIFE.alive) continue;
        if (G.tgt[r] < 0 && G.reloadT[r] <= 0 && I.simT - G.lkT[r] > 10) continue;
        trigger(r, dt);
      }
      const t4 = now(); I.ms.fire += t4 - t3;
      moveAll(dt);
      resolveRounds();
      I.ms.total += now() - T0;
    };
    I.alive = alive; I.fighting = fighting;
    I.audit = function () {
      return { simT: I.simT, stats: I.stats, led: I.led, ms: I.ms, rounds: nR };
    };
    I.roundsInFlight = function () { return nR; };
    return I;
  }
  CBZ.battleInfantry = { create: create, DOCTRINE: DOCTRINE, TRN_IDS: TRN_IDS, EV: EV, POST: POST, LIFE: LIFE, MOVE: MOVE, SHOT_F: SHOT_F,
    EYE: EYE, MUZ: MUZ };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleInfantry;
})();
