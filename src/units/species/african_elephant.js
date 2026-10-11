/* ============================================================
   units/species/african_elephant.js — the African bush elephant, as NPC War
   fights it. OWNED BY: the african elephant agent.

   WHAT WAS HERE: the bestiary's eleven grey boxes (megafauna.js), walked by
   the discovered box-leg rig and fought by creature_combat's generic GORE at
   600 hp, 4.2 m/s. A six-tonne animal that died to eighteen AK rounds and
   could be outrun by a man at a jog.

   WHAT IT IS NOW. One lofted, skinned, vertex-coloured body (one draw call)
   on a 32-bone skeleton: the quadRig table plus a SIX-BONE TRUNK, two fan
   ears, a hanging three-bone tail, columnar legs with the elephant's real
   joint heights (the elbow and the knee sit BELOW the belly line), tusks
   that curve out and up, toenails, soles. Four individuals by spawn index:
     index 0         a bull      3.2 m at the shoulder, 6.0 t, 1.35 m tusks
     then a cycle of cows (2.6 m, 3.0 t), young bulls (2.85 m, 4.0 t) and
     calves (1.3 m, ~0.4 t, no tusks), so a herd is a herd. Dust tint
     (red laterite / grey / pale) and a broken tusk vary per individual.

   THE NUMBERS (real ones; balance is supposed to emerge from them)
     mass            bull 6000 kg (m._mass, read by systems/bodymass.js)
     top speed       6.8 m/s (Hutchinson et al. 2003, Nature: ~25 km/h),
                     NO suspension phase: walk -> amble on the planted-foot
                     solver, duty factor never below 0.5
     sustained       ~4.2 m/s; a charge drains stamina in ~25 s
     acceleration    1.3 m/s^2 up, 3.5 down (a mock charge skids to a halt)
     turn            ~1.3 rad/s at close quarters
     hide            2-4 cm over a 6 t body: danger 0.85 -> hardness 1.43
                     against fists; hp 2400 for a bull = ~70 AK-47 body hits
                     (7.62x39 is a poor elephant round: poached elephants
                     take dozens and keep going), ~18 from the bolt rifle.
                     hp scales with mass^0.67 per individual.
     blows (vs a man, before the target's own soak; x (mass/6 t)^0.67):
                     tusk gore 160, forefoot stomp 260, trunk grab 110 then
                     throw 70, trunk swat 75 (sweeps everyone in the arc),
                     charge impact 28 x speed (190 at full tilt) with the
                     front of the body trampling whoever is in the way.

   BEHAVIOUR (this file's own layer over think.js's beast brain, through the
   seams it already reads: a per-unit copy of `tn` for speed / brave / prey,
   m.tgt for whom, m.target for where a calf stands):
     - a fresh, unhurt elephant meeting a threat at range stops, flares its
       ears, raises its trunk and trumpets (display), then MOCK CHARGES:
       runs in ears out, skids to a halt 10-16 m short and tosses its head.
       It mock-charges once or twice before it commits.
     - wounded, it charges for real: ears pinned back, trunk tucked under,
       head down, full speed at whoever is nearest it.
     - heavy armour (> 20 t): it displays and then leaves.
     - calves never fight: they keep under a cow's flank on the side away
       from the threat. Cows with a living calf in the herd fight to the
       death and turn on anything that comes within 20 m of a calf.
     - bulls quit at 30% (think.js's rout rule), cows defending calves do not.
   FIGHT: tusk gore (head down, thrust up), trunk grab-squeeze-throw (a body
   killed in the trunk is pinned to the trunk tip through CBZ.ragdollPin and
   flung), forefoot stomp (rear up, slam), trunk swat, forehead shove for
   vehicles, and the charge impact. Every blow lands on real contact: the
   tusk tip / trunk tip / forefoot has to be on the target at the strike
   frame, or it is a miss.
   BODY LANGUAGE: ear flare / pin / cooling flaps, head shake, trumpet jaw,
   tail up in alarm, idle feeding / sniffing / resting a hind foot, a hit
   reaction by where the round came from (head toss, flank sway, rear clamp),
   a stagger on heavy hits, a limp (the hurt leg spared, the head nods on
   the sound one) below half hp.
   DEATH: systems/quadruped_ragdoll.js's verlet solver, fed by invisible
   marker meshes (foot + knee per column, head, tail) that its geometric
   sweep discovers; the skinned body is posed off the solved markers in the
   mesh's onBeforeRender, so the legs fold and splay and the head lolls.

   KIT: CBZ.loftKit / CBZ.quadRig / CBZ.quadGait (src/units/kit, unchanged).
   The manifest row's `needs` loads them.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const ID = "african_elephant";
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------ the numbers
  const VMAX = 6.8, VSUSTAIN = 4.2, VWALK = 1.7, ACCEL = 1.3, DECEL = 3.5, TURN = 1.3;
  const STATS = {
    hp: 2400, spd: 1.7, danger: 0.85, bite: 160, scale: 1,
    chase: VMAX, march: 2.0, dmg: 160, rate: 1.0, brave: false, prey: false,
  };
  // sh = shoulder height (m), mass (kg), hpK = (mass / 6 t)^0.67,
  // tuskL / tuskR absolute metres, the rest are shape factors on the bull
  const VARIANTS = {
    bull:      { sh: 3.2,  mass: 6000, hpK: 1.0,  tuskL: 1.35, tuskR: 0.085, head: 1.0,  ear: 1.0,  girth: 1.0,  leg: 1.0,  trunk: 1.0,  sex: "m", calf: false, sizeV: 1 },
    cow:       { sh: 2.6,  mass: 3000, hpK: 0.63, tuskL: 0.75, tuskR: 0.05,  head: 0.95, ear: 0.94, girth: 0.92, leg: 0.94, trunk: 0.96, sex: "f", calf: false, sizeV: 1 },
    youngbull: { sh: 2.85, mass: 4000, hpK: 0.76, tuskL: 0.85, tuskR: 0.06,  head: 0.97, ear: 0.97, girth: 0.95, leg: 0.97, trunk: 0.98, sex: "m", calf: false, sizeV: 1 },
    calf:      { sh: 1.3,  mass: 400,  hpK: 0.16, tuskL: 0,    tuskR: 0,     head: 1.2,  ear: 1.12, girth: 0.97, leg: 1.04, trunk: 0.78, sex: "c", calf: true,  sizeV: 0.85 },
  };
  const HERD_CYCLE = ["cow", "calf", "cow", "youngbull", "cow", "calf", "bull"];
  function variantOf(idx) { return idx <= 0 ? "bull" : HERD_CYCLE[(idx - 1) % HERD_CYCLE.length]; }

  // ------------------------------------------------------------ the bones
  const TRUNK_N = 6;
  let TABLE = null;
  function table() {
    if (TABLE) return TABLE;
    const QR = CBZ.quadRig;
    const T0 = QR.bones({ neck: 1, tail: 3, ears: true, hackle: false, hump: false });
    const BN = Object.assign({}, T0.BN), PARENT = T0.PARENT.slice();
    let NB = T0.NB;
    BN.trunk = [];
    for (let i = 0; i < TRUNK_N; i++) { BN.trunk.push(NB); PARENT.push(i === 0 ? BN.head : BN.trunk[i - 1]); NB++; }
    TABLE = {
      BN: BN, LEGB: T0.LEGB, PARENT: PARENT, NB: NB, spec: T0.spec,
      bindPoints: function (D) {
        const P = T0.bindPoints(D);
        // an elephant's tail HANGS (the kit's default carries it level, a dog's)
        for (let i = 0; i < 3; i++) P[BN["tail" + i]] = [D.tailPts[i].x, D.tailPts[i].y, 0];
        for (let i = 0; i < TRUNK_N; i++) P[BN.trunk[i]] = [D.trunkPts[i].x, D.trunkPts[i].y, 0];
        return P;
      },
    };
    return TABLE;
  }

  /* ------------------------------------------------------------ the body
     Bull template in metres (nose +X, ground 0), scaled by K = sh / 3.2.
     Joint heights from elephant skeletons: shoulder joint 2.12 m, elbow
     ~1.15 m (below the 1.3 m belly), carpus ~0.36 m; hip joint 2.0 m,
     knee ~1.0 m, hock ~0.34 m. Body 3.9 m rump to chest, 2 m wide. */
  function dims(vk) {
    const V = VARIANTS[vk], K = V.sh / 3.2, hs = V.head;
    const P = function (x, y) { return { x: x * K, y: y * K }; };
    const HX = 2.0, HY = 2.66;
    const H = function (x, y) { return { x: (HX + (x - HX) * hs) * K, y: (HY + (y - HY) * hs) * K }; };
    const D = { vk: vk, V: V, K: K, hs: hs, H: H, P: P };
    D.FJ = P(1.15, 2.12); D.HJ = P(-1.2, 2.0);
    D.fa = 0.98 * K; D.fb = 0.80 * K; D.fc = 0.36 * K;
    D.ha = 1.0 * K; D.hb = 0.68 * K; D.hc = 0.34 * K;
    D.shX = 1.1 * K; D.sh = 2.3 * K; D.hipX = -1.15 * K; D.hipH = 2.15 * K;
    D.neckB = P(1.62, 2.62); D.headP = P(HX, HY); D.jawP = H(2.3, 2.1);
    const ep = H(1.88, 2.98); D.earP = { x: ep.x, y: ep.y, z: 0.47 * K * hs };
    D.tailPts = [P(-1.83, 2.72), P(-1.9, 2.3), P(-1.95, 1.9)];
    D.tailTip = P(-1.98, 1.45); D.tailP = D.tailPts[0]; D.tailL = 1.25 * K;
    D.legZf = 0.5 * K; D.legZh = 0.47 * K;
    const tb = H(2.62, 2.16), Lt = 1.95 * K * hs * V.trunk;
    D.trunkBase = tb; D.trunkLen = Lt; D.trunkSeg = Lt / TRUNK_N;
    D.trunkPts = [];
    for (let i = 0; i < TRUNK_N; i++) D.trunkPts.push({ x: tb.x + 0.1 * K * hs * (i / (TRUNK_N - 1)), y: tb.y - D.trunkSeg * i });
    D.faceX = tb.x;
    // tusks: out of the lip sheaths, forward and a little down, then up
    D.tuskL = V.tuskL; D.tuskR = V.tuskR;
    const t0 = H(2.47, 2.12);
    D.tuskBase = { x: t0.x, y: t0.y, z: 0.22 * K * hs };
    // a quadratic curve: out of the sheath pointing down and forward, sweeping
    // forward and a little up at the tip (a bull's tusks, seen from the side)
    D.tuskAt = function (s, L, out) {
      const a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s;
      out.x = D.tuskBase.x + L * (b * 0.3 + c * 0.86);
      out.y = D.tuskBase.y + L * (b * -0.62 + c * -0.18);
      out.z = D.tuskBase.z + L * (b * 0.12 + c * 0.06);
      return out;
    };
    D.tuskTip = D.tuskL > 0 ? D.tuskAt(1, D.tuskL, {}) : { x: tb.x + 0.15 * K, y: tb.y, z: 0 };
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    D.feet = [
      { x: D.FJ.x + 0.04 * K, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.04 * K, z: D.legZf, front: true },
      { x: D.HJ.x - 0.02 * K, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.02 * K, z: D.legZh, front: false },
    ];
    D.Kg = V.sh / 0.62;          // the gait kit's size unit (1 = a 0.62 m shepherd)
    return D;
  }

  // ---- the hide. Colours are r128 setHex values (no colour-space step).
  const TINTS = [
    { base: 0x76706a, dust: 0x8f6b52, dustAmt: 0.55, mud: 0x4e4640 },   // red laterite dust (Tsavo)
    { base: 0x6d6964, dust: 0x8a8580, dustAmt: 0.25, mud: 0x45403b },   // clean grey after a wallow
    { base: 0x7a7570, dust: 0xa39d94, dustAmt: 0.5, mud: 0x5a524a },    // pale dry-mud
  ];
  function rgb(h) { return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]; }
  function toHex(r, g, b) { return (Math.round(clamp(r, 0, 1) * 255) << 16) | (Math.round(clamp(g, 0, 1) * 255) << 8) | Math.round(clamp(b, 0, 1) * 255); }
  function hideFn(D, tint, seed) {
    const T = TINTS[tint], B = rgb(T.base), Du = rgb(T.dust), Mu = rgb(T.mud), K = D.K, k = 1 / K;
    const r = mkRng(seed ^ 0xE1E9);
    const p0 = r() * 6, p1 = r() * 6, p2 = r() * 6;
    const SOLE = 0x37322e, NAIL = 0xb8ae9c, EYE = 0x120c08, LID = 0x3e3934, LIP = 0x5b4d47, INNER = 0x8a7c76, TUFT = 0x161311;
    /* The palette below is written as the colour you SEE (sRGB). The page
       renders with outputEncoding = sRGB and r128 takes vertex colours as
       linear, so every value is linearised on the way out; written raw, a
       grey elephant came out chalk white. */
    const raw = function (part, x, y, z, ca, sa, R, t) {
      if (part === "nail") return NAIL;
      if (part === "eye") return EYE;
      if (part === "lid") return LID;
      if (part === "tuft") return TUFT;
      if (part === "lip") return LIP;
      if ((part === "fleg" || part === "hleg") && R && R.cap && y < 0.2 * K) return SOLE;
      // mottled hide, the low-frequency variation a lit wrinkled skin reads as
      const mott = Math.sin(x * 3.1 * k + Math.sin(z * 2.3 * k + y * 1.7 * k + p0) * 2.0) * Math.sin(y * 2.7 * k - z * 1.9 * k + p1);
      let sh = 0.93 + 0.1 * mott + 0.04 * Math.sin(x * 11 * k + y * 7 * k + p2);
      let cr = B[0], cg = B[1], cb = B[2];
      // dust lies on what faces the sky: the back, the head, the tops of the ears
      let dk = 0;
      if (part === "torso" || part === "head" || part === "neck") dk = T.dustAmt * clamp((ca - 0.05) / 0.7, 0, 1);
      else if (part === "ear") dk = T.dustAmt * 0.5 * clamp((y - 2.5 * K) / (0.6 * K), 0, 1);
      else if (part === "fleg" || part === "hleg") dk = T.dustAmt * 0.35 * clamp((y - 1.0 * K) / K, 0, 1);
      cr = lerp(cr, Du[0], dk); cg = lerp(cg, Du[1], dk); cb = lerp(cb, Du[2], dk);
      // the belly and the insides of the legs in their own shade
      if ((part === "torso" || part === "neck") && ca < -0.35) sh *= 0.86;
      // wallow mud to the knees
      if (part === "fleg" || part === "hleg" || part === "torso") {
        const mk = clamp((0.62 * K - y) / (0.5 * K), 0, 1) * 0.85;
        cr = lerp(cr, Mu[0], mk); cg = lerp(cg, Mu[1], mk); cb = lerp(cb, Mu[2], mk);
        // leg creases: horizontal rings of fold
        sh *= 1 - 0.07 * Math.pow(Math.abs(Math.sin(y * 9 * k + Math.sin(x * 5 * k + z * 5 * k) * 0.6)), 6);
      }
      if (part === "head") {
        // the face around the eye darker; the bull's temporal gland streak
        const ex = D.H(2.3, 2.6), dx = (x - ex.x) * k, dy = (y - ex.y) * k;
        if (dx * dx + dy * dy < 0.03 && Math.abs(sa) > 0.6) sh *= 0.78;
        const gx = D.H(2.12, 2.48);
        if (D.V.sex === "m" && Math.abs(sa) > 0.7 && Math.abs((x - gx.x) * k) < 0.06 && (y - gx.y) * k < 0.1 && (y - gx.y) * k > -0.28) sh *= 0.62;
      }
      if (part === "trunk") {
        // the trunk's transverse folds, and a darker underside
        sh *= 1 - 0.1 * Math.pow(Math.abs(Math.sin(t * 46)), 5);
        if (ca < -0.3) sh *= 0.9;
      }
      if (part === "ear") {
        // the body-facing side of the ear is paler, pink-grey and veined
        if (R && R.side * sa < -0.2) {
          const I = rgb(INNER);
          const vein = Math.pow(Math.abs(Math.sin((x * 4.0 + y * 6.5) * k + Math.sin(y * 3 * k) * 1.5)), 8);
          return toHex(I[0] * (1 - 0.25 * vein), I[1] * (1 - 0.3 * vein), I[2] * (1 - 0.3 * vein));
        }
        if (Math.abs(sa) < 0.35) sh *= 0.85;           // the rim
      }
      if (part === "tusk") {
        // ivory: stained at the lip, clean toward the tip
        const a = rgb(0xa58a62), c = rgb(0xe6dac0), e = rgb(0xf0e8d6);
        const q = clamp(t * 1.4, 0, 1);
        return toHex(lerp(lerp(a[0], c[0], sstep(0, 0.35, q)), e[0], sstep(0.6, 1, q)),
          lerp(lerp(a[1], c[1], sstep(0, 0.35, q)), e[1], sstep(0.6, 1, q)),
          lerp(lerp(a[2], c[2], sstep(0, 0.35, q)), e[2], sstep(0.6, 1, q)));
      }
      if (part === "tail") sh *= 0.85;
      return toHex(cr * sh, cg * sh, cb * sh);
    };
    return function (part, x, y, z, ca, sa, R, t) {
      const h = raw(part, x, y, z, ca, sa, R, t);
      return toHex(Math.pow((h >> 16 & 255) / 255, 2.2), Math.pow((h >> 8 & 255) / 255, 2.2), Math.pow((h & 255) / 255, 2.2));
    };
  }

  function buildGeometry(D, tint, broken, seed) {
    const LK = CBZ.loftKit, T = table(), BN = T.BN, LEGB = T.LEGB;
    const G = LK.geo(), K = D.K, V = D.V, H = D.H, P = D.P, hs = D.hs, g = V.girth;
    const col = hideFn(D, tint, seed);
    const C = function (part) { return function (x, y, z, ca, sa, R, t) { return col(part, x, y, z, ca, sa, R, t); }; };
    const PL = BN.pelvis, CH = BN.chest, NK = BN.neck, HD = BN.head, TB = BN.trunk;

    // ---- TORSO: rump to brisket. x, back top, belly bottom, half width, pelvis weight
    const TORSO = [
      [-1.92, 2.62, 1.98, 0.40, 1], [-1.78, 2.86, 1.62, 0.64, 1], [-1.55, 2.98, 1.42, 0.80, 1],
      [-1.2, 3.0, 1.36, 0.89, 1], [-0.7, 2.93, 1.31, 0.97, 0.8], [-0.2, 2.92, 1.29, 1.02, 0.5],
      [0.3, 3.03, 1.33, 1.0, 0.25], [0.75, 3.16, 1.42, 0.94, 0.05], [1.1, 3.2, 1.52, 0.86, 0],
      [1.4, 3.08, 1.62, 0.74, 0], [1.62, 2.95, 1.8, 0.58, 0],
    ];
    const torso = TORSO.map(function (a) {
      const top = a[1] * K, bot = a[2] * K, cy = (top + bot) / 2;
      return { x: a[0] * K, y: cy, rt: top - cy, rb: cy - bot, w: a[3] * K * g, wts: [PL, a[4], CH, 1 - a[4]] };
    });
    LK.loft(G, torso, 30, C("torso"), { capLen: 0.7 });

    // ---- NECK + HEAD + TRUNK as ONE loft, so the face flows into the trunk
    const ht = [];
    const pushH = function (p, rt, rb, w, wts, part) { ht.push({ x: p.x, y: p.y, rt: rt * K * hs, rb: rb * K * hs, w: w * K * hs, wts: wts, part: part }); };
    pushH(P(1.25, 2.6), 0.62 / hs, 0.74 / hs, 0.66 / hs, [CH, 0.7, NK, 0.3], "neck");
    pushH(P(1.5, 2.63), 0.58 / hs, 0.68 / hs, 0.6 / hs, [CH, 0.25, NK, 0.75], "neck");
    pushH(H(1.75, 2.66), 0.56, 0.64, 0.56, [NK, 0.5, HD, 0.5], "head");
    pushH(H(1.98, 2.69), 0.5, 0.62, 0.51, [HD, 1], "head");
    pushH(H(2.2, 2.66), 0.45, 0.6, 0.46, [HD, 1], "head");
    pushH(H(2.4, 2.56), 0.38, 0.52, 0.39, [HD, 1], "head");
    pushH(H(2.54, 2.4), 0.3, 0.36, 0.31, [HD, 1], "head");
    pushH(H(2.62, 2.2), 0.23, 0.24, 0.23, [HD, 0.6, TB[0], 0.4], "trunk");
    // the trunk, down its rest curve; weights by arc length over the 6 bones
    const tb = D.trunkBase, Lt = D.trunkLen, seg = D.trunkSeg;
    // a ring belongs to the bone whose segment it sits in, blended across
    // each joint, and to the skull near the root, so the trunk bends out of
    // the face instead of tearing away from it
    const NT = 16;
    for (let i = 1; i <= NT; i++) {
      const s = i / NT, len = s * Lt;
      const g = len / seg - 0.5;
      let wts;
      if (g < 0) { const hw = Math.min(0.6, -g * 1.2); wts = [HD, hw, TB[0], 1 - hw]; }
      else {
        const i0 = Math.min(TRUNK_N - 1, Math.floor(g)), fr = g - i0;
        wts = i0 >= TRUNK_N - 1 ? [TB[TRUNK_N - 1], 1] : [TB[i0], 1 - fr, TB[i0 + 1], fr];
      }
      const curl = sstep(0.8, 1, s);
      const x = tb.x + 0.1 * K * hs * s + 0.07 * K * hs * curl, y = tb.y - len + 0.03 * K * curl;
      const r = lerp(0.215, 0.07, Math.pow(s, 0.85)) * K * hs * (0.9 + 0.1 * V.trunk);
      ht.push({ x: x, y: y, rt: r * 1.04, rb: r, w: r, wts: wts, part: "trunk" });
    }
    LK.loft(G, ht, 22, function (x, y, z, ca, sa, R, t) { return col(R.part || "trunk", x, y, z, ca, sa, R, t); }, { capLen: 0.5 });

    // ---- the lower lip, a short pointed lip under the trunk base
    const lip = [H(2.18, 2.06), H(2.38, 2.0), H(2.5, 1.99)].map(function (p, i) {
      const r = [0.1, 0.075, 0.045][i] * K * hs;
      return { x: p.x, y: p.y, rt: r * 0.7, rb: r, w: r * [2.0, 1.6, 1.0][i], wts: [BN.jaw, 1] };
    });
    LK.loft(G, lip, 10, C("lip"), { capLen: 0.8 });

    // ---- eyes: small, set low on the side of the head, a wrinkled lid round each
    for (let sd = -1; sd <= 1; sd += 2) {
      const e = H(2.3, 2.6), z = sd * 0.415 * K * hs;
      LK.ellipsoid(G, e.x, e.y + 0.01 * K, z * 0.985, 0.07 * K * hs, 0.05 * K * hs, 0.025 * K * hs, 8, function () { return col("lid"); }, [HD, 1]);
      LK.ellipsoid(G, e.x + 0.005 * K, e.y, z * 1.01, 0.045 * K * hs, 0.028 * K * hs, 0.022 * K * hs, 8, function () { return col("eye"); }, [HD, 1]);
    }

    // ---- tusks, in their lip sheaths (one may be broken short)
    if (D.tuskL > 0) {
      const tp = {};
      for (let sd = -1; sd <= 1; sd += 2) {
        const L = D.tuskL, stub = broken && sd > 0 ? 0.42 : 1;
        const st = [];
        const N = 9;
        for (let i = 0; i <= N; i++) {
          const s = (i / N) * stub;
          D.tuskAt(s, L, tp);
          const r = D.tuskR * (1 - 0.6 * s) * (i === N && broken && sd > 0 ? 1.1 : 1);
          st.push({ x: tp.x, y: tp.y, z: sd * tp.z, rt: r, rb: r, w: r, wts: [HD, 1] });
        }
        LK.loft(G, st, 10, C("tusk"), { capLen: broken && sd > 0 ? 0.25 : 2.2 });
        // the sheath: the upper lip's skin swelling down round the tusk root,
        // grown out of the face so the tusk leaves the head, not a socket
        const sb = D.tuskBase, sr = D.tuskR * 1.6 + 0.025 * K;
        D.tuskAt(0.07, L, tp);
        const sh = [
          { x: sb.x - 0.2 * K * hs, y: sb.y + 0.22 * K * hs, z: sd * sb.z * 0.8, rt: sr * 1.5, rb: sr * 1.5, w: sr * 1.2, wts: [HD, 1] },
          { x: sb.x - 0.06 * K * hs, y: sb.y + 0.07 * K * hs, z: sd * sb.z * 0.95, rt: sr * 1.15, rb: sr * 1.15, w: sr, wts: [HD, 1] },
          { x: tp.x, y: tp.y, z: sd * tp.z, rt: sr * 0.8, rb: sr * 0.8, w: sr * 0.78, wts: [HD, 1] },
        ];
        LK.loft(G, sh, 10, C("head"), { capLen: 0.5 });
      }
    }

    // ---- EARS: the great fans, lying back over the shoulder at rest
    const EAR = [[0.0, 0.05, 0.40], [0.1, 0.12, 0.82], [0.27, 0.16, 1.02], [0.52, 0.17, 1.1], [0.8, 0.15, 1.04],
      [1.07, 0.12, 0.88], [1.3, 0.09, 0.66], [1.47, 0.06, 0.42], [1.6, 0.04, 0.2]];
    for (let sd = -1; sd <= 1; sd += 2) {
      const eb = sd < 0 ? BN.earL : BN.earR, E = D.earP, es = K * hs * V.ear;
      const st = EAR.map(function (a) {
        return { x: E.x, y: E.y + (0.24 - a[0]) * es, z: sd * (E.z + 0.02 * a[0] * es), rt: a[1] * es, rb: a[2] * es, w: 0.03 * K * (0.9 + 0.2 * a[0]), wts: [eb, 1], side: sd };
      });
      LK.loft(G, st, 14, C("ear"), { side: [0.45 * sd, 0, 0.89], capLen: 0.6 });
    }

    // ---- TAIL: a hanging rope with a tuft of black wire hair
    const tl = D.tailPts.concat([D.tailTip]);
    const tst = [];
    for (let i = 0; i < tl.length; i++) {
      const w = i === 0 ? [BN.tail0, 1] : i === 1 ? [BN.tail0, 0.4, BN.tail1, 0.6] : [BN.tail2, 1];
      const r = lerp(0.07, 0.03, i / (tl.length - 1)) * K;
      tst.push({ x: tl[i].x, y: tl[i].y, rt: r, rb: r, w: r, wts: w });
    }
    LK.loft(G, tst, 8, C("tail"), { capLen: 0.6 });
    const tt = D.tailTip;
    LK.loft(G, [
      { x: tt.x, y: tt.y + 0.04 * K, rt: 0.035 * K, rb: 0.035 * K, w: 0.035 * K, wts: [BN.tail2, 1] },
      { x: tt.x - 0.01 * K, y: tt.y - 0.1 * K, rt: 0.06 * K, rb: 0.06 * K, w: 0.05 * K, wts: [BN.tail2, 1] },
      { x: tt.x - 0.02 * K, y: tt.y - 0.24 * K, rt: 0.03 * K, rb: 0.03 * K, w: 0.025 * K, wts: [BN.tail2, 1] },
    ], 8, C("tuft"), { capLen: 0.8 });

    // ---- LEGS: columns. dy below the joint, rt (front), rb (back), w (side), weights
    const pts = T.bindPoints(D);
    const lg = V.leg * K;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], J = pts[ids[0]], jx = J[0], jy = J[1], z = J[2];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb;
      const u = ids[0], l = ids[1], f = ids[2];
      const rows = front ? [
        [0.42, 0.40, 0.44, 0.36, [u, 1]], [0.12, 0.38, 0.42, 0.34, [u, 1]], [-0.3, 0.31, 0.35, 0.29, [u, 1]],
        [-a / K + 0.12, 0.26, 0.31, 0.25, [u, 0.8, l, 0.2]], [-a / K, 0.245, 0.29, 0.235, [u, 0.5, l, 0.5]],
        [-a / K - 0.15, 0.23, 0.24, 0.22, [l, 1]], [-a / K - 0.5, 0.205, 0.205, 0.2, [l, 1]],
        [-(a + b) / K + 0.05, 0.2, 0.2, 0.195, [l, 0.7, f, 0.3]], [-(a + b) / K, 0.205, 0.205, 0.2, [l, 0.5, f, 0.5]],
        [-(a + b) / K - 0.12, 0.215, 0.21, 0.215, [f, 1]],
      ] : [
        [0.38, 0.44, 0.50, 0.32, [u, 1]], [0.05, 0.43, 0.48, 0.31, [u, 1]], [-0.4, 0.35, 0.38, 0.27, [u, 1]],
        [-a / K + 0.15, 0.27, 0.27, 0.23, [u, 0.8, l, 0.2]], [-a / K, 0.255, 0.25, 0.22, [u, 0.5, l, 0.5]],
        [-a / K - 0.2, 0.22, 0.24, 0.2, [l, 1]], [-(a + b) / K + 0.08, 0.19, 0.21, 0.18, [l, 1]],
        [-(a + b) / K, 0.19, 0.2, 0.18, [l, 0.5, f, 0.5]], [-(a + b) / K - 0.1, 0.2, 0.2, 0.185, [f, 1]],
      ];
      const st = rows.map(function (q) { return { x: jx, y: jy + q[0] * K, z: z, rt: q[1] * lg, rb: q[2] * lg, w: q[3] * lg, wts: q[4] }; });
      // the foot: a round (front) or oval (hind) pad spreading to the ground
      const fr = front ? [0.255, 0.23, 0.25] : [0.245, 0.2, 0.215];
      st.push({ x: jx + 0.02 * K, y: 0.08 * K, z: z, rt: fr[0] * lg, rb: fr[1] * lg, w: fr[2] * lg, wts: [f, 1] });
      st.push({ x: jx + 0.02 * K, y: 0.012 * K, z: z, rt: fr[0] * lg * 1.02, rb: fr[1] * lg * 1.02, w: fr[2] * lg * 1.02, wts: [f, 1] });
      LK.loft(G, st, 16, C(front ? "fleg" : "hleg"), { capLen: 0.12 });
      // toenails round the front of the foot: four in front, three behind
      const nn = front ? [-0.78, -0.26, 0.26, 0.78] : [-0.6, 0, 0.6];
      for (let n = 0; n < nn.length; n++) {
        const an = nn[n], R0 = fr[0] * lg * 0.97;
        LK.ellipsoid(G, jx + 0.02 * K + Math.cos(an) * R0, 0.065 * K, z + Math.sin(an) * R0 * (fr[2] / fr[0]),
          0.035 * K, 0.04 * K, 0.05 * K, 6, function () { return col("nail"); }, [f, 1]);
      }
    }
    return LK.toGeometry(G, { boundingSphere: [0.5 * K, 1.6 * K, 0, 4.4 * K] });
  }

  // ------------------------------------------------------------ build
  const GEO = new Map();
  let MARK_MAT = null;
  const MARK_GEO = new Map();
  function markGeo(THREE, w, h) {
    const key = w.toFixed(3) + "|" + h.toFixed(3);
    let g = MARK_GEO.get(key);
    if (!g) { g = new THREE.BoxGeometry(w, h, w); g._shared = true; MARK_GEO.set(key, g); }
    return g;
  }
  function build(ctx) {
    const THREE = (ctx && ctx.THREE) || W.THREE, LK = CBZ.loftKit, QR = CBZ.quadRig;
    if (!THREE || !LK || !QR || !CBZ.quadGait) return null;
    const seed = ((ctx && ctx.seed) | 0) >>> 0;
    const idx = seed >= 7919 ? seed - 7919 : seed;
    const vk = variantOf(idx);
    const D = dims(vk);
    const h = mkRng(seed * 2654435761 + 17);
    const tint = Math.floor(h() * TINTS.length) % TINTS.length;
    const broken = D.tuskL > 0 && h() < 0.22;
    const gkey = vk + "|" + tint + "|" + (broken ? 1 : 0);
    let geo = GEO.get(gkey);
    if (!geo) { geo = buildGeometry(D, tint, broken, tint * 31 + (broken ? 7 : 0) + 1); GEO.set(gkey, geo); }
    const T = table();
    const rig = QR.makeSkeleton(T, D, "eleph");
    const mesh = QR.skinnedMesh(geo, LK.sharedSkinMaterial("elephant-hide"), rig);
    mesh.receiveShadow = false;
    mesh.name = "elephant-body";
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    const R = {
      D: D, T: T, BN: T.BN, bones: rig.bones, bindPos: rig.bindPos, mesh: mesh, group: group,
      unit: null, mk: null, J: [], broken: broken, tint: tint,
    };
    const pts = T.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) { const p = pts[T.LEGB[Lg][0]]; R.J.push(new THREE.Vector3(p[0], p[1], p[2])); }
    /* THE CORPSE'S HANDLES. quadruped_ragdoll.js discovers a body from its
       direct child meshes (a leg = something taller than wide standing on
       the ground; the head = what is far forward and up; the tail = what is
       far back). A skinned body has one mesh, so these invisible boxes are
       the columns it finds: per leg a foot box (0..0.3 K) and a knee box
       (0..hM). The solver re-places them each step; the skin is posed off
       them in onBeforeRender (deadPose below). */
    if (!MARK_MAT) { MARK_MAT = new THREE.MeshBasicMaterial({ color: 0xff00ff }); MARK_MAT._shared = true; }
    const K = D.K, fH = 0.3 * K, hM = D.FJ.y / 1.02;
    R.mk = { foot: [], knee: [], head: null, tail: null, fBy: fH / 2, hM: hM };
    const addMark = function (w, hh, x, y, z) {
      const mm = new THREE.Mesh(markGeo(THREE, w, hh), MARK_MAT);
      mm.visible = false; mm.castShadow = false; mm.position.set(x, y, z); mm.userData.elMarker = true;
      group.add(mm); return mm;
    };
    for (let Lg = 0; Lg < 4; Lg++) {
      const J = R.J[Lg];
      R.mk.foot.push(addMark(0.12 * K, fH, J.x, fH / 2, J.z));
      R.mk.knee.push(addMark(0.12 * K, hM, J.x, hM / 2, J.z));
    }
    R.mk.head = addMark(0.12 * K, 0.12 * K, D.headP.x + 0.15 * K, D.headP.y, 0);
    R.mk.tail = addMark(0.1 * K, 0.1 * K, D.tailPts[1].x, D.tailPts[1].y, 0);
    R.rest = { foot: R.mk.foot.map(function (o) { return o.position.clone(); }), head: R.mk.head.position.clone(), tail: R.mk.tail.position.clone() };
    // the solver's own numbers for a column built this way (see buildRig there)
    const bodyY = hM * 1.02, y0 = fH / 2, y1 = (y0 + bodyY) / 2;
    R.k2 = (hM / 2 - y0) / (y1 - y0);
    R.pivot = new THREE.Vector3((D.FJ.x + D.FJ.x) / 2, bodyY, 0);
    R.hipPivot = new THREE.Vector3(D.HJ.x, bodyY, 0);
    mesh.onBeforeRender = function () { deadPose(R); };
    group.userData.elRig = R;
    return group;
  }

  // ------------------------------------------------------------ the gait
  let GAIT = null;
  function gaitTable() {
    if (GAIT) return GAIT;
    const QG = CBZ.quadGait;
    /* Lateral-sequence walk into the amble (Hutchinson 2006: limb phase
       ~0.2, duty factor > 0.5 at every speed, no whole-body suspension).
       Cadence fitted to elephant data: ~0.7 Hz at 1.5 m/s, ~1.2 Hz at 4,
       capped ~1.6 Hz; stride ~2.1 m walking, ~4.3 m at full speed. */
    GAIT = Object.assign({}, QG.TABLES.ELEPHANT, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.0, 0.5], duty: 0.68, lift: 0.034 },
        { name: "amble", key: "wA", off: [0.17, 0.67, 0.0, 0.5], duty: 0.52, lift: 0.044 },
      ],
      trans: [[0.85, 1.25]],
      fMax: 3.6, f0: 0.9, fV: 2.35, strideMax: 1.25,
      vMove: 0.1, turnMove: 0.22, turnF: 1.1, settleRate: 1.5, restLift: 0.024, restStep: 0.05,
    });
    return GAIT;
  }

  // ------------------------------------------------------------ the world
  const HERD = [];
  const ACT = []; let actT = -9;
  // the SIM clock (CBZ.now follows the speed dial): the trample cooldown and
  // the roster cache were on the wall clock, so at 4x a man could be trampled
  // once per 3.2 sim s and at 0.25x four times as often as authored
  function nowS() {
    if (typeof CBZ.now === "number" && isFinite(CBZ.now)) return CBZ.now * 0.001;
    return (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) * 0.001;
  }
  function modeDesc() { const g = CBZ.game, ms = CBZ.modes; return g && ms ? ms[g.mode] : null; }
  function actors() {
    const t = nowS();
    if (t - actT < 0.25) return ACT;
    actT = t; ACT.length = 0;
    const d = modeDesc();
    if (d && typeof d.actors === "function") { try { d.actors(ACT); } catch (e) { ACT.length = 0; } }
    return ACT;
  }
  function hurt(m, a, dmg) {
    if (!a || a.dead || !(dmg > 0)) return 0;
    const d = modeDesc();
    if (!d || typeof d.hurt !== "function") return 0;
    const k = (!a.vehicle && CBZ.meleeAbsorb) ? CBZ.meleeAbsorb(a) : 1;
    try { d.hurt(a, dmg * k, { by: m }); } catch (e) { return 0; }
    return dmg * k;
  }
  function enemy(m, a) { return a && a !== m && !a.dead && !a.fled && a.team !== m.team; }

  // ------------------------------------------------------------ one elephant
  function ensure(m) {
    if (m._el) return m._el;
    const R = m.group && m.group.userData && m.group.userData.elRig;
    if (!R || !CBZ.quadGait) return null;
    const QG = CBZ.quadGait, D = R.D, V = D.V;
    const s = (m.group.scale && m.group.scale.x) || 1;
    const E = {
      unit: m, rig: R, D: D, V: V, s: s, t: 0, rng: mkRng((m.i | 0) * 7919 + (m.team === "red" ? 1 : 2)),
      px: null, pz: null, ph: 0, v: 0, turn: 0, stam: 1, vcap: 0, wantV: VWALK,
      mood: "calm", moodT: 0, tgtRef: null, mocked: 0, dispDur: 1.8, mockStop: 12,
      scanT: 0, nearD: 1e9, nearA: null, heavy: null, calfAlive: false,
      lastHp: m.hp, hit: 0, hitSide: 1, hitLoc: "flank", stagger: 0, woundT: 0,
      limpLeg: -1, limpK: 0, retreatT: 0, trumpetT: 0, shakeT: 0,
      act: null, cd: 0, fightTick: false, engaged: 0, trT: 0,
      idle: null, idleT: 3, idleK: 0, restLeg: 2,
      ear: 0.1, earTilt: 0, flapPh: 0, neckP: 0, neckY: 0, neckX: 0, tail: 0, jaw: 0,
      tz: new Float32Array(TRUNK_N), ty: new Float32Array(TRUNK_N),
      wz: new Float32Array(TRUNK_N), wy: new Float32Array(TRUNK_N),
      cY: 0, cR: 0, pY: 0, roll: 0,
    };
    const gd = { K: D.Kg * s, legLen: D.legLen * s, feet: D.feet.map(function (f) { return { x: f.x * s, z: f.z * s, front: f.front }; }) };
    E.G = QG.create(gd, gaitTable());
    QG.reset(E.G, m.pos.x, m.pos.z, m.heading || 0, CBZ.floorAt || null, m.pos.y);
    E.tn = m.tn = Object.assign({}, m.tn);
    E.mass = V.mass * s * s * s; m._mass = E.mass;
    /* THIS FILE BILLS ITS OWN CHARGE: the ram (28 x v), the splash (17 x v)
       and the trample (16 x v) already are the collision's injury. The
       battle's body layer (physics.js contactImpulse) still moves the man
       by momentum, but does not hurt him a second time for the same hit. */
    m.impactBilled = true;
    E.mf = Math.pow(E.mass / 6000, 0.67);
    if (m.maxHp > 0 && m.maxHp < 1e8) {
      const hp = Math.max(30, Math.round(m.maxHp * V.hpK));
      m.hp = Math.round(m.hp / m.maxHp * hp); m.maxHp = hp;
    }
    E.lastHp = m.hp;
    if (V.calf) E.tn.prey = true;
    E.mockStop = (10 + E.rng() * 6) * Math.sqrt(D.K);
    E.pinAt = function (out) { trunkTipWorld(E, out); };
    R.unit = m;
    collar(m, R);
    HERD.push(E);
    m._el = E;
    return E;
  }

  /* THE SIDE'S MARK. beasts.js gives every animal a thin team-coloured box
     at a guessed neck height, which on this body pokes out under the jaw.
     Real elephants wear exactly one thing round the neck: a researcher's GPS
     collar. So the side's colour becomes that: a band on the neck bone
     behind the ears, with the transmitter box hanging under the throat. */
  const COLLAR = new Map();
  function collar(m, R) {
    const THREE = W.THREE, g = m.group;
    if (!THREE || !g) return;
    let box = null;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      if (c.isMesh && c !== R.mesh && !(c.userData && c.userData.elMarker)) { box = c; break; }
    }
    if (!box) return;
    const D = R.D, K = D.K, key = D.vk;
    let geo = COLLAR.get(key);
    if (!geo) {
      geo = new THREE.TorusGeometry(1, 0.035 / (0.66 * K), 6, 28);
      geo._shared = true; COLLAR.set(key, geo);
    }
    box.geometry = geo;
    const neck = R.bones[R.BN.neck], nb = D.neckB;
    neck.add(box);
    box.position.set(1.55 * K - nb.x, 2.58 * K - nb.y, 0);
    box.rotation.set(0, HALF, 0);
    box.scale.set(0.63 * K, 0.7 * K, 0.66 * K);
    box.castShadow = false;
  }

  // ---- what an elephant sees (every ~0.45 s)
  function scan(m, E) {
    const A = actors();
    let nd = 1e18, na = null, heavy = null;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!enemy(m, a)) continue;
      const dx = a.pos.x - m.pos.x, dz = a.pos.z - m.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < nd) { nd = d2; na = a; }
      if (a.vehicle && (a._mass || 0) > 20000 && d2 < 4900) heavy = a;
    }
    E.nearD = Math.sqrt(nd); E.nearA = na; E.heavy = heavy;
    // the herd: is there a calf to protect, and is anything on it?
    E.calfAlive = false;
    let threat = null, td = 1e9;
    for (let i = HERD.length - 1; i >= 0; i--) {
      const h = HERD[i], u = h.unit;
      if (!u || u.dead || u.fled || !u.group || !u.group.parent) { if (!u || u.dead || u.fled) HERD.splice(i, 1); continue; }
      if (u.team !== m.team || !h.V.calf || h === E) continue;
      E.calfAlive = true;
      if (h.nearA && h.nearD < 20 && !h.nearA.dead) {
        const d = Math.hypot(h.nearA.pos.x - m.pos.x, h.nearA.pos.z - m.pos.z);
        if (d < td) { td = d; threat = h.nearA; }
      }
    }
    E.calfThreat = threat; E.calfThreatD = td;
  }

  function face(m, E, x, z, dt, rate) {
    const want = Math.atan2(z - m.pos.z, x - m.pos.x);
    const dh = wrapPi(want - (m.heading || 0)), mx = rate * dt;
    m.heading = (m.heading || 0) + clamp(dh, -mx, mx);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
    else if (m.group) m.group.rotation.y = -m.heading;
    return wrapPi(want - m.heading);
  }

  function onHit(m, E, dmg) {
    E.woundT = 10;
    const src = (m.tgt && !m.tgt.dead) ? m.tgt : E.nearA;
    let a = (E.rng() - 0.5) * 2;
    if (src && src.pos) a = wrapPi(Math.atan2(src.pos.z - m.pos.z, src.pos.x - m.pos.x) - (m.heading || 0));
    E.hitLoc = Math.abs(a) < 0.6 ? "head" : Math.abs(a) > 2.4 ? "rear" : "flank";
    E.hitSide = Math.sin(a) >= 0 ? 1 : -1;
    E.hit = Math.min(1.5, E.hit + 0.3 + dmg / Math.max(1, m.maxHp) * 8);
    if (dmg > 0.06 * m.maxHp) E.stagger = 1;
    if (m.hp < m.maxHp * 0.55 && E.limpLeg < 0) E.limpLeg = (E.hitLoc === "rear" ? 2 : 0) + (E.hitSide > 0 ? 1 : 0);
    if (!E.V.calf && E.retreatT <= 0 && m.slot !== "fallback") {
      // a wounded elephant charges what hurt it
      if (src && src.pos && m.tgt !== src && !src.dead && Math.hypot(src.pos.x - m.pos.x, src.pos.z - m.pos.z) < 60 && E.rng() < 0.6) m.tgt = src;
      if (E.mood !== "charge" && E.trumpetT <= 0) E.trumpetT = 1.0;
      E.mood = "charge"; E.tgtRef = m.tgt; E.moodT = 0;
    }
  }

  function calfBrain(m, E, dt) {
    E.tn.prey = true;
    E.mood = "calf";
    let mom = null, md = 1e9;
    for (let i = 0; i < HERD.length; i++) {
      const h = HERD[i], u = h.unit;
      if (h === E || !u || u.dead || u.fled || u.team !== m.team || h.V.calf) continue;
      const d = Math.hypot(u.pos.x - m.pos.x, u.pos.z - m.pos.z) + (h.V.sex === "f" ? 0 : 12);
      if (d < md) { md = d; mom = u; }
    }
    if (!mom) { E.wantV = VMAX * 0.85; return; }
    // under the flank AWAY from the threat
    const th = E.nearA;
    const ch = Math.cos(mom.heading || 0), sh = Math.sin(mom.heading || 0);
    let side = 1;
    if (th) {
      const lz = -sh * (th.pos.x - mom.pos.x) + ch * (th.pos.z - mom.pos.z);
      side = lz > 0 ? -1 : 1;
    }
    const ms = (mom._el && mom._el.D.K) || 0.8, off = 1.55 * ms, back = -0.4 * ms;
    const tx = mom.pos.x + ch * back - sh * side * off, tz = mom.pos.z + sh * back + ch * side * off;
    const d = Math.hypot(tx - m.pos.x, tz - m.pos.z);
    m.target.set(d < 0.9 ? m.pos.x : tx, 0, d < 0.9 ? m.pos.z : tz);
    E.wantV = d < 0.9 ? 0 : clamp(d * 1.2, 1.2, VMAX);
  }

  function adultBrain(m, E, dt, hpF) {
    const tn = E.tn, t = m.tgt;
    tn.brave = E.V.sex === "f" && E.calfAlive;
    if (E.retreatT > 0) {
      E.retreatT -= dt; tn.prey = E.retreatT > 0; E.mood = "flee"; E.wantV = VMAX;
      return;
    }
    tn.prey = false;
    // a calf under threat outranks everything
    if (E.calfThreat && !E.calfThreat.dead && E.calfThreat !== m.tgt && !E.act) {
      const cur = t && !t.dead ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
      if (E.calfThreatD < 45 && cur > E.calfThreatD + 6) {
        m.tgt = E.calfThreat; E.tgtRef = m.tgt; E.mood = "charge"; E.moodT = 0;
        if (E.trumpetT <= 0) E.trumpetT = 0.9;
      }
    }
    const tg = m.tgt;
    if (!tg || tg.dead || tg.fled) {
      E.tgtRef = null;
      E.mood = m.slot === "fallback" ? "flee" : "calm";
      E.wantV = m.slot === "fallback" ? VMAX : 2.2;
      return;
    }
    const d = Math.hypot(tg.pos.x - m.pos.x, tg.pos.z - m.pos.z);
    if (tg !== E.tgtRef) {
      E.tgtRef = tg; E.mocked = 0; E.moodT = 0;
      if (E.woundT > 0 || E.mood === "charge") E.mood = "charge";
      else if (tg.vehicle && (tg._mass || 0) > 20000) E.mood = "display";
      else if (d > 45) E.mood = "approach";
      else if (d > 16 && hpF > 0.85) E.mood = "display";
      else E.mood = "charge";
      E.dispDur = 1.3 + E.rng() * 1.4;
    }
    E.moodT += dt;
    const heavyT = tg.vehicle && (tg._mass || 0) > 20000;
    switch (E.mood) {
      case "approach":
        E.wantV = d > 70 ? 3.2 : 2.4;
        if (d < 45) { E.mood = E.woundT > 0 ? "charge" : "display"; E.moodT = 0; }
        break;
      case "display":
        E.wantV = 0;
        face(m, E, tg.pos.x, tg.pos.z, dt, 0.9);
        if (E.moodT < 0.1 && E.trumpetT <= 0) E.trumpetT = 1.3;
        if (E.moodT > E.dispDur) {
          E.mood = (E.woundT > 0 || E.mocked >= 2) ? "charge" : "mock"; E.moodT = 0;
          if (heavyT && E.mocked >= 1) { E.retreatT = 8; E.mood = "flee"; }
        }
        break;
      case "mock":
        E.wantV = VMAX * 0.72;
        if (d < E.mockStop || E.moodT > 5) { E.mood = "halt"; E.moodT = 0; E.mocked++; E.shakeT = 1.2; }
        break;
      case "halt":
        E.wantV = 0;
        face(m, E, tg.pos.x, tg.pos.z, dt, 0.9);
        if (E.moodT > 1.6) {
          E.moodT = 0;
          if (heavyT) { E.retreatT = 8; E.mood = "flee"; }
          else if (E.woundT > 0 || E.mocked >= 2 || E.rng() < 0.5) E.mood = "charge";
          else { E.mood = "display"; E.dispDur = 0.8 + E.rng(); }
        }
        break;
      case "charge":
        E.wantV = VMAX;
        // a charge goes through whoever is nearest, not past him after the first mark
        if (E.nearA && E.nearA !== tg && !E.act && E.nearD < d - 3 && !E.nearA.dead) { m.tgt = E.nearA; E.tgtRef = E.nearA; }
        if (E.moodT < 0.1 && E.trumpetT <= 0 && E.rng() < 0.5) E.trumpetT = 0.8;
        break;
      default:
        E.mood = "approach";
    }
  }

  function brain(m, E, dt) {
    const av = Math.abs(E.v);
    if (av > VSUSTAIN) E.stam = Math.max(0, E.stam - dt * (av - VSUSTAIN) / (VMAX - VSUSTAIN) / 25);
    else if (av < 2.5) E.stam = Math.min(1, E.stam + dt / 45);
    if (m.hp < E.lastHp - 0.01) onHit(m, E, E.lastHp - m.hp);
    E.lastHp = m.hp;
    if (E.woundT > 0) E.woundT -= dt;
    const hpF = clamp(m.hp / Math.max(1, m.maxHp), 0, 1);
    E.scanT -= dt;
    if (E.scanT <= 0) { E.scanT = 0.42 + (m.i % 5) * 0.03; scan(m, E); }
    if (m.you) {
      // a player has this body: no displays, no mock charges, no retreat;
      // the legs are still an elephant's (stamina, wounds, acceleration)
      E.tn.prey = false; E.wantV = VMAX; E.retreatT = 0;
      E.mood = av > 3.5 ? "charge" : (m.tgt && !m.tgt.dead ? "approach" : "calm");
    } else if (E.V.calf) calfBrain(m, E, dt); else adultBrain(m, E, dt, hpF);
    // the legs: stamina, wounds and acceleration decide the speed this body can do
    const vmax = (VSUSTAIN + (VMAX - VSUSTAIN) * E.stam) * (0.55 + 0.45 * Math.sqrt(hpF)) * E.V.sizeV;
    const want = Math.min(E.wantV, vmax);
    E.vcap = E.vcap < want ? Math.min(want, E.vcap + ACCEL * dt) : Math.max(want, E.vcap - DECEL * dt);
    E.tn.chase = Math.max(0, E.vcap);
    E.tn.march = Math.min(E.tn.chase, VWALK + 0.3);
    E.limpK = approach(E.limpK, E.limpLeg >= 0 ? clamp((0.55 - hpF) / 0.3, 0.3, 1) : 0, 1, dt);
  }

  // ---- trample: the front of a running elephant goes through people
  const TRAMPLED = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  // a man the ram (or its splash) just struck is not trampled again by the
  // same front in the same 0.8 s: one collision, billed once
  function trampled(a) { if (TRAMPLED && a) TRAMPLED.set(a, nowS() + 0.8); }
  function trample(m, E, dt) {
    if (E.act || E.v < 2.6 || E.V.calf) return;
    E.trT -= dt;
    if (E.trT > 0) return;
    E.trT = 0.2;
    const A = actors(), c = Math.cos(m.heading || 0), sn = Math.sin(m.heading || 0), s = E.s, K = E.D.K, now = nowS();
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!enemy(m, a) || a.vehicle) continue;
      const dx = a.pos.x - m.pos.x, dz = a.pos.z - m.pos.z;
      const lx = c * dx + sn * dz, lz = -sn * dx + c * dz, ar = a.rad || 0.45;
      if (lx < 0.2 * K * s || lx > E.D.faceX * s + ar || Math.abs(lz) > 0.75 * K * s + ar * 0.5) continue;
      if (TRAMPLED) { const tt = TRAMPLED.get(a); if (tt && tt > now) continue; TRAMPLED.set(a, now + 0.8); }
      hurt(m, a, 16 * E.v * E.mf);
    }
  }

  // ------------------------------------------------------------ the fight
  const RES = { inRange: false, dealt: 0, missed: false };
  const _w = { x: 0, y: 0, z: 0 };
  function toWorld(m, E, lx, lz, out) {
    const c = Math.cos(m.heading || 0), sn = Math.sin(m.heading || 0), s = E.s;
    out.x = m.pos.x + (c * lx - sn * lz) * s; out.z = m.pos.z + (sn * lx + c * lz) * s;
    return out;
  }
  // is t inside a box in front of m: lx in [x0, x1], |lz| < hw (model metres)?
  function inFront(m, E, t, x0, x1, hw) {
    if (!t || t.dead) return false;
    const c = Math.cos(m.heading || 0), sn = Math.sin(m.heading || 0), s = E.s;
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, tr = (t.rad || 0.45) / s;
    const lx = (c * dx + sn * dz) / s, lz = (-sn * dx + c * dz) / s;
    return lx > x0 - tr && lx < x1 + tr && Math.abs(lz) < hw + tr;
  }
  function contact(t, px, pz, tol) {
    if (!t || t.dead) return false;
    return Math.hypot(t.pos.x - px, t.pos.z - pz) <= (t.rad || 0.45) + tol;
  }
  function splash(m, E, px, pz, r, dmg, except, max) {
    const A = actors();
    let n = 0, sum = 0;
    for (let i = 0; i < A.length && n < max; i++) {
      const a = A[i];
      if (a === except || !enemy(m, a)) continue;
      if (Math.hypot(a.pos.x - px, a.pos.z - pz) > r + (a.rad || 0.45)) continue;
      sum += hurt(m, a, dmg); n++;
      trampled(a);
    }
    return sum;
  }
  function bill(m, t, dmg, opts, live) {
    if (!t || t.dead || !(dmg > 0)) return 0;
    if (live && opts && typeof opts.onHit === "function" && (m.tgt === t || opts.youMove)) { opts.onHit(dmg); return dmg; }
    return hurt(m, t, dmg);
  }
  function massOf(t) {
    if (!t) return 80;
    if (t.vehicle) return t._mass || 10000;
    if (!t.beast) return 80;
    if (t._mass > 0) return t._mass;
    return CBZ.bodyMass ? CBZ.bodyMass(t) : 200;
  }
  const MOVES = {
    gore:  { T: 1.35, strike: 0.42 },
    grab:  { T: 2.3, strike: 0.26, release: 0.64 },
    stomp: { T: 1.5, strike: 0.48, feet: true },
    swat:  { T: 1.0, strike: 0.42 },
    shove: { T: 1.8, strike: 0.5 },
    ram:   { T: 0.9, strike: 0 },
  };
  function startAct(m, E, kind, t, opts) {
    const M = MOVES[kind];
    const rk = opts && opts.rate && E.tn.rate ? clamp(E.tn.rate / opts.rate, 0.75, 1.3) : 1;
    E.act = { kind: kind, t: 0, T: M.T / rk, tgt: t, hit: false, held: false, thrown: false, pinned: false, missed: false,
      side: E.rng() < 0.5 ? -1 : 1, leg: E.rng() < 0.5 ? 0 : 1, feet: !!M.feet, aimY: 0, aimP: 0 };
    if (kind === "swat" && t) {
      const a = wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0));
      E.act.side = a >= 0 ? 1 : -1;
    }
    m._elAct = kind;
  }
  function endAct(m, E) {
    const A = E.act;
    if (!A) return;
    if (A.pinned && A.tgt && CBZ.ragdollUnpin) { try { CBZ.ragdollUnpin(A.tgt); } catch (e) {} }
    E.act = null; m._elAct = null;
    if (A.you) m._atkAnim = -1;
    E.cd = 0.35 + E.rng() * 0.6;
    if (A.feet && CBZ.quadGait) CBZ.quadGait.reset(E.G, m.pos.x, m.pos.z, m.heading || 0, CBZ.floorAt || null, m.pos.y);
  }
  function stepAct(m, E, dt, live, opts) {
    const A = E.act, D = E.D, K = D.K, s = E.s;
    A.t += dt;
    const u = Math.min(1, A.t / A.T), t = A.tgt, mf = E.mf * (opts && opts.dmg ? opts.dmg / STATS.dmg : 1);
    const c = Math.cos(m.heading || 0), sn = Math.sin(m.heading || 0);
    const M = MOVES[A.kind];
    // a blow is thrown walking in: the body keeps closing on a mark that backs off
    if (live && t && !t.dead && opts && opts.move && A.kind !== "stomp" && A.kind !== "ram" && u < 0.6) {
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
      const want = (D.tuskL > 0 ? D.tuskTip.x : D.faceX + 0.1 * K) * s - 0.1 * s;
      if (d - (t.rad || 0.45) > want) opts.move(m, dx / d, dz / d, Math.min(Math.max(2.2, E.vcap * 0.6) * dt, d - (t.rad || 0.45) - want));
      // close in, an elephant pivots on its forefeet to bring the trunk round
      face(m, E, t.pos.x, t.pos.z, dt, A.kind === "grab" || A.kind === "swat" ? 2.2 : TURN * 0.8);
    }
    if (A.kind === "gore") {
      if (live && u > 0.33 && u < 0.47 && opts && opts.move) opts.move(m, c, sn, 0.6 * K * s * dt / (0.14 * A.T));
      if (!A.hit && u >= M.strike) {
        A.hit = true;
        // the tusks (or the forehead) sweep up through everything from the
        // face to the tips; the man has to be inside that box at the thrust
        if (live && inFront(m, E, t, D.faceX * 0.85, D.tuskTip.x + 0.25 * K, 0.42 * K + D.tuskBase.z)) RES.dealt += bill(m, t, 160 * mf * (D.tuskL > 0 ? 1 : 0.55), opts, live);
        else if (live) RES.missed = true;
      }
    } else if (A.kind === "grab") {
      if (!A.hit && u >= M.strike) {
        A.hit = true;
        // the trunk closes on anything along its reach, root to tip
        let inReach = false;
        if (live && t && !t.dead) {
          const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
          const lx = (c * dx + sn * dz) / s, lz = (-sn * dx + c * dz) / s, tr = (t.rad || 0.45) / s;
          // anywhere the trunk can swing to: within its length of the root,
          // forward of the shoulder, up to ~65 degrees off the nose
          const bx = lx - D.faceX * 0.9, bd = Math.hypot(bx, lz);
          inReach = lx > D.FJ.x && bd < D.trunkLen + tr && Math.abs(Math.atan2(lz, Math.max(1e-3, lx))) < 1.15;
        }
        if (inReach) {
          A.held = true;
          RES.dealt += bill(m, t, 110 * mf, opts, live);
          if (t.dead && CBZ.ragdollPin && !(opts && opts.youMove)) { try { A.pinned = !!CBZ.ragdollPin(t, { point: "torso", at: E.pinAt, until: 3, stiff: 1 }); } catch (e) {} }
        } else { A.missed = true; if (live) RES.missed = true; A.T *= 0.62; }
      }
      if (A.held && !A.thrown && u >= M.release) {
        A.thrown = true;
        if (A.pinned) { try { CBZ.ragdollUnpin(t); } catch (e) {} A.pinned = false; }
        else if (t && !t.dead && !(opts && opts.youMove)) RES.dealt += bill(m, t, 70 * mf, opts, live);
      }
    } else if (A.kind === "stomp") {
      if (!A.hit && u >= M.strike) {
        A.hit = true;
        const fz = A.leg === 0 ? -D.legZf : D.legZf;
        toWorld(m, E, D.FJ.x + 1.0 * K, fz, _w);
        let any = false;
        if (live && contact(t, _w.x, _w.z, 0.45 * s)) { RES.dealt += bill(m, t, 260 * mf, opts, live); any = true; }
        if (live) { const sp = splash(m, E, _w.x, _w.z, 0.5 * s, 200 * mf, t, 3); if (sp > 0) any = true; }
        if (live && !any) RES.missed = true;
      }
    } else if (A.kind === "swat") {
      if (!A.hit && u >= M.strike) {
        A.hit = true;
        const reach = D.faceX + D.trunkLen * 0.7;
        toWorld(m, E, reach * 0.8, A.side * reach * 0.35, _w);
        let any = false;
        if (live && t && !t.dead && Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) < (reach + 0.4 * K) * s + (t.rad || 0.45)) { RES.dealt += bill(m, t, 75 * mf, opts, live); any = true; }
        if (live) { const sp = splash(m, E, _w.x, _w.z, 1.3 * K * s, 60 * mf, t, 4); if (sp > 0) any = true; }
        if (live && !any) RES.missed = true;
      }
    } else if (A.kind === "shove") {
      if (live && u > 0.3 && u < 0.7 && opts && opts.move) opts.move(m, c, sn, 0.5 * K * s * dt / (0.4 * A.T));
      if (!A.hit && u >= M.strike) {
        A.hit = true;
        toWorld(m, E, D.faceX + 0.3 * K, 0, _w);
        if (live && contact(t, _w.x, _w.z, 1.2 * s)) RES.dealt += bill(m, t, 140 * mf, opts, live);
        else if (live) RES.missed = true;
      }
    }
    if (u >= 1) endAct(m, E);
  }
  function pickMove(m, E, t, gap, dh) {
    const D = E.D, K = D.K, s = E.s;
    const tm = massOf(t);
    const tuskGap = (D.tuskL > 0 ? D.tuskTip.x : D.faceX + 0.2 * K) * s;
    const opts = [];
    let wsum = 0;
    const add = function (k, w) { opts.push(k, w); wsum += w; };
    if (t.vehicle) { if (gap <= D.faceX * s + 0.8 * s) add("shove", 1); }
    else if (E.v > 2.6) {
      // on the run an elephant does not stop to pick at things: it tusks
      // what is in front of it and keeps driving (the ram is the default)
      if (gap <= tuskGap + 0.2 * s) add("gore", 1);
    } else {
      if (gap <= (D.FJ.x + 1.25 * K) * s && tm < 1500) add("stomp", t.beast ? 0.3 : 0.4);
      if (gap <= tuskGap + 0.35 * s) add("gore", t.beast ? 0.6 : 0.45);
      if (!t.beast && tm < 250 && gap <= (D.faceX + D.trunkLen * 0.85) * s && gap > D.faceX * s * 0.7) add("grab", 0.4);
      if (gap <= (D.faceX + D.trunkLen * 0.7) * s && (Math.abs(dh) > 0.22 || E.crowdNear)) add("swat", 0.25);
    }
    if (!wsum) return null;
    let r = E.rng() * wsum;
    for (let i = 0; i < opts.length; i += 2) { r -= opts[i + 1]; if (r <= 0) return opts[i]; }
    return opts[opts.length - 2];
  }
  function fight(m, t, dt, opts) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    const E = ensure(m);
    if (!E || m.dead || !t) return RES;
    E.fightTick = true; E.engaged = 0.6;
    const ym = opts && opts.youMove;
    if (ym && !E.act && m._atkAnim >= 0) return youStrike(m, E, t, dt, opts, ym);
    if (E.act) {
      stepAct(m, E, dt, !t.dead, opts);
      if (E.act && E.act.you) m._atkAnim = Math.min(0.999, Math.max(1e-3, E.act.t / E.act.T));
      RES.inRange = true; return RES;
    }
    if (m.you) return RES;                 // a player chooses this body's blows
    if (t.dead) return RES;
    const D = E.D, K = D.K, s = E.s;
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-6, nx = dx / d, nz = dz / d;
    const gap = d - (t.rad || 0.45);
    RES.inRange = d <= ((opts && opts.reach) || m.reach || 5);
    if (E.V.calf) {
      // a calf backs away and keeps its mother between it and the fight
      if (opts && opts.move && gap < 6) opts.move(m, -nx, -nz, 2.5 * dt);
      face(m, E, t.pos.x, t.pos.z, dt, 2);
      return RES;
    }
    const dh = face(m, E, t.pos.x, t.pos.z, dt, TURN);
    if (E.cd > 0) E.cd -= dt;
    // THE CHARGE ARRIVES: six tonnes at speed through the front rank
    if (Math.abs(dh) < 0.5 && E.v > 3.0 && gap < D.faceX * s + 0.6 * s) {
      startAct(m, E, "ram", t, opts);
      const mf = E.mf * (opts && opts.dmg ? opts.dmg / STATS.dmg : 1);
      RES.dealt += bill(m, t, 28 * E.v * mf, opts, true); trampled(t);
      toWorld(m, E, D.faceX + 0.4 * K, 0, _w);
      splash(m, E, _w.x, _w.z, 1.1 * K * s, 17 * E.v * mf, t, 5);
      return RES;
    }
    if (E.cd <= 0 && Math.abs(dh) < 0.45) {
      const mv = pickMove(m, E, t, gap, dh);
      if (mv) { startAct(m, E, mv, t, opts); stepAct(m, E, 0, true, opts); return RES; }
    }
    // close the last metres (beastMove stops the body at its mouth)
    const want = (D.tuskL > 0 ? D.tuskTip.x : D.faceX + 0.1 * K) * s - 0.15 * s;
    if (gap > want && opts && opts.move) {
      const v = E.mood === "charge" ? Math.max(1.8, E.vcap) : 1.8;
      opts.move(m, nx, nz, Math.min(v * dt, gap - want));
    }
    return RES;
  }

  /* THE PLAYER'S ATTACK. src/battle/player.js latches a move on the body
     (_atkAnim = 0) and calls fight() with opts.youMove every step until
     _atkAnim goes negative. The move id (from moves() below) becomes this
     file's own action, so a possessed elephant throws exactly the blows the
     AI does, with the same timing, contact gates and damage. */
  const YOU_KIND = { trunk: "grab", grab: "grab", gore: "gore", ram: "ram", trample: "stomp", stomp: "stomp", kick: "stomp", swat: "swat", shove: "shove" };
  function youStrike(m, E, t, dt, opts, ym) {
    let kind = YOU_KIND[ym.id] || YOU_KIND[ym.style] || "gore";
    if (t && t.vehicle) kind = "shove";
    if (E.V.calf && kind !== "ram") kind = "gore";
    startAct(m, E, kind, t, opts);
    E.act.you = true;
    if (kind === "ram") {
      const D = E.D, K = D.K;
      const mf = E.mf * (opts.dmg ? opts.dmg / STATS.dmg : 1);
      if (!t.dead && !t.dummy && inFront(m, E, t, D.faceX * 0.8, D.faceX + 0.8 * K, 0.7 * K)) {
        RES.dealt += bill(m, t, 28 * Math.max(2.5, Math.abs(E.v)) * mf, opts, true); trampled(t);
        toWorld(m, E, D.faceX + 0.4 * K, 0, _w);
        splash(m, E, _w.x, _w.z, 1.1 * K * E.s, 17 * Math.max(2.5, Math.abs(E.v)) * mf, t, 5);
      } else RES.missed = true;
    } else stepAct(m, E, dt, !t.dead, opts);
    if (E.act) m._atkAnim = Math.min(0.999, Math.max(1e-3, E.act.t / E.act.T));
    RES.inRange = true;
    return RES;
  }
  /* moves(unit, tgt, ctx): what ATTACK throws for a player (kit/moves.js).
     Ids are CBZ.unitMoves.MOVES' own where they exist; the swat is ours. */
  const SWAT_MOVE = { id: "swat", style: "gore", pow: 0.5, dur: 1.0, rng: 1.2, cd: 0.6 };
  function moves(unit, tgt, ctx) {
    ctx = ctx || {};
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 4;
    const running = !!ctx.sprint || (ctx.speed > 3);
    if (!tgt) return "gore";
    if (tgt.vehicle) return "ram";
    if (ctx.downed) return "trample";
    if (running && dist > reach * 0.8 && dist < reach * 2.6) return "ram";
    if ((ctx.crowd || 0) >= 3 && (ctx.n || 1) % 2 === 0) return SWAT_MOVE;
    if (!ctx.heavy && dist < reach * 1.25) return (ctx.n || 1) % 3 === 0 ? "gore" : "trunk";
    return "gore";
  }

  // ------------------------------------------------------------ the pose
  // trunk shapes: z-rotation per bone (+ curls forward / up)
  const SH = {
    raise: [0.75, 0.7, 0.62, 0.45, 0.05, -0.35],     // the trumpet: up in a curve, tip flared
    peri:  [0.5, 0.42, 0.32, 0.22, 0.15, 0.25],      // up and forward, smelling
    tuck:  [-0.15, -0.35, -0.45, -0.5, -0.5, -0.45], // curled under, out of harm (the real charge)
    reach: [0.5, 0.35, 0.25, 0.15, 0.1, 0.15],
    lift:  [0.85, 0.75, 0.65, 0.55, 0.5, 0.4],
    whip:  [0.6, 0.45, 0.3, 0.1, 0.0, -0.05],
    feed:  [-0.1, -0.5, -0.7, -0.8, -0.7, -0.5],     // curled back to the mouth
    curl:  [0.05, 0.05, 0.1, 0.18, 0.3, 0.45],       // the relaxed hang, tip turned up
  };
  function addShape(out, sh, w) { if (w) for (let i = 0; i < TRUNK_N; i++) out[i] += sh[i] * w; }
  const O = { w: 0, neckP: 0, neckY: 0, cDY: 0, cPitch: 0, pDY: 0, ear: 0, jaw: 0, trunk: new Float32Array(TRUNK_N), trunkY: new Float32Array(TRUNK_N), foot: -1, fx: 0, fy: 0, fa: 0 };
  function actPose(m, E) {
    const A = E.act, K = E.D.K, D = E.D;
    O.w = 0; O.neckP = O.neckY = O.cDY = O.cPitch = O.pDY = O.ear = O.jaw = 0; O.foot = -1;
    O.trunk.fill(0); O.trunkY.fill(0);
    if (!A) return;
    const u = Math.min(1, A.t / A.T);
    O.w = 1 - sstep(0.8, 1, u);
    if (A.kind === "gore") {
      const dn = sstep(0, 0.32, u) * (1 - sstep(0.38, 0.5, u)), up = sstep(0.36, 0.48, u) * (1 - sstep(0.6, 1, u));
      O.neckP = -0.55 * dn + 0.5 * up; O.cDY = (-0.12 * dn + 0.08 * up) * K; O.cPitch = -0.06 * dn + 0.08 * up;
      addShape(O.trunk, SH.tuck, 0.8 * dn + 0.4 * up); O.ear = 0.5 * dn + 0.8 * up;
    } else if (A.kind === "grab") {
      const rc = sstep(0, 0.24, u) * (1 - sstep(0.28, 0.42, u));
      const lf = A.held ? sstep(0.28, 0.48, u) * (1 - sstep(0.58, 0.66, u)) : 0;
      const wh = A.held ? sstep(0.58, 0.65, u) * (1 - sstep(0.7, 1, u)) : 0;
      // aim the reach at the man
      const t = A.tgt;
      if (t && t.pos && u < 0.3) {
        const a = wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0));
        A.aimY = clamp(a, -0.6, 0.6);
      }
      addShape(O.trunk, SH.reach, rc); addShape(O.trunk, SH.lift, lf); addShape(O.trunk, SH.whip, wh);
      for (let i = 0; i < TRUNK_N; i++) O.trunkY[i] = A.aimY * (i === 0 ? 0.6 : 0.1) * rc;
      O.neckP = -0.2 * rc + 0.4 * lf - 0.15 * wh; O.ear = 0.7; O.neckY = A.aimY * 0.4 * rc;
    } else if (A.kind === "stomp") {
      const rear = sstep(0, 0.38, u) * (1 - sstep(0.42, 0.5, u)), slam = sstep(0.42, 0.5, u) * (1 - sstep(0.7, 1, u));
      O.cDY = (0.38 * rear - 0.06 * slam) * K; O.cPitch = 0.14 * rear - 0.04 * slam; O.pDY = -0.1 * K * rear;
      O.neckP = 0.3 * rear - 0.25 * slam; O.ear = 1;
      addShape(O.trunk, SH.raise, 0.5 * rear); addShape(O.trunk, SH.tuck, 0.4 * slam);
      O.foot = A.leg;
      const nx = D.feet[A.leg].x;
      const liftX = D.FJ.x + 0.55 * K, liftY = 0.95 * K, slamX = D.FJ.x + 1.0 * K;
      const toSlam = sstep(0.42, 0.5, u), back = sstep(0.75, 1, u);
      let fx = lerp(nx, liftX, sstep(0, 0.38, u)), fy = lerp(0, liftY, sstep(0, 0.38, u));
      fx = lerp(fx, slamX, toSlam); fy = lerp(fy, 0, toSlam);
      O.fx = lerp(fx, nx, back); O.fy = lerp(fy, 0, back);
      O.fa = -HALF - 0.9 * sstep(0, 0.38, u) * (1 - toSlam);
    } else if (A.kind === "swat") {
      const w = sstep(0.05, 0.28, u) * (1 - sstep(0.6, 1, u));
      const sw = lerp(A.side * 1.1, -A.side * 0.9, sstep(0.28, 0.55, u));
      const k = [0.5, 0.25, 0.15, 0.1, 0.05, 0.05];
      for (let i = 0; i < TRUNK_N; i++) O.trunkY[i] = sw * k[i] * w;
      addShape(O.trunk, SH.reach, 0.55 * w); O.neckY = sw * 0.3 * w; O.ear = 0.8;
    } else if (A.kind === "shove") {
      const dd = sstep(0, 0.3, u) * (1 - sstep(0.75, 1, u));
      O.neckP = -0.35 * dd; O.cDY = -0.1 * K * dd; O.cPitch = -0.05 * dd; addShape(O.trunk, SH.tuck, dd); O.ear = 0.3;
    } else if (A.kind === "ram") {
      const tt = sstep(0, 0.2, u) * (1 - sstep(0.35, 1, u));
      O.neckP = 0.45 * tt; addShape(O.trunk, SH.tuck, 1 - u); O.ear = 0;
    }
  }

  const _ik = [0, 0];
  const _tw = new Float32Array(TRUNK_N), _tyw = new Float32Array(TRUNK_N);
  function legIK(R, D, Lg, fx, fy, fa, bx, by, br, roll, abz) {
    const T = R.T, b = R.bones, bp = R.bindPos, ids = T.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const off = bp[ids[0]];
    const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
    const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y - off.z * roll;
    const wx = fx - cl * Math.cos(fa), wy = fy - cl * Math.sin(fa);
    CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
    const t1 = _ik[0], t2 = _ik[1];
    const ab = -Math.atan2(abz, Math.max(0.5 * D.K, jy - fy));
    b[ids[0]].rotation.set(ab - roll, 0, t1 + HALF - br);
    b[ids[1]].rotation.set(0, 0, t2 - t1);
    b[ids[2]].rotation.set(0, 0, fa - t2);
  }

  function pose(m, E, dt) {
    const QG = CBZ.quadGait, R = E.rig, D = E.D, K = D.K, b = R.bones, bp = R.bindPos, BN = R.BN, G = E.G, s = E.s;
    const ground = CBZ.floorAt || null;
    actPose(m, E);
    const holdFeet = E.act && E.act.feet;
    if (!holdFeet) QG.step(G, dt, E.v, E.turn, m.pos.x, m.pos.z, m.heading || 0, ground, m.pos.y);
    const Mx = G.mix, ph = G.phase * TAU, av = Math.abs(E.v);
    const moveK = clamp(av / 0.5, 0, 1), amb = (Mx.wA || 0) * moveK;
    const hpF = clamp(m.hp / Math.max(1, m.maxHp), 0, 1);
    const mood = E.mood, tgt = m.tgt && !m.tgt.dead ? m.tgt : null;

    // ---- timers
    E.hit = Math.max(0, E.hit - dt * 2.2);
    E.stagger = Math.max(0, E.stagger - dt * 1.6);
    if (E.trumpetT > 0) E.trumpetT -= dt;
    if (E.shakeT > 0) E.shakeT -= dt;
    if (E.engaged > 0) E.engaged -= dt;

    // ---- idle behaviour, when nothing is happening
    const calm = (mood === "calm" || mood === "calf") && av < 0.3 && !E.act && E.engaged <= 0 && !tgt;
    if (calm) {
      E.idleT -= dt;
      if (E.idleT <= 0) {
        if (E.idle) { E.idle = null; E.idleT = 2 + E.rng() * 4; }
        else { const r = E.rng(); E.idle = r < 0.35 ? "feed" : r < 0.6 ? "sniff" : r < 0.82 ? "rest" : "flap"; E.idleT = 2.5 + E.rng() * 3; E.restLeg = 2 + (E.rng() < 0.5 ? 0 : 1); E.sniffY = (E.rng() - 0.5) * 1.2; }
      }
    } else if (E.idle) { E.idle = null; E.idleT = 1.5; }
    E.idleK = approach(E.idleK, E.idle ? 1 : 0, 2.5, dt);

    // ---- mood layers
    let earT = 0.08, tilt = 0, headT = -0.06, tailRaise = 0, jawT = 0, shake = 0;
    _tw.fill(0); _tyw.fill(0);
    addShape(_tw, SH.curl, 1);
    if (mood === "display" || mood === "halt") {
      earT = 1.0; tilt = 0.25; headT = 0.32; tailRaise = 0.5; addShape(_tw, SH.raise, 0.9);
      shake = (mood === "halt" || E.shakeT > 0) ? 1 : 0.35;
    } else if (mood === "mock") {
      earT = 1.0; tilt = 0.2; headT = 0.22; tailRaise = 0.7;
      addShape(_tw, SH.raise, 0.4 + 0.25 * Math.sin(E.t * 3.1)); addShape(_tw, SH.peri, 0.25);
    } else if (mood === "charge") {
      earT = tgt && Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z) > 25 ? 0.7 : 0.0;
      headT = av > 2 ? -0.18 : 0.05; tailRaise = 0.9; addShape(_tw, SH.tuck, earT > 0.3 ? 0.4 : 1.0);
    } else if (mood === "flee") {
      earT = 0.35; headT = 0.2; tailRaise = 1.0; addShape(_tw, SH.raise, 0.35);
    } else if (mood === "approach") {
      earT = 0.4; headT = 0.12; addShape(_tw, SH.peri, 0.45 + 0.2 * Math.sin(E.t * 0.9));
    } else if (mood === "calf") {
      earT = 0.15; tailRaise = av > 1.5 ? 0.6 : 0.1;
    }
    if (E.trumpetT > 0) { jawT = 0.28; addShape(_tw, SH.raise, 0.8 * sstep(0, 0.3, E.trumpetT)); earT = Math.max(earT, 0.9); headT += 0.12; }
    if (E.idle === "feed") addShape(_tw, SH.feed, E.idleK);
    else if (E.idle === "sniff") { addShape(_tw, SH.peri, 0.8 * E.idleK); for (let i = 0; i < 3; i++) _tyw[i] += E.sniffY * 0.3 * E.idleK; headT += 0.1 * E.idleK; }
    else if (E.idle === "flap") earT += 0.25 * E.idleK;
    // looking at the threat
    let lookY = 0;
    if (tgt && !E.act) lookY = clamp(wrapPi(Math.atan2(tgt.pos.z - m.pos.z, tgt.pos.x - m.pos.x) - (m.heading || 0)), -0.45, 0.45);
    // wounds: low hp carries the head low and the ears slack
    headT -= 0.25 * clamp((0.35 - hpF) / 0.35, 0, 1);
    // walking: the trunk swings like a pendulum, the head nods
    for (let i = 0; i < TRUNK_N; i++) {
      _tw[i] += moveK * (0.07 + 0.04 * amb) * Math.sin(ph * 2 - i * 0.45) * (1 - 0.4 * (mood === "charge" ? 1 : 0));
      _tyw[i] += 0.05 * Math.sin(E.t * 0.7 + i * 0.5) * (1 - moveK * 0.5) + moveK * 0.04 * Math.sin(ph - i * 0.4);
    }

    // ---- the hit reaction, by where it came from
    const hk = Math.min(1, E.hit);
    let hRoll = 0, hHead = 0, hPel = 0, hYaw = 0;
    if (hk > 0) {
      if (E.hitLoc === "head") { hHead = 0.32 * hk; hYaw = -E.hitSide * 0.25 * hk; }
      else if (E.hitLoc === "flank") { hRoll = E.hitSide * 0.07 * hk; hYaw = E.hitSide * 0.2 * hk; }
      else { hPel = -0.07 * hk; tailRaise = Math.max(tailRaise, -0.4) - 0.6 * hk; }
      earT = Math.max(earT, 0.6 * hk);
    }

    // ---- smooth the layers (an elephant is not twitchy, except when hit)
    const ow = O.w;
    E.ear = approach(E.ear, lerp(earT, O.ear, ow), ow > 0 ? 8 : 3, dt);
    E.earTilt = approach(E.earTilt, tilt * E.ear, 3, dt);
    E.neckP = approach(E.neckP, lerp(headT, O.neckP, ow) + hHead, ow > 0 ? 10 : 3, dt);
    E.neckY = approach(E.neckY, lerp(lookY, O.neckY, ow) + hYaw, 3, dt);
    E.tail = approach(E.tail, tailRaise, 3, dt);
    E.jaw = approach(E.jaw, jawT, 8, dt);
    const tr = ow > 0 ? 9 : 2.5;
    for (let i = 0; i < TRUNK_N; i++) {
      E.tz[i] = approach(E.tz[i], lerp(_tw[i], O.trunk[i], ow), tr, dt);
      E.ty[i] = approach(E.ty[i], lerp(_tyw[i], O.trunkY[i], ow), tr, dt);
    }

    // ---- the body over the legs
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0;
    const bob = -0.022 * K * (0.5 - 0.5 * Math.cos(2 * ph)) * moveK;
    pY += bob; cY += bob * 1.1;
    cY += -0.035 * K * amb * (0.5 - 0.5 * Math.cos(2 * ph + 0.8));    // the forequarters "run"
    let roll = 0.026 * moveK * Math.sin(ph + 0.3) + hRoll;
    let neckBob = 0.04 * moveK * Math.sin(2 * ph + 0.6);
    // the limp: the hurt leg is spared and the head nods on the sound one
    if (E.limpLeg >= 0 && moveK > 0.1 && E.limpK > 0) {
      const F = G.feet[E.limpLeg], lame = !F.sw, lk = E.limpK * moveK;
      if (E.limpLeg < 2) { cY += (lame ? 0.06 : -0.02) * K * lk; neckBob += (lame ? 0.14 : -0.06) * lk; }
      else { pY += (lame ? 0.06 : -0.02) * K * lk; roll += (E.limpLeg === 2 ? -1 : 1) * 0.02 * lk; }
    }
    cY += O.cDY * ow; cR += O.cPitch * ow; pY += O.pDY * ow; pR += hPel;
    cY -= 0.12 * K * E.stagger; pY -= 0.08 * K * E.stagger;
    cY -= 0.04 * K * clamp((0.3 - hpF) / 0.3, 0, 1);
    // resting a hind foot tips the pelvis toward it
    const restK = E.idle === "rest" ? E.idleK : 0;
    if (restK > 0) { pY -= 0.03 * K * restK; roll += (E.restLeg === 2 ? -1 : 1) * 0.02 * restK; }
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(roll, 0, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(roll, 0, cR);

    // ---- legs onto the planted feet
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, F = G.feet[Lg];
      let fx = F.lx / s, fy = F.ly / s;
      const su = F.sw ? Math.sin(PI * F.u) : 0;
      let fa = front ? -HALF - 1.05 * su : -HALF - 0.55 * su;
      if (!F.sw) fa -= 0.22 * clamp((D.feet[Lg].x - fx) / (0.6 * K), 0, 1);   // the heel rolls off at push-off
      if (O.foot === Lg && ow > 0) { fx = O.fx; fy = O.fy; fa = O.fa; }
      if (restK > 0 && Lg === E.restLeg && !F.sw) { fy += 0.05 * K * restK; fa -= 0.45 * restK; fx -= 0.08 * K * restK; }
      const abz = F.lz / s - D.feet[Lg].z;
      legIK(R, D, Lg, fx, fy, fa, front ? cX : pX, front ? cY : pY, front ? cR : pR, roll, abz);
    }

    // ---- neck, head, trunk, ears, tail, jaw
    if (shake > 0 || E.shakeT > 0) E.neckX = Math.sin(E.t * 9) * 0.16 * Math.max(shake * 0.6, E.shakeT > 0 ? 1 : 0);
    else E.neckX = approach(E.neckX, 0, 6, dt);
    b[BN.neck].rotation.set(E.neckX, E.neckY, E.neckP + neckBob - cR * 0.6);
    b[BN.head].rotation.set(0, 0, 0.04 * Math.sin(E.t * 0.5));
    for (let i = 0; i < TRUNK_N; i++) b[BN.trunk[i]].rotation.set(0, E.ty[i], E.tz[i]);
    E.flapPh += dt * TAU * (mood === "calm" || mood === "calf" ? (E.idle === "flap" ? 0.9 : 0.25) : 0.12);
    const flapA = (mood === "calm" || mood === "calf") ? (E.idle === "flap" ? 0.5 : 0.22) : 0.06;
    const flap = flapA * (0.5 + 0.5 * Math.sin(E.flapPh)) * (1 - E.ear * 0.7);
    const eo = 0.05 + E.ear * 1.2 + flap;
    b[BN.earL].rotation.set(E.earTilt, -eo, 0);
    b[BN.earR].rotation.set(-E.earTilt, eo, 0);
    const swish = 0.28 * Math.sin(E.t * 1.6) * (1 - 0.5 * moveK);
    b[BN.tail0].rotation.set(0, swish, -1.1 * E.tail);
    b[BN.tail1].rotation.set(0, swish * 0.8, 0.25 * E.tail + 0.05 * Math.sin(E.t * 1.6 - 0.8));
    b[BN.tail2].rotation.set(0, swish * 0.6, 0.15 * E.tail);
    b[BN.jaw].rotation.set(0, 0, -E.jaw);
  }

  // ------------------------------------------------------------ dead
  let _V = null;
  function scratch() {
    if (_V) return _V;
    const T3 = W.THREE;
    _V = { a: new T3.Vector3(), b: new T3.Vector3(), c: new T3.Vector3(), q: new T3.Quaternion(), qi: new T3.Quaternion(), down: new T3.Vector3(0, -1, 0), d0: new T3.Vector3() };
    return _V;
  }
  function trunkTipWorld(E, out) {
    const R = E.rig, bone = R.bones[R.BN.trunk[TRUNK_N - 1]], S = scratch();
    S.a.set(0.05 * E.D.K, -E.D.trunkSeg * 0.9, 0).applyMatrix4(bone.matrixWorld);
    out.x = S.a.x; out.y = S.a.y; out.z = S.a.z;
    return out;
  }
  function markersMoved(R) {
    for (let i = 0; i < 4; i++) if (R.mk.foot[i].position.distanceToSquared(R.rest.foot[i]) > 1e-6) return true;
    return R.mk.head.position.distanceToSquared(R.rest.head) > 1e-6;
  }
  function deadPose(R) {
    const m = R.unit;
    const dead = m ? !!m.dead : (R.deadSeen || markersMoved(R));
    if (!dead) return;
    R.deadSeen = true;
    const S = scratch(), b = R.bones, bp = R.bindPos, BN = R.BN, D = R.D, T = R.T;
    b[BN.pelvis].position.copy(bp[BN.pelvis]); b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.copy(bp[BN.chest]); b[BN.chest].rotation.set(0, 0, 0);
    const solved = (m && m.ragdoll) || markersMoved(R);
    if (solved) {
      for (let Lg = 0; Lg < 4; Lg++) {
        const ids = T.LEGB[Lg], F = R.mk.foot[Lg].position, P = R.mk.knee[Lg].position, J = R.J[Lg];
        // the knee from the two markers: the knee box rides the foot->knee line at k2
        S.c.set(F.x + (P.x - F.x) / R.k2, F.y + (P.y - F.y) / R.k2, F.z + (P.z - F.z) / R.k2);
        S.a.copy(S.c).sub(J);
        if (S.a.lengthSq() < 1e-6) continue;
        S.a.normalize();
        S.q.setFromUnitVectors(S.down, S.a);
        b[ids[0]].quaternion.copy(S.q);
        S.b.set(F.x - S.c.x, F.y - S.c.y, F.z - S.c.z);
        if (S.b.lengthSq() > 1e-6) {
          S.b.normalize().applyQuaternion(S.qi.copy(S.q).invert());
          b[ids[1]].quaternion.setFromUnitVectors(S.down, S.b);
        }
        b[ids[2]].rotation.set(0, 0, Lg < 2 ? -0.5 : 0.3);
      }
      // the head lolls on the neck the way the solver's head point went
      S.d0.copy(R.rest.head).sub(R.pivot).normalize();
      S.a.copy(R.mk.head.position).sub(R.pivot);
      if (S.a.lengthSq() > 1e-6) { S.a.normalize(); b[BN.neck].quaternion.setFromUnitVectors(S.d0, S.a); }
      S.d0.copy(R.rest.tail).sub(R.hipPivot).normalize();
      S.a.copy(R.mk.tail.position).sub(R.hipPivot);
      if (S.a.lengthSq() > 1e-6) { S.a.normalize(); b[BN.tail0].quaternion.setFromUnitVectors(S.d0, S.a); }
    } else {
      // no solver (out of range / budget): the legs give way under it
      R.fold = Math.min(1, (R.fold || 0) + 0.025);
      const k = sstep(0, 1, R.fold);
      for (let Lg = 0; Lg < 4; Lg++) {
        const ids = T.LEGB[Lg], front = Lg < 2;
        b[ids[0]].rotation.set(0, 0, (front ? 0.7 : -0.8) * k);
        b[ids[1]].rotation.set(0, 0, (front ? -1.6 : 1.5) * k);
        b[ids[2]].rotation.set(0, 0, (front ? 0.6 : -0.4) * k);
      }
      b[BN.neck].rotation.set(0, 0, -0.35 * k);
    }
    for (let i = 0; i < TRUNK_N; i++) b[BN.trunk[i]].rotation.set(0, 0.12, i === 0 ? 0.6 : 0.25);
    b[BN.earL].rotation.set(0.15, -0.35, 0); b[BN.earR].rotation.set(-0.15, 0.35, 0);
    b[BN.jaw].rotation.set(0, 0, -0.12);
    b[0].updateMatrixWorld(true);
    if (R.mesh.skeleton) R.mesh.skeleton.update();
  }

  // ------------------------------------------------------------ animate
  function animate(m, dt) {
    const E = ensure(m);
    if (!E) return;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;
    E.t += dt;
    const h = m.heading || 0, gx = m.pos.x, gz = m.pos.z;
    if (E.px == null) { E.px = gx; E.pz = gz; E.ph = h; }
    const mdx = gx - E.px, mdz = gz - E.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - E.ph) / dt;
    if (mdx * mdx + mdz * mdz > 25) { v = 0; turn = 0; CBZ.quadGait.reset(E.G, gx, gz, h, CBZ.floorAt || null, m.pos.y); }
    E.px = gx; E.pz = gz; E.ph = h;
    E.v = approach(E.v, clamp(v, -4, 9), 8, dt);
    E.turn = approach(E.turn, clamp(turn, -3, 3), 8, dt);
    brain(m, E, dt);
    if (E.act && !E.fightTick) stepAct(m, E, dt, false, null);
    E.fightTick = false;
    trample(m, E, dt);
    pose(m, E, dt);
  }

  CBZ.unitKit.register(ID, { kind: "species", stats: STATS, build: build, animate: animate, fight: fight, moves: moves });
  // the one number the bestiary row lacked: what it weighs (systems/bodymass.js)
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[ID];
  if (row && !(row.mass > 0)) row.mass = VARIANTS.bull.mass;
  CBZ.elephantKit = { VARIANTS: VARIANTS, dims: dims, variantOf: variantOf, STATS: STATS };
})();
