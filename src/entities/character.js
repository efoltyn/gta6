/* ============================================================
   entities/character.js — blocky avatar + a layered PROCEDURAL
   animation rig, now with TWO-SEGMENT LIMBS (real elbows + knees).

     root (g)            ← world transform (position / facing / KO)
      ├─ ll, rl          ← leg pivots at the HIPS
      │    └─ low        ← KNEE pivot (shin + shoe cap live here)
      └─ body            ← hip-locked pelvis + upper body; bob / sway / lean
          ├─ pelvis, torso, collar
          ├─ la, ra      ← arm pivots at the SHOULDERS
          │    └─ low    ← ELBOW pivot (forearm + hand cap + hand socket)
          └─ neck → head ← head pivot for look / bob

   Joint conventions (facing +z):
     negative rotation.x on a hip/shoulder swings the limb FORWARD.
     KNEE only folds BACKWARD  → knee rotation.x >= 0.
     ELBOW only folds FORWARD  → elbow rotation.x <= 0.

   Compatibility contract kept for every other system:
     rig.parts.{ll,rl,la,ra}    = the TOP pivots (hip/shoulder), as before
     part.userData.main         = the UPPER segment mesh
     part.userData.cap          = the hand/shoe cap mesh
     part.userData.low          = the NEW joint pivot group
     part.userData.lower        = the NEW lower segment mesh
     rig.low.{ll,rl,la,ra}      = the joint pivots (same objects as .low)
     rig.sockets.*              = same objects as before (now parented at the
                                  real wrist inside the elbow group)
     rig.skinSlots.arms/legs    = STILL length-2 upper meshes (wounds.js
                                  indexes [0]/[1] and checks length===2)
     rig.skinSlots.armsLower/legsLower = the new lower meshes
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const mat = CBZ.mat, cmat = CBZ.cmat, boxGeom = CBZ.boxGeom;

  CBZ.CONFIG = CBZ.CONFIG || {};
  /* CHAR_SLEEP_POSE — a body in a bed used to be the STANDING rig rolled 90°
     about Z, i.e. the exact pose a KO'd corpse holds on the pavement: straight
     legs, standing-idle arms, chin level. Every bedroom in the game therefore
     contained a plank. On → `ch.lying` (city/propuse.js publishes it) runs a
     real sleep pose inside that same roll: knees drawn up, spine curled, one
     arm folded in, head settled, chest breathing. Flip false (or
     ?cfg_CHAR_SLEEP_POSE=0) and the branch never runs — the plank comes back,
     which is the one-line revert.
     CHAR_SEAT_POSTURE — a sofa, a throne, a bar stool and an office chair all
     produced ONE identical upright chair pose. On → the seat's own `kind`
     (carried through CBZ.propSeatRef as seatRef.kind) picks a posture family.
     Off → every seat gets today's single pose, byte-identical. */
  if (CBZ.CONFIG.CHAR_SLEEP_POSE == null) CBZ.CONFIG.CHAR_SLEEP_POSE = true;
  if (CBZ.CONFIG.CHAR_SEAT_POSTURE == null) CBZ.CONFIG.CHAR_SEAT_POSTURE = true;
  /* CHAR_PRONE_GUN_POSE — the prone arms. Off → the shipped -1.32/-1.40
     shoulders, which drive both arms (and the weapon) through the floor.
     CHAR_GUN_GROUND_REST — the held weapon's ground contact solve (below).
     Off → the weapon socket never moves and a gun may sit in the dirt.
     CHAR_HEAVY_CARRY — weapon-data.js `hold.heavy` blending in the low-ready
     and present poses. Off → every gun is carried identically, as before. */
  if (CBZ.CONFIG.CHAR_PRONE_GUN_POSE == null) CBZ.CONFIG.CHAR_PRONE_GUN_POSE = true;
  if (CBZ.CONFIG.CHAR_GUN_GROUND_REST == null) CBZ.CONFIG.CHAR_GUN_GROUND_REST = true;
  if (CBZ.CONFIG.CHAR_HEAVY_CARRY == null) CBZ.CONFIG.CHAR_HEAVY_CARRY = true;

  /* Two-segment limb. Pivot group at the hip/shoulder; upper box hangs to the
     joint; a `low` pivot group sits AT the joint with the lower box + cap
     inside it. The lower box's top is tucked 0.06 UP into the (wider) upper
     box so bending the joint never opens a gap — the overlap sweeps through
     the elbow/knee like a rounded joint filler.
       w,d      upper segment cross-section
       upperH   shoulder/hip → joint
       lowerH   joint → wrist/ankle
       capColor/capH: hand or shoe cap, strictly enclosing the lower end. */
  function limb(w, upperH, lowerH, d, color, capColor, capH, lowerColor) {
    const grp = new THREE.Group();
    const upper = new THREE.Mesh(boxGeom(w, upperH, d), cmat(color));
    upper.position.y = -upperH / 2;
    upper.castShadow = upper.receiveShadow = true;
    grp.add(upper);
    grp.userData.main = upper;

    const low = new THREE.Group();
    low.position.y = -(upperH - 0.02);          // joint pivot, tucked 2cm up
    grp.add(low);
    grp.userData.low = low;

    const lw = w * 0.9, ld = d * 0.9;           // lower tapers, nests in upper
    const overlap = 0.06;
    const lower = new THREE.Mesh(boxGeom(lw, lowerH + overlap, ld), cmat(lowerColor != null ? lowerColor : color));
    lower.position.y = (overlap - lowerH) / 2;  // top at +overlap, bottom at -lowerH
    lower.castShadow = lower.receiveShadow = true;
    low.add(lower);
    grp.userData.lower = lower;

    if (capColor != null) {
      // cap strictly encloses the lower end (see z-fight note in git history:
      // no co-planar faces with the trouser/sleeve box).
      const ch = capH || 0.22;
      const cap = new THREE.Mesh(boxGeom(lw * 1.06, ch + 0.03, ld * 1.38), cmat(capColor));
      cap.position.y = -lowerH - 0.03 + (ch + 0.03) / 2;
      cap.position.z = ld * 0.1;
      cap.castShadow = true;
      low.add(cap);
      grp.userData.cap = cap;
    }
    return grp;
  }

  // Whole-limb lengths preserved: arm 0.92 (+0.2 hand), leg 0.95 (+0.2 shoe).
  const ARM_UP = 0.46, ARM_LO = 0.46;
  const LEG_UP = 0.48, LEG_LO = 0.47;

  /* ============================================================
     BODY PROFILE — the ONE place a body's proportions live.

     Before this, every dimension in makeCharacter was a `fem ? a : b`
     ternary scattered through 200 lines of geometry, which is why the
     only two bodies this game could ever build were "man" and "slightly
     smaller man". A profile is a flat record of every authored number;
     makeCharacter now READS one instead of branching. Adding a body
     (child, toddler, a heavier build later) is a table row, not new
     geometry code, and all ~15 makeCharacter call sites get it for free.

     ADOPTION IS ONE FIELD: `makeCharacter({..., age: 7})`. Omit it and
     you get the adult profile for c.build, which is byte-identical to
     the pre-profile rig for "m" (every male number below is the literal
     that used to be inline). Degrade-safe: an unknown build/age clamps
     into the table, never throws.

     WHY WOMEN DIDN'T READ AS WOMEN (owner: "women look like men with
     different colours"). The old fem path scaled EVERY box down by the
     same ~0.85: shoulders 0.85x, hips 0.857x. Shoulder:hip therefore
     stayed 1.10 — a MALE ratio — so the silhouette was a small man.
     Real anthropometry (ANSUR II): female biacromial breadth is ~0.87x
     male, but bi-iliac/hip breadth is ~0.95x — hips barely shrink. Male
     shoulder:hip runs ~1.15-1.20, female ~0.95-1.05. Fixed below: the
     shoulders keep their 0.85, the hips come back OUT (pelvisW 0.72 ->
     0.80, depth 0.43 -> 0.46), and a real WAIST box (WHR ~0.7-0.8 in
     women vs ~0.85-0.95 in men) tapers between them. Chest/hip/waist,
     not size, is what reads female at 30m.

     CHILDREN ARE NOT SCALED ADULTS. The old child (births.js/family.js)
     was `group.scale.setScalar(0.62)` — a shrunken adult, wrong in every
     ratio. Real children carry a near-adult head on a short torso and
     much shorter legs: sitting-height/stature runs 0.63 at age 2 vs 0.52
     adult, so legs are ~37% of a toddler's height and ~48% of an adult's.
     GROWTH below encodes stature, head fraction, leg share, shoulder and
     hip growth per age; every segment is derived from it.
  ============================================================ */

  // Authored (pre-humanScale) height of the reference adult male rig:
  // neck socket 1.88 + head 0.60. Every stature number below is a
  // fraction of this, so the whole table stays unit-free.
  const ADULT_TOP = 2.48;
  const WAIST_TUCK = 0.06;      // waist box tucks UP into the chest box (limb-joint trick)
  // THE ONE Z-FIGHT CLEARANCE. Minimum distance between any two parallel faces
  // of this rig that overlap and are both visible — 0.01 authored is 7mm at
  // HUMAN_SCALE 0.70, which is the clearance the shipped adult-male rig already
  // held everywhere it did NOT z-fight. Published so city/clothes.js's jacket
  // shell measures against the same number instead of typing a second one.
  const YOKE_CLEAR = 0.01;
  // THE PRONE PLANK'S OWN ANGLES. Named because physics.js has to drop the rig
  // group by exactly the amount that puts this pose's LOWEST SURFACE on the
  // floor, and it cannot solve that against literals buried in animChar — a
  // sink and a pose that disagree is a body sunk into the terrain (owner: "the
  // player [goes] a tiny bit [under ground]"). One place, both consumers.
  const PRONE_PITCH = 1.42;       // torso hinge at the hips: chest to the deck
  const PRONE_LEG_PITCH = 1.49;   // legs sweep back level (±0.03 alternation)

  /* ---- THE PRONE ARMS, SOLVED AGAINST THE FLOOR --------------------------
     OWNER, 2026-08-03: "when player lies down, right now the gun goes
     UNDERGROUND. It's dumb physics. The gun should respect the ground too."

     The gun was the SYMPTOM; the arms were the bug, and it is arithmetic, not
     taste. A limb hangs along its own -Y, so after the shoulder's own pitch
     `a` and the torso's PRONE_PITCH the segment points, in world,
         (0, -cos(a + PRONE_PITCH), -sin(a + PRONE_PITCH)).
     The shipped pose used a = -1.32 / -1.40, i.e. a + PRONE_PITCH ≈ +0.1 rad,
     which is (0, -0.995, -0.10): BOTH ARMS DRIVEN VERTICALLY DOWNWARD through
     the deck. Measured on the shipped adult male, the weapon socket sat
     **0.446 m BELOW the floor** — no direction-only muzzle solve can rescue
     that, and holsterprops.js's one honestly rotated the barrel 80° at the sky
     trying to (measured: gun 0.83 m under the surface).

     So the angles are now read off the posture a prone shooter actually
     holds, and both are solved from ONE equation instead of typed:
     let φ = a + PRONE_PITCH be the segment's world pitch, so
         a = φ − PRONE_PITCH,   world dir = (0, −cos φ, −sin φ).
       · UPPER ARM: shoulder → elbow, 30° BELOW horizontal and forward, which
         is what puts the elbow ON the deck (φ = −60°, elbow lands 0.065 m over
         the floor on the shipped body — the plant you can see).
       · FOREARM, ARMED: elbow → hand, 48° ABOVE horizontal, which carries the
         weapon socket to ≈ 0.35 m over the floor. That number is not a taste
         either: the M249's belly (ammo box under the receiver, bipod feet) is
         0.267 m below its own barrel axis at the drawn scale, so anything less
         buries the box. Every other long gun's belly is shallower, so one
         posture covers the class.
       · FOREARM, UNARMED: flat forward on the deck (φ = −90°), because empty
         hands held up at gun height read as a mime.
     The elbow value is the same subtraction one level down: e = φ2 − a − PITCH.
     Nothing here is per-weapon; the last centimetres — this gun's belly, this
     slope — are the ground-rest solve's job (CBZ.charGunRestAudit). */
  const PRONE_ARM_PITCH = -2.467;      // φ = −60°: shoulder → elbow, elbow on the deck
  const PRONE_FORE_ARMED = -1.362;     // φ2 = −138°: elbow → hand, up to the gun
  const PRONE_FORE_EMPTY = -0.524;     // φ2 = −90°: forearm flat on the ground
  const PRONE_NECK_ARMED = -1.38;      // chin off the chest, eyes over the sights
  const PRONE_NECK_EMPTY = -1.05;      // the shipped head-down crawl

  /* HOW HEAVY THE THING IN THE HANDS IS. The number is the WEAPON's
     (weapon-data.js `hold`), published onto the rig by systems/fpsmode.js
     exactly like `aimLong`; the POSE built from it is this file's. Both read 0
     for anything that declares no `hold`, so every weapon shipped before this
     is posed byte-for-byte as it was. Kept as two one-line readers so the
     three pose branches that consume them cannot drift apart. */
  function heavyHold(ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_HEAVY_CARRY === false) return 0;
    const h = ch && ch.aimHeavy;
    return h > 0 ? (h > 1 ? 1 : h) : 0;
  }
  function heavySupport(ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_HEAVY_CARRY === false) return 0;
    const s = ch && ch.aimSupport;
    return s > 0 ? (s > 0.5 ? 0.5 : s) : 0;
  }

  // A gait style is a set of MULTIPLIERS on animChar's existing literals.
  // All 1 = the motion this game has always had; nothing here adds a new
  // animation state, so a rig with no style is bit-for-bit unchanged.
  function gaitStyle(o) {
    return {
      step: 1,        // stride length (smaller -> higher cadence for the same speed)
      hipAmp: 1,      // hip swing amplitude
      knee: 1,        // knee flexion amplitude
      stanceKnee: 0,  // ADDED stance-phase knee flexion (toddlers never straighten)
      armAmp: 1,      // arm counter-swing amplitude
      sway: 1,        // lateral body sway (pelvic obliquity)
      yaw: 1,         // shoulder counter-rotation
      bob: 1,         // vertical CoM bob
      guard: 0,       // 0..1 "high guard" toddler arms (raised + out to the sides)
      ...o,
    };
  }

  const GAIT_NEUTRAL = gaitStyle({});

  function profileBase() {
    return {
      key: "m", fem: false, child: false, ageYears: null, band: "adult",
      statureMul: 1,
      // segments
      legUp: LEG_UP, legLo: LEG_LO, legW: 0.34, hipX: 0.23, shoeH: 0.20,
      armUp: ARM_UP, armLo: ARM_LO, armW: 0.30, armX: 0.62, handH: 0.20,
      pelvisW: 0.84, pelvisH: 0.20, pelvisD: 0.48,
      torsoH: 0.95, torsoW: 0.92, torsoD: 0.50,
      waistShare: 0, waistW: 0, waistD: 0,   // waistShare 0 = no waist box at all
      collarW: 0.94, collarH: 0.18, collarD: 0.52,
      headSize: 0.60, neckDrop: 0,
      jacketW: 0.98, jacketH: 1.00, jacketD: 0.60,
      // posture
      stanceZ: 0,      // per-leg z-splay: + converges the knees (narrow step width), - splays (toddler wide base)
      // Idle arm carry, SIGNED: NEGATIVE tucks the hand in against the ribs
      // (the male default — and the literal this rig has always used);
      // POSITIVE swings it clear of the hip. See ADULT_F for why it's a cheat.
      armOutZ: -0.08,
      gait: GAIT_NEUTRAL,
    };
  }

  // ---- ADULT MALE: every number is the literal that used to be inline ----
  const ADULT_M = profileBase();

  // ---- ADULT FEMALE -----------------------------------------------------
  // Shoulders stay narrow (0.85x, as before). Hips come back out to ~0.95x
  // male so shoulder:hip lands at 0.975 (female band) instead of 1.10
  // (male band). A waist box at 0.85x the chest and 0.83x the hips carves
  // the taper. Chest box is DEEPER than male (0.46 vs the old 0.44) and
  // shorter, so the profile carries chest volume without a separate bust
  // mesh that painted clothing would immediately erase.
  const ADULT_F = Object.assign(profileBase(), {
    key: "f", fem: true,
    statureMul: 0.958,                       // ~1.74m beside the male 1.82m
    legUp: 0.465, legLo: 0.455, legW: 0.30, hipX: 0.27,
    armUp: 0.45, armLo: 0.45, armW: 0.26, armX: 0.54,
    pelvisW: 0.80, pelvisH: 0.20, pelvisD: 0.46,
    torsoH: 0.92, torsoW: 0.78, torsoD: 0.46,
    waistShare: 0.325, waistW: 0.66, waistD: 0.40,
    collarW: 0.80, collarH: 0.17, collarD: 0.46,
    headSize: 0.55,
    jacketW: 0.86, jacketH: 0.98, jacketD: 0.56,
    // Step width: male stance sits ~12-15% of hip breadth off the midline,
    // female ~4-8% — the "walks on one line" read (Cho 2004: women walk with a
    // significantly narrower step width). stanceZ converges the knees toward
    // that line.
    stanceZ: 0.055,
    // HONEST NOTE: the folk claim that women carry a wider elbow angle does NOT
    // survive the literature — studies disagree on the direction and one
    // measured men LARGER (14.2° vs 8.2°). This number is therefore a deliberate
    // ART CHEAT, not biomechanics: a wider hip needs the hands to hang clear of
    // it, and that gap between arm and body silhouette is what reads at 30m.
    armOutZ: 0.06,
    /* GAIT (Cho 2004, Clin Biomech 19(2):145-152, 98 adults; Bruening 2015,
       Gait & Posture 41(2)). What the data actually says, which is NOT the
       folklore: cadence is essentially the SAME between sexes at preferred
       speed — women take SHORTER STRIDES, and cadence simply falls out of
       speed/stride, which is exactly how gaitPhaseDelta already works, so
       `step` alone buys the correct quicker footfall. The genuinely
       sex-inherent differences are in the joint pattern: women carry more
       PELVIC obliquity while keeping a MORE STABLE torso and head, and men
       recruit the shoulders and arms more. So sway goes UP while yaw and arm
       swing go DOWN — the earlier guess had the upper body backwards. */
    gait: gaitStyle({ step: 0.86, hipAmp: 0.94, armAmp: 0.88, sway: 1.35, yaw: 0.82 }),
  });

  /* ---- GROWTH CURVE -----------------------------------------------------
     a   age in years
     h   stature as a fraction of the adult rig (CDC/WHO growth charts,
         normalised against a 175.7cm adult male)
     hf  head as a fraction of TOTAL height. NOTE this is not the real-world
         "heads tall" figure: this rig's adult head is already 24% of its
         height (a real adult's is 13%), i.e. the avatar is stylised
         big-headed to start with. Applying the real curve on top would
         make a bobblehead, so hf moves ~55% of the way toward the real
         relative change (real head fraction rises 1.50x from adult to
         toddler; here it rises 1.28x). Direction right, stylisation kept.
     ls  legs' share of (legs + torso), from sitting-height ratio by age
     sw  shoulder width vs adult   hw  hip width vs adult
     gw  limb girth vs adult       bl  belly depth multiplier (toddler pot belly)
     nk  neck development 0..1 (a toddler has no visible neck at all)
     st  step length as a fraction of leg length vs the adult ratio
  ------------------------------------------------------------------------ */
  const GROWTH = [
    { a: 0,    h: 0.30, hf: 0.400, ls: 0.300, sw: 0.32, hw: 0.36, gw: 0.60, bl: 1.35, nk: 0.00, st: 0.55 },
    { a: 1,    h: 0.43, hf: 0.345, ls: 0.365, sw: 0.37, hw: 0.41, gw: 0.66, bl: 1.30, nk: 0.05, st: 0.62 },
    { a: 2.5,  h: 0.53, hf: 0.309, ls: 0.418, sw: 0.45, hw: 0.50, gw: 0.70, bl: 1.24, nk: 0.15, st: 0.72 },
    { a: 4,    h: 0.60, hf: 0.292, ls: 0.440, sw: 0.52, hw: 0.56, gw: 0.73, bl: 1.14, nk: 0.35, st: 0.86 },
    { a: 7,    h: 0.683, hf: 0.275, ls: 0.472, sw: 0.60, hw: 0.62, gw: 0.78, bl: 1.05, nk: 0.62, st: 0.95 },
    { a: 10,   h: 0.780, hf: 0.264, ls: 0.487, sw: 0.68, hw: 0.71, gw: 0.84, bl: 1.00, nk: 0.82, st: 0.98 },
    { a: 12,   h: 0.848, hf: 0.257, ls: 0.498, sw: 0.75, hw: 0.78, gw: 0.88, bl: 1.00, nk: 0.90, st: 1.00 },
    { a: 15,   h: 0.950, hf: 0.250, ls: 0.500, sw: 0.90, hw: 0.90, gw: 0.95, bl: 1.00, nk: 0.97, st: 1.00 },
    { a: 18,   h: 1.000, hf: 0.242, ls: 0.500, sw: 1.00, hw: 1.00, gw: 1.00, bl: 1.00, nk: 1.00, st: 1.00 },
  ];
  const CHILD_ADULT_AGE = 18;

  function growthAt(age) {
    const a = age < 0 ? 0 : age;
    let i = 0;
    while (i < GROWTH.length - 1 && GROWTH[i + 1].a <= a) i++;
    const lo = GROWTH[i], hi = GROWTH[Math.min(i + 1, GROWTH.length - 1)];
    const span = hi.a - lo.a;
    const t = span > 0.0001 ? Math.min(1, Math.max(0, (a - lo.a) / span)) : 0;
    const out = {};
    for (const k in lo) out[k] = lo[k] + (hi[k] - lo[k]) * t;
    return out;
  }

  function bandOf(age) {
    if (age == null || age >= CHILD_ADULT_AGE) return "adult";
    if (age < 1.1) return "baby";
    if (age < 4) return "toddler";
    if (age < 10) return "child";
    if (age < 13) return "preteen";
    return "teen";
  }

  /* Build a child profile at `age`, optionally blended toward an adult
     female shape. Sexual dimorphism does not exist before puberty, so a
     6-year-old girl and boy share one body — the read comes from hair and
     dress, which is exactly how it works in life. From ~11 the female
     deltas (hips, waist, narrower shoulders, Q-angle, gait) fade in. */
  function childProfile(build, age) {
    const G = growthAt(age);
    const fem = build === "f";
    // female shape blends in across 11 -> 16
    const fb = fem ? Math.min(1, Math.max(0, (age - 11) / 5)) : 0;
    const mix = (m, f) => m + (f - m) * fb;

    const total = G.h * ADULT_TOP;
    const headSize = G.hf * total;
    const stack = total - headSize;                 // feet -> neck socket
    const legLen = G.ls * stack;
    const torsoTotal = stack - legLen;

    const p = profileBase();
    p.key = "c" + (Math.round(age * 10) / 10);
    p.child = true; p.fem = fem; p.ageYears = age; p.band = bandOf(age);
    p.statureMul = G.h;

    p.legUp = legLen * 0.505; p.legLo = legLen * 0.495;
    p.legW = mix(0.34, 0.30) * G.gw;
    p.hipX = mix(0.23, 0.27) * G.hw;
    p.shoeH = 0.20 * (0.55 + 0.45 * G.h);           // feet shrink slower than legs

    const armLen = mix(0.92, 0.90) * (0.40 + 0.60 * G.h) * (0.55 + 0.45 * G.ls / 0.5);
    p.armUp = armLen * 0.5; p.armLo = armLen * 0.5;
    p.armW = mix(0.30, 0.26) * G.gw;
    p.armX = mix(0.62, 0.54) * G.sw;
    p.handH = 0.20 * (0.60 + 0.40 * G.h);

    p.pelvisW = mix(0.84, 0.80) * G.hw;
    p.pelvisH = 0.20 * (0.45 + 0.55 * G.h);
    p.pelvisD = mix(0.48, 0.46) * G.hw * (0.85 + 0.15 * G.bl);

    p.torsoW = mix(0.92, 0.78) * G.sw;
    p.torsoD = mix(0.50, 0.46) * G.gw * (0.55 + 0.45 * G.bl);
    // Every child gets a waist box: on a toddler it is the pot belly (wider
    // and much deeper than the chest), on a pre-teen it is the beginning of
    // a real waist. Same two boxes either way — the numbers do the work.
    /* The waist box has to LAND on the adult it is growing into, or a 16-year-
       old boy keeps a pot belly (the child waist is authored WIDER than the
       chest — that is the toddler belly — and adult males have no waist box at
       all). So the childhood share fades into whichever adult this body is
       becoming across roughly 10 -> 18: zero for a man, 0.325 for a woman. */
    const childWaist = 0.30 + 0.14 * Math.max(0, Math.min(1, (5 - age) / 5));
    const adultWaist = fb * ADULT_F.waistShare;          // male adult carries none
    const grown = Math.max(0, Math.min(1, (age - 10) / 8));
    p.waistShare = childWaist + (adultWaist - childWaist) * grown;
    // torsoH is the WHOLE hip→neck column (chest + waist), exactly as it is for
    // the adults above; waistShare then splits it. Keeping one meaning for the
    // field is what lets makeCharacter run a single un-branched stacking pass.
    p.torsoH = torsoTotal;
    p.waistW = p.torsoW * mix(1.02, 0.86) * (0.90 + 0.10 * G.bl);
    p.waistD = p.torsoD * (0.86 + 0.30 * (G.bl - 1)) * mix(1.10, 0.92);

    p.collarW = mix(0.94, 0.80) * G.sw;
    p.collarH = 0.18 * (0.5 + 0.5 * G.h);
    p.collarD = mix(0.52, 0.46) * G.gw;

    p.headSize = headSize;
    // A young child has no neck: the head sits straight on the shoulders.
    p.neckDrop = headSize * 0.17 * (1 - G.nk);

    p.jacketW = p.torsoW + 0.06; p.jacketD = p.torsoD + 0.09;
    p.jacketH = torsoTotal * 1.05;

    // Toddlers walk with a wide base of support that narrows to an adult
    // line by ~3 yrs; the female knee-converge fades in with the hips.
    const splay = -0.13 * Math.max(0, Math.min(1, (3.2 - age) / 2.4));
    p.stanceZ = splay + 0.055 * fb;
    // Small children carry the arms visibly away from the body (the tail end of
    // the toddler high guard); gait.guard below owns the full raised pose.
    p.armOutZ = mix(-0.08, 0.06) + 0.16 * Math.max(0, Math.min(1, (4 - age) / 3));

    // GAIT (Sutherland 1980, "The Development of Mature Gait"): cadence runs
    // ~175 steps/min in a new walker vs ~115 adult, step length is only
    // ~30-35% of leg length at gait onset vs ~48% adult, new walkers never
    // extend the knee through stance, reciprocal arm swing does not appear
    // until ~18 months (before that the arms ride in "high guard"), and
    // trunk sway is pronounced and damps out over the first year of walking.
    // Gait is visually adult-like by ~4 and fully mature by ~7.
    const young = Math.max(0, Math.min(1, (4.5 - age) / 3.5));   // 1 at ~1yr, 0 by 4.5
    const legMul = (p.legUp + p.legLo) / (LEG_UP + LEG_LO);
    p.gait = gaitStyle({
      step: legMul * G.st,
      hipAmp: 1 - 0.18 * young,
      knee: 1 - 0.25 * young,
      stanceKnee: 0.22 * young,
      // fb terms track ADULT_F's corrected direction: as the female shape
      // fades in, arm swing and shoulder counter-rotation go DOWN and pelvic
      // sway goes UP (see the ADULT_F gait note).
      armAmp: (1 - 0.62 * young) * (1 - 0.12 * fb),
      sway: 1 + 0.55 * young + 0.35 * fb,
      yaw: (1 - 0.5 * young) * (1 - 0.18 * fb),
      bob: 1 + 0.25 * young,
      guard: Math.max(0, Math.min(1, (2.0 - age) / 1.2)),
    });
    return p;
  }

  const profileCache = Object.create(null);
  // CBZ.charProfile(build, age) — the public read. Cached: the crowd asks
  // this per body, and a profile is pure data derived from two numbers.
  function charProfile(build, age) {
    const b = build === "f" ? "f" : "m";
    let a = (age == null || !isFinite(age)) ? null : +age;
    if (a != null) {
      a = Math.max(0, Math.min(40, a));
      if (a >= CHILD_ADULT_AGE) a = null;
      else a = Math.round(a * 4) / 4;              // quantised: 160 possible child bodies, not infinite
    }
    const key = b + "|" + (a == null ? "A" : a);
    let p = profileCache[key];
    if (p) return p;
    p = a == null ? (b === "f" ? ADULT_F : ADULT_M) : childProfile(b, a);
    profileCache[key] = p;
    return p;
  }

  /* ---- HAIR SHELL -------------------------------------------------------
     OWNER BUG: "the back-of-head hair reads as two separate blocks."
     It did, and no amount of tucking two boxes together fixes it, because
     the old rig showed hair-lid / BARE SKIN / hair-plank stacked down the
     back of the skull from any 3/4-rear angle — the gap was the sides of
     the head, not the seam. Low-poly practice (and every stylised asset
     pack) models hair as ONE continuous shell spanning crown -> nape ->
     tail, never a skull cap plus a floating tail.

     So hair is now literally one mesh: the boxes are merged into a single
     cached BufferGeometry per (style, head size). Draw calls go DOWN — a
     long-haired woman was 2 meshes and is now 1 — and the seam cannot
     exist because there is no seam.

     The nape/lower-back-of-skull volume is the highest-leverage female cue
     at gameplay distance: it reads from front, side AND behind, unlike a
     fringe or hairline which only reads face-on. That is why every style
     below is defined by how far its mass hangs BELOW the crown line. */
  const HAIR_STYLES = {
    buzz:  { crownH: 0.13, backH: 0.24, sideW: 0.05, sideH: 0.18, tail: 0, bun: 0 },
    short: { crownH: 0.21, backH: 0.34, sideW: 0.09, sideH: 0.25, tail: 0, bun: 0 },
    crop:  { crownH: 0.24, backH: 0.30, sideW: 0.08, sideH: 0.21, tail: 0, bun: 0 },
    bob:   { crownH: 0.22, backH: 0.60, sideW: 0.11, sideH: 0.54, tail: 0, bun: 0 },
    long:  { crownH: 0.22, backH: 0.98, sideW: 0.115, sideH: 0.66, tail: 0, bun: 0 },
    pony:  { crownH: 0.21, backH: 0.34, sideW: 0.085, sideH: 0.26, tail: 0.62, bun: 0 },
    bun:   { crownH: 0.21, backH: 0.30, sideW: 0.085, sideH: 0.24, tail: 0, bun: 1 },
    pigtail: { crownH: 0.21, backH: 0.36, sideW: 0.13, sideH: 0.46, tail: 0, bun: 0 },
  };
  const hairGeoCache = Object.create(null);

  /* TEMPLE TAPER (owner: "everyone has too much hair on left and right side of
     their head"). MEASURED CAUSE, not a guess: the side pieces were authored as
     OUTBOARD SLABS rather than as a layer lying on the skull. Their inner face
     sat at S/2 - 0.02k — i.e. ON the skull surface — so the whole declared
     `sideW` hung OUTSIDE the head. On the adult male (S=0.60, k=1, HUMAN_SCALE
     0.70) that put the hair 0.070 rig units proud of the skull per side for
     `short` and 0.095 for `long` — 4.9 cm and 6.7 cm of REAL hair standing off
     each ear — while the crown directly above it was only (S+0.04)/2, i.e.
     0.020 proud (1.4 cm). The silhouette therefore flared to 3.5-5.5x the
     crown's thickness at exactly ear height, which is the "too much hair on the
     sides" read. Two lesser faults compounded it: the slab was a CONSTANT-width
     box from temple to jaw (no taper in toward the ears) and its front face
     reached z=+0.18, only 0.12 behind the face plane, so it covered the temples
     instead of sitting above and behind them.

     The fix keeps every style's identity (crown / back / occipital / tail / bun
     are untouched, so the table above still drives the read) and changes only
     how the SIDE is built:
       1. it is a skull-hugging layer — inner face BURIED at S/2 - 0.062k, so no
          skin gap can open at any angle, outer face only `sideT` proud;
       2. `sideT` is capped into the same family as the crown: buzz 0.017k,
          short 0.031k, bob 0.035k, long 0.036k, pigtail 0.038k (1.2 - 2.7 cm
          real) instead of a flat 0.05-0.13k;
       3. the outboard offset TAPERS to 0.58 at the panel's bottom, so the hair
          narrows in toward the ear instead of running straight down;
       4. the panel is pulled BACK (depth 0.72 -> 0.64 of hd, centre -0.05 ->
          -0.085k) so the hairline starts behind the temple.
     Head+hair width falls 10.6% (short) / 15% (long) / 17% (pigtail).
     CHAR_HAIR_TEMPLE=false restores the old slabs byte-for-byte. */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CHAR_HAIR_TEMPLE == null) CBZ.CONFIG.CHAR_HAIR_TEMPLE = true;
  function templeTaper() { return CBZ.CONFIG.CHAR_HAIR_TEMPLE !== false; }

  function hairGeometry(styleId, S) {
    const st = HAIR_STYLES[styleId] || HAIR_STYLES.short;
    const taper = templeTaper();
    const key = styleId + "|" + S.toFixed(3) + (taper ? "|t" : "");
    const hit = hairGeoCache[key];
    if (hit) return hit;
    const k = S / 0.60;                       // every offset scales with the head
    const hw = S + 0.04, hd = S + 0.04;
    const crownH = st.crownH * k, backH = st.backH * k, sideH = st.sideH * k;
    const sideW = st.sideW * k;
    const crownTop = S + 0.06 * k;            // sits proud of the skull crown
    const crownBot = crownTop - crownH;
    const shellTop = crownBot + 0.07 * k;     // everything else tucks UP into the crown
    const parts = [];
    const put = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      parts.push(g);
    };
    /* One side panel, sculpted (r128: write geometry.attributes.position, then
       computeVertexNormals — there is no .vertices[] on a BufferGeometry).
       `sign` is +1 starboard / -1 port. The box spans from a face BURIED inside
       the skull out to `outer`, and every vertex's OUTBOARD component is scaled
       by a factor that falls with height — that is the taper toward the ear.
       The outboard direction is measured WITH the sign rather than building one
       panel and mirroring it: a negative scale would reverse the triangle
       winding and render the port side inside-out under FrontSide culling. */
    const sidePanel = (sign, inner, outer, yTop, yBot, zc, dz, botMul) => {
      const w = outer - inner, h = yTop - yBot;
      const g = new THREE.BoxGeometry(w, h, dz, 1, 3, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + h / 2) / h;               // 0 at the bottom, 1 at the top
        const f = botMul + (1 - botMul) * t;
        const out = sign > 0 ? pos.getX(i) + w / 2 : w / 2 - pos.getX(i);
        pos.setX(i, sign > 0 ? out * f - w / 2 : w / 2 - out * f);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.translate(sign * (inner + w / 2), (yTop + yBot) / 2, zc);
      parts.push(g);
    };
    // crown: pulled back off the brow so a hairline reads instead of a helmet
    put(hw, crownH, hd * 0.92, 0, (crownTop + crownBot) / 2, -0.03 * k);
    // back of the skull down to the nape (and past it, for long styles)
    put(hw * 0.97, backH, 0.17 * k, 0, shellTop - backH / 2, -(S / 2 + 0.025 * k));
    // OCCIPITAL WEDGE. A shell that wraps the skull as a smooth even layer is
    // exactly what reads as a HELMET — the tell is the perfectly round rear
    // silhouette. Real hair carries extra mass over the occipital bone, so one
    // short proud block at the back-upper skull breaks that circle. It is the
    // cheapest single fix for helmet-head and it costs nothing (same merge).
    // Offset so its rear face stands a clear ~0.03 PROUD of the back panel: a
    // 5mm bulge is invisible at 30m and close enough to shimmer against the
    // panel's parallel face, while its front stays buried inside the panel so
    // no seam can open between them.
    put(hw * 0.80, crownH * 0.85, 0.11 * k, 0, crownBot + 0.01 * k, -(S / 2 + 0.085 * k));
    // sides: temple -> ear -> jaw. THIS is what closes the old skin gap — and
    // it closes it from INSIDE the skull now, not by hanging a slab off it.
    if (taper) {
      // proud of the skull: same family as the crown's 0.020k, ordered by style
      const sideT = Math.min(st.sideW * 0.34, 0.020 + st.sideW * 0.14) * k;
      const inner = S / 2 - 0.062 * k;        // buried well inside — no skin can show through
      const outer = S / 2 + sideT;
      for (const sgn of [-1, 1]) {
        sidePanel(sgn, inner, outer, shellTop, shellTop - sideH, -0.085 * k, hd * 0.64, 0.58);
      }
    } else {
      const sx = S / 2 + sideW / 2 - 0.02 * k;
      put(sideW, sideH, hd * 0.72, -sx, shellTop - sideH / 2, -0.05 * k);
      put(sideW, sideH, hd * 0.72, sx, shellTop - sideH / 2, -0.05 * k);
    }
    if (st.tail) {
      const tH = st.tail * k;
      put(0.17 * k, tH, 0.17 * k, 0, shellTop - 0.05 * k - tH / 2, -(S / 2 + 0.15 * k));
    }
    if (st.bun) put(0.26 * k, 0.24 * k, 0.26 * k, 0, crownTop - 0.02 * k, -(S / 2 + 0.02 * k));
    if (styleId === "pigtail") {
      // Pigtails legitimately stand off the head — that is what a pigtail IS —
      // but they were compounding a slab that was already too wide. Pulled in
      // with the sides so the pair reads as bunched hair, not as ear muffs.
      const tH = 0.34 * k, pw = taper ? 0.115 : 0.14, px = taper ? 0.052 : 0.08;
      put(pw * k, tH, pw * k, -(S / 2 + px * k), shellTop - 0.24 * k - tH / 2, -0.06 * k);
      put(pw * k, tH, pw * k, (S / 2 + px * k), shellTop - 0.24 * k - tH / 2, -0.06 * k);
    }
    let geo;
    const U = THREE.BufferGeometryUtils;
    if (U && U.mergeBufferGeometries && parts.length > 1) {
      geo = U.mergeBufferGeometries(parts, false);
      for (let i = 0; i < parts.length; i++) parts[i].dispose();
    }
    if (!geo) geo = parts[0];                 // degrade-safe: no merge util -> the crown alone
    geo._shared = true;
    hairGeoCache[key] = geo;
    return geo;
  }

  /* Pick a style. NO RNG LIVES HERE — this file has no seeded stream in scope
     (the Math.random below is runtime-only gait desync, never appearance), and
     appearance must stay byte-identical per seed for multiplayer. So the roll
     stays the caller's (peds.js rolls it seeded) and this is a pure function of
     what the caller asked for plus the body it is building.

     `c.hairStyle` is the new explicit control. `c.longHair` is the LEGACY
     boolean and still works untouched, which is why every existing call site
     (player.js, peds.js, entities/crowd.js) keeps behaving without an edit. */
  function hairStyleFor(c, P) {
    if (c.hairStyle && HAIR_STYLES[c.hairStyle]) return c.hairStyle;
    if (c.bald) return "buzz";
    if (P.band === "baby") return "buzz";                  // wispy, barely there
    // Before puberty a boy and a girl share one body — the read comes from hair
    // and dress, exactly as it does in life. So childhood is where hair carries
    // the MOST signal, not the least.
    if (P.child) return P.fem ? (c.longHair ? "pigtail" : "bob") : "crop";
    if (P.fem) return c.longHair ? "long" : "bob";
    return "short";
  }

  function makeCharacter(c) {
    const g = new THREE.Group();
    // Keep the world/physics root at scale 1: ragdoll, KO, child rigs and mode
    // reset code legitimately animate `group.scale`. The authored voxel model
    // lives under a stable metre conversion node, so those systems compose with
    // the 1.82m body instead of accidentally erasing the conversion.
    const model = new THREE.Group();
    // HUMAN-RATIO PASS (owner: "make ratios right to human size"). The authored
    // voxel rig is ~2.60u tall; render it at HUMAN_SCALE so an adult stands
    // ~1.82m beside the real-scaled cars/aircraft (audit: player was 4.65u, TALLER
    // than the parked fighter jet). One-line revert: CBZ.CONFIG.CHAR_SCALE_REAL=false
    // restores the legacy 2.60u rig. The eye/camera/aim/hit/mount constants are
    // co-tuned for the ON path (fpsmode eye 1.65, camera pivot 1.7, hit HEAD_Y 1.50,
    // combat aim ~1.5–1.8) — a full revert flips them back too; see the report.
    const charReal = !CBZ.CONFIG || CBZ.CONFIG.CHAR_SCALE_REAL !== false;
    const humanScale = !charReal ? 1.0 : ((CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70);
    model.name = "character-model";
    model.userData.characterModel = true;
    g.userData.humanScale = humanScale;
    /* ---- A BODY IS NOT SCENERY (owner, 2026-07-29) -------------------------
       "there's some weird NPCs that have no outfit, and it's like invisible
       where the outfit should be."

       This one missing tag is how a person loses their clothes. TWO shared
       build-time passes walk the city root and treat everything under it as
       static: core/batch.js's `batchStaticUnder` (merges eligible meshes into
       one buffer and REMOVES the originals from the graph) and
       core/staticfreeze.js's `freezeStaticUnder` (flips matrixAutoUpdate off).
       Both skip a subtree on exactly one condition — `userData.dynamic` —
       and city/mode.js:518-522 runs the pair over `A.root`.

       Its comment claims the pass happens "BEFORE spawnCityPeds/Traffic add
       dynamic rigs to it", and for the ambient crowd that is true. It is NOT
       true for the world builders: biome_forest / biome_farmland / biome_desert
       / biome_snow / marina / bunkers / island_military / island_airport all
       call cityMakePed DURING build(), and peds.js parents every one of them
       to A.root. The ANIMALS already knew — wildlife.js:229 says in so many
       words "BEFORE city/mode.js runs CBZ.batchStaticUnder + CBZ.freezeStaticUnder"
       and tags itself; dogs.js:162 does the same and calls the alternative
       "the statue bug". The file that builds every HUMAN never did.

       What the batcher then takes is decided by userData, and that is why the
       damage looks like clothes: batch.js:429 spares any mesh carrying userData,
       and the limb segments carry clothDims/clothBand from tagCloth below — so
       SLEEVES AND TROUSERS SURVIVE while the untagged chest (an adult male has
       no waist box, so nothing tags his torso), the shoulder yoke and the pelvis
       are merged away at their build-time transform and never draw on the body
       again. A DRESSED mesh carries _cbzFlat and is spared too, so the exposure
       is precisely the PLAIN civilian — the shipping default.

       And it is invisible to the obvious check: a merged-away mesh is still in
       skinSlots, still `visible === true`, still holding a valid material. The
       only tell is that its `.parent` is gone, which is what
       CBZ.cityClothMeshRenders (city/clothes.js) now tests.

       A character animates every frame; there has never been a case where
       baking or freezing one was correct. Revert: CHAR_RIG_DYNAMIC = false. */
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_RIG_DYNAMIC == null) CBZ.CONFIG.CHAR_RIG_DYNAMIC = true;
    if (!CBZ.CONFIG || CBZ.CONFIG.CHAR_RIG_DYNAMIC !== false) g.userData.dynamic = true;
    g.add(model);

    // ---- BODY PROFILE (c.build: "m" default | "f"; c.age: years | null) ----
    // ONE table read replaces the ~20 `fem ? a : b` ternaries that used to be
    // smeared through this function — the reason the only two bodies this rig
    // could ever build were "man" and "slightly smaller man". Every dimension
    // below now comes from the profile record and NOTHING here branches on sex
    // or age again. ADULT_M holds the exact literals this rig has always used,
    // so the untouched default path (c.build undefined/"m", no c.age) is
    // byte-identical to before this change: same widths, same offsets, same
    // leg height. Adding a body is a row in GROWTH, not new geometry code.
    const P = charProfile(c.build, c.age);
    // Stamped on the ROOT so any system holding only an Object3D can ask what
    // it is looking at — systems/childsafe.js reads exactly these to keep
    // children out of weapons, gore and the kill feed.
    g.userData.charBand = P.band;
    g.userData.charAge = P.ageYears;
    g.userData.charChild = !!P.child;
    const metric = {
      height: 2.60 * P.statureMul * humanScale,
      width: (P.armX * 2 + P.armW) * humanScale,
      depth: (Math.max(P.torsoD, P.pelvisD) + 0.20) * humanScale,
    };
    g.userData.characterMetric = metric;

    // ---- legs (children of root: feet stay planted) ----
    // The hip pivot is wherever the legs actually END. It used to be the
    // constant 0.95, which is precisely why a child could only ever be a
    // shrunken adult: short legs had nowhere to put the hips. Everything above
    // is stacked off this, so a toddler's hips sit at a toddler's height.
    const hipY = P.legUp + P.legLo;
    const ll = limb(P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shoes, P.shoeH);
    const rl = limb(P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shoes, P.shoeH);
    ll.position.set(-P.hipX, hipY, 0); rl.position.set(P.hipX, hipY, 0);
    // STEP WIDTH, from frame zero. animChar damps this channel toward the same
    // value every frame, but a rig that never animates (the charpanel portrait,
    // a paused cinematic) would otherwise stand in a stance it never had.
    ll.rotation.z = P.stanceZ; rl.rotation.z = -P.stanceZ;
    model.add(ll, rl);

    // ---- hip-locked body (pelvis and everything above it) ----------------
    const body = new THREE.Group();
    body.position.y = 0; // bob/sway/lean applied here
    model.add(body);

    // A shallow pelvis overlaps both leg caps and the bottom of the torso. It
    // MUST live on `body`, not beside it on `model`: walking rotates and bobs
    // body around the hip socket. A model-level pelvis stays still, so its
    // horizontal top-back corner repeatedly crosses the animated lower-back
    // face and appears as a flickering pants-coloured shelf through the back.
    // Sharing the hip-locked transform makes that overlap rigid while the
    // existing lower tuck continues to cover the independently swinging legs.
    const pelvis = new THREE.Mesh(boxGeom(P.pelvisW, P.pelvisH, P.pelvisD), cmat(c.legs));
    pelvis.position.set(0, hipY + 0.03, 0); pelvis.castShadow = pelvis.receiveShadow = true;
    body.add(pelvis);

    // Stature is BAKED INTO THE SEGMENTS now (a female rig is shorter because
    // her femur and torso boxes are shorter, a toddler because all of them
    // are), so this node does nothing but the metre conversion. The old
    // non-uniform `scale.y * 0.97` fem squash is gone: squashing a body is what
    // made women read as compressed men rather than differently proportioned.
    model.scale.setScalar(humanScale);

    // ---- torso column: chest, plus an optional WAIST box ----------------
    // base sits a whisker below the hip pivot so the column overlaps the pelvis
    // and no sub-frame gap can open. neckY then FALLS OUT of the stack instead
    // of being an adult constant — this single line is what lets a short child
    // torso put the shoulders where they anatomically belong.
    const base = hipY - 0.005;
    const neckY = base + P.torsoH - 0.015;
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    const chestBot = base + waistH;
    const chestH = P.torsoH - waistH;
    const torso = new THREE.Mesh(boxGeom(P.torsoW, chestH, P.torsoD), cmat(c.torso));
    torso.position.y = chestBot + chestH / 2;
    torso.castShadow = torso.receiveShadow = true;
    body.add(torso);
    // THE WAIST is the highest-value cheap female cue at gameplay distance.
    // Shoulder:hip alone still reads "small man" until something carves the
    // taper between them (WHR ~0.7-0.8 female vs ~0.85-0.95 male). The SAME box
    // is the toddler's pot belly — there it is WIDER and DEEPER than the chest
    // instead of narrower. Two boxes either way; the profile numbers do all the
    // work, which is the whole point of the table.
    let waist = null;
    if (waistH > 0) {
      waist = new THREE.Mesh(boxGeom(P.waistW, waistH + WAIST_TUCK, P.waistD), cmat(c.torso));
      // The top tucks UP into the chest box (the same overlap trick the limb
      // joints use), so leaning or a hit reaction can never open a seam.
      waist.position.y = base + (waistH + WAIST_TUCK) / 2;
      waist.castShadow = waist.receiveShadow = true;
      body.add(waist);
    }
    /* ---- the SHOULDER YOKE (rig.skinSlots.collar) -------------------------
       OWNER BUG: "security guards and my player sometimes have what looks like
       a WHITE NECK ROLL — it disrupts outfits and FLICKERS, meaning it must be
       overlapping." It does overlap, and the flicker is ARITHMETIC, not taste:
       collarW/collarD were authored in the profile table against NOTHING, and
       on shipped bodies they came out EXACTLY equal to a plane they sit on.
         • ADULT_F  collarD 0.46 == torsoD 0.46 — the yoke's front AND back
           faces share a plane with the chest's over the whole 0.145 they
           overlap. BOTH are front-facing and BOTH are visible, which is a
           guaranteed z-fight stipple across the upper chest, drawn in the
           yoke's flat colour (outfits.js's `security` is 0xe8e8e8 — a near-
           white band). Every child body from ~15 up lands on it too.
         • ADULT_M  collarW/2 0.47 == armX - armW/2 0.47 — the yoke butts the
           arm sockets on exactly their inner plane.
       So the box is no longer authored against nothing: it is CLAMPED into the
       gaps it actually bridges. PROUD of the chest and BURIED into each arm
       socket by a minimum YOKE_CLEAR per face — the 0.01-0.03 clearance family
       the belt block below already uses, and the same overlap trick limb()
       uses at the elbow and the pelvis uses over the leg caps, so no seam can
       open when gait, lean and a hit reaction blend on one frame. Coplanarity
       is now impossible BY CONSTRUCTION instead of by luck, for every body the
       table can build. ADULT_M's depth is unchanged (0.50 + 2x0.01 IS the
       authored 0.52); its width grows 0.02, every millimetre of it inside the
       arm socket where nothing can see it.
       One-line revert: CBZ.CONFIG.CHAR_YOKE_CLEAR = false. */
    const yokeClear = !CBZ.CONFIG || CBZ.CONFIG.CHAR_YOKE_CLEAR !== false;
    // clear the plane, whichever side of it you are on — a face that is BURIED
    // is as safe as a face that is PROUD, and only a face that is ON it fights.
    const clearOf = (v, plane) => (Math.abs(v - plane) < 2 * YOKE_CLEAR ? plane + 2 * YOKE_CLEAR : v);
    let collarD = P.collarD, collarW = P.collarW;
    if (yokeClear) {
      collarD = Math.max(collarD, P.torsoD + 2 * YOKE_CLEAR);
      collarW = Math.max(collarW, (P.armX - P.armW / 2 + YOKE_CLEAR) * 2);
      // …and the HEAD sits IN the yoke on a young body (neckDrop sinks it), so
      // its faces are a plane the yoke can land on too: at age ~2.5 the clamps
      // above put the yoke's depth within 0.8mm of the skull's.
      collarD = clearOf(collarD, P.headSize);
      collarW = clearOf(collarW, P.headSize);
    }
    const collar = new THREE.Mesh(boxGeom(collarW, P.collarH, collarD), cmat(c.collar || c.torso));
    collar.position.y = neckY - 0.04;
    body.add(collar);

    // short-sleeve opt-in: the forearm reads as bare skin (peds.js tees).
    const shoulderY = neckY - 0.04;
    const la = limb(P.armW, P.armUp, P.armLo, P.armW, c.arms, c.skin, P.handH, c.shortSleeve ? c.skin : null);
    const ra = limb(P.armW, P.armUp, P.armLo, P.armW, c.arms, c.skin, P.handH, c.shortSleeve ? c.skin : null);
    // The chase camera sees the old +X "right" socket on the player's visible
    // left flank. Mirror the arm roots so the semantic right hand — and every
    // weapon attached to it — is actually on the player's right in third person.
    la.position.set(P.armX, shoulderY, 0); ra.position.set(-P.armX, shoulderY, 0);
    la.rotation.z = P.armOutZ; ra.rotation.z = -P.armOutZ;   // idle carry, frame zero
    body.add(la, ra);
    const leftHand = new THREE.Group();
    const rightHand = new THREE.Group();
    // wrist, in the ELBOW group's frame (the upper segment is spent above it)
    leftHand.position.set(0, -P.armLo - 0.01, 0.035);
    rightHand.position.set(0, -P.armLo - 0.01, 0.035);
    leftHand.userData.isSocket = rightHand.userData.isSocket = true;
    la.userData.low.add(leftHand); ra.userData.low.add(rightHand);
    const thirdPersonWeapon = new THREE.Group();
    thirdPersonWeapon.position.set(0.02, -0.03, 0.06);
    thirdPersonWeapon.userData.isSocket = true;
    rightHand.add(thirdPersonWeapon);

    // neck pivot so the head can turn/tilt independently. neckDrop sinks the
    // head toward the shoulders for the young: a toddler has no visible neck at
    // all, and that "head sitting straight on the shoulders" read is half of
    // what makes a small body look like a CHILD instead of a distant adult.
    const neck = new THREE.Group();
    neck.position.y = neckY - P.neckDrop;
    // head keeps a FRESH (unshared) material — systems/reactions.js flashes
    // its emissive per-actor on hits, so it must not be a shared cache entry.
    const headSize = P.headSize;
    const head = new THREE.Mesh(boxGeom(headSize, headSize, headSize), mat(c.skin));
    head.position.y = headSize / 2; head.castShadow = true;
    neck.add(head);
    // FACE READS AT RANGE: slightly bigger, darker, prouder features so a face
    // is legible at 20-40u (street distance), not just in a close-up. Deeper
    // boxes wrap back into the head so the features hold up at oblique angles
    // instead of vanishing edge-on.
    //
    // FACE SCALE NODE: systems/facial.js owns eye x/y and mouth y at runtime and
    // writes them as ABSOLUTE numbers tuned for the 0.60 adult head — it would
    // stamp adult-spaced eyes onto a toddler's small skull every frame. Parenting
    // the features to a group scaled by headSize/0.60 means those writes land in
    // a frame that shrinks WITH the head, so every face is correct and facial.js
    // never has to learn that children exist. At adult size the factor is 1 and
    // every literal below is the one that was here before.
    const face = new THREE.Group();
    face.scale.setScalar(headSize / 0.60);
    neck.add(face);
    const faceZ = 0.315;                       // 0.60/2 + the 0.015 protrusion
    const eyeMat = cmat(0x101010);
    const le = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    const re = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    le.position.set(-0.14, 0.34, faceZ); re.position.set(0.14, 0.34, faceZ);
    // a brow line + a small mouth for expression (animated by systems/facial.js)
    const brow = new THREE.Mesh(boxGeom(0.46, 0.06, 0.06), cmat(0x1c150e));
    brow.position.set(0, 0.46, faceZ);
    const mouth = new THREE.Mesh(boxGeom(0.22, 0.06, 0.06), cmat(0x4a2528));
    mouth.position.set(0, 0.16, faceZ);
    face.add(le, re, brow, mouth);
    body.add(neck);

    // ---- accessories (all on the body so they move with it) ----
    if (c.stripes) for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(boxGeom(0.94, 0.12, 0.52), cmat(c.stripes));
      s.position.y = 1.18 + i * 0.28; body.add(s);
      (body.userData.stripes || (body.userData.stripes = [])).push(s);
    }
    const beltParts = [], badgeParts = [], capParts = [], hairParts = [];
    // BELTS ARE PAINTED, NOT GEOMETRY (owner). With CHAR_BELT_PAINTED on
    // (default) the geometric band+buckle is skipped entirely — no hidden
    // meshes, beltParts stays empty (so every skinSlots.belt recolor call site
    // safely no-ops) — and the belt read comes from the painted garment
    // textures in city/clothes.js. Flip CHAR_BELT_PAINTED false to rebuild the
    // geometric belt: CHAR_BELT_V2 then chooses the build-aware band (default)
    // or the legacy fixed band, exactly as before.
    if (c.belt && CBZ.CONFIG.CHAR_BELT_PAINTED === false) {
      if (CBZ.CONFIG.CHAR_BELT_V2 !== false) {
        // Build-aware waist band straddling the torso→pelvis seam, so it is
        // sized off BOTH boxes of the CURRENT build: a hair NARROWER than the
        // shirt (torso W 0.92/0.78) so it tucks in instead of shelving past the
        // silhouette, and PROUD of the hips (pelvis W 0.84/0.72, D 0.48/0.43) so
        // it hugs the waist. Every offset is 0.01–0.03 — nothing coplanar with
        // the torso/pelvis faces it overlaps (TBDR z-fight guard) — and the band
        // follows the collar/stripe grammar (H 0.14) instead of a fat 0.16 slab.
        // The old fixed 0.96 band ignored `fem` entirely (see CHAR_BELT_V2).
        // Sized off the CURRENT build's boxes: a hair narrower than the shirt so
        // it tucks in, proud of the hips so it hugs. Profile-driven now, so a
        // child's belt is a child's belt instead of a hula hoop.
        const beltW = (waist ? P.waistW : P.torsoW) * 0.98;
        const beltD = (waist ? P.waistD : P.torsoD) * 1.04;
        const beltY = base + Math.max(0.06, waistH * 0.45);
        const belt = new THREE.Mesh(boxGeom(beltW, 0.14 * P.statureMul, beltD), cmat(c.belt));
        belt.position.y = beltY; body.add(belt); beltParts.push(belt);
        // Buckle plate: shorter than the band (H 0.10, seated within it) and
        // straddling the band's front face (beltD/2 → half its depth buried in
        // the band, half proud) so it reads raised and never floats off.
        // Derived from the band, not from sex — the last `fem ?` in this
        // function is gone, which was the whole point of the profile table.
        const buckle = new THREE.Mesh(boxGeom(beltW * 0.20, 0.10, 0.06), cmat(0xffd451));
        buckle.position.set(0, beltY, beltD / 2); body.add(buckle); beltParts.push(buckle);
      } else {
        const belt = new THREE.Mesh(boxGeom(0.96, 0.16, 0.54), cmat(c.belt));
        belt.position.y = 1.02; body.add(belt); beltParts.push(belt);
        const buckle = new THREE.Mesh(boxGeom(0.18, 0.16, 0.06), cmat(0xffd451));
        buckle.position.set(0, 1.02, 0.29); body.add(buckle); beltParts.push(buckle);
      }
    }
    if (c.badge) {
      const badge = new THREE.Mesh(boxGeom(0.16, 0.16, 0.05), cmat(0xffd451));
      badge.position.set(-0.28, chestBot + chestH * 0.64, P.torsoD / 2 + 0.02);
      body.add(badge); badgeParts.push(badge);
    }
    if (c.cap) {
      const ck = headSize / 0.60;
      const cap = new THREE.Mesh(boxGeom(0.66 * ck, 0.22 * ck, 0.66 * ck), cmat(c.cap));
      cap.position.y = headSize + 0.07 * ck; neck.add(cap); capParts.push(cap);
      const brim = new THREE.Mesh(boxGeom(0.66 * ck, 0.1 * ck, 0.3 * ck), cmat(c.cap));
      brim.position.set(0, headSize - 0.02 * ck, 0.42 * ck); neck.add(brim); capParts.push(brim);
    } else {
      // ONE MERGED SHELL — see the HAIR SHELL block above for the owner bug and
      // why a skull-cap-plus-back-plank can never be fixed by tucking. The
      // boxes are merged into a single cached BufferGeometry, so the seam
      // cannot exist (there is no seam) and a long-haired woman now costs ONE
      // draw call where she used to cost two.
      const styleId = hairStyleFor(c, P);
      const hairMesh = new THREE.Mesh(hairGeometry(styleId, headSize), cmat(c.hair || 0x4a3526));
      hairMesh.castShadow = true;
      hairMesh.userData.hairStyle = styleId;
      neck.add(hairMesh); hairParts.push(hairMesh);
    }

    // painted-clothing atlas metadata: which vertical band of the garment row
    // each segment shows (0=hem/wrist, 1=shoulder/waist). city/clothes.js
    // reads these to UV-map split limbs; absent tags = whole row (legacy).
    // Profile-driven, so a painted sleeve lands on a child's short arm in the
    // same place it lands on an adult's instead of running off the end of it.
    // At adult-male numbers every value below is the literal that was here.
    const tagCloth = (mesh, dims, band) => { mesh.userData.clothDims = dims; mesh.userData.clothBand = band; };
    // THE TORSO COLUMN IS TWO BOXES NOW for any body with a waist, and a
    // garment row painted across it must be SPLIT or every horizontal feature
    // in it (hem, belt, waistband, print) draws twice — once on the chest and
    // again on the waist, which is exactly the doubled belt line you would see.
    // Tagged here, at the only place that knows the real split, so city/
    // clothes.js never has to re-derive it from a copy of WAIST_TUCK that can
    // silently drift out of step with this file.
    if (waist) {
      const wh = waistH + WAIST_TUCK;
      tagCloth(torso, [P.torsoW, chestH, P.torsoD], [waistH / P.torsoH, 1]);          // TOP of the row
      tagCloth(waist, [P.waistW, wh, P.waistD], [0, Math.min(1, wh / P.torsoH)]);     // BOTTOM of the row
    }
    const armLen = P.armUp + P.armLo, legLen = P.legUp + P.legLo;
    const alw = P.armW * 0.9, llw = P.legW * 0.9;
    tagCloth(la.userData.main, [P.armW, P.armUp, P.armW], [1 - P.armUp / armLen, 1]);
    tagCloth(ra.userData.main, [P.armW, P.armUp, P.armW], [1 - P.armUp / armLen, 1]);
    tagCloth(la.userData.lower, [alw, P.armLo + 0.06, alw], [0, (P.armLo + 0.06) / armLen]);
    tagCloth(ra.userData.lower, [alw, P.armLo + 0.06, alw], [0, (P.armLo + 0.06) / armLen]);
    tagCloth(ll.userData.main, [P.legW, P.legUp, P.legW], [1 - P.legUp / legLen, 1]);
    tagCloth(rl.userData.main, [P.legW, P.legUp, P.legW], [1 - P.legUp / legLen, 1]);
    tagCloth(ll.userData.lower, [llw, P.legLo + 0.06, llw], [0, (P.legLo + 0.06) / legLen]);
    tagCloth(rl.userData.lower, [llw, P.legLo + 0.06, llw], [0, (P.legLo + 0.06) / legLen]);

    const rig = {
      group: g, model, metric, body, neck, head,
      parts: { ll, rl, la, ra },
      low: { ll: ll.userData.low, rl: rl.userData.low, la: la.userData.low, ra: ra.userData.low },
      sockets: { leftHand, rightHand, weapon: rightHand, thirdPersonWeapon },
      // The body this rig was BUILT from. Every downstream system that used to
      // guess an adult constant (seated hip height, mount points, gait
      // multipliers, child protection) reads it from here instead.
      profile: P, hipY, band: P.band, child: !!P.child, ageYears: P.ageYears,
      stanceZ: P.stanceZ, armOutZ: P.armOutZ, gait: P.gait || GAIT_NEUTRAL,
      skinSlots: {
        // torso[0] stays the CHEST box — clothes.js and wounds.js both index
        // [0] and would otherwise start painting/bleeding on a waistband.
        torso: waist ? [torso, waist] : [torso],
        collar: [collar],
        legs: [ll.userData.main, rl.userData.main],
        legsLower: [ll.userData.lower, rl.userData.lower],
        pelvis: [pelvis],
        shoes: [ll.userData.cap, rl.userData.cap].filter(Boolean),
        arms: [la.userData.main, ra.userData.main],
        armsLower: [la.userData.lower, ra.userData.lower],
        hands: [la.userData.cap, ra.userData.cap].filter(Boolean),
        head: [head],
        stripes: body.userData.stripes || [],
        belt: beltParts,
        badge: badgeParts,
        cap: capParts,
        hair: hairParts,
      },
      face: { eyeL: le, eyeR: re, brow, mouth }, // animated by systems/facial.js
      detail: [le, re, brow, mouth].concat(hairParts, capParts, body.userData.stripes || [], badgeParts),
      phase: Math.random() * 6.28,  // desync gaits between actors
      bob: 0, breath: Math.random() * 6.28,
      lean: 0, sway: 0, headYaw: 0,
      // the tone this rig was BUILT with — skin-showing painted garments
      // (clothes.js wifebeater etc.) read it so a bare shoulder matches the
      // face instead of a hard-coded shared-atlas tan.
      skinTone: c.skin != null ? c.skin : 0xcf9a72,
    };
    if (c.clothes && CBZ.applyClothes) CBZ.applyClothes(rig, c.clothes);
    return rig;
  }

  // shortest-arc angle lerp
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // frame-rate-independent approach: x → target by `rate` (per second)
  function damp(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth01 = (v) => {
    v = clamp01(v);
    return v * v * (3 - 2 * v);
  };
  const smoother01 = (v) => {
    v = clamp01(v);
    return v * v * v * (v * (v * 6 - 15) + 10);
  };
  const _mantleGrip = new THREE.Vector3();

  // Aim one shoulder/elbow chain at a fixed world-space ledge point. Limbs are
  // authored down -Y; negative shoulder X swings forward and a negative elbow
  // folds the forearm farther forward. Solving in the body's current local
  // frame keeps the wrists on the lip even while the torso leans and rises.
  function mantleArmSolve(ch, tp, side) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (side > 0 ? ch.parts.la : ch.parts.ra);
    if (!P || !part || tp.ledgeX == null || tp.rootY == null ||
        !ch.body || !ch.group || typeof ch.body.worldToLocal !== "function") return null;
    // Hands land roughly under their own shoulders. A narrow centre grip made
    // the elbows flare sideways even when the Y/Z solve was correct.
    const gripHalf = Math.min(0.43, ((ch.metric && ch.metric.width) || 0.9) * 0.40);
    // local +X in world space for a root facing (dirX,dirZ) is (dirZ,-dirX).
    _mantleGrip.set(
      tp.ledgeX + tp.dirZ * gripHalf * side,
      tp.top + 0.018,
      tp.ledgeZ - tp.dirX * gripHalf * side
    );
    ch.group.updateMatrixWorld(true);
    ch.body.worldToLocal(_mantleGrip);

    const dx = _mantleGrip.x - part.position.x;
    let dy = _mantleGrip.y - part.position.y;
    let dz = _mantleGrip.z - part.position.z;
    const l1 = Math.max(0.12, P.armUp - 0.02);
    const l2 = Math.max(0.12, P.armLo + 0.01);
    // Rotation.z handles the modest inward hand spacing. Solve the remaining
    // sagittal reach in Y/Z, clamped just inside full extension so the elbow
    // always retains a visible, load-bearing bend.
    let reach = Math.hypot(dy, dz);
    const maxReach = (l1 + l2) * 0.965;
    const minReach = Math.abs(l1 - l2) + 0.035;
    if (reach > maxReach) {
      const k = maxReach / reach;
      dy *= k; dz *= k; reach = maxReach;
    } else if (reach < minReach) {
      const k = minReach / Math.max(0.001, reach);
      dy *= k; dz *= k; reach = minReach;
    }
    const elbow = Math.acos(Math.max(-1, Math.min(1,
      (reach * reach - l1 * l1 - l2 * l2) / (2 * l1 * l2))));
    const fromDown = Math.atan2(dz, -dy);
    const shoulder = fromDown - Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));
    const inward = Math.atan2(dx, Math.max(0.16, reach));
    return {
      shoulder: -shoulder,
      elbow: -elbow,
      roll: Math.max(-0.48, Math.min(0.48, inward)),
    };
  }

  // The torso and legs are siblings authored from the feet, but anatomically
  // meet at this socket. Every pose writer may rotate the torso; these two
  // helpers make that rotation happen around the hip in full 3D. Compensation
  // is delta-tracked so reaction/grapple layers can safely re-lock after they
  // add their own pitch/roll without accumulating translation frame to frame.
  // The hip socket is wherever THIS body's legs end. It was a hard 0.95 (the
  // adult male), which silently pinned every child and every shorter body to an
  // adult's hips — the rotation would pivot around a point floating above a
  // toddler's actual waist. rig.hipY carries the real value; a legacy rig with
  // no profile falls back to the old constant, so nothing can regress.
  const CHARACTER_HIP_Y = 0.95;
  const hipYOf = (ch) => (ch && ch.hipY > 0 ? ch.hipY : CHARACTER_HIP_Y);
  const _hipPivot = new THREE.Vector3();
  function beginCharacterHipFrame(ch) {
    if (!ch || !ch.body) return;
    ch.body.position.x -= ch._hipCompX || 0;
    ch.body.position.y -= ch._hipCompY || 0;
    ch.body.position.z -= ch._hipCompZ || 0;
    ch._hipCompX = ch._hipCompY = ch._hipCompZ = 0;
  }
  function lockCharacterHips(ch) {
    if (!ch || !ch.body) return;
    const hy = hipYOf(ch);
    _hipPivot.set(0, hy, 0).applyEuler(ch.body.rotation);
    const nx = -_hipPivot.x;
    const ny = hy - _hipPivot.y;
    const nz = -_hipPivot.z;
    ch.body.position.x += nx - (ch._hipCompX || 0);
    ch.body.position.y += ny - (ch._hipCompY || 0);
    ch.body.position.z += nz - (ch._hipCompZ || 0);
    ch._hipCompX = nx; ch._hipCompY = ny; ch._hipCompZ = nz;
  }

  /* ---- POSTURE FOLLOWS THE SEAT ---------------------------------------
     ONE table, owned here, read by everybody: city/propuse.js's audit asks
     this same function so the count and the pose can never disagree about
     what a "sofa" is. A kind that is ABSENT (or explicitly null below) gets
     the default upright chair pose — which is why the aircraft cabin, the
     gate lounge, every desk and every plain chair are listed as null rather
     than merely omitted: their uprightness is a DECISION, not an oversight,
     and a future edit that adds "waiting" to the lounge row has to delete a
     line that says otherwise.
     The vocabulary is exactly the `kind` strings SEAT_H in propuse.js already
     keys on, so no registration site has to learn a new word. */
  const SEAT_POSTURE = {
    // soft, deep, with something to fall back into
    sofa: "lounge", couch: "lounge", armchair: "lounge", lounge: "lounge",
    booth: "lounge", lounger: "lounge", recliner: "lounge",
    deck: "lounge", deckchair: "lounge",
    // a chair you sit UP in because of who is watching
    throne: "throne", boss: "throne", exec: "throne",
    // perched, no backrest, feet looking for the rail
    stool: "stool", counter: "stool", bar: "stool",
    // a plank you lean forward off, elbows toward the knees
    bench: "bench", pew: "bench", park: "bench",
    // BEHIND A WHEEL. A driver is not a passenger who happens to be at the
    // front: the hands leave the lap and go OUT to a rim, the shins reach
    // forward for pedals instead of hanging, and the head stays up on the
    // road. Nothing else in the game sits like that, which is exactly why
    // the car cabin reads as empty even when a body is in it.
    car: "drive", driver: "drive", wheel: "drive", helm: "drive",
    // DELIBERATELY UPRIGHT (see above) — these are not omissions.
    chair: null, seat: null, dining: null, table: null, kitchen: null,
    desk: null, office: null, work: null, terminal: null,
    patio: null, patiochair: null, cabin: null, cell: null, bedside: null,
    "aircraft-seat": null, aircraft: null, airline: null, economy: null,
    "cockpit-seat": null, cockpit: null, flightdeck: null,
    waiting: null, gate: null, lounge_gate: null,
  };
  // Degrade-safe classifier. null = "sit up straight", which is also what an
  // unknown kind and a seat that declared no kind at all get.
  CBZ.charSeatPosture = function (kind) {
    if (kind == null) return null;
    const k = String(kind).toLowerCase();
    return Object.prototype.hasOwnProperty.call(SEAT_POSTURE, k) ? SEAT_POSTURE[k] : null;
  };

  /* ---- HOW FAR A SLEEPER IS ROLLED ------------------------------------
     propuse.js parks a lying body with group.rotation.z = π/2, putting the
     rig's local +X lateral side straight up. The arm sockets are semantically
     mirrored for the chase-camera view (la is +X, ra is -X), a distinction the
     joint pose below must preserve. Rolling further is done INSIDE the rig
     (body.rotation.y, about the body's own feet→head axis) so the placement
     machinery in propuse never has to change: +y turns the chest toward local
     +X, which is up. These two numbers are the contract, and propuse reads
     them to work out how far above the mattress the rig's origin belongs —
     a side sleeper presents half a SHOULDER to the mattress, a back sleeper
     half a torso DEPTH, and that difference is ~3cm of visible float. */
  const LIE_ROLL_SIDE = 0.10;    // a hair onto the front, the way people actually lie
  const LIE_ROLL_BACK = 1.15;    // ~66°: the recovery position, not a plank
  CBZ.charLieRoll = { side: LIE_ROLL_SIDE, back: LIE_ROLL_BACK };
  const BREATH_W = Math.PI * 0.5;   // 2π × 0.25 Hz — ~4 s per breath, sleeping rate

  /* The V2 chair sit owns model.position.y (the sink onto the cushion) and
     model.position.z (the lounge slouch), and the shin scale that makes a
     short voxel shin reach the floor. NOTHING else in the game writes those
     channels, so they need an explicit refund the moment the body leaves the
     seat — otherwise a vacated chair leaves a rig walking around sunk into
     the ground with stretched shins. Hoisted into one function because there
     are now TWO exits from a seat: standing up (the blend-out below the sit
     branch) and lying down (the sleep branch, which early-returns past it). */
  function refundSeatSolve(ch, J, dt, rate) {
    rate = rate || 10;
    if (ch._seatSunk) {
      const m = ch.model;
      if (m) { m.position.y = damp(m.position.y, 0, rate, dt); m.position.z = damp(m.position.z, 0, rate, dt); }
      if (!m || (Math.abs(m.position.y) < 0.005 && Math.abs(m.position.z) < 0.005)) {
        if (m) { m.position.y = 0; m.position.z = 0; }
        ch._seatSunk = 0;
      }
    }
    if (ch._seatShinScaled) {
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, 12, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, 12, dt);
      const lRest = !J.ll || Math.abs(J.ll.scale.y - 1) < 0.005;
      const rRest = !J.rl || Math.abs(J.rl.scale.y - 1) < 0.005;
      if (lRest && rRest) {
        if (J.ll) J.ll.scale.y = 1;
        if (J.rl) J.rl.scale.y = 1;
        ch._seatShinScaled = 0;
      }
    }
  }

  // Shared by full character rigs and the instanced jail crowd. Phase is in
  // radians; PI radians is one alternating footfall. Distance, not frame count,
  // owns cadence so a metre travelled looks the same at every refresh rate.
  function gaitPhaseDelta(speed, dt, walkRef, stepMul) {
    walkRef = walkRef || ((CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4);
    const moving = speed > 0.2;
    const norm = Math.min(speed / walkRef, 1);
    const run = clamp01((speed - walkRef) / (walkRef * 0.7));
    // CADENCE IS NOT AUTHORED — it falls out of speed ÷ stride, which is
    // exactly right: the gait literature (Cho 2004) finds cadence essentially
    // EQUAL between the sexes at preferred speed, with women taking SHORTER
    // STRIDES. So shortening the stride here is the whole female cadence
    // effect, and a short-legged child gets a child's quick patter for free.
    // Omitted stepMul = 1 = the motion this game has always had (the external
    // caller in entities/crowd.js passes two args and is unaffected).
    const stepLen = (1.15 + 0.10 * norm + 0.55 * run) * (stepMul > 0 ? stepMul : 1);
    return moving ? (speed * dt / stepLen) * Math.PI : dt * 0.9;
  }

  /* ---- SKYDIVER / PARACHUTE BODY -----------------------------------------
     city/bailout.js owns the trajectory and publishes only a small visual
     record here.  The body still belongs to the canonical character rig:
     freefall is a belly-to-earth arch (wide arms, bent knees, chin into the
     relative wind), while an open canopy hangs the hips in the harness with
     the thighs forward and both hands on the risers/toggles.  Keeping this in
     character.js means the live player, visual-comparison studio and any later
     NPC parachutist all solve the same elbows, knees and hip socket. */
  function applySkydiverPose(ch, state, dt) {
    state = state || {};
    const canopy = state.phase === "canopy" || state.phase === "opening";
    const flare = canopy ? clamp01(state.flare || 0) : 0;
    const opening = canopy ? clamp01(state.opening == null ? 1 : state.opening) : 0;
    const t = +state.t || 0;
    const wave = Math.sin(t * 2.15) * 0.035;
    const sr = canopy ? 18 : 13;
    const J = ch.low || {};
    const setKnee = (j, x) => {
      if (!j) return;
      j.rotation.x = damp(j.rotation.x, Math.max(0, x), sr, dt);
      j.rotation.y = damp(j.rotation.y, 0, sr, dt);
      j.rotation.z = damp(j.rotation.z, 0, sr, dt);
      j.scale.y = damp(j.scale.y, 1, sr, dt);
    };
    const setElbow = (j, x) => {
      if (!j) return;
      j.rotation.x = damp(j.rotation.x, Math.min(0, x), sr, dt);
      j.rotation.y = damp(j.rotation.y, 0, sr, dt);
      j.rotation.z = damp(j.rotation.z, 0, sr, dt);
    };

    // Refund transforms owned by seated/traversal poses before taking the rig.
    if (ch.model) {
      ch.model.position.y = damp(ch.model.position.y, 0, sr, dt);
      ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
      ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
      ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
    }
    ch._seatSunk = 0;

    if (!canopy) {
      // Stable belly flight: chest and thighs form one shallow arch, lower legs
      // ride in the burble, and the forearms make the recognisable box position.
      ch.body.position.y = damp(ch.body.position.y, 0.015, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, -0.025, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 1.16 + wave, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, wave * 0.45, sr, dt);
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, 0.92 - wave, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.08, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.24, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, 0.98 + wave, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.08, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.24, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, 0.92 + wave);
      setKnee(J.rl, 1.02 - wave);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34 + wave, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.10, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 1.13, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.08, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.38 - wave, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.10, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -1.13, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.08, sr, dt);
      }
      setElbow(J.la, -0.58 - wave);
      setElbow(J.ra, -0.62 + wave);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.82, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -wave * 0.6, sr, dt);
      }
    } else {
      // Harness hang: hips sit back, knees and boots come forward, hands meet
      // two riser groups beside the head. Pulling S brings both toggles down for
      // a flare instead of leaving the arms frozen overhead.
      const pull = flare * 1.16;
      ch.body.position.y = damp(ch.body.position.y, -0.07 - (1 - opening) * 0.05, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, -0.035, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.16 - (1 - opening) * 0.10, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, wave * 0.30, sr, dt);
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.12 + flare * 0.12, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.04, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, -0.16, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.08 + flare * 0.12, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.04, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, 0.16, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, 1.28 + (1 - opening) * 0.12);
      setKnee(J.rl, 1.24 + (1 - opening) * 0.12);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.48 + pull, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.12, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.24 + flare * 0.12, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.18 - flare * 0.06, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.48 + pull, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.12, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.24 - flare * 0.12, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.18 - flare * 0.06, sr, dt);
      }
      setElbow(J.la, -0.28 - flare * 0.48);
      setElbow(J.ra, -0.28 - flare * 0.48);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.08, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -wave * 0.5, sr, dt);
      }
    }
    ch.bob = ch.body.position.y;
    ch.lean = ch.body.rotation.x;
    ch.sway = ch.body.rotation.z;
    ch._stanceNk = 1;
    lockCharacterHips(ch);
  }

  function poseSkydiver(ch, state, dt) {
    if (!ch || !ch.parts || !ch.body) return false;
    beginCharacterHipFrame(ch);
    applySkydiverPose(ch, state, dt == null ? 1 / 60 : dt);
    return true;
  }

  /* ---- the layered animation update ----
     speed: current planar speed (units/s). dt: seconds.

     Gait model (verified frame-by-frame with tools/studio.mjs filmstrips):
       θ = ch.phase, LEFT hip = +A·sinθ  (positive x = limb swings BACK)
       left leg swings FORWARD while cosθ<0 → left knee flexes then, peaking
       mid-swing (θ≈π); right leg mirrors (cosθ>0, peak θ≈0).
       Double support ≈ θ=π/2, 3π/2 (feet apart) → CoM lowest there.
       Arms counter-swing the legs; elbows carry a base bend that deepens
       with speed (jogger's ~90° pump at sprint) and on the forward swing. */
  function animChar(ch, speed, dt) {
    /* THE HELD GUN'S GROUND CONTACT — the FIRST thing this function does, and
       the position is load-bearing in both directions.
       ABOVE beginCharacterHipFrame: that call strips the hip-pivot
       compensation off ch.body, so between it and lockCharacterHips the rig is
       0.57 m out of place on a prone body. A solve run in that window measures
       a body that is never rendered — it reported the gun 0.59 m lower than it
       is and lifted it into the air by exactly that. Here the rig is the fully
       composed one the last frame actually DREW.
       ABOVE every early return: the socket offset written below has to keep
       decaying whatever pose the rig falls into next, or a gun lifted while
       prone stays lifted through the stand-up.
       Player rig only: it is the one body that goes prone, the one
       holsterprops.js drives, and the one whose gun the camera ever gets close
       enough to judge. Both ends of the loop are damped, so reading last
       frame's barrel orientation (holsterprops writes it at onAlways 54) costs
       nothing. */
    if (ch === CBZ.playerChar && ch.sockets) gunGroundRest(ch, dt);
    beginCharacterHipFrame(ch);
    const moving = speed > 0.2;
    const walkRef = (CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4;
    const norm = Math.min(speed / walkRef, 1);          // 0..1 stand→brisk
    const run2 = clamp01((speed - walkRef) / (walkRef * 0.7)); // sprint layer
    ch.breath += dt;
    const J = ch.low || {};
    const setKnee = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.max(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };
    const setElbow = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.min(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };

    // prone blend — physics.js reads this to sink the rig group; damped ABOVE
    // every early-return branch so it always decays once pronePose clears.
    ch._proneB = damp(ch._proneB || 0, ch.pronePose ? 1 : 0, 9, dt);

    // A falling/chuting body is neither a walk nor a jump animation. The
    // bailout owner publishes the state; this shared rig owns the joints.
    if (ch.skydiving) {
      applySkydiverPose(ch, ch.skydiving, dt);
      return;
    }

    // ---- MOUNTED RIDER: hips planted, thighs wrapped, shins hanging -------
    // wildlife_tame.js owns the animal/root trajectory and publishes only a
    // small visual record here. The ordinary walk cycle must never run while
    // riding: a walking avatar translated above an animal reads as two actors
    // occupying the same place, not one body carried by another.
    if (ch.riding) {
      const rr = ch.riding, sr = 18;
      const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
      const pf = ch.profile;
      const thigh = Math.max(0.2, (pf ? pf.legUp : 0.48) * hs);
      const mountHalf = Math.max(0.12, (rr.width || 0.7) * 0.46);
      // Solve the hip abduction from the actual mount width and this body's
      // own thigh length. Cap at a believable deep straddle for elephants and
      // bison whose backs are wider than the stylised human femur can span.
      const spread = Math.max(0.36, Math.min(0.92,
        Math.asin(Math.max(0.18, Math.min(0.80, mountHalf / thigh)))));
      const movingK = rr.moving ? 1 : 0;
      const airK = rr.airborne ? 1 : 0;
      const beat = movingK ? Math.sin(rr.phase || 0) : 0;
      const thighForward = -1.18 - airK * 0.16;
      const kneeFold = 1.20 + airK * 0.18;

      // Any chair solve that was active before mounting is refunded here. A
      // saddle owns hip placement in wildlife_tame, never model-level sinking.
      if (ch.model) ch.model.position.y = damp(ch.model.position.y, 0, sr, dt);
      ch._seatSunk = 0;
      ch.body.position.y = damp(ch.body.position.y, -0.015 - movingK * 0.025, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0.015, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.12 + movingK * 0.08 - airK * 0.04, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, beat * 0.035, sr, dt);

      // Local -X is the visible left hip. Each thigh pitches forward and
      // abducts OUTWARD; each knee then folds back so boots hang down the two
      // flanks instead of pointing forward like a chair sitter's feet.
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, thighForward - beat * 0.035, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.08, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, -spread, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, thighForward + beat * 0.035, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.08, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, spread, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, kneeFold + beat * 0.04, sr);
      setKnee(J.rl, kneeFold - beat * 0.04, sr);
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, sr, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, sr, dt);
      ch._seatShinScaled = false;

      // A relaxed two-hand hold toward the withers. The tiny alternating give
      // follows the animal stride; the rider never pumps arms like a runner.
      const reach = -0.72 - movingK * 0.07 + airK * 0.08;
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, reach + beat * 0.025, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.04, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.24, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.05, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, reach - beat * 0.025, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.04, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.24, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.05, sr, dt);
      }
      setElbow(J.la, -0.62 - airK * 0.08, sr);
      setElbow(J.ra, -0.62 - airK * 0.08, sr);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.02 + airK * 0.05, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -beat * 0.02, sr, dt);
      }
      lockCharacterHips(ch);
      return;                         // the mount pose owns the whole rig
    }

    /* ---- ASLEEP: the pose a bed has never had ----------------------------
       THE LIE THIS DELETES. city/propuse.js walks a body to the bedside,
       perches it on the mattress edge and rolls it flat — a genuinely good
       arc that ended in the WORST pose in the game: the standing rig, rolled
       90° about Z. That is byte-for-byte the KO pose physics.js puts on a
       corpse in the street. Straight legs, standing-idle arms, level chin,
       and not one millimetre of movement. Every bedroom contained a plank.

       WHERE THIS SITS IN THE CHAIN. A lying body OUTRANKS a seated one: the
       lie arc holds `sitting` a beat INTO the roll (propuse's `swing`), so
       for those frames both flags are live and the horizontal body must win
       or the chair solve would sink a sideways rig into the mattress. Like
       every full-rig state here it early-returns — a later branch that got a
       frame would fight this one and the body would jitter between two poses.

       WHAT COMPOSES AND WHAT DOESN'T. The group's 90° Z-roll stays propuse's
       (it owns placement, and CBZ.propLiePlace solves the mattress clearance
       off the same roll) — this pose never touches ch.group. Everything here
       is INSIDE the rig, which is also how the side/back choice is made:
       body.rotation.y spins the torso about its own feet→head axis, and since
       local +X is world-up under that roll, +y turns the chest toward the
       ceiling. A back sleeper is therefore the same placement, rolled from
       the inside — no second transform for propuse to fight.

       THE KNEES ARE SOLVED, NOT AUTHORED. A sleeper draws the heels back
       until the ankle returns under the line of the hip: the leg stops being
       a stick and becomes a shape. That is one equation on THIS rig's own
       segments — THIGH·sin(a) + SHIN·sin(a−k) = 0 → k = a + asin(THIGH/SHIN ·
       sin a) — so a long-femured adult folds deeper than a child does, and
       nobody ever has to retune a magic angle when the profile table changes.

       Everything is an absolute damp toward a target, so entering or leaving
       mid-blend can never accumulate (the grapple brace-pose lesson). */
    // The KO/knockdown crumple is the LAST layer in this function on purpose,
    // which means every early-returning pose above it silently outranks it.
    // For a chair that is harmless; for a BED it is not — somebody shot in
    // their sleep must fall out of the sleep pose, not keep breathing through
    // it. Two flags, checked here rather than in propuse, because the rig is
    // the only thing that knows a crumple is running.
    if (ch.lying && CBZ.CONFIG.CHAR_SLEEP_POSE !== false && !(ch.koT > 0) && !ch.koPose) {
      const L = ch.lying, sr = 9;
      const pf = ch.profile;
      const THIGH = Math.max(0.05, pf ? pf.legUp : LEG_UP);
      const SHIN = Math.max(0.05, pf ? pf.legLo : LEG_LO);
      // Per-actor, published by propuse (stable per BODY, so the same person
      // always sleeps the same way). Absent → a sensible middle sleeper.
      const back = !!L.back;
      const vary = (L.vary != null) ? L.vary : 0.5;
      const dv = vary - 0.5;                      // −0.5..+0.5, the variance knob
      // Near arm across the chest, or laid along the side. Left to the record
      // when it says; otherwise a back sleeper lets the arm lie and a side
      // sleeper hugs it in, which is what the sleep-posture literature and
      // every photograph of a bed agree on.
      const fold = (L.fold != null) ? !!L.fold : !back;

      // BREATHING. ~0.25 Hz, i.e. one breath per four seconds — the sleeping
      // rate, not the standing one. Amplitude is a fraction of THIS torso's
      // depth so a child's chest doesn't heave like a linebacker's. The phase
      // advances here rather than in propuse so the breath keeps running even
      // if whoever published the record never touches it again.
      L.phase = (L.phase || 0) + dt * BREATH_W;
      const br = Math.sin(L.phase);
      const brAmp = (pf ? pf.torsoD : 0.50) * 0.030;

      // A seat solve that was live a beat ago (the perch on the mattress edge)
      // is refunded here — this branch early-returns past the blend-out below.
      refundSeatSolve(ch, J, dt, sr);
      if (ch.typing) ch.typing = false;

      const roll = back ? LIE_ROLL_BACK : LIE_ROLL_SIDE;
      const curl = (back ? 0.05 : 0.13) + dv * 0.05;      // spine curls over the knees
      ch.body.position.x = damp(ch.body.position.x, br * brAmp, sr, dt);   // chest RISE: +x is up under the roll
      ch.body.position.y = damp(ch.body.position.y, -0.02, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, curl, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, roll, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, br * 0.012, sr, dt);

      // LEGS. The TOP leg is rl: unlike the mirrored arm sockets, legs keep
      // semantic right on local +X. Its knee draws up and falls forward
      // across the other; the bottom leg stays long against the mattress.
      const kneeFor = (a) => Math.max(0.10, Math.min(1.95,
        a + Math.asin(Math.max(-1, Math.min(1, (THIGH / SHIN) * Math.sin(a))))));
      const hipA = (back ? 0.22 : 0.44) + dv * 0.10;
      const aTop = hipA * 1.25, aBot = hipA * 0.78;
      const twist = back ? 0.22 : 0.05;            // a back sleeper's toes fall outward
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -aTop, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, twist, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.14, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -aBot, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -twist, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.04, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      setKnee(J.rl, kneeFor(aTop), sr);
      setKnee(J.ll, kneeFor(aBot), sr);

      // ARMS. The lower-side ra is rooted on local -X; positive Z carries it
      // out of the mattress and across the chest. The upper-side la is +X and
      // uses the opposite sign to relax inward. The old signs sent both arms
      // farther OUTBOARD and left a detached-looking hand above the sleeper.
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, (fold ? -0.46 : -0.14) + br * 0.020, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, (fold ? 0.68 : 0.18) + dv * 0.06, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, fold ? 0.05 : 0.02, sr, dt);
      }
      setElbow(J.ra, fold ? -1.10 : -0.40, sr);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.30 + br * 0.016, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.18 - dv * 0.05, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.04, sr, dt);
      }
      setElbow(J.la, -0.58, sr);

      // HEAD. Chin tucks toward the chest (the universal sleeping curl) and
      // the crown tips toward the mattress so the cheek actually meets the
      // pillow: +z on the neck maps the head's top toward local −X, which is
      // DOWN under the roll. A back sleeper is already face-up and only needs
      // a whisker of it.
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.14 + br * 0.012, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, (back ? 0.06 : 0.20) + dv * 0.05, sr, dt);
      }
      // Publish what we wrote, exactly as slidePose/pronePose do: the KO and
      // death blends read these RELATIVELY, so a parked lean would bias a body
      // that dies in its sleep, and the neck has no locomotion owner at all.
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // the sleep pose owns the whole rig
    }

    // ---- SEATED (office-jobs): full-rig pose that OWNS the body ----
    if (ch.sitting) {
      const sr = 12;
      // CHAIR-SIT V2 (owner: plane passengers "sit like their feet are on the
      // seat instead of their feet on the ground"). Root cause is the ANCHOR
      // convention meeting a pose that can't reach: aircraft seat anchors sit
      // ON the cushion top while this legacy pose keeps the feet at the rig's
      // root plane — so the whole folded body squatted on top of the cushion.
      // The hip pivots are authored at a FIXED height above the root (legs are
      // children of the model), so no leg angle alone can ever push the feet
      // below the root plane: feet-on-the-floor REQUIRES sinking the model.
      // Seats that DECLARE their geometry (ch.seatRef = { cushion, floorBelow },
      // world units — aircraft seat records carry it; benches/desks/car
      // interiors don't and keep the legacy fake byte-identical) get the real
      // solve: sink the model so the butt lands ON the cushion, then close a
      // hip/knee chain so the soles land ON the floor. Two closed forms: shin
      // tucked back under the knee for normal chairs (airliner rows, ~90-110°
      // knee), legs stretched forward with knees above the hips for low
      // loungers (the private-jet recliners) where a tuck would demand an
      // anatomically absurd fold.
      const ref = ch.seatRef && (!CBZ.CONFIG || CBZ.CONFIG.CHAR_SEAT_POSE_V2 !== false) ? ch.seatRef : null;
      if (ref && ch.model) {
        const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
        // Profile-driven so a child folds at a child's knee: the segment
        // lengths ARE the rig's own (plus the shoe cap for the sole). Legacy
        // rigs with no profile keep the authored adult constants exactly.
        const pf = ch.profile;
        const THIGH = (pf ? pf.legUp : 0.46) * hs;
        const SHIN = (pf ? pf.legLo + 0.03 : 0.50) * hs;   // hip→knee pivot, knee→sole
        // hip pivot above the FLOOR: cushion + a whisker less than the thigh's
        // half-thickness (~0.12·hs) so the thigh presses INTO the cushion a
        // touch — a sat-in seat, never a hover. Floor for the low clamp: the
        // hips can't drop below what a near-vertical shin can span.
        const hipF = Math.max((ref.cushion != null ? ref.cushion : 0.45) + 0.10 * hs, SHIN * 0.55);
        const sink = hipF - hipYOf(ch) * hs - (ref.floorBelow || 0);
        ch.model.position.y = damp(ch.model.position.y, sink, sr, dt);
        ch._seatSunk = 1;

        /* ---- POSTURE FOLLOWS THE SEAT (CHAR_SEAT_POSTURE) ---------------
           A sofa, a throne, a bar stool and an office chair used to produce
           the IDENTICAL upright pose — the same body, four times, in four
           rooms that were supposed to feel different. Nothing lounged, and
           the deep soft couch a furnisher spent geometry on read exactly like
           a desk chair with the desk deleted.

           The seat already knows what it is: every registration site passes a
           `kind`, propuse.js's SEAT_H keys its cushion heights on it, and
           CBZ.propSeatRef now carries it through to seatRef.kind. So this is
           not new data — it is data that was being thrown away one function
           short of the pose that needed it. CBZ.charSeatPosture (one table,
           declared above, also read by propUseAudit) maps it to a family.

           A kind we don't recognise, a seat that declared none, and every
           anchor npclife's attach() builds (aircraft cabins, arena bowls)
           resolve to null and take the branch below UNCHANGED — the defaults
           here are the exact literals this solve has always used, so the
           airliner row, the desk worker and the typing loop are untouched. */
        const post = (CBZ.CONFIG.CHAR_SEAT_POSTURE !== false && CBZ.charSeatPosture)
          ? CBZ.charSeatPosture(ref.kind) : null;
        // Per-seat variance, deterministic from the anchor's own coordinates
        // (propSeatRef hashes them) — a row of five sofa-sitters must not read
        // as one body stamped five times. Zero unless a posture claimed the
        // seat, so the default pose stays bit-for-bit what it was.
        const sv = (post && ref.vary != null) ? (ref.vary - 0.5) : 0;
        let leanX = 0.1, sitY = -0.06, slideZ = 0, yawY = 0;
        let armX = -0.34, armZ = 0.12, elb = -0.72, neckX = 0.04, railF = 0;
        if (post === "lounge") {
          // You do not SIT on a couch, you fall back into one: the shoulders
          // pitch ~14° behind the hips, the pelvis slides forward off the
          // backrest by a quarter of its own depth (derived, so a child
          // slouches a child's distance), and the forearms go out to where an
          // armrest is — wider and straighter than hands-on-thighs.
          leanX = -0.24 + sv * 0.06;
          sitY = -0.09;
          slideZ = (pf ? pf.pelvisD : 0.48) * 0.25 * hs;
          armX = -0.20; armZ = 0.30 + sv * 0.05; elb = -0.95;
          neckX = -0.06;                       // head back against the rest
        } else if (post === "throne") {
          // The opposite reading of the same soft chair: a boss chair is worn,
          // not rested in. Spine vertical, both hands claiming the armrests.
          leanX = 0.01 + sv * 0.03;
          armX = -0.30; armZ = 0.34 + sv * 0.04; elb = -1.05;
          neckX = -0.02;
        } else if (post === "stool") {
          // Nothing to lean on, so the spine holds itself up and the forearms
          // find the counter. FEET FIND THE RAIL: a stool that a body's shins
          // cannot reach the floor from is not a body dangling in the air —
          // every counter stool in the world carries a footrail, and the
          // standard one sits at ~40% of the stool's own height. Shortening
          // the hip→sole drop by that much is the whole fix, and it falls out
          // of the declared cushion instead of a new number.
          leanX = 0.06 + sv * 0.04;
          armX = -0.44; armZ = 0.10; elb = -0.90;
          railF = 0.42;
        } else if (post === "bench") {
          // A bench is a plank: people perch forward on it and put their
          // elbows toward their knees, which is the difference between
          // waiting and sitting.
          leanX = 0.22 + sv * 0.05;
          armX = -0.52; armZ = 0.16; elb = -1.15;
          neckX = 0.10;
        } else if (post === "drive") {
          // BEHIND A WHEEL. A car seat's backrest is close to vertical, so the
          // spine barely leans; what makes a driver a driver is above the
          // shoulders and in front of the chest — the head stays UP on the
          // road (negative neck pitch, unlike every other seat here, which
          // looks down at a table) and both forearms leave the lap and go OUT
          // and FORWARD to a rim about a shoulder-width ahead. `sv` is
          // deliberately unspent on the torso: a driver with per-seat yaw
          // variance reads as distracted, not as variety.
          leanX = 0.08;
          sitY = -0.05;
          armX = -0.66; armZ = 0.20; elb = -0.80;
          neckX = -0.03;
        }
        if (post) yawY = sv * 0.10;            // a hair of torso yaw, per seat
        ch.model.position.z = damp(ch.model.position.z, slideZ, sr, dt);
        const railY = railF > 0 ? (ref.cushion != null ? ref.cushion : 0.45) * railF : 0;
        const drop = Math.max(0.05, hipF - 0.03 * hs - railY);   // hip → sole, soles a hair above the floor/rail
        let th, fold, shinScale = 1;
        // A chair is read by its THIGH line. The old V2 solve began at 0.95 rad
        // (54° from vertical) solely to make the short voxel shin touch the
        // floor. That drove the knee DOWN through the cushion: the body was at
        // the right height, but the legs visibly pierced the seat. Put a normal
        // chair thigh almost level first, then lengthen only the lower-leg
        // chain enough to meet the floor. This is also the honest correction
        // for this stylised rig: its authored shin is only ~0.35 m in world
        // scale, while a real 0.45-0.50 m chair needs a longer seated drop.
        const chairTh = 1.38;                            // 79° from vertical
        const chairShin = (drop - THIGH * Math.cos(chairTh)) / SHIN;
        if (post === "drive") {
          // A DRIVER'S LEGS GO FORWARD, NOT DOWN. A car's floor pan sits a
          // hand's width below the cushion, so the floor-reaching solve below
          // has nothing to reach: it would either drive the knee down through
          // the seat (the chair branch) or fold the body into a lounger (the
          // low branch). Neither is a car. The thigh runs level along the
          // cushion and the shin reaches out to a pedal box ahead of the
          // firewall — one authored pair of angles, no solve, because the
          // geometry it would solve against is the same in every car.
          th = 1.46;                                     // ~84°: level thigh
          fold = 0.62;                                   // shin forward-down to the pedals
          shinScale = 1;
        } else if (chairShin >= 0.82) {
          th = chairTh;
          fold = th;                                     // lower leg hangs vertically
          // Standard chairs reach the floor; tall benches/stools dangle rather
          // than destroying the seat-clear thigh line to chase it.
          shinScale = Math.max(0.88, Math.min(1.38, chairShin));
        } else {
          // low lounger: knees ride above the hips, feet planted forward
          const a2 = 0.55;                                // shin leans forward of vertical
          th = Math.acos(Math.max(-0.45, Math.min(1, (drop - SHIN * Math.cos(a2)) / THIGH)));
          fold = Math.max(0.3, th - a2);
        }
        ch.body.position.y = damp(ch.body.position.y, sitY, sr, dt);  // small settle, torso stays stacked on the pelvis
        ch.body.rotation.x = damp(ch.body.rotation.x, leanX, sr, dt);
        ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
        ch.body.rotation.y = damp(ch.body.rotation.y, yawY, sr, dt);
        if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -th, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
        if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -th, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
        setKnee(J.ll, fold + 0.03, sr); setKnee(J.rl, fold, sr);       // hair of asymmetry so rows don't read cloned
        if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, shinScale, sr, dt);
        if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, shinScale, sr, dt);
        ch._seatShinScaled = !!((J.ll && Math.abs(J.ll.scale.y - 1) > 0.001) ||
          (J.rl && Math.abs(J.rl.scale.y - 1) > 0.001));
        // forearms rest on the thighs/armrests (same relaxed carry as legacy;
        // armX/armZ/elb are the untouched literals unless a posture claimed
        // this seat — an armrest pushes them out and straightens the elbow,
        // a bench pulls them in over the knees).
        // STEERING. `ch.driveSteer` (-1 hard left .. +1 hard right) is written
        // by whoever owns the wheel; it modulates the two ABSOLUTE arm targets
        // in opposite directions — one hand climbs the rim while the other
        // drops — exactly the way ch.typing modulates the desk pose. Because
        // every write below is still a damp toward an absolute value, entering
        // or leaving the seat mid-turn can never accumulate. Zero for every
        // posture that is not "drive", so those are byte-identical.
        const stw = (post === "drive" && ch.driveSteer)
          ? Math.max(-1, Math.min(1, +ch.driveSteer || 0)) : 0;
        if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, armX - stw * 0.18, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, armZ + stw * 0.10, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, armX + stw * 0.18, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -armZ + stw * 0.10, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
        setElbow(J.la, elb - stw * 0.10, sr); setElbow(J.ra, elb + stw * 0.10, sr);
        if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, neckX, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
        lockCharacterHips(ch);
        return;   // seated pose owns the whole rig
      }
      ch.body.position.y = damp(ch.body.position.y, -0.6, sr, dt);     // hips drop into the chair
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.14, sr, dt);     // slight working lean
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      // thighs fold forward, shins hang to the floor (real knees now)
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.3, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.3, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      setKnee(J.ll, 1.42, sr); setKnee(J.rl, 1.38, sr);
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, sr, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, sr, dt);
      ch._seatShinScaled = !!((J.ll && Math.abs(J.ll.scale.y - 1) > 0.001) ||
        (J.rl && Math.abs(J.rl.scale.y - 1) > 0.001));
      // forearms rest toward the desktop — and a WORKING seat (ch.typing, set
      // only by the desk-sit paths) actually TYPES: a small alternating
      // forearm tap + a touch more head-down focus. Pure target modulation:
      // every write stays a damp toward an absolute pose, so entering/leaving
      // the loop can never accumulate (the grapple brace-pose lesson).
      const tw = ch.typing ? Math.sin(ch.breath * 9) * 0.055 : 0;
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34 + tw, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.12, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.34 - tw, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.12, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
      setElbow(J.la, -0.72 - tw, sr); setElbow(J.ra, -0.72 + tw, sr);
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, ch.typing ? 0.11 : 0.04, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      lockCharacterHips(ch);
      return;   // seated pose owns the whole rig
    }
    // seat-sink blend-out: the V2 chair sit above owns model.position.y/z while
    // seated and nothing else ever writes those channels — recover them here (a
    // few frames of damp) the moment the actor stands, so a vacated seat can't
    // leave a rig walking around sunk into the ground. Armed only by the V2
    // sit; every other rig skips at one falsy check inside the helper.
    refundSeatSolve(ch, J, dt, 10);
    if (ch.typing) ch.typing = false;   // typing exists only while seated (stale-flag guard)

    // ---- OBSTACLE TRAVERSAL (systems/physics.js) -------------------------
    // The physics owner supplies only {kind, style, t}: this canonical animator
    // turns that one shared state into the pose for the player AND every full-rig
    // NPC. The world trajectory already puts the root over the obstacle; these
    // writes make the body explain HOW it got there — hands find the top, elbows
    // load, hips follow, and the legs either scissor over or tuck through.
    //
    // Every target is absolute and this branch owns the full rig, like seated /
    // slide / prone. That makes interruption safe and prevents a vault pose from
    // accumulating onto the next walk cycle.
    if (ch.traversePose) {
      const tp = ch.traversePose;
      const u = clamp01(tp.t || 0);
      const air = Math.sin(Math.PI * u);
      const sr = 18;
      const limb = (part, x, y, z, pz) => {
        if (!part) return;
        part.rotation.x = damp(part.rotation.x, x, sr, dt);
        part.rotation.y = damp(part.rotation.y, y || 0, sr, dt);
        part.rotation.z = damp(part.rotation.z, z || 0, sr, dt);
        part.position.z = damp(part.position.z, pz || 0, sr, dt);
        part.scale.y = damp(part.scale.y, 1, sr, dt);
      };
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);

      if (tp.kind === "mantle") {
        // Reach → hang → pull → press-out. The old fixed -2.4rad shoulder target
        // pointed both arms almost vertically above the head. Here `hold`
        // blends into a real two-link solve against physics.js's near ledge.
        const reach = smoother01(u / 0.24);
        const release = 1 - smoother01((u - 0.48) / 0.18);
        const hold = Math.max(0, reach * release);
        const pull = Math.sin(Math.PI * smoother01((u - 0.18) / 0.70));
        ch.body.position.y = damp(ch.body.position.y, -0.11 * hold + 0.05 * pull, sr, dt);
        // Positive pitch is toward +Z/the ledge: chest follows the planted
        // hands instead of hanging back while the arms point skyward.
        ch.body.rotation.x = damp(ch.body.rotation.x, 0.10 * hold + 0.12 * pull, sr, dt);
        ch.body.rotation.z = damp(ch.body.rotation.z, 0.06 * Math.sin(u * Math.PI * 2) * pull, sr, dt);
        // lockCharacterHips changes the body's translation after a pitch. Apply
        // it before the world→body conversion so the wrist target includes the
        // exact compensated shoulder position used for rendering.
        lockCharacterHips(ch);
        const leftGrip = mantleArmSolve(ch, tp, 1);
        const rightGrip = mantleArmSolve(ch, tp, -1);
        const press = smoother01((u - 0.48) / 0.28) *
          (1 - smoother01((u - 0.80) / 0.18));
        const armRest = -0.20 - 0.32 * press;
        const leftX = leftGrip ? armRest + (leftGrip.shoulder - armRest) * hold : -0.20 - 1.18 * hold;
        const rightX = rightGrip ? armRest + (rightGrip.shoulder - armRest) * hold : -0.20 - 1.18 * hold;
        const leftZ = leftGrip ? -0.10 + (leftGrip.roll + 0.10) * hold : -0.18 * hold;
        const rightZ = rightGrip ? 0.10 + (rightGrip.roll - 0.10) * hold : 0.18 * hold;
        limb(ch.parts.la, leftX, 0.05, leftZ, 0.04 * hold);
        limb(ch.parts.ra, rightX, -0.05, rightZ, 0.04 * hold);
        setElbow(J.la, leftGrip ? -0.18 + (leftGrip.elbow + 0.18) * hold : -0.20 - hold * 0.82, sr);
        setElbow(J.ra, rightGrip ? -0.18 + (rightGrip.elbow + 0.18) * hold : -0.20 - hold * 0.82, sr);
        // One knee drives high first, the other leg trails and then switches —
        // the asymmetry is the difference between hauling a body up and levitating.
        const switchLeg = smooth01((u - 0.52) / 0.34);
        limb(ch.parts.ll, -0.10 - pull * (1.18 - switchLeg * 0.48), 0, 0.08, 0);
        limb(ch.parts.rl, -0.08 - pull * (0.58 + switchLeg * 0.54), 0, -0.08, 0);
        setKnee(J.ll, 0.08 + pull * (1.18 - switchLeg * 0.52), sr);
        setKnee(J.rl, 0.08 + pull * (0.62 + switchLeg * 0.56), sr);
        if (ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
        }
        if (ch.neck) {
          ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.18 * hold, sr, dt);
          ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
        }
      } else {
        // Low/medium obstacles use a small style vocabulary. Physics alternates
        // controlled styles for ordinary Jump and lets sprint momentum unlock
        // the spy spin. All three plant at least one hand, but the hips/legs
        // carry a different silhouette.
        const plant = Math.sin(Math.PI * clamp01((u - 0.03) / 0.88));
        const tuck = Math.sin(Math.PI * clamp01((u - 0.12) / 0.82));
        if (tp.style === "kong") {
          ch.body.position.y = damp(ch.body.position.y, -0.16 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.50 * plant, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
          limb(ch.parts.la, -0.18 - 1.62 * plant, 0.08, -0.16, 0.16 * plant);
          limb(ch.parts.ra, -0.18 - 1.62 * plant, -0.08, 0.16, 0.16 * plant);
          setElbow(J.la, -0.18 - plant * 0.34, sr);
          setElbow(J.ra, -0.18 - plant * 0.34, sr);
          limb(ch.parts.ll, -0.12 - tuck * 1.18, 0, 0.11, 0);
          limb(ch.parts.rl, -0.12 - tuck * 1.18, 0, -0.11, 0);
          setKnee(J.ll, 0.08 + tuck * 1.48, sr);
          setKnee(J.rl, 0.08 + tuck * 1.48, sr);
        } else if (tp.style === "spin") {
          // Sprint-only spy vault: spend the opening beat reaching/planting,
          // ease through one full revolution, then leave a recovery beat before
          // landing. Quintic easing has zero angular acceleration at each end,
          // so the roll reads as a deliberate body move rather than a transform
          // snapping through 360 degrees.
          const spinPhase = smoother01((u - 0.08) / 0.80);
          const handPlant = Math.sin(Math.PI * clamp01((u - 0.01) / 0.40)) *
            (u < 0.41 ? 1 : 0);
          const commit = smoother01(u / 0.20);
          ch.body.position.y = damp(ch.body.position.y, -0.13 * air, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.16 * air, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.12 * air, sr, dt);
          limb(ch.parts.la, -0.22 - 1.38 * handPlant, 0.18, -0.34 - 0.46 * air, 0.12 * handPlant);
          limb(ch.parts.ra, -0.24 - 0.56 * air, -0.18, 0.66 + 0.24 * air, 0.04);
          setElbow(J.la, -0.24 - handPlant * 0.48, sr);
          setElbow(J.ra, -0.32 - air * 0.42, sr);
          limb(ch.parts.ll, -0.16 - tuck * 0.82, 0, 0.18, 0);
          limb(ch.parts.rl, -0.12 - tuck * 1.02, 0, -0.18, 0);
          setKnee(J.ll, 0.10 + tuck * 1.02, sr);
          setKnee(J.rl, 0.10 + tuck * 1.28, sr);
          if (ch.model) {
            ch.model.rotation.x = -0.08 * air * commit;
            ch.model.rotation.y = 0.08 * air * commit;
            ch.model.rotation.z = -Math.PI * 2 * spinPhase;
          }
        } else {
          // One-hand speed vault: plant left, throw the opposite arm back, split
          // the legs sideways and let the hips skim the obstacle.
          ch.body.position.y = damp(ch.body.position.y, -0.12 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.34 * plant, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.34 * air, sr, dt);
          limb(ch.parts.la, -0.18 - 1.66 * plant, 0.10, -0.42, 0.16 * plant);
          limb(ch.parts.ra, 0.36 * air, -0.16, 0.72 * air, 0);
          setElbow(J.la, -0.16 - plant * 0.26, sr);
          setElbow(J.ra, -0.38 - air * 0.18, sr);
          limb(ch.parts.ll, -0.18 - tuck * 0.48, 0.18, 0.58 * air, 0);
          limb(ch.parts.rl, -0.14 - tuck * 0.92, -0.12, -0.24 * air, 0);
          setKnee(J.ll, 0.08 + tuck * 0.62, sr);
          setKnee(J.rl, 0.08 + tuck * 1.18, sr);
        }
        if (tp.style !== "spin" && ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
        }
        if (ch.neck) {
          ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.16 * air, sr, dt);
          ch.neck.rotation.z = damp(ch.neck.rotation.z, tp.style === "spin" ? 0.12 * air : 0, sr, dt);
        }
      }
      ch.bob = ch.body.position.y;
      ch.lean = ch.body.rotation.x;
      ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;                 // reuse the proven full-pose neck recovery
      ch._traverseRecover = 1;
      lockCharacterHips(ch);
      return;
    }
    // The model node is normally scale-only. A spy vault temporarily rolls it;
    // settle all three axes after any natural finish/interruption before gait
    // takes over. Most frames pay one falsy branch.
    if (ch._traverseRecover && ch.model) {
      ch.model.rotation.x = damp(ch.model.rotation.x, 0, 16, dt);
      ch.model.rotation.y = damp(ch.model.rotation.y, 0, 16, dt);
      ch.model.rotation.z = damp(ch.model.rotation.z, 0, 16, dt);
      if (Math.abs(ch.model.rotation.x) + Math.abs(ch.model.rotation.y) +
          Math.abs(ch.model.rotation.z) < 0.01) {
        ch.model.rotation.set(0, 0, 0);
        ch._traverseRecover = 0;
      }
    }

    // ---- STANCE POSES (physics.js stance machine sets slidePose/pronePose
    //      on the player rig only). Both OWN the whole rig like the seated
    //      pose: every write is a damp toward an absolute target, so entering
    //      /leaving flows and nothing can accumulate frame over frame (the
    //      grapple.js brace-pose lesson). The bob/lean/sway accumulators are
    //      kept in sync with what we wrote so the locomotion path's direct
    //      assignments resume from OUR pose instead of snapping; the neck has
    //      no locomotion owner, so _stanceNk arms a recovery damp below. ----
    if (ch.slidePose) {
      // COD power slide: lean-back torso, legs thrust FEET-FIRST down the
      // travel line (lead leg long, trail leg tucked), trailing hand planted
      // behind the hip, lead arm carried forward for balance, chin up.
      const sr = 13;
      ch.body.position.y = damp(ch.body.position.y, -0.52, sr, dt);    // hips drop toward the heels
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.42, sr, dt);    // shoulders pitched BACK off the hips
      ch.body.rotation.y = damp(ch.body.rotation.y, 0.14, sr, dt);     // quarter-turn onto the planted hand
      ch.body.rotation.z = damp(ch.body.rotation.z, 0.10, sr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.28, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.10, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      setKnee(J.ll, 0.18, sr);                                         // lead leg near-straight
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -0.82, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.08, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      setKnee(J.rl, 0.85, sr);                                         // trail knee tucked under
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, 0.55, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.55, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); }
      setElbow(J.ra, -0.15, sr);                                       // planted arm long behind
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.85, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.15, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); }
      setElbow(J.la, -0.55, sr);                                       // balance arm reaching the line
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.30, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // the slide owns the whole rig
    }
    if (ch.pronePose) {
      // PRONE: the upper body hinges flat at the hips (chest to the deck) and
      // the legs sweep back level — a plank at hip height that physics.js
      // sinks to the ground via _proneB. Arms carry the weapon FORWARD on
      // planted elbows (the LMG firing position); a slow alternating paddle
      // sells the crawl when moving.
      const pr = 9;
      if (speed > 0.2) ch.phase += dt * (2.2 + speed * 2.0);           // crawl cadence (gait phase is idle here)
      const pad = speed > 0.2 ? Math.sin(ch.phase) : 0;
      ch.body.position.y = damp(ch.body.position.y, 0.02, pr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0, pr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, PRONE_PITCH, pr, dt);     // hinge flat, chest down
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, pr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, pad * 0.06, pr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, PRONE_LEG_PITCH + 0.03 + pad * 0.14, pr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.10, pr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, pr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, pr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, PRONE_LEG_PITCH - 0.03 - pad * 0.14, pr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.10, pr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, pr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, pr, dt); }
      setKnee(J.ll, 0.06, pr); setKnee(J.rl, 0.12, pr);                // legs lie flat, not folded
      // ELBOWS ON THE DECK, HANDS UP AT THE GUN. See the derivation by
      // PRONE_ARM_PITCH: the shipped -1.32/-1.40 shoulders drove both arms
      // straight DOWN through the floor and took the weapon with them. `gunK`
      // eases between the empty-handed crawl (forearms flat on the ground) and
      // the firing position (forearms up to the weapon); it is published by the
      // ground-rest pass below off the actual socketed prop, so an unarmed body
      // never holds an invisible rifle.
      const rec = ch.aimRecoil || 0;
      const legacyArms = CBZ.CONFIG && CBZ.CONFIG.CHAR_PRONE_GUN_POSE === false;
      const gunK = legacyArms ? 0 : (ch._gunPoseK || 0);
      const upperA = legacyArms ? -1.32 : PRONE_ARM_PITCH;
      const foreA = legacyArms ? -0.35 : PRONE_FORE_EMPTY + (PRONE_FORE_ARMED - PRONE_FORE_EMPTY) * gunK;
      // The support side plants a touch deeper and reaches a touch further
      // under the handguard; recoil rocks the gun shoulder back, never down.
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, upperA + rec * 0.10 - pad * 0.05, pr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.10, pr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.18, pr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, legacyArms ? 0.10 : 0, pr, dt); }
      setElbow(J.ra, foreA + rec * 0.10, pr);
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (legacyArms ? -1.40 : upperA - 0.08) + pad * 0.05, pr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.15, pr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.30, pr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, legacyArms ? 0.14 : 0, pr, dt); }
      setElbow(J.la, legacyArms ? -0.75 : foreA + 0.06, pr);           // support elbow dug in
      // head comes UP behind the gun once there is a gun to look over
      const neckT = legacyArms ? PRONE_NECK_EMPTY
        : PRONE_NECK_EMPTY + (PRONE_NECK_ARMED - PRONE_NECK_EMPTY) * gunK;
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, neckT, pr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, pr, dt); }
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // prone owns the whole rig
    }
    // stance blend-out: the branches above own the neck while active and
    // nothing in the locomotion path below ever writes it — recover it here
    // (a few frames of damp) so an exited slide/prone can't park the chin.
    // Armed only by the stance poses; every other rig skips at one falsy check.
    if (ch._stanceNk) {
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, 0, 8, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, 8, dt); }
      if (!ch.neck || Math.abs(ch.neck.rotation.x) < 0.01) ch._stanceNk = 0;
    }

    // Gait advances with DISTANCE TRAVELLED, not frame count. `phase` is an
    // angle in radians and alternate footfalls are PI radians apart. The old
    // code added distance/stepLength directly, accidentally treating ONE
    // radian as a complete step. Its distance term alone implied ~3.6m between
    // footfalls, which made every actor read as a slow-motion jogger at full FPS.
    // Convert travelled steps to radians, and lengthen the step modestly as a
    // run opens up so sprint cadence stays quick without turning into a buzz.
    // GAIT STYLE: a set of MULTIPLIERS on the literals below, carried by the
    // body profile the rig was built from (character profile → rig.gait).
    // Every multiplier is 1 for the adult male, so an un-profiled or legacy rig
    // is bit-for-bit the motion this game has always had. Nothing here adds an
    // animation STATE — a woman and a toddler run the same code as everyone
    // else, weighted differently. That is why all ~15 makeCharacter call sites
    // get the new motion without a line of change.
    const GA = ch.gait || GAIT_NEUTRAL;
    ch.phase += gaitPhaseDelta(speed, dt, walkRef, GA.step);
    const sinP = Math.sin(ch.phase), cosP = Math.cos(ch.phase);
    // CROUCH is a real pose now (hips drop, knees fold, torso hinges forward),
    // not the old whole-group scale.y accordion squash. cb eases 0→1 so
    // entering/leaving a crouch flows through the same damped targets.
    ch._cb = damp(ch._cb || 0, ch.crouch ? 1 : 0, 12, dt);
    const cb = ch._cb;
    const hipAmp = (0.30 + 0.26 * norm + 0.16 * run2) * (1 - 0.35 * cb) * GA.hipAmp;
    const swing = sinP * hipAmp;

    // ---- LEG WOUND / LIMP STATE ----
    let lh = ch.legHurt;
    if (lh) {
      lh.t -= dt;
      if (lh.sev < 0.5) lh.sev = Math.max(0, lh.sev - dt * (0.5 / 20));
      if (lh.sev <= 0.001 || lh.t <= 0) { ch.legHurt = null; lh = null; }
    }
    // STALE-FLAG GUARD: a pooled rig promoted with legGone still set for a
    // frame walks folded face-down; the hidden leg mesh is ground truth.
    if (ch.legGone) {
      const gonePart = ch.legGone < 0 ? ch.parts.ll : ch.parts.rl;
      if (gonePart && gonePart.visible !== false) { ch.legGone = 0; }
    }
    const legGone = ch.legGone;                     // -1 left / +1 right / 0|undef
    const hurtSide = lh ? lh.side : 0;
    const sev = lh ? Math.min(1, lh.sev) : 0;
    ch.limpSpeedMul = legGone ? 0.0 : (1 - sev * 0.5);

    // ---- legs: opposed hip swing + biomechanical knee flexion ----
    const legRate = 16, armRate = 14;
    const lSwing = moving ? swing * (hurtSide < 0 ? 1 - sev * 0.62 : 1) : 0;
    const rSwing = moving ? -swing * (hurtSide > 0 ? 1 - sev * 0.62 : 1) : 0;
    const lBend = hurtSide < 0 ? sev * 0.22 : 0;
    const rBend = hurtSide > 0 ? sev * 0.22 : 0;
    const crouchHip = cb * 0.52;                 // thighs fold toward the chest
    ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, lSwing - lBend - crouchHip, legRate, dt);
    ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, rSwing - rBend - crouchHip, legRate, dt);
    // CROSS-LEG GUARD: pose layers own z/y; recycled corpse splay must not
    // ride into a fresh walker (animChar only runs on live upright actors).
    // STEP WIDTH lives on this channel: the guard damps toward the body's OWN
    // stance instead of a flat zero, so a woman keeps her narrow near-midline
    // walk and a toddler keeps its wide base every frame. Absent (legacy rig)
    // reads 0 — the exact old behaviour.
    const stZ = ch.stanceZ || 0;
    ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, stZ, 12, dt);
    ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -stZ, 12, dt);
    ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, 12, dt);
    ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, 12, dt);
    // the old scale.y foot-lift fake dies — real knees carry the clearance
    ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, 16, dt);
    ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, 16, dt);

    // knees: flex through the swing phase (left swings forward while cosθ<0,
    // peaking mid-swing), carry a small stance flexion so legs never look
    // hyper-extended, plus a load-response dip right after heel strike.
    const kneeAmp = (0.62 + 0.55 * norm + 0.55 * run2) * GA.knee;   // sprint kicks heels up
    // stanceKnee is ADDED, not multiplied: a new walker never straightens the
    // knee through stance at all (Sutherland 1980), which is a large part of
    // why a toddler's walk reads as a toddler's and not a small adult's.
    const stanceK = (moving ? 0.10 + 0.10 * norm : 0.04) + GA.stanceKnee;
    const kneeL = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, -cosP), 1.3) * (hurtSide < 0 ? 1 - sev * 0.7 : 1) : 0.04;
    const kneeR = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, cosP), 1.3) * (hurtSide > 0 ? 1 - sev * 0.7 : 1) : 0.04;
    setKnee(J.ll, kneeL + lBend * 1.4 + cb * 1.00, legRate);
    setKnee(J.rl, kneeR + rBend * 1.4 + cb * 1.00, legRate);

    // ---- arms ----
    if (ch.aimingPose) {
      // present-weapon: gun arm out along the crosshair, support arm on the
      // handguard. animChar is the single owner of the arms while aiming.
      const longGun = !!ch.aimLong;
      const recoil = ch.aimRecoil || 0;
      const recoilSide = ch.aimRecoilSide || 0;
      const pitch = (CBZ.cam && typeof CBZ.cam.pitch === "number") ? CBZ.cam.pitch : 0;
      const ar = 16;
      // WEIGHT IS THE WEAPON'S, THE POSE IS THE BODY'S (weapon-data.js `hold`,
      // published by fpsmode as aimHeavy/aimSupport). A 7.5 kg belt-fed gun is
      // not shouldered like a 9 mm: the support hand runs FORWARD onto the
      // handguard, its elbow closes under the receiver to carry the mass, and
      // the firing shoulder rides a touch lower instead of squared up at the
      // horizon. hv is 0 for every weapon that declares no `hold`, and every
      // term below is + 0 at hv = 0 — so nothing that ships today moves.
      const hv = heavyHold(ch), hsup = heavySupport(ch);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.571 + 0.12 * hv - pitch * 0.8 - recoil * 0.16, ar, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.18 - recoilSide * 0.22, ar, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.34, ar, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.14, ar, dt);
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (longGun ? -1.55 : -1.45) - 0.14 * hv - pitch * 0.8, ar - 1, dt);
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, (longGun ? -0.34 : -0.22) - 0.10 * hv, ar - 1, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, longGun ? -0.42 : -0.30, ar - 1, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, (longGun ? 0.24 : 0.14) + hsup * 0.5, ar - 1, dt);
      // gun arm nearly locked; the support elbow closes onto the handguard.
      // recoil folds the elbow a touch — the arm absorbs the kick.
      setElbow(J.ra, -0.10 - recoil * 0.25, ar);
      setElbow(J.la, (longGun ? -0.72 : -0.48) - 0.26 * hv, ar - 1);
    } else if (ch.cuffed) {
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, 0.5, 10, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, 0.5, 10, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.5, 10, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.5, 10, dt);
      setElbow(J.la, -0.55, 10); setElbow(J.ra, -0.55, 10);
    } else if (ch.surrender || ch.handsUp) {
      // the hands-up layer below OWNS the arms — if the idle counter-swing
      // also wrote them, the two damps fight and the arms equilibrate at a
      // half-raised ~40° (filmstrip-diagnosed) instead of reaching the pose.
    } else if (ch.carryPose) {
      // LOW-READY carry (player TP, armed but not presenting — systems/
      // fpsmode.js owns the flag): the gun arm hangs low-forward so the
      // weapon rides at the hip pointing down-forward (~45°, RDR2/Fortnite
      // carry) instead of squared-up at the horizon; the left arm keeps the
      // normal relaxed counter-swing so walking still reads human. A touch
      // of gait/breath bob on the gun arm keeps it alive without waving the
      // muzzle around. Cuffed/surrender above outrank the carry; the moment
      // fpsmode flips aimingPose (RMB/fire/recoil-settle) the present pose
      // branch takes over through the same damps — smooth raise/lower.
      // (rotation.y / position.z stay owned by the !aimingPose reset below.)
      const cr = 12;
      const carryBob = moving ? swing * 0.10 : Math.sin(ch.breath * 2.2) * 0.02;
      const hvC = heavyHold(ch), hsupC = heavySupport(ch);
      if (ch.aimLong === false) {
        // PISTOL carry (screenshot-diagnosed): the tucked across-the-hip arm
        // hid a holstered-size gun completely behind the torso from the chase
        // camera. Sidearms hang LOW BESIDE the thigh instead — arm nearly
        // straight, hand pushed just clear of the leg so the gun silhouettes
        // against the ground from behind (GTA/Fortnite pistol walk).
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.18 + carryBob * 0.5, cr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.16, cr, dt);  // out from the actual right thigh
        setElbow(J.ra, -0.12, cr);
      } else {
        // LONG-GUN carry (screenshot-diagnosed, round 2): the old tuck-across-
        // the-hip (rotation.z -0.14) parked the gun-hand at the body's CENTRE,
        // so the whole rifle's AABB fell INSIDE the torso box and rendered as
        // nothing from the chase cam (owner: "can't see the drawn gun in hand").
        // Push the gun-hand OUT beside the right thigh — same fix that made the
        // pistol carry read — so the rifle's mass clears the torso silhouette;
        // holsterprops.js then hangs the barrel down-forward-right past the leg.
        // HEAVY (weapon-data.js hold.heavy): the mass hangs, so the firing arm
        // straightens toward the vertical and the gun rides LOWER beside the
        // thigh instead of being held out in front of the hip like a carbine.
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.30 + 0.15 * hvC + carryBob * 0.7, cr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.20 - 0.05 * hvC, cr, dt);   // OUT from the actual right thigh
        setElbow(J.ra, -0.34 + 0.16 * hvC, cr);          // forearm angles the gun down-forward
      }
      if (ch.aimLong === true) {
        // Rifles and shotguns remain two-hand objects even at low ready: the
        // support forearm stays under the handguard instead of swinging loose.
        // …and the heavier it is, the LOWER that hand has to go: a carbine's
        // handguard rides at chest height, a belt-fed gun's hangs beside the
        // thigh because the gun does. The shipped -0.72/-0.82 pair puts the
        // support forearm across the CHEST, which on an LMG left the left hand
        // half a metre above a gun it was supposedly holding (screenshot-
        // diagnosed, this wave). Straighten the arm down and bring it further
        // ACROSS (rotation.z is negative toward the gun side) so it meets the
        // handguard where the handguard actually is.
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.72 + 0.58 * hvC + carryBob * 0.35, cr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.30 - 0.08 * hvC, cr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.38 - 0.22 * hvC, cr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.18 + hsupC * 0.5, cr, dt);
        setElbow(J.la, -0.82 + 0.52 * hvC, cr);
      } else {
        const armAmp = hipAmp * (0.95 + 0.25 * run2);
        const laTarget = moving ? swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, laTarget, armRate, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.08, 6, dt);
        const elbBase = moving ? 0.30 + 0.42 * norm + 0.62 * run2 : 0.22 + Math.sin(ch.breath * 2.2) * 0.02;
        const foldL = moving ? Math.max(0, -laTarget) * 0.8 : 0;
        setElbow(J.la, -(elbBase + foldL), armRate - 2);
      }
    } else if (ch.pose && !moving && CBZ.charPoses && CBZ.charPoses[ch.pose]) {
      // ---- HELD POSE (shared registry — entities/poses.js) ----
      // A planted actor's static pose: a dealer's hands over the felt, folded
      // arms, hands resting on the table. ONLY when idle — a walk falls through
      // to the counter-swing below (walk/panic override the pose), and
      // aiming/cuffed/surrender/carry above all outrank it (HANDS-UP wins). The
      // pose OWNS the arms this frame, so it reaches its target instead of
      // equilibrating half-way against the idle damp. ONE system shared by the
      // ped brain (peds.js sets ch.pose) and game packages (packages.js ctx.npc).
      CBZ.charPoses[ch.pose](ch, dt);
    } else {
      // counter-swing with an elbow that deepens with pace: relaxed ~14° at
      // idle, a soft 35-45° at a walk, a real ~90° runner's pump at sprint.
      // The elbow also folds a little extra as the arm swings FORWARD (a
      // straight back-swing + bent fore-swing is what reads "human").
      // Men recruit the shoulders and arms more; women hold the upper body
      // quieter and let the pelvis do the work (Bruening 2015). GA.armAmp
      // carries that, and it is also what silences a new walker's arms —
      // reciprocal arm swing does not appear until ~18 months.
      const armAmp = hipAmp * (0.95 + 0.25 * run2) * GA.armAmp;
      const laTarget = moving ? swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      const raTarget = moving ? -swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      // HIGH GUARD: before a toddler can balance, the arms ride up and out to
      // the sides like a tightrope walker. It is the single most recognisable
      // thing about a new walker and it costs one blend on channels the idle
      // carry already owns. guard is 0 for every other body, so this whole
      // block collapses to exactly the old targets.
      const gd = GA.guard || 0;
      const carryZ = ch.armOutZ != null ? ch.armOutZ : -0.08;
      const outZ = carryZ + gd * 0.85;                 // arms swing wide of the ribs
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, laTarget * (1 - gd) - gd * 0.55, armRate, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, raTarget * (1 - gd) - gd * 0.55, armRate, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, outZ, 6, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -outZ, 6, dt);
      const elbBase = moving ? 0.30 + 0.42 * norm + 0.62 * run2 : 0.22 + Math.sin(ch.breath * 2.2) * 0.02;
      const foldL = moving ? Math.max(0, -laTarget) * 0.8 : 0;   // forward swing folds
      const foldR = moving ? Math.max(0, -raTarget) * 0.8 : 0;
      setElbow(J.la, -(elbBase + foldL + gd * 0.55), armRate - 2);
      setElbow(J.ra, -(elbBase + foldR + gd * 0.55), armRate - 2);
    }
    if (!ch.aimingPose) {
      if (!(ch.carryPose && ch.aimLong === true)) {
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, 10, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, 12, dt);
      }
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, 10, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0, 12, dt);
    }

    // ---- body: bob (2× stride), side sway, forward lean, counter-rotation --
    // CoM is lowest at double support (feet furthest apart, |sinθ| max).
    const bobTarget = (moving ? -Math.abs(sinP) * (0.03 + 0.05 * norm + 0.03 * run2) * GA.bob : 0) - cb * 0.38;
    const idleBreath = moving ? 0 : Math.sin(ch.breath * 2.2) * 0.012;
    ch.bob = damp(ch.bob, bobTarget, 12, dt);
    ch.body.position.y = ch.bob + idleBreath;
    // The upper-body group is authored in model space with its origin at the
    // feet, while the legs pivot at the hips.  Pitching that group to create a
    // run lean therefore used to swing the whole chest forward around the
    // ankles — at a sprint the torso visibly detached and ran in front of the
    // legs.  Reset the longitudinal channel every locomotion frame; after the
    // lean is known below we compensate the foot-origin transform so it behaves
    // exactly like a rotation about the shared hip socket instead.
    ch.body.position.z = 0;

    // weight shifts over the stance foot; a touch of idle sway keeps a
    // standing rig alive instead of statue-frozen. Turning while moving BANKS
    // the body into the turn like a runner rounding a corner — yaw rate is
    // derived from the root's facing so no caller has to pass anything.
    let turnBank = 0;
    if (ch.group) {
      const yaw = ch.group.rotation.y;
      if (ch._prevYaw !== undefined && dt > 0.0001) {
        let dy = yaw - ch._prevYaw;
        if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
        const yawRate = Math.max(-6, Math.min(6, dy / dt));
        turnBank = moving ? -yawRate * 0.045 * (0.4 + 0.6 * norm) : 0;
      }
      ch._prevYaw = yaw;
    }
    // GA.sway scales only the GAIT term — turn-bank is physics and must not be
    // sexed. This channel is the rig's stand-in for pelvic obliquity (there is
    // no separate pelvis pivot), and it is the loudest female cue in motion:
    // women carry markedly more pelvic obliquity than men (Cho 2004), and it
    // reads from every angle at 30m where a waistline does not.
    const swayTarget = (moving ? sinP * (0.015 + 0.03 * norm) * GA.sway : Math.sin(ch.breath * 0.9) * 0.012) + turnBank;
    ch.sway = damp(ch.sway, swayTarget, 10, dt);
    ch.body.rotation.z = ch.sway;

    const leanTarget = norm * 0.12 + run2 * 0.10 + cb * 0.16;   // lean into the run / hunch the crouch
    ch.lean = damp(ch.lean, leanTarget, 8, dt);
    ch.body.rotation.x = ch.lean;
    // shoulders counter-rotate the stride (right shoulder leads the left
    // foot): subtle at a walk, pronounced at a sprint. The punch layer OWNS
    // body.rotation.y while active, so only write it here when not punching.
    const yGait = moving ? sinP * (0.05 + 0.05 * norm + 0.05 * run2) * GA.yaw : 0;

    // ---- LIMP: the body dips toward the hurt leg as it bears weight ----
    if (sev > 0.02 && moving && !legGone) {
      const plant = hurtSide < 0 ? Math.max(0, -sinP) : Math.max(0, sinP);
      ch.body.position.y -= plant * sev * 0.09;
      ch.body.rotation.z += hurtSide * plant * sev * 0.16;
    }

    // ---- LEG SEVERED: sink into a low crawl/collapse ----
    if (legGone) {
      const crawl = moving ? sinP : 0;
      ch.body.position.y = damp(ch.body.position.y, -0.85, 8, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.95, 8, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, legGone * 0.45, 8, dt);
      const goodLeg = legGone < 0 ? ch.parts.rl : ch.parts.ll;
      const stumpLeg = legGone < 0 ? ch.parts.ll : ch.parts.rl;
      const goodKnee = legGone < 0 ? J.rl : J.ll;
      if (goodLeg) { goodLeg.rotation.x = damp(goodLeg.rotation.x, -0.5 + crawl * 0.5, 10, dt); goodLeg.scale.y = damp(goodLeg.scale.y, 1, 10, dt); }
      setKnee(goodKnee, 0.85 - crawl * 0.3, 10);
      if (stumpLeg) stumpLeg.rotation.x = damp(stumpLeg.rotation.x, -0.2, 10, dt);
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -1.5 + crawl * 0.6, 10, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.2, 10, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.5 - crawl * 0.6, 10, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.2, 10, dt); }
      setElbow(J.la, -0.7 - crawl * 0.25, 10); setElbow(J.ra, -0.7 + crawl * 0.25, 10);
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.5, 9, dt);
      lockCharacterHips(ch);
      return;   // a one-legged crawl owns the whole rig
    }

    // ---- punch: guard -> chamber -> drive (elbow whips open) -> recover.
    // The elbow is what makes it read: fists start UP by the chin (deep
    // bend), the strike extends the elbow through the target, the guard
    // hand STAYS at the jaw. Weight transfers through hips + a body dip.
    if (ch.punchT > 0) {
      ch.punchT -= dt;
      const dur = ch.punchDur || 0.28;
      const prog = 1 - Math.max(0, ch.punchT) / dur;    // 0..1 over the punch
      const wind = Math.max(0, 1 - prog / 0.24);        // anticipation
      const drive = Math.sin(Math.min(1, Math.max(0, (prog - 0.16) / 0.54)) * Math.PI);
      const recover = Math.max(0, (prog - 0.62) / 0.38);
      const left = ch.punchArm === "l";
      const arm = left ? ch.parts.la : ch.parts.ra;
      const guard = left ? ch.parts.ra : ch.parts.la;
      const armJ = left ? J.la : J.ra;
      const guardJ = left ? J.ra : J.la;
      const sgn = left ? 1 : -1;
      // guard hand: tucked at the jaw the whole time
      guard.rotation.x = -1.05 - 0.15 * drive;
      guard.rotation.z = -sgn * 0.42;
      guard.position.z = 0.10;
      if (guardJ) guardJ.rotation.x = -1.85;
      if (ch.punchKind === "upper") {                   // rising uppercut
        // fist drops to the waist on the wind, then the hips+shoulder launch
        // it UP THE CENTERLINE to the chin — upper arm stops forward-low
        // (~-0.9) with the elbow folded so the forearm is vertical at impact.
        // (Filmstrip-verified: driving the shoulder past horizontal put the
        // fist above the head — a superman punch, not an uppercut.)
        arm.rotation.x = 0.55 + 0.30 * wind - 1.48 * drive;
        arm.rotation.y = sgn * 0.18 * drive;
        arm.rotation.z = sgn * (0.18 + 0.10 * drive);
        arm.position.z = 0.04 + 0.16 * drive;
        if (armJ) armJ.rotation.x = -(1.20 + 0.45 * wind + 0.38 * drive);
        ch.body.rotation.x = ch.lean + 0.24 * wind - 0.26 * drive;
        ch.body.rotation.y = sgn * (0.30 * wind + 0.70 * drive - 0.18 * recover);
        ch.body.position.y += -0.12 * wind - 0.02 * drive;
      } else if (ch.punchKind === "hook") {             // wide hook
        // RAISE first (upper arm to horizontal, elbow locked ~90°), THEN the
        // body slings the folded arm around on a flat horizontal arc — the
        // yaw sweep only starts once the arm is up, so the fist tracks jaw
        // height instead of climbing (filmstrip-verified).
        const raise = Math.min(1, prog / 0.26);
        arm.rotation.x = -1.28 * raise;
        arm.rotation.y = sgn * (0.95 - 1.55 * drive) * raise;
        arm.rotation.z = sgn * (0.20 + 0.30 * drive);
        arm.position.z = 0.05 + 0.16 * drive;
        if (armJ) armJ.rotation.x = -(1.50 + 0.15 * drive);
        ch.body.rotation.x = ch.lean - 0.06 * drive;
        ch.body.rotation.y = sgn * (0.50 * wind + 1.00 * drive - 0.24 * recover);
        ch.body.position.y += -0.05 * drive;
      } else {                                          // straight jab/cross
        // fist chambers at the chin (deep elbow), shoulder drives forward as
        // the elbow SNAPS open — full extension at peak drive, fist stopping
        // at the chin height of a same-size opponent (-1.42, not overhead).
        arm.rotation.x = -0.95 + 0.15 * wind - 0.47 * drive + 0.22 * recover;
        arm.rotation.y = sgn * -0.16 * drive;
        arm.rotation.z = sgn * (0.16 + 0.10 * drive);
        arm.position.z = -0.04 * wind + 0.26 * drive;
        if (armJ) armJ.rotation.x = -(2.05 - 1.95 * Math.pow(drive, 1.4) + 0.15 * wind);
        ch.body.rotation.x = ch.lean - 0.12 * drive + 0.08 * wind;
        ch.body.rotation.y = sgn * (0.26 * wind + 0.62 * drive - 0.18 * recover);
        ch.body.position.y += -0.03 * drive;
      }
      // fighting stance while planted: staggered feet, knees soft, weight
      // rolls rear→front through the drive. Gait owns the legs when moving.
      if (!moving) {
        const lead = left ? ch.parts.rl : ch.parts.ll;     // opposite foot leads
        const rear = left ? ch.parts.ll : ch.parts.rl;
        const leadJ = left ? J.rl : J.ll;
        const rearJ = left ? J.ll : J.rl;
        if (lead) lead.rotation.x = damp(lead.rotation.x, -0.30 + 0.10 * drive, 14, dt);
        if (rear) rear.rotation.x = damp(rear.rotation.x, 0.26 + 0.10 * drive, 14, dt);
        setKnee(leadJ, 0.28 + 0.10 * drive, 14);
        setKnee(rearJ, 0.42 + 0.22 * drive, 14);           // rear knee drives in
        ch.body.position.y -= 0.06;                        // sits into the stance
      }
    } else {
      ch.body.rotation.y = damp(ch.body.rotation.y, yGait, 10, dt);
    }

    // ==== FIGHT LAYERS (all additive, all flag-gated: when the fight director
    // sets none of these, every block below is a single falsy check and the
    // frame is byte-identical to before). They run AFTER the punch block so a
    // director can layer/override mid-exchange; they SET pose values directly
    // (like the punch block) so the gait/idle damps above restore everything
    // automatically the frame after a flag clears. ====

    // ---- FIGHT STANCE idle: bladed, hands-up, ready. Only when not mid-move,
    // so any actual strike/reaction below (or the punch above) wins outright.
    if (ch.fightStance && !(ch.punchT > 0) && !(ch.kickT > 0) && !(ch.blockT > 0) &&
        !(ch.dodgeT > 0) && !(ch.staggerT > 0) && !(ch.koT > 0) && !ch.koPose &&
        !ch.aimingPose && !ch.carryPose && !ch.cuffed && !ch.surrender && !ch.handsUp) {
      ch.fightPh = (ch.fightPh || 0) + dt;              // own phase: weave, don't walk
      const w = Math.sin(ch.fightPh * 2.6);             // slow weave
      const w2 = Math.sin(ch.fightPh * 5.2 + 1.3);      // faster forearm pump
      // forearms up near the chin, tucked slightly inward, a touch forward
      ch.parts.la.rotation.x = -0.9 + w2 * 0.05;
      ch.parts.la.rotation.z = -0.26;
      ch.parts.la.rotation.y = 0.1;
      ch.parts.la.position.z = 0.1;
      ch.parts.ra.rotation.x = -0.98 - w2 * 0.05;
      ch.parts.ra.rotation.z = 0.26;
      ch.parts.ra.rotation.y = -0.1;
      ch.parts.ra.position.z = 0.1;
      // bladed torso + subtle rhythmic weave; soft knees when standing still
      ch.body.rotation.y = -0.18 + w * 0.1;
      ch.body.rotation.x = ch.lean + 0.08;
      ch.body.rotation.z = ch.sway + w * 0.04;
      if (!moving) {
        ch.body.position.y -= 0.05 + w * 0.02;          // sit into the stance, bob
        ch.parts.ll.scale.y = 0.96;
        ch.parts.rl.scale.y = 0.96;
      }
    }

    // ---- KICK: chamber -> extend -> recover, same envelope family as the
    // punch. kickKind "front" (default) snaps the foot straight out with the
    // torso leaning back; "round" whips the leg around the side off a hip turn.
    if (ch.kickT > 0) {
      ch.kickT -= dt;
      const kdur = ch.kickDur || 0.5;
      const kprog = 1 - Math.max(0, ch.kickT) / kdur;
      const kwind = Math.max(0, 1 - kprog / 0.24);
      const kdrive = Math.sin(Math.min(1, Math.max(0, (kprog - 0.16) / 0.54)) * Math.PI);
      const krec = Math.max(0, (kprog - 0.62) / 0.38);
      const kleft = ch.kickLeg === "l";
      const kleg = kleft ? ch.parts.ll : ch.parts.rl;
      const kplant = kleft ? ch.parts.rl : ch.parts.ll;
      const ksgn = kleft ? 1 : -1;
      if (ch.kickKind === "round") {                    // roundhouse off the hip
        const kswp = Math.min(1, kprog / 0.7);
        kleg.rotation.x = 0.28 * kwind - 1.3 * kdrive;
        kleg.rotation.y = ksgn * (0.3 - 1.35 * kswp) * kdrive;   // sweeps around the side
        kleg.rotation.z = ksgn * (0.5 * kdrive + 0.15 * kwind);  // splayed out through the arc
        kleg.scale.y = 1 - 0.1 * kwind;                          // slight chamber shortening
        ch.body.rotation.y = ksgn * (0.3 * kwind + 1.0 * kdrive - 0.3 * krec);  // big hip turn
        ch.body.rotation.x = ch.lean - 0.18 * kdrive;
        ch.body.rotation.z = -ksgn * 0.14 * kdrive;              // counter-tilt over the plant leg
      } else {                                          // front snap kick
        kleg.rotation.x = 0.35 * kwind - 1.75 * kdrive + 0.2 * krec;  // cock back, drive up
        kleg.rotation.y = 0;
        kleg.rotation.z = ksgn * 0.06;
        kleg.scale.y = 1 - 0.2 * kwind - 0.06 * (1 - kdrive);    // knee chamber, straight at impact
        ch.body.rotation.x = ch.lean - 0.3 * kdrive + 0.08 * kwind;  // torso leans back
        ch.body.rotation.y = ksgn * 0.16 * kdrive;
      }
      // plant the standing leg: braced, soft knee, no swing
      kplant.rotation.x = 0.14 * kdrive;
      kplant.rotation.y = 0;
      kplant.scale.y = 1 - 0.05 * kdrive;
      // arms counter-balance out and back
      ch.parts.la.rotation.x = -0.4 * kdrive - 0.1 * kwind;
      ch.parts.ra.rotation.x = -0.4 * kdrive - 0.1 * kwind;
      ch.parts.la.rotation.z = 0.55 * kdrive + 0.08;
      ch.parts.ra.rotation.z = -0.55 * kdrive - 0.08;
      ch.body.position.y -= 0.05 * kdrive;              // sink into the plant leg
    }

    // ---- BLOCK / GUARD: both forearms up in front of the face, torso hunched.
    // Onset eases in via a small accumulator (reset when the timer runs out);
    // release is free — the gait damps above pull everything home next frame.
    if (ch.blockT > 0) {
      ch.blockT -= dt;
      ch.blockK = Math.min(1, (ch.blockK || 0) + dt * 12);   // quick raise
      const bk = ch.blockK;
      // optional impact jitter: director sets ch.blockHitT (~0.15) on a blocked hit
      let bjit = 0;
      if (ch.blockHitT > 0) {
        ch.blockHitT -= dt;
        bjit = Math.sin(ch.blockHitT * 55) * Math.max(0, ch.blockHitT) * 0.8;
      }
      ch.parts.la.rotation.x = (-1.5 + bjit * 0.12) * bk;
      ch.parts.la.rotation.z = -0.35 * bk;              // tuck inward
      ch.parts.la.rotation.y = 0.12 * bk;
      ch.parts.la.position.z = 0.12 * bk;
      ch.parts.ra.rotation.x = (-1.5 - bjit * 0.12) * bk;
      ch.parts.ra.rotation.z = 0.35 * bk;
      ch.parts.ra.rotation.y = -0.12 * bk;
      ch.parts.ra.position.z = 0.12 * bk;
      ch.body.rotation.x = ch.lean + (0.16 + bjit * 0.05) * bk;   // hunch behind the guard
      ch.body.position.y -= 0.04 * bk;
      if (ch.blockT <= 0) ch.blockK = 0;                // clean slate for the next guard
    }

    /* ---- REACH: the hand that goes somewhere it should not be.
       THE GAP THIS FILLS, stated by the file that hit it (systems/economy.js's
       failed-lift comment): "there is no pickpocket ARM ANIMATION anywhere on
       the rig — punch/kick/block and nothing between idle and strike." A lift
       was therefore a sound and a number: the one physical act in the prison
       nobody could SEE happen.

       It is deliberately NOT a strike. A strike chambers, drives and snaps
       back; a reach is slow at the wrist, quiet in the torso and the head
       looks AWAY from the hand — the whole tell of a pickpocket is that he is
       looking at your face while his hand is at your hip. Envelope: extend →
       DWELL (the grab, `reachHold`) → withdraw, so the pause in the middle is
       the beat where the thing changes hands.

       Additive and flag-free like every layer above: one falsy check when the
       director sets nothing, and the gait/idle damps restore the arm by
       themselves the frame after the timer clears. Callers use CBZ.charReach.
         ch.reachT/reachDur   timer + total length (default 0.62 s)
         ch.reachArm          "l" | "r" (default "r")
         ch.reachSide         -1 across the body / +1 out to the side / 0 front
         ch.reachHigh         0 hip pocket (default) .. 1 chest/collar
         ch.reachAmt          0..1 how far the body commits (default 1) */
    if (ch.reachT > 0) {
      ch.reachT -= dt;
      const rdur = ch.reachDur || 0.62;
      const rprog = 1 - Math.max(0, ch.reachT) / rdur;
      // extend over the first 30%, hold flat through the middle, withdraw last
      const rout = Math.min(1, rprog / 0.30);
      const rback = Math.max(0, (rprog - 0.62) / 0.38);
      const renv = Math.max(0, rout - rback) * (ch.reachAmt == null ? 1 : ch.reachAmt);
      const rleft = ch.reachArm === "l";
      const rarm = rleft ? ch.parts.la : ch.parts.ra;
      const rother = rleft ? ch.parts.ra : ch.parts.la;
      const rarmJ = rleft ? J.la : J.ra;
      const rsgn = rleft ? 1 : -1;
      const high = ch.reachHigh || 0;               // 0 = hip pocket, 1 = collar
      const across = ch.reachSide == null ? -1 : ch.reachSide;
      if (rarm) {
        // upper arm swings forward and slightly down; the elbow stays soft so
        // the hand hangs at pocket height instead of pointing like a salute
        rarm.rotation.x = (-0.62 - 0.55 * high) * renv;
        rarm.rotation.y = rsgn * across * 0.30 * renv;
        rarm.rotation.z = rsgn * (0.20 - 0.26 * high) * renv;
        rarm.position.z = 0.16 * renv;
      }
      if (rarmJ) rarmJ.rotation.x = -(0.85 - 0.30 * high) * renv;
      // the OTHER hand drifts up and out — the distraction, the friendly touch
      if (rother) {
        rother.rotation.x = -0.34 * renv;
        rother.rotation.z = -rsgn * 0.22 * renv;
      }
      // torso turns a little INTO the reach and leans in; nothing dramatic
      ch.body.rotation.y = rsgn * across * 0.22 * renv;
      ch.body.rotation.x = ch.lean + (0.13 + 0.06 * high) * renv;
      ch.body.position.y -= 0.05 * renv * (1 - high);
      // and the head looks the other way. This is the whole animation.
      if (ch.neck) {
        ch.neck.rotation.y = -rsgn * across * 0.42 * renv;
        ch.neck.rotation.x = -0.10 * renv;
        ch._reached = 1;
      }
    } else if (ch._reached) {
      /* THE NECK IS THE ONE CHANNEL NOTHING ELSE OWNS. Every other value the
         block above writes is pulled home by the gait/idle damps the frame
         after the timer clears — but in the ordinary standing/walking path
         `neck.rotation` is written by no one, so an interrupted reach (a KO, a
         pose that returns early mid-lift) would leave a man looking over his
         shoulder for the rest of the run. One falsy check, and it is the only
         bookkeeping this layer needs. */
      ch._reached = 0;
      if (ch.neck) { ch.neck.rotation.y = 0; ch.neck.rotation.x = 0; }
    }

    // ---- DODGE / SLIP: a quick weave to dodgeDir (-1 left, +1 right) that
    // peaks mid-timer and eases back out by itself (sin envelope -> 0 at end).
    if (ch.dodgeT > 0) {
      ch.dodgeT -= dt;
      const ddur = ch.dodgeDur || 0.35;
      const dprog = 1 - Math.max(0, ch.dodgeT) / ddur;
      const denv = Math.sin(Math.min(1, dprog) * Math.PI);   // out and back
      const ddir = ch.dodgeDir || 1;
      ch.body.rotation.z = ch.sway + ddir * 0.42 * denv;     // whole-torso lean
      ch.body.rotation.y = ddir * 0.28 * denv;               // shoulders slip with it
      ch.body.position.y -= 0.16 * denv;                     // bob down under the shot
      ch.parts.ll.scale.y = 1 - 0.08 * denv;                 // knees give a touch
      ch.parts.rl.scale.y = 1 - 0.08 * denv;
      // keep the hands home while slipping
      ch.parts.la.rotation.x = -0.8 * denv + ch.parts.la.rotation.x * (1 - denv);
      ch.parts.ra.rotation.x = -0.8 * denv + ch.parts.ra.rotation.x * (1 - denv);
    }

    // ---- STAGGER: took a hit — snap back hard, wobble out over the timer.
    if (ch.staggerT > 0) {
      ch.staggerT -= dt;
      const sdur = ch.staggerDur || 0.55;
      const sk = Math.max(0, ch.staggerT) / sdur;             // 1 at impact -> 0
      const swob = Math.sin((1 - sk) * 18) * sk;              // damping head/torso wobble
      ch.body.rotation.x = ch.lean - (0.48 * sk * sk + 0.1 * swob);   // lean-back snap
      ch.body.rotation.y = swob * 0.22;
      ch.body.rotation.z = ch.sway + swob * 0.14;
      ch.body.position.y -= 0.07 * sk;                        // knees buckle a touch
      ch.body.position.z = -0.14 * sk;                        // small backward recoil
      // arms fling out loose
      ch.parts.la.rotation.x = -0.6 * sk;
      ch.parts.ra.rotation.x = -0.65 * sk;
      ch.parts.la.rotation.z = 0.55 * sk + 0.08;
      ch.parts.ra.rotation.z = -0.6 * sk - 0.08;
      if (ch.staggerT <= 0) ch.body.position.z = 0;           // no residual recoil offset
    }

    // Hands-up surrender/intimidation pose. This is a late animation layer so
    // gunpoint victims do not keep idle-swimming their arms while frozen.
    if (ch.surrender || ch.handsUp) {
      // upper arms drive well past vertical and splay outward; a SMALL elbow
      // bend tips the palms forward beside the head. (Filmstrip caught the
      // first attempt: a -0.9 elbow folded the forearms flat across the face.)
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.60, 18, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.16, 14, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.32, 14, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.20, 14, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.60, 18, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.16, 14, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.32, 14, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.20, 14, dt);
      }
      setElbow(J.la, -0.20, 16); setElbow(J.ra, -0.20, 16);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.07, 10, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, 12, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, 12, dt);
    }

    // ---- head: subtle counter-bob + breathing tilt, keeps eyes level ----
    if (ch.neck) {
      ch.neck.rotation.x = damp(ch.neck.rotation.x, -ch.lean * 0.7 + (moving ? Math.sin(ch.phase * 2) * 0.02 : 0), 9, dt);
      ch.neck.rotation.z = damp(ch.neck.rotation.z, -ch.sway * 0.6, 9, dt);
    }

    // ---- KO / KNOCKDOWN: crumple to the canvas. LAST layer on purpose — it
    // blends every pose channel (including the head layer just above) toward
    // the downed shape, so nothing pulls a KO'd fighter back upright. koT
    // animates the fall over koDur; ch.koPose=true holds the downed pose after
    // (or indefinitely, without koT at all). Clearing both restores upright:
    // the gate below hands the rig straight back to the gait/idle writes above,
    // and the delta-tracked group drop is refunded exactly once.
    if (ch.koT > 0 || ch.koPose) {
      if (ch.koT > 0) ch.koT -= dt;
      const kodur = ch.koDur || 0.7;
      const kraw = ch.koT > 0 ? 1 - Math.max(0, ch.koT) / kodur : 1;
      ch.koK = Math.max(ch.koK || 0, Math.min(1, kraw));      // never un-fall mid-hold
      const e = ch.koK * ch.koK * (3 - 2 * ch.koK);           // smoothstep crumple
      const inv = 1 - e;
      // torso pitches back and down onto the canvas, a slight roll so it
      // reads as a body, not a plank
      ch.body.rotation.x = ch.body.rotation.x * inv - 1.25 * e;
      ch.body.rotation.y = ch.body.rotation.y * inv;
      ch.body.rotation.z = ch.body.rotation.z * inv + 0.12 * e;
      ch.body.position.y = ch.body.position.y * inv - 0.62 * e;
      // legs fold — one knee drawn up, the other flopped, both shortened so
      // the feet come off their standing plant
      ch.parts.ll.rotation.x = ch.parts.ll.rotation.x * inv - 0.6 * e;
      ch.parts.ll.rotation.z = ch.parts.ll.rotation.z * inv + 0.28 * e;
      ch.parts.ll.scale.y = ch.parts.ll.scale.y * inv + 0.78 * e;
      ch.parts.rl.rotation.x = ch.parts.rl.rotation.x * inv - 0.25 * e;
      ch.parts.rl.rotation.z = ch.parts.rl.rotation.z * inv - 0.34 * e;
      ch.parts.rl.scale.y = ch.parts.rl.scale.y * inv + 0.9 * e;
      // arms splayed loose, palms-up-ish — not a T-pose
      ch.parts.la.rotation.x = ch.parts.la.rotation.x * inv - 0.55 * e;
      ch.parts.la.rotation.z = ch.parts.la.rotation.z * inv + 0.95 * e;
      ch.parts.la.rotation.y = ch.parts.la.rotation.y * inv;
      ch.parts.la.position.z = ch.parts.la.position.z * inv;
      ch.parts.ra.rotation.x = ch.parts.ra.rotation.x * inv - 0.3 * e;
      ch.parts.ra.rotation.z = ch.parts.ra.rotation.z * inv - 1.05 * e;
      ch.parts.ra.rotation.y = ch.parts.ra.rotation.y * inv;
      ch.parts.ra.position.z = ch.parts.ra.position.z * inv;
      if (ch.neck) {
        ch.neck.rotation.x = ch.neck.rotation.x * inv - 0.35 * e;   // head lolled back
        ch.neck.rotation.z = ch.neck.rotation.z * inv + 0.22 * e;
      }
      // sink the whole rig toward the floor. Delta-tracked (koLift remembers
      // what we've added) so the offset never compounds frame-over-frame and
      // is refunded exactly when the KO clears.
      const lift = -0.5 * e;
      ch.group.position.y += lift - (ch.koLift || 0);
      ch.koLift = lift;
    } else if (ch.koLift) {
      ch.group.position.y -= ch.koLift;                       // refund the sink
      ch.koLift = 0;
      ch.koK = 0;
    }
    // ---- TASER CONTACT: a short involuntary whole-body lock over whichever
    // locomotion/KO pose already owns the actor. systems/taserfx.js raises only
    // this timer; the character rig remains the sole limb writer. The high-rate
    // alternating offsets read as muscle contraction while the larger opposing
    // arm/leg angles keep the silhouette tense instead of a generic loose fall.
    if (ch.taserT > 0) {
      const td = Math.max(0.18, ch.taserDur || 0.72);
      ch.taserT = Math.max(0, ch.taserT - dt);
      const strength = Math.min(1, ch.taserT / Math.min(0.16, td));
      const buzz = Math.sin((td - ch.taserT) * 92) * strength;
      ch.body.rotation.x -= 0.14 * strength;
      ch.body.rotation.z += buzz * 0.055;
      if (ch.parts.la) {
        ch.parts.la.rotation.x -= 0.38 * strength;
        ch.parts.la.rotation.z += 0.42 * strength + buzz * 0.05;
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x -= 0.42 * strength;
        ch.parts.ra.rotation.z -= 0.44 * strength + buzz * 0.05;
      }
      if (J.la) J.la.rotation.x -= 0.50 * strength;
      if (J.ra) J.ra.rotation.x -= 0.54 * strength;
      if (ch.parts.ll) ch.parts.ll.rotation.x -= 0.18 * strength + buzz * 0.025;
      if (ch.parts.rl) ch.parts.rl.rotation.x += 0.16 * strength - buzz * 0.025;
      if (ch.neck) {
        ch.neck.rotation.x -= 0.16 * strength;
        ch.neck.rotation.z -= buzz * 0.065;
      }
    }
    // LAST inside the base animator: KO, stagger, punch and surrender all get
    // their final Euler before the shared socket is solved.
    lockCharacterHips(ch);
  }

  // ---- dramatic death sprawl (seeded variety; caller owns group topple).
  //      Real elbows/knees now sell the "broken heap": bent knees, folded
  //      arms — no more plank limbs on corpses. ----
  function deathPose(ch, seed, fall) {
    if (!ch || !ch.parts) return;
    beginCharacterHipFrame(ch);
    ch.sitting = false;
    const s = seed || 0;
    const p = ch.parts;
    const J = ch.low || {};
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    const knee = (g, v) => { if (g) g.rotation.set(Math.max(0, v), 0, 0); };
    const elbow = (g, v) => { if (g) g.rotation.set(Math.min(0, v), 0, 0); };
    let pick = Math.abs(j(5.1));        // 0..1
    if (fall != null) pick = pick * 0.5 + fall * 0.5;
    const tmpl = pick < 0.4 ? 0 : (pick < 0.75 ? 1 : 2);
    if (tmpl === 1) {
      // FACE-DOWN crumple: arms forward/under, legs trailing, head aside
      if (p.la) { p.la.rotation.set(-1.5 + j(1.7) * 0.4, 0.2, 0.4 + j(2.1) * 0.2); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-1.3 + j(2.9) * 0.4, -0.2, -0.5 - j(1.3) * 0.2); p.ra.position.z = 0; }
      elbow(J.la, -0.5 - Math.abs(j(3.7)) * 0.5); elbow(J.ra, -0.2 - Math.abs(j(4.1)) * 0.4);
      if (p.ll) { p.ll.rotation.set(-0.15 + j(3.3) * 0.15, 0, 0.2 + j(1.1) * 0.15); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(0.1 + j(2.3) * 0.15, 0, -0.25 - j(2.7) * 0.15); p.rl.scale.y = 1; }
      knee(J.ll, 0.15 + Math.abs(j(6.1)) * 0.5); knee(J.rl, 0.45 + Math.abs(j(5.3)) * 0.6);
      if (ch.body) { ch.body.rotation.set(0.1 * j(1.9), 0, 0.08 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.4, 0.7 * (j(1.5) >= 0 ? 1 : -1), 0.25 * j(2.2));
    } else if (tmpl === 2) {
      // ON-THE-SIDE fold: knees drawn up, top arm flung across
      const side = j(4.3) >= 0 ? 1 : -1;
      if (p.la) { p.la.rotation.set(-0.6 + j(1.7) * 0.4, 0.25, (0.9 + j(2.1) * 0.2) * (side > 0 ? 1 : 0.4)); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.5 + j(2.9) * 0.4, -0.25, (-0.95 - j(1.3) * 0.2) * (side < 0 ? 1 : 0.4)); p.ra.position.z = 0; }
      elbow(J.la, -0.7 - Math.abs(j(3.1)) * 0.6); elbow(J.ra, -0.9 - Math.abs(j(2.6)) * 0.5);
      if (p.ll) { p.ll.rotation.set(-0.75 + j(3.3) * 0.25, 0, 0.30 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.55 + j(2.3) * 0.25, 0, -0.28 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 1.1 + Math.abs(j(4.7)) * 0.5); knee(J.rl, 0.85 + Math.abs(j(3.9)) * 0.5);
      if (ch.body) { ch.body.rotation.set(0.18 * j(1.9), 0, side * 0.14); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.45, side * 0.55, side * 0.3);
    } else {
      // FACE-UP sprawl: arms flung out, legs splayed, one knee cocked
      if (p.la) { p.la.rotation.set(-0.9 + j(1.7) * 0.5, 0.25, 1.15 + j(2.1) * 0.25); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.7 + j(2.9) * 0.5, -0.25, -1.2 - j(1.3) * 0.25); p.ra.position.z = 0; }
      elbow(J.la, -0.35 - Math.abs(j(2.8)) * 0.55); elbow(J.ra, -0.15 - Math.abs(j(3.4)) * 0.35);
      if (p.ll) { p.ll.rotation.set(0.25 + j(3.3) * 0.2, 0, 0.4 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.45 + j(2.3) * 0.3, 0, -0.45 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 0.1 + Math.abs(j(5.7)) * 0.3); knee(J.rl, 0.6 + Math.abs(j(6.3)) * 0.7);   // one cocked knee
      if (ch.body) { ch.body.rotation.set(0.12 * j(1.9), 0, 0.1 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.55, 0.5 * j(1.5), 0.3 * j(2.2));
    }
    lockCharacterHips(ch);
  }

  // ---- seated death slump (owner: shot plane passengers die IN the seat).
  //      A corpse in a chair doesn't sprawl on the deck — it folds over its
  //      own lap and lolls toward one side. Direct writes in the deathPose
  //      idiom (animChar stops running on the dead, so the last write holds);
  //      the LEGS and the V2 model sink are deliberately untouched so the
  //      body keeps its seated fold and stays IN the chair instead of
  //      snapping to a standing pose to die. Seed gives per-corpse variety
  //      exactly like deathPose (runtime cosmetic — never a build path). ----
  function seatSlumpPose(ch, seed) {
    if (!ch || !ch.parts) return;
    beginCharacterHipFrame(ch);
    const s = seed || 0;
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    const side = j(3.1) >= 0 ? 1 : -1;
    if (ch.body) {
      ch.body.rotation.x = 0.5 + Math.abs(j(1.7)) * 0.32;         // collapse over the lap
      ch.body.rotation.y = side * 0.14;
      ch.body.rotation.z = side * (0.16 + Math.abs(j(2.3)) * 0.14); // loll into the seat back / aisle
      ch.body.position.y = -0.1;                                    // dead weight settles
    }
    // arms drop off the armrests and hang loose beside the thighs
    if (ch.parts.la) { ch.parts.la.rotation.set(-0.12 + j(1.3) * 0.1, 0, 0.16); ch.parts.la.position.z = 0; }
    if (ch.parts.ra) { ch.parts.ra.rotation.set(-0.18 + j(2.9) * 0.1, 0, -0.16); ch.parts.ra.position.z = 0; }
    const J = ch.low || {};
    if (J.la) J.la.rotation.set(-0.22 - Math.abs(j(3.7)) * 0.2, 0, 0);
    if (J.ra) J.ra.rotation.set(-0.16 - Math.abs(j(4.1)) * 0.2, 0, 0);
    // POSITIVE neck pitch drops the chin (KO's "lolled back" is the negative)
    if (ch.neck) ch.neck.rotation.set(0.55 + Math.abs(j(4.3)) * 0.25, side * 0.28, side * 0.22); // chin to chest
    lockCharacterHips(ch);
  }

  /* ---- WEAPON MOUNT POINTS (Fortnite-style stow rig) ---------------------
     Lazy + idempotent: three empty groups parented to rig.body, so mounted
     props ride the bob/sway/lean and follow every animation for free. Works
     on ANY rig from makeCharacter (player, peds, cops) — NPC systems may
     guard-call `CBZ.charMounts && CBZ.charMounts(actor.char)` and parent
     their stowed props to the returned groups.
       back  — primary long gun: diagonal across the back, muzzle up over the
               RIGHT shoulder (~40° off vertical), stock at the left hip,
               flank to the camera with a ~17° outward roll so the mag/grip
               tips off the back plane instead of burying in the spine.
       back2 — secondary long gun: the mirrored diagonal (muzzle over the
               LEFT shoulder), staggered 0.06 lower and 0.06 further out so
               two stowed rifles read as a clean X with no z-fighting where
               they cross.
       hip   — pistol holster ON the right hip: muzzle down with a ~12°
               forward cant, grip to the rear, outboard of the thigh
               (x .46 > leg span .40) so it never buries in the leg.
     Consumers must OVERWRITE the hand-mount transform CBZ.buildActorWeapon
     ships on its props: prop.position.set(0,0,0); prop.rotation.set(0,0,0);
     then their own scale. Prop convention: barrel -Z, rail +Y, grip -Y;
     Euler order XYZ. Endpoints verified numerically: a 1.5u rifle at 0.92
     scale spans (-0.33,1.22)→(0.55,2.26) on `back` — clear of the head box
     (y 1.88..2.48, |x|≤0.3, z≥-0.3), inside the shoulder line (0.62),
     behind the torso back plane (z=-0.25). */
  function charMounts(rig) {
    if (!rig || !rig.body) return null;
    if (rig._mounts) return rig._mounts;
    const mk = (px, py, pz, ex, ey, ez) => {
      const m = new THREE.Group();
      m.position.set(px, py, pz);
      m.rotation.set(ex, ey, ez);
      m.userData.isMount = true;   // non-empty userData: batching spares it
      rig.body.add(m);
      return m;
    };
    // Mount heights were authored against the adult male torso. Re-anchor them
    // on THIS body's torso column so a stowed rifle rides a shorter back
    // instead of hovering behind the head; s is 1 for the adult, so every
    // existing rig keeps the exact hand-tuned numbers above.
    const pf = rig.profile;
    const s = pf ? (pf.legUp + pf.legLo + pf.torsoH) / (0.95 + 0.95) : 1;
    rig._mounts = {
      back:  mk(-0.14 * s, 1.44 * s, -0.36 * s, 1.571, -0.698, -1.271),
      back2: mk( 0.14 * s, 1.38 * s, -0.42 * s, 1.571,  0.698, -1.271),
      hip:   mk( 0.46 * s, 1.05 * s, -0.20 * s, -1.781, -0.26, Math.PI),
    };
    return rig._mounts;
  }

  /* ---- A HELD GUN RESTS ON THE GROUND, IT DOES NOT SINK INTO IT ----------
     OWNER: "the gun should respect the ground too."

     There was already a solve for this and it could not win, because it only
     ever rotated the barrel's DIRECTION (systems/holsterprops.js →
     CBZ.weaponPhysics.clearDirection). Two things a direction cannot fix:
       (a) A GUN IS NOT A RAY. The M249 hangs an ammo box and a pair of bipod
           legs 0.267 m BELOW its own barrel axis at the drawn scale; a sniper
           hangs a magazine and a pistol grip. Hold the axis a token 0.05 m off
           the deck and the box is still a quarter-metre in the dirt. The one
           honest question is where the model's LOWEST VERTEX is, and that is
           measured here — from the prop's own geometry, so a weapon added
           tomorrow is covered by construction and no table lists a gun.
       (b) A HAND CAN BE UNDER THE FLOOR. Prone put the socket 0.446 m below
           the surface (see PRONE_ARM_PITCH). From there the direction solve
           can only pitch the barrel at the sky — measured 80° — which is how
           a rifle ended up planted in the ground like a fence post. Position
           is the missing degree of freedom, so this pass moves the SOCKET.

     The solve, once per frame for the player's rig only:
       bottom = propWorldY + (centre·q).y − Σ|R[1][j]|·half[j]      (its real
                lowest point at this orientation — the wpMeasureSpan identity
                systems/actorweapons.js already uses on a dropped gun)
       lift   = groundUnderItsOwnFOOTPRINT + CLEAR − bottom
     Sampled at five points across the weapon's world AABB, NOT under the
     hand: a 1.4 m gun lying across a kerb or down a slope is judged at both
     ends, which is the slope case the owner asked for.

     A DEPLOYED BIPOD IS THE ONE CASE THAT ALSO PULLS DOWN. Everything else
     may only ever be LIFTED (a gun floating because its owner is on a step is
     a lesser sin than a gun in the dirt, and a two-way solve on a walking
     body would bob the weapon). When fpsmode says the legs are loaded and the
     model actually has legs, the gun is driven ONTO the surface instead — that
     is what makes a prone M249 read as deployed rather than as a rifle held
     near the floor. One notion of "supported", owned by fpsmode; this file
     only asks.

     Cost: the local bounds are measured ONCE per prop and cached on it; the
     per-frame work is one quaternion, nine multiplies and five floor samples
     (CBZ.floorAt is ~0.14 µs since the terrain match landed), for ONE rig. */
  const GUN_REST_CLEAR = 0.025;    // m of air under the lowest vertex
  const GUN_REST_MAX_UP = 0.60;    // never levitate a gun further than this
  // …nor bury the hand chasing a bipod. Measured: a 34% grade drops the ground
  // 0.28 m across a prone shooter's forward reach, so the cap has to clear that
  // or the steepest playable hillside clips a muzzle.
  const GUN_REST_MAX_DOWN = 0.32;
  const _grPos = new THREE.Vector3();
  const _grScale = new THREE.Vector3();
  const _grQ = new THREE.Quaternion();
  const _grHandQ = new THREE.Quaternion();
  const _grCentre = new THREE.Vector3();
  const _grHalf = new THREE.Vector3();
  const _grAxis = new THREE.Vector3();
  const _grDelta = new THREE.Vector3();
  const _grInv = new THREE.Matrix4();
  const _grRel = new THREE.Matrix4();
  const _grCorner = new THREE.Vector3();
  const _grBox = new THREE.Box3();
  const _grStats = { solves: 0, lifted: 0, rested: 0, maxLift: 0, maxDrop: 0, sunk: 0, residual: 0,
                     last: { floor: 0, bottom: 0, need: 0, deployed: false, eY: 0, prop: null, kids: 0 } };

  function gunFloorAt(x, z, fromY) {
    if (CBZ.groundAt) {
      try { const y = CBZ.groundAt(x, z, fromY); if (isFinite(y)) return y; } catch (e) {}
    }
    if (CBZ.floorAt) {
      try { const y = CBZ.floorAt(x, z); if (isFinite(y)) return y; } catch (e) {}
    }
    return 0;
  }
  // Geometry bounds in the prop's OWN unscaled local frame, measured once.
  // (Its world scale is folded in per frame, so a rig that rescales — a child
  // body, a studio turntable — never needs a re-measure.)
  function gunLocalBounds(prop) {
    let c = prop.userData && prop.userData._restBounds;
    if (c) return c;
    if (prop.userData && prop.userData._restNone) return null;
    prop.updateWorldMatrix(true, true);
    _grInv.copy(prop.matrixWorld).invert();
    _grBox.makeEmpty();
    prop.traverse(function (o) {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (!b || b.isEmpty()) return;
      _grRel.multiplyMatrices(_grInv, o.matrixWorld);
      for (let i = 0; i < 8; i++) {
        _grCorner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
        _grBox.expandByPoint(_grCorner.applyMatrix4(_grRel));
      }
    });
    if (_grBox.isEmpty()) {
      prop.userData = prop.userData || {};
      prop.userData._restNone = true;      // a prop with no geometry is not a gun
      return null;
    }
    _grBox.getCenter(_grCentre);
    _grBox.getSize(_grHalf);
    c = { cx: _grCentre.x, cy: _grCentre.y, cz: _grCentre.z,
          hx: _grHalf.x / 2, hy: _grHalf.y / 2, hz: _grHalf.z / 2 };
    prop.userData = prop.userData || {};
    prop.userData._restBounds = c;
    return c;
  }
  /* The drawn weapon on this rig's hand socket, or null.
     THE TEST IS `weaponId`, NOT `visible`, and that is not fussiness: the
     socket carries TWO children in city play — the prop CBZ.buildActorWeapon
     stamped with a weaponId (what holsterprops.js orients and what you SEE)
     and systems/fpsmode.js's legacy `carriedGun`, a plain Group that
     holsterprops hides at onAlways(54), i.e. AFTER this pass has already run
     for the frame. Measuring on `visible` therefore sampled the LEGACY group,
     whose 1.70 m unoriented span put its "lowest vertex" 0.7 m under the hand
     and levitated every prone gun by 0.48 m. Measured, not guessed — the
     preset dumped `[Group:hid:dy1.70 | lmg:vis:dy0.46]` and the fault fell out. */
  function heldGunProp(socket) {
    if (!socket) return null;
    const kids = socket.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.visible && k.userData && k.userData.weaponId && k.children && k.children.length) return k;
    }
    return null;
  }
  function gunGroundRest(ch, dt) {
    const socket = ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
    if (!socket) return;
    if (!socket.userData._restBase) socket.userData._restBase = socket.position.clone();
    const base = socket.userData._restBase;
    const drawn = heldGunProp(socket);
    // Publish what the prone pose branch keys its arms off (a body with empty
    // hands must not hold them at gun height). Deliberately read BEFORE the
    // solve's own flag: whether there is a gun in the hand is a fact about the
    // rig, not a feature of the ground solve, so CHAR_GUN_GROUND_REST=false
    // must not silently flatten the prone firing posture too.
    ch._gunPoseK = damp(ch._gunPoseK || 0, drawn ? 1 : 0, 10, dt);
    const prop = (CBZ.CONFIG && CBZ.CONFIG.CHAR_GUN_GROUND_REST === false) ? null : drawn;
    // `need` below is measured off the gun WHERE IT IS, i.e. with last frame's
    // offset already applied, so the new target is prev + need. Solving for
    // `need` alone is a feedback loop that converges on HALF the correction —
    // which reads as "the fix almost worked", the worst kind of bug to chase.
    const prevLift = ch._gunRestY || 0;
    let want = 0;
    if (prop) {
      const b = gunLocalBounds(prop);
      if (b) {
        _grStats.solves++;
        prop.updateWorldMatrix(true, false);
        prop.matrixWorld.decompose(_grPos, _grQ, _grScale);
        _grCentre.set(b.cx * _grScale.x, b.cy * _grScale.y, b.cz * _grScale.z).applyQuaternion(_grQ);
        const hx = Math.abs(b.hx * _grScale.x), hy = Math.abs(b.hy * _grScale.y), hz = Math.abs(b.hz * _grScale.z);
        // vertical / horizontal half-extents of the ORIENTED box, in world
        const eY = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).y) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).y) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).y) * hz;
        const eX = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).x) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).x) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).x) * hz;
        const eZ = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).z) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).z) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).z) * hz;
        const cxW = _grPos.x + _grCentre.x, czW = _grPos.z + _grCentre.z;
        const bottom = _grPos.y + _grCentre.y - eY;
        const from = _grPos.y + _grCentre.y + eY + 0.4;
        let floor = gunFloorAt(cxW, czW, from);
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW + eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW + eZ, from));
        const need = floor + GUN_REST_CLEAR - bottom;
        // a DEPLOYED bipod is the only case that also settles DOWN onto the
        // surface; everything else may only ever be lifted out of it
        const deployed = !!(ch.aimBipod && prop.userData && prop.userData.bipod);
        want = deployed ? prevLift + need : Math.max(0, prevLift + need);
        if (need > 0.02) _grStats.sunk++;
        // THE PINNABLE NUMBER. `sunk` is the raw fault rate BEFORE correction
        // and it will always be non-zero (a pose transition is allowed one
        // frame in the dirt); this is how deep the gun was still buried once
        // the offset had settled, and it is the thing that must stay at zero.
        if (Math.abs(prevLift - want) < 0.01 && need > _grStats.residual) _grStats.residual = need;
        if (want > _grStats.maxLift) _grStats.maxLift = want;
        if (-want > _grStats.maxDrop) _grStats.maxDrop = -want;
        if (deployed) _grStats.rested++; else if (want > 0) _grStats.lifted++;
        const L = _grStats.last;   // reused, never reallocated — this runs every frame
        L.floor = floor; L.bottom = bottom; L.need = need; L.deployed = deployed;
        L.eY = eY; L.prop = prop.userData.weaponId || "?"; L.kids = socket.children.length;
      }
    }
    want = Math.max(-GUN_REST_MAX_DOWN, Math.min(GUN_REST_MAX_UP, want));
    // rise fast (a gun in the dirt is a bug the eye catches), settle slower
    ch._gunRestY = damp(prevLift, want, want > prevLift ? 18 : 9, dt);
    if (Math.abs(ch._gunRestY) < 1e-4) {
      ch._gunRestY = 0;
      if (socket.position.x !== base.x || socket.position.y !== base.y || socket.position.z !== base.z) {
        socket.position.copy(base);
      }
      return;
    }
    // The lift is a WORLD +Y translation; the socket lives in the rotated,
    // rig-scaled hand frame, so take it back through both.
    const parent = socket.parent || socket;
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_grPos, _grHandQ, _grScale);
    const s = Math.abs(_grScale.y) > 1e-5 ? _grScale.y : 1;
    _grDelta.set(0, ch._gunRestY / s, 0).applyQuaternion(_grHandQ.invert());
    socket.position.set(base.x + _grDelta.x, base.y + _grDelta.y, base.z + _grDelta.z);
  }
  /* Ratchet: `sunk` counts frames the drawn weapon's lowest vertex was still
     below the ground BEFORE this pass corrected it — it is the raw fault rate
     and may only ever be read alongside `lifted`/`rested`, which are the
     corrections. `maxLift` is the deepest hole this solve had to climb out of
     (metres); anything approaching GUN_REST_MAX_UP means a POSE is wrong and
     this pass is papering over it, which is exactly what the prone arms were
     doing before PRONE_ARM_PITCH was solved. */
  CBZ.charGunRestAudit = function () {
    return {
      solves: _grStats.solves, sunk: _grStats.sunk,
      lifted: _grStats.lifted, rested: _grStats.rested,
      // metres the SETTLED gun was still below ground — pin this at 0
      residual: Math.round(_grStats.residual * 1000) / 1000,
      maxLift: Math.round(_grStats.maxLift * 1000) / 1000,
      maxDrop: Math.round(_grStats.maxDrop * 1000) / 1000,
      clear: GUN_REST_CLEAR, capUp: GUN_REST_MAX_UP, capDown: GUN_REST_MAX_DOWN,
      live: !!(CBZ.playerChar && CBZ.playerChar._gunRestY != null),
      restY: CBZ.playerChar ? (CBZ.playerChar._gunRestY || 0) : null,
      // the last solve's raw terms, so a tool can see WHICH prop was measured,
      // where its lowest vertex was and what surface it was answering to
      last: _grStats.solves ? _grStats.last : null,
    };
  };

  /* THE RATCHET for "a character is a BODY, never a resized adult" lives in
     city/childhood.js as CBZ.childBodyAudit() — `faked` counts live peds whose
     group.scale still deviates from 1, and it is pinned at zero in the math
     gate. It is deliberately NOT duplicated here: this file had a rig-level
     version of the same count for a while, and two ratchets measuring one
     invariant is precisely the parallel bookkeeping the BLOCK LAW kills. The
     rig's job is to make the real body cheap to build; childhood.js's job is to
     prove nobody is faking one. */

  CBZ.makeCharacter = makeCharacter;
  CBZ.charProfile = charProfile;
  // Published so city/clothes.js can stop keeping its own copy of it — a
  // duplicated geometry constant that drifts is a seam nobody notices until
  // a hemline is 6cm wrong on every woman in the city.
  CBZ.CHAR_WAIST_TUCK = WAIST_TUCK;
  CBZ.CHAR_YOKE_CLEAR = YOKE_CLEAR;
  /* ---- WHERE THE WRIST IS, in the ELBOW group's frame -------------------
     (`rig.low.la` / `part.userData.low` — the frame every forearm accessory
     in this game mounts into.)

     OWNER BUG: "watches are on HANDS now — move them up to WRISTS." THREE
     files hang hardware off the forearm (bling.js's watch + bracelet,
     charpanel.js's portrait watch, restrain.js's zip-ties) and every one of
     them had typed its OWN constant against the adult-male rig. Two of the
     three landed inside the hand box, because they were measured against the
     wrist SOCKET (`leftHand`, at -armLo - 0.01) rather than against the hand
     that is actually DRAWN — and the drawn hand is limb()'s `cap`, which is
     0.03 lower and (capH + 0.03) TALL, so it reaches up to `capH - lowerH`.
     That is 0.20 - 0.46 = -0.26 on an adult male: bling's watch at -0.36 and
     restrain's tie at -0.42 were both buried in it.

     Nothing here is a taste number — every line is limb()'s own placement
     solved for its landmarks, read off THIS rig's profile, so a woman's
     shorter forearm and a child's much shorter one put their own hardware on
     their own wrist with no per-body table anywhere and no call-site edit.
     Degrade-safe: returns null with the flag off (each caller keeps its old
     literal as the fallback) and never throws on a stub rig. */
  CBZ.charArmLandmarks = function (ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_WRIST_LANDMARK === false) return null;
    const P = ch && ch.profile;
    const armLo = (P && P.armLo > 0) ? P.armLo : ARM_LO;   // elbow -> wrist
    const handH = (P && P.handH > 0) ? P.handH : 0.20;     // limb()'s capH
    const capH = handH + 0.03;                             // the cap is capH + 0.03 tall
    const handTop = handH - armLo;                         // = the wrist crease
    return {
      handTop: handTop,                    // top face of the drawn hand
      handBottom: -armLo - 0.03,           // bottom face of the drawn hand
      // A BAND GOES HERE: just proximal of the crease, on the last of the
      // forearm. The rise clears the fattest band in the game (bling's torus
      // tube is 0.028) with a millimetre of skin to spare.
      wrist: handTop + 0.04,
      // A RING GOES HERE: the knuckle line, in the upper third of the hand.
      hand: handTop - capH * 0.35,
      forearmTop: 0.06,                    // the lower box tucks 0.06 into the upper
    };
  };
  /* ---- HOW FAR THE PRONE RIG DROPS, in METRES -----------------------------
     OWNER: "when player is laying down… the player [goes] a tiny bit [under
     ground], bad physics." physics.js dropped the rig group by a TYPED 0.62 to
     lay the hip-hinged plank down, but the plank's lowest surface is not the
     hip line — it is the underside of the pitched CHEST BOX, half a torso
     DEPTH below it, and nobody had solved for that. Worked on the shipped
     adult male: the hips land 0.045 m over the floor and the chest's underside
     0.115 m UNDER it, which is exactly the sink the owner can see.

     A box pitched by θ has vertical half-extent h·|cosθ| + d·|sinθ| — that is
     the whole derivation, applied to the two boxes that can touch down (the
     chest and the upper leg) and taken at the LOWER of the two. Read off the
     rig's own profile and the pose's own angles, so a woman's deeper chest and
     a child's shorter femur each get their own number instead of a constant
     tuned against one body. Returns metres (humanScale applied); null if it
     cannot measure, so physics.js keeps its literal. */
  CBZ.charProneSink = function (ch) {
    const P = ch && ch.profile;
    if (!P) return null;
    const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
    const hipY = P.legUp + P.legLo;
    const base = hipY - 0.005;
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    const chestH = P.torsoH - waistH;
    const bob = 0.02;                                     // the prone pose's body.position.y
    const cT = Math.abs(Math.cos(PRONE_PITCH)), sT = Math.abs(Math.sin(PRONE_PITCH));
    // chest: centre swings about the HIP pivot (lockCharacterHips holds it)
    const chestOff = (base + waistH + chestH / 2) - hipY;
    const chestLow = hipY + chestOff * Math.cos(PRONE_PITCH) + bob
                   - (chestH / 2 * cT + P.torsoD / 2 * sT);
    const cL = Math.abs(Math.cos(PRONE_LEG_PITCH)), sL = Math.abs(Math.sin(PRONE_LEG_PITCH));
    const legLow = hipY - (P.legUp / 2) * Math.cos(PRONE_LEG_PITCH) + bob
                 - (P.legUp / 2 * cL + P.legW / 2 * sL);
    return Math.min(chestLow, legLow) * hs;               // drop by this → lowest surface ON the floor
  };
  /* ---- HOW BIG IS THIS BODY, SEATED? ------------------------------------
     Anything that has to fit a rig into an authored HOLE — a car cabin is the
     first, a cockpit will be the second — needs three numbers this file has
     and nobody else does: where the seat solve puts the hips, and how far the
     eye and the crown sit above them once the body is folded. Every one of
     them is read off the rig's OWN profile (so a woman, a teenager and the
     shipped adult male each get their own answer) and returned in metres with
     humanScale already applied, which is the same contract charProneSink
     above already established.

     The three consumers of the seat solve's own arithmetic, mirrored exactly:
       hipFloor  the `SHIN * 0.55` low clamp on hip height
       hipPad    the `0.10 * hs` thigh-into-cushion pad
       hip       = max(cushion + hipPad, hipFloor)     [the solve, verbatim]
     …so a caller can invert it for the scale that lands the eye where the
     cabin wants it. Returns null if it cannot measure, so no caller is ever
     forced to guess from a null. */
  CBZ.charSeatMetrics = function (ch) {
    const P = ch && ch.profile;
    if (!P) return null;
    const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
    // neck socket above the hip pivot: makeCharacter stacks
    // neckY = (hipY - 0.005) + torsoH - 0.015, then sinks the head by neckDrop.
    const neckOverHip = P.torsoH - 0.020 - (P.neckDrop || 0);
    // the eye boxes live in a face group scaled headSize/0.60, at local y 0.34
    const eyeOverNeck = 0.34 * (P.headSize / 0.60);
    const shin = (P.legLo + 0.03) * hs;
    return {
      hs: hs,
      hipY: (P.legUp + P.legLo) * hs,          // standing hip pivot
      hipFloor: shin * 0.55,                   // seat solve's low clamp
      hipPad: 0.10 * hs,                       // cushion -> hip pad
      eyeOverHip: (neckOverHip + eyeOverNeck) * hs,
      topOverHip: (neckOverHip + P.headSize) * hs,
    };
  };
  CBZ.charBands = { CHILD_ADULT_AGE, bandOf };
  // One cheap question every other system asks: "is this a child?" Answers for
  // a rig, a ped, or a bare Object3D (the root carries userData.charBand), and
  // never throws on something unexpected.
  CBZ.charIsChild = function (t) {
    if (!t) return false;
    if (t.child === true) return true;
    if (typeof t.ageYears === "number") return t.ageYears < CHILD_ADULT_AGE;
    if (t.profile && t.profile.child) return true;
    if (t.char) return CBZ.charIsChild(t.char);
    let o = t.isObject3D ? t : (t.group || null);
    for (let i = 0; o && i < 6; i++, o = o.parent) {
      const u = o.userData;
      if (u && u.charBand) return u.charBand !== "adult";
      if (u && u.charChild) return true;
    }
    return false;
  };
  /* CBZ.charReach(ch, opts) — arm the reach layer above on any rig built by
     makeCharacter (player, guard, inmate, city ped: it is one rig).
     Returns the duration so a caller can time a consequence to the DWELL —
     the grab lands at ~55% of it, not on the first frame.
       opts.arm "l"|"r"  · opts.dur seconds · opts.side -1 across / +1 out
       opts.high 0 hip .. 1 collar · opts.amt 0..1 commitment
     No-ops on a rig that is mid-strike or down, so a lift can never cancel a
     punch and a KO'd body never reaches for anything. */
  CBZ.charReach = function (ch, opts) {
    if (!ch || !ch.parts) return 0;
    if (ch.punchT > 0 || ch.kickT > 0 || ch.koT > 0 || ch.koPose || ch.staggerT > 0) return 0;
    opts = opts || {};
    const dur = Math.max(0.2, +opts.dur || 0.62);
    ch.reachArm = opts.arm === "l" ? "l" : "r";
    ch.reachDur = dur;
    ch.reachT = dur;
    ch.reachSide = opts.side == null ? -1 : +opts.side;
    ch.reachHigh = Math.max(0, Math.min(1, +opts.high || 0));
    ch.reachAmt = opts.amt == null ? 1 : Math.max(0, Math.min(1, +opts.amt));
    return dur;
  };
  CBZ.animChar = animChar;
  CBZ.poseSkydiver = poseSkydiver;
  CBZ.lockCharacterHips = lockCharacterHips;
  CBZ.gaitPhaseDelta = gaitPhaseDelta;
  CBZ.deathPose = deathPose;
  CBZ.charSeatSlump = seatSlumpPose;
  CBZ.charMounts = charMounts;
  CBZ.lerpAngle = lerpAngle;
  CBZ.damp = damp;
})();
