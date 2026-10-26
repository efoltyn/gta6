/* ============================================================
   units/species/brown_bear.js — the brown bear (grizzly), and THE BEAR KIT
   (CBZ.bearKit) the black bear and the polar bear stand on.

   OWNED BY: the bear agent (brown_bear.js, black_bear.js, polar_bear.js).

   ONE BEAR, THREE SPECIES. Ursus arctos, U. americanus and U. maritimus are
   one body plan at three sizes with three temperaments, so this file holds
   the whole animal once and each species file is its numbers:
     body      a lofted, vertex-coloured, skinned shell on a 23-bone skeleton
               (CBZ.loftKit / CBZ.quadRig): rump, barrel, shoulder hump, a
               thick neck (two bones), a dished / straight / Roman head with
               its own jaw, canines, round ears, plantigrade paws with five
               claws each, a stub tail. One SkinnedMesh, one draw call, one
               shared geometry per (species, sex, age, coat), one material.
     gait      CBZ.quadGait with a BEAR footfall table: a lateral-couplet walk
               (the bear's rolling "pace-like" walk), an amble, a transverse
               gallop. Every foot plants. Plantigrade: the sole lands flat,
               the heel peels up late in stance, the front paw flips its sole
               back in swing, toes turned in. The scapula slides with the
               stride, the shoulder hump rolls, the head swings opposite.
     postures  rear up on the hind legs to look (and to fight another big
               animal), the threat display (head low, ears back, jaw popping,
               huffing, a forepaw slapping the ground), the bluff charge that
               stops short, flinches by where the hit landed, a limp on a hurt
               leg, the flee.
     fight     the real repertoire: the forepaw swat (a hooking blow with the
               claws), the bite, the charge-and-pin (both forepaws driven down
               off a half rear), the standing clasp-and-bite another big
               animal gets. Damage comes from force: swat = effective limb mass
               x paw speed (an impulse) + claw length, bite = bite force,
               scaled by this individual's mass.
     brain     stamina (a bear sprints for seconds, not minutes), fear and
               anger with memory, defensive vs predatory attacks (a defensive
               bear stops once the threat is down and walks off; a predatory
               one keeps going), the bluff, standing to look, cornered = fight,
               badly wounded grizzly = fight to the death, vehicles and much
               bigger animals are avoided. It steers the battle through the
               hooks the battle already reads: a per-bear `tn` whose `chase`,
               `march`, `brave` and `prey` are live answers (think.js and
               step.js are unchanged), `routed`/`fled` when it runs.
     death     the existing quadruped ragdoll (systems/quadruped_ragdoll.js)
               solves the corpse through stand-in leg/head points this file
               hands it (m.gait), and the skinned legs and head are bent onto
               the solved points every frame (mesh.onBeforeRender).

   REFERENCE (adult; male / female):
     grizzly   180-360 kg (300 / 180), shoulder ~1.05 m with the hump, head
               and body ~2.1 m, stands ~2.4 m; top speed ~56 km/h (we use
               48: 13.4 m/s), front claws 5-10 cm, bite ~5 kN; dished face,
               round short ears, big hump, dark legs, grizzled back.
     black     60-300 kg (120 / 75), shoulder ~0.8 m, no hump, rump higher
               than the shoulders, straight "Roman" profile, tall ears, tan
               muzzle, short curved dark claws; the most likely to run.
     polar     350-700 kg (450 / 230), shoulder ~1.3 m, long neck, small long
               head with a Roman nose, tiny ears, huge furred paws, black
               skin at the nose and lips; predatory, overheats when it runs.

   A species file calls CBZ.bearKit.unit(SPEC) lazily from its own hooks, so
   it registers its id even where this file has not loaded (node checks).
   `needs` in units/manifest.js loads the kit files (and, for the black and
   polar bears, this file) before the species file.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function toward(cur, want, step) { return cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  // cheap smooth 3-D noise in -1..1 (fur grizzle, coat shading)
  function fnoise(x, y, z, f) {
    return 0.5 * Math.sin(x * f * 1.7 + Math.sin(z * f * 1.3) * 1.9 + y * f * 0.6) * Math.sin(y * f * 2.3 + x * f * 0.7) +
      0.5 * Math.sin(z * f * 2.9 + y * f * 1.1 + Math.sin(x * f * 2.1) * 1.3);
  }

  /* ==========================================================================
     THE BEAR GAIT. Lateral-couplet walk (HL then FL close together, then HR,
     FR: the rolling walk), an amble with the lateral pairs nearly together,
     and a transverse gallop (hinds, then fores). Feet FL FR HL HR.
     Speeds are for K = 1 and scale by sqrt(K): a 1.05 m grizzly (K ~1.7)
     walks to 2.0 m/s, ambles to ~5.5, gallops above.
  ========================================================================== */
  const GAIT = {
    gaits: [
      { name: "walk", key: "wW", off: [0.17, 0.67, 0.00, 0.50], duty: 0.66, lift: 0.040 },
      { name: "amble", key: "wA", off: [0.07, 0.57, 0.00, 0.50], duty: 0.52, lift: 0.050 },
      { name: "gallop", key: "wG", off: [0.30, 0.42, -0.22, -0.10], duty: 0.30, lift: 0.075 },
    ],
    trans: [[1.45, 2.05], [3.9, 5.1]],
    fMax: 4.0, f0: 1.3, fV: 0.30, strideMax: 1.08,
    vMove: 0.12, turnMove: 0.4, turnF: 1.25,
    settleRate: 2.2, restLift: 0.03, restStep: 0.09,
  };

  /* ==========================================================================
     DIMS: one individual's body in metres, at bind (= standing) heights.
     spec.body is the adult male; females and sub-adults are scaled.
  ========================================================================== */
  const LIN = ["fa", "fb", "fc", "ha", "hb", "hc", "pawH", "sh", "hip", "shX", "hipX", "legZf", "legZh", "rumpBack", "rumpLift", "shLift", "hump"];
  function dims(spec, sex, age) {
    const B = spec.body;
    const D = { key: spec.id + "|" + sex + "|" + age };
    let k = 1, hk = 1, ek = 1;
    if (sex === "f") { k *= spec.femaleK; hk *= 0.95; }
    if (age === "y") { k *= 0.8; hk *= 1.08; ek = 1.18; }
    for (const n of LIN) D[n] = B[n] * k;
    if (sex === "f") D.hump *= 0.7;
    D.k = k; D.hk = hk;
    D.chest = B.chest.map(function (v) { return v * k * (sex === "f" ? 0.96 : 1); });
    D.waist = B.waist.map(function (v) { return v * k * (sex === "f" ? 0.96 : 1); });
    D.rump = B.rump.map(function (v) { return v * k; });
    D.neck = { len: B.neck.len * k, ang: B.neck.ang, r: B.neck.r * k * (sex === "f" ? 0.92 : 1), w: B.neck.w * k * (sex === "f" ? 0.92 : 1), rEnd: B.neck.rEnd * k * hk, wEnd: B.neck.wEnd * k * hk };
    const H = B.head, hs = k * hk;
    D.head = { ang: H.ang, L: H.L * hs, skull: H.skull * hs, skullB: H.skullB * hs, skullW: H.skullW * hs, brow: H.brow * hs, dish: H.dish,
      roman: H.roman * hs, stop: H.stop * hs, muzzleR: H.muzzleR * hs, muzzleW: H.muzzleW * hs, cheek: H.cheek };
    D.ear = { h: B.ear.h * hs * ek, w: B.ear.w * hs * ek, z: B.ear.z * hs, x: B.ear.x * hs, up: B.ear.up, tilt: B.ear.tilt || 0 };
    D.eye = { r: B.eye.r * hs, d: B.eye.d * hs, y: B.eye.y * hs, z: B.eye.z * hs };
    D.tail = { len: B.tail.len * k, r: B.tail.r * k };
    D.claws = { f: B.claws.f * k, h: B.claws.h * k };
    D.paw = { fw: B.paw.fw * k, hw: B.paw.hw * k };
    D.limb = {}; for (const n in B.limb) D.limb[n] = B.limb[n] * k;
    // bind points (model space, nose +X, up +Y, ground 0); bind = standing
    D.hipH = D.hip;
    D.FJ = { x: D.shX, y: D.sh }; D.HJ = { x: D.hipX, y: D.hip };
    D.neckB = { x: D.shX + 0.27 * D.chest[2], y: D.sh + D.shLift + 0.45 * D.chest[0] };
    D.headP = { x: D.neckB.x + Math.cos(D.neck.ang) * D.neck.len, y: D.neckB.y + Math.sin(D.neck.ang) * D.neck.len };
    D.u = { x: Math.cos(D.head.ang), y: Math.sin(D.head.ang) };
    const hp = D.headP, u = D.u;
    D.jawP = { x: hp.x + u.x * D.head.L * 0.16, y: hp.y + u.y * D.head.L * 0.16 - D.head.skullB * 0.55 };
    D.earP = { x: hp.x + u.x * D.ear.x, y: hp.y + u.y * D.ear.x + D.head.skull * D.ear.up, z: D.ear.z };
    D.tailP = { x: D.hipX - D.rumpBack * 0.92, y: D.hip + D.rumpLift + D.rump[0] * 0.35 };
    D.tailL = D.tail.len;
    D.humpP = { x: D.shX - 0.06 * k, y: D.sh + D.shLift + D.chest[0] };
    // the nose tip: the bite point
    D.nose = { x: hp.x + u.x * D.head.L, y: hp.y + u.y * D.head.L - D.head.skull * 0.25, z: 0 };
    D.legLen0 = Math.min(D.fa + D.fb, D.ha + D.hb);
    D.legLen = D.legLen0;
    D.withers = D.sh + D.shLift + D.chest[0] + D.hump;
    D.K = D.withers / 0.62;
    // neutral toe points (FL FR HL HR, L = -z): plantigrade, the toe ahead
    // of the wrist / heel, the wrist a touch behind the shoulder
    D.feet = [
      { x: D.shX - 0.05 * k + D.fc, z: -D.legZf, front: true },
      { x: D.shX - 0.05 * k + D.fc, z: D.legZf, front: true },
      { x: D.hipX - 0.10 * k + D.hc, z: -D.legZh, front: false },
      { x: D.hipX - 0.10 * k + D.hc, z: D.legZh, front: false },
    ];
    return D;
  }

  /* ==========================================================================
     THE SHELL
  ========================================================================== */
  function buildGeometry(spec, D, T, coat, seed) {
    const LK = CBZ.loftKit, G = LK.geo(), BN = T.BN, LEGB = T.LEGB;
    const col = spec.coat(D, coat, seed, { fnoise: fnoise, mixHex: mixHex, mkRng: mkRng, clamp: clamp });
    const C = function (part) { return function (x, y, z, ca, sa, R) { return col(part, x, y, z, ca, sa, R); }; };
    const P = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, HD = BN.head, JW = BN.jaw, HU = BN.hump;
    const k = D.k;
    const lineY = function (x) { return lerp(D.hip, D.sh, (x - D.hipX) / (D.shX - D.hipX)); };
    const ch = D.chest, wa = D.waist, ru = D.rump, hm = D.hump;
    function ring(x, yo, s, f, wts, hk, extra) {
      const r = { x: x, y: lineY(x) + yo, rt: s[0] * f[0] + (extra || 0), rb: s[1] * f[1], w: s[2] * f[2], wts: wts, sq: 0.92 };
      if (hk) { r.hk = hk; r.hkBone = HU; }
      return r;
    }
    const L = D.shX - D.hipX, rl = D.rumpLift, sl = D.shLift;
    // TORSO: rump -> haunch -> barrel -> ribs -> hump -> brisket
    const torso = [
      ring(D.hipX - D.rumpBack, rl + 0.03 * k, ru, [0.55, 0.5, 0.58], [P, 1]),
      ring(D.hipX - D.rumpBack * 0.75, rl + 0.02 * k, ru, [0.82, 0.78, 0.85], [P, 1]),
      ring(D.hipX - D.rumpBack * 0.4, rl + 0.01 * k, ru, [0.95, 0.94, 0.97], [P, 1]),
      ring(D.hipX + 0.05 * k, rl * 0.8, ru, [1, 1.02, 1.0], [P, 0.92, CH, 0.08]),
      ring(D.hipX + L * 0.36, lerp(rl, sl, 0.36), wa, [1, 1, 1], [P, 0.62, CH, 0.38]),
      ring(D.hipX + L * 0.62, lerp(rl, sl, 0.62), [lerp(wa[0], ch[0], 0.6), lerp(wa[1], ch[1], 0.6), lerp(wa[2], ch[2], 0.6)], [1, 1, 1], [P, 0.25, CH, 0.75], 0.35, hm * 0.4),
      ring(D.shX - 0.11 * k, sl, ch, [1, 1, 1], [CH, 1], 1, hm),
      ring(D.shX + 0.02 * k, sl + 0.01 * k, ch, [0.97, 0.98, 0.99], [CH, 1], 0.8, hm * 0.72),
      ring(D.shX + 0.13 * k, sl + 0.04 * k, ch, [0.84, 0.86, 0.88], [CH, 1], 0.35, hm * 0.2),
      ring(D.shX + 0.22 * k, sl + 0.08 * k, ch, [0.64, 0.66, 0.70], [CH, 0.65, N0, 0.35]),
    ];
    const v0 = G.n;
    LK.loft(G, torso, 26, C("torso"), { capLen: 0.9 });
    // THE COAT'S EDGE: a bear is not a smooth tube. Guard hairs break the
    // silhouette (a few cm of shag), and the belly hangs a ragged fringe.
    for (let i = v0; i < G.n; i++) {
      const px = G.p[i * 3], py = G.p[i * 3 + 1], pz = G.p[i * 3 + 2];
      const cy = lineY(clamp(px, D.hipX, D.shX)) + lerp(rl, sl, clamp((px - D.hipX) / L, 0, 1));
      const dy = py - cy, rr = Math.hypot(dy, pz) || 1;
      const up = dy / rr;
      const shag = (fnoise(px * 3.1, py * 2.3, pz * 3.7, 9 / k) * 0.6 + fnoise(px, py, pz, 31 / k) * 0.4) * (spec.shag || 0.012) * k;
      const fringe = up < -0.55 ? (0.5 + 0.5 * Math.sin(px * 47 / k + pz * 13 / k)) * (spec.fringe || 0.03) * k * (-up - 0.55) / 0.45 : 0;
      G.p[i * 3 + 1] += (dy / rr) * shag - fringe;
      G.p[i * 3 + 2] += (pz / rr) * shag;
    }

    // NECK: thick, short (grizzly) to long (polar), two bones
    const nb = D.neckB, hp = D.headP, nk = D.neck;
    const npt = function (t) { return { x: lerp(nb.x, hp.x, t), y: lerp(nb.y, hp.y, t) }; };
    const n0 = npt(-0.25), n1 = npt(0.15), n2 = npt(0.5), n3 = npt(0.82), n4 = npt(1.0);
    const neck = [
      { x: n0.x, y: n0.y, rt: nk.r * 1.12, rb: nk.r * 1.12, w: nk.w * 1.08, wts: [CH, 1], sq: 0.95 },
      { x: n1.x, y: n1.y, rt: nk.r, rb: nk.r * 1.02, w: nk.w, wts: [CH, 0.45, N0, 0.55], sq: 0.95 },
      { x: n2.x, y: n2.y, rt: lerp(nk.r, nk.rEnd, 0.5), rb: lerp(nk.r, nk.rEnd, 0.45), w: lerp(nk.w, nk.wEnd, 0.5), wts: [N0, 0.5, N1, 0.5] },
      { x: n3.x, y: n3.y, rt: nk.rEnd * 1.04, rb: nk.rEnd * 1.06, w: nk.wEnd * 1.05, wts: [N1, 1] },
      { x: n4.x, y: n4.y, rt: nk.rEnd, rb: nk.rEnd, w: nk.wEnd, wts: [N1, 0.4, HD, 0.6] },
    ];
    LK.loft(G, neck, 18, C("neck"), { capLen: 0.5 });

    // HEAD along its own axis u from the occiput (headP)
    const Hd = D.head, u = D.u;
    const hpt = function (d, dy) { return { x: hp.x + u.x * d, y: hp.y + u.y * d + (dy || 0) }; };
    const mDy = -(Hd.skull - Hd.muzzleR) * 0.62;            // the muzzle hangs below the skull's axis
    const dish = Hd.dish, rom = Hd.roman;
    const s0 = hpt(-0.04 * k), s1 = hpt(Hd.stop * 0.3), s2 = hpt(Hd.stop * 0.68, Hd.brow * 0.4), s3 = hpt(Hd.stop, mDy * 0.55 - dish * 0.012 * k);
    const mL = Hd.L - Hd.stop;
    const m1 = hpt(Hd.stop + mL * 0.35, mDy + rom * 0.012), m2 = hpt(Hd.stop + mL * 0.68, mDy + rom * 0.004), m3 = hpt(Hd.stop + mL * 0.92, mDy - 0.004 * k), m4 = hpt(Hd.L, mDy - 0.008 * k);
    const head = [
      { x: s0.x, y: s0.y, rt: Hd.skull * 0.78, rb: Hd.skullB * 0.82, w: Hd.skullW * 0.80, wts: [N1, 0.3, HD, 0.7] },
      { x: s1.x, y: s1.y, rt: Hd.skull, rb: Hd.skullB, w: Hd.skullW * Hd.cheek, wts: [HD, 1], sq: 0.9 },
      { x: s2.x, y: s2.y, rt: Hd.skull * 0.94 + Hd.brow * 0.6, rb: Hd.skullB * 0.86, w: Hd.skullW * 0.93 * Hd.cheek, wts: [HD, 1], sq: 0.9, brow: 1 },
      { x: s3.x, y: s3.y, rt: lerp(Hd.skull, Hd.muzzleR, 0.62 + dish * 0.12) + rom * 0.004, rb: lerp(Hd.skullB, Hd.muzzleR, 0.5), w: lerp(Hd.skullW, Hd.muzzleW, 0.6), wts: [HD, 1], muz: 1 },
      { x: m1.x, y: m1.y, rt: Hd.muzzleR * (1.0 + rom * 0.15), rb: Hd.muzzleR * 0.86, w: Hd.muzzleW, wts: [HD, 1], muz: 2, sq: 0.88 },
      { x: m2.x, y: m2.y, rt: Hd.muzzleR * 0.86, rb: Hd.muzzleR * 0.72, w: Hd.muzzleW * 0.9, wts: [HD, 1], muz: 3, sq: 0.88 },
      { x: m3.x, y: m3.y, rt: Hd.muzzleR * 0.7, rb: Hd.muzzleR * 0.6, w: Hd.muzzleW * 0.8, wts: [HD, 1], muz: 4, tag: "nose" },
      { x: m4.x, y: m4.y, rt: Hd.muzzleR * 0.46, rb: Hd.muzzleR * 0.42, w: Hd.muzzleW * 0.6, wts: [HD, 1], muz: 4, tag: "nose" },
    ];
    LK.loft(G, head, 18, C("head"), { capLen: 0.45 });
    // the cheek ruff: the fur that makes a bear's face wide
    for (let s = -1; s <= 1; s += 2) {
      const c = hpt(Hd.stop * 0.32, -Hd.skullB * 0.25);
      LK.ellipsoid(G, c.x, c.y, s * Hd.skullW * 0.62 * Hd.cheek, Hd.skull * 0.55, Hd.skullB * 0.62, Hd.skullW * 0.42, 10, C("cheek"), [HD, 1]);
    }
    // LOWER JAW off its own hinge, the lips black, the tongue inside
    const J = D.jawP, jEnd = hpt(Hd.L * 0.93, mDy - Hd.muzzleR * 0.62);
    const jaw = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      jaw.push({ x: lerp(J.x, jEnd.x, t), y: lerp(J.y, jEnd.y, t),
        rt: lerp(Hd.skullB * 0.42, Hd.muzzleR * 0.4, t), rb: lerp(Hd.skullB * 0.55, Hd.muzzleR * 0.52, t),
        w: lerp(Hd.skullW * 0.82, Hd.muzzleW * 0.8, t), wts: [JW, 1], jaw: 1 });
    }
    LK.loft(G, jaw, 14, C("jaw"), { capLen: 0.7 });
    // canines: upper on the head, lower on the jaw (seen when it opens)
    for (let s = -1; s <= 1; s += 2) {
      const cu = hpt(Hd.L * 0.84, mDy - Hd.muzzleR * 0.62);
      LK.ellipsoid(G, cu.x, cu.y - 0.016 * k * D.hk, s * Hd.muzzleW * 0.42, 0.011 * k, 0.026 * k * D.hk, 0.011 * k, 6, C("tooth"), [HD, 1]);
      const cl = { x: lerp(J.x, jEnd.x, 0.82), y: lerp(J.y, jEnd.y, 0.82) + Hd.muzzleR * 0.32 };
      LK.ellipsoid(G, cl.x, cl.y + 0.014 * k, s * Hd.muzzleW * 0.36, 0.010 * k, 0.022 * k * D.hk, 0.010 * k, 6, C("tooth"), [JW, 1]);
    }
    // eyes: small, set forward in the brow
    for (let s = -1; s <= 1; s += 2) {
      const e = hpt(D.eye.d, D.eye.y);
      LK.ellipsoid(G, e.x, e.y, s * D.eye.z, D.eye.r * 0.9, D.eye.r * 0.85, D.eye.r * 0.75, 8, C("eye"), [HD, 1]);
    }
    // EARS: rounded, cupped forward
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, z0 = s * E.z, eh = D.ear.h, ew = D.ear.w;
      const st = [];
      const prof = [0.82, 1.0, 0.86, 0.45];
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        st.push({ x: E.x - eh * 0.12 * t, y: E.y + eh * t * 0.95, z: z0 + s * eh * (0.18 + D.ear.tilt) * t,
          rt: 0.016 * k * (1 - t * 0.4), rb: 0.012 * k * (1 - t * 0.4), w: ew * 0.5 * prof[i], wts: [eb, 1], ear: 1 });
      }
      LK.loft(G, st, 10, C("ear"), { capLen: 0.8, side: [s * 0.25, 0, 1] });
    }

    // TAIL: a short stub under the rump fur
    const TP = D.tailP, tst = [];
    const tprof = [1.0, 0.95, 0.75, 0.4];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      tst.push({ x: TP.x - D.tail.len * t, y: TP.y - D.tail.len * 0.4 * t, rt: D.tail.r * tprof[i], rb: D.tail.r * tprof[i], w: D.tail.r * tprof[i] * 0.9, wts: i ? [BN.tail0, 1] : [P, 0.5, BN.tail0, 0.5] });
    }
    LK.loft(G, tst, 10, C("tail"), { capLen: 0.9 });

    // LEGS straight down in the bind; the feet lie flat, toes forward
    const pts = T.bindPoints(D), lb = D.limb;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], sd = z < 0 ? -1 : 1;
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const x = P0[0], y0 = P0[1], par = front ? CH : P;
      const zi = z - sd * 0.01 * k;
      // ONE continuous limb from inside the body to the wrist, the weights
      // blending across the elbow / stifle so the joint bends as flesh
      const U = ids[0], Lw = ids[1], Fw = ids[2];
      const r0 = front ? lb.arm : lb.thigh, r1 = front ? lb.fore : lb.shin, r2 = front ? lb.wrist : lb.ankle;
      const fb2 = front ? 1 : -1;      // the forearm's mass sits behind, the thigh's in front
      LK.loft(G, [
        { x: x + 0.02 * k * fb2, y: y0 + 0.2 * k, z: zi * 0.55, rt: r0 * 0.9, rb: r0, w: r0 * 0.6, wts: [par, 0.85, U, 0.15] },
        { x: x + 0.01 * k * fb2, y: y0 + 0.03 * k, z: zi * 0.9, rt: r0 * 1.04, rb: r0 * 1.06, w: r0 * 0.74, wts: [par, 0.4, U, 0.6] },
        { x: x, y: y0 - a * 0.4, z: zi, rt: r0 * 0.95, rb: r0 * 0.95, w: r0 * 0.7, wts: [U, 1] },
        { x: x, y: y0 - a * 0.8, z: zi, rt: lerp(r0, r1, 0.6) * 1.05, rb: lerp(r0, r1, 0.6) * 1.05, w: lerp(r0, r1, 0.6) * 0.78, wts: [U, 0.85, Lw, 0.15] },
        { x: x, y: y0 - a, z: zi, rt: r1 * 1.12, rb: r1 * 1.14, w: r1 * 0.86, wts: [U, 0.5, Lw, 0.5] },
        { x: x, y: y0 - a - b * 0.2, z: zi, rt: r1 * 1.08, rb: r1 * 1.1, w: r1 * 0.84, wts: [U, 0.12, Lw, 0.88] },
        { x: x, y: y0 - a - b * 0.6, z: zi, rt: r1 * 0.92, rb: r1 * 0.95, w: r1 * 0.78, wts: [Lw, 1] },
        { x: x, y: y0 - a - b * 0.92, z: zi, rt: r2 * 1.05, rb: r2 * 1.08, w: r2 * 0.95, wts: [Lw, 0.75, Fw, 0.25] },
        { x: x, y: y0 - a - b, z: zi, rt: r2, rb: r2 * 1.04, w: r2 * 0.95, wts: [Lw, 0.4, Fw, 0.6] },
      ], 14, C(front ? "arm" : "thigh"), { capLen: 0.6, capA: false });
      // THE PAW: plantigrade, flat, from the heel / wrist pad to the toes
      const wy = y0 - a - b, pw = front ? D.paw.fw : D.paw.hw, ph = D.pawH;
      const heel = front ? 0.03 * k : 0.05 * k;
      LK.loft(G, [
        { x: x - heel, y: wy, z: zi, rt: ph * 0.85, rb: ph * 0.95, w: pw * 0.72, wts: [ids[2], 1], sq: 0.8 },
        { x: x + c * 0.3, y: wy - ph * 0.05, z: zi, rt: ph * 0.85, rb: ph * 0.95, w: pw * 0.95, wts: [ids[2], 1], sq: 0.75 },
        { x: x + c * 0.7, y: wy - ph * 0.12, z: zi, rt: ph * 0.7, rb: ph * 0.85, w: pw, wts: [ids[2], 1], sq: 0.75, toe: 1 },
        { x: x + c * 0.95, y: wy - ph * 0.22, z: zi, rt: ph * 0.45, rb: ph * 0.65, w: pw * 0.86, wts: [ids[2], 1], sq: 0.8, toe: 1 },
      ], 12, C("paw"), { capLen: 0.55 });
      // five claws across the toes, curving down
      const cl = front ? D.claws.f : D.claws.h;
      for (let ci = 0; ci < 5; ci++) {
        const zo = zi + (ci - 2) * pw * 0.36 + sd * (ci === 0 || ci === 4 ? -0.004 : 0) * k;
        const cx = x + c * 0.9 - Math.abs(ci - 2) * 0.012 * k, cy = wy - ph * 0.3;
        LK.loft(G, [
          { x: cx, y: cy, z: zo, rt: 0.011 * k, rb: 0.009 * k, w: 0.008 * k, wts: [ids[2], 1] },
          { x: cx + cl * 0.55, y: cy - cl * 0.12, z: zo, rt: 0.008 * k, rb: 0.006 * k, w: 0.006 * k, wts: [ids[2], 1] },
          { x: cx + cl, y: cy - cl * 0.42, z: zo, rt: 0.003 * k, rb: 0.003 * k, w: 0.003 * k, wts: [ids[2], 1] },
        ], 5, C("claw"), { capLen: 0.6, capA: false });
      }
    }
    const geo = LK.toGeometry(G, { boundingSphere: [0, D.withers * 0.55, 0, D.withers * 2.0] });
    geo.computeBoundingBox();
    return geo;
  }

  /* ==========================================================================
     BUILD: shared geometry per variant, a skeleton per bear, the ragdoll's
     stand-in points, the death drive.
  ========================================================================== */
  const _geo = new Map(), _tables = new Map();
  function tableFor() {
    let t = _tables.get("bear");
    if (!t) { t = CBZ.quadRig.bones({ neck: 2, tail: 1, tailStops: [0], ears: true, hackle: false, hump: true }); _tables.set("bear", t); }
    return t;
  }
  function individual(spec, seed) {
    const r = mkRng(((seed | 0) * 2654435761) ^ 0xbea5);
    /* THE FIRST BEAR ON A SIDE IS AN ADULT MALE (battle/beasts.js seeds a
       side's spawns i + 0 / i + 7919), as the tiger and lion files do. A
       "1 brown bear" matchup otherwise fielded a 188 kg sow against a male
       cat: measured, 17% v a lion and 19% v a tiger. After that, the mix. */
    const first = seed === 0 || seed === 7919;
    const rs = r(), ra = r();
    const sex = first || rs < 0.5 ? "m" : "f";
    const age = !first && ra < 0.16 ? "y" : "a";
    const coat = spec.coats[Math.floor(r() * spec.coats.length) % spec.coats.length];
    let mass = (sex === "m" ? spec.mass.m : spec.mass.f) * (age === "y" ? 0.5 : 1) * (0.86 + r() * 0.28);
    return { sex: sex, age: age, coat: coat, mass: mass, r: r };
  }
  function build(spec, ctx) {
    const THREE = W.THREE, LK = CBZ.loftKit, QR = CBZ.quadRig, QG = CBZ.quadGait;
    if (!THREE || !LK || !QR || !QG) {
      const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[spec.id];   // the bestiary body if the kit is missing
      return row && row.build ? row.build(ctx) : null;
    }
    // seed 0 is a real seed (red's first spawn), not "no seed"
    const seed = (ctx && ctx.seed != null) ? Math.abs(ctx.seed | 0) : Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const ind = individual(spec, seed);
    const T = tableFor();
    const D = dims(spec, ind.sex, ind.age);
    const gkey = D.key + "|" + ind.coat;
    let geo = _geo.get(gkey);
    if (!geo) { geo = buildGeometry(spec, D, T, ind.coat, 7); _geo.set(gkey, geo); }
    const rig = QR.makeSkeleton(T, D, "bear");
    const mesh = QR.skinnedMesh(geo, LK.sharedSkinMaterial("bear-coat"), rig);
    mesh.name = spec.id + "-body";
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    // the ragdoll's stand-ins: a foot and a knee point per leg, a head point
    const prox = { feet: [], knees: [], head: null };
    const cols = [];
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, z = (Lg % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
      const jx = front ? D.shX : D.hipX, jy = front ? D.sh : D.hip;
      const f = new THREE.Object3D(), kn = new THREE.Object3D();
      f.position.set(jx, D.pawH, z); kn.position.set(jx, (jy + D.pawH) * 0.5, z);
      group.add(f); group.add(kn);
      prox.feet.push(f); prox.knees.push(kn);
      cols.push({ x: jx, z: z, top: jy, h: jy, parts: [{ m: f, bx: jx, by: D.pawH }, { m: kn, bx: jx, by: (jy + D.pawH) * 0.5 }] });
    }
    const hd = new THREE.Object3D();
    hd.position.set(D.headP.x, D.headP.y, 0);
    group.add(hd); prox.head = hd;
    const R = {
      spec: spec, group: group, mesh: mesh, bones: rig.bones, bindPos: rig.bindPos, T: T, D: D, ind: ind,
      G: QG.create(D, GAIT), prox: prox,
      gaitStub: { cols: cols, head: [{ m: hd, bx: D.headP.x, by: D.headP.y }], bear: true },
      frame: -1, dead: { k: 0, t: 0 },
    };
    group.userData.bearRig = R;
    mesh.userData.bearRig = R;
    mesh.onBeforeRender = deadDrive;
    return group;
  }

  /* ==========================================================================
     LEG IK: toe point (tx, ty, tz) in model space, foot angle fa (absolute,
     wrist -> toe; 0 = flat forward), scapula slide (sx, sy) in chest frame.
  ========================================================================== */
  const _ik = [0, 0];
  function poseLeg(R, Lg, body, tx, ty, tz, fa, sx, sy, toeIn, extraRoll) {
    const D = R.D, b = R.bones, bp = R.bindPos, ids = R.T.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const bx = front ? body.cX : body.pX, by = front ? body.cY : body.pY, br = front ? body.cR : body.pR;
    const off = bp[ids[0]];
    const ox = off.x + sx, oy = off.y + sy;
    b[ids[0]].position.set(ox, oy, off.z);
    const cb = Math.cos(br), sb = Math.sin(br);
    const jx = bx + cb * ox - sb * oy, jy = by + sb * ox + cb * oy;
    const wx = tx - cl * Math.cos(fa), wy = ty - cl * Math.sin(fa);
    const dyv = wy - jy, dz = tz - off.z;
    const phi = Math.atan2(dz, -dyv);
    const sag = Math.hypot(dyv, dz);
    QR_ik2(jx, jy, wx, jy - sag, a, bl, front ? -1 : 1, _ik);
    const t1 = _ik[0], t2 = _ik[1];
    b[ids[0]].rotation.set(-phi + (extraRoll || 0), 0, t1 + HALF - br);
    b[ids[1]].rotation.set(0, 0, t2 - t1);
    b[ids[2]].rotation.set(0, toeIn || 0, fa - t2 - HALF);
  }
  let QR_ik2 = function () {};

  /* ==========================================================================
     THE BEAR'S STATE AND BRAIN
  ========================================================================== */
  function massOf(o) {
    if (!o) return 78;
    if (o._bear) return o._bear.mass;
    if (o.vehicle) return (o.stats && o.stats.mass) || 20000;
    if (CBZ.bodyMass) { try { const m = CBZ.bodyMass(o); if (m > 0) return m; } catch (e) {} }
    return 78;
  }
  function ensure(m) {
    let B = m._bear;
    if (B) return B;
    const R = m.group && m.group.userData.bearRig;
    if (!R) return null;
    const S = R.spec, bh = S.behave;
    B = m._bear = {
      R: R, S: S, bh: bh, t: 0, px: null, pz: null, ph: 0, v: 0, turn: 0,
      vNow: 0, want: bh.walk, stam: 1, fear: 0, anger: 0, st: "calm", stT: 0,
      flee: false, fleeT: 0, threat: null, lastTgt: null, pred: !!bh.predatory, bluffDone: false,
      bluffStop: 6, lastHp: m.hp, hits: 0, inj: [0, 0, 0, 0],
      fl: { t: 0, part: 0, side: 1 }, act: null, cool: 0.5, flurry: 0, flurryN: 2,
      rear: 0, disp: 0, look: 0, aggr: 0, fearK: 0, pant: 0, lookY: 0, lookP: 0, hump: 0,
      rng: mkRng((m.i | 0) * 7919 + (m.team === "red" ? 3 : 11)), jaw: { x: 0, y: 0, z: 0 },
      sizeMul: m._sizeMul || 1,
    };
    B.mass = R.ind.mass * Math.pow(B.sizeMul, 3);
    m._mass = B.mass;
    // this individual's hit points: the row is an adult male; a female or a
    // sub-adult is less animal (mass^0.75), the size draw rides on top
    if (m.maxHp > 0 && m.maxHp < 1e6 && m.hp === m.maxHp) {
      const hp = Math.round(S.stats.hp * Math.pow(R.ind.mass / S.mass.m, 0.75) * Math.pow(B.sizeMul, 1.35));
      m.hp = m.maxHp = Math.max(20, hp);
      B.lastHp = m.hp;
    }
    // the live tuning the battle reads (think.js, step.js): one per bear
    const base = m.tn || {};
    const tn = Object.create(base);
    // a player-driven bear (src/battle/player.js) runs on its legs and lungs,
    // not on the brain's choice
    Object.defineProperty(tn, "chase", { get: function () { return m.you ? youTop(B) : B.vNow; }, configurable: true });
    Object.defineProperty(tn, "march", { get: function () { return m.you ? B.bh.walk * 1.4 : B.vNow; }, configurable: true });
    Object.defineProperty(tn, "brave", { get: function () { return !B.flee; }, configurable: true });
    Object.defineProperty(tn, "prey", { get: function () { return B.flee || B.st === "retreat" || B.st === "avoid"; }, configurable: true });
    m.tn = tn;
    // the corpse solver's stand-ins
    m.gait = R.gaitStub;
    R.mesh.userData.bearUnit = m;
    m._jawL = B.jaw;
    B.jaw.x = R.D.nose.x; B.jaw.y = R.D.nose.y;
    // the team collar: the battle's box becomes a band round the neck
    const THREE = W.THREE;
    if (THREE) {
      const kids = m.group.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.isMesh && c !== R.mesh && c.userData.teamCollar) {
          c.visible = false;
          const D = R.D;
          const key = "collar|" + D.key;
          let g = _geo.get(key);
          if (!g) { g = new THREE.TorusGeometry(D.neck.r * 1.0, 0.018 * D.k, 6, 20); g._shared = true; _geo.set(key, g); }
          const band = new THREE.Mesh(g, c.material);
          band.userData.bearCollar = true;
          const dir = new THREE.Vector3(Math.cos(D.neck.ang), Math.sin(D.neck.ang), 0);
          band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          band.scale.set(1.0, D.neck.w / D.neck.r, 1);
          band.position.copy(dir).multiplyScalar(D.neck.len * 0.12);
          R.bones[R.T.BN.neck].add(band);
          break;
        }
      }
    }
    return B;
  }
  function youTop(B) {
    const bh = B.bh, inj = Math.max(B.inj[0], B.inj[1], B.inj[2], B.inj[3]);
    const top = bh.top * Math.pow(B.sizeMul, 0.3) * (1 - 0.45 * inj);
    return B.stam < 0.25 ? Math.min(top, bh.amble * (0.7 + B.stam * 2)) : top;
  }
  function distTo(m, o) { return o && o.pos ? Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) : 1e9; }
  function setState(B, st) { if (B.st !== st) { B.st = st; B.stT = 0; } }

  function newThreat(m, B, tgt, d) {
    const bh = B.bh, ratio = massOf(tgt) / B.mass;
    B.bluffDone = false;
    if (tgt.vehicle) { B.fear += bh.vehicleFear; setState(B, "avoid"); return; }
    if (ratio > 2.2) B.fear += bh.bigFear * Math.min(2, ratio - 1.8);
    if (tgt.armed) B.fear += bh.gunFear;
    // predatory: the polar bear on anything, any bear on clearly smaller prey
    B.pred = !!bh.predatory || (!!tgt.beast && ratio < 0.45);
    // first sight from a distance, calm and unhurt: stand up and look
    if (d > 22 && d < 120 && B.st === "calm" && B.hits === 0 && B.rng() < bh.lookP) { setState(B, "look"); B.lookT = 1.4 + B.rng() * 1.4; }
    else if (B.st === "calm") setState(B, "approach");
  }
  const LOC_NAMES = ["head", "fore", "body", "hind"];
  function onHurt(m, B, dmg) {
    const bh = B.bh, frac = dmg / Math.max(1, m.maxHp);
    B.hits++; B.hurtAt = B.t;
    B.fear += frac * bh.hitFear * (1 + Math.min(1, B.hits * 0.08));
    B.anger += frac * bh.hitAnger;
    // WHERE IT LANDED: weighted by what a shooter sees of a bear (the flank
    // and the shoulder are most of it), on the side facing the threat
    const r = B.rng();
    const part = r < 0.12 ? 0 : r < 0.42 ? 1 : r < 0.75 ? 2 : 3;
    let side = B.rng() < 0.5 ? -1 : 1;
    const th = m.tgt || B.threat;
    if (th && th.pos) {
      const h = m.heading || 0, dx = th.pos.x - m.pos.x, dz = th.pos.z - m.pos.z;
      side = (-Math.sin(h) * dx + Math.cos(h) * dz) >= 0 ? 1 : -1;     // model +z side
    }
    B.fl.t = 0.55; B.fl.part = part; B.fl.side = side; B.fl.k = clamp(frac * 6, 0.35, 1);
    if (part === 1 || part === 3) {
      const leg = (part === 1 ? 0 : 2) + (side < 0 ? 0 : 1);
      B.inj[leg] = Math.min(1, B.inj[leg] + frac * 3.2);
    }
    B.lastHit = LOC_NAMES[part];
    // a hit wakes a bear up: a hurt grizzly comes for whatever hurt it
    if ((B.st === "look" || B.st === "approach" || B.st === "display" || B.st === "bluff" || B.st === "calm") && B.anger > 0.12 && B.fear < bh.nerve) setState(B, "charge");
  }

  function brain(m, B, dt) {
    const bh = B.bh;
    B.t += dt; B.stT += dt;
    const tgt = m.tgt && !m.tgt.dead && !m.tgt.fled ? m.tgt : null;
    if (tgt) B.threat = tgt;
    if (B.threat && (B.threat.dead || B.threat.fled)) B.threat = null;
    const d = tgt ? distTo(m, tgt) : 1e9;
    const dT = B.threat ? distTo(m, B.threat) : 1e9;
    if (m.hp < B.lastHp) {
      /* THE HIDE: fur, 5-10 cm of fat and a thick skin stop a fixed amount of
         every blow (a damage threshold, as armour works): a man's fist barely
         reaches a grizzly, a rifle round hardly notices. Only through the hp
         seam the battle offers (hurtMan has no per-unit soak yet). */
      const raw = B.lastHp - m.hp, soak = Math.min(raw * 0.8, bh.hide || 0);
      m.hp += soak;
      onHurt(m, B, raw - soak);
    }
    B.lastHp = m.hp;
    if (tgt && tgt !== B.lastTgt) newThreat(m, B, tgt, d);
    B.lastTgt = tgt;
    B.fear = Math.max(0, B.fear - dt * bh.fearDecay);
    B.anger = Math.max(0, B.anger - dt * 0.03);
    for (let i = 0; i < 4; i++) B.inj[i] = Math.max(0, B.inj[i] - dt * 0.004);
    const hf = clamp(m.hp / Math.max(1, m.maxHp), 0, 1);
    if (m.you) {
      // the player is the nerve; the body still tires and hurts
      B.flee = false; m.routed = false;
      if (B.st !== "charge") setState(B, "charge");
      const sp = Math.abs(B.v);
      if (sp > bh.amble * 1.15) B.stam = Math.max(0, B.stam - dt / bh.sprintS * (sp / bh.top));
      else B.stam = Math.min(1, B.stam + dt / bh.recoverS);
      B.vNow = sp;
      return;
    }

    // ---- NERVE: run, or stand and fight
    const nerve = bh.nerve * (bh.woundBrave ? 1 : (0.55 + 0.45 * hf));
    let flee = B.fear > nerve + B.anger * bh.angerHold;
    // fight to the death: a badly hurt grizzly (or polar bear) with the
    // thing on top of it; any bear, CORNERED, with no legs left to run on
    if (flee && hf < bh.toDeathHp && dT < 9) flee = false;
    if (flee && B.flee && B.fleeT > 2.5 && dT < 3.6 && B.stam < 0.35) { flee = false; B.anger += 0.4; B.fear *= 0.8; }
    if (flee !== B.flee) {
      B.flee = flee;
      if (flee) { setState(B, "flee"); B.fleeT = 0; } else if (B.st === "flee") { setState(B, dT < 8 ? "charge" : "approach"); B.bluffDone = true; }
    }
    m.routed = B.flee;
    if (B.flee) {
      B.fleeT += dt;
      // far away, long gone: it leaves the field (the battle's own "fled")
      if (B.fleeT > 20 && dT > 70) m.fled = true;
    }

    // ---- WHAT IT IS DOING
    switch (B.st) {
      case "calm": if (tgt) setState(B, "approach"); break;
      case "look":
        if (B.stT > (B.lookT || 2)) setState(B, "approach");
        break;
      case "approach":
        if (!tgt) { setState(B, "calm"); break; }
        if (d < bh.chargeDist) {
          // the bluff: run at it, stop short, show it, maybe leave
          if (!B.bluffDone && !tgt.vehicle && B.hits === 0 && B.rng() < bh.bluffP * (B.pred ? 0.2 : 1)) {
            setState(B, "bluff"); B.bluffStop = 3.5 + B.rng() * 4.5;
          } else setState(B, "charge");
          B.bluffDone = true;
        }
        break;
      case "bluff":
        if (!tgt) { setState(B, "calm"); break; }
        if (d < B.bluffStop + B.vNow * 0.12) { setState(B, "display"); B.dispT = 1.6 + B.rng() * 1.8; }
        break;
      case "display":
        if (!tgt) { setState(B, "calm"); break; }
        if (d < 2.6 || B.anger > 0.25) setState(B, "charge");
        else if (B.stT > B.dispT) {
          if (B.rng() < bh.bluffRetreat) { setState(B, "retreat"); B.retT = 2.5 + B.rng() * 2.5; }
          else setState(B, "charge");
        }
        break;
      case "retreat": case "disengage":
        if (B.stT > (B.retT || 3)) setState(B, tgt ? (B.st === "retreat" ? "approach" : "charge") : "calm");
        if (B.st === "retreat" && d < 3) setState(B, "charge");
        break;
      case "avoid":
        if (!tgt || !tgt.vehicle) setState(B, tgt ? "approach" : "calm");
        else if (dT > 60) setState(B, "calm");
        break;
      case "charge":
        if (!tgt) setState(B, "calm");
        break;
      case "flee": break;
    }

    // ---- HOW FAST: the gait it wants, then legs that accelerate like legs
    let want = 0;
    const top = bh.top * Math.pow(B.sizeMul, 0.3);
    switch (B.st) {
      case "calm": want = bh.walk; break;
      case "look": case "display": want = 0; break;
      case "approach": want = B.pred && d < 90 && d > 30 ? bh.walk * 0.85 : (d > 70 ? bh.amble : bh.amble * 1.15); break;
      case "bluff": want = top; break;
      case "charge": want = d > 70 ? bh.amble * 1.3 : top; break;
      case "retreat": case "disengage": want = bh.walk * 1.2; break;
      case "avoid": want = bh.amble * 1.4; break;
      case "flee": want = top; break;
    }
    if (B.act) want = Math.min(want, 2);
    // the brakes, the lungs, the wounds
    const legInj = Math.max(B.inj[0], B.inj[1], B.inj[2], B.inj[3]);
    want *= (1 - 0.45 * legInj) * (0.5 + 0.5 * Math.sqrt(hf));
    const tired = B.stam < 0.25;
    if (tired) want = Math.min(want, bh.amble * (0.7 + B.stam * 2));
    const acc = (want > B.vNow ? bh.accel : bh.decel) * dt;
    B.vNow = toward(B.vNow, want, acc);
    B.want = want;
    if (B.vNow > bh.amble * 1.15) B.stam = Math.max(0, B.stam - dt / bh.sprintS * (B.vNow / bh.top));
    else B.stam = Math.min(1, B.stam + dt / bh.recoverS * (B.vNow < 0.5 ? 1.6 : 1));
  }

  /* ==========================================================================
     THE FIGHT (the battle calls this inside the strike bubble)
     Actions: swat (one forepaw, a hooking rake), bite, slam (the charge's
     pin: half-rear, both forepaws driven down), hug (stand, clasp, bite).
  ========================================================================== */
  const ACT = {
    swat: { dur: 0.52, hit: 0.46, style: "swat" },
    bite: { dur: 0.62, hit: 0.5, style: "maul" },
    slam: { dur: 0.95, hit: 0.6, style: "swat" },
    hug: { dur: 1.55, hit: 0.56, hit2: 0.8, style: "maul" },
  };
  function forceDmg(B, kind) {
    const S = B.S, bh = S.behave, mass = B.mass;
    let d;
    if (kind === "swat") d = bh.swat.mEff * mass * bh.swat.v / 3.2 + bh.clawCm * 1.3;
    else if (kind === "slam") d = 0.25 * mass * bh.slamV / 3.2 + bh.clawCm;
    else if (kind === "bite") d = bh.biteN * Math.pow(mass / S.mass.m, 0.67) / 90;
    else d = bh.biteN * Math.pow(mass / S.mass.m, 0.67) / 90 * 1.15;
    return d;
  }
  function strikePoint(B, kind, side, out) {
    const D = B.R.D;
    if (kind === "bite" || kind === "hug") { out.x = D.nose.x + 0.08 * D.k; out.y = D.nose.y; out.z = 0; }
    else { out.x = D.shX + (D.fa + D.fb) * 0.92 + D.fc * 0.5; out.y = D.sh * 0.8; out.z = side * D.legZf * 0.6; }
    return out;
  }
  const _sp = { x: 0, y: 0, z: 0 };
  const RES = { inRange: false, dealt: 0, missed: false };
  function chooseAct(m, B, tgt, d) {
    const ratio = massOf(tgt) / B.mass;
    let wS = 0.5, wB = 0.3, wL = 0.2, wH = 0;
    if (ratio > 0.55 && tgt.beast) { wH = 0.42; wS = 0.33; wB = 0.25; wL = 0; }
    else if (tgt.beast) { wB = 0.45; wS = 0.35; wL = 0.2; }
    if (B.vNow > 6 && B.flurry === 0) wL += 0.3;   // a charge arrives as a pin
    if (B.pred) wB *= 1.7;
    const tot = wS + wB + wL + wH, r = B.rng() * tot;
    return r < wS ? "swat" : r < wS + wB ? "bite" : r < wS + wB + wL ? "slam" : "hug";
  }
  function fight(spec, m, tgt, dt, opts) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    const B = ensure(m);
    if (!B || !tgt || tgt.dead || !(dt > 0)) return RES;
    const D = B.R.D, s = (m.group && m.group.scale.x) || 1;
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-3;
    B.fightT = B.t;
    // POSSESSED (src/battle/player.js): the move the player's press chose is
    // latched on the body (_atkAnim = 0); play it as this bear's own action
    // and report its progress back through _atkAnim
    const ym = opts && opts.youMove;
    if (ym) {
      if (!B.act && m._atkAnim === 0) {
        const kind = ACT[ym.id] ? ym.id : (ym.style === "pounce" || ym.style === "ram" ? "slam" : ym.style === "bite" || ym.style === "lunge" ? "bite" : "swat");
        B.act = { kind: kind, t: 0, side: B.rng() < 0.5 ? -1 : 1, done: false, done2: false, pow: ym.pow || 1, you: true };
      }
      if (!B.act) { m._atkAnim = -1; return RES; }
    }
    // face it
    const want = Math.atan2(dz, dx);
    let h = typeof m.heading === "number" ? m.heading : 0;
    const turnR = (B.act ? 2.5 : B.bh.turnRate) * dt;
    h += clamp(wrapPi(want - h), -turnR, turnR);
    m.heading = h; m.faceH = h;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h); else m.group.rotation.y = -h;
    // not fighting: a bluffing bear runs in and stops, a displaying one
    // stands its ground, a frightened one is not here at all
    if (!ym && (B.flee || B.st === "display" || B.st === "look" || B.st === "retreat" || B.st === "avoid" || B.st === "disengage" || tgt.vehicle)) {
      if (B.act) B.act = null;
      if (B.st === "bluff" && d > B.bluffStop && opts && opts.move) opts.move(m, dx / d, dz / d, B.vNow * dt);
      return RES;
    }
    if (!ym && B.st === "bluff") {
      if (d > B.bluffStop && opts && opts.move) opts.move(m, dx / d, dz / d, B.vNow * dt);
      return RES;
    }
    if (!ym && B.st !== "charge") setState(B, "charge");
    const reachX = (D.shX + (D.fa + D.fb) * 0.9 + D.fc * 0.4) * s;
    const close = reachX + (tgt.rad || 0.45) * 0.25;
    RES.inRange = d <= close + 0.6;
    if (!B.act) {
      if (d > close + 0.08 && opts && opts.move) {
        const v = Math.max(2.2, Math.min(B.vNow + 1, 6.5)) * (1 - 0.4 * Math.max(B.inj[0], B.inj[1]));
        opts.move(m, dx / d, dz / d, Math.min(v * dt, d - close));
      }
      B.cool -= dt;
      const faced = Math.abs(wrapPi(want - h)) < 0.5;
      if (B.cool <= 0 && d <= close + 0.75 && faced) {
        const kind = chooseAct(m, B, tgt, d);
        B.act = { kind: kind, t: 0, side: B.rng() < 0.5 ? -1 : 1, done: false, done2: false, lunge: 0 };
        B.flurry++; B.nAct = (B.nAct || 0) + 1;
      }
      return RES;
    }
    // ---- mid-action
    const A = B.act, def = ACT[A.kind];
    const t0 = A.t;
    A.t += dt / def.dur;
    // the body drives into the blow (a slam carries the bear a body-length)
    if (A.kind === "slam" && A.t > 0.35 && A.t < 0.65 && d > close * 0.8 && opts && opts.move) opts.move(m, dx / d, dz / d, 3.2 * dt);
    if (A.kind === "bite" && A.t > 0.3 && A.t < 0.55 && d > close * 0.85 && opts && opts.move) opts.move(m, dx / d, dz / d, 1.6 * dt);
    if (!A.done && t0 < def.hit && A.t >= def.hit) { A.done = true; landBlow(m, B, tgt, A.kind, A.side, opts); }
    if (def.hit2 && !A.done2 && t0 < def.hit2 && A.t >= def.hit2) { A.done2 = true; landBlow(m, B, tgt, "swat", -A.side, opts, 0.45); }
    if (A.you) m._atkAnim = Math.min(0.999, A.t);
    if (A.t >= 1) {
      B.act = null;
      if (A.you) { m._atkAnim = -1; RES.dealt = B._dealt || 0; RES.missed = !!B._missed; B._dealt = 0; B._missed = false; return RES; }
      if (B.flurry >= B.flurryN) { B.flurry = 0; B.flurryN = 2 + Math.floor(B.rng() * 3); B.cool = 0.3 + B.rng() * 0.45; }
      else B.cool = 0.04 + B.rng() * 0.12;
      // A DEFENSIVE BEAR STOPS when the threat is down: it has made its point
      if (!B.pred && !tgt.beast && tgt.hp < tgt.maxHp * 0.3 && B.t - (B.hurtAt || -9) > 3 && (tgt.routed || !tgt.armed)) { setState(B, "disengage"); B.retT = 2.5 + B.rng() * 2; }
    }
    RES.dealt = B._dealt || 0; RES.missed = !!B._missed; B._dealt = 0; B._missed = false;
    return RES;
  }
  function landBlow(m, B, tgt, kind, side, opts, mul) {
    const s = (m.group && m.group.scale.x) || 1, h = m.heading || 0;
    strikePoint(B, kind, side, _sp);
    const c = Math.cos(h), sn = Math.sin(h);
    const wx = m.pos.x + (c * _sp.x - sn * _sp.z) * s, wz = m.pos.z + (sn * _sp.x + c * _sp.z) * s;
    const miss = Math.hypot(tgt.pos.x - wx, tgt.pos.z - wz) - (tgt.rad || 0.45);
    if (miss > 0.5 * s) { B._missed = true; B.nMiss = (B.nMiss || 0) + 1; return; }
    if (tgt.dummy) return;                      // a possessed swing at the air
    const hf = clamp(m.hp / Math.max(1, m.maxHp), 0, 1);
    let dmg = forceDmg(B, kind) * (0.65 + 0.35 * hf) * (0.85 + 0.3 * B.rng()) * (mul || 1) * ((B.act && B.act.pow) || 1);
    // where the blow lands on the jaw seam creature_combat's gore reads
    B.jaw.x = _sp.x; B.jaw.y = _sp.y; B.jaw.z = _sp.z;
    if (opts && typeof opts.onHit === "function") opts.onHit(dmg);
    else { tgt.hp -= dmg; }
    B._dealt = (B._dealt || 0) + dmg; B.nHit = (B.nHit || 0) + 1;
    try {
      if (CBZ.creatureBiteBlood) CBZ.creatureBiteBlood(m, tgt, kind === "bite" || kind === "hug" ? "maul" : "strike");
      if (kind === "bite" || kind === "hug") { if (CBZ.creatureBiteWound) CBZ.creatureBiteWound(m, tgt, "maul"); }
      else if (CBZ.bodyWound && tgt.char) {
        _wp.x = wx; _wp.y = m.pos.y + _sp.y * s + 0.5; _wp.z = wz;
        CBZ.bodyWound(tgt, _wp, { melee: "blade", fromX: m.pos.x, fromZ: m.pos.z });
      }
    } catch (e) {}
    B.jaw.x = B.R.D.nose.x; B.jaw.y = B.R.D.nose.y; B.jaw.z = 0;
  }
  const _wp = { x: 0, y: 0, z: 0 };

  /* ==========================================================================
     ANIMATE: brain, then gait + postures + actions -> bones
  ========================================================================== */
  const BODY = { pX: 0, pY: 0, pR: 0, cX: 0, cY: 0, cR: 0 };
  function env(t, a, b) { return t <= a ? 0 : t >= b ? 0 : Math.sin(PI * (t - a) / (b - a)); }
  function ramp(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
  function animate(spec, m, dt) {
    const B = ensure(m);
    if (!B || m.dead) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.12) dt = 0.12;
    brain(m, B, dt);
    if (m._bearPin) B.st = m._bearPin;          // a tool's still: hold a state for the picture
    const R = B.R, D = R.D, K = D.K, k = D.k, b = R.bones, bp = R.bindPos, BN = R.T.BN, QG = CBZ.quadGait;
    QR_ik2 = CBZ.quadRig.ik2;
    const gx = m.pos.x, gz = m.pos.z, gy = m.pos.y;
    let h = typeof m.heading === "number" ? m.heading : 0;
    const tgt = m.tgt && !m.tgt.dead ? m.tgt : null;
    // standing still and engaged: square up to it (look, display, between blows)
    // an action whose fight stopped being called (the victim died under it)
    // plays out instead of freezing mid-swing
    if (B.act && B.t - (B.fightT || 0) > 0.15) {
      B.act.t += dt / ACT[B.act.kind].dur;
      if (B.act.t >= 1) { if (B.act.you) m._atkAnim = -1; B.act = null; }
    }
    if (tgt && B.vNow < 0.6 && !B.act && !B.flee && !m.you) {
      const want = Math.atan2(tgt.pos.z - gz, tgt.pos.x - gx);
      const dh = wrapPi(want - h);
      if (Math.abs(dh) > 0.05) {
        h += clamp(dh, -2.2 * dt, 2.2 * dt);
        m.heading = h; m.faceH = h;
        if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h); else m.group.rotation.y = -h;
      }
    }
    // ---- measured motion
    if (B.px == null) { B.px = gx; B.pz = gz; B.ph = h; }
    const mdx = gx - B.px, mdz = gz - B.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - B.ph) / dt;
    const ground = CBZ.floorAt || null;
    if (mdx * mdx + mdz * mdz > 16) { v = 0; turn = 0; QG.reset(R.G, gx, gz, h, ground, gy); }
    B.px = gx; B.pz = gz; B.ph = h;
    B.v = approach(B.v, clamp(v, -4, 16), 8, dt);
    B.turn = approach(B.turn, clamp(turn, -6, 6), 8, dt);

    // ---- moods (eased)
    const A = B.act, act = A ? A.kind : null, at = A ? A.t : 0;
    const st = B.st;
    const aggrW = (st === "charge" || st === "display" || A) ? 1 : 0;
    B.aggr = approach(B.aggr, aggrW, 4, dt);
    B.fearK = approach(B.fearK, B.flee || st === "avoid" ? 1 : 0, 4, dt);
    B.pant = approach(B.pant, clamp((1 - B.stam) * 1.4, 0, 1), 1.5, dt);
    // REAR: standing to look, the clasp, a half rise in the swat and the pin
    let rearW = st === "look" ? 1 : 0;
    if (act === "hug") rearW = Math.max(rearW, env(at, 0.0, 1.0) > 0 ? clamp(at / 0.25, 0, 1) * clamp((1 - at) / 0.22, 0, 1) * 0.82 : 0);
    if (act === "slam") rearW = Math.max(rearW, 0.55 * env(at, 0.05, 0.62));
    if (act === "swat") rearW = Math.max(rearW, 0.32 * env(at, 0.0, 0.75));
    B.rear = act === "hug" || act === "slam" || act === "swat" ? rearW : approach(B.rear, rearW, 2.6, dt);
    B.disp = approach(B.disp, st === "display" ? 1 : 0, 5, dt);
    const rearK = B.rear, dispK = B.disp;
    if (B.fl.t > 0) B.fl.t = Math.max(0, B.fl.t - dt);
    const flE = B.fl.t > 0 ? Math.sin(PI * (B.fl.t / 0.55)) * (B.fl.t / 0.55) * B.fl.k : 0;

    // ---- GAIT (all fours); reared, the feet hold where they stand
    const G = R.G;
    const gallopW = G.mix && G.mix.wG ? G.mix.wG : 0;
    D.legLen = D.legLen0 * (1 + 0.4 * gallopW);
    // IN WATER (an arena with a sea: the battle gives the body a swim depth)
    // a bear dog-paddles: no footfalls, the legs stroke under it
    const swim = m.swimD != null;
    const quad = rearK < 0.35 && !swim;
    if (!swim) QG.step(G, dt, quad ? B.v : 0, quad ? B.turn : 0, gx, gz, h, ground, gy);
    else { B.swPh = (B.swPh || 0) + dt * TAU * (0.9 + 0.12 * Math.abs(B.v)); }
    const M = G.mix, ph = G.phase * TAU;
    const moveK = clamp(Math.abs(B.v) / 0.5, 0, 1);
    const gal = (M.wG || 0) * moveK, walkK = ((M.wW || 0) + (M.wA || 0)) * moveK;

    // ---- BODY: pelvis + chest, pitch about the hips
    const Vx = D.shX - D.hipX, Vy = D.sh - D.hip;
    let pX = D.hipX, pY = D.hip, pitch = 0, flex = 0, comp = 0;
    let rollC = 0, rollP = 0, yawC = 0;
    // walk: plantigrade bodies barely bob; the shoulders roll over the stance leg
    pY -= 0.01 * K * walkK * (0.5 - 0.5 * Math.cos(2 * ph));
    const fPh = TAU * (G.phase + M.off[0]), hPh = TAU * (G.phase + M.off[2]);
    rollC = 0.075 * walkK * Math.sin(fPh) * (1 - gal);
    rollP = 0.05 * walkK * Math.sin(hPh) * (1 - gal);
    // gallop: the back flexes and extends, the body rocks
    flex = 0.2 * gal * Math.sin(ph + 0.6);
    pitch += 0.07 * gal * Math.sin(ph - 0.9);
    pY += 0.045 * k * gal * Math.sin(ph - 1.6) - 0.03 * k * gal;
    comp = 0.07 * gal * Math.sin(ph + 0.6);
    // speed: a charging bear drops its head and shoulders
    const chg = clamp((B.v - 3) / 6, 0, 1);
    pitch -= 0.04 * chg;
    // injured legs: the body unloads the hurt one while it bears weight
    for (let L = 0; L < 4; L++) {
      const inj = B.inj[L];
      if (inj < 0.05 || !moveK) continue;
      const F = G.feet[L];
      if (!F.sw) {
        if (L < 2) { pitch += 0.06 * inj; rollC -= (L === 0 ? -1 : 1) * 0.05 * inj; }
        else pY += 0.04 * inj * k;
      }
    }
    // fear: the rump drops; display: braced, head low, huffing; bluff: tall
    pY -= 0.03 * k * B.fearK;
    const huff = dispK * (0.5 + 0.5 * Math.sin(B.t * 7.5));
    pitch -= 0.05 * dispK;
    comp += 0.06 * dispK;
    // REAR UP
    const rearP = (B.S.behave.rearPitch || 1.25) * rearK;
    pitch += rearP;
    pX -= 0.06 * k * rearK;
    pY += (D.ha + D.hb + D.pawH * 1.2 - 0.05 * k - D.hip) * rearK * 0.8;
    // hit reactions by location
    const fs = B.fl.side, fp = B.fl.part;
    if (flE > 0) {
      if (fp === 1) { pitch -= 0.12 * flE; rollC += fs * 0.16 * flE; }
      else if (fp === 2) { rollC += fs * 0.12 * flE; rollP += fs * 0.1 * flE; flex += 0.08 * flE; }
      else if (fp === 3) { pY -= 0.06 * k * flE; rollP += fs * 0.16 * flE; pitch += 0.05 * flE; }
      else pitch += 0.04 * flE;
    }
    // action body
    let lunge = 0;
    if (act === "bite") lunge = 0.16 * k * env(at, 0.15, 0.85);
    if (act === "slam") { lunge = 0.28 * k * ramp(at, 0.35, 0.62) * (1 - ramp(at, 0.75, 1)); }
    if (act === "swat") { rollC += A.side * 0.12 * env(at, 0.1, 0.8); yawC = -A.side * 0.18 * (env(at, 0.0, 0.42) - env(at, 0.4, 0.9)); }
    pX += lunge;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sc = 1 + comp * -0.35;
    const cX = pX + (cp * Vx - sp * Vy) * sc, cY = pY + (sp * Vx + cp * Vy) * sc;
    BODY.pX = pX; BODY.pY = pY; BODY.pR = pitch + flex; BODY.cX = cX; BODY.cY = cY + 0.025 * k * huff; BODY.cR = pitch - flex * 0.6;
    b[BN.pelvis].position.set(BODY.pX, BODY.pY, 0);
    b[BN.pelvis].rotation.set(rollP, 0, BODY.pR);
    b[BN.chest].position.set(BODY.cX, BODY.cY, 0);
    b[BN.chest].rotation.set(rollC, yawC, BODY.cR);
    b[BN.root].position.set(0, 0, 0);

    // ---- LEGS
    for (let L = 0; L < 4; L++) {
      const front = L < 2, F = G.feet[L], sd = L % 2 === 0 ? -1 : 1;
      const base = D.feet[L];
      let tx = F.lx, ty = F.ly + D.pawH, tz = F.lz, fa;
      const su = F.sw ? Math.sin(PI * F.u) : 0;
      // late stance: the heel peels up off the planted toe
      const late = F.sw ? 0 : clamp((base.x - F.lx) / (0.38 * k) - 0.15, 0, 1);
      if (front) fa = -0.08 - 0.75 * late - 1.45 * su * (F.u < 0.75 ? 1 : (1 - F.u) / 0.25);
      else fa = -0.6 * late - 0.95 * su;
      let sx = 0, sy = 0;
      if (front) sx = clamp((F.lx - base.x) / (0.45 * k), -1, 1) * 0.08 * k;      // the scapula slides
      let toeIn = front ? -sd * 0.22 : -sd * 0.08;
      let roll = 0;
      // REARED: the hind feet stay planted, the forepaws hang off the chest
      if (front && rearK > 0.01) {
        const jx = BODY.cX + Math.cos(BODY.cR) * bp[R.T.LEGB[L][0]].x, jy = BODY.cY;
        const hx = jx + 0.22 * k, hy = jy - (D.fa + D.fb) * 0.72;
        const rk = clamp(rearK * 1.4, 0, 1);
        tx = lerp(tx, hx + D.fc * 0.4, rk); ty = lerp(ty, hy, rk); fa = lerp(fa, -1.3, rk);
        tz = lerp(tz, sd * D.legZf * 0.85, rk);
      }
      // DISPLAY: the forepaws braced out front; one slaps the ground
      if (front && dispK > 0.01 && !A) {
        const slapP = (B.t * 0.9 + (sd > 0 ? 0.5 : 0)) % 1;
        const slap = sd > 0 ? env(slapP, 0.0, 0.35) : 0;
        tx += 0.12 * k * dispK; ty += 0.32 * k * slap * dispK; fa -= 0.6 * slap * dispK;
      }
      // ACTIONS on the forelimbs
      if (front && A) {
        const jx = BODY.cX, jy = BODY.cY;
        const reach = (D.fa + D.fb);
        if (act === "swat" && sd === A.side) {
          const wind = env(at, 0.0, 0.5), strike = ramp(at, 0.32, 0.5) * (1 - ramp(at, 0.62, 1));
          const up = wind * (1 - strike);
          const ax = jx + reach * (0.5 * up + 0.95 * strike), ay = jy + reach * (0.12 * up - 0.6 * strike);
          const k2 = Math.max(wind, strike);
          tx = lerp(tx, ax + D.fc * 0.6, k2); ty = lerp(ty, Math.max(D.pawH * 2, ay), k2); fa = lerp(fa, -0.3 - 0.9 * up, k2);
          tz = lerp(tz, sd * (D.legZf + reach * 0.7 * up - D.legZf * 0.9 * strike), k2);
          toeIn = lerp(toeIn, -sd * 0.7, k2);
        } else if (act === "slam") {
          const lift = env(at, 0.05, 0.62), drive = ramp(at, 0.45, 0.62) * (1 - ramp(at, 0.8, 1));
          const ax = jx + reach * (0.3 + 0.45 * drive + 0.2 * lift), ay = jy - reach * (0.35 + 0.5 * drive) + 0.1 * k * lift;
          const k2 = Math.max(lift, drive);
          tx = lerp(tx, ax, k2); ty = lerp(ty, Math.max(D.pawH, ay), k2); fa = lerp(fa, -0.5 + 0.4 * drive, k2);
        } else if (act === "hug") {
          const clasp = ramp(at, 0.3, 0.55) * (1 - ramp(at, 0.85, 1));
          const ax = jx + reach * (0.55 + 0.15 * clasp), ay = jy - reach * 0.05;
          const k2 = clamp(at / 0.3, 0, 1) * (1 - ramp(at, 0.85, 1));
          tx = lerp(tx, ax, k2); ty = lerp(ty, ay, k2); fa = lerp(fa, -0.9, k2);
          tz = lerp(tz, sd * D.legZf * (1.3 - 1.4 * clasp), k2);
          toeIn = lerp(toeIn, -sd * 1.0, k2);
        }
      }
      if (swim) {
        const jx = front ? BODY.cX : BODY.pX, jy = front ? BODY.cY : BODY.pY, lg = front ? D.fa + D.fb : D.ha + D.hb;
        const q = B.swPh + (sd > 0 ? PI : 0) + (front ? 0 : PI * 0.5);
        tx = jx + lg * (front ? 0.35 + 0.35 * Math.cos(q) : -0.15 + 0.3 * Math.cos(q));
        ty = jy - lg * (0.62 - 0.18 * Math.sin(q)); tz = sd * (front ? D.legZf : D.legZh) * 1.15;
        fa = front ? -0.9 + 0.6 * Math.sin(q) : -0.4 + 0.4 * Math.sin(q);
      }
      // a hurt foreleg buckles in the flinch
      if (flE > 0 && fp === 1 && front && sd === fs) { ty += 0.05 * k * flE; }
      poseLeg(R, L, BODY, tx, ty, tz, fa, sx, sy, toeIn, roll);
    }

    // ---- NECK, HEAD, JAW
    let lookYaw = 0, lookPitch = 0;
    if (tgt && !B.flee) {
      lookYaw = wrapPi(Math.atan2(tgt.pos.z - gz, tgt.pos.x - gx) - h);
      lookYaw = clamp(-lookYaw, -1.0, 1.0);              // model yaw: +y turns the nose toward -z
    }
    if (st === "look") lookPitch = 0.25 + 0.06 * Math.sin(B.t * 5.3);
    B.lookY = approach(B.lookY, lookYaw, 4, dt);
    B.lookP = approach(B.lookP, lookPitch, 3, dt);
    let nP = (swim ? 0.3 : 0) - 0.05 * B.aggr - 0.12 * dispK - 0.16 * B.fearK - 0.1 * chg + 0.06 * (st === "bluff" ? 1 : 0);
    nP += 0.05 * walkK * Math.sin(2 * ph + 0.4) + 0.12 * gal * Math.sin(ph + 1.3);
    nP -= BODY.cR * 0.8;                                  // keep the face level when the chest pitches
    nP += B.lookP;
    let nY = B.lookY * 0.5 - rollC * 0.7;
    nY += 0.12 * dispK * Math.sin(B.t * 2.6);             // the head swing of the threat display
    let hR = 0, jawO = 0.06 * B.pant + 0.04 * B.aggr;
    // jaw popping and huffing in the display
    if (dispK > 0.01) jawO += dispK * 0.35 * Math.max(0, Math.sin(B.t * 13)) * (Math.sin(B.t * 2.1) > -0.2 ? 1 : 0);
    if (act === "bite" || act === "hug") {
      const hit = act === "bite" ? 0.5 : 0.56;
      const open = act === "bite" ? ramp(at, 0.08, 0.42) * (1 - ramp(at, hit - 0.04, hit + 0.04)) : ramp(at, 0.3, 0.5) * (1 - ramp(at, hit - 0.03, hit + 0.04));
      jawO += 0.75 * open;
      nP -= (act === "bite" ? 0.22 : 0.4) * env(at, 0.1, 0.9);
      if (at > hit && at < 0.9) { hR = 0.28 * Math.sin((at - hit) * 40) * (1 - (at - hit) / 0.4); nY += 0.12 * Math.sin((at - hit) * 40); }
    }
    if (act === "swat") nY += A.side * 0.25 * env(at, 0.2, 0.8);    // the face turns from its own blow
    // flinch: the head jerks; a hit to the flank or hindquarter is bitten at
    if (flE > 0) {
      if (fp === 0) { nY += fs * 0.5 * flE; nP += 0.25 * flE; hR += fs * 0.3 * flE; }
      else if (fp >= 2) { nY -= fs * (fp === 3 ? 1.1 : 0.7) * flE; nP -= 0.15 * flE; jawO += 0.4 * flE; }
      else { nP -= 0.12 * flE; }
    }
    b[BN.neck].rotation.set(0, nY * 0.55, nP * 0.6);
    b[BN.neck1].rotation.set(hR * 0.3, nY * 0.45, nP * 0.4);
    b[BN.head].rotation.set(hR, 0, 0.05 * B.aggr - 0.04 * gal * Math.sin(ph));
    b[BN.jaw].rotation.set(0, 0, -clamp(jawO, 0, 0.85));
    // ears: pinned flat in a real attack and in fear, up in a bluff
    const pin = clamp(Math.max(B.fearK, A ? 1 : 0, st === "charge" ? 0.8 : 0) - (st === "bluff" ? 1 : 0), 0, 1);
    for (let s2 = 0; s2 < 2; s2++) {
      const e = b[s2 === 0 ? BN.earL : BN.earR], sg = s2 === 0 ? -1 : 1;
      e.rotation.set(sg * (0.15 + 0.5 * pin), 0, 0.95 * pin - 0.1 * (st === "bluff" || st === "look" ? 1 : 0));
    }
    // the hump rides the front stance; the stub tail barely moves
    b[BN.hump].position.set(bp[BN.hump].x, bp[BN.hump].y + 0.012 * k * walkK * Math.sin(2 * ph) + 0.02 * k * gal * Math.sin(ph), 0);
    b[BN.tail0].rotation.set(0, 0.15 * walkK * Math.sin(ph), -0.3 * B.fearK + 0.1 * gal * Math.sin(ph));
    // the mouth point creature_combat's gore reads follows the head
    if (!A) { B.jaw.x = D.nose.x + lunge; B.jaw.y = D.nose.y + (BODY.cY - D.sh); }
  }

  /* ==========================================================================
     DEATH: the corpse solver owns the group; the legs and head are bent onto
     its solved stand-in points (or go limp when it declined), once a frame.
  ========================================================================== */
  function deadDrive(renderer) {
    const R = this.userData.bearRig, m = this.userData.bearUnit;
    if (!R || !m || !m.dead) return;
    const fr = renderer && renderer.info && renderer.info.render ? renderer.info.render.frame : 0;
    if (R.frame === fr) return;
    R.frame = fr;
    if (!CBZ.quadRig) return;
    QR_ik2 = CBZ.quadRig.ik2;
    const D = R.D, b = R.bones, bp = R.bindPos, BN = R.T.BN, k = D.k;
    const now = (W.performance && W.performance.now) ? W.performance.now() * 0.001 : 0;
    if (!R.dead.t0) R.dead.t0 = now;
    // a settled corpse keeps the last pose written (the bones hold it): stop
    if (now - R.dead.t0 > 9) return;
    const tk = clamp((now - R.dead.t0) / 0.6, 0, 1);
    BODY.pX = D.hipX; BODY.pY = D.hip; BODY.pR = 0; BODY.cX = D.shX; BODY.cY = D.sh; BODY.cR = 0;
    b[BN.pelvis].position.set(D.hipX, D.hip, 0); b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.set(D.shX, D.sh, 0); b[BN.chest].rotation.set(0, 0, 0);
    const solved = !!m.ragdoll;
    for (let L = 0; L < 4; L++) {
      const front = L < 2, sd = L % 2 === 0 ? -1 : 1, f = R.prox.feet[L].position;
      let tx, ty, tz;
      if (solved) {
        // toward the solved foot, a touch short of it: a dead leg is never locked straight
        const jx = front ? D.shX : D.hipX, jy = front ? D.sh : D.hip, jz = (front ? D.legZf : D.legZh) * sd;
        tx = jx + (f.x - jx) * 0.86 + (front ? D.fc * 0.5 : D.hc * 0.5); ty = jy + (f.y - jy) * 0.86; tz = jz + (f.z - jz) * 0.86;
      }
      else {
        // limp: the legs fold loosely out from the body
        const jx = front ? D.shX : D.hipX, jy = front ? D.sh : D.hip;
        tx = lerp(D.feet[L].x, jx + (front ? 0.25 : -0.2) * k, tk); ty = lerp(D.pawH, jy - (D.fa + D.fb) * 0.75, tk); tz = sd * (front ? D.legZf : D.legZh) * (1 + 0.6 * tk);
      }
      poseLeg(R, L, BODY, tx, ty, tz, front ? -0.9 : -0.5, 0, 0, 0, 0);
    }
    // the head lolls where the solver put it
    let nP = -0.35 * tk, nY = 0;
    if (solved) {
      const hp = R.prox.head.position;
      const a0 = Math.atan2(D.headP.y - D.sh, D.headP.x - D.shX);
      const a1 = Math.atan2(hp.y - D.sh, hp.x - D.shX);
      nP = wrapPi(a1 - a0);
      nY = clamp(-0.5 * Math.atan2(hp.z, Math.max(0.05, hp.x - D.shX)), -0.6, 0.6);
    }
    b[BN.neck].rotation.set(0, nY * 0.6, nP * 0.6);
    b[BN.neck1].rotation.set(0, nY * 0.4, nP * 0.4);
    b[BN.head].rotation.set(0.2 * tk, 0, -0.1 * tk);
    b[BN.jaw].rotation.set(0, 0, -0.22 * tk);
    b[BN.earL].rotation.set(-0.4, 0, 0.6); b[BN.earR].rotation.set(0.4, 0, 0.6);
    b[BN.root].updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
  }

  /* ==========================================================================
     THE KIT: what a species file registers through
  ========================================================================== */
  function unit(spec) {
    return {
      kind: "species",
      stats: spec.stats,
      build: function (ctx) { return build(spec, ctx); },
      animate: function (m, dt) { animate(spec, m, dt); },
      fight: function (m, tgt, dt, opts) { return fight(spec, m, tgt, dt, opts); },
      moves: function (m, tgt, ctx) { return moves(spec, m, tgt, ctx); },
    };
  }
  /* WHAT A POSSESSED BEAR THROWS (src/units/kit/moves.js contract): at a run
     with something a couple of body lengths off, the charge-and-pin; a body
     on the floor gets the bite; another big animal gets the standing clasp;
     a crowd gets swats; otherwise swat, swat, bite, the bear's own rhythm. */
  const MV = {
    swat: { id: "swat", style: "maul", pow: 1, dur: ACT.swat.dur, rng: 1.0, cd: 0.25 },
    bite: { id: "bite", style: "bite", pow: 1, dur: ACT.bite.dur, rng: 1.0, cd: 0.35 },
    slam: { id: "slam", style: "pounce", pow: 1, dur: ACT.slam.dur, rng: 1.1, leap: 0.9, cd: 0.6 },
    hug: { id: "hug", style: "maul", pow: 1, dur: ACT.hug.dur, rng: 1.0, cd: 0.5 },
  };
  function moves(spec, m, tgt, ctx) {
    const B = ensure(m);
    ctx = ctx || {};
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2, n = ctx.n || 1;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    if (tgt && dist > reach * 1.05 && dist < reach * 2.8 && running) return MV.slam;
    if (ctx.downed) return MV.bite;
    if (tgt && B && tgt.beast && massOf(tgt) > B.mass * 0.55 && dist < reach * 1.2) return n % 2 ? MV.hug : MV.bite;
    if ((ctx.crowd || 0) >= 3) return MV.swat;
    return n % 3 === 0 ? MV.bite : MV.swat;
  }
  // the species row carries the authored mass (systems/bodymass.js reads it)
  function stampRow(spec) {
    const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[spec.id];
    if (row) row.mass = spec.mass.m;
  }
  CBZ.bearKit = { GAIT: GAIT, dims: dims, build: build, animate: animate, fight: fight, unit: unit, stampRow: stampRow,
    individual: individual, forceDmg: forceDmg,
    // a tool's handle: put a bear into an action / state for a picture
    force: function (m, kind, side) { const B = ensure(m); if (!B) return null; B.act = kind ? { kind: kind, t: 0, side: side || 1 } : null; return B; } };

  /* ==========================================================================
     THE BROWN BEAR (grizzly), Ursus arctos horribilis
  ========================================================================== */
  const SPEC = {
    id: "brown_bear",
    mass: { m: 300, f: 180 }, femaleK: 0.86,
    stats: {
      hp: 260, spd: 1.4, danger: 0.75, bite: 56, scale: 1, mass: 300,
      chase: 13.4, march: 3.6, dmg: 74, rate: 1.1, brave: true, prey: false,
    },
    body: {
      fa: 0.35, fb: 0.30, fc: 0.20, ha: 0.39, hb: 0.32, hc: 0.28, pawH: 0.055,
      sh: 0.68, hip: 0.73, shX: 0.42, hipX: -0.50, legZf: 0.175, legZh: 0.17,
      chest: [0.33, 0.31, 0.31], waist: [0.30, 0.29, 0.30], rump: [0.29, 0.27, 0.29],
      rumpBack: 0.25, rumpLift: 0.0, shLift: 0.03, hump: 0.12,
      neck: { len: 0.30, ang: -0.06, r: 0.25, w: 0.23, rEnd: 0.175, wEnd: 0.18 },
      head: { ang: -0.18, L: 0.44, skull: 0.155, skullB: 0.15, skullW: 0.185, brow: 0.03, dish: 1.0, roman: 0, stop: 0.2, muzzleR: 0.095, muzzleW: 0.088, cheek: 1.15 },
      ear: { h: 0.075, w: 0.07, z: 0.105, x: 0.03, up: 0.82, tilt: 0.12 },
      eye: { r: 0.015, d: 0.19, y: 0.042, z: 0.068 },
      tail: { len: 0.12, r: 0.05 },
      claws: { f: 0.09, h: 0.04 },
      paw: { fw: 0.085, hw: 0.072 },
      limb: { arm: 0.185, fore: 0.125, wrist: 0.08, thigh: 0.2, shin: 0.11, ankle: 0.075 },
    },
    coats: ["brown", "brown", "golden", "dark"],
    coat: function (D, coat, seed, U) {
      const pal = {
        brown: { base: 0x5e4129, tip: 0xa48a63, leg: 0x2d2016, face: 0x6c4f34, muz: 0x8b6c4b },
        golden: { base: 0x8a6a42, tip: 0xcfb385, leg: 0x3d2c1b, face: 0x977650, muz: 0xa88a62 },
        dark: { base: 0x3e2b1c, tip: 0x84694b, leg: 0x1f1610, face: 0x4c3624, muz: 0x6e5539 },
      }[coat];
      const k = D.k;
      return function (part, x, y, z, ca, sa, R) {
        if (R && R.tag === "nose") return 0x15110e;
        if (part === "eye") return 0x0f0a07;
        if (part === "claw") return 0xb9ab8f;
        if (part === "tooth") return 0xe6dcc6;
        const n = U.fnoise(x, y, z, 9 / k), n2 = U.fnoise(x + 3, y, z, 23 / k);
        let c = pal.base;
        if (part === "torso" || part === "neck" || part === "cheek") {
          // grizzled: silver tips over the hump, shoulders and back
          const humpZ = U.clamp(1 - Math.abs(x - D.shX + 0.08 * k) / (0.45 * k), 0, 1);
          const top = U.clamp(ca * 1.2, 0, 1);
          c = U.mixHex(c, pal.tip, U.clamp(top * (0.35 + 0.55 * humpZ) + n2 * 0.25, 0, 0.9));
          if (ca < -0.4) c = U.mixHex(c, pal.leg, 0.35);
        } else if (part === "head") {
          c = R && R.muz ? (R.muz >= 3 ? U.mixHex(pal.muz, 0x2a1f16, (R.muz - 3) * 0.6) : U.mixHex(pal.face, pal.muz, 0.6)) : pal.face;
          if (R && R.brow && ca > 0.3) c = U.mixHex(c, pal.tip, 0.25);
          if (R && R.muz && ca < -0.55) c = 0x2a1a17;                  // lips
        } else if (part === "jaw") c = ca > 0.5 ? 0x3a2420 : U.mixHex(pal.muz, 0x3a2a1c, 0.4);
        else if (part === "ear") c = ca < -0.2 ? 0x3a2a1e : U.mixHex(pal.face, 0x2a1d14, 0.4);
        else if (part === "arm" || part === "thigh") c = U.mixHex(pal.base, pal.leg, U.clamp((D.sh - y) / (0.35 * k), 0, 1));
        else if (part === "leg") c = pal.leg;
        else if (part === "paw") c = ca < -0.35 ? 0x1b1512 : pal.leg;
        else if (part === "tail") c = pal.base;
        return U.mixHex(c, n > 0 ? 0xffffff : 0x000000, Math.abs(n) * 0.06);
      };
    },
    behave: {
      walk: 1.4, amble: 3.6, top: 13.4, accel: 5.0, decel: 9.0, sprintS: 22, recoverS: 45, turnRate: 4.5,
      nerve: 1.0, hitFear: 1.1, hitAnger: 2.2, fearDecay: 0.035, angerHold: 0.6, woundBrave: true,
      gunFear: 0.08, vehicleFear: 0.9, bigFear: 0.5, bluffP: 0.45, bluffRetreat: 0.5, lookP: 0.6,
      chargeDist: 45, predatory: false, toDeathHp: 0.3, rearPitch: 1.22,
      swat: { mEff: 0.08, v: 8.5 }, slamV: 3.0, biteN: 5000, clawCm: 8, hide: 3,
    },
  };
  CBZ.unitKit.register("brown_bear", unit(SPEC));
  stampRow(SPEC);
})();
