/* ============================================================
   units/species/bengal_tiger.js — THE BENGAL TIGER (Panthera tigris tigris).

   OWNED BY: the bengal tiger agent. The whole animal for the battle: its real
   numbers, a lofted skinned body, a planted-foot gait, a fight brain, and a
   corpse that drapes through the shared quadruped ragdoll.

   WHAT IT REPLACED. The bestiary's tiger (city/wildlife/bigcats.js) is twenty
   boxes: a 1.7 m plank on four 0.72 m posts with five black slabs through it.
   It walked on the discovered box rig and fought with creature_combat's one
   'pounce' (the whole group tilting). That file is untouched: the city still
   hunts it. This file is what NPC War fields.

   REFERENCE (adult Bengal tiger; Mazák 1981, Sunquist 2010, Karanth 2003)
                         male            female
     mass                200-260 (220)   100-160 (140) kg
     head + body         1.9-2.1 m       1.6-1.8 m
     tail                0.85-1.1 m      0.80-0.90 m
     shoulder height     0.95-1.05 m     0.80-0.90 m
     skull (CBL)         0.33-0.38 m     0.28-0.32 m
     canines             7.5-10 cm       6-8 cm
     bite force          ~4,500 N at the canines (Christiansen & Wroe 2007)
     top speed           49-65 km/h, in bursts of 30-100 m (not a runner:
                         a hunt is a stalk to 10-25 m and one rush)
     leap                5-6 m horizontal from a crouch
     endurance           ~10 s of sprint, then it must slow and pant
   Everything below is in those numbers. The model is authored in REAL metres
   divided by the bestiary row's scale (1.1, which battle.html applies to the
   group), so on the field it measures true.

   THE BODY (one SkinnedMesh, one shared Lambert, one draw call; geometry
   shared per variant: 2 sexes x 3 coat patterns = 6 shells for any number
   of tigers). Bones from CBZ.quadRig: root, pelvis, chest, a 2-bone neck,
   head, jaw, ears, a 5-bone tail, the shoulder-blade ridge (`hump`), three
   per leg. Lofted (CBZ.loftKit) with stations resampled on a Catmull-Rom
   spline so the coat has the vertex density stripes need:
     torso   deep keel chest (withers 0.97, sternum 0.41), barrel ribs, a
             narrow waist and the loose belly fold (primordial pouch) in
             front of the thighs, a heavy rump
     neck    thick and short, carried low
     head    broad round skull with the cheek ruff, short wide muzzle, a
             separate lower jaw with canines that show only when it opens,
             forward-facing amber eyes, small round ears set wide
     legs    massive forearms, triceps, big round paws; the hind leg folded
             Z (femur, tibia, a long metatarsus to a near-vertical hock)
     tail    near a metre, hanging in a J, ringed, black tipped
   COAT (vertex colours): orange deepening along the spine, cream flanks into
   a white belly and inner legs; ~25 narrow vertical stripes a side that
   taper, fork and double as real tigers' do, offset at the spine (each side
   is its own pattern, like a real tiger's); white cheek ruff with black cheek
   bars, white spots over the eyes, white whisker pads, rose nose, black lips;
   ears black-backed with the white ocellus; 9-10 tail rings and a black tip.
   Individuals: sex (size, mass, ruff), one of three coats (redder, paler,
   classic), and battle.html's own size draw on top.

   THE GAIT. CBZ.quadGait with a tiger footfall table (lateral-sequence walk,
   a brief trot, the rotary half-bound gallop), run in WORLD metres so a
   planted paw does not slide on a scaled body. Postures layered on it:
   stalk (belly low, head level with the spine, shoulder blades standing up,
   tail low with a twitching tip), the charge (spine flexing, tail streaming),
   lying up (sphinx) when there is nothing to do, the threat display (snarl,
   ears twisted back to show the white spots, tail lashing), hit reactions by
   where the hit came from (head snap, flank shudder, hindquarters dropping,
   a stumble on a heavy hit), a limp on the leg that was hit once hurt, and a
   three-legged carry when that leg is shot through.

   THE FIGHT (fight(): it owns the strike bubble). Moves: the pounce (load,
   5 m leap, forepaws first, knocks a man flat), the hold (the nape / throat
   bite and the squeeze, a man pinned under it), the forepaw swipe, the quick
   bite, rear-up wrestling against another big predator (both paws boxing,
   then the neck), the flank-and-rear attack on anything far heavier (it
   never takes an elephant from the front: it circles, rears against the
   hindquarters, claws, drops off), and the threat display. Damage comes from
   force: bite 4,500 N x 7 cm canine travel, a swipe's forelimb mass x paw
   speed, a 220 kg body landing at 7 m/s; scaled by this tiger's mass^(2/3).
   A wounded tiger is weaker. From behind it hits harder (the ambush).

   THE MIND (in animate(), on the sim clock): stalks an unaware mark from as
   far as 70 m, charges once seen, shot, or inside 14 m; a sprint costs
   stamina (~10 s) and it slows and pants when spent; it accelerates rather
   than teleporting to speed; it faces off a rival before closing; it will
   not throw itself at armour (it stands off, snarls and mock-charges);
   morale: a tiger in contact fights to the death, one shot down below 30%
   at range breaks off (battle.html's think() reads `tn.brave`, which this
   file sets per individual).

   DEATH. battle.html's beastDeathPhysics asks CBZ.quadRagdoll first. That
   solver reads leg columns off mesh children, so the body carries five
   invisible proxy boxes (four leg columns with paws, the head, the tail)
   that it can find and move; this file then maps the solved proxies back
   onto the skeleton every frame (legs by 3D IK, neck and tail by the
   solved swing) and lifts the skin by the difference between the solver's
   thin torso and a real tiger's girth. No ragdoll (out of range, budget)
   -> a limp corpse pose under the page's own topple.

   SEAMS used (all guarded): CBZ.unitKit, CBZ.loftKit, CBZ.quadRig,
   CBZ.quadGait (manifest `needs`), CBZ.floorAt, CBZ.micro.resolveCircle,
   CBZ.now (sim clock), CBZ.bodyMass, CBZ.creatureStyleFor, CBZ.goreImpact,
   CBZ.faceAnimalHeading. Men are knocked down through their rig's own
   `char.koT` (meleeposes' fall, which also gets them back up).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const ID = "bengal_tiger";
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function toward(cur, want, step) { return cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function frac(x) { return x - Math.floor(x); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash32(n) { let x = (n | 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; }

  // ==========================================================================
  //  THE NUMBERS
  // ==========================================================================
  const ROW_SCALE = 1.1;          // the bestiary row's scale: battle.html scales the group by it
  const SEX = {
    // len: linear size vs the male; girth: extra on widths; top: burst m/s
    m: { len: 1.0, girth: 1.0, mass: 220, hpK: 1.12, top: 15.0 },
    f: { len: 0.87, girth: 0.93, mass: 140, hpK: 0.85, top: 14.6 },
  };
  /* hp: what it takes to stop one. A carbine round lands ~41 here (28 x the
     page's 1.45) and drops a 140 hp soldier in four; a tiger has 2.7x the
     tissue and needs ~9 body hits (male 380, female 290 after the sex split
     in brain()). bite is the row's "what it does to a man" (the city reads
     it); the battle uses the move table below. chase/march are the opening
     numbers only: brain() owns them per individual from the first frame. */
  const STATS = {
    hp: 340, spd: 3.2, danger: 0.8, bite: 60, scale: ROW_SCALE,
    chase: 13.5, march: 1.3, dmg: 50, rate: 1.0,
    brave: true, prey: false,
  };
  const MASS_ROW = 190;           // the species mean for systems/bodymass.js (written on the row)

  /* DAMAGE, from force, in the page's units (a 100 hp man). One constant
     turns joules of work done on tissue into hp: J2HP = 0.27 puts a pistol
     round (~500 J, 36 dmg x 1.45 / 2 ... the page's own scale) in range.
       bite     4,500 N x 0.07 m canine travel = 315 J  -> 85 (the nape/throat)
       hold     the squeeze: suffocation / crushing, 45 per s held
       swipe    forelimb ~10 kg at 8 m/s = 320 J, claws  -> 48 (and 50% a man goes down)
       pounce   220 kg landing at 7 m/s: mostly knockdown; claws + blunt -> 32
       rear     two paw blows (40) and a neck bite (70) per bout
       ride     claws and teeth on a giant's hindquarters, 35 a stroke
     x (mass/220)^(2/3) for this tiger, x (0.7 + 0.3 hp) wounded, x1.25 from
     behind / 0.85 head-on. battle.html then applies the target's soak. */
  const HIT = { bite: 120, hold: 55, swipe: 48, pounce: 32, paw: 40, neck: 70, ride: 35, slap: 6 };

  // ---- the gait: lateral walk, a rarely used trot, the rotary half-bound
  let TABLE = null;
  function tigerTable() {
    if (TABLE) return TABLE;
    TABLE = Object.assign({}, CBZ.quadGait.TABLES.CAT, {
    gaits: [
      { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.68, lift: 0.05 },
      { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.46, lift: 0.065 },
      { name: "gallop", key: "wG", off: [0.25, 0.35, -0.13, -0.25], duty: 0.24, lift: 0.10 },
    ],
    trans: [[1.3, 2.0], [3.3, 4.4]],
    fMax: 3.9, f0: 1.0, fV: 0.36, strideMax: 1.9,
    vMove: 0.08, turnMove: 0.35, turnF: 1.3, settleRate: 2.4, restLift: 0.04, restStep: 0.08,
    });
    return TABLE;
  }

  // ==========================================================================
  //  DIMS (model units = real metres x len / ROW_SCALE; nose +X, ground y=0)
  // ==========================================================================
  function dims(sex) {
    const S = SEX[sex], A = S.len / ROW_SCALE, G = A * S.girth;
    const D = { sex: sex, A: A, G: G };
    D.hipX = -0.50 * A; D.hipH = 0.72 * A; D.shX = 0.52 * A; D.sh = 0.68 * A;
    D.withers = 0.98 * A;
    D.K = D.withers / 0.62;
    D.neckB = { x: 0.70 * A, y: 0.80 * A };
    D.headP = { x: 0.95 * A, y: 0.91 * A };
    D.headAng = -0.22;
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    // the head is drawn on its own scale: a tiger's head is a fifth of its length
    const HS = D.HS = 1.16 * (sex === "m" ? 1.04 : 1.0);
    D.hp = function (d, e) {              // a point in the head frame: d along the face, e up
      return { x: D.headP.x + (D.u.x * d - D.u.y * e) * A * HS, y: D.headP.y + (D.u.y * d + D.u.x * e) * A * HS };
    };
    D.jawP = D.hp(0.07, -0.10);
    D.earP = { x: D.headP.x + 0.03 * A * HS, y: D.headP.y + 0.125 * A * HS, z: 0.10 * G * HS };
    D.tailP = { x: -0.74 * A, y: 0.86 * A }; D.tailL = 0.95 * A; D.tailR = 0.05 * G;
    D.humpP = { x: 0.47 * A, y: 0.95 * A };
    D.legZf = 0.145 * G; D.legZh = 0.135 * G;
    D.FJ = { x: 0.50 * A, y: D.sh }; D.HJ = { x: -0.48 * A, y: D.hipH };
    D.fa = 0.29 * A; D.fb = 0.28 * A; D.fc = 0.12 * A;
    D.ha = 0.31 * A; D.hb = 0.33 * A; D.hc = 0.22 * A;
    D.pawR = 0.035 * A;
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    // where each leg's bind-pose shell ends (the coat reads height up the leg)
    D.legBot = [D.sh - D.fa - D.fb - D.fc, D.sh - D.fa - D.fb - D.fc, D.hipH - D.ha - D.hb - D.hc, D.hipH - D.ha - D.hb - D.hc];
    D.feet = [
      { x: D.FJ.x + 0.03 * A, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.03 * A, z: D.legZf, front: true },
      { x: D.HJ.x - 0.10 * A, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.10 * A, z: D.legZh, front: false },
    ];
    D.mouth = D.hp(0.33, -0.07);
    // the ragdoll proxies: columns set wide so the solver's torso is wide
    D.pz = 0.12 * G;
    return D;
  }

  // ==========================================================================
  //  COAT — (part, x, y, z, ca, sa, R, t) -> hex
  // ==========================================================================
  function rgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1); const A = rgb(a), B = rgb(b);
    return ((A[0] + (B[0] - A[0]) * t) | 0) << 16 | ((A[1] + (B[1] - A[1]) * t) | 0) << 8 | ((A[2] + (B[2] - A[2]) * t) | 0);
  }
  const PALETTES = [
    { deep: 0xa9481a, orange: 0xc9661f, light: 0xdf9c52 },     // classic
    { deep: 0x963a14, orange: 0xb9561a, light: 0xd48a45 },     // the deep red ones
    { deep: 0xb35a22, orange: 0xd27a2e, light: 0xe6b06a },     // paler, yellower
  ];
  const CREAM = 0xe9dbc2, WHITE = 0xf1ece3, STRIPE = 0x17110d, BSTRIPE = 0x3a2f28;
  const NOSE = 0xc98a7c, LIP = 0x1b1410, MOUTH = 0x6e2a2a, TOOTH = 0xf3eee2, IRIS = 0xc9952a, PUPIL = 0x0d0a08, PAD = 0x2b2420;

  function stripeSet(r, x0, x1, A) {
    const L = [];
    let x = x0 + r() * 0.03 * A;
    while (x < x1) {
      const pos = (x - x0) / (x1 - x0);           // 0 rump .. 1 shoulder
      L.push({
        x: x, lean: (lerp(0.07, -0.06, pos) + (r() - 0.5) * 0.05) * A,
        wob: (0.006 + r() * 0.012) * A, fq: 2 + r() * 3, ph: r() * TAU,
        w: (0.013 + r() * 0.015) * A * (pos > 0.82 ? 0.7 : 1),
        end: (pos > 0.85 ? 0.32 : 0.45) + r() * 0.36, dbl: r() < 0.14,
        fork: r() < 0.22 ? 0.22 + r() * 0.3 : 0, fd: r() < 0.5 ? -1 : 1,
      });
      x += (0.052 + r() * 0.048) * A;
    }
    return L;
  }
  function stripeAt(L, x, th, A) {           // th: 0 the spine .. 1 the belly line
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (Math.abs(x - s.x) > 0.16 * A || th > s.end + 0.05) continue;
      const xc = s.x + s.lean * th + s.wob * Math.sin(s.fq * th * PI + s.ph);
      const taper = th > s.end ? 1 - (th - s.end) / 0.05 : 1;
      const hw = s.w * (1 - 0.6 * Math.pow(clamp(th / s.end, 0, 1), 1.6)) * (th < 0.06 ? 1.25 : 1) * taper;
      const dd = Math.abs(x - xc);
      if (s.dbl && th > 0.15) { if (dd > hw * 0.3 && dd < hw * 1.2) return 1; }
      else if (dd < hw) return 1;
      if (s.fork && th > s.fork) {
        const xf = xc + s.fd * (th - s.fork) * 0.16 * A;
        if (Math.abs(x - xf) < hw * 0.6) return 1;
      }
    }
    return 0;
  }

  function coatFn(D, pat) {
    const A = D.A, G = D.G, P = PALETTES[pat % 3];
    const r = mkRng(0x7193 + pat * 7919 + (D.sex === "m" ? 0 : 131));
    const SL = stripeSet(r, D.hipX - 0.27 * A, D.shX + 0.12 * A, A);
    const SR = stripeSet(r, D.hipX - 0.27 * A, D.shX + 0.12 * A, A);
    const legPh = [r() * 6, r() * 6, r() * 6, r() * 6];
    const tailPh = r() * 0.08;
    function body(th) {                          // th 0 spine .. 1 belly
      if (th < 0.3) return mixHex(P.deep, P.orange, th / 0.3);
      if (th < 0.55) return mixHex(P.orange, P.light, (th - 0.3) / 0.25);
      if (th < 0.68) return mixHex(P.light, CREAM, (th - 0.55) / 0.13);
      return mixHex(CREAM, WHITE, (th - 0.68) / 0.12);
    }
    function headFrame(x, y) {
      const dx = x - D.headP.x, dy = y - D.headP.y;
      return { d: (dx * D.u.x + dy * D.u.y) / (A * D.HS), e: (-dx * D.u.y + dy * D.u.x) / (A * D.HS) };
    }
    return function (part, x, y, z, ca, sa, R, t) {
      const th = Math.abs(Math.atan2(sa, ca)) / PI;     // 0 up .. 1 down
      switch (part) {
        case "torso": {
          let c = body(th);
          // the white of the belly runs up into the armpit and the groin
          if (th > 0.6 && (x > D.shX - 0.12 * A || x < D.hipX + 0.18 * A)) c = mixHex(c, WHITE, 0.6);
          if (stripeAt(sa < 0 ? SL : SR, x, th, A)) c = th > 0.66 ? BSTRIPE : STRIPE;
          return c;
        }
        case "neck": {
          let c = th > 0.55 ? mixHex(CREAM, WHITE, (th - 0.55) / 0.2) : body(th * 0.9);
          // stripes come down the side of the neck as bars
          const k = (x - D.neckB.x) / A;
          if (th > 0.12 && th < 0.62 && Math.abs(Math.sin(k * 52 + (sa < 0 ? 0.8 : 2.1) + th * 2.4)) > 0.9) c = STRIPE;
          return c;
        }
        case "head": {
          const H = headFrame(x, y), d = H.d, e = H.e, az = Math.abs(z) / (G * D.HS);
          if (R && R.tag === "nose") {
            // the nose leather on top of the blunt end, the philtrum below it
            if (ca > 0.05 && Math.abs(sa) < 0.6) return (R.cap === 3 && ca < 0.5 && Math.abs(sa) > 0.15) ? 0x3a2420 : NOSE;
            if (ca < -0.4 && Math.abs(sa) < 0.4) return LIP;
            return WHITE;
          }
          if (d > 0.21) {                            // the muzzle
            if (ca < -0.55) return LIP;                // the upper lip's black edge
            if (ca < 0.3) {
              // whisker pads: white, with the rows of black whisker spots
              if (d > 0.25 && d < 0.32 && Math.sin(d * 260) * Math.sin(e * 300) > 0.75) return 0x2a2018;
              return WHITE;
            }
            return mixHex(P.orange, P.light, 0.4);     // the bridge of the nose
          }
          // white over the eye
          if (d > 0.13 && d < 0.21 && e > 0.085 && e < 0.125 && az > 0.04 && az < 0.11) return WHITE;
          // the dark line from the inner eye
          if (d > 0.2 && d < 0.235 && e > 0.02 && e < 0.07 && az > 0.05 && az < 0.08) return 0x2a1d14;
          // cheeks: the white ruff with the black bars
          if (e < 0.0 && Math.abs(sa) > 0.42 && d > -0.02 && d < 0.21) {
            const c2 = (d - 0.02) * 1.1 + (-e) * 0.7;
            if (d < 0.17 && Math.abs(frac(c2 * 8.5 + pat * 0.13) - 0.5) < 0.12) return STRIPE;
            return mixHex(WHITE, CREAM, 0.25);
          }
          if (ca < -0.45) return WHITE;                // under the chin
          // the forehead: orange with the black marks
          let c = mixHex(P.deep, P.orange, clamp((0.6 - ca) * 1.2, 0, 1));
          if (ca > 0.35 && d < 0.17 && d > -0.02) {
            if (Math.abs(Math.sin(az * 70 + d * 9)) > 0.92 && az < 0.09) c = STRIPE;
            if (d > 0.1 && d < 0.13 && az < 0.03) c = STRIPE;
          }
          if (d < 0.0 && Math.abs(Math.sin(az * 45 + d * 30)) > 0.9) c = STRIPE;
          return c;
        }
        case "jaw": {
          const H = headFrame(x, y);
          if (ca > 0.35) return H.d < 0.27 ? MOUTH : LIP;
          return ca > 0.1 ? LIP : WHITE;
        }
        case "ear": {
          if (ca > 0) {                                // the back: black with the white spot
            const spot = t > 0.32 && t < 0.72 && Math.abs(sa) < 0.45;
            return spot ? WHITE : 0x15100c;
          }
          return Math.abs(sa) > 0.82 ? 0x1c1510 : CREAM;
        }
        case "eye": return (R.cap >= 2 && t > 0.5) ? PUPIL : (t < 0.25 ? LIP : IRIS);
        case "tooth": return TOOTH;
        case "tail": {
          let c = ca < -0.3 ? mixHex(P.light, CREAM, 0.5) : mixHex(P.deep, P.orange, 0.5);
          if (t > 0.86) return STRIPE;
          if (t > 0.3) { if (frac(t * 9.5 + tailPh) < 0.3) c = STRIPE; }
          else if (ca > -0.2 && frac(t * 11 + tailPh) < 0.25) c = STRIPE;
          return c;
        }
        case "fleg": case "hleg": {
          const L = R.leg, inner = (D.feet[L].z < 0) ? sa > 0.55 : sa < -0.55;
          const front = part === "fleg";
          const hgt = (y - D.legBot[L]) / A;
          if (inner) return mixHex(WHITE, CREAM, 0.3);
          let c = hgt < 0.1 ? mixHex(P.light, CREAM, 0.3) : hgt < 0.25 ? mixHex(P.orange, P.light, 0.6) : (front ? mixHex(P.orange, P.light, 0.35) : P.orange);
          if (front) {
            // bars across the back and outside of the forearm, the front plain
            if (ca < 0.2 && hgt > 0.2 && hgt < 0.62 && frac(hgt * 9 + legPh[L]) < 0.22) c = STRIPE;
          } else if (hgt > 0.32) {
            // the thigh's curving stripes
            if (Math.abs(Math.sin(hgt * 24 + (x / A) * 16 + legPh[L])) > 0.86 && ca > -0.7) c = STRIPE;
          } else if (ca < -0.3 && hgt > 0.12 && frac(hgt * 10 + legPh[L]) < 0.2) c = STRIPE;
          return c;
        }
        case "paw": return ca < -0.72 ? PAD : mixHex(CREAM, P.light, 0.55);
      }
      return P.orange;
    };
  }

  // ==========================================================================
  //  GEOMETRY
  // ==========================================================================
  // Catmull-Rom over a key station list: n rings, numeric fields interpolated
  const SF = ["x", "y", "z", "rt", "rb", "w", "sq", "hk"];
  function spline(keys, n) {
    const out = [], L = keys.length;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1) * (L - 1), k = Math.min(L - 2, Math.floor(s)), t = s - k;
      const p0 = keys[Math.max(0, k - 1)], p1 = keys[k], p2 = keys[k + 1], p3 = keys[Math.min(L - 1, k + 2)];
      const o = {};
      for (let f = 0; f < SF.length; f++) {
        const nm = SF[f], dv = nm === "sq" ? 1 : 0;
        const a = p0[nm] != null ? p0[nm] : dv, b = p1[nm] != null ? p1[nm] : dv, c = p2[nm] != null ? p2[nm] : dv, d = p3[nm] != null ? p3[nm] : dv;
        o[nm] = 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      }
      const near = t < 0.5 ? p1 : p2;
      if (near.tag) o.tag = near.tag;
      if (near.muz) o.muz = near.muz;
      o.u = i / (n - 1);
      out.push(o);
    }
    return out;
  }

  function buildGeometry(D, pat, TB) {
    const LK = CBZ.loftKit, BN = TB.BN, LEGB = TB.LEGB, A = D.A, G = D.G;
    const GEO = LK.geo(), col = coatFn(D, pat), male = D.sex === "m";
    const C = function (part) { return function (x, y, z, ca, sa, R, t) { return col(part, x, y, z, ca, sa, R, t); }; };
    const P = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, HD = BN.head;

    // ---- TORSO: rump, the pouch, the waist, the barrel, the withers, the keel
    const tk = [
      [-0.79, 0.765, 0.12, 0.13, 0.10],
      [-0.72, 0.765, 0.19, 0.19, 0.16],
      [-0.60, 0.755, 0.235, 0.22, 0.19],
      [-0.46, 0.745, 0.225, 0.225, 0.185],
      [-0.31, 0.735, 0.21, 0.222, 0.175],
      [-0.13, 0.715, 0.21, 0.215, 0.175],
      [0.07, 0.70, 0.235, 0.24, 0.205],
      [0.25, 0.69, 0.255, 0.25, 0.215],
      [0.42, 0.685, 0.28, 0.25, 0.205],
      [0.55, 0.69, 0.278, 0.24, 0.19],
      [0.66, 0.705, 0.23, 0.215, 0.165],
      [0.745, 0.735, 0.165, 0.17, 0.13],
    ].map(function (k) { return { x: k[0] * A, y: k[1] * A, rt: k[2] * A, rb: k[3] * A, w: k[4] * G * 1.12, sq: 0.94 }; });
    const torso = spline(tk, 92);
    for (let i = 0; i < torso.length; i++) {
      const R = torso[i], tt = sstep(D.hipX + 0.05 * A, D.shX - 0.12 * A, R.x);
      R.wts = [P, 1 - tt, CH, tt];
      R.hk = clamp(1 - Math.abs(R.x - 0.48 * A) / (0.17 * A), 0, 1) * 0.9;
    }
    LK.loft(GEO, torso, 32, C("torso"), { hkBone: BN.hump, capLen: 0.7 });

    // ---- NECK: thick, short, carried low; the ruff in a male
    const ru = male ? 1.08 : 1.0;
    const nk = [
      { x: 0.56 * A, y: 0.76 * A, rt: 0.17 * A, rb: 0.19 * A, w: 0.155 * G },
      { x: 0.66 * A, y: 0.785 * A, rt: 0.158 * A, rb: 0.18 * A * ru, w: 0.148 * G * ru },
      { x: 0.76 * A, y: 0.825 * A, rt: 0.143 * A, rb: 0.163 * A * ru, w: 0.138 * G * ru },
      { x: 0.86 * A, y: 0.862 * A, rt: 0.13 * A, rb: 0.148 * A * ru, w: 0.13 * G * ru },
      { x: 0.95 * A, y: 0.888 * A, rt: 0.115 * A, rb: 0.13 * A, w: 0.122 * G },
    ];
    const neck = spline(nk, 22);
    for (let i = 0; i < neck.length; i++) {
      const u = neck[i].u;
      neck[i].wts = u < 0.3 ? [CH, 1 - u / 0.3, N0, u / 0.3] : u < 0.65 ? [N0, 1 - (u - 0.3) / 0.35, N1, (u - 0.3) / 0.35] : [N1, 1 - (u - 0.65) / 0.35 * 0.6, HD, (u - 0.65) / 0.35 * 0.6];
    }
    LK.loft(GEO, neck, 26, C("neck"), { capLen: 0.5 });

    // ---- HEAD: occiput, cranium, the cheek ruff, brow, stop, muzzle, nose
    const hk = [
      [-0.04, 0.0, 0.10, 0.11, 0.115],
      [0.03, 0.01, 0.15, 0.14, 0.165],
      [0.10, -0.005, 0.15, 0.16, 0.19 * ru],
      [0.165, 0.0, 0.13, 0.135, 0.155],
      [0.215, -0.015, 0.105, 0.105, 0.12],
      [0.26, -0.03, 0.09, 0.075, 0.105, true],
      [0.305, -0.035, 0.08, 0.065, 0.095, true],
      [0.34, -0.037, 0.068, 0.055, 0.075, true, "nose"],
    ].map(function (k) {
      const p = D.hp(k[0], k[1]);
      return { x: p.x, y: p.y, rt: k[2] * A * D.HS, rb: k[3] * A * D.HS, w: k[4] * G * D.HS, muz: !!k[5], tag: k[6] || null, sq: k[5] ? 0.86 : 0.95 };
    });
    const head = spline(hk, 26);
    for (let i = 0; i < head.length; i++) head[i].wts = [HD, 1];
    LK.loft(GEO, head, 28, C("head"), { capLen: 0.45 });
    // the lower jaw, on its own hinge
    const jk = [];
    for (let i = 0; i < 6; i++) {
      const s = i / 5, p = D.hp(lerp(0.07, 0.30, s), lerp(-0.10, -0.105, s));
      const hs = D.HS;
      jk.push({ x: p.x, y: p.y, rt: lerp(0.035, 0.02, s) * A * hs, rb: lerp(0.055, 0.032, s) * A * hs, w: lerp(0.11, 0.055, s) * G * hs, wts: [BN.jaw, 1] });
    }
    LK.loft(GEO, jk, 16, C("jaw"), { capLen: 0.8 });
    // the canines: upper ones in the head, lower in the jaw; hidden by the lips
    // until the mouth opens
    for (let s = -1; s <= 1; s += 2) {
      const uc = D.hp(0.295, -0.065), lc = D.hp(0.285, -0.1);
      const up = [], lo = [];
      for (let i = 0; i < 3; i++) {
        const q = i / 2;
        up.push({ x: uc.x + 0.008 * A * q, y: uc.y - 0.052 * A * q, z: s * 0.034 * G, rt: 0.008 * A * (1 - q * 0.85), rb: 0.008 * A * (1 - q * 0.85), w: 0.007 * A * (1 - q * 0.85), wts: [HD, 1] });
        lo.push({ x: lc.x - 0.004 * A * q, y: lc.y + 0.04 * A * q, z: s * 0.029 * G, rt: 0.007 * A * (1 - q * 0.85), rb: 0.007 * A * (1 - q * 0.85), w: 0.006 * A * (1 - q * 0.85), wts: [BN.jaw, 1] });
      }
      LK.loft(GEO, up, 6, C("tooth"), { capLen: 0.5, side: [1, 0, 0] });
      LK.loft(GEO, lo, 6, C("tooth"), { capLen: 0.5, side: [1, 0, 0] });
    }
    // eyes: forward-set, amber, a round pupil
    for (let s = -1; s <= 1; s += 2) {
      const e = D.hp(0.2, 0.07);
      LK.ellipsoid(GEO, e.x, e.y, s * 0.098 * G * D.HS, 0.02 * A * D.HS, 0.018 * A * D.HS, 0.018 * A * D.HS, 12, C("eye"), [HD, 1]);
    }
    // ears: small, round, set wide, black backs with the white spot
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, prof = [0.8, 1.0, 1.0, 0.92, 0.72, 0.4];
      const st = [];
      for (let i = 0; i < prof.length; i++) {
        const q = i / (prof.length - 1);
        const hs = D.HS;
        st.push({ x: E.x - 0.012 * A * hs * q, y: E.y + 0.08 * A * hs * q, z: s * (E.z + 0.014 * A * hs * q),
          rt: 0.01 * A * hs * (1 - q * 0.4), rb: 0.007 * A * hs * (1 - q * 0.4), w: 0.046 * A * hs * prof[i], wts: [eb, 1] });
      }
      LK.loft(GEO, st, 12, C("ear"), { capLen: 0.4 });
    }

    // ---- TAIL: a metre of it, five bones, ringed
    const tl = [];
    const tn = 40;
    for (let i = 0; i < tn; i++) {
      const q = i / (tn - 1), x = D.tailP.x - D.tailL * q;
      const rr = D.tailR * lerp(1.0, 0.68, q) * (q > 0.9 ? 1 - (q - 0.9) * 2.5 : 1);
      const seg = q * 5, b0 = Math.min(4, Math.floor(seg)), f = seg - b0;
      const wts = b0 < 4 ? [BN["tail" + b0], 1 - f * 0.5, BN["tail" + (b0 + 1)], f * 0.5] : [BN.tail4, 1];
      tl.push({ x: x, y: D.tailP.y, rt: rr, rb: rr, w: rr, wts: wts, u: q });
    }
    LK.loft(GEO, tl, 12, function (x, y, z, ca, sa, R) { return col("tail", x, y, z, ca, sa, R, R.u != null ? R.u : (R.cap ? 1 : 0)); }, { capLen: 0.9 });

    // ---- LEGS: straight in the bind pose (the IK bends them every frame)
    const pts = TB.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], x = P0[0], y0 = P0[1];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const part = front ? "fleg" : "hleg";
      const mk = function (k, wf) {
        const out = spline(k.map(function (q) { return { x: x + (q[4] || 0) * A, y: q[0], z: z, rt: q[1] * A * 1.12, rb: q[2] * A * 1.12, w: q[3] * G * 1.12 }; }), Math.max(6, k.length * 3));
        for (let i = 0; i < out.length; i++) { out[i].wts = wf(out[i].u); out[i].leg = Lg; }
        return out;
      };
      const u0 = ids[0], u1 = ids[1], u2 = ids[2];
      if (front) {
        // humerus with the triceps behind it, blending into the chest wall
        LK.loft(GEO, mk([[y0 + 0.13 * A, 0.10, 0.115, 0.085], [y0, 0.095, 0.118, 0.082], [y0 - 0.13 * A, 0.078, 0.105, 0.072], [y0 - a, 0.058, 0.068, 0.06]],
          function (u) { return u > 0.8 ? [u0, 1 - (u - 0.8) * 2.2, u1, (u - 0.8) * 2.2] : [u0, 1]; }), 14, C(part), { capLen: 0.6 });
        // the forearm, as thick as a man's thigh at the top
        LK.loft(GEO, mk([[y0 - a + 0.02 * A, 0.06, 0.068, 0.06], [y0 - a - 0.07 * A, 0.07, 0.062, 0.064], [y0 - a - b * 0.6, 0.056, 0.05, 0.054], [y0 - a - b, 0.046, 0.044, 0.05]],
          function (u) { return u > 0.85 ? [u1, 1 - (u - 0.85) * 3.3, u2, (u - 0.85) * 3.3] : [u1, 1]; }), 14, C(part), { capLen: 0.6 });
      } else {
        // the thigh: the heaviest muscle on the animal
        LK.loft(GEO, mk([[y0 + 0.15 * A, 0.115, 0.13, 0.10, 0.01], [y0, 0.13, 0.145, 0.105], [y0 - 0.15 * A, 0.105, 0.11, 0.088], [y0 - a, 0.06, 0.066, 0.06]],
          function (u) { return u > 0.8 ? [u0, 1 - (u - 0.8) * 2.2, u1, (u - 0.8) * 2.2] : [u0, 1]; }), 14, C(part), { capLen: 0.6 });
        // the shin with the calf behind it
        LK.loft(GEO, mk([[y0 - a + 0.02 * A, 0.058, 0.07, 0.058], [y0 - a - 0.11 * A, 0.052, 0.085, 0.052], [y0 - a - b * 0.75, 0.04, 0.05, 0.044], [y0 - a - b, 0.036, 0.045, 0.042]],
          function (u) { return u > 0.85 ? [u1, 1 - (u - 0.85) * 3.3, u2, (u - 0.85) * 3.3] : [u1, 1]; }), 14, C(part), { capLen: 0.6 });
      }
      // metacarpus / metatarsus down to the paw
      const fy = y0 - a - b;
      LK.loft(GEO, mk([[fy, front ? 0.046 : 0.036, front ? 0.044 : 0.045, front ? 0.05 : 0.042], [fy - c * 0.55, front ? 0.044 : 0.034, front ? 0.04 : 0.036, front ? 0.05 : 0.04], [fy - c * 0.92, front ? 0.05 : 0.042, 0.04, front ? 0.058 : 0.048]],
        function () { return [u2, 1]; }), 12, C(part), { capLen: 0.6 });
      // the paw: broad and round (a big male's forepaw is 13-15 cm across)
      const pr = front ? 1.0 : 0.88;
      LK.ellipsoid(GEO, x + 0.03 * A, fy - c + 0.005 * A, z, 0.075 * A * pr, 0.036 * A, 0.066 * G * pr, 14, C("paw"), [u2, 1]);
    }

    const geo = LK.toGeometry(GEO, { boundingSphere: [0.1 * A, 0.7 * A, 0, 2.2 * A] });
    // THE STANDING BOX, not the bind pose's: the bind legs hang straight below
    // the ground and the bind tail sticks out flat; battle.html measures this
    // box once for the separation circle, the aim heights and the nose.
    const THREE = W.THREE;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1.02 * A, 0, -0.24 * G), new THREE.Vector3(1.36 * A, 1.0 * A, 0.24 * G));
    return geo;
  }

  // ==========================================================================
  //  BUILD — one shell per variant, a skeleton per tiger
  // ==========================================================================
  let TB = null;
  function table() {
    if (!TB) TB = CBZ.quadRig.bones({ neck: 2, tail: 5, hackle: false, hump: true });
    return TB;
  }
  const VARIANTS = new Map();
  function variant(sex, pat) {
    const key = sex + pat;
    let V = VARIANTS.get(key);
    if (V) return V;
    const D = dims(sex);
    V = { D: D, geo: buildGeometry(D, pat, table()), prox: proxyGeos(D) };
    VARIANTS.set(key, V);
    return V;
  }
  // the ragdoll's handles: invisible boxes it can find by its own leg test
  let _proxMat = null;
  let KEEL = 1.3;
  function proxyGeos(D) {
    const THREE = W.THREE, A = D.A;
    const g = function (w, h, d) { const b = new THREE.BoxGeometry(w, h, d); b._shared = true; return b; };
    return { fleg: g(0.05 * A, D.sh, 0.05 * A), hleg: g(0.05 * A, D.hipH, 0.05 * A), paw: g(0.05 * A, 0.05 * A, 0.05 * A),
      head: g(0.12 * A, 0.1 * A, 0.1 * A), tail: g(0.1 * A, 0.06 * A, 0.06 * A), keel: g(0.1 * A, 0.1 * A, 0.1 * A) };
  }
  function addProxies(group, rig, V) {
    const THREE = W.THREE, D = V.D, A = D.A;
    if (!_proxMat) { _proxMat = new THREE.MeshBasicMaterial({ visible: false }); _proxMat._shared = true; }
    const mk = function (geo, x, y, z) {
      const m = new THREE.Mesh(geo, _proxMat);
      m.position.set(x, y, z); m.visible = false; m.castShadow = false;
      m.userData.tigerProxy = true; m.matrixAutoUpdate = true;
      group.add(m);
      return m;
    };
    const P = { legs: [], paws: [], rest: [] };
    for (let L = 0; L < 4; L++) {
      const f = D.feet[L], front = L < 2, top = front ? D.sh : D.hipH, z = (f.z < 0 ? -1 : 1) * D.pz;
      P.legs.push(mk(front ? V.prox.fleg : V.prox.hleg, f.x, top / 2, z));
      P.paws.push(mk(V.prox.paw, f.x, D.pawR, z));
    }
    const hc = D.hp(0.24, -0.02);
    P.head = mk(V.prox.head, hc.x, hc.y, 0);
    P.tail = mk(V.prox.tail, D.tailP.x - 0.28 * A, D.tailP.y, 0);
    /* THE KEEL. The solver's torso is three points in section: the two
       shoulder points and a spine point at the top of whatever it decides is
       torso. A section that wide and that flat rests on its shoulder-spine
       edge, i.e. half on its back (measured: up.y -0.69 on every trial). A
       spine point set high over a narrow pair makes the stable rest the
       FLANK (measured below 0.3), which is how a dead cat lies. */
    P.keel = mk(V.prox.keel, 0, D.hipH * 1.02 + KEEL * A - 0.05 * A, 0);
    // rest positions, to read the solver's answer as a displacement
    P.rest = [];
    const all = P.legs.concat(P.paws, [P.head, P.tail, P.keel]);
    for (let i = 0; i < all.length; i++) P.rest.push(all[i].position.clone());
    P.all = all;
    rig.prox = P;
  }

  function build(ctx) {
    const THREE = (ctx && ctx.THREE) || W.THREE;
    if (!THREE || !CBZ.loftKit || !CBZ.quadRig || !CBZ.quadGait) return null;
    const seed = (ctx && ctx.seed != null) ? Math.abs(ctx.seed | 0) : Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const h = hash32(seed * 3 + 1);
    // the first tiger on a side is a male; after that, an even mix
    const sex = (seed === 0 || seed === 7919) ? "m" : ((h & 1) ? "f" : "m");
    const pat = (h >>> 4) % 3;
    const V = variant(sex, pat);
    const rig = CBZ.quadRig.makeSkeleton(table(), V.D, "tiger");
    const mesh = CBZ.quadRig.skinnedMesh(V.geo, CBZ.loftKit.sharedSkinMaterial(), rig);
    mesh.name = "tiger-body";
    mesh.frustumCulled = true;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    rig.D = V.D; rig.sex = sex; rig.pat = pat; rig.seed = seed; rig.unit = null;
    addProxies(group, rig, V);
    group.userData.tigerRig = rig;
    // the corpse is posed where it is drawn: once the unit is dead nothing
    // else calls this file, so the skin follows the solver from here
    const base = mesh.updateMatrixWorld;
    const nKids = group.children.length;
    mesh.updateMatrixWorld = function (force) {
      // a side's collar hung on the group after build rides the neck instead
      if (group.children.length > nKids) adoptCollars(group, rig);
      const u = rig.unit;
      if (u && u.dead) { try { poseDead(rig, u); } catch (e) {} }
      return base.call(this, force);
    };
    // stand it up before the first frame (the bind pose is legs-straight)
    standPose(rig);
    return group;
  }

  // ==========================================================================
  //  THE LEG SOLVE — a 3D foot target through the kit's sagittal 2-bone IK,
  //  with the leg plane abducted first (a splayed corpse, a raised paw)
  // ==========================================================================
  const _ik = [0, 0];
  function legIK(rig, Lg, jx, jy, jz, fx, fy, fz, fa, br) {
    const D = rig.D, b = rig.bones, ids = rig.table.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const dy = fy - jy, dz = fz - jz;
    const r = Math.hypot(dy, dz);
    const abd = r > 1e-5 ? clamp(Math.atan2(-dz, -dy), -1.3, 1.3) : 0;
    const py = jy - r;
    const wx = fx - cl * Math.cos(fa), wy = py - cl * Math.sin(fa);
    CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
    b[ids[0]].rotation.set(abd, 0, _ik[0] + HALF - br);
    b[ids[1]].rotation.set(0, 0, _ik[1] - _ik[0]);
    b[ids[2]].rotation.set(0, 0, fa - _ik[1]);
  }
  function jointOf(rig, Lg, bx, by, br, out) {
    const off = rig.bindPos[rig.table.LEGB[Lg][0]];
    out.x = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
    out.y = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
    out.z = off.z;
    return out;
  }
  const _j = { x: 0, y: 0, z: 0 };
  function standPose(rig) {
    const D = rig.D, BN = rig.table.BN, b = rig.bones;
    for (let L = 0; L < 4; L++) {
      const front = L < 2, f = D.feet[L];
      jointOf(rig, L, front ? D.shX : D.hipX, front ? D.sh : D.hipH, 0, _j);
      legIK(rig, L, _j.x, _j.y, _j.z, f.x, D.pawR, _j.z, front ? -HALF + 0.35 : -HALF + 0.3, 0);
    }
    b[BN.tail0].rotation.set(0, 0, 0.95); b[BN.tail1].rotation.set(0, 0, 0.25); b[BN.tail2].rotation.set(0, 0, 0.12);
    b[BN.tail3].rotation.set(0, 0, -0.18); b[BN.tail4].rotation.set(0, 0, -0.4);
    b[BN.neck].rotation.set(0, 0, -0.08);
  }

  // ==========================================================================
  //  THE MIND — one per tiger, on the sim clock (CBZ.now follows the dial)
  // ==========================================================================
  function massOf(t) {
    if (!t) return 78;
    if (t.vehicle) return 9000;
    if (CBZ.bodyMass) { try { const m = CBZ.bodyMass(t); if (m > 0) return m; } catch (e) {} }
    return t.beast ? 150 : 78;
  }
  function kindOf(T, t) {
    if (T.tk === t) return T.tkind;
    let k = "man";
    if (t.vehicle) k = "vehicle";
    else if (t.beast) {
      const mt = massOf(t), sp = t.species || {};
      const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : "bite";
      if (mt > T.M * 2.6) k = "giant";
      else if (mt < T.M * 0.55) k = "small";
      else if (style === "pounce" || style === "maul" || style === "lunge" || (sp.danger || 0) >= 0.6) k = "rival";
      else k = "prey";
    }
    T.tk = t; T.tkind = k; T.faced = false;
    return k;
  }
  function liveTgt(m) { const t = m.tgt; return t && !t.dead && !t.fled ? t : null; }
  function brain(m) {
    let T = m._tg;
    if (T) return T;
    const g = m.group, rig = g && g.userData.tigerRig;
    if (!rig) return null;
    const sz = m._sizeMul || 1, S = SEX[rig.sex];
    T = m._tg = {
      rig: rig, D: rig.D, sex: rig.sex, M: S.mass * sz * sz * sz, top: S.top * Math.pow(sz, 0.15),
      rng: mkRng(hash32(rig.seed * 7 + 3)), clock: 0, now: null,
      stam: 1, chaseCur: 0, mode: "prowl", v: 0, turn: 0, px: null, pz: null, ph: 0,
      lastHp: m.hp, lastHitT: -99, dmgWin: 0, fl: null, limpLeg: -1, limpSev: 0, limp: 0,
      contactT: 0, flee: 0, tkp: null, tkx: 0, tkz: 0, missT: -9, mockT: 0, mockCd: 3, faceT: 0, idleT: 0,
      coverPt: null, coverBuf: null, coverT: 0, coverCd: 0, seeCd: 0, hidden: false, ambushT: 0,
      mv: null, mvT: 0, mvDur: 1, mvHit: 0, next: null, cd: 0, leap: 0, side: 0, tick: 0,
      tk: null, tkind: null, faced: false, lookY: 0, lookP: 0,
      crouch: 0, lie: 0, snarl: 0, lash: 0, t: rig.seed % 97,
      G: null, wasCustom: false,
    };
    T.forceK = Math.pow(T.M / 220, 2 / 3);
    // the individual's own numbers (battle.html shares one tn per species)
    m.tn = Object.assign({}, m.tn);
    // sex: the row's hp is the species mean
    if (!(m.hp < m.maxHp)) {
      m.maxHp = Math.round(m.maxHp * S.hpK); m.hp = m.maxHp; T.lastHp = m.hp;
    }
    m._mass = T.M;                    // systems/bodymass.js reads this first
    rig.unit = m;
    // the gait in WORLD metres: a planted paw must not slide on a scaled body
    const s = g.scale.x || 1, D = rig.D;
    const Dw = { K: D.K * s, legLen: D.legLen * s, feet: D.feet.map(function (f) { return { x: f.x * s, z: f.z * s, front: f.front }; }) };
    T.G = CBZ.quadGait.create(Dw, tigerTable());
    T.S = s;
    adoptCollars(g, rig);
    return T;
  }
  // the side's collar (battle.html hangs a box on the group) becomes a band
  // round the neck, riding the neck bone
  function adoptCollars(g, rig) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      if (!c.isMesh || c.isSkinnedMesh || c.userData.tigerProxy) continue;
      try { collarOnNeck(rig, c); } catch (e) { g.remove(c); }
    }
  }
  const _collarGeo = {};
  function collarOnNeck(rig, c) {
    const THREE = W.THREE, D = rig.D, BN = rig.table.BN;
    let geo = _collarGeo[rig.sex];
    if (!geo) { geo = _collarGeo[rig.sex] = new THREE.TorusGeometry(0.15 * D.A, 0.012 * D.A, 6, 22); geo._shared = true; }
    c.geometry = geo;
    c.scale.set(1, 1, 1);
    const dir = new THREE.Vector3(D.headP.x - D.neckB.x, D.headP.y - D.neckB.y, 0).normalize();
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    c.rotation.setFromQuaternion(c.quaternion);
    c.position.copy(dir).multiplyScalar(0.06 * D.A);
    rig.bones[BN.neck].add(c);
  }

  function onHurt(m, T, dmg) {
    T.lastHitT = T.clock;
    T.dmgWin += dmg;
    const src = liveTgt(m);
    let rel = (T.rng() - 0.5) * TAU;
    if (src) rel = wrapPi(Math.atan2(src.pos.z - m.pos.z, src.pos.x - m.pos.x) - (m.heading || 0));
    const ar = Math.abs(rel), r = T.rng();
    let loc;
    if (ar < 0.6) loc = r < 0.45 ? "head" : "shoulder";
    else if (ar < 2.2) loc = r < 0.5 ? "flank" : (r < 0.75 ? "shoulder" : "hip");
    else loc = r < 0.7 ? "hip" : "flank";
    const amt = clamp(dmg / (m.maxHp * 0.12), 0.25, 1.2);
    const side = rel >= 0 ? 1 : -1;            // +1: the hit came from the model's +z side
    T.fl = { t: 0, dur: 0.32 + 0.25 * amt, loc: loc, side: side, amt: amt };
    if ((loc === "shoulder" || loc === "hip") && (amt > 0.55 || r < 0.35)) {
      const leg = (loc === "shoulder" ? 0 : 2) + (side > 0 ? 1 : 0);
      if (T.limpLeg < 0 || leg === T.limpLeg) { T.limpLeg = leg; T.limpSev = Math.min(1, T.limpSev + 0.3 * amt); }
    }
  }

  function think(m, T, sdt) {
    T.clock += sdt;
    if (m.hp < T.lastHp - 0.01) onHurt(m, T, T.lastHp - m.hp);
    T.lastHp = m.hp;
    T.dmgWin *= Math.exp(-sdt / 4);
    if (T.contactT > 0) T.contactT -= sdt;
    const hpF = clamp(m.hp / (m.maxHp || 1), 0, 1);
    T.limp = T.limpLeg >= 0 ? clamp(T.limpSev * (1.35 - hpF), 0, 1) : 0;
    // stamina: a sprint is ~10 s; a lope costs a little; standing pays it back
    const av = Math.abs(T.v);
    if (av > 9) T.stam -= sdt / 10.5;
    else if (av > 5) T.stam -= sdt / 40;
    else T.stam += sdt / (av < 2 ? 14 : 24);
    T.stam = clamp(T.stam, 0, 1);
    const topNow = T.top * (0.55 + 0.45 * clamp(hpF * 1.4, 0, 1)) * (1 - 0.4 * T.limp);
    const sprint = topNow * lerp(0.42, 1, sstep(0.04, 0.45, T.stam));
    const t = liveTgt(m);
    let want = 1.25, mode = "prowl";
    if (m.you) {
      // POSSESSED: the player walks it (march) or runs it (chase); the mind
      // only keeps the body's limits: stamina, wounds, the limp
      T.mode = "you"; T.coverPt = null; T.hidden = false;
      m.tn.chase = sprint; m.tn.march = Math.min(3.4, sprint); m.tn.brave = true;
      T.chaseCur = Math.abs(T.v);
      T.idleT = av < 0.2 && !t ? T.idleT + sdt : 0;
      return;
    }
    if (!t) {
      if (m.state === "flee") { mode = "flee"; want = sprint * 0.95; }
    } else {
      const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
      const kind = kindOf(T, t);
      const underFire = T.clock - T.lastHitT < 3;
      if (kind === "vehicle") {
        // steel is not prey: stand off, snarl, and now and then rush it and stop
        mode = "wary";
        T.mockCd -= sdt;
        if (T.mockT > 0) T.mockT -= sdt;
        else if (d < 18 && T.mockCd <= 0) { T.mockT = 0.7; T.mockCd = 5 + T.rng() * 4; }
        want = T.mockT > 0 ? 9 : (d > 16 ? 2.2 : 0);
      } else {
        const aware = t.tgt === m || underFire || d < 14 || kind === "rival" || kind === "giant";
        cover(m, T, t, d, kind, hpF, sdt);
        if (T.coverPt) { mode = "dash"; want = sprint * 0.85; }
        else if (T.hidden && T.ambushT > 0 && d > 14) { T.ambushT -= sdt; mode = "ambush"; want = 0; }
        else if (T.hidden && d > 14 && hpF > 0.3) { mode = "stalk"; want = d > 30 ? 3.2 : 1.6; }
        else if (kind === "rival" && d < 13 && !T.faced) {
          // a face-off before two big predators close
          if (T.faceT <= 0) T.faceT = 1.1 + T.rng() * 0.6;
          T.faceT -= sdt;
          if (T.faceT <= 0) T.faced = true;
          mode = "face"; want = 0;
        } else if (!aware && d < 70 && hpF > 0.5) { mode = "stalk"; want = d > 35 ? 2.0 : 1.15; }
        else if (d > 90 && !underFire) { mode = "approach"; want = 3.4; }
        else { mode = "charge"; want = kind === "giant" && d < 14 ? Math.min(sprint, 6) : sprint; }
      }
      // morale: in contact it fights to the death; shot to pieces at range,
      // it breaks off (think() flees a non-brave beast under 30%)
      const cornered = d < 7 || T.contactT > 0;
      m.tn.brave = cornered || !(T.dmgWin > m.maxHp * 0.12 || kind === "vehicle");
    }
    T.mode = mode;
    // acceleration, not teleporting to speed (big cats ~7-8 m/s^2)
    T.chaseCur = toward(T.chaseCur, want, (want > T.chaseCur ? 7.5 : 14) * sdt);
    m.tn.chase = T.chaseCur;
    m.tn.march = T.chaseCur;
    if (!t && av < 0.2) T.idleT += sdt; else T.idleT = 0;
  }

  /* COVER. A tiger does not cross open ground at men with rifles: it puts
     something solid between itself and their eyes, closes from behind it,
     waits there for them to come near, and only then rushes. Hidden = the
     mark's eye line to this body is blocked (the host's own segment test).
     Exposed and far -> pick the nearest solid thing on the way whose far
     side the mark cannot see, and run to it; there, it waits up to ~6 s. */
  const _cov = [];
  function eyeBlocked(t, x, y, z) {
    const mc = CBZ.micro;
    if (!mc || !mc.segmentBlocked) return false;
    try { return !!mc.segmentBlocked(t.pos.x, t.pos.y + (t.beast ? 0.8 : 1.55), t.pos.z, x, y, z); } catch (e) { return false; }
  }
  function cover(m, T, t, d, kind, hpF, sdt) {
    T.coverCd -= sdt; T.seeCd -= sdt;
    const armed = !t.beast && !t.vehicle && t.armed;
    if (!armed || hpF < 0.25 || !CBZ.micro || !CBZ.micro.queryColliders) { T.coverPt = null; T.hidden = false; return; }
    if (T.seeCd <= 0) { T.seeCd = 0.25; T.hidden = eyeBlocked(t, m.pos.x, m.pos.y + 0.6, m.pos.z); }
    if (T.coverPt) {
      const cd = Math.hypot(T.coverPt.x - m.pos.x, T.coverPt.z - m.pos.z);
      T.coverT += sdt;
      if (cd < 1.8 || T.coverT > 6) { T.coverPt = null; if (T.hidden) T.ambushT = 4 + T.rng() * 2.5; }
      return;
    }
    if (T.hidden || d < 22 || T.coverCd > 0) return;
    T.coverCd = 2.0;
    const list = CBZ.micro.queryColliders(m.pos.x, m.pos.z, 28, _cov);
    let best = null, bs = 1e9;
    for (let i = 0; i < list.length && i < 60; i++) {
      const c = list[i];
      if (c.minX == null) continue;
      const hx = (c.maxX - c.minX) / 2, hz = (c.maxZ - c.minZ) / 2, big = Math.max(hx, hz);
      if (big < 0.6 || big > 30 || (c.y1 != null && c.y0 != null && c.y1 - c.y0 < 0.8)) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      let ux = cx - t.pos.x, uz = cz - t.pos.z;
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const off = Math.min(hx, hz) + 1.5;
      const px = cx + ux * off, pz = cz + uz * off;
      const toT = Math.hypot(px - t.pos.x, pz - t.pos.z), toMe = Math.hypot(px - m.pos.x, pz - m.pos.z);
      if (toT > d * 0.97 || toMe > 30) continue;
      const sc = toMe + 0.5 * toT;
      if (sc < bs && eyeBlocked(t, px, m.pos.y + 0.6, pz)) { bs = sc; best = T.coverBuf || (T.coverBuf = { x: 0, z: 0 }); best.x = px; best.z = pz; }
    }
    if (best) { T.coverPt = best; T.coverT = 0; }
  }

  // ==========================================================================
  //  THE FIGHT — the strike bubble (stepMan hands it over inside ~5 m)
  // ==========================================================================
  const RES = { inRange: false, dealt: 0, missed: false };
  const MOVES = {
    pounce: 0.64, swipe: 0.42, bite: 0.48, hold: 6.0, rear: 1.45, threat: 1.3,
    leapon: 0.62, ride: 2.0, evade: 0.45, recover: 0.5,
  };
  const COOL = { pounce: 0.2, swipe: 0.35, bite: 0.4, hold: 0.3, rear: 0.45, threat: 0.25, leapon: 0, ride: 0.2, evade: 0.3, recover: 0.2 };
  function startMove(T, name, dur) { T.mv = name; T.mvT = 0; T.mvDur = dur || MOVES[name]; T.mvHit = 0; T.tick = 0; }
  function turnTo(m, want, dt, rate) {
    let h = typeof m.heading === "number" ? m.heading : 0;
    h += clamp(wrapPi(want - h), -rate * dt, rate * dt);
    m.heading = h; m.faceH = h;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h); else m.group.rotation.y = -h;
  }
  function slide(m, nx, nz, step) {
    m.pos.x += nx * step; m.pos.z += nz * step;
    if (CBZ.micro && CBZ.micro.resolveCircle) { try { CBZ.micro.resolveCircle(m.pos, m.rad || 0.8, m.pos.y, 1.8); } catch (e) {} }
    if (CBZ.floorAt) { const y = CBZ.floorAt(m.pos.x, m.pos.z); if (isFinite(y)) m.pos.y = y; }
  }
  function moveIn(m, opts, nx, nz, step) {
    if (!(step > 0)) return;
    if (opts && typeof opts.move === "function") { try { opts.move(m, nx, nz, step); return; } catch (e) {} }
    slide(m, nx, nz, step);
  }
  function downed(t) {
    if (!t) return false;
    if (t.beast) return (t._flinchT || 0) > 0.15;
    const ch = t.char;
    return (t.ko > 0) || !!(ch && (ch.koT > 0 || ch.koPose || (ch.fall && ch.fall.on)));
  }
  function knockDown(t, secs) {
    if (!t || t.beast || t.vehicle) return;
    const ch = t.char;
    if (ch) ch.koT = Math.max(ch.koT || 0, secs);
  }
  const _gore = { dir: { x: 0, y: 0, z: 0 }, amount: 0.8, mist: false, pool: true, player: false, sfx: false };
  function deal(m, T, t, base, opts, low) {
    const hpF = clamp(m.hp / (m.maxHp || 1), 0, 1);
    // from behind is the ambush: hits harder; head-on is the worst angle
    let angK = 1;
    if (t.beast || !t.vehicle) {
      const th = typeof t.heading === "number" ? t.heading : (t.yaw != null ? Math.PI / 2 - t.yaw : 0);
      const rel = Math.abs(wrapPi(Math.atan2(m.pos.z - t.pos.z, m.pos.x - t.pos.x) - th));
      angK = rel > 2.1 ? 1.25 : (rel < 0.8 ? 0.85 : 1);
    }
    const dmg = base * T.forceK * (0.7 + 0.3 * hpF) * angK;
    if (opts && typeof opts.onHit === "function") opts.onHit(dmg);
    else { t.hp -= dmg; }
    RES.dealt += dmg;
    if (CBZ.goreImpact && dmg > 10) {
      const h = m.heading || 0;
      _gore.dir.x = Math.cos(h); _gore.dir.y = 0.2; _gore.dir.z = Math.sin(h);
      _gore.amount = clamp(dmg / 60, 0.4, 1.6); _gore.mist = dmg > 60; _gore.pool = true;
      const hy = low ? 0.3 : (t.beast ? (t.aimY || 0.8) : 1.2);
      try { CBZ.goreImpact(t.pos.x, t.pos.y + hy, t.pos.z, _gore); } catch (e) {}
    }
    return dmg;
  }
  function facing(m, want, tol) { return Math.abs(wrapPi(want - (m.heading || 0))) < tol; }

  function fight(m, tgt, dt, opts) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    if (!m || m.dead || !m.group || !(dt > 0)) return RES;
    const T = brain(m);
    if (!T) return RES;
    if (!tgt || tgt.dead) { T.mv = null; return RES; }
    T.contactT = 1.0;
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-4;
    const nx = dx / d, nz = dz / d;
    const keep = (m.rad || 0.9) + (tgt.rad || 0.45), gap = d - keep;
    const kind = kindOf(T, tgt), want = Math.atan2(dz, dx);
    RES.inRange = gap < 1.2;
    // how fast the mark is getting away (its velocity along the line)
    if (T.tkp === tgt) T.flee = approach(T.flee, ((tgt.pos.x - T.tkx) * nx + (tgt.pos.z - T.tkz) * nz) / dt, 8, dt);
    else { T.tkp = tgt; T.flee = 0; }
    T.tkx = tgt.pos.x; T.tkz = tgt.pos.z;
    if (opts && opts.youMove) { fightYou(m, T, tgt, dt, opts, gap, nx, nz, want, kind); return RES; }
    if (T.mv) { runMove(m, T, tgt, dt, opts, gap, nx, nz, want, kind); return RES; }
    turnTo(m, want, dt, 6.5);
    if (T.cd > 0) T.cd -= dt;
    const spd = Math.max(T.chaseCur, 3.5);
    const r = T.rng;
    if (kind === "vehicle") {
      if (gap < 2.5) slide(m, -nx, -nz, 3.2 * dt);
      else if (T.cd <= 0) { startMove(T, r() < 0.7 ? "threat" : "swipe"); T.cd = 1.4; }
      return RES;
    }
    if (kind === "man" || kind === "small" || kind === "prey") {
      // a pounce that just missed a runner is followed by a chase, not
      // another pounce from a standstill
      // a runner is run down first and only leapt on from close behind
      const chasing = T.clock - (T.missT || -9) < 1.2 || (T.flee > 2.5 && gap > 2.2);
      if (T.cd <= 0 && !chasing && gap > 1.25 && gap < 5.2 && facing(m, want, 0.5)) {
        startMove(T, "pounce"); T.leap = gap - 0.1;
        if (Math.abs(T.v) > 4) T.mvT = 0.1 * T.mvDur;      // already running: no crouch to load
      }
      else if (gap > 0.45) moveIn(m, opts, nx, nz, (T.mode === "stalk" ? 1.2 : Math.max(spd, chasing ? T.top * 0.8 : 0)) * dt);
      else if (T.cd <= 0) {
        if (downed(tgt) || (kind === "prey" && massOf(tgt) < T.M * 1.6)) startMove(T, "hold");
        else startMove(T, r() < 0.55 ? "swipe" : "bite");
      }
      return RES;
    }
    if (kind === "rival") {
      if (!T.faced) { T.faced = true; startMove(T, "threat", 0.9); return RES; }
      if (gap > 0.5) moveIn(m, opts, nx, nz, spd * 0.8 * dt);
      else if (T.cd <= 0) {
        const hpF = m.hp / (m.maxHp || 1), q = r();
        if (hpF < 0.35 && q < 0.3) { startMove(T, "evade"); T.side = r() < 0.5 ? -1 : 1; }
        else startMove(T, q < 0.42 ? "rear" : (q < 0.76 ? "swipe" : "bite"));
      }
      return RES;
    }
    // GIANT: never from the front. Circle to the hindquarters, rear up on them.
    const th = typeof tgt.heading === "number" ? tgt.heading : 0;
    const rel = wrapPi(Math.atan2(m.pos.z - tgt.pos.z, m.pos.x - tgt.pos.x) - th);   // 0 = in its face
    if (Math.abs(rel) < 0.9 && gap < 4) { startMove(T, "evade"); T.side = rel >= 0 ? 1 : -1; return RES; }
    if (Math.abs(rel) > 2.1 && gap < 3.5 && T.cd <= 0) { startMove(T, "leapon"); T.leap = Math.max(0, gap - 0.1); return RES; }
    const goA = th + PI + (rel >= 0 ? 0.45 : -0.45);
    const gx = tgt.pos.x + Math.cos(goA) * (keep + 1.0) - m.pos.x, gz = tgt.pos.z + Math.sin(goA) * (keep + 1.0) - m.pos.z;
    const gl = Math.hypot(gx, gz) || 1;
    turnTo(m, Math.atan2(gz, gx), dt, 6);
    slide(m, gx / gl, gz / gl, Math.min(gl, spd * 0.8 * dt));
    return RES;
  }

  /* THE PLAYER'S ATTACK (src/battle/player.js): the possessed driver chose a
     move through moves() below and calls this every step with opts.youMove.
     The same move code runs; the driver carries any leap itself, owns the
     chaining, and reads the swing's progress off m._atkAnim (-1 = done). */
  const YOU_MAP = { pounce: "pounce", swipe: "swipe", bite: "bite", throat: "hold", rear: "rear", maul: "swipe", leap: "pounce", snap: "bite" };
  function fightYou(m, T, t, dt, opts, gap, nx, nz, want, kind) {
    const ym = opts.youMove;
    if (T.youMv !== ym) {
      T.youMv = ym;
      const nm = YOU_MAP[ym.id] || (ym.style === "pounce" ? "pounce" : ym.style === "bite" ? "bite" : "swipe");
      startMove(T, nm, nm === "hold" ? 0.8 : (nm === "rear" ? 1.2 : 0));
      T.leap = 0; T.next = null; T.you = true; T.side = T.rng() < 0.5 ? -1 : 1;
    }
    if (!T.mv) { m._atkAnim = -1; return; }
    const cur = T.mv;
    runMove(m, T, t, dt, opts, gap, nx, nz, want, kind);
    if (T.mv !== cur) T.mv = null;                     // no chaining: the player chains
    m._atkAnim = T.mv ? clamp(T.mvT / T.mvDur, 0, 0.999) : -1;
    if (!T.mv) { T.you = false; T.youMv = null; }
  }

  // the moves hook: which of its real attacks a player's ATTACK throws
  function moves(m, t, ctx) {
    ctx = ctx || {};
    const T = brain(m);
    const reach = ctx.reach || 2.4, dist = ctx.dist == null ? 99 : ctx.dist;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    const M = CBZ.unitMoves && CBZ.unitMoves.MOVES;
    const mv = function (id, style, pow, dur, rng, leap, cd) { return { id: id, style: style, pow: pow, dur: dur, rng: rng, leap: leap || 0, cd: cd }; };
    if (t && dist > reach * 1.05 && dist < reach * 2.8 && running) return mv("pounce", "pounce", 1.4, MOVES.pounce, 1.1, 1, 0.9);
    if (ctx.downed) return mv("throat", "maul", 1.8, 0.8, 1.05, 0, 0.6);
    const k = T && t ? kindOf(T, t) : "man";
    if (k === "rival" && (ctx.n || 1) % 3 === 2) return mv("rear", "maul", 1.2, 1.2, 1.0, 0, 0.5);
    if ((ctx.n || 1) % 3 === 0) return M ? M.bite : mv("bite", "bite", 1.05, MOVES.bite, 1, 0, 0.5);
    return mv("swipe", "maul", 1.0, MOVES.swipe, 1.0, 0, 0.4);
  }

  function runMove(m, T, t, dt, opts, gap, nx, nz, want, kind) {
    T.mvT += dt;
    const p = T.mvT / T.mvDur, mv = T.mv;
    switch (mv) {
      case "pounce": case "leapon": {
        turnTo(m, want, dt, p < 0.26 ? 8 : 3.5);
        // the leap homes on the mark (a running man is caught by the arc, not
        // by where he stood at take-off): ~10-12 m/s through the air
        if (p >= 0.26 && p < 0.8 && T.leap > 0) {
          const st = Math.min(Math.max(0, gap - 0.05), Math.max(11, (T.flee || 0) + 7, T.leap / (0.54 * T.mvDur)) * dt);
          moveIn(m, opts, nx, nz, st);
        }
        // the paws arrive when the body does: contact ends the flight early
        if (!T.mvHit && p >= 0.45 && p < 0.8 && gap < 0.35 && facing(m, want, 0.95)) T.mvT = T.mvDur * 0.8;
        if (!T.mvHit && T.mvT >= T.mvDur * 0.8) {
          T.mvHit = 1;
          if (gap < 0.95 && facing(m, want, 0.95)) {
            if (mv === "pounce") {
              deal(m, T, t, HIT.pounce, opts, false);
              knockDown(t, 2.8);
              T.next = (kind === "man" || kind === "small" || (kind === "prey" && massOf(t) < T.M * 1.6)) ? "hold" : "recover";
            } else { deal(m, T, t, HIT.ride, opts, false); T.next = "ride"; }
          } else { RES.missed = true; T.next = "recover"; T.missT = T.clock; }
        }
        break;
      }
      case "hold": {
        // jaws on the nape or the throat; the body over the victim
        turnTo(m, want, dt, 4);
        if (gap > (downed(t) ? 1.8 : 1.1)) { T.mvT = T.mvDur; break; }   // it got away
        if (gap > 0.1) moveIn(m, opts, nx, nz, Math.min(gap, 1.5 * dt));
        T.tick -= dt;
        if (T.tick <= 0) {
          const first = T.mvHit === 0;
          T.tick = 0.5; T.mvHit++;
          deal(m, T, t, first ? HIT.bite : HIT.hold * 0.5, opts, true);
          knockDown(t, 1.2);
        }
        if (!t.beast && !t.vehicle && !T.you) T.mvT = Math.min(T.mvT, T.mvDur * 0.9);   // a man is held till he is dead
        break;
      }
      case "swipe": {
        turnTo(m, want, dt, 5);
        if (!T.mvHit && p >= 0.57) {
          T.mvHit = 1;
          if (gap < 0.95 && facing(m, want, 0.9)) {
            deal(m, T, t, kind === "vehicle" ? HIT.slap : HIT.swipe, opts, false);
            if (T.rng() < 0.5) knockDown(t, 1.4);
          } else RES.missed = true;
        }
        break;
      }
      case "bite": {
        turnTo(m, want, dt, 6);
        if (gap > 0.25 && p < 0.6) moveIn(m, opts, nx, nz, Math.min(gap, 2.5 * dt));
        if (!T.mvHit && p >= 0.62) {
          T.mvHit = 1;
          if (gap < 0.6 && facing(m, want, 0.7)) deal(m, T, t, HIT.bite * 0.8, opts, downed(t));
          else RES.missed = true;
        }
        break;
      }
      case "rear": case "ride": {
        turnTo(m, want, dt, 4);
        if (gap > 0.2) moveIn(m, opts, nx, nz, Math.min(gap, 1.2 * dt));
        if (mv === "rear") {
          const marks = [0.38, 0.59, 0.78];
          if (T.mvHit < 3 && p >= marks[T.mvHit]) {
            const k = T.mvHit++;
            if (gap < (k < 2 ? 1.0 : 0.7)) deal(m, T, t, k < 2 ? HIT.paw : HIT.neck, opts, false);
            else RES.missed = true;
          }
        } else {
          T.tick -= dt;
          if (T.tick <= 0) { T.tick = 0.45; if (gap < 0.9) deal(m, T, t, HIT.ride, opts, false); }
          if (p >= 1) T.next = "evade";
        }
        break;
      }
      case "threat": turnTo(m, want, dt, 4); break;
      case "evade": {
        const sx = -nz * (T.side || 1), sz = nx * (T.side || 1);
        slide(m, sx * 0.8 - nx * 0.6, sz * 0.8 - nz * 0.6, 6 * dt * (1 - p));
        turnTo(m, want, dt, 5);
        break;
      }
      default: break;
    }
    if (T.mvT >= T.mvDur) {
      const nxt = T.next;
      T.next = null; T.mv = null; T.cd = COOL[mv] || 0.3;
      if (nxt) { startMove(T, nxt); if (nxt === "evade") T.side = T.rng() < 0.5 ? -1 : 1; }
    }
  }

  // ==========================================================================
  //  ANIMATE — mind, then body
  // ==========================================================================
  function animate(m, dt) {
    const g = m.group, rig = g && g.userData.tigerRig;
    if (!rig || m.dead) return;
    const T = brain(m);
    if (!T) return;
    const now = CBZ.now;
    let sdt = (typeof now === "number" && T.now != null) ? (now - T.now) / 1000 : 0;
    T.now = typeof now === "number" ? now : null;
    if (!(sdt > 0)) sdt = dt > 0 ? dt : 0.016;
    if (sdt > 0.25) sdt = 0.25;
    measure(m, T, sdt);
    think(m, T, sdt);
    // running for cover steers the body (think() re-aims it at the mark on
    // its own tick; this answers it every frame while the dash lasts)
    if (T.coverPt && !m.you && m.target && m.target.set) m.target.set(T.coverPt.x, 0, T.coverPt.z);
    pose(m, T, rig, sdt);
  }
  function measure(m, T, dt) {
    const gx = m.pos.x, gz = m.pos.z, h = m.heading || 0;
    if (T.px == null) { T.px = gx; T.pz = gz; T.ph = h; }
    const mdx = gx - T.px, mdz = gz - T.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - T.ph) / dt;
    if (mdx * mdx + mdz * mdz > 16) { v = 0; turn = 0; if (T.G) CBZ.quadGait.reset(T.G, gx, gz, h, CBZ.floorAt || null, m.pos.y); }
    T.px = gx; T.pz = gz; T.ph = h;
    T.v = approach(T.v, clamp(v, -4, 18), 10, dt);
    T.turn = approach(T.turn, clamp(turn, -8, 8), 9, dt);
  }

  // the posture's own foot targets, reused (no per-frame arrays)
  const CF = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], CFON = [false, false, false, false];
  function setCF(i, x, y, z, a) { const c = CF[i]; c[0] = x; c[1] = y; c[2] = z; c[3] = a; CFON[i] = true; }
  function pose(m, T, rig, dt) {
    const D = rig.D, A = D.A, K = D.K, b = rig.bones, BN = rig.table.BN, bp = rig.bindPos, G = T.G, S = T.S;
    T.t += dt;
    const t = liveTgt(m);
    const hpF = clamp(m.hp / (m.maxHp || 1), 0, 1);
    const mv = T.mv, p = mv ? clamp(T.mvT / T.mvDur, 0, 1) : 0;
    // ---- moods, eased
    const stalk = (T.mode === "stalk" || T.mode === "ambush") ? 1 : 0;
    const wary = (T.mode === "wary" || T.mode === "face") ? 1 : 0;
    const thr = mv === "threat" ? 1 : 0;
    T.crouch = approach(T.crouch, Math.max(stalk * 0.85, wary * 0.32, thr * 0.42, mv === "hold" ? 0.2 : 0), 3, dt);
    T.snarl = approach(T.snarl, Math.max(thr, wary * 0.7, (mv === "rear" || mv === "swipe" || mv === "ride") ? 0.8 : 0), 8, dt);
    T.lie = approach(T.lie, (T.idleT > 7 && !mv) ? 1 : 0, T.lie > 0.5 ? 1.6 : 1.1, dt);
    if (Math.abs(T.v) > 0.4 || t) T.lie = Math.min(T.lie, approach(T.lie, 0, 6, dt));
    const lieK = ease(T.lie), cr = T.crouch;

    // ---- which body parts are the gait's and which are the move's
    const custom = mv === "pounce" || mv === "leapon" || mv === "rear" || mv === "ride" || lieK > 0.05;
    const ground = CBZ.floorAt || null;
    if (!custom) {
      if (T.wasCustom) { CBZ.quadGait.reset(G, m.pos.x, m.pos.z, m.heading || 0, ground, m.pos.y); T.wasCustom = false; }
      CBZ.quadGait.step(G, dt, T.v, T.turn, m.pos.x, m.pos.z, m.heading || 0, ground, m.pos.y);
    } else T.wasCustom = true;
    const M = G.mix, ph = G.phase * TAU;
    const moveK = clamp(Math.abs(T.v) / 0.6, 0, 1);
    const gal = (M.wG || 0) * moveK, walk = (M.wW || 0) * moveK;

    // ---- BODY: pelvis + chest, model units
    const KM = D.withers / 0.62;
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0, yawC = 0, yawP = 0;
    const bob = -(0.008 * walk + 0.014 * (M.wT || 0) * moveK) * KM * (0.5 - 0.5 * Math.cos(2 * ph));
    pY += bob; cY += bob;
    // the gallop: the spine flexes and extends, the hips and shoulders see-saw
    pY += 0.03 * KM * gal * Math.sin(ph - 1.6); cY += 0.03 * KM * gal * Math.sin(ph + 0.3);
    const flex = 0.17 * gal * Math.sin(ph + 0.6);
    pR += flex; cR -= flex * 0.55;
    pX += 0.05 * A * gal * Math.sin(ph + 0.6); cX -= 0.04 * A * gal * Math.sin(ph + 0.6);
    pY -= 0.05 * A * gal; cY -= 0.06 * A * gal;
    // the stalk: belly down, the shoulders working above the back
    pY -= 0.17 * A * cr; cY -= 0.22 * A * cr; cX -= 0.02 * A * cr; cR -= 0.05 * cr;
    // breathing (and panting when spent)
    const pant = clamp(1 - T.stam * 1.6, 0, 1);
    const br = Math.sin(T.t * (pant > 0.2 ? 11 : 1.7)) * (0.004 + 0.006 * pant) * A;
    cY += br;
    // turning bends the body into the turn
    yawC += clamp(T.turn * 0.07, -0.25, 0.25); yawP -= clamp(T.turn * 0.05, -0.18, 0.18);
    // the limp: a foreleg hurt -> the head nods up as it lands; a hind -> the hip hikes
    let headNod = 0;
    if (T.limp > 0 && T.limpLeg >= 0 && moveK > 0.2) {
      const F = G.feet[T.limpLeg];
      const load = F.sw ? 0 : 1;
      if (T.limpLeg < 2) { headNod = 0.22 * T.limp * load; cY += 0.025 * A * T.limp * load; }
      else pY += 0.03 * A * T.limp * load;
    }
    // ---- the moves
    let liftY = 0;
    CFON[0] = CFON[1] = CFON[2] = CFON[3] = false;
    let neckP = 0, neckY = 0, headP = 0, jaw = 0, earPin = 0, earTwist = 0;
    const L = D.shX - D.hipX;
    if (mv === "pounce" || mv === "leapon") {
      const hi = mv === "leapon" ? 1.5 : 1;
      if (p < 0.26) {                                   // load: down and back on the haunches
        const k = ease(p / 0.26);
        pY -= 0.2 * A * k; cY -= 0.27 * A * k; cX -= 0.05 * A * k; pX -= 0.03 * A * k;
        neckP -= 0.25 * k; earPin = 0.3 * k;
      } else if (p < 0.8) {                             // the leap
        const s = (p - 0.26) / 0.54, arc = Math.sin(PI * s);
        liftY = 0.5 * A * arc * hi;
        const pitch = 0.38 * (1 - 2 * s) * hi;
        pY = D.hipH - 0.04 * A + liftY; pR = pitch;
        cX = pX + L * Math.cos(pitch); cY = pY + L * Math.sin(pitch); cR = pitch;
        jointOf(rig, 0, cX, cY, cR, _j);
        for (let i = 0; i < 2; i++) setCF(i, _j.x + 0.48 * A, _j.y - 0.42 * A + 0.12 * A * (1 - s), D.feet[i].z * 1.25, -0.2);
        jointOf(rig, 2, pX, pY, pR, _j);
        for (let i = 2; i < 4; i++) setCF(i, _j.x - 0.5 * A * (0.4 + 0.6 * s), _j.y - 0.55 * A, D.feet[i].z, -HALF + 1.0);
        neckP = 0.1 - 0.25 * s; jaw = 0.75 * ease(s * 1.6); earPin = 0.6;
      } else {                                          // landing: forepaws on the mark
        const s = (p - 0.8) / 0.2;
        pY = D.hipH - 0.12 * A * (1 - s * 0.5); cY = D.sh - 0.26 * A * (1 - s * 0.4); cX = D.shX + 0.05 * A;
        pR = 0; cR = -0.12;
        for (let i = 0; i < 2; i++) setCF(i, cX + 0.38 * A, D.pawR + 0.05 * A, D.feet[i].z * 1.2, -HALF + 0.9);
        for (let i = 2; i < 4; i++) setCF(i, D.feet[i].x - 0.15 * A * (1 - s), D.pawR, D.feet[i].z, -HALF + 0.3);
        neckP = -0.45; jaw = 0.7 * (1 - s); earPin = 0.7;
      }
    } else if (mv === "hold") {
      const sh = Math.sin(T.t * 9.5);
      cY = D.sh - 0.28 * A; pY = D.hipH - 0.12 * A; cX = D.shX + 0.04 * A + 0.01 * A * sh; cR = -0.14;
      neckP = -0.95; headP = -0.2; neckY = 0.13 * sh; jaw = 0.12; earPin = 0.85;
      for (let i = 0; i < 2; i++) setCF(i, cX + 0.32 * A, D.pawR + 0.03 * A, D.feet[i].z * 1.3, -HALF + 1.1);
    } else if (mv === "swipe") {
      const s = T.side > 0 ? 1 : 0;
      let fx, fy;
      // the paw comes up past the face, then rakes forward and down
      if (p < 0.35) { const k = ease(p / 0.35); fx = lerp(D.feet[s].x, cX + 0.34 * A, k); fy = lerp(D.pawR, 0.8 * A, k); }
      else if (p < 0.62) { const k = ease((p - 0.35) / 0.27); fx = lerp(cX + 0.34 * A, cX + 0.7 * A, k); fy = lerp(0.8 * A, 0.25 * A, k); }
      else { const k = ease((p - 0.62) / 0.38); fx = lerp(cX + 0.7 * A, D.feet[s].x, k); fy = lerp(0.25 * A, D.pawR, k); }
      setCF(s, fx, fy, D.feet[s].z * 1.1, -0.4 + 0.6 * Math.sin(PI * p));
      const rise = Math.sin(PI * clamp(p * 1.4, 0, 1));
      cY += 0.06 * A * rise; cR += 0.12 * rise; cX -= 0.03 * A * rise;
      yawC += (s ? 0.12 : -0.12) * rise;
      neckY = (s ? -0.15 : 0.15) * rise; jaw = 0.55 * rise; earPin = 0.8;
    } else if (mv === "bite") {
      const lunge = Math.sin(PI * clamp(p / 0.7, 0, 1));
      cX += 0.08 * A * lunge; pX += 0.03 * A * lunge;
      neckP = -0.15 - 0.2 * lunge;
      jaw = p < 0.55 ? 0.8 * ease(p / 0.55) : (p < 0.66 ? 0.8 * (1 - (p - 0.55) / 0.11) : 0.05);
      earPin = 0.9;
    } else if (mv === "rear" || mv === "ride") {
      const up = mv === "ride" ? 1.18 : 1.02;
      const k = mv === "ride" ? ease(Math.min(1, p / 0.12)) * (p > 0.9 ? ease((1 - p) / 0.1) : 1)
        : ease(Math.min(1, p / 0.22)) * (p > 0.86 ? ease((1 - p) / 0.14) : 1);
      const theta = up * k;
      pY = D.hipH - 0.1 * A * k; pR = theta * 0.85;
      cX = pX + L * Math.cos(theta); cY = pY + L * Math.sin(theta); cR = theta;
      jointOf(rig, 0, cX, cY, cR, _j);
      // both forepaws boxing, alternately
      for (let i = 0; i < 2; i++) {
        const box = Math.max(0, Math.sin(T.t * 7.5 + i * PI));
        setCF(i, lerp(D.feet[i].x, _j.x + (0.44 + 0.2 * box) * A, k), lerp(D.pawR, _j.y - (0.06 - 0.2 * box) * A, k), D.feet[i].z * (1 + 0.4 * k), lerp(-HALF + 0.35, -0.3, k));
      }
      for (let i = 2; i < 4; i++) setCF(i, D.feet[i].x + 0.12 * A * k, D.pawR, D.feet[i].z * (1 + 0.3 * k), -HALF + 0.3 - 0.25 * k);
      neckP = -theta * 0.8 + 0.1; jaw = 0.65 * k; earPin = 0.95;
      if (mv === "rear" && p > 0.7 && p < 0.86) { neckP -= 0.25; jaw = 0.9; }
    } else if (mv === "evade") {
      yawC += 0.2 * (T.side || 1) * Math.sin(PI * p); cY -= 0.06 * A; earPin = 0.7;
    }
    // ---- lying up (sphinx)
    if (lieK > 0.02) {
      const lCY = 0.27 * A, lPY = 0.25 * A, lCX = D.shX + 0.02 * A;
      const lP = Math.atan2(lCY - lPY, L);
      cX = lerp(cX, lCX, lieK); cY = lerp(cY, lCY, lieK); pY = lerp(pY, lPY, lieK); pX = lerp(pX, lCX - L * Math.cos(lP), lieK);
      cR = lerp(cR, lP, lieK); pR = lerp(pR, lP, lieK);
      for (let i = 0; i < 4; i++) {
        const front = i < 2;
        const l0 = front ? D.shX + 0.48 * A : D.hipX + 0.32 * A, l2 = front ? D.feet[i].z : D.feet[i].z * 1.9, l3 = front ? 0.05 : -0.05;
        if (!CFON[i]) setCF(i, D.feet[i].x, D.pawR, D.feet[i].z, front ? -HALF + 0.35 : -HALF + 0.3);
        const cf = CF[i];
        setCF(i, lerp(cf[0], l0, lieK), lerp(cf[1], D.pawR, lieK), lerp(cf[2], l2, lieK), lerp(cf[3], l3, lieK));
      }
    }
    // ---- hit reactions, by where it was hit
    const F0 = T.fl;
    if (F0) {
      F0.t += dt;
      if (F0.t >= F0.dur) T.fl = null;
      else {
        const e = Math.sin(PI * F0.t / F0.dur) * F0.amt, sd = F0.side;
        if (F0.loc === "head") { neckP += 0.45 * e; headP += 0.25 * e; neckY += 0.3 * e * sd; cX -= 0.05 * A * e; earPin = Math.max(earPin, e); }
        else if (F0.loc === "shoulder") { cY -= 0.08 * A * e; yawC -= 0.22 * e * sd; neckY += 0.2 * e * sd; }
        else if (F0.loc === "flank") { yawC -= 0.18 * e * sd; yawP += 0.18 * e * sd; cY -= 0.03 * A * e; pY -= 0.03 * A * e; }
        else { pY -= 0.12 * A * e; yawP += 0.25 * e * sd; }
        if (F0.amt > 0.7) cY -= 0.1 * A * e;            // a heavy hit buckles the forehand
        earPin = Math.max(earPin, 0.6 * e);
      }
    }

    // ---- write the trunk
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(0, yawP, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(0, yawC, cR);
    // the shoulder blades: up in the stalk and each walking step
    const hb = bp[BN.hump];
    b[BN.hump].position.set(hb.x, hb.y + (0.045 * cr + 0.012 * walk * Math.abs(Math.sin(ph))) * A + 0.025 * A * lieK, hb.z);

    // ---- LEGS
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, F = G.feet[Lg];
      const bx = front ? cX : pX, by = front ? cY : pY, brr = front ? cR : pR;
      jointOf(rig, Lg, bx, by, brr, _j);
      let fx, fy, fz, fa;
      const cf = CFON[Lg] ? CF[Lg] : null;
      if (cf) { fx = cf[0]; fy = cf[1]; fz = cf[2]; fa = cf[3]; }
      else {
        fx = F.lx / S; fy = F.ly / S + D.pawR; fz = F.lz / S;
        const su = F.sw ? Math.sin(PI * F.u) : 0;
        fa = front ? (-HALF + 0.35 - 1.25 * su) : (-HALF + 0.3 - 0.6 * su);
        if (!front && !F.sw) fa += 0.25 * clamp((D.feet[Lg].x - fx) / (0.35 * A), -1, 1);
        // the stalk sets the paw down softly, a little wider
        if (cr > 0) fz *= 1 + 0.15 * cr;
        // a leg shot through is carried
        if (Lg === T.limpLeg && T.limp > 0.75 && moveK > 0.3) { fy = Math.max(fy, 0.16 * A); fa = front ? -0.5 : -HALF + 0.9; }
      }
      legIK(rig, Lg, _j.x, _j.y, _j.z, fx, fy, fz, fa, brr);
    }

    // ---- NECK, HEAD, JAW: carried low; looks at the mark
    let lookY = 0, lookP = 0;
    if (t) {
      lookY = clamp(wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0)), -1.0, 1.0);
      const dd = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
      lookP = clamp(Math.atan2(((t.headY || 1.4) * 0.8) - 0.9, Math.max(1, dd)), -0.5, 0.5);
    } else {
      // idle: an unhurried look round
      lookY = 0.6 * Math.sin(T.t * 0.23 + T.D.A * 3) * (1 - moveK);
    }
    // the look turns with the head, not the whole neck... except into a fight
    T.lookY = approach(T.lookY, -lookY, 5, dt);       // model +z is world left of heading: yaw sign flips
    T.lookP = approach(T.lookP, lookP, 5, dt);
    const carry = -0.06 - 0.14 * walk - 0.12 * gal - 0.32 * cr - 0.1 * (1 - hpF) - 0.08 * lieK;
    const nod = 0.04 * walk * Math.sin(2 * ph + 0.5);
    b[BN.neck].rotation.set(0, T.lookY * 0.5 + neckY, carry + nod + neckP * 0.6 + T.lookP * 0.4 - cR * 0.7 + headNod);
    b[BN.neck1].rotation.set(0, T.lookY * 0.4 + neckY * 0.5, neckP * 0.4 + T.lookP * 0.3 - headNod * 0.5);
    b[BN.head].rotation.set(0, T.lookY * 0.15, headP + 0.1 * cr + 0.08 * lieK);
    const snarl = T.snarl;
    const jawOpen = Math.max(jaw, snarl * 0.42 * (0.8 + 0.2 * Math.sin(T.t * 13)), pant * 0.28);
    b[BN.jaw].rotation.set(0, 0, -clamp(jawOpen, 0, 0.85));
    // ears: forward and up when intent, flattened and twisted to show the
    // white spots in a threat, back in a fight
    earPin = Math.max(earPin, snarl);
    earTwist = snarl;
    const flick = (Math.sin(T.t * 0.9 + 1.3) > 0.985) ? 0.4 : 0;
    for (let s = 0; s < 2; s++) {
      const e = b[s === 0 ? BN.earL : BN.earR], sg = s === 0 ? -1 : 1;
      const alertK = (t || cr > 0.3) ? 1 : 0.4;
      e.rotation.set(sg * (0.1 + 0.55 * earPin), sg * 1.1 * earTwist, -0.15 * alertK * (1 - earPin) + 1.05 * earPin + (s === 0 ? flick : 0));
    }
    // ---- TAIL: the J at rest, low in the stalk, streaming in the charge,
    // lashing when angry
    T.lash = approach(T.lash, Math.max(snarl, wary, (mv === "rear" || mv === "hold") ? 0.5 : 0), 3, dt);
    const tw = Math.sin(T.t * 3.1) * 0.55 * T.lash + 0.08 * walk * Math.sin(ph) + 0.06 * Math.sin(T.t * 0.7) * (1 - moveK);
    const flee = T.mode === "flee" ? 1 : 0;
    const down = lerp(lerp(0.95, 0.35, gal), 1.2, Math.max(cr, flee * 0.6)) - 0.25 * T.lash * 0.5 + (mv === "pounce" ? -0.6 * Math.sin(PI * p) : 0);
    const tip = Math.sin(T.t * 4.2) * 0.35 * (cr + 0.2);
    b[BN.tail0].rotation.set(0, tw, lerp(down, 1.25, lieK));
    b[BN.tail1].rotation.set(0, tw * 0.6, lerp(0.25 - 0.2 * gal, -0.2, lieK));
    b[BN.tail2].rotation.set(0, tw * 0.5, 0.12 - 0.1 * gal);
    b[BN.tail3].rotation.set(0, tw * 0.4 + tip * 0.5, -0.18 + 0.12 * gal - 0.1 * cr);
    b[BN.tail4].rotation.set(0, tw * 0.3 + tip, -0.4 + 0.3 * gal - 0.2 * cr);
    // the root carries the leap
    b[BN.root].position.set(0, 0, 0);
  }

  // ==========================================================================
  //  THE CORPSE — the ragdoll moved the proxies; the skin follows them
  // ==========================================================================
  const _v = { x: 0, y: 0, z: 0 };
  let _q = null, _up = null;
  function poseDead(rig, m) {
    const P = rig.prox, D = rig.D, A = D.A, b = rig.bones, BN = rig.table.BN, bp = rig.bindPos;
    if (!P) return;
    // skip when nothing moved since the last write
    let sig = 0;
    for (let i = 0; i < P.all.length; i++) { const q = P.all[i].position; sig += q.x * (i + 1.3) + q.y * (i + 2.1) + q.z * (i + 0.7); }
    const g = m.group;
    sig += g.quaternion.x * 3.1 + g.quaternion.z * 1.7 + g.rotation.x;
    if (rig._deadSig === sig) return;
    rig._deadSig = sig;
    const THREE = W.THREE;
    if (!_q) { _q = new THREE.Quaternion(); _up = new THREE.Vector3(); }
    // THE SKIN IS THICKER THAN THE SOLVER'S TORSO. The solver lays the body
    // on points ~0.1 m thick; a tiger's flank is 0.2 m. Lift the trunk by the
    // difference along the world's up, read in the body frame.
    _q.copy(g.quaternion).invert();
    _up.set(0, 1, 0).applyQuaternion(_q);
    const lift = 0.12 * A;
    const ragdoll = !!m.ragdoll;
    const lx = _up.x * lift, ly = _up.y * lift, lz = _up.z * lift;
    b[BN.pelvis].position.set(D.hipX + lx, D.hipH + ly, lz);
    b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.set(D.shX + lx, D.sh + ly, lz);
    b[BN.chest].rotation.set(0, 0, 0.04);
    b[BN.hump].position.copy(bp[BN.hump]);
    for (let L = 0; L < 4; L++) {
      const front = L < 2, f = D.feet[L];
      jointOf(rig, L, front ? D.shX + lx : D.hipX + lx, front ? D.sh + ly : D.hipH + ly, front ? 0.04 : 0, _j);
      let fx, fy, fz;
      if (ragdoll) {
        const pp = P.paws[L].position, rs = P.rest[4 + L];
        fx = f.x + (pp.x - rs.x); fy = D.pawR + (pp.y - rs.y); fz = f.z + (pp.z - rs.z);
        // the solver's foot hangs off a joint ~7 cm further out: keep the paw
        // within the leg's own reach of OUR joint
      } else {
        // no solver: limp, half-folded, the forelegs reaching, hind trailing
        fx = _j.x + (front ? 0.22 : -0.28) * A; fy = _j.y - (front ? 0.5 : 0.52) * A; fz = _j.z * 1.6;
      }
      _v.x = fx - _j.x; _v.y = fy - _j.y; _v.z = fz - _j.z;
      legIK(rig, L, _j.x, _j.y, _j.z, fx, fy, fz, front ? -0.9 : -HALF + 0.7, front ? 0.04 : 0);
    }
    // the head lolls with the solved head point, swung about the neck
    let pitch = -0.55, yaw = 0, tpitch = 0.9, tyaw = 0;
    if (ragdoll) {
      const h = P.head.position, hr = P.rest[8];
      const nx0 = hr.x - D.shX, ny0 = hr.y - D.sh, nz0 = hr.z;
      const nx1 = h.x - D.shX, ny1 = h.y - D.sh, nz1 = h.z;
      pitch = Math.atan2(ny1, Math.hypot(nx1, nz1)) - Math.atan2(ny0, Math.hypot(nx0, nz0));
      yaw = Math.atan2(-nz1, nx1) - Math.atan2(-nz0, nx0);
      const tl = P.tail.position, tr = P.rest[9];
      const ax0 = tr.x - D.hipX, ay0 = tr.y - D.hipH, ax1 = tl.x - D.hipX, ay1 = tl.y - D.hipH;
      tpitch = -(Math.atan2(ay1, -Math.hypot(ax1, tl.z)) - Math.atan2(ay0, -Math.abs(ax0)));
      tyaw = Math.atan2(tl.z, -ax1) * 0.8;
    }
    b[BN.neck].rotation.set(0, wrapPi(yaw) * 0.55, clamp(pitch, -1.2, 0.8) * 0.6);
    b[BN.neck1].rotation.set(0, wrapPi(yaw) * 0.45, clamp(pitch, -1.2, 0.8) * 0.4);
    b[BN.head].rotation.set(0.12, 0, -0.15);
    b[BN.jaw].rotation.set(0, 0, -0.22);
    b[BN.earL].rotation.set(-0.3, 0, 0.6); b[BN.earR].rotation.set(0.3, 0, 0.6);
    b[BN.tail0].rotation.set(0, clamp(tyaw, -1.2, 1.2), clamp(tpitch, -0.6, 1.4));
    b[BN.tail1].rotation.set(0, 0.15, 0.1); b[BN.tail2].rotation.set(0, 0.12, 0.05);
    b[BN.tail3].rotation.set(0, 0.1, 0.0); b[BN.tail4].rotation.set(0, 0.08, -0.1);
  }

  // ==========================================================================
  //  TOOLS: pose one move at one phase (the shot service's attack frames)
  // ==========================================================================
  function poseMove(m, name, p) {
    const T = brain(m);
    if (!T) return;
    if (name && MOVES[name]) { T.mv = name; T.mvDur = MOVES[name]; T.mvT = clamp(p, 0, 0.999) * T.mvDur; T.side = 1; }
    else T.mv = null;
    pose(m, T, T.rig, 1 / 60);
  }

  CBZ.unitKit.register(ID, {
    kind: "species", stats: STATS, build: build, animate: animate, fight: fight,
    moves: moves, poseMove: poseMove, dims: dims, SEX: SEX, HIT: HIT,
  });
  // the true mass, for systems/bodymass.js (its row value wins over scale^3)
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[ID];
  if (row) row.mass = MASS_ROW;
})();
