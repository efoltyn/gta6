/* ============================================================
   units/kit/canid.js — CBZ.canid: THE ONE DOG FAMILY.

   Every dog and wild canid in every mode is this body: the city's strays,
   pets, yard dogs and police K9s (city/dogs.js through CBZ.dogModel, a thin
   facade in city/dogmodel.js), NPC War's dogs, wolves, coyotes and foxes
   (units/species/*.js through CBZ.canid.hooks), and the wolves, coyotes and
   foxes of Gang City and the islands (the bestiary rows in city/wildlife/
   canines.js and forest_deer.js, animated through wildlife.js's per-species
   hook). A breed is a ROW of real measurements; a dog is a wolf with other
   numbers.

   BODY      one SkinnedMesh, one material, one draw call. Lofted with
             CBZ.loftKit.sweep through anatomical keys: a torso with withers,
             a deep keel chest, tuck-up, loin and croup; a neck with its ruff;
             a head with occiput, zygoma, eye sockets, brows, a stop, a muzzle
             with flews and a black nose leather with nostrils; a hinged lower
             jaw with teeth and a tongue; ears with thickness and a cupped
             inner face (prick, rose, drop); a brush, otter or whip tail. Each
             leg is ONE continuous loft from shoulder blade / ilium to the
             pastern with weights blended across every joint, ending in a paw
             with four toes, pads and claws (and the front dewclaw). Fur is a
             per-vertex flow drawn by loftKit.furMaterial plus tufts on the
             ruff, back, chest, belly, pants and tail of the long coats.
             Shape cached per row, colour per coat (attributes shared); a far
             LOD on the same skeleton.
   SKELETON  37 bones; the bind pose is the animal standing.
   MOTION    the planted-foot solver (CBZ.quadGait) on this family's footfall
             table with Froude-number transitions and cadence for the
             animal's own hip height; a trunk that vaults at the walk, is
             sprung at the trot and flies ballistically in the suspensions
             (two at the gallop, with spine flexion); 3-D leg IK with a
             swinging scapula; head bob with neck counter-motion; ears and
             tail on damped springs; breathing and panting; body language
             (alert, aggression, fear, happiness, sniff, bark, bite, worry);
             postures (sit, lie, play bow, side, dead); idle life (look round,
             ear flicks, scratch, shake off, yawn).
   FIGHT     NPC War's canid close fight. Every bite lands at the measured jaw
             on the victim's body through CBZ.bodyBite / creatureBiteChunk
             with { jaw, sev, by, dir, part }; a hold keeps the jaw there.

   API (maths half loads in node: rows, dims, tables, the fight brain)
     ROWS, row(id), dims(id, o), table(D), TABLE
     rig(id, o) -> rig  { group, mesh, bones, D, ... }
     pose(rig, dt, ctrl), collar(rig, hex|null), mouthWorld(rig, out),
     jawRadius(rig), biteId(rig), bite(att, rig, victim, info)
     build(id, ctx) / animate(m, dt) / fight(m, t, dt, o) / moves(m, t, ctx)
     / hooks(id) / stats(id)              NPC War units
     wildBuild(id, ctx) / animateActor(a, dt)   the bestiary actor
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2, G0 = 9.81;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, atan2 = Math.atan2, hypot = Math.hypot;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function frac(x) { return x - Math.floor(x); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    if (t <= 0) return a; if (t >= 1) return b;
    const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function shade(a, k) {
    const r = Math.min(255, ((a >> 16) & 255) * k), g = Math.min(255, ((a >> 8) & 255) * k), b = Math.min(255, (a & 255) * k);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }
  function hash3(x, y, z) { const s = sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    const h = function (a, b, c) { return hash3(xi + a, yi + b, zi + c); };
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), xf), lerp(h(0, 1, 0), h(1, 1, 0), xf), yf),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), xf), lerp(h(0, 1, 1), h(1, 1, 1), xf), yf), zf);
  }
  // palettes are written as the colour SEEN (sRGB, from photographs); vertex
  // colours go to the shader as linear with colour management off, so each
  // swatch is linearised once
  function lin(h) {
    const f = function (v) { return Math.round(Math.pow(v / 255, 2.2) * 255); };
    return (f((h >> 16) & 255) << 16) | (f((h >> 8) & 255) << 8) | f(h & 255);
  }

  // ==========================================================================
  //  ROWS — the male's real measurements. Lengths are fractions of the
  //  withers height W (m); head parts are fractions of the head length.
  //  Sources: AKC / FCI breed standards (heights, weights, proportions);
  //  Evans & de Lahunta, Miller's Anatomy of the Dog (bone lengths, joint
  //  angles); Brown, The Dog in Action (angulation); Mech & Boitani, Wolves
  //  (2003); Bekoff & Gese, Coyote (2003); Lariviere & Pasitschniak-Arts,
  //  Vulpes vulpes, Mammalian Species 537 (1996).
  //    BL        point of shoulder to point of buttock / W
  //    chestD    withers to brisket / W        tuck  belly rise at the loin / W
  //    ribW shW loinW croupW   half widths / W    croupH  croup height / W
  //    hipD      croup top to the hip joint / W
  //    neck*     length / W, radius / W, rise (rad)
  //    head*     headL / W; skullW, skullH, muzW, muzH, stop, flews / headL;
  //              muzK the muzzle's share of the head (stop to nose tip)
  //    leg       bone lengths / W (scapula, humerus, radius, metacarpus, front
  //              toes; femur, tibia, metatarsus, hind toes) and the standing
  //              angles: scapula layback from vertical, humerus below the
  //              horizontal (pointing back), pastern from vertical, femur
  //              below horizontal (forward), tibia below horizontal (back),
  //              metatarsus below horizontal; bone = thickness, paw = size,
  //              track = half the distance between left and right feet / W
  // ==========================================================================
  const BASE = {
    kind: "wild", W: 0.62, mass: 34, BL: 1.13,
    chestD: 0.47, ribW: 0.19, shW: 0.165, loinW: 0.135, croupW: 0.155, tuck: 0.11, croupH: 0.97, croupSlope: 0.38, arch: 0.01, hipD: 0.2,
    neckL: 0.39, neckR: 0.115, neckAng: 0.78, ruff: 1.0, dewlap: 0,
    headL: 0.4, muzK: 0.5, skullW: 0.27, skullH: 0.3, muzW: 0.12, muzH: 0.25, stop: 0.06, flews: 0.02, cheek: 1, headAng: -0.33, eyeK: 1, slit: false,
    ear: { type: "prick", L: 0.5, W: 0.3, tip: 0.85, cup: 0.4, th: 0.022, out: 0.22, fwd: 0.05, at: 0.13 },
    tail: { type: "brush", L: 0.68, R: 0.058, bush: 1.3, rest: 1.2, curl: 0.3 },
    leg: { scap: 0.29, hum: 0.306, rad: 0.33, mc: 0.126, toeF: 0.094, fem: 0.33, tib: 0.347, mt: 0.148, toeH: 0.09,
      lay: 0.52, humA: 0.72, pastA: 0.36, femA: 1.18, tibA: 0.86, mtA: 1.52, bone: 1, paw: 1, track: 0.105 },
    fur: { k: 0.5, len: 0.0042, tufts: 0.5, ruff: 1, pants: 1, tail: 1, back: 0.6, belly: 0.6, cheek: 0, elbow: 0.5 },
    sex: { lin: 0.94, girth: 0.93 },
  };
  const ROWS = Object.create(null);
  function deep(base, over) {
    const o = {};
    for (const k in base) o[k] = (base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) ? Object.assign({}, base[k]) : base[k];
    for (const k in over) {
      const v = over[k];
      if (v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) o[k] = Object.assign(o[k], v);
      else o[k] = v;
    }
    return o;
  }
  function defRow(id, over) { const R = deep(BASE, over); R.id = id; ROWS[id] = R; return R; }

  // ---- DOGS ----------------------------------------------------------------
  // German Shepherd, male: 0.60-0.65 m, 30-40 kg, body 10-17% longer than
  // tall, chest ~47% of the height, skull : muzzle 1 : 1, high-set prick ears
  // ~13 cm, a brush tail to the hock carried in a saber, strongly angulated
  // rear (low hocks), sloped pasterns.
  defRow("shepherd", {
    kind: "dog", name: "Shepherd", W: 0.63, mass: 35, BL: 1.14,
    chestD: 0.47, ribW: 0.185, shW: 0.16, loinW: 0.132, croupW: 0.15, tuck: 0.11, croupH: 0.95, croupSlope: 0.44, hipD: 0.2,
    neckL: 0.4, neckR: 0.112, neckAng: 0.8, ruff: 1.1,
    headL: 0.4, muzK: 0.5, skullW: 0.27, skullH: 0.3, muzW: 0.12, muzH: 0.255, stop: 0.065, flews: 0.025, headAng: -0.34,
    ear: { type: "prick", L: 0.52, W: 0.31, tip: 0.9, cup: 0.42, th: 0.02, out: 0.18, fwd: 0.08, at: 0.14 },
    tail: { type: "brush", L: 0.7, R: 0.055, bush: 1.32, rest: 1.25, curl: 0.38 },
    leg: { lay: 0.55, humA: 0.74, pastA: 0.4, femA: 1.12, tibA: 0.8, mtA: 1.5, bone: 1.05, paw: 1.05, track: 0.1 },
    fur: { k: 0.55, len: 0.0042, tufts: 0.45, ruff: 1, pants: 1.2, tail: 1.1, back: 0.35, belly: 0.6, cheek: 0.2, elbow: 0.6 },
    coats: {
      blacktan: { pattern: "saddle", base: 0xb27338, back: 0x1d1916, cape: 0x221d19, under: 0xc58c50, bib: 0xbd8244, mask: 0x171411, muzzleTop: 0x201b18,
        cheek: 0xb87a3e, crown: 0x2b231d, brow: 0xc2884a, chin: 0x2a241f, earBack: 0x1c1816, earIn: 0x7e6252, earRim: 0x141210,
        tailTop: 0x1b1715, tailUnder: 0xad7640, tailTip: 0x141210, leg: 0xbb7d42, paw: 0xc58b4e, pants: 0xc99355, eye: 0x3d2410,
        grizzle: 0.18, tip: 0x15120f, band: 0xd59b5c },
      sable: { pattern: "agouti", base: 0x8e7454, back: 0x3d332a, cape: 0x342b23, under: 0xc0a17c, bib: 0xbf9e76, mask: 0x1b1714, muzzleTop: 0x2a231d,
        cheek: 0x9c8058, crown: 0x4a3c30, brow: 0xb09270, chin: 0x3a3028, earBack: 0x2a231d, earIn: 0x7a6252, earRim: 0x161310,
        tailTop: 0x3a3129, tailUnder: 0xa48a66, tailTip: 0x141210, leg: 0xa88a62, paw: 0xb2966c, pants: 0xb89a74, eye: 0x3d2410,
        grizzle: 0.7, tip: 0x161310, band: 0xc49c68 },
    },
    coatW: { blacktan: 3, sable: 1.2 },
    bite: 12, hp: 55,
    fight: { bold: 0.7, turn: 8, lungeT: 0.3, holdT: 2.2, shake: 0.32, tire: 0.9, opportunist: false },
  });
  // American Pit Bull Terrier, male: 0.46-0.53 m, 16-27 kg, slightly longer
  // than tall, broad deep chest, a broad wedge head with bulging cheeks
  // (masseters), skull : muzzle ~ 3 : 2, a defined stop, rose ears, a short
  // whip tail, short smooth coat.
  defRow("pit", {
    kind: "dog", name: "Pit", W: 0.49, mass: 24, BL: 1.07,
    chestD: 0.5, ribW: 0.22, shW: 0.2, loinW: 0.15, croupW: 0.165, tuck: 0.1, croupH: 0.98, croupSlope: 0.32, hipD: 0.21,
    neckL: 0.34, neckR: 0.158, neckAng: 0.72,
    headL: 0.44, muzK: 0.42, skullW: 0.35, skullH: 0.34, muzW: 0.165, muzH: 0.35, stop: 0.11, flews: 0.06, cheek: 1.32, headAng: -0.22, eyeK: 0.92,
    ear: { type: "rose", L: 0.34, W: 0.3, tip: 0.4, cup: 0.3, th: 0.024, out: 0.42, fwd: 0, at: 0.16 },
    tail: { type: "whip", L: 0.55, R: 0.046, bush: 1, rest: 1.32, curl: 0.12 },
    leg: { hum: 0.3, rad: 0.32, femA: 1.2, tibA: 0.92, pastA: 0.3, bone: 1.36, paw: 1.12, track: 0.12 },
    fur: { k: 0.16, len: 0.0026, tufts: 0 },
    coats: {
      blue: { pattern: "blaze", base: 0x6d7077, under: 0x7b7e85, back: 0x63666d, white: 0xe6e2da, mask: 0x5f6269, muzzleTop: 0x64676e, nose: 0x3b3d42, eye: 0x9a6c2c,
        earIn: 0x9a7f7a, chest: 1, socks: 0.6, face: 0.3, tailTip: 0x6d7077 },
      brindle: { pattern: "brindle", base: 0x8d6139, stripe: 0x2d2016, under: 0x9a6c42, white: 0xe4ddd0, mask: 0x3a2a1e, eye: 0x4a2c14, earIn: 0x8a6a5e,
        chest: 1, socks: 0.4, face: 0, stripes: 0.55 },
      red: { pattern: "blaze", base: 0xa9643c, under: 0xb57046, back: 0x9c5a35, white: 0xece5d9, mask: 0x9e5c37, nose: 0x6a3a2c, eye: 0x8a5a24, earIn: 0x9a6a5a,
        chest: 1, socks: 0.3, face: 0.2 },
      blackwhite: { pattern: "blaze", base: 0x1d1b1a, under: 0x262321, back: 0x1a1817, white: 0xeae6de, mask: 0x1d1b1a, eye: 0x3d2410, earIn: 0x5a4a44,
        chest: 1, socks: 0.9, face: 0.6 },
    },
    coatW: { blue: 2, brindle: 2, red: 1.5, blackwhite: 1 },
    bite: 15, hp: 50,
    fight: { bold: 0.85, turn: 9, lungeT: 0.26, holdT: 3.2, shake: 0.4, tire: 0.8, opportunist: false },
  });
  // English Mastiff, male: >= 0.76 m, 73-104 kg, massive and rectangular,
  // a broad skull with a short muzzle (1 : 3 of the head), a marked stop,
  // pendulous flews, small drop ears, a black mask; fawn, apricot, brindle.
  defRow("mastiff", {
    kind: "dog", name: "Mastiff", W: 0.79, mass: 86, BL: 1.12,
    chestD: 0.52, ribW: 0.23, shW: 0.21, loinW: 0.17, croupW: 0.18, tuck: 0.06, croupH: 0.98, croupSlope: 0.3, hipD: 0.21,
    neckL: 0.3, neckR: 0.155, neckAng: 0.62, dewlap: 0.6,
    headL: 0.42, muzK: 0.34, skullW: 0.33, skullH: 0.34, muzW: 0.185, muzH: 0.37, stop: 0.13, flews: 0.13, cheek: 1.25, headAng: -0.18, eyeK: 0.82,
    ear: { type: "drop", L: 0.36, W: 0.31, tip: 0.3, cup: 0.15, th: 0.03, out: 0.1, fwd: 0, at: 0.17 },
    tail: { type: "whip", L: 0.6, R: 0.062, bush: 1, rest: 1.4, curl: 0.15 },
    leg: { hum: 0.3, rad: 0.32, pastA: 0.3, femA: 1.25, tibA: 0.95, bone: 1.5, paw: 1.25, track: 0.13 },
    fur: { k: 0.2, len: 0.003, tufts: 0 },
    coats: {
      fawn: { pattern: "masked", base: 0xc9a173, under: 0xd3b086, back: 0xbe9466, mask: 0x1c1714, earBack: 0x231d19, eye: 0x3e2a18, earIn: 0x5a4438 },
      apricot: { pattern: "masked", base: 0xc48a52, under: 0xcf9a64, back: 0xb87c48, mask: 0x1c1714, earBack: 0x231d19, eye: 0x3e2a18, earIn: 0x5a4438 },
      brindle: { pattern: "brindle", base: 0xae8355, stripe: 0x2a1e16, under: 0xb88d5f, mask: 0x1c1714, earBack: 0x231d19, eye: 0x3e2a18, earIn: 0x5a4438, stripes: 0.5 },
    },
    coatW: { fawn: 3, apricot: 1.5, brindle: 1.5 },
    bite: 18, hp: 75,
    fight: { bold: 0.75, turn: 6, lungeT: 0.36, holdT: 2.6, shake: 0.45, tire: 1.2, opportunist: false },
  });
  // Labrador Retriever, male: 0.57-0.62 m, 29-36 kg, short-coupled, a broad
  // skull with a moderate stop, muzzle ~ skull, drop ears set well back, a
  // thick otter tail, a short dense coat: yellow, black, chocolate.
  defRow("lab", {
    kind: "dog", name: "Lab", W: 0.59, mass: 32, BL: 1.06,
    chestD: 0.5, ribW: 0.21, shW: 0.18, loinW: 0.15, croupW: 0.165, tuck: 0.07, croupH: 0.98, croupSlope: 0.28, hipD: 0.21,
    neckL: 0.36, neckR: 0.135, neckAng: 0.72,
    headL: 0.4, muzK: 0.47, skullW: 0.3, skullH: 0.31, muzW: 0.14, muzH: 0.29, stop: 0.09, flews: 0.06, cheek: 1.05, headAng: -0.3,
    ear: { type: "drop", L: 0.45, W: 0.35, tip: 0.25, cup: 0.12, th: 0.028, out: 0.1, fwd: 0, at: 0.18 },
    tail: { type: "otter", L: 0.66, R: 0.058, bush: 1, rest: 0.8, curl: 0.1 },
    leg: { bone: 1.15, paw: 1.05, track: 0.115 },
    fur: { k: 0.3, len: 0.003, tufts: 0.04, ruff: 0, pants: 0.6, tail: 0.6, back: 0, belly: 0.3, cheek: 0, elbow: 0 },
    coats: {
      yellow: { pattern: "solid", base: 0xd8b585, under: 0xe6cda5, back: 0xd0a874, earBack: 0xc89d6a, nose: 0x2a2422, eye: 0x4a2c14 },
      black: { pattern: "solid", base: 0x1b1917, under: 0x23201e, back: 0x181614, earBack: 0x171513, eye: 0x3d2410 },
      choc: { pattern: "solid", base: 0x51332a, under: 0x5b3b2a, back: 0x4a2e1f, earBack: 0x47291b, nose: 0x5a3a2e, eye: 0x7a5a2a, lip: 0x4a2e26 },
    },
    coatW: { yellow: 3, black: 3, choc: 1.5 },
    bite: 10, hp: 50,
    fight: { bold: 0.45, turn: 7, lungeT: 0.3, holdT: 1.6, shake: 0.3, tire: 1, opportunist: false },
  });
  // A mutt is two breeds crossed (dims() mixes the parents' numbers by its
  // seed) in a street coat.
  defRow("mutt", {
    kind: "dog", name: "Mutt", W: 0.53, mass: 22, mix: [["shepherd", "lab"], ["lab", "pit"], ["shepherd", "pit"], ["coyote", "lab"], ["shepherd", "mastiff"], ["pit", "mastiff"]],
    coats: {
      tanwhite: { pattern: "blaze", base: 0xb88552, under: 0xc8996a, back: 0xa8773f, white: 0xece6da, mask: 0x9a6a3e, eye: 0x4a2c14, earIn: 0x8a6a5e, chest: 1, socks: 0.7, face: 0.5 },
      piebald: { pattern: "piebald", base: 0xe8e2d6, patch: 0x2a221c, patch2: 0x8a5a32, under: 0xeee8de, eye: 0x4a2c14, earIn: 0x9a7a6e, mask: 0x2a221c },
      brindle: { pattern: "brindle", base: 0x96683e, stripe: 0x30231a, under: 0xa47548, white: 0xe6dfd2, mask: 0x3a2a1e, eye: 0x4a2c14, earIn: 0x8a6a5e, chest: 0.6, stripes: 0.5 },
      blacktan: { pattern: "points", base: 0x1f1b18, tan: 0xa66c34, under: 0x241f1b, eye: 0x3d2410, earIn: 0x5a4a44 },
      red: { pattern: "solid", base: 0xa5683c, under: 0xb87c4c, back: 0x965c33, earBack: 0x8e5530, eye: 0x6a4420 },
      tricolor: { pattern: "points", base: 0x1f1b18, tan: 0xb07a40, white: 0xece6da, under: 0x2a241f, eye: 0x3d2410, earIn: 0x5a4a44, chest: 1, socks: 0.6 },
    },
    coatW: { tanwhite: 2, piebald: 2, brindle: 1.2, blacktan: 1.2, red: 1, tricolor: 1 },
    bite: 9, hp: 40,
    fight: { bold: 0.5, turn: 8, lungeT: 0.3, holdT: 1.5, shake: 0.3, tire: 1, opportunist: true },
  });

  // ---- WILD ----------------------------------------------------------------
  // Gray wolf, male: shoulder 0.66-0.81 m (0.79), 40-45 kg, head and body
  // 1.05-1.6 m, tail 0.29-0.5 m hanging to the hocks; a deep NARROW keel chest
  // with the elbows in, long legs, big front feet (~11 x 10 cm), a broad
  // zygoma and a long muzzle; agouti grey with a dark cape, pale mask.
  defRow("gray_wolf", {
    name: "gray wolf", W: 0.79, mass: 41, BL: 1.16,
    chestD: 0.46, ribW: 0.15, shW: 0.135, loinW: 0.11, croupW: 0.125, tuck: 0.15, croupH: 0.98, croupSlope: 0.3, hipD: 0.2,
    neckL: 0.34, neckR: 0.105, neckAng: 0.56, ruff: 1.3,
    headL: 0.36, muzK: 0.5, skullW: 0.28, skullH: 0.28, muzW: 0.1, muzH: 0.22, stop: 0.045, flews: 0.02, cheek: 1.25, headAng: -0.42, eyeK: 0.9,
    ear: { type: "prick", L: 0.37, W: 0.32, tip: 0.55, cup: 0.4, th: 0.03, out: 0.25, fwd: 0.04, at: 0.15 },
    tail: { type: "brush", L: 0.6, R: 0.06, bush: 1.45, rest: 1.35, curl: 0.0 },
    leg: { hum: 0.3, rad: 0.36, mc: 0.14, fem: 0.33, tib: 0.37, mt: 0.155, toeF: 0.1, toeH: 0.094, bone: 1.0, paw: 1.35, track: 0.085 },
    fur: { k: 0.75, len: 0.0048, tufts: 1, ruff: 1.4, pants: 1.2, tail: 1.3, back: 0.8, belly: 0.7, cheek: 1, elbow: 0.6 },
    howl: true,
    coats: {
      grey: { pattern: "agouti", base: 0x8a8174, back: 0x4e4a45, cape: 0x3c3935, under: 0xd8ccb4, bib: 0xe2d8c4, band: 0xc9b28c, tip: 0x1f1c19,
        crown: 0x6f675c, cheek: 0xb4a894, mask: 0xe6ddcc, brow: 0xe0d5c0, muzzleTop: 0x8f8170, chin: 0xe4dccc,
        earBack: 0x6b5f50, earTip: 0x2b2622, earIn: 0xd9cfbf, earRim: 0x2b2622,
        tailTop: 0x5a554e, tailUnder: 0xc4b59c, tailTip: 0x1c1a18, gland: 0x2a2724, tipFrom: 0.82,
        leg: 0xb79c76, legStripe: 0x6a5a48, pants: 0xd2c5ad, paw: 0xa38c6c, eye: 0xc8901c, grizzle: 0.75 },
      tawny: { pattern: "agouti", base: 0xa08560, back: 0x6a5a48, cape: 0x56493c, under: 0xe0cfae, bib: 0xe8dcc4, band: 0xd0aa70, tip: 0x2a221b,
        crown: 0x8a7050, cheek: 0xc0a882, mask: 0xece0c8, brow: 0xe6d6b8, muzzleTop: 0xa0805a, chin: 0xe8dcc6,
        earBack: 0x8a6a48, earTip: 0x3a2e24, earIn: 0xe0d0b4, earRim: 0x3a2e24,
        tailTop: 0x75624c, tailUnder: 0xd0bc98, tailTip: 0x221c17, gland: 0x30271f, tipFrom: 0.82,
        leg: 0xc2a070, legStripe: 0x7a6248, pants: 0xdccaa6, paw: 0xb08e62, eye: 0xc8901c, grizzle: 0.65 },
      black: { pattern: "agouti", base: 0x2b2826, back: 0x1d1b1a, cape: 0x1a1817, under: 0x46413c, bib: 0x3e3a36, band: 0x5a524a, tip: 0x121110,
        crown: 0x252321, cheek: 0x33302d, mask: 0x4a4540, brow: 0x423d38, muzzleTop: 0x2a2725, chin: 0x3f3a35,
        earBack: 0x1e1c1b, earTip: 0x141312, earIn: 0x4a443e, earRim: 0x121110,
        tailTop: 0x1c1a19, tailUnder: 0x2e2b28, tailTip: 0x121110, gland: 0x121110, tipFrom: 0.85,
        leg: 0x2e2a27, legStripe: 0x1a1817, pants: 0x3c3733, paw: 0x2a2624, eye: 0xc89a2a, grizzle: 0.45 },
      pale: { pattern: "agouti", base: 0xb9b1a4, back: 0x8a837a, cape: 0x7a746c, under: 0xebe4d6, bib: 0xf0eadf, band: 0xe0d2b8, tip: 0x4a4540,
        crown: 0xa29a8e, cheek: 0xd8d0c2, mask: 0xf2ece2, brow: 0xeee6d8, muzzleTop: 0xb4a898, chin: 0xf0eadf,
        earBack: 0x9a8f80, earTip: 0x4e4740, earIn: 0xece4d6, earRim: 0x4e4740,
        tailTop: 0x8e877e, tailUnder: 0xe0d8c8, tailTip: 0x3a3532, gland: 0x5a534c, tipFrom: 0.84,
        leg: 0xd2c2a4, legStripe: 0x9a8a72, pants: 0xe6dccb, paw: 0xc6b494, eye: 0xc8901c, grizzle: 0.55 },
    },
    coatW: { grey: 5, tawny: 2.5, black: 1.6, pale: 1 },
    stats: { hp: 62, spd: 1.4, danger: 0.6, bite: 16, chase: 12.5, march: 3.4, dmg: 17, rate: 1.1,
      mass: 41, topSpeed: 16.5, accel: 7, endurance: 60, biteN: 1400, hide: 0.25 },
    fight: { bold: 0.62, turn: 7.5, lungeT: 0.32, holdT: 1.6, shake: 0.3, tire: 1.0, opportunist: false },
  });
  // Arctic wolf: the same animal cut down against the cold (Bergmann/Allen):
  // shoulder 0.64-0.79 m (0.74), ~43 kg, a SHORTER muzzle, small rounded
  // ears, shorter legs, a much fuller ruff and brush; white to cream.
  defRow("arctic_wolf", {
    name: "Arctic wolf", W: 0.74, mass: 43, BL: 1.14,
    chestD: 0.47, ribW: 0.165, shW: 0.148, loinW: 0.125, croupW: 0.138, tuck: 0.12, croupH: 0.98, croupSlope: 0.3, hipD: 0.2,
    neckL: 0.32, neckR: 0.115, neckAng: 0.58, ruff: 1.45,
    headL: 0.35, muzK: 0.44, skullW: 0.3, skullH: 0.29, muzW: 0.11, muzH: 0.24, stop: 0.055, flews: 0.02, cheek: 1.35, headAng: -0.4, eyeK: 0.88,
    ear: { type: "prick", L: 0.28, W: 0.3, tip: 0.3, cup: 0.38, th: 0.034, out: 0.28, fwd: 0.03, at: 0.15 },
    tail: { type: "brush", L: 0.57, R: 0.068, bush: 1.6, rest: 1.3, curl: 0.0 },
    leg: { hum: 0.3, rad: 0.33, mc: 0.13, fem: 0.33, tib: 0.35, mt: 0.142, toeF: 0.1, toeH: 0.094, bone: 1.08, paw: 1.4, track: 0.09 },
    fur: { k: 0.8, len: 0.005, tufts: 1.2, ruff: 1.6, pants: 1.4, tail: 1.5, back: 0.9, belly: 0.9, cheek: 1.2, elbow: 0.8 },
    howl: true,
    coats: {
      white: { pattern: "agouti", base: 0xe9e6de, back: 0xd6cfc2, cape: 0xd2cabc, under: 0xf4f2ec, bib: 0xf6f4f0, band: 0xe6ddcb, tip: 0xbdb3a4,
        crown: 0xe2ddd3, cheek: 0xeeebe4, mask: 0xf6f4f0, brow: 0xf6f4f0, muzzleTop: 0xe0dad0, chin: 0xf4f2ec,
        earBack: 0xdcd5c9, earTip: 0xc9bfb1, earIn: 0xf0ece4, earRim: 0xbfb5a7,
        tailTop: 0xddd6ca, tailUnder: 0xf0ece6, tailTip: 0xd2cabd, gland: 0xc8bdae, tipFrom: 0.88,
        leg: 0xebe6dc, pants: 0xf4f2ec, paw: 0xddd5c8, eye: 0xc89a2a, grizzle: 0.3 },
      cream: { pattern: "agouti", base: 0xe6dac4, back: 0xcdbb9c, cape: 0xc9b696, under: 0xf2ece0, bib: 0xf4efe6, band: 0xe2cfae, tip: 0xae9c80,
        crown: 0xdccdb2, cheek: 0xebe1cf, mask: 0xf4efe6, brow: 0xf4efe6, muzzleTop: 0xd8c8aa, chin: 0xf2ece0,
        earBack: 0xd4c3a4, earTip: 0xbca88a, earIn: 0xeee6d8, earRim: 0xb09e82,
        tailTop: 0xd2c1a2, tailUnder: 0xece4d4, tailTip: 0xc6b293, gland: 0xb8a586, tipFrom: 0.88,
        leg: 0xe8dcc6, pants: 0xf2ece0, paw: 0xd6c6aa, eye: 0xc89a2a, grizzle: 0.35 },
    },
    coatW: { white: 3, cream: 2 },
    stats: { hp: 66, spd: 1.4, danger: 0.6, bite: 16, chase: 12, march: 3.3, dmg: 18, rate: 1.1,
      mass: 43, topSpeed: 16, accel: 6.5, endurance: 60, biteN: 1450, hide: 0.3 },
    fight: { bold: 0.66, turn: 7.2, lungeT: 0.32, holdT: 1.7, shake: 0.32, tire: 0.95, opportunist: false },
  });
  // Coyote: shoulder 0.58-0.66 m (0.6), 9-18 kg (13), slender and long-legged,
  // a NARROW pointed muzzle, large pointed ears, a bushy black-tipped tail
  // carried LOW; grizzled grey-buff, rufous ears, muzzle and legs, a dark
  // stripe down the front of each foreleg.
  defRow("coyote", {
    name: "coyote", W: 0.6, mass: 13, BL: 1.12,
    chestD: 0.45, ribW: 0.125, shW: 0.115, loinW: 0.095, croupW: 0.105, tuck: 0.15, croupH: 0.99, croupSlope: 0.3, hipD: 0.2,
    neckL: 0.33, neckR: 0.09, neckAng: 0.58, ruff: 1.2,
    headL: 0.34, muzK: 0.53, skullW: 0.26, skullH: 0.27, muzW: 0.09, muzH: 0.21, stop: 0.04, flews: 0.015, cheek: 1.15, headAng: -0.45, eyeK: 1.0,
    ear: { type: "prick", L: 0.5, W: 0.34, tip: 0.95, cup: 0.42, th: 0.024, out: 0.22, fwd: 0.05, at: 0.14 },
    tail: { type: "brush", L: 0.6, R: 0.055, bush: 1.35, rest: 1.45, curl: 0.0 },
    leg: { hum: 0.3, rad: 0.355, mc: 0.135, fem: 0.33, tib: 0.36, mt: 0.15, bone: 0.82, paw: 0.85, track: 0.08 },
    fur: { k: 0.7, len: 0.0042, tufts: 0.8, ruff: 1.1, pants: 1, tail: 1.2, back: 0.6, belly: 0.5, cheek: 0.6, elbow: 0.4 },
    howl: true,
    coats: {
      desert: { pattern: "agouti", base: 0xa8916e, back: 0x72614e, cape: 0x625343, under: 0xe4d8c2, bib: 0xece4d4, band: 0xcaa978, tip: 0x261f19,
        crown: 0x977b58, cheek: 0xb79870, mask: 0xe8dfcf, brow: 0xddd0b8, muzzleTop: 0xae7646, muzzleSide: 0xb88458, chin: 0xece4d6,
        earBack: 0xb06c3c, earTip: 0x4a3a2c, earIn: 0xeadfcb, earRim: 0x3a2e22,
        tailTop: 0x75644f, tailUnder: 0xcab18b, tailTip: 0x1e1a16, gland: 0x2a241e, tipFrom: 0.82,
        leg: 0xbf8a58, legStripe: 0x5a4030, pants: 0xdecbaa, paw: 0xb0844e, eye: 0xc8a030, grizzle: 0.8 },
      grey: { pattern: "agouti", base: 0x9a8d7c, back: 0x5e554b, cape: 0x51493f, under: 0xe0d8c8, bib: 0xeae4d8, band: 0xc0aa88, tip: 0x221e1a,
        crown: 0x857766, cheek: 0xab9a82, mask: 0xe6ded0, brow: 0xddd2c0, muzzleTop: 0xa27650, muzzleSide: 0xae8662, chin: 0xeae4d8,
        earBack: 0xa46a40, earTip: 0x3e3228, earIn: 0xe6dccc, earRim: 0x342a22,
        tailTop: 0x645a4f, tailUnder: 0xc2b294, tailTip: 0x1c1916, gland: 0x26211c, tipFrom: 0.82,
        leg: 0xb38660, legStripe: 0x4e3a2c, pants: 0xd8c8ac, paw: 0xa47e56, eye: 0xc8a030, grizzle: 0.85 },
    },
    coatW: { desert: 3, grey: 2 },
    stats: { hp: 30, spd: 1.3, danger: 0.3, bite: 8, chase: 12.5, march: 3.2, dmg: 8, rate: 0.95,
      mass: 13, topSpeed: 18, accel: 8, endurance: 40, biteN: 600, hide: 0.2 },
    fight: { bold: 0.42, turn: 9, lungeT: 0.26, holdT: 1.0, shake: 0.3, tire: 1.1, opportunist: true },
  });
  // Red fox: shoulder 0.35-0.50 m (0.40), ~5.6 kg, long and low, a slender
  // muzzle, LARGE pointed ears with black backs, vertical-slit pupils, a brush
  // nearly as long as the body with a white tip, black stockings.
  defRow("red_fox", {
    name: "red fox", W: 0.4, mass: 5.6, BL: 1.28,
    chestD: 0.45, ribW: 0.13, shW: 0.12, loinW: 0.1, croupW: 0.11, tuck: 0.14, croupH: 0.99, croupSlope: 0.28, hipD: 0.2,
    neckL: 0.33, neckR: 0.095, neckAng: 0.62, ruff: 1.2,
    headL: 0.37, muzK: 0.55, skullW: 0.27, skullH: 0.27, muzW: 0.085, muzH: 0.19, stop: 0.04, flews: 0.012, cheek: 1.2, headAng: -0.38, eyeK: 1.1, slit: true,
    ear: { type: "prick", L: 0.57, W: 0.4, tip: 0.95, cup: 0.45, th: 0.022, out: 0.25, fwd: 0.05, at: 0.13 },
    tail: { type: "brush", L: 1.05, R: 0.075, bush: 1.55, rest: 0.9, curl: 0.35 },
    leg: { hum: 0.29, rad: 0.33, mc: 0.13, fem: 0.32, tib: 0.36, mt: 0.15, bone: 0.78, paw: 0.72, track: 0.075 },
    fur: { k: 0.72, len: 0.0035, tufts: 0.9, ruff: 1.1, pants: 1.1, tail: 1.6, back: 0.5, belly: 0.6, cheek: 0.9, elbow: 0.3 },
    coats: {
      red: { pattern: "fox", base: 0xc4651f, back: 0xb2581b, cape: 0xaa5219, under: 0xf0ebe2, bib: 0xf4f0ea, band: 0xe0954a, tip: 0x6a3110,
        crown: 0xb95c1d, cheek: 0xcf7a36, mask: 0xf4f0ea, muzzleTop: 0xb85c22, chin: 0xf4f0ea,
        earBack: 0x1c1714, earTip: 0x141210, earIn: 0xf0e6d6, earRim: 0x1a1614,
        tailTop: 0xb8591c, tailUnder: 0xcc7c3e, tailTip: 0xf2eee6, gland: 0x6a3010, tipFrom: 0.87,
        leg: 0xa95219, stocking: 0x1f1814, pants: 0xe8dfd0, paw: 0x1a1614, eye: 0xd89a20, grizzle: 0.25 },
      cross: { pattern: "fox", base: 0x9c5428, back: 0x3e2c22, cape: 0x2c2019, under: 0xb8a490, bib: 0x9a8a7a, band: 0xc0783a, tip: 0x1c1410,
        crown: 0x7e4a28, cheek: 0xa4683a, mask: 0xd8cfc2, muzzleTop: 0x5a3a26, chin: 0xcfc4b6,
        earBack: 0x161210, earTip: 0x100e0c, earIn: 0xd8ccbc, earRim: 0x141110,
        tailTop: 0x5a3a26, tailUnder: 0x8a5a36, tailTip: 0xeee8de, gland: 0x2a1c14, tipFrom: 0.88,
        leg: 0x3a2a20, stocking: 0x18120f, pants: 0x9a8a78, paw: 0x141110, eye: 0xd89a20, grizzle: 0.5 },
    },
    coatW: { red: 6, cross: 1 },
    stats: { hp: 16, spd: 1.1, danger: 0.1, bite: 4, chase: 11, march: 2.8, dmg: 4, rate: 0.85,
      mass: 5.6, topSpeed: 13.9, accel: 8, endurance: 20, biteN: 250, hide: 0.15 },
    fight: { bold: 0.22, turn: 10, lungeT: 0.22, holdT: 0.6, shake: 0.35, tire: 1.2, opportunist: true },
  });
  // battle numbers for the dogs (NPC War's "dog" unit and the city's)
  ["shepherd", "pit", "mastiff", "lab", "mutt"].forEach(function (id) {
    const R = ROWS[id];
    R.stats = { hp: R.hp, spd: 3.0, danger: 0.6, bite: R.bite, chase: id === "mastiff" ? 7.2 : 8.2, march: 4.5, dmg: R.bite * 1.35, rate: 1.23,
      mass: R.mass, topSpeed: id === "mastiff" ? 9 : (id === "pit" ? 11 : 13), accel: 7, endurance: 40, biteN: id === "mastiff" ? 1100 : (id === "pit" ? 1050 : 950), hide: 0.1 };
  });
  // NPC War's "dog": a fighting pack drawn from these, by spawn index
  const WAR_DOGS = ["pit", "shepherd", "mastiff", "mutt", "pit", "mutt"];

  function row(id) { return ROWS[id] || null; }

  // ---- a mutt: its two parents' numbers mixed by the seed, a size of its own
  const NUMK = ["W", "mass", "BL", "chestD", "ribW", "shW", "loinW", "croupW", "tuck", "croupH", "croupSlope", "hipD", "neckL", "neckR", "neckAng", "ruff",
    "headL", "muzK", "skullW", "skullH", "muzW", "muzH", "stop", "flews", "cheek", "headAng", "eyeK"];
  const _mutts = Object.create(null);
  function muttRow(R0, seed) {
    seed = (seed | 0) % 6; if (seed < 0) seed += 6;
    if (_mutts[seed]) return _mutts[seed];
    const r = mkRng(seed * 7919 + 101);
    const par = R0.mix[seed % R0.mix.length];
    const A = ROWS[par[0]], B = ROWS[par[1]];
    const f = 0.3 + r() * 0.4;
    const R = deep(A, {});
    for (let i = 0; i < NUMK.length; i++) { const k = NUMK[i]; R[k] = lerp(A[k], B[k], f); }
    ["leg", "fur"].forEach(function (g) { for (const k in A[g]) if (typeof A[g][k] === "number" && typeof B[g][k] === "number") R[g][k] = lerp(A[g][k], B[g][k], f); });
    // a street dog is a middling dog: 0.45 .. 0.62 m at the withers
    const s = (0.45 + r() * 0.17) / R.W;
    R.W *= s; R.mass *= s * s * s;
    R.ear = Object.assign({}, (r() < 0.5 ? A : B).ear);
    if (R.ear.type === "prick" && r() < 0.35) { R.ear.type = "drop"; R.ear.tip = 0.35; R.ear.th = 0.028; R.ear.cup = 0.15; }
    R.tail = Object.assign({}, (r() < 0.5 ? A : B).tail);
    R.fur = Object.assign({}, R.fur, { tufts: R.fur.tufts * 0.7 });
    R.id = "mutt"; R.kind = "dog"; R.name = "Mutt"; R.coats = R0.coats; R.coatW = R0.coatW; R.bite = R0.bite; R.hp = R0.hp;
    R.fight = R0.fight; R.stats = R0.stats; R.shapeSeed = seed; R.howl = false;
    _mutts[seed] = R;
    return R;
  }

  // ==========================================================================
  //  DIMS — the body plan in model space (nose +X, up +Y, left -Z, ground 0):
  //  every landmark, every bone's bind point, the gait's neutral feet.
  // ==========================================================================
  function dims(id, o) {
    o = o || {};
    let R = typeof id === "object" && id ? id : (ROWS[id] || ROWS.mutt);
    if (R.mix) R = muttRow(R, o.shape != null ? o.shape : 0);
    const sex = o.sex || "m";
    const linK = sex === "f" ? R.sex.lin : 1, girK = sex === "f" ? R.sex.girth : 1;
    const Wt = R.W * linK;
    const L = R.leg;
    const D = {
      row: R, id: R.id, key: R.id, sex: sex, withers: Wt, K: Wt / 0.62, mass: R.mass * linK * linK * linK * girK * girK,
      bite: R.bite || (R.stats && R.stats.bite) || 10, hp: R.hp || (R.stats && R.stats.hp) || 40, name: R.name,
    };
    const w = function (k) { return k * Wt; }, g = function (k) { return k * Wt * girK; };
    D.girth = girK;
    const skin = w(0.028);
    const BLm = w(R.BL);
    const xB = -BLm / 2, xShj = BLm / 2 - w(0.025);
    // ---- front chain: scapula top under the withers skin, down to the pads
    const padF = w(0.048) * L.paw, padH = padF * 0.95;
    const scapL = w(L.scap);
    const top = { x: xShj - scapL * sin(L.lay), y: Wt - skin };
    const shjY = top.y - scapL * cos(L.lay);
    const kf = (shjY - padF) / (w(L.hum) * sin(L.humA) + w(L.rad) + w(L.mc) * cos(L.pastA));
    const humL = w(L.hum) * kf, radL = w(L.rad) * kf, mcL = w(L.mc) * kf, toeF = w(L.toeF) * L.paw;
    const shj = { x: xShj, y: shjY };
    const elb = { x: shj.x - humL * cos(L.humA), y: shj.y - humL * sin(L.humA) };
    const wri = { x: elb.x, y: elb.y - radL };
    const mcp = { x: wri.x + mcL * sin(L.pastA), y: wri.y - mcL * cos(L.pastA) };
    const scapPiv = { x: lerp(top.x, shj.x, 0.3), y: lerp(top.y, shj.y, 0.3) };
    // ---- hind chain: hip joint under the croup, down to the pads
    const hipY = (R.croupH - R.hipD) * Wt;
    const xHip = xB + w(0.13);
    const kh = (hipY - padH) / (w(L.fem) * sin(L.femA) + w(L.tib) * sin(L.tibA) + w(L.mt) * sin(L.mtA));
    const femL = w(L.fem) * kh, tibL = w(L.tib) * kh, mtL = w(L.mt) * kh, toeH = w(L.toeH) * L.paw;
    const hip = { x: xHip, y: hipY };
    const stf = { x: hip.x + femL * cos(L.femA), y: hip.y - femL * sin(L.femA) };
    const hock = { x: stf.x - tibL * cos(L.tibA), y: stf.y - tibL * sin(L.tibA) };
    const mtp = { x: hock.x + mtL * cos(L.mtA), y: hock.y - mtL * sin(L.mtA) };
    const zF = w(L.track), zH = w(L.track) * 1.04;
    Object.assign(D, {
      skin: skin, BL: BLm, xB: xB, xShj: xShj, scapTop: top, scapPiv: scapPiv, shj: shj, elb: elb, wri: wri, mcp: mcp,
      hip: hip, stf: stf, hock: hock, mtp: mtp, padF: padF, padH: padH, toeF: toeF, toeH: toeH,
      scapL: scapL, humL: humL, radL: radL, mcL: mcL, femL: femL, tibL: tibL, mtL: mtL, zF: zF, zH: zH,
      bone: L.bone * girK,
    });
    // ---- trunk landmarks
    D.yW = Wt; D.yCroup = R.croupH * Wt; D.yBrisket = Wt * (1 - R.chestD);
    D.yBelly = D.yBrisket + w(R.tuck);
    D.xIl = xHip + w(0.13); D.xLR = xB + 0.43 * BLm; D.xWith = top.x;
    D.ribW = g(R.ribW); D.shW = g(R.shW); D.loinW = g(R.loinW); D.croupW = g(R.croupW);
    // bones of the trunk: pelvis at the lumbosacral joint, chest mid-thorax
    D.pelv = { x: D.xIl + w(0.03), y: lerp(hipY, D.yCroup, 0.55) };
    D.chest = { x: lerp(D.xLR, elb.x, 0.6), y: lerp(D.yBrisket, Wt, 0.58) };
    D.loin = { x: (D.pelv.x + D.chest.x) / 2, y: (D.pelv.y + D.chest.y) / 2 };
    D.hipH = hipY; D.sh = shjY; D.hipX = hip.x; D.shX = shj.x;   // the old names some hosts read
    // ---- neck and head
    D.neckB = { x: top.x + w(0.06), y: Wt - w(0.13) };
    const nL = w(R.neckL);
    D.headP = { x: D.neckB.x + cos(R.neckAng) * nL, y: D.neckB.y + sin(R.neckAng) * nL };
    D.neckMid = { x: lerp(D.neckB.x, D.headP.x, 0.5), y: lerp(D.neckB.y, D.headP.y, 0.5) };
    D.neckR = g(R.neckR); D.neckLen = nL; D.neckAng = R.neckAng;
    D.hl = w(R.headL); D.headAng = R.headAng;
    // the coat's clump width for the fur shader (hair lies in locks ~3x a tuft's scale)
    D.clump = R.fur.clump || R.fur.len * 3.2;
    // the head sweep runs u = -0.075 .. 1.0 head lengths: t of the stop / eyes
    D.stopT = (1 - R.muzK + 0.075) / 1.075;
    D.eyeA = 0.95; D.eyeR = 0.055 * D.hl * (R.eyeK || 1);
    D.u = { x: cos(R.headAng), y: sin(R.headAng) };       // head axis
    D.n = { x: -sin(R.headAng), y: cos(R.headAng) };      // head "up"
    // head-space (u along the axis from the occiput, v up) -> model space
    D.hs = function (u, v) { return { x: D.headP.x + D.u.x * u + D.n.x * v, y: D.headP.y + D.u.y * u + D.n.y * v }; };
    const hl = D.hl;
    D.jawP = D.hs(0.34 * hl, -0.085 * hl);
    D.mouthH = { u: 0.985 * hl, v: -0.075 * hl };        // between the incisors, head space
    const mo = D.hs(D.mouthH.u, D.mouthH.v);
    D.mouth = { x: mo.x, y: mo.y, z: 0 };
    D.earP = { u: R.ear.at * hl, v: 0.27 * hl * (R.skullH / 0.3) };
    const ep = D.hs(D.earP.u, D.earP.v);
    D.earPm = { x: ep.x, y: ep.y, z: R.skullW * hl * 0.55 };
    // ---- tail: set at the end of the croup, hangs at its rest carriage
    D.tailP = { x: xB + w(0.02), y: D.yCroup - w(0.075) };
    D.tailL = w(R.tail.L) * (R.tail.type === "brush" ? 1 : 1);
    D.tailR = w(R.tail.R);
    D.hackleP = { x: top.x - w(0.03), y: Wt - skin * 0.5 };
    D.collarP = { x: lerp(D.neckB.x, D.headP.x, 0.72), y: lerp(D.neckB.y, D.headP.y, 0.72) };
    // ---- the gait's neutral foot spots (paw centre of pressure)
    D.feet = [
      { x: mcp.x + toeF * 0.42, z: -zF, front: true }, { x: mcp.x + toeF * 0.42, z: zF, front: true },
      { x: mtp.x + toeH * 0.42, z: -zH, front: false }, { x: mtp.x + toeH * 0.42, z: zH, front: false },
    ];
    D.legLen = hipY;
    D.FJ = { x: shj.x, y: shj.y }; D.HJ = { x: hip.x, y: hip.y };
    D.legZf = zF; D.legZh = zH;
    D.pawR = padF * 0.5;
    D.table = table(D);
    return D;
  }

  // ==========================================================================
  //  THE FOOTFALL TABLE (Hildebrand; canid trackways). Feet FL FR HL HR:
  //  lateral-sequence walk, diagonal trot, three-beat lope, ROTARY gallop
  //  (LF RF RH LH) with its two suspensions. Transitions at the Froude
  //  numbers dogs change gait at (walk-trot ~0.45, trot-lope ~2.4, lope-gallop
  //  ~3.8, Fr = v^2 / g h with h the hip height); cadence from the same
  //  dimensionless curve (Heglund & Taylor 1988: f = 4.48 M^-0.14 Hz at the
  //  trot-gallop transition, ~2.8 Hz for 30 kg), so a fox steps faster and a
  //  mastiff slower at the same speed.
  // ==========================================================================
  // CBZ.quadGait puts a foot in stance while frac(phase + off) < duty, so a
  // foot touches down at phase = -off: each row below is the NEGATED
  // touchdown phase of FL FR HL HR.
  //   walk    HL .00  FL .25  HR .50  FR .75   lateral sequence
  //   trot    HL+FR .00, HR+FL .50             diagonal pairs
  //   lope    HL .00, HR+FL .22, FR .42        three beats, right lead
  //   gallop  HL .00, HR .10, FR .42, FL .52   rotary: gathered flight after
  //           FL lifts, extended flight after HR lifts
  const GAITS = [
    { name: "walk", key: "wW", off: [0.75, 0.25, 0.00, 0.50], duty: 0.66, lift: 0.045 },
    { name: "trot", key: "wT", off: [0.50, 0.00, 0.00, 0.50], duty: 0.44, lift: 0.07 },
    { name: "lope", key: "wC", off: [0.78, 0.58, 0.00, 0.78], duty: 0.36, lift: 0.09 },
    { name: "gallop", key: "wG", off: [0.48, 0.58, 0.00, 0.90], duty: 0.22, lift: 0.11 },
  ];
  const _tables = Object.create(null);
  function table(D) {
    const h = D.legLen, k = sqrt(D.K);
    const key = h.toFixed(4) + "|" + k.toFixed(4);
    if (_tables[key]) return _tables[key];
    const vF = function (Fr) { return sqrt(Fr * G0 * h) / k; };
    const w0 = sqrt(G0 / h);
    const T = {
      gaits: GAITS,
      trans: [[vF(0.32), vF(0.55)], [vF(2.1), vF(2.7)], [vF(3.4), vF(4.3)]],
      fOf: function (v) {
        const Fr = v * v / (G0 * h);
        const f = Fr < 2.6 ? 0.48 * Math.pow(Math.max(Fr, 0.02), 0.3) : 0.61 * Math.pow(Fr / 2.6, 0.08);
        return Math.max(0.16, f) * w0;
      },
      fMax: 4 * w0, f0: 0.3 * w0, fV: 0.3, strideMax: 1.35,
      vMove: 0.06, turnMove: 0.35, turnF: 0.32 * w0,
      settleRate: 2.8, restLift: 0.04, restStep: 0.06,
      h: h,
    };
    _tables[key] = T;
    return T;
  }
  const TABLE = { gaits: GAITS };

  // ==========================================================================
  //  NPC WAR: stats, the possessed dog's move set, the close fight
  // ==========================================================================
  function stats(id) {
    const R = ROWS[id === "dog" ? "pit" : id] || ROWS.gray_wolf;
    const S = R.stats;
    return {
      hp: S.hp, spd: S.spd, danger: S.danger, bite: S.bite, scale: 1,
      chase: S.chase, march: S.march, dmg: S.dmg, rate: S.rate,
      brave: false, prey: false,
      mass: S.mass, topSpeed: S.topSpeed, accel: S.accel, endurance: S.endurance,
      biteN: S.biteN, hide: S.hide,
    };
  }
  function massOf(t) {
    if (!t) return 78;
    if (t._cnMass) return t._cnMass;
    let ms = 78;
    if (t.vehicle) ms = 9000;
    else if (CBZ.bodyMass) { try { const v = CBZ.bodyMass(t); if (v > 0 && isFinite(v)) ms = v; } catch (e) {} }
    else if (t.beast && t.species && t.species.mass) ms = t.species.mass;
    t._cnMass = ms;
    return ms;
  }
  // which way the quarry faces: beasts (cos h, sin h); men by yaw (sin, cos)
  const _tf = { x: 1, z: 0 };
  function facing(t) {
    if (t.beast || t.vehicle || t.animal) { const h = typeof t.heading === "number" ? t.heading : 0; _tf.x = cos(h); _tf.z = sin(h); }
    else { const y = typeof t.yaw === "number" ? t.yaw : 0; _tf.x = sin(y); _tf.z = cos(y); }
    return _tf;
  }
  function downed(t) {
    if (!t || t.beast || t.vehicle || t.animal) return false;
    if (t.ko > 0) return true;
    const ch = t.char;
    return !!(ch && (ch.koPose || (ch.fall && ch.fall.on)));
  }
  // the height of what is being bitten, metres above the quarry's feet
  function biteHeight(t, loc) {
    if (!t.beast && !t.animal) {
      if (downed(t)) return 0.22;
      return loc === "arm" ? 1.12 : loc === "throat" ? 1.42 : 0.5;
    }
    const H = Math.max(0.3, (t.eyeH || 1) / 0.8);
    return loc === "hock" ? H * 0.28 : loc === "nose" ? H * 0.72 : loc === "throat" ? H * 0.62 : loc === "rump" ? H * 0.6 : H * 0.5;
  }
  // THE PACK ON ONE QUARRY: slots in arrival order, the biggest takes the lead
  const PK = { slot: 0, n: 1, holders: 0 };
  function packOn(t, m) {
    let L = t._cnPack;
    if (!L) L = t._cnPack = [];
    for (let i = L.length - 1; i >= 0; i--) {
      const o = L[i];
      if (o === m) continue;
      if (o.dead || o.fled || o.tgt !== t || abs(o.pos.x - t.pos.x) + abs(o.pos.z - t.pos.z) > 14) L.splice(i, 1);
    }
    let me = L.indexOf(m);
    if (me < 0) {
      const mm = m._cn ? m._cn.mass : 40;
      if (L.length && L[0]._cn && mm > L[0]._cn.mass * 1.08) { L.unshift(m); me = 0; }
      else { L.push(m); me = L.length - 1; }
    }
    let holders = 0;
    for (let i = 0; i < L.length; i++) if (L[i]._cf && L[i]._cf.ph === "hold") holders++;
    PK.slot = me; PK.n = L.length; PK.holders = holders;
    return PK;
  }
  const RES = { inRange: false, dealt: 0, missed: false };
  function newFight(m) {
    return { ph: "close", pt: 0, cd: 0.2 + ((m.i || 0) % 5) * 0.12, stam: 1, side: ((m.i || 0) & 1) ? 1 : -1,
      loc: "flank", lungeT: 0.3, holdT: 0, yRaise: 0, biteY: 0.5, snapDone: false, feint: false,
      hitFlash: 0, kdT: 0, lastRel: 0, dartOk: false, grip: null };
  }
  function moveBy(m, o, dx, dz, step) {
    if (!(step > 0)) return;
    if (o && typeof o.move === "function") {
      const t0 = m.tgt; m.tgt = null;
      try { o.move(m, dx, dz, step); } catch (e) {}
      m.tgt = t0;
    } else { m.pos.x += dx * step; m.pos.z += dz * step; }
  }
  function turnTo(m, want, rate, dt) {
    let h = typeof m.heading === "number" ? m.heading : 0;
    const d = wrapPi(want - h), mx = rate * dt;
    h += d > mx ? mx : (d < -mx ? -mx : d);
    m.heading = h;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h);
    else if (m.group) m.group.rotation.y = -h;
    return d;
  }
  function rowOfUnit(m) { const cn = m._cn || (m.group && m.group.userData.canid); return cn ? cn.rig.D.row : ROWS.gray_wolf; }

  // the possessed canid: MOVE and ATTACK; the attack is chosen by the moment
  const CMOVES = {
    leap: { id: "leap", style: "maul", pow: 1.2, dur: 0.42, rng: 1.1, leap: 0.9, cd: 0.8 },
    snap: { id: "snap", style: "bite", pow: 0.85, dur: 0.26, rng: 1.0, cd: 0.35 },
    slash: { id: "slash", style: "bite", pow: 1.0, dur: 0.34, rng: 1.0, cd: 0.5 },
    hamstring: { id: "hamstring", style: "bite", pow: 1.3, dur: 0.34, rng: 1.05, cd: 0.6 },
    arm: { id: "arm", style: "maul", pow: 1.1, dur: 0.46, rng: 1.1, leap: 0.4, cd: 0.7 },
    grab: { id: "grab", style: "maul", pow: 1.6, dur: 0.95, rng: 1.0, cd: 0.8, hold: true },
    throat: { id: "throat", style: "maul", pow: 2.1, dur: 1.1, rng: 1.05, cd: 0.9, hold: true },
  };
  function moves(m, t, ctx) {
    ctx = ctx || {};
    const cn = m._cn, n = ctx.n || 1;
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2;
    if (!t) return n % 2 ? CMOVES.snap : CMOVES.slash;
    if (ctx.downed) return CMOVES.throat;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    if (dist > reach * 1.05 && running && dist < reach * 2.8) return CMOVES.leap;
    const tf = facing(t), dx = m.pos.x - t.pos.x, dz = m.pos.z - t.pos.z, dl = hypot(dx, dz) || 1;
    const behind = (dx * tf.x + dz * tf.z) / dl < -0.3;
    const big = massOf(t) > (cn ? cn.mass : 40) * 2.5;
    if (behind && t.beast) return CMOVES.hamstring;
    if (!t.beast && !t.vehicle && cn && cn.withers > 0.55 && n % 3 === 1) return CMOVES.arm;
    if (!big && n % 3 === 0) return CMOVES.grab;
    return n % 2 ? CMOVES.slash : CMOVES.snap;
  }
  // a landed bite in the fight: the wound through the seam, the grip kept
  function landBite(m, t, cf, sev, hold) {
    const cn = m._cn;
    if (!cn || t.dummy) return;
    const c = bite(m, cn.rig, t, { loc: cf.loc, sev: sev, hold: hold });
    cf.grip = hold && c ? c : null;
    if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, t, "maul"); } catch (e) {} }
  }
  // play ONE chosen move on the latched clock (_atkAnim 0..1), then hand back
  function playerStrike(m, t, dt, o, cn) {
    const P = cn.rig.D.row, B = P.fight, mv = o.youMove;
    const cf = m._cf || (m._cf = newFight(m));
    const dur = mv.dur > 0 ? mv.dur : B.lungeT * 1.2;
    if (!(m._atkAnim >= 0)) { RES.inRange = true; return RES; }
    if (m._atkAnim === 0) {
      cf.snapDone = false; cf.feint = false; cf.lastTick = -1; cf.gripped = false; cf.grip = null;
      // a leap at the quarry: how far it must fly (its arc is drawn by the pose)
      cf.leapD = mv.leap > 0.5 && t && t.pos ? Math.max(0, hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) - (m.rad || 0.5) - (t.rad || 0.45)) : 0;
      cf.loc = mv.id === "hamstring" ? "hock" : mv.id === "arm" ? "arm" : mv.id === "throat" ? "throat" : (t && !t.beast ? "leg" : "flank");
      cf.biteY = t && t.pos ? biteHeight(t, cf.loc) : 0.5;
    }
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = hypot(dx, dz) || 1e-4;
    turnTo(m, atan2(dz, dx), B.turn * 1.5, dt);
    const k0 = m._atkAnim, k = Math.min(1, k0 + dt / dur);
    m._atkAnim = k;
    cf.lungeT = mv.hold ? Math.min(0.32, dur * 0.35) : dur;
    cf.pt = k * dur;
    cf.ph = mv.hold && cf.pt > cf.lungeT ? "hold" : "lunge";
    const snapAt = mv.hold ? (cf.lungeT * 0.62) / dur : 0.62;
    if (k0 < snapAt && k >= snapAt) {
      const tR = t.rad || 0.45;
      const mw = mouthWorld(cn.rig, _mw);
      const jd = hypot(t.pos.x - mw.x, t.pos.z - mw.z);
      if (jd <= (tR + 0.12 + 0.06 * cn.K) * (mv.rng || 1)) {
        const tf = facing(t), frontK = -(dx * tf.x + dz * tf.z) / d;
        const angMul = frontK < -0.4 ? 1.25 : frontK > 0.5 ? 0.85 : 1;
        const dmg = (o.dmg || P.stats.dmg) * (mv.hold ? 0.6 : (mv.pow || 1)) * angMul;
        if (typeof o.onHit === "function") o.onHit(dmg);
        landBite(m, t, cf, mv.hold ? 0.75 : 0.6 * (mv.pow || 1), !!mv.hold);
        RES.dealt = dmg; cf.gripped = !!mv.hold;
      } else { RES.missed = true; cf.gripped = false; }
    }
    if (mv.hold && cf.gripped && k > snapAt) {
      holdOn(m, t, cf, o, dt, cn);
      const tick = Math.floor((k - snapAt) * dur / 0.3);
      if (tick !== cf.lastTick) {
        cf.lastTick = tick;
        if (tick > 0) {
          const dmg = (o.dmg || P.stats.dmg) * (mv.pow || 1) * B.shake;
          if (typeof o.onHit === "function") o.onHit(dmg);
          RES.dealt = dmg;
        }
      }
    }
    RES.inRange = true;
    if (k >= 1) { m._atkAnim = -1; cf.ph = "close"; cf.pt = 0; cf.gripped = false; cf.grip = null; }
    return RES;
  }
  // HANGING ON: the jaw stays on the bitten point (the grip's node-local spot,
  // carried by the quarry as it moves); the body is pulled after it
  const _gp = { x: 0, y: 0, z: 0 }, _mw = { x: 0, y: 0, z: 0 };
  function holdOn(m, t, cf, o, dt, cn) {
    const P = cn.rig.D.row;
    const gp = gripPoint(cf.grip, _gp);
    if (!gp) {
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = hypot(dx, dz) || 1e-4;
      const dC = (m.rad || 0.5) + (t.rad || 0.45) + 0.04;
      if (d > dC + 0.05) moveBy(m, o, dx / d, dz / d, Math.min(d - dC, P.stats.chase * dt));
      return;
    }
    cn.mouthTo = gp;
    // where the body must stand for its mouth to be on the grip
    const mw = cn.rig.mouthW;
    if (mw) {
      const ox = mw.x - m.pos.x, oz = mw.z - m.pos.z;
      const ex = gp.x - ox - m.pos.x, ez = gp.z - oz - m.pos.z, el = hypot(ex, ez);
      if (el > 0.01) moveBy(m, o, ex / el, ez / el, Math.min(el, P.stats.chase * 1.2 * dt));
    }
    turnTo(m, atan2(gp.z - m.pos.z, gp.x - m.pos.x), (P.fight.turn || 7) * 2, dt);
  }

  function fight(m, t, dt, o) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    if (!m || !t || !m.pos || !t.pos || !(dt > 0)) return RES;
    const cn = m._cn;
    if (!cn) return CBZ.creatureFight ? CBZ.creatureFight(m, t, dt, o) : RES;
    const P = cn.rig.D.row, B = P.fight;
    o = o || {};
    if (o.youMove) return playerStrike(m, t, dt, o, cn);
    const cf = m._cf || (m._cf = newFight(m));
    if (t.dead || t.fled) { cf.ph = "close"; cf.grip = null; return RES; }
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const d = hypot(dx, dz) || 1e-4, ux = dx / d, uz = dz / d;
    const myR = m.rad || 0.5, tR = t.rad || 0.45;
    const dC = myR + tR + 0.04;
    const rEng = dC + 0.45 + 0.25 * cn.K;
    const tf = facing(t);
    const rel = atan2(tf.z * ux - tf.x * uz, -(ux * tf.x + uz * tf.z));
    const frontK = cos(rel);
    const pk = packOn(t, m);
    const tM = massOf(t), ratio = tM / cn.mass;
    const armed = !t.beast && !t.vehicle && !!t.armed && !t.fists;
    const tSp = t.beast && t.species ? t.species : null;
    const tHurt = t.maxHp ? t.hp / t.maxHp : 1;
    const meHurt = m.maxHp ? m.hp / m.maxHp : 1;
    let danger = t.vehicle ? 1 : tSp ? clamp((tSp.danger || 0) * 1.1 + (ratio > 3 ? 0.25 : 0) + (ratio > 8 ? 0.2 : 0), 0, 1) : (armed ? 0.55 : 0.3);
    if (downed(t)) danger *= 0.3;
    let courage = B.bold + 0.16 * Math.min(4, pk.n - 1) - danger * 0.55 * Math.min(1, ratio / 2.5)
      + (tHurt < 0.5 ? 0.25 : 0) - (meHurt < 0.5 ? 0.3 : 0) + (downed(t) ? 0.4 : 0);
    if (B.opportunist && ratio > 2 && pk.n < 3) courage -= 0.35;
    RES.inRange = d < rEng + 0.6;
    cf.pt += dt;
    if (cf.cd > 0) cf.cd -= dt;
    if (cf.hitFlash > 0) cf.hitFlash -= dt;
    if (cf.kdT > 0) cf.kdT -= dt;
    cn.mouthTo = null;
    // a VEHICLE: canids do not bite steel. Hold off, watch it, give way.
    if (t.vehicle) {
      cf.ph = "threat";
      turnTo(m, atan2(dz, dx), B.turn, dt);
      if (d < 9) moveBy(m, o, -ux, -uz, Math.min(9 - d, P.stats.chase * 0.5 * dt));
      cf.stam = Math.min(1, cf.stam + dt * 0.1);
      return RES;
    }
    // where to bite, decided by what the quarry is
    let desRel, loc, hold;
    const small = ratio < 1.25, man = !t.beast;
    if (man) {
      if (downed(t)) { desRel = rel; loc = "throat"; hold = true; }
      else if (armed && pk.n < 3 && frontK > 0.2) { desRel = cf.side * (1.95 + (pk.slot % 3) * 0.35); loc = "leg"; hold = ratio < 2.2; }
      else { desRel = pk.slot === 0 ? rel : cf.side * (1.5 + (pk.slot % 3) * 0.45); loc = pk.slot === 0 && cn.mass > 25 ? "arm" : "leg"; hold = ratio < 2.2; }
    } else if (small) {
      desRel = rel; loc = "throat"; hold = true;
    } else if (pk.slot === 0 && tHurt < 0.45 && pk.n >= 2 && danger < 0.8) {
      desRel = 0.4 * cf.side; loc = "nose"; hold = true;
    } else {
      desRel = cf.side * (2.45 + (pk.slot % 3) * 0.22); loc = (pk.slot % 2) ? "rump" : "hock";
      hold = (danger < 0.5 || pk.n >= 4) && ratio < 14 && tHurt < 0.85;
    }
    if (loc === "arm" && cn.withers < 0.5) loc = "leg";
    if (cf.ph !== "hold") cf.loc = loc;
    const want = atan2(dz, dx);
    switch (cf.ph) {
      case "lunge": {
        turnTo(m, want, B.turn * 1.4, dt);
        const k = cf.pt / cf.lungeT;
        // gather (0..0.3), the spring (0.3..0.62) closes the gap, the snap
        if (k > 0.25 && k < 0.66 && !cf.feint) {
          const room = d - dC;
          if (room > 0) moveBy(m, o, ux, uz, Math.min(room, P.stats.chase * 1.05 * dt));
        } else if (cf.feint && k > 0.25 && k < 0.45 && d > dC + 0.3) moveBy(m, o, ux, uz, P.stats.chase * 0.6 * dt);
        if (!cf.snapDone && k >= 0.62) {
          cf.snapDone = true;
          if (cf.feint) { RES.missed = true; }
          else {
            // THE TEETH: where the posed jaw actually is when it closes
            const mw = mouthWorld(cn.rig, _mw);
            const jd = hypot(t.pos.x - mw.x, t.pos.z - mw.z);
            if (jd <= tR + 0.12 + 0.06 * cn.K) {
              let dmg = (typeof o.dmg === "number" ? o.dmg : P.stats.dmg) * (0.85 + 0.3 * cn.rng());
              const angMul = frontK < -0.4 ? 1.25 : frontK > 0.5 ? 0.8 : 1.0;
              const locMul = loc === "throat" ? 1.6 : loc === "hock" ? 1.15 : loc === "nose" ? 1.1 : 1.0;
              dmg *= angMul * locMul;
              if (typeof o.onHit === "function") o.onHit(dmg);
              else { t.hp -= dmg; }
              const willHold = hold && !t.dead && courage > 0.15;
              landBite(m, t, cf, clamp(0.45 + 0.25 * locMul * angMul, 0, 1), willHold);
              RES.dealt = dmg;
              cf.hitFlash = 0.3;
              cf.stam = Math.max(0, cf.stam - 0.1 * B.tire);
              if (willHold) { cf.ph = "hold"; cf.pt = 0; cf.holdT = B.holdT * (0.7 + 0.6 * cn.rng()); }
            } else { RES.missed = true; cf.cd = 0.25; }
          }
        }
        if (cf.ph === "lunge" && k >= 1) {
          cf.ph = (danger > 0.45 && !downed(t)) || cf.feint || courage < 0.3 ? "retreat" : "close";
          cf.pt = 0;
          cf.cd = (typeof o.rate === "number" ? o.rate : P.stats.rate) * (0.75 + 0.5 * cn.rng());
        }
        break;
      }
      case "hold": {
        holdOn(m, t, cf, o, dt, cn);
        cf.stam = Math.max(0, cf.stam - dt * 0.16 * B.tire);
        const tick = Math.floor(cf.pt / 0.45);
        if (tick !== cf.lastTick) {
          cf.lastTick = tick;
          if (tick > 0) {
            const dmg = (typeof o.dmg === "number" ? o.dmg : P.stats.dmg) * B.shake * (cf.loc === "throat" ? 1.7 : 1);
            if (typeof o.onHit === "function") o.onHit(dmg); else t.hp -= dmg;
            RES.dealt = dmg;
            // TWO ON A MAN TAKE HIM DOWN; a big wolf alone sometimes does
            if (man && !downed(t) && cf.kdT <= 0 && CBZ.verbs && CBZ.verbs.knockdown) {
              const pull = pk.holders >= 2 ? 0.55 : (cn.mass > 35 && cf.loc === "leg" ? 0.12 : 0);
              if (pull > 0 && cn.rng() < pull) {
                cf.kdT = 4;
                try { CBZ.verbs.knockdown(t, { dir: { x: ux, z: uz }, power: 0.7, dur: 2.4 }); } catch (e) {}
              }
            }
          }
        }
        const swatted = !man && danger > 0.55 && frontK > 0.6 && !downed(t);
        if (cf.pt > cf.holdT || cf.stam < 0.15 || swatted || t.dead) {
          cf.ph = "retreat"; cf.pt = 0; cf.grip = null;
          cf.cd = (typeof o.rate === "number" ? o.rate : P.stats.rate) * 0.8;
        }
        break;
      }
      case "retreat": {
        turnTo(m, want, B.turn, dt);
        const dur = 0.45 + 0.35 * danger + (cf.stam < 0.3 ? 0.8 : 0);
        const out = rEng + 0.5 + danger * 0.9 + (cf.stam < 0.3 ? 1.5 : 0);
        if (d < out) {
          const lat = cf.side * 0.45;
          const ax = -ux - uz * lat, az = -uz + ux * lat, al = hypot(ax, az) || 1;
          moveBy(m, o, ax / al, az / al, Math.min(out - d, P.stats.chase * 0.55 * dt));
        }
        cf.stam = Math.min(1, cf.stam + dt * 0.06);
        if (cf.pt > dur) { cf.ph = "close"; cf.pt = 0; if (cn.rng() < 0.35) cf.side = -cf.side; }
        break;
      }
      case "threat": {
        turnTo(m, want, B.turn, dt);
        const hold2 = rEng + 0.9 + danger * 0.8;
        if (d < hold2 - 0.3) moveBy(m, o, -ux, -uz, Math.min(hold2 - d, P.stats.march * 0.9 * dt));
        else if (d > hold2 + 0.6) moveBy(m, o, ux, uz, Math.min(d - hold2, P.stats.march * dt));
        cf.stam = Math.min(1, cf.stam + dt * 0.12);
        if (cf.cd <= 0) {
          if ((frontK < -0.2 && courage > 0.05) || courage > 0.45 || (tHurt < 0.35 && courage > 0)) { cf.ph = "close"; cf.pt = 0; }
          else if (cn.rng() < 0.5) { cf.ph = "lunge"; cf.feint = true; cf.snapDone = false; cf.pt = 0; cf.lungeT = B.lungeT * 0.8; cf.cd = 1.2; }
          else cf.cd = 0.6 + cn.rng() * 0.6;
        }
        break;
      }
      default: {   // close in on the slot of the testing ring
        if (courage < 0.2 && !downed(t)) { cf.ph = "threat"; cf.pt = 0; cf.cd = 0.4; break; }
        if (cf.stam < 0.25) { cf.ph = "retreat"; cf.pt = 0; break; }
        cf.stam = Math.min(1, cf.stam + dt * 0.08);
        const diff = wrapPi(desRel - rel);
        const onSlot = abs(diff) < 0.45 || (pk.slot === 0 && (small || man));
        const turned = frontK < 0.1;
        if (d <= rEng + 0.35 && cf.cd <= 0 && (onSlot || turned || downed(t) || (frontK > 0.4 && courage > 0.7))) {
          cf.ph = "lunge"; cf.pt = 0; cf.feint = false; cf.snapDone = false;
          cf.lungeT = B.lungeT * (loc === "arm" ? 1.25 : 1);
          cf.biteY = biteHeight(t, loc);
          break;
        }
        const step = clamp(diff, -1, 1) * Math.min(1, (P.stats.chase * 0.6 * dt) / Math.max(0.5, d));
        const a = rel + step;
        const ca = cos(a), sa = sin(a);
        const wx = tf.x * ca - tf.z * sa, wz = tf.x * sa + tf.z * ca;
        const r = onSlot ? Math.max(dC, rEng - 0.1) : rEng + 0.25;
        const gx = t.pos.x + wx * r, gz = t.pos.z + wz * r;
        const mx = gx - m.pos.x, mz = gz - m.pos.z, md = hypot(mx, mz);
        const spd = (md > 2 ? P.stats.chase * 0.8 : P.stats.chase * 0.5) * (armed && frontK > 0.3 ? 1.15 : 1);
        if (md > 0.04) {
          let nx = mx / md, nz = mz / md;
          if (armed && frontK > 0.3) { const wv = sin(cf.pt * 7 + (m.i || 0)) * 0.5; nx += -nz * wv; nz += nx * wv; const nl = hypot(nx, nz) || 1; nx /= nl; nz /= nl; }
          moveBy(m, o, nx, nz, Math.min(md, spd * dt));
          turnTo(m, md > 0.6 && d > rEng ? atan2(nz, nx) : want, B.turn, dt);
        } else turnTo(m, want, B.turn, dt);
        cf.biteY = biteHeight(t, loc);
      }
    }
    cf.lastRel = rel;
    return RES;
  }

  function hooks(id) {
    return {
      build: function (ctx) { return build(id, ctx); },
      animate: function (m, dt) { return animate(m, dt); },
      fight: function (m, t, dt, o) { return fight(m, t, dt, o); },
      moves: function (m, t, ctx) { return moves(m, t, ctx); },
    };
  }
  function define(id, P) { if (P && ROWS[id]) Object.assign(ROWS[id], P); return ROWS[id]; }
  function def(id) { return ROWS[id] || null; }

  const API = {
    ROWS: ROWS, row: row, dims: dims, table: table, TABLE: TABLE, GAITS: GAITS, stats: stats, hooks: hooks, define: define, def: def,
    fight: fight, moves: moves, MOVES: CMOVES, WAR_DOGS: WAR_DOGS, _mixHex: mixHex,
    build: function (id, ctx) { return build(id, ctx); }, animate: function (m, dt) { return animate(m, dt); },
  };
  CBZ.canid = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  // ==========================================================================
  //  BUILD — everything below needs THREE, CBZ.loftKit (sweep) and
  //  CBZ.quadGait, read when a body is built (all loaded before any spawn)
  // ==========================================================================
  function kitReady() { return !!(W.THREE && CBZ.loftKit && CBZ.loftKit.sweep && CBZ.quadGait); }

  // ---- THE SKELETON ---------------------------------------------------------
  const BN = { root: 0, pelvis: 1, loin: 2, chest: 3, ribs: 4, hackle: 5, neck: 6, neck1: 7, head: 8, jaw: 9, tongue: 10, earL: 11, earR: 12, collar: 13,
    tail0: 14, tail1: 15, tail2: 16, tail3: 17, tail4: 18 };
  BN.neck0 = BN.neck;
  const LEGB = [[19, 20, 21, 22, 23], [24, 25, 26, 27, 28], [29, 30, 31, 32], [33, 34, 35, 36]];
  const NB = 37;
  const PARENT = new Array(NB).fill(0);
  PARENT[0] = -1; PARENT[BN.pelvis] = 0; PARENT[BN.loin] = 0; PARENT[BN.chest] = 0; PARENT[BN.ribs] = BN.chest; PARENT[BN.hackle] = BN.chest;
  PARENT[BN.neck] = BN.chest; PARENT[BN.neck1] = BN.neck; PARENT[BN.head] = BN.neck1; PARENT[BN.jaw] = BN.head; PARENT[BN.tongue] = BN.jaw;
  PARENT[BN.earL] = BN.head; PARENT[BN.earR] = BN.head; PARENT[BN.collar] = BN.neck1;
  PARENT[BN.tail0] = BN.pelvis; for (let i = 1; i < 5; i++) PARENT[BN.tail0 + i] = BN.tail0 + i - 1;
  for (let L = 0; L < 4; L++) {
    const ids = LEGB[L], front = L < 2;
    PARENT[ids[0]] = front ? BN.chest : BN.pelvis;
    for (let k = 1; k < ids.length; k++) PARENT[ids[k]] = ids[k - 1];
  }
  // bind points (model space) and each leg segment's bind direction
  function bindPoints(D) {
    const P = new Array(NB);
    P[0] = [0, 0, 0];
    P[BN.pelvis] = [D.pelv.x, D.pelv.y, 0];
    P[BN.loin] = [D.loin.x, D.loin.y, 0];
    P[BN.chest] = [D.chest.x, D.chest.y, 0];
    P[BN.ribs] = [D.chest.x, D.chest.y, 0];
    P[BN.hackle] = [D.hackleP.x, D.hackleP.y, 0];
    P[BN.neck] = [D.neckB.x, D.neckB.y, 0];
    P[BN.neck1] = [D.neckMid.x, D.neckMid.y, 0];
    P[BN.head] = [D.headP.x, D.headP.y, 0];
    P[BN.jaw] = [D.jawP.x, D.jawP.y, 0];
    const tg = D.hs(0.5 * D.hl, -0.09 * D.hl);
    P[BN.tongue] = [tg.x, tg.y, 0];
    P[BN.earL] = [D.earPm.x, D.earPm.y, -D.earPm.z];
    P[BN.earR] = [D.earPm.x, D.earPm.y, D.earPm.z];
    P[BN.collar] = [D.collarP.x, D.collarP.y, 0];
    const tr = D.tailRest;
    for (let i = 0; i < 5; i++) {
      const s = D.tailS[i];
      P[BN.tail0 + i] = [D.tailPath(s).x, D.tailPath(s).y, 0];
    }
    void tr;
    for (let L = 0; L < 4; L++) {
      const ids = LEGB[L], front = L < 2, z = (L % 2 === 0 ? -1 : 1) * (front ? D.zF : D.zH);
      if (front) {
        P[ids[0]] = [D.scapPiv.x, D.scapPiv.y, z];
        P[ids[1]] = [D.shj.x, D.shj.y, z];
        P[ids[2]] = [D.elb.x, D.elb.y, z];
        P[ids[3]] = [D.wri.x, D.wri.y, z];
        P[ids[4]] = [D.mcp.x, D.mcp.y, z];
      } else {
        P[ids[0]] = [D.hip.x, D.hip.y, z];
        P[ids[1]] = [D.stf.x, D.stf.y, z];
        P[ids[2]] = [D.hock.x, D.hock.y, z];
        P[ids[3]] = [D.mtp.x, D.mtp.y, z];
      }
    }
    return P;
  }
  function ang(a, b) { return atan2(b.y - a.y, b.x - a.x); }
  // the tail's resting curve: down and back at `rest` below the horizontal,
  // its end swept up by `curl` (the shepherd's saber, the fox's lift)
  function tailSetup(D) {
    const T = D.row.tail, L = D.tailL;
    const a0 = -(PI - T.rest * 0.62);      // the first stretch leaves the croup nearly level
    const a1 = -(PI - T.rest);
    const a2 = a1 - T.curl;                  // the end lifts back up (CW turn = toward -x up)
    D.tailPath = function (s) {
      // s 0..1 along the tail; integrate a heading that bends a0 -> a1 -> a2
      const n = 16; let x = D.tailP.x, y = D.tailP.y;
      const m = Math.max(1, Math.round(s * n));
      for (let i = 0; i < m; i++) {
        const u = (i + 0.5) / n;
        const h = u < 0.35 ? lerp(a0, a1, u / 0.35) : lerp(a1, a2, sstep(0.55, 1, u));
        x += cos(h) * L / n; y += sin(h) * L / n;
      }
      const rem = s * n - m;
      if (rem !== 0) { const h = a2; x += cos(h) * L / n * rem; y += sin(h) * L / n * rem; }
      return { x: x, y: y };
    };
    D.tailS = [0, 0.18, 0.38, 0.58, 0.78];
    D.tailRest = T.rest;
  }
  function legBind(D) {
    // absolute sagittal bind angles of every leg segment (front 5, hind 4)
    D.bF = [ang(D.scapPiv, D.shj), ang(D.shj, D.elb), ang(D.elb, D.wri), ang(D.wri, D.mcp), 0];
    D.bH = [ang(D.hip, D.stf), ang(D.stf, D.hock), ang(D.hock, D.mtp), 0];
    D.scapPL = hypot(D.shj.x - D.scapPiv.x, D.shj.y - D.scapPiv.y);
  }
  function makeSkeleton(D, name) {
    const THREE = W.THREE;
    const pts = bindPoints(D);
    const bs = [];
    for (let i = 0; i < NB; i++) { const b = new THREE.Bone(); b.name = (name || "canid") + i; bs.push(b); }
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i], P = pts[i], Q = p >= 0 ? pts[p] : [0, 0, 0];
      bs[i].position.set(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
      if (p >= 0) bs[p].add(bs[i]);
    }
    return { bones: bs, bindPos: bs.map(function (b) { return b.position.clone(); }), pts: pts };
  }

  // ==========================================================================
  //  THE COAT: (part, x, y, z, ca, sa, tag, t, aux) -> hex
  //  part: torso neck head jaw tongue tooth eye lid ear tail legF legH paw pad
  //  claw collar; ca/sa round the ring (torso/head ca = up; legs ca = front);
  //  aux 1/2 = a tuft's root/tip (guard hair tips)
  // ==========================================================================
  function coatFn(D, C0, seed, collarHex) {
    const C = {};
    for (const k in C0) C[k] = (typeof C0[k] === "number" && C0[k] > 255) ? lin(C0[k]) : C0[k];
    const W0 = D.withers, K = D.K;
    const r = mkRng((seed | 0) ^ 0xC4D1);
    const off = [r() * 50, r() * 50, r() * 50];
    const NOSE = C.nose != null ? C.nose : lin(0x1b1817), LIP = C.lip != null ? C.lip : lin(0x1e1a18), MOUTH = lin(0x7a3a3e), GUM = lin(0x3a2426),
      TONGUE = lin(0xc4707a), TOOTH = lin(0xeee8d8), PAD = lin(0x2a2422), CLAW = lin(0x2c2622), LID = lin(0x1a1412), PUPIL = lin(0x070605),
      COLLAR = collarHex != null ? lin(collarHex) : lin(0x2a2622);
    const pat = C.pattern || "solid";
    const base = C.base, under = C.under != null ? C.under : base, back = C.back != null ? C.back : base;
    const grz = C.grizzle || 0;
    const white = C.white != null ? C.white : under;
    function grizzle(c, x, y, z, amt) {
      if (!(amt > 0) || C.tip == null) return c;
      const h = hash3(x * 61 / K + off[0], y * 61 / K + off[1], z * 61 / K + off[2]);
      if (h > 0.7) return mixHex(c, C.tip, amt * (h - 0.7) / 0.3 * 1.3);
      if (h < 0.24 && C.band != null) return mixHex(c, C.band, amt * (0.24 - h) / 0.24 * 0.9);
      return c;
    }
    // stripes of a brindle: dark bars down the flanks, broken by noise
    function brindle(c, x, y, z) {
      if (!C.stripes) return c;
      const n = vnoise(x * 9 / K + off[0], y * 4 / K, z * 9 / K + off[1]);
      const s = sin((x * 46 + y * 6) / K + n * 5);
      return s > 0.25 ? mixHex(c, C.stripe, C.stripes * sstep(0.25, 0.6, s) * 1.6) : c;
    }
    function piebald(c, x, y, z) {
      const n = vnoise(x * 4.2 / K + off[0], y * 4.2 / K + off[1], z * 4.2 / K + off[2]);
      if (n > 0.58) return mixHex(c, C.patch, sstep(0.58, 0.64, n));
      if (n < 0.24 && C.patch2 != null) return mixHex(c, C.patch2, sstep(0.24, 0.18, n));
      return c;
    }
    const xBack = D.xB, xWith = D.xWith, xSh = D.shj.x;
    return function (part, x, y, z, ca, sa, tag, t, aux) {
      // fixed tissues first
      switch (tag) {
        case "nose": return NOSE; case "nostril": return lin(0x060505); case "tooth": return TOOTH; case "tongue": return TONGUE;
        case "pad": return PAD; case "claw": return CLAW; case "lid": return LID; case "pupil": return PUPIL;
        case "iris": return C.eye != null ? C.eye : lin(0x4a2c14);
        case "sclera": return lin(0x2a1a12);
        case "collar": return COLLAR;
        case "gum": return GUM; case "mouth": return MOUTH; case "lip": return LIP;
      }
      let c = base;
      const up = ca, down = -ca;
      switch (part) {
        case "torso": {
          const backK = sstep(0.05, 0.6, up);
          if (pat === "saddle") {
            const sadX = sstep(xBack - 0.02 * K, xBack + 0.1 * K, x) * (1 - sstep(xWith + 0.02 * K, xWith + 0.12 * K, x));
            c = mixHex(base, back, sstep(-0.12, 0.25, up) * sadX);
            if (x > xWith - 0.04 * K) c = mixHex(c, C.cape != null ? C.cape : back, sstep(0.25, 0.65, up) * sstep(xWith - 0.04 * K, xWith + 0.06 * K, x));
            c = mixHex(c, under, sstep(0.25, 0.75, down));
          } else if (pat === "agouti" || pat === "fox") {
            const sadX = sstep(xBack - 0.08 * K, xBack + 0.06 * K, x) * (1 - sstep(xSh + 0.02 * K, xSh + 0.1 * K, x));
            c = mixHex(base, back, backK * (0.35 + 0.65 * sadX));
            if (C.cape != null && x > xWith - 0.1 * K) c = mixHex(c, C.cape, backK * sstep(xWith - 0.1 * K, xWith + 0.02 * K, x) * 0.8);
            c = mixHex(c, under, sstep(0.2, 0.62, down));
            if (x > xSh - 0.03 * K && C.bib != null) c = mixHex(c, C.bib, sstep(-0.1, -0.55, up) * sstep(xSh - 0.03 * K, xSh + 0.06 * K, x));
            if (x < D.hip.x + 0.06 * K && down > 0.2) c = mixHex(c, under, 0.7);
          } else {
            c = mixHex(base, back, backK * 0.6);
            c = mixHex(c, under, sstep(0.3, 0.8, down));
            if (pat === "brindle") c = brindle(c, x, y, z);
            if (pat === "piebald") c = piebald(c, x, y, z);
            if (pat === "points") c = mixHex(c, C.tan, sstep(0.35, 0.7, down) * sstep(xSh - 0.12 * K, xSh, x));
          }
          if (C.chest && x > xSh - 0.1 * K) c = mixHex(c, white, C.chest * sstep(-0.05, -0.5, up) * sstep(xSh - 0.1 * K, xSh, x));
          if (pat === "piebald" && down > 0.5) c = mixHex(c, under, 0.8);
          return grizzle(c, x, y, z, grz * (0.35 + 0.65 * backK));
        }
        case "neck": {
          const backK = sstep(-0.05, 0.6, up);
          if (pat === "saddle") c = mixHex(base, C.cape != null ? C.cape : back, sstep(-0.15, 0.35, up) * 0.95);
          else c = mixHex(base, C.cape != null ? C.cape : back, backK * 0.8);
          c = mixHex(c, C.bib != null ? C.bib : under, sstep(0.05, 0.55, down));
          if (C.chest) c = mixHex(c, white, C.chest * sstep(0.2, 0.7, down));
          if (pat === "brindle") c = brindle(c, x, y, z);
          if (pat === "piebald") c = piebald(c, x, y, z);
          if (pat === "points") c = mixHex(c, C.tan, sstep(0.55, 0.9, down) * 0.6);
          if (D.row.dewlap && down > 0.3) c = shade(c, 1 - 0.08 * D.row.dewlap);
          return grizzle(c, x, y, z, grz * (0.5 + 0.5 * backK));
        }
        case "head": {
          // t runs occiput (0) -> nose (1); the muzzle starts at the stop
          const muz = sstep(D.stopT - 0.06, D.stopT + 0.02, t);
          if (aux === 3) return LIP;                                  // the lip edge band
          if (aux === 4) return MOUTH;                                 // the palate
          const crown = C.crown != null ? C.crown : back;
          const cheek = C.cheek != null ? C.cheek : base;
          c = mixHex(cheek, crown, sstep(-0.1, 0.6, up));
          if (pat === "saddle") c = mixHex(c, crown, sstep(0.45, 0.85, up) * (1 - muz));
          if (C.brow != null && t > D.stopT - 0.16 && t < D.stopT - 0.02 && up > 0.3 && up < 0.8 && abs(sa) > 0.35) c = mixHex(c, C.brow, 0.8);
          if (C.mask != null && (pat === "agouti" || pat === "fox")) c = mixHex(c, C.mask, sstep(0.15, -0.35, up) * (1 - muz * 0.3));
          if (muz > 0) {
            let m = C.muzzleTop != null ? C.muzzleTop : c;
            if (up < 0.35 && C.muzzleSide != null && abs(sa) > 0.5) m = mixHex(m, C.muzzleSide, 0.6);
            if (C.mask != null && (pat === "saddle" || pat === "masked" || pat === "solid" || pat === "blaze" || pat === "brindle")) m = mixHex(m, C.mask, pat === "solid" ? 0.15 : 0.85);
            if (C.chin != null && up < -0.2) m = mixHex(m, C.chin, 0.6);
            if (pat === "points" && up < 0.6) m = mixHex(m, C.tan, 0.8);
            c = mixHex(c, m, muz);
          }
          if (pat === "masked") c = mixHex(c, C.mask, sstep(D.stopT - 0.14, D.stopT - 0.02, t) * sstep(-0.2, 0.3, up) * sstep(0.2, 0.6, abs(sa)) * 0.85);
          if (pat === "brindle") c = brindle(c, x, y, z);
          if (pat === "piebald") c = piebald(c, x, y, z);
          if (C.face && t > 0.25 && up > 0.6 && abs(sa) < 0.3) c = mixHex(c, white, C.face);
          if (pat === "points" && up > 0.25 && up < 0.65 && t > D.stopT - 0.14 && t < D.stopT - 0.02 && abs(sa) > 0.4) c = mixHex(c, C.tan, 0.85);
          return grizzle(c, x, y, z, grz * 0.45 * (1 - muz * 0.6));
        }
        case "jaw": {
          if (aux === 3) return LIP;
          if (up > 0.55) return t > 0.82 ? GUM : MOUTH;
          c = C.chin != null ? C.chin : (C.mask != null && (pat === "masked" || pat === "saddle") ? C.mask : under);
          if (pat === "points") c = C.tan;
          if (C.chest && pat !== "masked") c = mixHex(c, white, C.chest * 0.6);
          return c;
        }
        case "ear": {
          // the back of the ear (ca < 0 here) wears the coat, the cupped
          // front the pale inner fur, a dark rim on wolves and foxes
          const tip = sstep(0.5, 0.95, t);
          if (up > 0.1) {
            c = C.earIn != null ? C.earIn : lin(0x8a6a5e);
            c = mixHex(c, C.earBack != null ? C.earBack : back, sstep(0.82, 0.98, abs(sa)) * 0.8);
          } else {
            c = C.earBack != null ? C.earBack : back;
            if (C.earTip != null) c = mixHex(c, C.earTip, tip);
          }
          if (C.earRim != null && abs(sa) > 0.9) c = mixHex(c, C.earRim, 0.8);
          if (pat === "piebald") c = piebald(c, x, y, z);
          return c;
        }
        case "tail": {
          const topK = sstep(-0.3, 0.6, up);
          c = mixHex(C.tailUnder != null ? C.tailUnder : under, C.tailTop != null ? C.tailTop : back, topK);
          if (pat === "saddle" || pat === "solid" || pat === "masked" || pat === "blaze") c = mixHex(base, C.tailTop != null ? C.tailTop : back, topK * (pat === "saddle" ? 0.95 : 0.7));
          if (C.gland != null && t > 0.16 && t < 0.3 && up > 0.5) c = mixHex(c, C.gland, 0.85);
          if (C.tailTip != null) c = mixHex(c, C.tailTip, sstep(C.tipFrom || 0.84, (C.tipFrom || 0.84) + 0.07, t));
          if (pat === "brindle") c = brindle(c, x, y, z);
          if (pat === "piebald") c = piebald(c, x, y, z);
          if (aux === 2 && C.tip != null && (pat === "agouti")) c = mixHex(c, C.tip, 0.55);
          return grizzle(c, x, y, z, grz * 0.7 * topK * (1 - sstep(0.78, 0.86, t)));
        }
        case "legF": case "legH": case "paw": {
          // the pads: a toe's underside (aux 5), the sole of the paw (aux 6)
          if (part === "paw" && ((aux === 5 && ca < -0.3) || (aux === 6 && ca < -0.5))) return PAD;
          const front = part === "legF" || (part === "paw" && x > 0);
          const outer = (z >= 0 ? sa : -sa) > 0;
          c = C.leg != null ? C.leg : base;
          if (pat === "saddle") {
            // the saddle runs down the outside of the thigh and the upper arm
            const yTop = front ? D.elb.y + 0.04 * K : D.stf.y + 0.02 * K;
            c = mixHex(c, back, sstep(yTop, yTop + 0.1 * K, y) * (outer ? 0.75 : 0.35));
          } else if (pat === "agouti" || pat === "fox") {
            c = mixHex(base, c, sstep(front ? D.elb.y + 0.06 * K : D.stf.y + 0.04 * K, front ? D.elb.y - 0.06 * K : D.hock.y + 0.04 * K, y));
            if (!front && C.pants != null && ca < -0.3 && y > D.hock.y) c = mixHex(c, C.pants, 0.6);
          } else if (pat === "points") {
            c = mixHex(base, C.tan, sstep(front ? D.elb.y : D.stf.y, front ? D.wri.y + 0.05 * K : D.hock.y + 0.05 * K, y));
          } else {
            c = mixHex(base, under, (outer ? 0.1 : 0.45) * sstep(front ? D.elb.y + 0.05 * K : D.stf.y + 0.04 * K, front ? D.elb.y - 0.05 * K : D.stf.y - 0.06 * K, y));
            if (pat === "brindle") c = brindle(c, x, y, z);
            if (pat === "piebald") c = piebald(c, x, y, z);
          }
          if (C.stocking != null) c = mixHex(c, C.stocking, sstep(front ? D.elb.y - 0.02 * K : D.stf.y - 0.04 * K, front ? D.wri.y + 0.06 * K : D.hock.y + 0.04 * K, y));
          if (C.legStripe != null && front && ca > 0.55 && y < D.elb.y && y > D.wri.y) c = mixHex(c, C.legStripe, 0.7);
          if (C.socks) c = mixHex(c, white, C.socks * sstep((front ? D.wri.y : D.hock.y) + 0.02 * K, (front ? D.wri.y : D.hock.y) - 0.05 * K, y));
          if (part === "paw") c = mixHex(c, C.paw != null ? C.paw : c, 0.6);
          return grizzle(c, x, y, z, grz * 0.3);
        }
      }
      return c;
    };
  }

  // ==========================================================================
  //  THE SHELL
  // ==========================================================================
  const FUR_DOWN = 0.35;
  function buildShape(D, lod) {
    const LK = CBZ.loftKit, R = D.row, K = D.K, Wt = D.withers;
    const near = lod === 0;
    const G = LK.geo().extras({ fur: near, ctx: true });
    const F = R.fur, girK = D.girth;
    const tuftK = near ? (F.tufts || 0) : 0;
    const flen = F.len;
    // ring counts: smooth up close (~9-10k triangles), ~1.5k far away
    const S_T = near ? 26 : 10, S_N = near ? 20 : 8, S_L = near ? 12 : 6;
    const stepT = near ? 0.032 * K : 0.1 * K, stepL = near ? 0.03 * K : 0.085 * K;
    const PV = BN.pelvis, LN = BN.loin, CH = BN.chest, RB = BN.ribs;
    const furOf = function (k, down, sign) { return { k: k * F.k, len: D.clump, down: down == null ? FUR_DOWN : down, sign: sign == null ? -1 : sign }; };

    // ---- TORSO: tail set -> rump -> croup -> loin (tuck-up) -> ribs (keel)
    //      -> withers / shoulders -> prosternum. y = the widest line; rt
    //      above, rb below; `keel` narrows the bottom toward the sternum.
    const yC = D.yCroup, yW = D.yW, yBr = D.yBrisket, yBe = D.yBelly, hip = D.hip, x = function (k) { return k; };
    void x;
    const T = [];
    function tk(xx, yTop, yBot, yWide, w, o) {
      const k = Object.assign({ x: xx, y: yWide, rt: Math.max(0.005, yTop - yWide), rb: Math.max(0.005, yWide - yBot), w: w, sq: 1, keel: 0, crest: 0, wts: [PV, 1] }, o || {});
      T.push(k);
    }
    const xB = D.xB, xIl = D.xIl, xLR = D.xLR, xE = D.elb.x, xS = D.shj.x, xWt = D.xWith;
    // the topline: the croup (ilium) up to the withers, a little arch over the loin
    const topAt = function (xx) { const f = clamp((xx - xIl) / (xWt - xIl), 0, 1); return lerp(yC, yW - D.skin * 0.25, f); };
    const tailY = D.tailP.y;
    tk(xB - 0.025 * K, tailY - 0.035 * K, hip.y - 0.075 * K, hip.y + 0.005 * K, D.croupW * 0.5, { wts: [PV, 1], sq: 0.95 });
    tk(xB + 0.03 * K, tailY + 0.006 * K, hip.y - 0.13 * K, hip.y + 0.025 * K, D.croupW * 0.88, { wts: [PV, 1], sq: 0.92 });
    tk(hip.x + 0.03 * K, lerp(tailY, yC, 0.7), yBe - 0.035 * K, lerp(yBe, yC, 0.52), D.croupW, { wts: [PV, 1], sq: 0.9 });
    tk(xIl, yC, yBe - 0.005 * K, lerp(yBe, yC, 0.5), D.croupW * 0.96, { wts: [PV, 0.85, LN, 0.15], sq: 0.92 });
    const xLo = lerp(xIl, xLR, 0.5);
    tk(xLo, topAt(xLo) + R.arch * Wt, yBe + 0.008 * K, lerp(yBe, yC, 0.55), D.loinW, { wts: [PV, 0.25, LN, 0.75], sq: 0.95 });
    tk(xLR, topAt(xLR) + R.arch * Wt * 0.4, lerp(yBe, yBr, 0.42), lerp(yBr, yW, 0.55), D.ribW * 0.9, { wts: [LN, 0.6, CH, 0.4], keel: 0.25, hk: 0.15 });
    const xMr = lerp(xLR, xE, 0.5);
    tk(xMr, topAt(xMr), yBr + 0.02 * K, lerp(yBr, yW, 0.58), D.ribW, { wts: [CH, 0.35, RB, 0.65], keel: 0.5, hk: 0.35 });
    tk(xE + 0.025 * K, topAt(xE + 0.025 * K), yBr, lerp(yBr, yW, 0.6), D.ribW * 0.96, { wts: [CH, 0.4, RB, 0.6], keel: 0.62, hk: 0.7 });
    tk(xWt + 0.01 * K, yW - D.skin * 0.25, yBr + 0.012 * K, lerp(yBr, yW, 0.6), D.shW * 0.86, { wts: [CH, 1], keel: 0.6, hk: 1, crest: 0.25 });
    // the forechest: the sternum rises from the brisket to the prosternum, a
    // little below the points of shoulder (~62% of the withers), so the chest
    // fills between the upper arms down to the elbows
    const yPro = Math.max(yBr + 0.03 * K, 0.62 * Wt);
    tk(xS - 0.035 * K, yW - 0.085 * K, lerp(yBr, yPro, 0.4), lerp(lerp(yBr, yPro, 0.4), yW - 0.085 * K, 0.55), D.shW * 0.9, { wts: [CH, 1], keel: 0.5, hk: 0.6 });
    tk(xS + 0.02 * K, D.shj.y + 0.06 * K, yPro, lerp(yPro, D.shj.y + 0.06 * K, 0.45), D.shW * 0.72, { wts: [CH, 1], keel: 0.35 });
    const profTorso = function (Rr, ca, sa, out) {
      const e = Rr.sq || 1;
      const pc = Math.sign(ca) * Math.pow(abs(ca), e), ps = Math.sign(sa) * Math.pow(abs(sa), e);
      let wK = 1;
      if (ca < 0 && Rr.keel) wK = 1 - Rr.keel * Math.pow(-ca, 1.6) * 0.62;
      out.u = pc * (ca >= 0 ? Rr.rt * (1 + (Rr.crest || 0) * Math.pow(Math.max(0, ca), 12) * 0.25) : Rr.rb);
      out.s = ps * Rr.w * wK; out.f = 0;
    };
    const tuftTorso = tuftK > 0 ? function (Rr, ca, sa, t) {
      // the back ridge, the belly fringe and the chest; denser on long coats
      const q = hash3(Rr.x * 97, ca * 13, sa * 17);
      if (ca > 0.8 && q < 0.5 * tuftK * F.back) return { len: flen * 4.2 * (1 + F.back * 0.6), w: flen * 1.6 };
      if (ca < -0.75 && t > 0.45 && q < 0.55 * tuftK * F.belly) return { len: flen * 4 * (1 + F.belly * 0.5), w: flen * 1.6, down: 0.9 };
      if (t > 0.82 && ca < -0.2 && q < 0.6 * tuftK * F.ruff) return { len: flen * 5.2 * F.ruff, w: flen * 1.8, down: 0.7 };
      return null;
    } : null;
    // (on the chest's front the hair falls straight down; elsewhere it lies along the body)
    const furBody = furOf(1, 0.45, 1), furChest = furOf(1, 1, 0.15);
    LK.sweep(G, T, { S: S_T, step: stepT, prof: profTorso, part: "torso", hkBone: BN.hackle, tufts: tuftTorso, capLen: 0.55,
      fur: function (Rr, ca, sa, t) { return t > 0.93 ? furChest : furBody; } });

    // ---- NECK: from inside the withers up to the back of the skull. The
    //      ruff thickens the crest and the throat (wolves, shepherds); a
    //      mastiff's dewlap hangs under it.
    const nb = D.neckB, hp = D.headP, nr = D.neckR, ruff = R.ruff || 1;
    const nk = function (t) { return { x: lerp(nb.x, hp.x, t), y: lerp(nb.y, hp.y, t) }; };
    const NK = [];
    const n0 = nk(-0.22), n1 = nk(0.05), n2 = nk(0.4), n3 = nk(0.75), n4 = nk(1.02);
    const dl = R.dewlap || 0;
    // (the base rings stay inside the shoulders; the ruff widens the neck above them)
    NK.push({ x: n0.x, y: n0.y, rt: nr * 1.25, rb: nr * 1.55, w: Math.min(nr * 1.35 * ruff, D.shW * 0.82), wts: [CH, 1], hk: 0.6 });
    NK.push({ x: n1.x, y: n1.y, rt: nr * 1.15 * ruff, rb: nr * 1.4 * (1 + dl * 0.1), w: Math.min(nr * 1.2 * ruff, D.shW * 0.88), wts: [CH, 0.5, BN.neck, 0.5], hk: 0.3 });
    NK.push({ x: n2.x, y: n2.y, rt: nr * 1.04 * ruff, rb: nr * 1.12 * (1 + dl * 0.25), w: nr * 1.02 * ruff, wts: [BN.neck, 0.75, BN.neck1, 0.25] });
    NK.push({ x: n3.x, y: n3.y, rt: nr * 0.95 * (1 + (ruff - 1) * 0.6), rb: nr * 1.0 * (1 + dl * 0.3), w: nr * 0.94 * (1 + (ruff - 1) * 0.8), wts: [BN.neck1, 0.85, BN.head, 0.15] });
    NK.push({ x: n4.x, y: n4.y, rt: nr * 0.72, rb: nr * 0.85, w: nr * 0.8, wts: [BN.neck1, 0.3, BN.head, 0.7] });
    const tuftNeck = tuftK > 0 ? function (Rr, ca, sa, t) {
      const q = hash3(Rr.x * 131, ca * 7, sa * 11);
      const dens = tuftK * F.ruff * (t < 0.85 ? 1 : 0.3);
      if (q < 0.42 * dens) return { len: flen * (4.5 + 3 * (ruff - 1) * 5) , w: flen * 1.8, down: 0.25 + 0.5 * Math.max(0, -ca) };
      return null;
    } : null;
    LK.sweep(G, NK, { S: S_N, step: near ? 0.032 * K : 0.1 * K, part: "neck", hkBone: BN.hackle, fur: furOf(1, 0.2, -1), tufts: tuftNeck, capLen: 0.6 });

    // ---- HEAD: occiput -> cranium -> zygoma -> orbit/brow -> stop -> muzzle
    //      -> nose leather. Keys in head space (u along the axis, v up).
    headShape(G, D, near, furOf);
    jawShape(G, D, near);
    if (near) eyes(G, D, near);
    ears(G, D, near, furOf);
    tailShape(G, D, near, furOf, tuftK);
    for (let L = 0; L < 4; L++) legShape(G, D, L, near, furOf, tuftK, S_L, stepL);
    if (near) collarShape(G, D, near);
    if (tuftK > 0) LK.tufts(G, { seed: (R.id.length * 131 + 7) | 0, lift: 0.5 });
    const radius = Wt * 1.6 + D.tailL * 0.6;
    return { G: G, bs: [0, Wt * 0.55, 0, radius] };
  }

  // ---- the head's profile: cranium, eye sockets, brows, flews, palate, nose
  function headShape(G, D, near, furOf) {
    const LK = CBZ.loftKit, R = D.row, hl = D.hl, HD = BN.head;
    const sk = R.skullH / 0.3, sw = R.skullW / 0.27, mw = R.muzW / 0.12, mh = R.muzH / 0.255;
    const stopU = 1 - R.muzK;                 // the stop, as a fraction of the head
    const ch = R.cheek || 1;
    // keys: [u, vTop, vBot, halfWidth, extra]  (fractions of the head length)
    const keys = [
      [-0.075, 0.17 * sk, 0.03, 0.08 * sw, {}],
      [0.0, 0.25 * sk, -0.03, 0.17 * sw, {}],
      [stopU * 0.32, 0.3 * sk, -0.07, 0.235 * sw, { crest: R.kind === "wild" ? 0.4 : 0.15 }],
      [stopU * 0.64, 0.3 * sk, -0.105, 0.27 * sw * (0.9 + 0.1 * ch), { chk: ch - 0.9 }],
      [stopU * 0.86, 0.265 * sk, -0.1, 0.24 * sw * (0.93 + 0.07 * ch), { eyeD: 1, chk: (ch - 0.9) * 0.6 }],
      [stopU * 1.0, 0.27 * sk * 0.76 + R.muzH * 0.5 * 0.0, -0.092, lerp(0.24 * sw, R.muzW * 1.2, 0.6), { brow: 0.6, eyeD: 0.35 }],
      [stopU + (1 - stopU) * 0.18, 0.16 * mh + 0.012 - R.stop * 0.25, -0.095 * mh, R.muzW * 1.08, { fl: R.flews * 0.8, muz: 1 }],
      [stopU + (1 - stopU) * 0.55, 0.142 * mh - R.stop * 0.2, -0.09 * mh, R.muzW * 1.0, { fl: R.flews, muz: 1 }],
      [stopU + (1 - stopU) * 0.84, 0.128 * mh - R.stop * 0.15, -0.082 * mh, R.muzW * 0.92, { fl: R.flews * 0.85, muz: 1 }],
      [0.965, 0.118 * mh - R.stop * 0.12, -0.07 * mh, R.muzW * 0.8, { fl: R.flews * 0.5, muz: 1, nose: 1 }],
      [1.0, 0.1 * mh - R.stop * 0.1, -0.045 * mh, R.muzW * 0.66, { muz: 1, nose: 1 }],
    ];
    // the stop: the forehead steps down to the muzzle top
    keys[5][1] = lerp(keys[4][1], keys[6][1], 0.42) + 0.0;
    keys[4][1] = keys[4][1] + R.stop * 0.1;
    const HK = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], u = k[0] * hl, vt = k[1] * hl, vb = k[2] * hl, wv = k[3] * hl, ex = k[4];
      const vc = (vt + vb) / 2;
      const p = D.hs(u, vc);
      HK.push(Object.assign({ x: p.x, y: p.y, rt: (vt - vb) / 2, rb: (vt - vb) / 2, w: wv, sq: ex.muz ? 0.9 : 1, wts: [HD, 1],
        eyeD: 0, brow: 0, fl: 0, chk: 0, crest: 0, nose: 0, muz: 0, hu: u }, ex));
    }
    const eyeA = D.eyeA, flS = 0.68, flP = Math.log(0.5) / Math.log(flS);
    const eyeR = D.eyeR;
    const prof = function (Rr, ca, sa, out) {
      const e = Rr.sq || 1;
      const pc = Math.sign(ca) * Math.pow(abs(ca), e), ps = Math.sign(sa) * Math.pow(abs(sa), e);
      let ru = ca >= 0 ? Rr.rt : Rr.rb, rs = Rr.w;
      // flews: the upper lips hang below the palate at the sides
      if (ca < 0 && Rr.fl > 0) {
        const s = abs(sa), bell = sin(PI * Math.pow(s, flP));
        ru = Rr.rb + Rr.fl * hl * bell * 1.0;
      }
      // the cheeks (masseter / zygoma) bulge low on the sides
      if (Rr.chk) rs *= 1 + Rr.chk * 0.35 * Math.max(0, 1 - abs(ca + 0.15) * 1.8);
      let u = pc * ru, s = ps * rs;
      // eye sockets (both sides) and the brow ridge above them
      const a = atan2(sa, ca);
      if (Rr.eyeD > 0 || Rr.brow > 0) {
        const da = abs(abs(a) - eyeA);
        const dent = Rr.eyeD * eyeR * 0.55 * Math.exp(-(da * da) / 0.09);
        const bump = Rr.brow * eyeR * 0.5 * Math.exp(-((abs(a) - (eyeA - 0.45)) * (abs(a) - (eyeA - 0.45))) / 0.06);
        const rl = hypot(u, s) || 1, k = (rl - dent + bump) / rl;
        u *= k; s *= k;
      }
      // the cranial crest (wolves)
      if (Rr.crest && ca > 0.85) u += Rr.crest * 0.012 * hl * Math.pow(ca, 30);
      // nostrils: two dents on the front-sides of the nose leather
      if (Rr.nose >= 0.99 && ca > -0.3 && ca < 0.5 && abs(sa) > 0.5 && abs(sa) < 0.95) { u *= 0.96; s *= 0.96; }
      out.u = u; out.s = s; out.f = 0;
    };
    // the colour context: the lip band and palate get their own aux
    const lipAux = function (Rr, ca, sa) {
      if (!Rr.muz) return 0;
      if (ca < 0) {
        const s = abs(sa);
        if (Rr.fl > 0 && s > 0.45 && s < 0.92 && ca < -0.25) return 3;   // the black lip edge
        if (ca < -0.8) return 4;                                          // the palate
      }
      return 0;
    };
    const sw0 = LK.sweep(G, HK, {
      S: near ? 24 : 8, step: near ? 0.045 * hl : 0.16 * hl, prof: prof, part: "head", capLen: 0.55,
      fur: function (Rr) { return Rr.muz ? { k: 0.25 * D.row.fur.k, len: D.clump * 0.5, down: 0.1, sign: -1 } : { k: 0.7 * D.row.fur.k, len: D.clump * 0.75, down: 0.15, sign: -1 }; },
      tufts: near && D.row.fur.cheek > 0 && D.row.fur.tufts > 0 ? function (Rr, ca, sa) {
        if (Rr.hu > hl * 0.5 || Rr.hu < hl * 0.1 || ca > 0.2 || ca < -0.85) return null;
        const q = hash3(Rr.x * 211, ca * 19, sa * 23);
        if (q < 0.45 * D.row.fur.cheek * D.row.fur.tufts) return { len: D.row.fur.len * 4.5 * D.row.fur.cheek, w: D.row.fur.len * 1.6, down: 0.5, sign: -1 };
        return null;
      } : null,
    });
    // the lip / palate / nose tissues ride the context's aux and tag
    retag(G, sw0, function (Rr, ca, sa, t) {
      const a = lipAux(Rr, ca, sa);
      if (Rr.nose >= 0.5 && t > 0.93) {
        if (Rr.nose >= 0.99 && ca > -0.3 && ca < 0.5 && abs(sa) > 0.5 && abs(sa) < 0.95) return ["nostril", 0];
        if (ca > -0.55) return ["nose", 0];
      }
      return [null, a];
    });
    D.headKeys = HK;
  }
  // rewrite the tag / aux of a sweep's ring vertices after the fact
  function retag(G, sw, fn) {
    if (!G.cx) return;
    const S = sw.S, N = sw.rings.length;
    for (let i = 0; i < N; i++) {
      const Rr = sw.rings[i], b = sw.base[i];
      for (let j = 0; j < S; j++) {
        const vi = b + j, c = vi * 6;
        const res = fn(Rr, G.cx[c + 2], G.cx[c + 3], G.cx[c + 4]);
        if (!res) continue;
        if (res[0]) G.cx[c + 1] = G.tagId(res[0]);
        if (res[1]) G.cx[c + 5] = res[1];
      }
    }
    // the END cap (two rings and the pole, the last vertices the sweep made)
    // belongs to the nose; the start cap is the back of the skull
    if (sw.rings[N - 1].nose) {
      const nid = G.tagId("nose");
      for (let vi = G.n - (2 * S + 1); vi < G.n; vi++) G.cx[vi * 6 + 1] = nid;
    }
  }

  // ---- the lower jaw, the tongue, the teeth ----------------------------------
  function jawShape(G, D, near) {
    const LK = CBZ.loftKit, R = D.row, hl = D.hl, JW = BN.jaw, HD = BN.head;
    const mh = R.muzH / 0.255;
    const stopU = 1 - R.muzK;
    const keys = [
      [0.3, -0.045, -0.13 * mh, 0.16 * (R.skullW / 0.27)],
      [lerp(0.3, 0.97, 0.25), -0.068, -0.14 * mh, R.muzW * 1.02],
      [lerp(0.3, 0.97, 0.55), -0.075, -0.135 * mh, R.muzW * 0.9],
      [lerp(0.3, 0.97, 0.82), -0.077, -0.125 * mh, R.muzW * 0.78],
      [0.97, -0.074, -0.108 * mh, R.muzW * 0.6],
    ];
    const JK = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], vt = k[1] * hl, vb = k[2] * hl, vc = (vt + vb) / 2, p = D.hs(k[0] * hl, vc);
      JK.push({ x: p.x, y: p.y, rt: (vt - vb) / 2, rb: (vt - vb) / 2, w: k[3] * hl, sq: 0.85, wts: i === 0 ? [JW, 0.7, HD, 0.3] : [JW, 1] });
    }
    const sw = LK.sweep(G, JK, { S: near ? 14 : 6, step: near ? 0.06 * hl : 0.25 * hl, part: "jaw", capLen: 0.6,
      fur: { k: 0.3 * R.fur.k, len: D.clump * 0.5, down: 0.2, sign: -1 } });
    // the black lower lip along the top edge
    retag(G, sw, function (Rr, ca, sa) { return (ca > 0.15 && ca < 0.62 && abs(sa) > 0.55) ? [null, 3] : null; });
    void stopU;
    if (!near) return;
    // the tongue on the floor of the mouth, on its own bone (it comes out to pant)
    const TK = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3, u = lerp(0.46, 0.93, t) * hl, v = -0.083 * hl, p = D.hs(u, v);
      TK.push({ x: p.x, y: p.y, rt: 0.014 * hl, rb: 0.012 * hl, w: lerp(0.075, 0.065, t) * hl * (R.muzW / 0.12), sq: 0.8, wts: [BN.tongue, 1], tag: "tongue" });
    }
    LK.sweep(G, TK, { S: 8, n: 1, part: "tongue", tag: "tongue", capLen: 0.9, capRings: 1 });
    // teeth: canines, the carnassial row, the incisors (seen when it opens)
    const tw = R.muzW * hl;
    const tooth = function (u, v, z, du, dv, r, bone, S) {
      const a = D.hs(u, v), b = D.hs(u + du, v + dv);
      LK.cone(G, [a.x, a.y, z], [b.x, b.y, z], r, { wts: [bone, 1], part: "tooth", tag: "tooth", S: S || 5 });
    };
    const cl = 0.09 * hl * (R.kind === "wild" ? 1.1 : 1);
    for (let s = -1; s <= 1; s += 2) {
      tooth(0.9 * hl, -0.06 * hl, s * tw * 0.72, 0.004 * hl, -cl, 0.015 * hl, HD, 6);              // upper canine
      tooth(0.885 * hl, -0.086 * hl, s * tw * 0.6, 0.008 * hl, cl * 0.8, 0.012 * hl, JW, 6);         // lower canine
      for (let k = 0; k < 3; k++) {                                                                  // premolars + carnassial
        const u = lerp(0.55, 0.8, k / 2) * hl;
        tooth(u, -0.064 * hl, s * tw * lerp(0.92, 0.78, k / 2), 0, -cl * (k === 0 ? 0.55 : 0.38), 0.012 * hl, HD, 4);
        if (k < 2) tooth(u + 0.02 * hl, -0.084 * hl, s * tw * lerp(0.8, 0.68, k), 0, cl * 0.33, 0.01 * hl, JW, 4);
      }
      for (let k = 0; k < 3; k++) {                                                                  // incisors
        const z = s * tw * (0.12 + 0.17 * k);
        tooth(0.975 * hl - k * 0.004 * hl, -0.06 * hl, z, 0.003 * hl, -cl * 0.35, 0.007 * hl, HD, 4);
        tooth(0.96 * hl - k * 0.004 * hl, -0.087 * hl, z * 0.92, 0.003 * hl, cl * 0.3, 0.006 * hl, JW, 4);
      }
    }
  }

  // ---- eyes: an eyeball in the socket, the iris and pupil (a slit on the
  //      fox), a dark lid rim around it
  function eyes(G, D, near) {
    const LK = CBZ.loftKit, R = D.row, hl = D.hl, HD = BN.head;
    const stopU = D.stopT, er = D.eyeR;
    // where the socket is: the head ring nearest the eye, at the eye angle
    const u = stopU * 0.9 * hl;
    let Rr = D.headKeys[4];
    for (let i = 0; i < D.headKeys.length - 1; i++) if (D.headKeys[i].hu <= u && D.headKeys[i + 1].hu > u) {
      const a = D.headKeys[i], b = D.headKeys[i + 1], f = (u - a.hu) / (b.hu - a.hu);
      Rr = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), rt: lerp(a.rt, b.rt, f), w: lerp(a.w, b.w, f) };
    }
    for (let s = -1; s <= 1; s += 2) {
      // the socket surface point (angle eyeA from the top, toward this side)
      const ca = cos(D.eyeA), sa = sin(D.eyeA);
      const n = D.n;
      const cx = Rr.x + n.x * ca * Rr.rt * 0.96, cy = Rr.y + n.y * ca * Rr.rt * 0.96, cz = s * sa * Rr.w * 0.96;
      // the eye looks forward and out (~25 deg off the head axis) and a little up
      const out = 0.42, upk = 0.12;
      const fx = D.u.x * cos(out) + n.x * upk, fy = D.u.y * cos(out) + n.y * upk, fz = s * sin(out);
      const fl = hypot(fx, fy, fz), f = [fx / fl, fy / fl, fz / fl];
      const c = [cx - f[0] * er * 0.45, cy - f[1] * er * 0.45, cz - f[2] * er * 0.45];
      // the ball, its axis on the gaze: the pupil at the front pole, the iris
      // round it, the dark sclera behind (tagged by depth along the gaze)
      const v0 = G.n;
      LK.blob(G, c, [er, er, er], { fwd: f, wts: [HD, 1], part: "eye", S: 12, rings: 6 });
      const tP = G.tagId(R.slit ? "iris" : "pupil"), tI = G.tagId("iris"), tS = G.tagId("sclera");
      for (let vi = v0; vi < G.n; vi++) {
        const d = ((G.p[vi * 3] - c[0]) * f[0] + (G.p[vi * 3 + 1] - c[1]) * f[1] + (G.p[vi * 3 + 2] - c[2]) * f[2]) / er;
        G.cx[vi * 6 + 1] = d > 0.95 ? tP : d > 0.5 ? tI : tS;
      }
      if (R.slit) {
        // the fox's vertical slit, a thin dark lens on the iris
        const pc = [c[0] + f[0] * er * 0.97, c[1] + f[1] * er * 0.97, c[2] + f[2] * er * 0.97];
        LK.blob(G, pc, [er * 0.08, er * 0.52, er * 0.1], { fwd: f, up: [D.n.x, D.n.y, 0], wts: [HD, 1], part: "eye", tag: "pupil", S: 6, rings: 2 });
      }
      // the lid: an almond rim round the visible ball, dark skin
      const up = [D.n.x, D.n.y, 0];
      const side = LK.cross3(f, up); LK.norm3(side);
      const up2 = LK.cross3(side, f); LK.norm3(up2);
      const n2 = 10, a0 = 1.12, b0 = 0.7;
      const LKS = [];
      for (let k = 0; k <= n2; k++) {
        const a = TAU * (k % n2) / n2;
        const px = cos(a) * er * a0, py = sin(a) * er * b0 * (sin(a) > 0 ? 1 : 0.9);
        const q = [c[0] + f[0] * er * 0.58 + side[0] * px + up2[0] * py, c[1] + f[1] * er * 0.58 + side[1] * px + up2[1] * py, c[2] + f[2] * er * 0.58 + side[2] * px + up2[2] * py];
        LKS.push({ x: q[0], y: q[1], z: q[2], rt: er * 0.16, rb: er * 0.16, w: er * 0.2, wts: [HD, 1], tag: "lid", up: f });
      }
      LK.sweep(G, LKS, { S: 4, n: 1, part: "eye", tag: "lid", capA: "open", capB: "open" });
    }
  }

  // ---- ears: a thin cupped shell (thickness, a concave front, a rounded or
  //      pointed tip); prick stands up and out, rose folds back, drop hangs
  function ears(G, D, near, furOf) {
    const LK = CBZ.loftKit, R = D.row, E = R.ear, hl = D.hl;
    const L = E.L * hl, bw = E.W * hl * 0.5, th = Math.max(0.004, E.th * hl * 0.5);
    for (let s = -1; s <= 1; s += 2) {
      const bone = s < 0 ? BN.earL : BN.earR;
      const base = { x: D.earPm.x, y: D.earPm.y, z: s * D.earPm.z };
      // the ear's own frame: `ax` runs base -> tip, `fw` is where the cup faces
      let path = [], fwds = [];
      const n = near ? 7 : 4;
      if (E.type === "prick") {
        // standing on the vertical at the natural head carriage (a hair back,
        // or forward by `fwd`), out by `out`; the cup faces forward and out
        const lean = E.fwd - 0.08, ux = sin(lean), uy = cos(lean);
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const outA = E.out * (0.6 + 0.4 * t);
          path.push([base.x + ux * L * t * cos(outA) - 0.02 * L * t * t, base.y + uy * L * t * cos(outA), base.z + s * L * t * sin(outA)]);
          fwds.push([1, 0.1, s * 0.35]);
        }
      } else if (E.type === "rose") {
        // up a third, then folded back and down along the skull
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1), a = t < 0.4 ? 0 : (t - 0.4) / 0.6 * 1.9;
          const ux = -sin(a) * 0.55, uy = cos(a);
          const r0 = L * t;
          path.push([base.x + D.u.x * ux * r0 + D.n.x * uy * r0 * 0.75, base.y + D.u.y * ux * r0 + D.n.y * uy * r0 * 0.75, base.z + s * (0.012 * hl + L * t * sin(E.out) * 0.8)]);
          fwds.push([D.u.x * cos(a) + D.n.x * sin(a), D.u.y * cos(a) + D.n.y * sin(a), s * 0.5]);
        }
      } else {
        // drop: out over the skull's edge, then down along the cheek
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const outK = sstep(0, 0.35, t), downK = sstep(0.15, 1, t);
          path.push([base.x + D.u.x * L * 0.08 * t, base.y + D.n.y * 0.02 * L - downK * L * 0.95 + D.n.y * 0.05 * L * (1 - downK),
            base.z + s * (0.03 * hl + outK * 0.08 * hl + 0.02 * hl * t)]);
          fwds.push([0, 0, -s]);     // the inner face lies against the head
        }
      }
      const K2 = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), p = path[i];
        const tipR = E.tip;
        // breadth: a triangle (prick), a rounded leaf (drop)
        let wq = E.type === "drop" ? (0.75 + 0.35 * sin(PI * Math.min(1, t * 1.15))) * (1 - sstep(0.75, 1, t) * 0.75) : Math.pow(Math.max(0.02, 1 - t), 0.85) * (1 - tipR * 0.3) + (1 - tipR) * 0.25 * sin(PI * t);
        if (t > 0.98) wq *= 0.4;
        K2.push({ x: p[0], y: p[1], z: p[2], rt: th * (1 - t * 0.45), rb: th * (1 - t * 0.45), w: Math.max(th * 1.1, bw * wq), cup: E.cup * (1 - t * 0.5),
          up: fwds[i], wts: t < 0.12 ? [BN.head, 0.4, bone, 0.6] : [bone, 1], et: t });
      }
      const prof = function (Rr, ca, sa, out) {
        out.u = Rr.rt * ca - Rr.cup * Rr.w * 0.45 * (1 - sa * sa);
        out.s = Rr.w * sa; out.f = 0;
      };
      LK.sweep(G, K2, { S: near ? 10 : 5, n: 1, prof: prof, part: "ear", capA: "pole", capLen: 0.3, capRings: near ? 1 : 0, side: [0, 0, s],
        fur: furOf(0.6, 0.0, 1) });
    }
  }

  // ---- the tail along its resting curve -------------------------------------
  function tailShape(G, D, near, furOf, tuftK) {
    const LK = CBZ.loftKit, R = D.row, T = R.tail, L = D.tailL, r0 = D.tailR;
    const prof = T.type === "brush" ? [0.85, 0.95, 1.05, 1.14, 1.2, 1.2, 1.14, 1.0, 0.78, 0.42]
      : T.type === "otter" ? [1.12, 1.05, 0.96, 0.86, 0.75, 0.64, 0.52, 0.4, 0.28, 0.16]
        : [1.0, 0.86, 0.74, 0.63, 0.53, 0.44, 0.35, 0.27, 0.19, 0.12];
    const bush = T.type === "brush" ? T.bush : 1;
    const TK = [];
    // the root starts inside the croup
    const in0 = { x: D.tailP.x + 0.035 * D.K, y: D.tailP.y + 0.005 * D.K };
    TK.push({ x: in0.x, y: in0.y, rt: r0 * 0.95, rb: r0 * 0.95, w: r0 * 0.9, wts: [BN.pelvis, 0.6, BN.tail0, 0.4] });
    for (let i = 0; i < prof.length; i++) {
      const s = i / (prof.length - 1), p = D.tailPath(s);
      const f = s * 5, k = Math.min(4, Math.floor(f)), fr = f - k;
      const wts = k >= 4 ? [BN.tail4, 1] : [BN.tail0 + k, 1 - fr, BN.tail0 + k + 1, fr];
      const rr = r0 * prof[i] * (s > 0.15 ? bush : lerp(1, bush, s / 0.15));
      TK.push({ x: p.x, y: p.y, rt: rr, rb: rr * (T.type === "brush" ? 1.1 : 1), w: rr * (T.type === "otter" ? 1.05 : 0.92), wts: wts });
    }
    const tuftT = tuftK > 0 && T.type === "brush" ? function (Rr, ca, sa, t) {
      const q = hash3(Rr.x * 157, ca * 29, sa * 31);
      if (t > 0.1 && q < 0.55 * tuftK * R.fur.tail) return { len: R.fur.len * 5.5 * R.fur.tail, w: R.fur.len * 2, down: 0.15, sign: 1 };
      return null;
    } : null;
    LK.sweep(G, TK, { S: near ? 12 : 6, step: near ? 0.036 * D.K : 0.11 * D.K, part: "tail", side: [0, 0, -1], capLen: 0.9, capRings: near ? 2 : 0,
      fur: furOf(T.type === "brush" ? 1.2 : 0.6, 0.0, 1), tufts: tuftT });
  }

  // ---- a leg: ONE loft from shoulder blade / ilium to the pastern, weights
  //      blended across every joint; then the paw
  function legShape(G, D, Lg, near, furOf, tuftK, S, step) {
    const LK = CBZ.loftKit, R = D.row, K = D.K, b = D.bone, front = Lg < 2;
    const s = Lg % 2 === 0 ? -1 : 1, ids = LEGB[Lg];
    const z = s * (front ? D.zF : D.zH);
    const KK = [];
    const add = function (p, rt, rb, w, wts, zo, o) {
      KK.push(Object.assign({ x: p.x, y: p.y, z: z + s * (zo || 0), rt: rt * b, rb: rb * b, w: w * b, wts: wts, sq: 1 }, o || {}));
    };
    const at = function (a, c, t) { return { x: lerp(a.x, c.x, t), y: lerp(a.y, c.y, t) }; };
    if (front) {
      const top = D.scapTop, sp = D.scapPiv, sh = D.shj, el = D.elb, wr = D.wri, mc = D.mcp;
      const ch = BN.chest, sc = ids[0], hu = ids[1], ra = ids[2], m = ids[3], to = ids[4];
      // the scapula: a broad flat blade under the skin of the shoulder
      // (the arm lies on the chest wall: the points of shoulder sit wider
      // than the elbows, and the leg converges to the paw)
      add({ x: top.x - 0.005 * K, y: top.y - 0.012 * K }, 0.04 * K, 0.035 * K, 0.02 * K, [ch, 0.55, sc, 0.45], -0.035 * K);
      add(at(top, sh, 0.35), 0.06 * K, 0.055 * K, 0.026 * K, [ch, 0.2, sc, 0.8], -0.012 * K);
      add(at(top, sh, 0.75), 0.058 * K, 0.06 * K, 0.032 * K, [sc, 0.85, hu, 0.15], 0.006 * K);
      // the point of shoulder, then the upper arm with the triceps behind it
      add({ x: sh.x + 0.004 * K, y: sh.y }, 0.04 * K, 0.065 * K, 0.034 * K, [sc, 0.5, hu, 0.5], 0.012 * K);
      add(at(sh, el, 0.45), 0.032 * K, 0.07 * K, 0.033 * K, [hu, 0.9, ch, 0.1], 0.01 * K);
      add(at(sh, el, 0.82), 0.03 * K, 0.058 * K, 0.03 * K, [hu, 0.85, ra, 0.15], 0.006 * K);
      // the elbow: the olecranon stands out behind
      add({ x: el.x - 0.004 * K, y: el.y + 0.004 * K }, 0.028 * K, 0.05 * K, 0.029 * K, [hu, 0.5, ra, 0.5], 0.004 * K, { elbow: 1 });
      // the forearm, round, its muscle belly high, tapering to the wrist
      add({ x: el.x + 0.006 * K, y: lerp(el.y, wr.y, 0.2) }, 0.03 * K, 0.034 * K, 0.031 * K, [ra, 0.9, hu, 0.1]);
      add({ x: el.x + 0.004 * K, y: lerp(el.y, wr.y, 0.55) }, 0.024 * K, 0.024 * K, 0.024 * K, [ra, 1]);
      add({ x: wr.x + 0.002 * K, y: lerp(el.y, wr.y, 0.88) }, 0.02 * K, 0.019 * K, 0.021 * K, [ra, 0.85, m, 0.15]);
      // the wrist (carpus), the accessory carpal pad behind it
      add({ x: wr.x + 0.002 * K, y: wr.y }, 0.021 * K, 0.026 * K, 0.023 * K, [ra, 0.5, m, 0.5]);
      add(at(wr, mc, 0.45), 0.017 * K, 0.017 * K, 0.019 * K, [m, 1]);
      add({ x: mc.x - 0.006 * K, y: mc.y + 0.008 * K }, 0.018 * K, 0.016 * K, 0.021 * K, [m, 0.6, to, 0.4]);
      // on down into the paw's body, so the pastern ends inside the foot
      add({ x: mc.x + D.toeF * 0.12, y: mc.y - 0.012 * K }, 0.016 * K, 0.015 * K, 0.02 * K, [to, 0.75, m, 0.25]);
      paw(G, D, Lg, z, s, near);
    } else {
      const hip = D.hip, st = D.stf, hk = D.hock, mt = D.mtp;
      const pv = BN.pelvis, fe = ids[0], ti = ids[1], m = ids[2], to = ids[3];
      // the haunch: from the ilium down over the hip joint, the big thigh with
      // its "pants" behind, narrowing to the stifle
      add({ x: hip.x + 0.06 * K, y: hip.y + 0.075 * K }, 0.045 * K, 0.04 * K, 0.03 * K, [pv, 0.7, fe, 0.3], -0.03 * K);
      add({ x: hip.x + 0.005 * K, y: hip.y + 0.01 * K }, 0.07 * K, 0.075 * K, 0.046 * K, [pv, 0.35, fe, 0.65], -0.008 * K);
      add(at(hip, st, 0.4), 0.062 * K, 0.08 * K, 0.044 * K, [fe, 0.95, pv, 0.05]);
      add(at(hip, st, 0.78), 0.042 * K, 0.055 * K, 0.036 * K, [fe, 0.85, ti, 0.15]);
      // the stifle
      add({ x: st.x, y: st.y }, 0.03 * K, 0.04 * K, 0.031 * K, [fe, 0.5, ti, 0.5]);
      // the gaskin: muscle behind the tibia, then the Achilles narrowing
      add(at(st, hk, 0.25), 0.022 * K, 0.042 * K, 0.026 * K, [ti, 0.95, fe, 0.05]);
      add(at(st, hk, 0.6), 0.017 * K, 0.028 * K, 0.02 * K, [ti, 1]);
      add(at(st, hk, 0.88), 0.015 * K, 0.02 * K, 0.017 * K, [ti, 0.85, m, 0.15]);
      // the hock: the point of hock (calcaneus) stands out behind
      add({ x: hk.x - 0.004 * K, y: hk.y + 0.004 * K }, 0.016 * K, 0.026 * K, 0.019 * K, [ti, 0.5, m, 0.5], 0, { hock: 1 });
      add(at(hk, mt, 0.45), 0.015 * K, 0.017 * K, 0.017 * K, [m, 1]);
      add({ x: mt.x - 0.004 * K, y: mt.y + 0.008 * K }, 0.017 * K, 0.016 * K, 0.02 * K, [m, 0.6, to, 0.4]);
      add({ x: mt.x + D.toeH * 0.12, y: mt.y - 0.012 * K }, 0.015 * K, 0.015 * K, 0.019 * K, [to, 0.75, m, 0.25]);
      paw(G, D, Lg, z, s, near);
    }
    const tuftL = tuftK > 0 ? function (Rr, ca, sa, t) {
      const q = hash3(Rr.x * 173 + Lg, ca * 37, sa * 41);
      // feathering behind the elbow / the pants behind the thigh
      if (front && t > 0.25 && t < 0.55 && ca < -0.4 && q < 0.5 * tuftK * R.fur.elbow) return { len: R.fur.len * 4 * R.fur.elbow, w: R.fur.len * 1.6, down: 0.8, sign: -1 };
      if (!front && t > 0.08 && t < 0.42 && ca < -0.3 && q < 0.6 * tuftK * R.fur.pants) return { len: R.fur.len * 4.8 * R.fur.pants, w: R.fur.len * 1.8, down: 0.85, sign: -1 };
      return null;
    } : null;
    LK.sweep(G, KK, { S: S, step: step, part: front ? "legF" : "legH", capLen: 0.5, capRings: near ? 1 : 0, fur: furOf(0.8, 0.0, -1), tufts: tuftL });
  }

  // ---- a paw: the foot pad body, four toes (III/IV forward, II/V set back
  //      and out), their pads and claws, the big metacarpal pad, the dewclaw
  function paw(G, D, Lg, z, s, near) {
    const LK = CBZ.loftKit, R = D.row, K = D.K, front = Lg < 2, ids = LEGB[Lg];
    const to = ids[front ? 4 : 3], m = ids[front ? 3 : 2];
    const J = front ? D.mcp : D.mtp, toe = front ? D.toeF : D.toeH;
    const pad = (front ? D.padF : D.padH);
    const pw = 0.034 * K * R.leg.paw * (front ? 1 : 0.92), ph = pad * 0.62;
    const cx = J.x + toe * 0.3, cy = ph * 0.72;
    const part = "paw";
    // the paw body (the toes' common base) on the toe bone; its sole is the
    // big metacarpal / metatarsal pad (aux 6: the coat paints the underside)
    LK.blob(G, [cx, cy, z], [toe * 0.62, ph * 0.85, pw * 0.92], { wts: [to, 0.8, m, 0.2], part: part, aux: 6, S: near ? 10 : 6, rings: near ? 3 : 2,
      fur: { k: 0.4 * R.fur.k, len: D.clump * 0.45, down: 0, sign: 1 } });
    if (!near) return;
    // four toes (III and IV forward, II and V set back and out), each with
    // its digital pad underneath (aux 5) and a claw curving out of its front
    const toes = [[0.92, -0.33, 0.95], [0.92, 0.33, 0.95], [0.66, -0.88, 0.8], [0.66, 0.88, 0.8]];
    for (let k = 0; k < 4; k++) {
      const q = toes[k];
      const tx = J.x + toe * q[0] * 0.78, tz = z + q[1] * pw * 0.62, tr = pw * 0.33 * q[2];
      LK.blob(G, [tx, ph * 0.6, tz], [tr * 1.25, ph * 0.6, tr], { wts: [to, 1], part: part, aux: 5, S: 8, rings: 3,
        fur: { k: 0.3 * R.fur.k, len: D.clump * 0.35, down: 0, sign: 1 } });
      LK.cone(G, [tx + tr * 1.0, ph * 0.62, tz], [tx + tr * 1.75, ph * 0.08, tz], tr * 0.3, { wts: [to, 1], part: "claw", tag: "claw", S: 5 });
    }
    if (front) {
      // the dewclaw, high on the inside of the pastern, and the carpal pad
      const dx = lerp(D.wri.x, D.mcp.x, 0.55) - 0.004 * K, dy = lerp(D.wri.y, D.mcp.y, 0.55);
      LK.blob(G, [dx, dy, z - s * 0.016 * K * R.leg.bone], [0.008 * K, 0.009 * K, 0.006 * K], { wts: [m, 1], part: part, S: 6, rings: 2 });
      LK.cone(G, [dx + 0.005 * K, dy - 0.003 * K, z - s * 0.018 * K], [dx + 0.01 * K, dy - 0.013 * K, z - s * 0.018 * K], 0.0035 * K, { wts: [m, 1], part: "claw", tag: "claw", S: 4 });
      LK.blob(G, [D.wri.x - 0.018 * K * R.leg.bone, D.wri.y - 0.01 * K, z], [0.008 * K, 0.009 * K, 0.008 * K], { wts: [m, 1], part: "pad", tag: "pad", S: 6, rings: 2 });
    }
  }

  // ---- a collar band round the neck, on its own bone (scaled away when the
  //      dog wears none, so the body stays one draw)
  function collarShape(G, D, near) {
    const LK = CBZ.loftKit, R = D.row, nr = D.neckR * (R.ruff > 1 ? 1 + (R.ruff - 1) * 0.5 : 1);
    const c = D.collarP;
    const ax = { x: D.headP.x - D.neckB.x, y: D.headP.y - D.neckB.y }, al = hypot(ax.x, ax.y);
    const ux = ax.x / al, uy = ax.y / al, wd = 0.013 * D.K;
    // a band: its edges tuck back into the neck so no end is ever open to view
    const K2 = [], prof = [0.96, 1.1, 1.1, 0.96];
    for (let i = 0; i < 4; i++) {
      const t = (i / 3 - 0.5) * 2, k = prof[i];
      K2.push({ x: c.x + ux * wd * t, y: c.y + uy * wd * t, rt: nr * 1.02 * k, rb: nr * 1.1 * k * (1 + (R.dewlap || 0) * 0.3), w: nr * 1.02 * k, wts: [BN.collar, 1], tag: "collar" });
    }
    LK.sweep(G, K2, { S: 16, n: 1, part: "collar", tag: "collar", capA: "open", capB: "open" });
  }

  // ==========================================================================
  //  CACHE: shape per (row, mutt shape, sex, lod); colour per (coat, collar)
  // ==========================================================================
  const _shapes = new Map(), _geos = new Map();
  function shapeOf(D, lod) {
    const key = D.row.id + "|" + (D.row.shapeSeed != null ? D.row.shapeSeed : "") + "|" + D.sex + "|" + lod;
    let s = _shapes.get(key);
    if (!s) {
      const out = buildShape(D, lod);
      const b = CBZ.loftKit.build(out.G, { colour: function () { return 0x808080; }, boundingSphere: out.bs });
      s = { shape: b.shape, geo: b.geo, bs: out.bs, key: key };
      _shapes.set(key, s);
    }
    return s;
  }
  function geoOf(D, lod, coat, collarHex) {
    const sh = shapeOf(D, lod);
    const key = sh.key + "|" + coat + "|" + (collarHex == null ? "-" : collarHex);
    let g = _geos.get(key);
    if (!g) {
      const C = D.row.coats[coat] || D.row.coats[Object.keys(D.row.coats)[0]];
      const fn = coatFn(D, C, (D.row.id.length * 977) ^ (coat.length * 131), collarHex);
      g = CBZ.loftKit.variant(sh.shape, fn, sh.bs);
      _geos.set(key, g);
    }
    return g;
  }
  function pickCoat(R, r) {
    const keys = Object.keys(R.coats), w = R.coatW || {};
    let tot = 0; for (let i = 0; i < keys.length; i++) tot += w[keys[i]] != null ? w[keys[i]] : 1;
    let x = r() * tot;
    for (let i = 0; i < keys.length; i++) { x -= w[keys[i]] != null ? w[keys[i]] : 1; if (x <= 0) return keys[i]; }
    return keys[0];
  }

  /* rig(id, o) -> the body.
       o.seed, o.sex ("m"|"f"|null = rolled), o.coat, o.shape (mutt cross),
       o.scale (mesh scale, e.g. 1 / the bestiary row's scale), o.collar */
  function makeRig(id, o) {
    o = o || {};
    const THREE = W.THREE;
    const seed = Math.abs((o.seed | 0) || 1);
    const r = mkRng(seed * 2654435761 + 17);
    let R0 = ROWS[id] || ROWS.mutt;
    const sex = o.sex || (r() < 0.5 ? "m" : "f");
    const shape = R0.mix ? (o.shape != null ? o.shape : seed % 6) : null;
    const D = dims(R0, { sex: sex, shape: shape });
    tailSetup(D); legBind(D);
    const R = D.row;
    const coat = o.coat && R.coats[o.coat] ? o.coat : pickCoat(R, r);
    const geo = geoOf(D, 0, coat, null);
    const sk = makeSkeleton(D, "canid");
    const mat = CBZ.loftKit.furMaterial("canid-fur");
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(sk.bones[0]);
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(sk.bones);
    mesh.bind(skeleton);
    mesh.castShadow = true;
    mesh.name = R.id + "-body";
    // a sphere that holds every pose (a skinned mesh would otherwise measure
    // its bind pose once, vertex by vertex, and cull a lunging head)
    const radius = D.withers * 1.35 + D.tailL * 0.5;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, D.withers * 0.5, 0), radius);
    const indiv = o.indiv != null ? o.indiv : 0.97 + r() * 0.06;
    mesh.scale.setScalar(indiv * (o.scale || 1));
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    const rig = {
      group: group, mesh: mesh, bones: sk.bones, bindPos: sk.bindPos, skeleton: skeleton, D: D, dims: D, row: R, id: R.id,
      breed: R.id, coat: coat, sex: sex, indiv: indiv, rng: r, seed: seed,
      G: CBZ.quadGait.create(D, D.table), st: null, collarHex: null, lod: 0, lodT: 0,
      mouthW: { x: 0, y: 0, z: 0 }, mouthOk: false,
      legA: [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)],
    };
    rig.bones[BN.collar].scale.setScalar(1e-4);
    group.userData.canidRig = rig;
    return rig;
  }
  function collar(rig, hex) {
    rig.collarHex = hex == null ? null : hex;
    rig.bones[BN.collar].scale.setScalar(hex == null ? 1e-4 : 1);
    if (rig.lod === 0) rig.mesh.geometry = geoOf(rig.D, 0, rig.coat, rig.collarHex);
    else rig.mesh.geometry = geoOf(rig.D, 1, rig.coat, rig.collarHex);
    return hex == null ? null : rig.mesh;
  }

  // ==========================================================================
  //  POSE — one frame of motion. ctrl (all optional):
  //    x z y heading     the body's world placement (y = its ground)
  //    posture           "stand" | "sit" | "lie" | "bow" | "side" | "dead"
  //    alert aggr fear happy sniff threat (0..1), pant (null = from effort)
  //    lookYaw lookPitch (rad, from the nose) or look {x,y,z} (world)
  //    bark bite yelp (one-shot), shake (worry), tilt, howl (0..1)
  //    lunge (-1 gather .. 1 strike), hold (0..1), rearUp, lowBite (0..1)
  //    flinch (0..1, side via flinchS), limp [4] (0..1)
  //    mouthTo {x,y,z}   the jaw reaches for this world point (a grip)
  //    ground(x, z)      world floor height; idle (false = no idle life)
  // ==========================================================================
  function newState(rig) {
    return { t: 0, px: null, pz: null, ph: 0, v: 0, vl: 0, turn: 0, alert: 0, aggr: 0, fear: 0, happy: 0, sniff: 0, pant: 0, threat: 0,
      sit: 0, lie: 0, bow: 0, side: 0, dead: 0, lookY: 0, lookP: 0, tilt: 0, barkT: 0, biteT: 0, yelpT: 0, shake: 0, howl: 0,
      lunge: 0, hold: 0, rearUp: 0, lowBite: 0, flinch: 0, wagPh: rig.rng() * 6, breathPh: rig.rng() * 6, wasPost: false,
      gF: 0, gH: 0, cyV: 0, cyP: 0, earA: [0, 0], earV: [0, 0], tailY: [0, 0, 0, 0, 0], tailYV: [0, 0, 0, 0, 0], tailP: [0, 0, 0, 0, 0], tailPV: [0, 0, 0, 0, 0],
      idleT: 0, act: "", actT: 0, actDur: 0, idleNext: 3 + rig.rng() * 4, lookTo: 0, flickT: 0, flickS: 0, mouthK: 0 };
  }
  const _ik = [0, 0];
  function ik2(jx, jy, tx, ty, a, b, bend, out) {
    let dx = tx - jx, dy = ty - jy, d = hypot(dx, dy);
    const dmin = abs(a - b) + 1e-4, dmax = a + b - 1e-4;
    if (d < 1e-6) { dx = 0; dy = -1; d = dmin; }
    const dc = clamp(d, dmin, dmax);
    const base = atan2(dy, dx);
    const A = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
    const t1 = base + bend * A;
    const ex = jx + a * cos(t1), ey = jy + a * sin(t1);
    out[0] = t1; out[1] = atan2(ty - ey, tx - ex);
    return out;
  }
  // bone rotations written straight into the quaternion three composes from
  // (Euler.set would run its change callback, a full Euler -> quaternion
  // pass, ~40 times per animal per frame). XYZ order, THREE.Euler's default.
  function rz(b, a) { const q = b.quaternion, h = a * 0.5; q._x = 0; q._y = 0; q._z = sin(h); q._w = cos(h); }
  function rxyz(b, x, y, z) {
    const q = b.quaternion, c1 = cos(x * 0.5), c2 = cos(y * 0.5), c3 = cos(z * 0.5), s1 = sin(x * 0.5), s2 = sin(y * 0.5), s3 = sin(z * 0.5);
    q._x = s1 * c2 * c3 + c1 * s2 * s3; q._y = c1 * s2 * c3 - s1 * c2 * s3; q._z = c1 * c2 * s3 + s1 * s2 * c3; q._w = c1 * c2 * c3 - s1 * s2 * s3;
  }
  // model point -> a trunk bone's local frame (rotation XYZ: roll x, yaw y, pitch z)
  const _v = { x: 0, y: 0, z: 0 };
  function toBoneLocal(px, py, pz, bx, by, bz, rx, ry, rz, out) {
    let x = px - bx, y = py - by, z = pz - bz;
    // inverse of Rx Ry Rz is Rz^-1 Ry^-1 Rx^-1, applied right to left: Rx^-1 first
    let c = cos(-rx), s = sin(-rx);
    let y1 = c * y - s * z, z1 = s * y + c * z; y = y1; z = z1;
    c = cos(-ry); s = sin(-ry);
    let x1 = c * x + s * z; z1 = -s * x + c * z; x = x1; z = z1;
    c = cos(-rz); s = sin(-rz);
    x1 = c * x - s * y; y1 = s * x + c * y;
    out.x = x1; out.y = y1; out.z = z;
    return out;
  }
  // the support pattern of one end of the body (front or hind) at this phase:
  // + = up. Stance: the walk vaults over the leg, faster gaits compress it;
  // airborne: the ballistic arc between lift-off and touchdown.
  function endLift(G, ends, f, walkK, Av, Ac, sc) {
    const M = G.mix, duty = M.duty, ph = G.phase;
    let comp = 0, any = false, tauMin = 9, lamMin = 9;
    for (let k = 0; k < ends.length; k++) {
      const i = ends[k], p = frac(ph + M.off[i]);
      if (p < duty) { any = true; comp += sin(PI * p / duty); }
      else {
        const tau = p - duty, lam = 1 - p;
        if (tau < tauMin) tauMin = tau;
        if (lam < lamMin) lamMin = lam;
      }
    }
    if (any) return walkK * Av * Math.min(1, comp) - (1 - walkK) * Ac * Math.min(1, comp);
    const ts = tauMin / Math.max(0.3, f), ls = lamMin / Math.max(0.3, f);
    return 0.5 * G0 * ts * ls / sc;
  }
  const FRONT = [0, 1], HIND = [2, 3];
  function pose(rig, dt, c) {
    c = c || {};
    // a corpse something else lays down (the ragdoll, a tumble) rests bodily
    if (rig.ragdoll || ((c.dead || c.posture === "dead") && tipped(rig.group))) {
      if (!rig.ragdoll && !rig._limp) { limpPose(rig); rig._limp = true; }
      restCorpse(rig, c);
      return rig.st || (rig.st = newState(rig));
    }
    if (rig._limp || rig.mesh.position.y !== 0 || rig.mesh.position.x !== 0 || rig.mesh.position.z !== 0) { rig._limp = false; rig._rc = null; rig.mesh.position.set(0, 0, 0); }
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const D = rig.D, R = D.row, K = D.K, b = rig.bones, bp = rig.bindPos, mesh = rig.mesh;
    const st = rig.st || (rig.st = newState(rig));
    st.t += dt;
    // world metres per model metre (the group may be scaled by its host)
    const sc = (mesh.scale.x || 1) * ((mesh.parent && mesh.parent.scale) ? mesh.parent.scale.x || 1 : 1);
    const gx = c.x || 0, gz = c.z || 0, h = c.heading || 0, gy = c.y || 0;
    lodCheck(rig, gx, gy, gz, dt);
    // ---- measured motion (whatever moved the body, the legs answer to it)
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * cos(h) + mdz * sin(h)) / dt / sc, vl = (-mdx * sin(h) + mdz * cos(h)) / dt / sc, turn = wrapPi(h - st.ph) / dt;
    const ground = c.ground ? groundFn(rig, c.ground, sc, gy) : null;
    if (mdx * mdx + mdz * mdz > 9 * sc * sc) { v = 0; vl = 0; turn = 0; CBZ.quadGait.reset(rig.G, gx / sc, gz / sc, h, ground, 0); }
    st.px = gx; st.pz = gz; st.ph = h;
    st.v = approach(st.v, clamp(v, -4, 24), 9, dt);
    st.vl = approach(st.vl, clamp(vl, -4, 4), 9, dt);
    st.turn = approach(st.turn, clamp(turn, -9, 9), 9, dt);
    const av = abs(st.v), vw = av * sc;
    // ---- moods, eased
    st.alert = approach(st.alert, clamp(c.alert || 0, 0, 1), 5, dt);
    st.aggr = approach(st.aggr, clamp(c.aggr || 0, 0, 1), 6, dt);
    st.fear = approach(st.fear, clamp(c.fear || 0, 0, 1), 5, dt);
    st.happy = approach(st.happy, clamp(c.happy || 0, 0, 1), 4, dt);
    st.threat = approach(st.threat, clamp(c.threat || 0, 0, 1), 6, dt);
    st.sniff = approach(st.sniff, clamp(c.sniff || 0, 0, 1), 3, dt);
    const effort = Math.min(1, vw / (3.2 * sqrt(K)));
    st.pant = approach(st.pant, clamp(c.pant != null ? c.pant : effort * 0.9 + (st.pant > 0.4 ? 0.15 : 0), 0, 1), effort > st.pant ? 1.5 : 0.25, dt);
    st.tilt = approach(st.tilt, c.tilt || 0, 4, dt);
    st.shake = approach(st.shake, c.shake ? 1 : 0, 10, dt);
    st.howl = approach(st.howl, clamp(c.howl || 0, 0, 1), 2.4, dt);
    st.lunge = approach(st.lunge, clamp(c.lunge || 0, -1, 1), 30, dt);
    st.hold = approach(st.hold, clamp(c.hold || 0, 0, 1), 12, dt);
    st.rearUp = approach(st.rearUp, clamp(c.rearUp || 0, 0, 1), 9, dt);
    st.lowBite = approach(st.lowBite, clamp(c.lowBite || 0, 0, 1), 9, dt);
    if (c.flinch > st.flinch) { st.flinch = c.flinch; st.flinchS = c.flinchS || 1; }
    st.flinch = Math.max(0, st.flinch - dt * 3.2);
    if (c.bark && st.barkT <= 0) st.barkT = 0.24;
    if (c.bite && st.biteT <= 0) st.biteT = 0.34;
    if (c.yelp && st.yelpT <= 0) st.yelpT = 0.32;
    if (st.barkT > 0) st.barkT = Math.max(0, st.barkT - dt);
    if (st.biteT > 0) st.biteT = Math.max(0, st.biteT - dt);
    if (st.yelpT > 0) st.yelpT = Math.max(0, st.yelpT - dt);
    // ---- idle life (only when nothing is asked of the animal)
    let post = c.posture || "stand";
    const still = av < 0.12 && abs(st.turn) < 0.3;
    const calm = st.aggr < 0.2 && st.fear < 0.3 && st.threat < 0.2 && !c.mouthTo && st.hold < 0.1 && abs(st.lunge) < 0.1;
    idle(rig, st, dt, still && calm && c.idle !== false && post !== "dead" && post !== "side", post);
    if (st.act === "scratch" && post === "stand") post = "sit";
    st.sit = approach(st.sit, post === "sit" ? 1 : 0, 3.2, dt);
    st.lie = approach(st.lie, post === "lie" ? 1 : 0, 2.6, dt);
    st.bow = approach(st.bow, post === "bow" ? 1 : 0, 4, dt);
    st.side = approach(st.side, post === "side" || post === "dead" ? 1 : 0, post === "dead" ? 6 : 2, dt);
    st.dead = approach(st.dead, post === "dead" ? 1 : 0, 6, dt);
    // ---- deep water: the dog swims (swimSense); nothing sits or lies there
    const SW = swimSense(rig, st, c, gx, gz, gy, sc, dt), wP = SW.k;
    const sitK = st.sit * (1 - wP), lieK = Math.min(st.lie, 1 - st.sit) * (1 - wP), bowK = Math.min(st.bow, 1 - st.sit - Math.min(st.lie, 1 - st.sit)) * (1 - wP), sideK = st.side * (1 - wP);
    const postK = Math.max(sitK, lieK, bowK, sideK, wP);
    // ---- the gait (standing): feet plant; the trot single-tracks
    const G = rig.G, M = G.mix;
    const trotK = (M.wT || 0) + (M.wC || 0) * 0.6, galK = M.wG || 0;
    for (let i = 0; i < 4; i++) G.D.feet[i].z = (i < 2 ? (i % 2 ? 1 : -1) * D.zF : (i % 2 ? 1 : -1) * D.zH) * (1 - 0.6 * trotK - 0.4 * galK);
    if (postK < 0.08) {
      if (st.wasPost) { CBZ.quadGait.reset(G, gx / sc, gz / sc, h, ground, 0); st.wasPost = false; }
      CBZ.quadGait.step(G, dt, st.v, st.turn, gx / sc, gz / sc, h, ground, 0);
    } else st.wasPost = true;
    const moveK = clamp(av / (0.4 * sqrt(K)), 0, 1) * (1 - postK);
    const wW = (M.wW || 0), gal = galK * moveK, lope = (M.wC || 0) * moveK, trot = (M.wT || 0) * moveK;
    const ph = G.phase * TAU;
    // ---- the trunk: support pattern + terrain + spine
    const legL = D.legLen, f = M.f || 1;
    const Av = 0.02 * legL * moveK, Ac = (0.022 + 0.02 * (gal + lope)) * legL * moveK;
    const liftF = moveK > 0.01 ? endLift(G, FRONT, f, wW, Av, Ac, sc) : 0;
    const liftH = moveK > 0.01 ? endLift(G, HIND, f, wW, Av, Ac, sc) : 0;
    // the ground under each end (planted paws), followed smoothly
    let gF = 0, nF = 0, gH = 0, nH = 0;
    for (let i = 0; i < 4; i++) { const Fo = G.feet[i]; if (!Fo.sw) { if (i < 2) { gF += Fo.ly; nF++; } else { gH += Fo.ly; nH++; } } }
    if (nF) st.gF = approach(st.gF, gF / nF, 10, dt);
    if (nH) st.gH = approach(st.gH, gH / nH, 10, dt);
    const cr = Math.max(st.aggr * 0.35, st.fear * 0.8, st.threat * 0.6);
    let pX = D.pelv.x, pY = D.pelv.y + liftH + st.gH * (1 - postK), pZ = 0, pR = 0, pRx = 0, pRy = 0;
    let cX = D.chest.x, cY = D.chest.y + liftF + st.gF * (1 - postK), cZ = 0, cR = 0, cRx = 0, cRy = 0;
    const Lb = D.chest.x - D.pelv.x;
    // the trunk pitches with the height difference of its two ends
    const pitch = atan2((cY - D.chest.y) - (pY - D.pelv.y), Lb);
    pR += pitch; cR += pitch;
    // gallop: the spine flexes in the gathered suspension, extends in the extended one
    const gPh = galPhase(M);
    const flex = (0.17 * gal + 0.07 * lope) * cos(TAU * (G.phase - gPh));
    pR += flex * 0.65; cR -= flex * 0.45;
    pX += 0.04 * K * flex; cX -= 0.03 * K * flex;
    // carriage: lower and longer at speed, crouched in fear / threat / stalk
    pY -= 0.02 * K * (gal + lope); cY -= 0.03 * K * (gal + lope);
    pY -= 0.07 * K * cr * (1 + st.fear * 0.4); cY -= 0.055 * K * cr;
    pR += 0.1 * st.fear;
    cX += 0.025 * K * st.threat;
    // lean into turns (centripetal), sway at the walk
    const lean = clamp(Math.atan(vw * st.turn / G0), -0.38, 0.38) * moveK;
    const sway = 0.035 * wW * moveK * sin(ph + 0.6);
    pRx += lean * 0.8 + sway; cRx += lean + sway * 0.6;
    pRy += 0.04 * wW * moveK * sin(ph); cRy -= 0.035 * wW * moveK * sin(ph);
    // fight envelopes: the lunge drives the chest, a hold braces back
    cX += 0.12 * K * st.lunge; pX += 0.05 * K * st.lunge; cY -= 0.03 * K * Math.max(0, -st.lunge) * 2;
    pX -= 0.05 * K * st.hold; pY -= 0.07 * K * st.hold; cX -= 0.02 * K * st.hold;
    // biting low (a leg, a body on the ground) the forequarters go down with
    // the head, so the neck does not have to stand the skull on end
    cY -= 0.11 * K * st.lowBite; cR -= 0.10 * st.lowBite;
    const rise = st.rearUp * D.withers * 0.45;
    cY += rise; cR += Math.atan2(rise, Lb) * 0.7; pY -= 0.03 * K * st.rearUp;
    // a leap: the body flies its ballistic arc (ctrl.airH, model metres),
    // nose a little up on the take-off, down for the landing
    const air = clamp(c.air || 0, 0, 1);
    st.air = approach(st.air || 0, air, 25, dt);
    if (st.air > 0.01) {
      const ah = (c.airH || 0.18 * K) * st.air, tilt = (c.airTilt || 0) * 0.25;
      pY += ah; cY += ah; pR += tilt; cR += tilt;
    } else if (st.wasAir) { CBZ.quadGait.reset(G, gx / sc, gz / sc, h, ground, 0); }
    st.wasAir = st.air > 0.3;
    const fl = st.flinch;
    cY -= 0.02 * K * fl; pY -= 0.015 * K * fl; cZ += 0.015 * K * fl * (st.flinchS || 1); cRx += 0.12 * fl * (st.flinchS || 1);
    // a shake-off: the trunk rolls fast, the wave running back from the head
    if (st.act === "shake") {
      const fq = 4.3 * Math.pow(D.mass / 30, -0.22), e = sin(PI * clamp(st.actT / st.actDur, 0, 1));
      cRx += 0.55 * e * sin(TAU * fq * st.actT); pRx += 0.45 * e * sin(TAU * fq * st.actT - 1.2);
    }
    // ---- postures
    const P = postures(rig);
    const wS = sitK, wL = lieK, wB = bowK, wD = sideK, wSt = Math.max(0, 1 - wS - wL - wB - wD);
    pX = pX * wSt + P.sit.pX * wS + P.lie.pX * wL + P.bow.pX * wB + P.side.pX * wD;
    pY = pY * wSt + P.sit.pY * wS + P.lie.pY * wL + P.bow.pY * wB + P.side.pY * wD;
    cX = cX * wSt + P.sit.cX * wS + P.lie.cX * wL + P.bow.cX * wB + P.side.cX * wD;
    cY = cY * wSt + P.sit.cY * wS + P.lie.cY * wL + P.bow.cY * wB + P.side.cY * wD;
    pR = pR * wSt + P.sit.R * wS + P.lie.R * wL + P.bow.R * wB;
    cR = cR * wSt + P.sit.R * wS + P.lie.R * wL + P.bow.R * wB;
    pRx = pRx * (1 - wD) + wD * 1.45; cRx = cRx * (1 - wD) + wD * 1.45;
    // swimming: the trunk floats, the withers awash, the front a little high
    // (the lungs are forward), the hindquarters lower
    if (wP > 0.001) {
      const lift = 0.5 * (D.chest.x - D.pelv.x) * sin(SWIM_PITCH), dy = (SW.surfM - 0.045 * K) - D.withers;
      pX = lerp(pX, D.pelv.x, wP); pY = lerp(pY, D.pelv.y + dy - lift, wP);
      cX = lerp(cX, D.chest.x, wP); cY = lerp(cY, D.chest.y + dy + lift, wP);
      pR = lerp(pR, SWIM_PITCH, wP); cR = lerp(cR, SWIM_PITCH, wP);
      pRx *= 1 - wP; cRx *= 1 - wP; pRy *= 1 - wP; cRy *= 1 - wP;
    }
    // at rest the trunk sits on what touches the ground (restSolve)
    const RS = st.rest;
    if (RS && RS.on) { cY += RS.Fa; pY += RS.Ba; }
    // lying down on a slope the body lies along it: the trunk turns with the
    // ground about the ground under it (and the legs, posed in its own frame
    // toward targets that turn with it, follow unchanged)
    const lyK = wD + wL;
    let tA = 0, tC = 0;
    if (lyK > 0.01 && typeof c.ground === "function") {
      const e = 0.5, ch = cos(h), sh = sin(h);
      const a1 = c.ground(gx + e * ch, gz + e * sh), a0 = c.ground(gx - e * ch, gz - e * sh);
      const c1 = c.ground(gx - e * sh, gz + e * ch), c0 = c.ground(gx + e * sh, gz - e * ch);
      if (isFinite(a1) && isFinite(a0)) tA = Math.atan((a1 - a0) / (2 * e)) * lyK;
      if (isFinite(c1) && isFinite(c0)) tC = -Math.atan((c1 - c0) / (2 * e)) * (wD + 0.7 * wL);
    }
    st.tA = approach(st.tA || 0, clamp(tA, -0.6, 0.6), 4, dt); st.tC = approach(st.tC || 0, clamp(tC, -0.6, 0.6), 4, dt);
    // ---- write the trunk
    b[BN.pelvis].position.set(pX, pY, pZ); rxyz(b[BN.pelvis], pRx, pRy, pR);
    b[BN.chest].position.set(cX, cY, cZ); rxyz(b[BN.chest], cRx, cRy, cR);
    b[BN.loin].position.set((pX + cX) / 2 + (D.loin.x - (D.pelv.x + D.chest.x) / 2), (pY + cY) / 2 + (D.loin.y - (D.pelv.y + D.chest.y) / 2), (pZ + cZ) / 2);
    rxyz(b[BN.loin], (pRx + cRx) / 2, (pRy + cRy) / 2, (pR + cR) / 2);
    if (abs(st.tA) + abs(st.tC) > 1e-4) tiltTrunk(rig, st.tA, st.tC, (pX + cX) / 2);
    // ---- legs
    const TT = rig._T || (rig._T = {});
    TT.pX = pX; TT.pY = pY; TT.pZ = pZ; TT.pR = pR; TT.pRx = pRx; TT.pRy = pRy; TT.cX = cX; TT.cY = cY; TT.cZ = cZ; TT.cR = cR; TT.cRx = cRx; TT.cRy = cRy;
    TT.wP = wP; TT.bedM = SW.bedM != null ? SW.bedM : -1e9;
    if (wP > 0.001) st.padPh = (st.padPh || 0) + dt * (1.35 + 0.6 * clamp(av / (0.6 * sqrt(K)), 0, 1)) * Math.pow(0.62 / D.withers, 0.3);
    legs(rig, st, P, TT, wS, wL, wB, wD, c);
    // ---- neck, head, jaw, ears, tail, breath
    const KK = rig._K || (rig._K = {});
    KK.cR = cR; KK.cRx = cRx; KK.moveK = moveK; KK.gal = gal; KK.trot = trot; KK.wW = wW; KK.ph = ph; KK.lope = lope;
    KK.sitK = sitK; KK.lieK = lieK; KK.sideK = sideK; KK.bowK = bowK; KK.fl = fl; KK.turn = st.turn; KK.liftH = liftH; KK.swimK = wP;
    KK.swimN = st.swimN == null ? 0.3 : st.swimN;
    headNeck(rig, st, c, dt, KK);
    tail(rig, st, dt, KK);
    if (RS && RS.on) { b[BN.neck].quaternion.multiply(RS.qNa); b[BN.tail0].quaternion.multiply(RS.qTa); }
    breath(rig, st, dt, effort);
    if (RS && RS.on) {
      // the flank settled onto the ground: the ribs down along the world's down
      const rbn = b[BN.ribs];
      rbn.position.copy(bp[BN.ribs]);
      if (RS.sagA > 1e-6) { restTemps(); _rV.set(0, -RS.sagA, 0).applyQuaternion(_rQi.copy(b[BN.chest].quaternion).invert()); rbn.position.add(_rV); }
    }
    const hk = Math.max(st.aggr * 0.7, st.threat, st.fear * 0.5) * (1 - st.dead);
    b[BN.hackle].position.set(bp[BN.hackle].x, bp[BN.hackle].y + 0.03 * K * hk, 0);
    // ---- swimming, the neck carries the mouth just clear of the water: the
    //      posed mouth's height over the surface steers the neck's lift
    if (wP > 0.05 && SW.surf != null) {
      const mo = mouthWorld(rig, _swM);
      const err = (0.045 * K * sc - (mo.y - SW.surf)) / (0.3 * K * sc);
      st.swimN = clamp((st.swimN == null ? 0.3 : st.swimN) + clamp(err, -0.15, 0.15) * 5 * dt, -0.5, 0.9);
    }
    // ---- held up by what touches the ground while it rests
    const RW = st.restW || (st.restW = { sit: 0, lie: 0, side: 0, bow: 0 });
    RW.sit = sitK; RW.lie = lieK; RW.side = sideK; RW.bow = bowK;
    restStep(rig, st, c, dt, RW);
    // ---- the live mouth (bites, holds and the hosts' jaw seams read it)
    if (rig.trackMouth) mouthWorld(rig, rig.mouthW);
    return st;
  }
  // the middle of the gathered suspension (the last forefoot up, the first
  // hind foot not yet down): the spine's deepest flexion
  function galPhase(M) {
    const d = M.duty, o = M.off;
    const liftF = Math.max(frac(-o[0]), frac(-o[1])) + d;
    let landH = Math.min(frac(-o[2]), frac(-o[3]));
    while (landH < liftF) landH += 1;
    return frac((liftF + landH) / 2);
  }
  function groundFn(rig, fn, sc, gy) {
    const gf = rig._gf || (rig._gf = { fn: null, sc: 1, gy: 0, f: null });
    gf.fn = fn; gf.sc = sc; gf.gy = gy;
    if (!gf.f) gf.f = function (x, z) {
      const y = gf.fn(x * gf.sc, z * gf.sc);
      return (y == null || !isFinite(y)) ? null : (y - gf.gy) / gf.sc;
    };
    return gf.f;
  }

  // ---- posture targets (model space), derived from the body's own joints
  function postures(rig) {
    if (rig._post) return rig._post;
    const D = rig.D, K = D.K;
    const Lt = hypot(D.shj.x - D.hip.x, D.shj.y - D.hip.y);
    // SIT: front legs straight under the shoulders, the rump down on the ground
    const shY = D.shj.y * 0.97, hipY = D.padH + 0.09 * K;
    const sR = Math.asin(clamp((shY - hipY) / Lt, -0.95, 0.95)) * 0.92;
    const shX = D.mcp.x + 0.02 * K, hipX = shX - Lt * cos(sR);
    const sit = { R: sR, cX: 0, cY: 0, pX: 0, pY: 0, hip: { x: hipX, y: hipY }, sh: { x: shX, y: shY } };
    trunkFrom(D, sit, sR, hipX, hipY);
    // LIE (sphinx): the sternum and the folded haunches on the ground
    const lR = 0.06;
    const lie = { R: lR, cX: 0, cY: 0, pX: 0, pY: 0 };
    lie.cX = D.chest.x + 0.02 * K; lie.cY = D.chest.y - (D.yBrisket - 0.015 * K);
    lie.pX = D.pelv.x + 0.04 * K;
    lie.pY = Math.max(lie.cY - sin(lR) * (D.chest.x - D.pelv.x) - 0.01 * K, D.pelv.y - (D.hip.y - 0.13 * K) + 0.012 * K);
    lie.hipY = D.hip.y - (D.pelv.y - lie.pY);
    // PLAY BOW: elbows down, rump up
    const bR = -0.42;
    const bow = { R: bR, cX: D.chest.x + 0.03 * K, cY: D.chest.y - (D.elb.y - 0.03 * K) * 0.85, pX: D.pelv.x, pY: 0 };
    bow.pY = bow.cY - sin(bR) * (D.chest.x - D.pelv.x);
    // the forelegs of the lie and the bow: the elbow down on the ground, the
    // forearm and the pastern laid flat forward from it
    const flat = function (P) {
      const ox = D.shj.x - D.chest.x, oy = D.shj.y - D.chest.y;
      const sx = P.cX + cos(P.R) * ox - sin(P.R) * oy, sy = P.cY + sin(P.R) * ox + cos(P.R) * oy;
      const ey = 0.026 * K * D.bone, drop = clamp(sy - ey, 0, D.humL * 0.98);
      const ex = sx - sqrt(D.humL * D.humL - drop * drop);
      // the knuckle rests at its standing height: the paw lies flat on its pads
      P.fx = ex + D.radL + D.mcL; P.fy = Math.max(ey * 0.9, D.padF);
    };
    // the trunk's underside must stay on (not in) the ground: its lowest
    // points, carried by their bones, lift both ends if any sinks
    const under = [[D.xB + 0.03 * K, D.hip.y - 0.13 * K, 0], [D.xB - 0.025 * K, D.hip.y - 0.075 * K, 0], [D.hip.x + 0.03 * K, D.yBelly - 0.035 * K, 0],
      [D.xIl, D.yBelly - 0.01 * K, 0], [D.xLR, lerp(D.yBelly, D.yBrisket, 0.42), 0.5],
      [D.elb.x + 0.025 * K, D.yBrisket, 1], [D.xWith, D.yBrisket + 0.012 * K, 1], [D.shj.x + 0.03 * K, D.yBrisket + 0.11 * K, 1]];
    const clear = function (P) {
      let lo = 9;
      for (let i = 0; i < under.length; i++) {
        const q = under[i], k = q[2];
        const ox = q[0] - (k < 0.5 ? D.pelv.x : D.chest.x), oy = q[1] - (k < 0.5 ? D.pelv.y : D.chest.y);
        const bx = k < 0.5 ? P.pY : P.cY;
        const y = bx + sin(P.R) * ox + cos(P.R) * oy;
        if (y < lo) lo = y;
      }
      const lift = 0.006 * K - lo;
      if (lift > 0) { P.pY += lift; P.cY += lift; if (P.hip) P.hip.y += lift; if (P.fy != null) P.fy += 0; }
    };
    clear(sit); clear(lie); clear(bow);
    flat(lie); flat(bow);
    // SIDE (asleep / dead without a ragdoll): rolled onto a flank
    const side = { R: 0, cX: D.chest.x, cY: D.ribW * 0.95, pX: D.pelv.x, pY: D.croupW * 0.95 };
    rig._post = { sit: sit, lie: lie, bow: bow, side: side, Lt: Lt };
    return rig._post;
  }
  function trunkFrom(D, P, R, hipX, hipY) {
    // place pelvis / chest bones so the hip joint lands at (hipX, hipY) with pitch R
    const ox = D.hip.x - D.pelv.x, oy = D.hip.y - D.pelv.y;
    P.pX = hipX - (cos(R) * ox - sin(R) * oy); P.pY = hipY - (sin(R) * ox + cos(R) * oy);
    const cx0 = D.chest.x - D.pelv.x, cy0 = D.chest.y - D.pelv.y;
    P.cX = P.pX + cos(R) * cx0 - sin(R) * cy0; P.cY = P.pY + sin(R) * cx0 + cos(R) * cy0;
  }

  // ==========================================================================
  //  IN WATER — deeper than a dog can wade it swims: the trunk floats at the
  //  surface. The surface is the host's (ctrl.water, world y) or the water's
  //  own query (CBZ.waterSample: the surface and the depth under it); a dog
  //  wades with the water up to its chest and swims where it cannot stand.
  // ==========================================================================
  const SWIM_PITCH = 0.22;
  const _swM = { x: 0, y: 0, z: 0 };
  const _wsO = {};
  function swimSense(rig, st, c, gx, gz, gy, sc, dt) {
    const S = st.wat || (st.wat = { t: 0, depth: 0, surf: null, k: 0, surfM: 0 });
    S.t -= dt;
    if (S.t <= 0) {
      S.t = 0.12;
      let surf = null, depth = 0;
      if (c.water != null && isFinite(c.water)) { surf = c.water; depth = surf - gy; }
      else if (typeof CBZ.cityWaterAt === "function") {
        let wet = false;
        try { wet = !!CBZ.cityWaterAt(gx, gz); } catch (e) { wet = false; }
        if (wet) {
          try {
            if (typeof CBZ.waterSample === "function") { const w = CBZ.waterSample(gx, gz, _wsO, null); surf = w.y; depth = w.depth; }
            else if (typeof CBZ.citySeaHeightAt === "function") { surf = CBZ.citySeaHeightAt(gx, gz); depth = surf - gy; }
          } catch (e) { surf = null; }
        }
      }
      S.surf = surf != null && isFinite(surf) ? surf : null; S.depth = isFinite(depth) ? depth : 0;
    }
    const Wd = rig.D.withers * sc;
    const want = S.surf == null ? 0 : sstep(0.7 * Wd, 1.05 * Wd, S.depth);
    S.k = approach(S.k, want, 2.2, dt);
    if (S.k < 1e-3 && want === 0) S.k = 0;
    if (S.surf != null) { S.surfM = (S.surf - gy) / sc; S.bedM = S.surfM - S.depth / sc; }
    return S;
  }

  // ==========================================================================
  //  AT REST — a body lying, sitting or dead is held up by what touches the
  //  ground. A sparse set of the shell's own vertices is skinned on the CPU
  //  (the same weighted sum the GPU does). The trunk's front and back are let
  //  down or lifted until their lowest points touch: the flank, the hip and
  //  the shoulder on its side, the rump sitting, the sternum and the belly
  //  lying. Each foot is lifted out of the ground or let down onto it, the
  //  head and the tail are laid on it, and a corpse something else lays down
  //  (the ragdoll, a tumble) is lifted bodily off whatever sank. Solved a few
  //  times a second while the body rests, applied every frame, eased.
  // ==========================================================================
  const RC_NECK = 5, RC_TAIL = 6;          // chains: 0 trunk, 1..4 legs, 5 neck and head, 6 tail
  function restSet(rig) {
    if (rig._rs) return rig._rs;
    const geo = shapeOf(rig.D, 0).geo;
    const P = geo.attributes.position.array, SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
    const N = P.length / 3;
    const chainOf = new Uint8Array(NB), proxOf = new Uint8Array(NB), frontOf = new Uint8Array(NB);
    for (let Lg = 0; Lg < 4; Lg++) {
      for (let k = 0; k < LEGB[Lg].length; k++) {
        const bn = LEGB[Lg][k];
        chainOf[bn] = 1 + Lg; frontOf[bn] = Lg < 2 ? 1 : 0;
        // the shoulder and the upper arm, the thigh: part of what the trunk rests on
        proxOf[bn] = (Lg < 2 ? k < 2 : k < 1) ? 1 : 0;
      }
    }
    [BN.neck, BN.neck1, BN.head, BN.jaw, BN.tongue, BN.earL, BN.earR, BN.collar].forEach(function (bn) { chainOf[bn] = RC_NECK; frontOf[bn] = 1; });
    [BN.tail0, BN.tail1, BN.tail2, BN.tail3, BN.tail4].forEach(function (bn) { chainOf[bn] = RC_TAIL; });
    // the root of the neck and of the tail ride the trunk (turning them cannot lift their own base)
    [BN.root, BN.pelvis, BN.loin, BN.chest, BN.ribs, BN.hackle, BN.neck, BN.tail0].forEach(function (bn) { proxOf[bn] = 1; });
    frontOf[BN.chest] = 1; frontOf[BN.ribs] = 1; frontOf[BN.hackle] = 1;
    // every vertex (a few thousand: the lowest point is often a small one, a
    // jaw, an ear tip, a toe)
    const n = N;
    const S = { n: n, p: new Float32Array(n * 3), b: new Uint8Array(n * 4), w: new Float32Array(n * 4),
      chain: new Uint8Array(n), prox: new Uint8Array(n), front: new Uint8Array(n), rib: new Uint8Array(n), q: new Float32Array(n * 3) };
    for (let j = 0; j < n; j++) {
      const i = j;
      S.p[j * 3] = P[i * 3]; S.p[j * 3 + 1] = P[i * 3 + 1]; S.p[j * 3 + 2] = P[i * 3 + 2];
      let bw = -1, bb = 0;
      for (let k = 0; k < 4; k++) {
        S.b[j * 4 + k] = SI[i * 4 + k]; S.w[j * 4 + k] = SW[i * 4 + k];
        if (SW[i * 4 + k] > bw) { bw = SW[i * 4 + k]; bb = SI[i * 4 + k]; }
      }
      S.chain[j] = chainOf[bb]; S.prox[j] = proxOf[bb]; S.front[j] = frontOf[bb]; S.rib[j] = bb === BN.ribs ? 1 : 0;
      if (bb === BN.loin) S.front[j] = P[i * 3] > rig.D.loin.x ? 1 : 0;
    }
    rig._rs = S;
    return S;
  }
  // world positions of the set (or of one chain), from the skeleton's bone matrices
  function skinRest(rig, S, chain) {
    const m = rig.skeleton.boneMatrices, p = S.p, q = S.q, bi = S.b, ww = S.w;
    for (let j = 0; j < S.n; j++) {
      if (chain >= 0 && S.chain[j] !== chain) continue;
      const px = p[j * 3], py = p[j * 3 + 1], pz = p[j * 3 + 2];
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const w = ww[j * 4 + k];
        if (!(w > 0)) continue;
        const o = bi[j * 4 + k] * 16;
        x += w * (m[o] * px + m[o + 4] * py + m[o + 8] * pz + m[o + 12]);
        y += w * (m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz + m[o + 13]);
        z += w * (m[o + 2] * px + m[o + 6] * py + m[o + 10] * pz + m[o + 14]);
      }
      q[j * 3] = x; q[j * 3 + 1] = y; q[j * 3 + 2] = z;
    }
  }
  // the ground under the body: a plane through five samples of the host's floor
  // (its own slope), or level at the body's placement
  function restGround(rig, c, G) {
    const e = rig.group.matrixWorld.elements, x0 = e[12], z0 = e[14];
    const fn = c && c.ground;
    let y0 = c && c.y != null ? c.y : e[13], gx = 0, gz = 0;
    if (typeof fn === "function") {
      const d = 0.4;
      const s0 = fn(x0, z0), sx1 = fn(x0 + d, z0), sx0 = fn(x0 - d, z0), sz1 = fn(x0, z0 + d), sz0 = fn(x0, z0 - d);
      if (s0 != null && isFinite(s0)) y0 = s0;
      if (sx1 != null && sx0 != null && isFinite(sx1) && isFinite(sx0)) gx = (sx1 - sx0) / (2 * d);
      if (sz1 != null && sz0 != null && isFinite(sz1) && isFinite(sz0)) gz = (sz1 - sz0) / (2 * d);
    }
    G.x0 = x0; G.z0 = z0; G.y0 = y0; G.gx = gx; G.gz = gz;
    return G;
  }
  function overGround(G, x, y, z) { return y - (G.y0 + G.gx * (x - G.x0) + G.gz * (z - G.z0)); }
  function lowest(S, G, chain) {
    let h = 1e9;
    for (let j = 0; j < S.n; j++) {
      if (chain >= 0 && S.chain[j] !== chain) continue;
      const v = overGround(G, S.q[j * 3], S.q[j * 3 + 1], S.q[j * 3 + 2]);
      if (v < h) h = v;
    }
    return h;
  }
  function worldScale(rig) { return (rig.mesh.scale.x || 1) * ((rig.group && rig.group.scale.x) || 1); }
  const _rG = { x0: 0, z0: 0, y0: 0, gx: 0, gz: 0 };
  let _rQ0 = null, _rQd = null, _rV = null, _rQi = null, _rAX = null;
  function restTemps() {
    if (_rQ0) return;
    const THREE = W.THREE;
    _rQ0 = new THREE.Quaternion(); _rQd = new THREE.Quaternion(); _rV = new THREE.Vector3(); _rQi = new THREE.Quaternion();
    _rAX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  }
  // the turn of a chain's root bone (its own axes) that brings the chain's
  // lowest point to the ground: the most effective axis, one Newton step
  const REST_GAP = 0.001;                  // what a resting body aims for: a hair over the ground
  function restTurn(rig, S, G, chain, bone, h0, down, qT, qA) {
    if (!(h0 < 1e8)) { qT.copy(qA); return; }
    const e0 = h0 - REST_GAP, want = e0 < 0 ? -e0 : -e0 * down;
    if (Math.abs(want) < 0.0015) { qT.copy(qA); return; }
    const b = rig.bones[bone], d = 0.05;
    _rQ0.copy(b.quaternion);
    let best = -1, rate = 0;
    for (let a = 0; a < 3; a++) {
      b.quaternion.copy(_rQ0).multiply(_rQd.setFromAxisAngle(_rAX[a], d));
      b.updateMatrixWorld(true); rig.skeleton.update();
      skinRest(rig, S, chain);
      const r = (lowest(S, G, chain) - h0) / d;
      if (Math.abs(r) > Math.abs(rate)) { rate = r; best = a; }
    }
    b.quaternion.copy(_rQ0); b.updateMatrixWorld(true); rig.skeleton.update();
    if (best < 0 || Math.abs(rate) < 0.02) { qT.copy(qA); return; }
    // (damped: the chain's lowest point can change hands as it turns)
    qT.copy(qA).multiply(_rQd.setFromAxisAngle(_rAX[best], clamp(0.7 * want / rate, -0.25, 0.25)));
  }
  function restState(st) {
    const THREE = W.THREE;
    if (!st.rest) st.rest = { t: 0, calm: 0, wk: 0, F: 0, B: 0, Fa: 0, Ba: 0, sag: 0, sagA: 0, L: [0, 0, 0, 0], La: [0, 0, 0, 0],
      qN: new THREE.Quaternion(), qNa: new THREE.Quaternion(), qT: new THREE.Quaternion(), qTa: new THREE.Quaternion(), on: false };
    return st.rest;
  }
  // one solve: measure the posed shell against the ground, set the targets
  function restSolve(rig, st, c, w) {
    restTemps();
    const S = restSet(rig), r = restState(st), D = rig.D, K = D.K;
    rig.group.updateMatrixWorld(true); rig.skeleton.update();
    const G = restGround(rig, c, _rG);
    skinRest(rig, S, -1);
    let hF = 1e9, hB = 1e9, hN = 1e9, hT = 1e9, hR = 1e9;
    const hL = [1e9, 1e9, 1e9, 1e9];
    for (let j = 0; j < S.n; j++) {
      const h = overGround(G, S.q[j * 3], S.q[j * 3 + 1], S.q[j * 3 + 2]), ch = S.chain[j];
      if (S.rib[j] && h < hR) hR = h;
      if (S.prox[j]) { if (S.front[j]) { if (h < hF) hF = h; } else if (h < hB) hB = h; }
      else if (ch >= 1 && ch <= 4) { if (h < hL[ch - 1]) hL[ch - 1] = h; }
      else if (ch === RC_NECK) { if (h < hN) hN = h; }
      else if (ch === RC_TAIL) { if (h < hT) hT = h; }
    }
    const sc = worldScale(rig);
    // the trunk: always out of the ground; let down onto it where it rests
    const downF = clamp(w.lie + w.side, 0, 1), downB = clamp(w.sit + w.lie + w.side, 0, 1);
    hF -= REST_GAP; hB -= REST_GAP;
    if (hF < 1e8) r.F = clamp(r.Fa + (hF < 0 ? -hF : -hF * downF) / sc, -0.3 * K, 0.4 * K);
    if (hB < 1e8) r.B = clamp(r.Ba + (hB < 0 ? -hB : -hB * downB) / sc, -0.3 * K, 0.4 * K);
    // the soft flank settles onto the ground it lies on (a narrow chest
    // between a broad shoulder and thigh would otherwise hang over it)
    if (hR < 1e8) r.sag = clamp(r.sagA + (hR - REST_GAP) * clamp(w.side + 0.5 * w.lie, 0, 1) / sc, 0, 0.04 * K);
    // the feet: out of the ground; sitting and lying on the ground, and on its
    // side the lower pair (the upper pair rests on them)
    for (let Lg = 0; Lg < 4; Lg++) {
      if (!(hL[Lg] < 1e8)) continue;
      const down = clamp(w.sit + w.lie + (Lg % 2 === 1 ? w.side : 0), 0, 1), e = hL[Lg] - REST_GAP;
      r.L[Lg] = clamp(r.La[Lg] + 0.85 * (e < 0 ? -e : -e * down) / sc, -0.15 * K, 0.3 * K);
    }
    // the head on the ground when it lies on its side; the tail whenever it rests
    restTurn(rig, S, G, RC_NECK, BN.neck, hN, clamp(w.side, 0, 1), r.qN, r.qNa);
    restTurn(rig, S, G, RC_TAIL, BN.tail0, hT, clamp(w.side + w.lie + w.sit, 0, 1), r.qT, r.qTa);
  }
  // each frame: solve a few times a second while resting, ease what is applied
  function restStep(rig, st, c, dt, w) {
    const r = restState(st);
    const resting = Math.max(w.sit, w.lie, w.side, w.bow) > 0.02;
    if (resting) {
      r.on = true;
      r.t -= dt;
      // a posture still changing wakes the solve; a settled body is re-checked slowly
      const wk = w.sit * 1 + w.lie * 2 + w.side * 4 + w.bow * 8;
      if (Math.abs(wk - r.wk) > 0.02) { r.calm = 0; r.wk = wk; }
      if (r.t <= 0) {
        const F0 = r.F, B0 = r.B, L0 = r.L[0] + r.L[1] + r.L[2] + r.L[3], s0 = r.sag;
        restSolve(rig, st, c, w);
        const moved = Math.abs(r.F - F0) + Math.abs(r.B - B0) + Math.abs(r.L[0] + r.L[1] + r.L[2] + r.L[3] - L0) + Math.abs(r.sag - s0);
        r.calm = moved * worldScale(rig) < 0.0015 ? r.calm + 1 : 0;
        r.t = (rig.lod === 0 ? 0.1 : 0.45) * (r.calm >= 2 ? 6 : 1);
      }
    } else if (r.on) {
      r.F = 0; r.B = 0; r.sag = 0; r.L[0] = r.L[1] = r.L[2] = r.L[3] = 0; r.qN.identity(); r.qT.identity(); r.t = 0;
      if (Math.abs(r.Fa) + Math.abs(r.Ba) + r.sagA + Math.abs(r.La[0]) + Math.abs(r.La[1]) + Math.abs(r.La[2]) + Math.abs(r.La[3]) < 1e-4 &&
        1 - Math.abs(r.qNa.w) < 1e-6 && 1 - Math.abs(r.qTa.w) < 1e-6) r.on = false;
    }
    if (!r.on) return;
    const k = Math.min(1, dt * 10);
    r.Fa += (r.F - r.Fa) * k; r.Ba += (r.B - r.Ba) * k; r.sagA += (r.sag - r.sagA) * k;
    for (let i = 0; i < 4; i++) r.La[i] += (r.L[i] - r.La[i]) * k;
    r.qNa.slerp(r.qN, k); r.qTa.slerp(r.qT, k);
  }
  // a corpse laid down by something else (the ragdoll, a tumble): lifted
  // bodily out of whatever sank, the world's up through the group's own turn,
  // until its lowest point rests on the ground (never pulled down: a corpse
  // the solver floats on water is not on the bed)
  function restCorpse(rig, c) {
    restTemps();
    const S = restSet(rig), mesh = rig.mesh, grp = rig.group;
    const last = rig._rc || (rig._rc = { e: new Float64Array(16), still: 0 });
    grp.updateMatrixWorld(false);
    // a body that has not moved since the last solve keeps its lift
    const e = grp.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (Math.abs(e[i] - last.e[i]) > 1e-5) { moved = true; break; }
    if (!moved && rig._rcBones === rig._rcStamp) return;
    for (let i = 0; i < 16; i++) last.e[i] = e[i];
    rig._rcStamp = rig._rcBones;
    mesh.position.set(0, 0, 0);
    grp.updateMatrixWorld(true); rig.skeleton.update();
    const G = restGround(rig, c, _rG);
    skinRest(rig, S, -1);
    const h = lowest(S, G, -1) - REST_GAP;
    if (!(h < 0)) return;
    _rV.set(0, -h, 0).applyQuaternion(_rQi.copy(grp.quaternion).invert()).divideScalar(grp.scale.x || 1);
    mesh.position.copy(_rV);
    mesh.updateMatrixWorld(true);
  }
  // a corpse's bones: let go, the head and tail fallen, the jaw slack
  function limpPose(rig) {
    const b = rig.bones, bp = rig.bindPos;
    for (let i = 0; i < NB; i++) { b[i].position.copy(bp[i]); b[i].rotation.set(0, 0, 0); b[i].scale.set(1, 1, 1); }
    b[BN.collar].scale.setScalar(rig.collarHex == null ? 1e-4 : 1);
    b[BN.jaw].rotation.set(0, 0, -0.22);
    b[BN.tail0].rotation.set(0, 0.2, 0.35); b[BN.tail1].rotation.set(0, 0.15, 0.12);
    b[BN.earL].rotation.set(-0.3, 0, 0.6); b[BN.earR].rotation.set(0.3, 0, 0.6);
    b[BN.neck].rotation.set(0, 0, -0.35); b[BN.neck1].rotation.set(0, 0, -0.2);
  }
  // the trunk's three bones turned about the ground under the body's middle:
  // along the body (tA, nose up), across it (tC, about the long axis)
  function tiltTrunk(rig, tA, tC, px) {
    restTemps();
    const b = rig.bones;
    _rQi.setFromAxisAngle(_rAX[2], tA).multiply(_rQd.setFromAxisAngle(_rAX[0], tC));
    const ids = [BN.pelvis, BN.chest, BN.loin];
    for (let i = 0; i < 3; i++) {
      const bn = b[ids[i]];
      _rV.set(bn.position.x - px, bn.position.y, bn.position.z).applyQuaternion(_rQi);
      bn.position.set(_rV.x + px, _rV.y, _rV.z);
      bn.quaternion.premultiply(_rQi);
    }
  }
  // laid over by something else: the group's own up has left the vertical
  function tipped(grp) { const q = grp.quaternion; return 1 - 2 * (q.x * q.x + q.z * q.z) < 0.8; }

  // ---- the legs: gait or posture feet, 3-D IK, scapula swing, pasterns, toes
  const _lp = { x: 0, y: 0, z: 0 };
  function legs(rig, st, P, T, wS, wL, wB, wD, c) {
    const D = rig.D, K = D.K, b = rig.bones, G = rig.G;
    const limp = c.limp;
    let limpLeg = -1, limpK = 0;
    if (limp) for (let i = 0; i < 4; i++) if (limp[i] > limpK) { limpK = limp[i]; limpLeg = i; }
    const wSt = Math.max(0, 1 - wS - wL - wB - wD);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], F = G.feet[Lg], s = Lg % 2 === 0 ? -1 : 1;
      const z0 = s * (front ? D.zF : D.zH);
      // the parent frame
      const bx = front ? T.cX : T.pX, by = front ? T.cY : T.pY, bz = front ? T.cZ : T.pZ;
      const brx = front ? T.cRx : T.pRx, bry = front ? T.cRy : T.pRy, brz = front ? T.cR : T.pR;
      const par = front ? D.chest : D.pelv;
      const toe = front ? D.toeF : D.toeH, pad = front ? D.padF : D.padH;
      // ---- the stance / swing foot from the gait (model space), as the MCP joint
      const su = F.sw ? sin(PI * F.u) : 0;
      let fx = F.lx - toe * 0.42, fy = F.ly + pad, fz = F.lz;
      let aM, aT;                                  // pastern / metatarsus and toe absolute angles
      const nb = front ? D.bF : D.bH;
      const pushK = !F.sw ? clamp((D.feet[Lg].x - F.lx) / (0.3 * K), -1, 1) : 0;
      if (front) {
        aM = nb[3] - 1.4 * su - 0.18 * pushK * (pushK > 0 ? 1 : 0.3);
        aT = -1.15 * su;
      } else {
        aM = nb[2] - 0.55 * su - 0.32 * Math.max(0, pushK);
        aT = -0.8 * su;
      }
      // HEEL-OFF: late in the stance the paw rolls forward onto its toes. The
      // digital pads (0.72 of the toe ahead of the knuckle, on the ground)
      // stay planted while the knuckle (MCP / MTP) rises round them, which is
      // what lets the leg reach the end of a long stride without sliding.
      if (!F.sw) {
        const behind = D.feet[Lg].x - F.lx;
        const roll = clamp((behind - 0.06 * D.legLen) / (0.32 * D.legLen), 0, 1) * 0.95;
        if (roll > 0) {
          const ax = -0.72 * toe, ay = pad - 0.003, px = fx - ax, py = fy - ay;
          const cr = cos(roll), sr = sin(roll);
          fx = px + ax * cr + ay * sr; fy = py - ax * sr + ay * cr;
          aT -= roll;
        }
      }
      // a leg carried: three-legged on a badly hurt limb
      if (Lg === limpLeg && limpK > 0.65) { fx = lerp(fx, (front ? D.shj.x : D.hip.x) + (front ? 0.05 : -0.06) * K, 0.85); fy = lerp(fy, pad + D.legLen * 0.45, 0.85); aM = front ? -0.5 : -HALF - 0.6; }
      // rearing: the front paws leave the ground, folded
      if (front && st.rearUp > 0.02) { const k = st.rearUp; fx = lerp(fx, D.shj.x + 0.1 * K, k); fy = lerp(fy, by + 0.05 * K - (D.humL + D.radL) * 0.7, k); aM = lerp(aM, -0.6, k); }
      // in the air: forelegs reach out ahead, hind legs stream out behind
      if (st.air > 0.01) {
        const k = st.air;
        if (front) { fx = lerp(fx, D.shj.x + 0.32 * D.legLen, k); fy = lerp(fy, by - D.legLen * 0.62, k); aM = lerp(aM, -0.35, k); aT = lerp(aT, -0.25, k); }
        else { fx = lerp(fx, D.hip.x - 0.38 * D.legLen, k); fy = lerp(fy, by - D.legLen * 0.7, k); aM = lerp(aM, -HALF - 0.75, k); aT = lerp(aT, -1.0, k); }
      }
      // ---- posture feet
      let sx, sy, sa, saT;
      if (front) {
        // SIT: straight under the shoulder; LIE: forearm flat forward; BOW: elbows down
        sx = P.sit.sh.x - 0.01 * K; sy = pad; sa = nb[3]; saT = 0;
        fx = fx * wSt + sx * wS + P.lie.fx * wL + P.bow.fx * wB; fy = fy * wSt + sy * wS + P.lie.fy * wL + P.bow.fy * wB;
        aM = aM * wSt + sa * wS; aT = aT * wSt + saT * wS;
      } else {
        // SIT / LIE: the hock on the ground, the metatarsus flat forward
        const hipW = wS > 0 ? P.sit.hip : { x: D.hip.x, y: D.hip.y };
        const sitFx = hipW.x + D.mtL * 0.95 + 0.02 * K, sitFy = pad * 0.9;
        const lieFx = D.hip.x + 0.05 * K + D.mtL * 0.9, lieFy = pad * 0.9;
        fx = fx * (wSt + wB) + sitFx * wS + lieFx * wL; fy = fy * (wSt + wB) + sitFy * wS + lieFy * wL;
        aM = aM * (wSt + wB) - 0.02 * (wS + wL); aT = aT * (wSt + wB) - 0.04 * (wS + wL);
        fz = fz * (1 - wS - wL) + z0 * 1.35 * (wS + wL);
      }
      if (T.wP > 0.001) {
        // the dog paddle, diagonal pairs together: each forefoot reaches
        // forward, pulls down and back (the stroke), folds and comes forward
        // high under the chest; the hind feet kick a smaller loop
        const ph = TAU * ((st.padPh || 0) + (Lg === 0 || Lg === 3 ? 0 : 0.5));
        const up = -sin(ph);                                 // > 0 on the return, < 0 in the stroke
        let px, py;
        if (front) {
          const sx = T.cX + D.shj.x - D.chest.x, sy = T.cY + D.shj.y - D.chest.y;
          const L = D.humL + D.radL + D.mcL;
          px = sx + 0.1 * K + 0.16 * K * cos(ph); py = Math.max(sy - 0.6 * L + 0.1 * K * up, T.bedM + pad);
          aM = lerp(aM, nb[3] - 0.25 - 0.9 * Math.max(0, up), T.wP);
        } else {
          const hx0 = T.pX + D.hip.x - D.pelv.x, hy0 = T.pY + D.hip.y - D.pelv.y;
          const L = D.femL + D.tibL + D.mtL;
          px = hx0 - 0.04 * K + 0.12 * K * cos(ph); py = Math.max(hy0 - 0.62 * L + 0.07 * K * up, T.bedM + pad);
          aM = lerp(aM, nb[2] - 0.35 - 0.6 * Math.max(0, up), T.wP);
        }
        fx = lerp(fx, px, T.wP); fy = lerp(fy, py, T.wP); fz = lerp(fz, z0, T.wP);
        aT = lerp(aT, -0.2 - 0.5 * Math.max(0, up), T.wP);
      }
      if (wD > 0) {
        // on its (right) side the legs lie loose along the ground, out from the
        // belly (-z); the upper (left) pair rests on the lower one
        const upper = Lg % 2 === 0;
        fx = lerp(fx, D.feet[Lg].x + (front ? 0.06 : -0.04) * K, wD);
        fy = lerp(fy, pad + (upper ? 0.08 : 0.015) * K, wD);
        fz = lerp(fz, -D.legLen * 0.55 - (upper ? 0.03 * K : 0), wD);
        aM = lerp(aM, front ? -0.9 : -HALF - 0.3, wD);
      }
      // at rest the foot comes out of the ground or down onto it (restSolve)
      if (st.rest && st.rest.on) fy += st.rest.La[Lg];
      // ---- into the parent's frame (the pastern and toe angles were world
      //      angles; the trunk under them is pitched)
      aM -= brz; aT -= brz;
      toBoneLocal(fx, fy, fz, bx, by, bz, brx, bry, brz, _lp);
      const lx = _lp.x + par.x, ly = _lp.y + par.y, lz = _lp.z;      // as bind-model coords
      // the chain root (scapula pivot / hip joint) in the same coords
      const root = front ? D.scapPiv : D.hip;
      const roll = atan2(z0 - lz, root.y - ly);
      const dyz = hypot(root.y - ly, lz - z0);
      const tx = lx, ty = root.y - dyz;                               // the target in the rolled plane
      let t1, t2, aS = 0;
      if (front) {
        // the scapula swings with the stride (no collarbone: the shoulder
        // joint itself travels fore and aft)
        const dx = tx - (D.mcp.x);
        aS = clamp(dx / D.legLen * 0.55, -0.4, 0.45) * (1 - wS * 0.5) - 0.25 * wL - 0.2 * wB;
        const as = nb[0] + aS;
        const sjx = root.x + D.scapPL * cos(as), sjy = root.y + D.scapPL * sin(as);
        // the wrist from the MCP joint and the pastern angle; a stretched
        // leg opens its pastern toward the line rather than drag the paw
        let wx = tx - D.mcL * cos(aM), wy = ty - D.mcL * sin(aM);
        const reach = (D.humL + D.radL) * 0.985;
        for (let it = 0; it < 6; it++) {
          const dw = hypot(wx - sjx, wy - sjy);
          if (dw <= reach) break;
          const fS = atan2(ty - sjy, tx - sjx);
          aM = aM + wrapPi(fS - aM) * clamp((dw - reach) / (D.mcL * 0.6) + 0.15, 0, 1);
          wx = tx - D.mcL * cos(aM); wy = ty - D.mcL * sin(aM);
        }
        ik2(sjx, sjy, wx, wy, D.humL, D.radL, -1, _ik);
        t1 = _ik[0]; t2 = _ik[1];
        const A = rig.legA[Lg];
        A[0] = roll; A[1] = aS; A[2] = (t1 - nb[1]) - aS; A[3] = (t2 - nb[2]) - (t1 - nb[1]); A[4] = (aM - nb[3]) - (t2 - nb[2]); A[5] = (aT - nb[4]) - (aM - nb[3]);
        rxyz(b[ids[0]], roll, 0, A[1]); rz(b[ids[1]], A[2]); rz(b[ids[2]], A[3]); rz(b[ids[3]], A[4]); rz(b[ids[4]], A[5]);
      } else {
        let hx = tx - D.mtL * cos(aM), hy = ty - D.mtL * sin(aM);
        const reach = (D.femL + D.tibL) * 0.985;
        for (let it = 0; it < 6; it++) {
          const dw = hypot(hx - root.x, hy - root.y);
          if (dw <= reach) break;
          const fS = atan2(ty - root.y, tx - root.x);
          aM = aM + wrapPi(fS - aM) * clamp((dw - reach) / (D.mtL * 0.6) + 0.15, 0, 1);
          hx = tx - D.mtL * cos(aM); hy = ty - D.mtL * sin(aM);
        }
        ik2(root.x, root.y, hx, hy, D.femL, D.tibL, 1, _ik);
        t1 = _ik[0]; t2 = _ik[1];
        const A = rig.legA[Lg];
        A[0] = roll; A[1] = t1 - nb[0]; A[2] = (t2 - nb[1]) - (t1 - nb[0]); A[3] = (aM - nb[2]) - (t2 - nb[1]); A[4] = (aT - nb[3]) - (aM - nb[2]);
        rxyz(b[ids[0]], roll, 0, A[1]); rz(b[ids[1]], A[2]); rz(b[ids[2]], A[3]); rz(b[ids[3]], A[4]);
      }
    }
  }

  // ---- neck, head, jaw, tongue, ears ---------------------------------------
  function headNeck(rig, st, c, dt, k) {
    const D = rig.D, R = D.row, K = D.K, b = rig.bones, bp = rig.bindPos;
    const barkE = st.barkT > 0 ? sin(PI * (1 - st.barkT / 0.24)) : 0;
    const biteE = st.biteT > 0 ? sin(PI * (1 - st.biteT / 0.34)) : 0;
    const yelpE = st.yelpT > 0 ? sin(PI * st.yelpT / 0.32) : 0;
    // look: the host's yaw / pitch, or a world point, or the idle glance
    let lookY = c.lookYaw || 0, lookP = c.lookPitch || 0;
    if (c.look && rig.group) {
      const gp = rig.mesh.getWorldPosition ? rig.mesh.getWorldPosition(_v3()) : null;
      if (gp) {
        const hh = c.heading || 0, dx = c.look.x - gp.x, dz = c.look.z - gp.z;
        lookY = -wrapPi(atan2(dz, dx) - hh);
        lookP = atan2((c.look.y || gp.y) - (gp.y + D.headP.y), Math.max(0.6, hypot(dx, dz))) * 0.8;
      }
    }
    if (st.act === "look") lookY = st.lookTo;
    st.lookY = approach(st.lookY, clamp(lookY, -1.2, 1.2), 6, dt);
    st.lookP = approach(st.lookP, clamp(lookP, -0.6, 0.7), 6, dt);
    // carriage: a trotting canid carries its head low, level with its back;
    // up when alert, down to the ground to sniff, low in fear and threat
    const lowBite = st.lowBite, lunH = Math.max(0, st.lunge);
    let nP = (R.kind === "wild" ? -0.06 : 0.0) + st.alert * 0.14 - st.sniff * 0.95 - st.fear * 0.3 - st.aggr * 0.18 - st.threat * 0.22
      - (R.kind === "wild" ? 0.34 : 0.22) * k.trot - 0.26 * k.gal - 0.15 * k.lope + st.lookP * 0.55
      + barkE * 0.14 - biteE * 0.25 + st.howl * 1.05 + 0.25 * st.rearUp - lowBite * 0.75 - 0.25 * lunH * (1 - st.rearUp)
      - k.lieK * 0.08 - st.dead * 0.5 + 0.2 * k.fl + (k.swimN || 0) * (k.swimK || 0);
    // gaze stabilisation: the neck counters the trunk's pitch
    nP -= k.cR * 0.8;
    // head bob at the walk, the pumping neck at the gallop
    nP += 0.035 * k.wW * k.moveK * sin(2 * k.ph + 0.5) + 0.07 * k.gal * sin(k.ph + 2.2);
    // idle: yawn lifts the head; scratch tips it to the scratching side
    if (st.act === "yawn") nP += 0.25 * sin(PI * clamp(st.actT / st.actDur, 0, 1));
    // a grip / bite target: aim the mouth at it
    let yawN = st.lookY * 0.5 + (st.hold > 0.1 ? 0.32 * st.hold * sin(st.t * 15) : 0) + st.shake * 0.38 * sin(st.t * 23);
    const mt = c.mouthTo || null;
    st.mouthK = approach(st.mouthK, mt ? 1 : 0, 10, dt);
    if (mt && rig.mouthOk) {
      // how far the mouth is off the target, seen from the neck base: turn it
      const nbw = rig._nbw || (rig._nbw = { x: 0, y: 0, z: 0 });
      boneWorld(rig, BN.neck, nbw);
      const mw = rig.mouthW;
      const a1 = atan2(mw.y - nbw.y, hypot(mw.x - nbw.x, mw.z - nbw.z)), a2 = atan2(mt.y - nbw.y, hypot(mt.x - nbw.x, mt.z - nbw.z));
      st.mpAdj = clamp((st.mpAdj || 0) + (a2 - a1) * 0.6, -1.1, 0.9);
      const h = c.heading || 0;
      const y1 = atan2(mw.z - nbw.z, mw.x - nbw.x), y2 = atan2(mt.z - nbw.z, mt.x - nbw.x);
      st.myAdj = clamp((st.myAdj || 0) - wrapPi(y2 - y1) * 0.6, -1.0, 1.0);
      void h;
    } else { st.mpAdj = approach(st.mpAdj || 0, 0, 4, dt); st.myAdj = approach(st.myAdj || 0, 0, 4, dt); }
    nP += (st.mpAdj || 0) * st.mouthK;
    yawN += (st.myAdj || 0) * st.mouthK;
    rxyz(b[BN.neck], 0.1 * k.fl * (st.flinchS || 1), yawN * 0.55, nP * 0.55);
    rxyz(b[BN.neck1], 0, yawN * 0.45, nP * 0.45);
    const sniffWig = st.sniff * 0.05 * sin(st.t * 26);
    const scratchTilt = st.act === "scratch" ? 0.35 * (st.actSide || 1) : 0;
    rxyz(b[BN.head], st.tilt * 0.38 + st.shake * 0.2 * sin(st.t * 23 + 1) + scratchTilt + st.hold * 0.25 * sin(st.t * 15 + 1),
      st.lookY * 0.25, st.lookP * 0.3 - st.sniff * 0.3 + sniffWig + st.howl * 0.35 + 0.15 * lunH - 0.08 * st.threat - st.dead * 0.3);
    // ---- the mouth: pant, bark, the gape before the snap, the howl, a yelp,
    //      the snarl, a yawn; clamped shut on a grip
    let biteOpen = 0;
    if (st.biteT > 0) { const el = 0.34 - st.biteT; biteOpen = el < 0.14 ? 0.75 * el / 0.14 : Math.max(0, 0.75 * (1 - (el - 0.14) / 0.05)); }
    if (c.lunge > 0.05) biteOpen = Math.max(biteOpen, clamp(c.gape || 0, 0, 1) * 0.8);
    const yawnE = st.act === "yawn" ? sin(PI * clamp(st.actT / st.actDur, 0, 1)) : 0;
    const pantB = st.pant * (0.17 + 0.04 * sin(st.breathPh * 2));
    let jaw = pantB * (1 - st.aggr) * (1 - st.hold) + barkE * 0.5 + st.aggr * 0.08 + st.threat * 0.22 + biteOpen + st.howl * 0.3 + yelpE * 0.42 + yawnE * 0.8 + st.dead * 0.15;
    if (st.hold > 0.3) jaw = Math.min(jaw, 0.08);
    rz(b[BN.jaw], -clamp(jaw, 0, 0.85));
    // the tongue comes out over the lower incisors when panting
    const tg = b[BN.tongue], tb = bp[BN.tongue];
    const out = clamp(st.pant * 1.3 - 0.25, 0, 1) * (1 - st.hold) * (1 - st.aggr * 0.8);
    tg.position.set(tb.x + out * 0.07 * D.hl, tb.y - out * 0.01 * D.hl, 0);
    rz(tg, -out * (0.5 + 0.1 * sin(st.breathPh * 2)));
    // ---- ears by type and mood, on damped springs
    const pin = Math.max(st.fear, lunH * 0.8, st.hold * 0.7, yelpE, st.dead * 0.6);
    const E = R.ear;
    st.flickT = Math.max(0, st.flickT - dt);
    for (let s = 0; s < 2; s++) {
      const e = b[s === 0 ? BN.earL : BN.earR], sg = s === 0 ? -1 : 1;
      const flick = st.flickT > 0 && st.flickS === s ? sin(st.flickT / 0.25 * PI) * 0.6 : 0;
      let pitch, rollOut, twist;
      if (E.type === "prick") {
        pitch = -0.18 * st.alert + 1.05 * pin + 0.18 * (1 - st.alert) * (1 - pin) + flick - 0.15 * st.threat + 0.3 * st.happy * (1 - st.alert);
        rollOut = 0.12 + 0.42 * pin - 0.06 * st.alert + 0.15 * st.happy * (1 - st.alert);
        twist = 0.12 * st.threat - 0.2 * st.alert + 0.25 * pin;
      } else if (E.type === "rose") {
        pitch = -0.25 * st.alert + 0.6 * pin + flick * 0.5;
        rollOut = -0.1 * st.alert + 0.25 * pin;
        twist = 0;
      } else {
        // drop ears: the base lifts forward when alert, pulled back in fear;
        // the flap is a spring driven by the head's bounce
        const drive = -(st.cyA || 0) * 0.012;
        const k2 = 90, c2 = 9;
        const want = -0.28 * st.alert + 0.55 * pin + 0.12 * st.happy;
        st.earV[s] += (-k2 * (st.earA[s] - want) - c2 * st.earV[s] + drive * 60) * dt;
        st.earA[s] += st.earV[s] * dt;
        pitch = st.earA[s] + flick * 0.4;
        rollOut = 0.08 * st.alert - 0.2 * pin + 0.15 * k.gal * sin(k.ph * 2 + s);
        twist = 0;
      }
      rxyz(e, sg * rollOut, sg * twist, pitch);
    }
  }
  let _v3o = null;
  function _v3() { return _v3o || (_v3o = new W.THREE.Vector3()); }

  // ---- the tail: carriage IS the mood; wag, sway and follow-through on springs
  function tail(rig, st, dt, k) {
    const D = rig.D, R = D.row, b = rig.bones, T = R.tail;
    const wild = R.kind === "wild";
    // carriage (+ = lower, rotation about z of tail0 from the bind rest)
    let carry = -st.alert * (wild ? 0.45 : 0.85) - st.happy * (wild ? 0.2 : 0.55) - st.aggr * (wild ? 0.5 : 0.75) - st.threat * 0.95 + st.fear * 0.85
      - (wild ? 0.6 : 0.55) * k.gal - (wild ? 0.2 : 0.35) * k.trot - 0.4 * k.lope;
    if (R.id === "coyote") carry += 0.25 * (k.gal + k.trot);          // a coyote's tail stays low even running
    carry = carry * (1 - st.dead) + 0.2 * st.dead;
    // sitting or lying the tail lies back along the ground (lifted against the
    // pelvis' own tilt), curled round to one side
    // (from its hanging rest angle: up to the horizontal, less the pelvis tilt,
    // a little down again to reach the ground from the set)
    const sitR = rig._post ? rig._post.sit.R : 0.5;
    carry = carry * (1 - k.sitK - k.lieK) + (-T.rest - sitR + 0.25) * k.sitK + (-T.rest + 0.3) * k.lieK;
    // swimming, it streams out behind on the water: a rudder
    if (k.swimK) carry = carry * (1 - k.swimK) + (-T.rest + 0.1) * k.swimK;
    carry = clamp(carry, -2.3, 1.2);
    const curl = (rig.seed & 1 ? 1 : -1) * (0.5 * k.sitK + 0.75 * k.lieK);
    // the wag: frequency by size, width by mood (a happy dog sweeps wide, an
    // alert or aggressive one flags high and narrow)
    const fw = 3.3 * Math.pow(D.withers / 0.6, -0.5) * (0.6 + 0.4 * st.happy + 0.2 * st.alert);
    st.wagPh += dt * TAU * fw;
    const wagAmp = (st.happy * (wild ? 0.35 : 0.62) + st.alert * 0.06 + st.aggr * 0.05) * (1 - st.fear * 0.75) * (1 - st.dead) * (1 - k.lieK * 0.5) * (1 - 0.7 * (k.swimK || 0));
    const counter = clamp(-st.turn * 0.12, -0.35, 0.35) * k.moveK;      // balances a turn at speed
    // the hips wiggle with a big happy wag when standing still
    const tb = [BN.tail0, BN.tail1, BN.tail2, BN.tail3, BN.tail4];
    for (let i = 0; i < 5; i++) {
      const lag = i * 0.55;
      const yawT = (i === 0 ? 1 : 0.85) * wagAmp * sin(st.wagPh - lag) + (i === 0 ? counter : counter * 0.4) + (i > 0 ? 0.06 * k.moveK * sin(k.ph - lag) : 0)
        + curl * (i === 0 ? 0.8 : 0.35);
      const bendT = i === 0 ? carry : (st.fear * 0.35 + (i > 2 ? -T.curl * 0.3 * st.alert : 0) - 0.06 * (k.gal + k.lope));
      // springs: stiffer toward the root, the tip follows through
      const kk = 260 - i * 45, cc = 2 * sqrt(kk) * (0.55 - i * 0.05);
      const bounce = i > 0 ? -(st.cyA || 0) * 0.002 * i : 0;
      st.tailYV[i] += (-kk * (st.tailY[i] - yawT) - cc * st.tailYV[i]) * dt;
      st.tailY[i] += st.tailYV[i] * dt;
      st.tailPV[i] += (-kk * (st.tailP[i] - bendT) - cc * st.tailPV[i] + bounce * kk) * dt;
      st.tailP[i] += st.tailPV[i] * dt;
      rxyz(b[tb[i]], 0, st.tailY[i], st.tailP[i]);
    }
    void k.liftH;
  }

  // ---- breathing and panting (the ribs bone), and the trunk's vertical
  //      acceleration the springs read
  function breath(rig, st, dt, effort) {
    const D = rig.D, b = rig.bones;
    const restF = 0.33 * Math.pow(D.mass / 30, -0.25), pantF = 4.2 * Math.pow(D.mass / 30, -0.12);
    const pk = clamp(st.pant * 1.2 - 0.1, 0, 1);
    const fq = lerp(restF * (1 + effort), pantF, pk);
    st.breathPh += dt * TAU * fq;
    const amp = lerp(0.016, 0.009, pk) * (1 - st.dead);
    const s = sin(st.breathPh) * amp;
    // the belly: a host's fed / lean girth (the wildlife hunger cue) swells the
    // ribs and the loin, never the legs or the head
    const bk = rig.belly || 1;
    b[BN.ribs].scale.set(1, (1 + s) * bk, (1 + s * 0.85) * bk);
    if (bk !== 1 || rig._bellyOn) { rig._bellyOn = true; const lk = Math.pow(bk, 0.8); b[BN.loin].scale.set(1, lk, lk); }
    // vertical acceleration of the chest (for ears / tail follow-through)
    const cy = b[BN.chest].position.y;
    const v = (cy - (st.cyP || cy)) / Math.max(dt, 1e-3);
    st.cyA = clamp((v - (st.cyV || 0)) / Math.max(dt, 1e-3), -60, 60);
    st.cyV = v; st.cyP = cy;
  }

  // ---- idle life: look round, ear flicks, scratch, shake off, yawn
  function idle(rig, st, dt, on, post) {
    const r = rig.rng;
    if (st.act) {
      st.actT += dt;
      if (st.actT >= st.actDur || !on) { st.act = ""; st.actT = 0; }
    }
    if (st.act === "scratch") {
      // the hind leg's rapid scratch is posed in legsScratch (after the IK)
    }
    if (!on) { st.idleT = 0; return; }
    st.idleT += dt;
    st.idleNext -= dt;
    if (st.idleNext > 0 || st.act) return;
    const x = r();
    st.idleNext = 2 + r() * 4.5;
    if (r() < 0.6) { st.flickT = 0.25; st.flickS = r() < 0.5 ? 0 : 1; }
    if (x < 0.4) { st.act = "look"; st.actDur = 1.2 + r() * 2; st.lookTo = (r() - 0.5) * 2.0; }
    else if (x < 0.55 && post === "sit") { st.act = "scratch"; st.actDur = 1.4 + r(); st.actSide = r() < 0.5 ? -1 : 1; }
    else if (x < 0.65 && post === "stand" && st.idleT > 8) { st.act = "shake"; st.actDur = 1.0; }
    else if (x < 0.75 && (post === "lie" || post === "sit") && st.idleT > 6) { st.act = "yawn"; st.actDur = 1.6; }
    st.actT = 0;
  }

  // the scratching hind leg, over the IK result: up to the neck, fast strokes
  function scratchPose(rig, st) {
    // (a rig posed before its idle state exists, a city dog fresh off the
    // kennel or a wild canid's first frame, has no st yet: nothing to scratch)
    if (!st || st.act !== "scratch" || rig.ragdoll || rig._limp) return;
    const b = rig.bones, s = st.actSide || 1, Lg = s < 0 ? 2 : 3, ids = LEGB[Lg];
    const e = sstep(0, 0.2, st.actT) * (1 - sstep(st.actDur - 0.2, st.actDur, st.actT));
    const fq = 5.2 * Math.pow(rig.D.mass / 30, -0.2), osc = sin(TAU * fq * st.actT);
    const A = rig.legA[Lg];
    rxyz(b[ids[0]], A[0] + e * s * -0.25, 0, A[1] + e * (0.9 + 0.15 * osc));
    rz(b[ids[1]], A[2] + e * (-0.9 + 0.25 * osc));
    rz(b[ids[2]], A[3] + e * (0.6 + 0.2 * osc));
  }

  // ---- far bodies swap to the light shell (same skeleton) -------------------
  const LOD_FAR = 32;
  function lodCheck(rig, x, y, z, dt) {
    rig.lodT -= dt;
    if (rig.lodT > 0) return;
    rig.lodT = 0.4 + (rig.seed % 7) * 0.03;
    const cam = CBZ.camera;
    if (!cam || !cam.position) return;
    // where the body really is (a host's control coordinates may be local to
    // a parent group); the last rendered matrix is good enough for a LOD
    const e = rig.mesh.matrixWorld.elements;
    if (e[12] !== 0 || e[13] !== 0 || e[14] !== 0) { x = e[12]; y = e[13]; z = e[14]; }
    const d = hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z) / Math.max(0.5, rig.D.K);
    const want = d > LOD_FAR * 1.08 ? 1 : (d < LOD_FAR * 0.92 ? 0 : rig.lod);
    if (want !== rig.lod) { rig.lod = want; rig.mesh.geometry = geoOf(rig.D, want, rig.coat, rig.collarHex); }
  }

  // ==========================================================================
  //  THE MOUTH IN THE WORLD — the jaw tip of the posed body
  // ==========================================================================
  const _m4 = [], _mtmp = { x: 0, y: 0, z: 0 };
  function boneWorld(rig, bi, out) {
    // compose local matrices up the chain (cheap: no scene traversal)
    const THREE = W.THREE;
    const chain = [];
    for (let i = bi; i >= 0; i = PARENT[i]) chain.push(rig.bones[i]);
    const m = rig._bm || (rig._bm = new THREE.Matrix4()), t = rig._bt || (rig._bt = new THREE.Matrix4());
    rig.mesh.updateWorldMatrix(true, false);
    m.copy(rig.mesh.matrixWorld);
    for (let i = chain.length - 1; i >= 0; i--) { chain[i].updateMatrix(); t.copy(chain[i].matrix); m.multiply(t); }
    const e = m.elements;
    out.x = e[12]; out.y = e[13]; out.z = e[14];
    rig._lastM = m;
    return out;
  }
  function mouthWorld(rig, out) {
    out = out || { x: 0, y: 0, z: 0 };
    if (!rig || !W.THREE) return out;
    boneWorld(rig, BN.head, _mtmp);
    // the mouth in the head bone's local frame (bind head space)
    const D = rig.D, mo = D.hs(D.mouthH.u, D.mouthH.v);
    const lx = mo.x - D.headP.x, ly = mo.y - D.headP.y;
    const e = rig._lastM.elements;
    out.x = e[0] * lx + e[4] * ly + e[12];
    out.y = e[1] * lx + e[5] * ly + e[13];
    out.z = e[2] * lx + e[6] * ly + e[14];
    rig.mouthOk = true;
    if (out !== rig.mouthW) { rig.mouthW.x = out.x; rig.mouthW.y = out.y; rig.mouthW.z = out.z; }
    return out;
  }
  // the jaw radius a wound needs: half the arch of teeth the jaws close
  // across (canine to carnassial), in world metres
  function jawRadius(rig) {
    const D = rig.D, sc = rig.mesh.scale.x * ((rig.mesh.parent && rig.mesh.parent.scale) ? rig.mesh.parent.scale.x : 1);
    return 0.5 * hypot(D.row.muzK * D.hl * 0.62, D.row.muzW * D.hl * 2) * sc;
  }
  function biteId(rig) { return rig.D.row.kind === "dog" ? "dog:" + rig.D.row.id : rig.D.row.id; }
  // the live mouth in a host group's own units: what creature_combat and
  // systems/predator.js read as actor._jawL (the hit test, the seize seat)
  function jawLocal(rig, grp, heading, out) {
    out = out || { x: 0, y: 0, z: 0 };
    if (!rig.mouthOk || !grp) return out;
    const inv = 1 / ((grp.scale && grp.scale.x) || 1);
    const dx = rig.mouthW.x - grp.position.x, dz = rig.mouthW.z - grp.position.z, dy = rig.mouthW.y - grp.position.y;
    out.x = (dx * cos(heading) + dz * sin(heading)) * inv; out.y = dy * inv; out.z = (-dx * sin(heading) + dz * cos(heading)) * inv;
    return out;
  }

  // ==========================================================================
  //  THE BITE SEAM — where the jaw is on the victim, what it bit, the wound
  // ==========================================================================
  const _cp = { x: 0, y: 0, z: 0 };
  function limbSeg(ch, key, lowKey, len) {
    // a limb of the human rig: its top pivot and its joint pivot (world)
    const THREE = W.THREE, top = ch.parts && ch.parts[key], low = ch.low && ch.low[key];
    if (!top || !low) return null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    top.getWorldPosition(a); low.getWorldPosition(b);
    // the lower segment runs on from the joint along the limb's own down axis
    const q = new THREE.Quaternion(); low.getWorldQuaternion(q);
    c.set(0, -len, 0).applyQuaternion(q).add(b);
    void lowKey;
    return { top: a, joint: b, end: c, node: low, topNode: top };
  }
  function closestOnSeg(p, a, b, out) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1);
    out.x = a.x + abx * t; out.y = a.y + aby * t; out.z = a.z + abz * t; out.t = t;
    return out;
  }
  function contactOn(victim, mouth, loc) {
    const THREE = W.THREE;
    const ch = victim.char;
    if (ch && ch.parts && ch.low) {
      // a person: the nearest limb of the kind the bite went for (an arm, a
      // leg, the throat); with no aim, the nearest limb or the trunk
      const cand = [];
      const keys = loc === "arm" ? ["la", "ra"] : loc === "throat" ? [] : (loc === "leg" ? ["ll", "rl"] : ["la", "ra", "ll", "rl"]);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], arm = k[1] === "a";
        const sg = limbSeg(ch, k, k, arm ? 0.26 : 0.43);
        if (!sg) continue;
        cand.push({ a: sg.top, b: sg.joint, node: sg.topNode, part: arm ? "upperarm" : "thigh", r: arm ? 0.05 : 0.075 });
        cand.push({ a: sg.joint, b: sg.end, node: sg.node, part: arm ? "forearm" : "calf", r: arm ? 0.038 : 0.055 });
      }
      if (!loc || loc === "flank" || loc === "rump") {
        const g = victim.group || ch.group;
        if (g) {
          const a = new THREE.Vector3(), bq = new THREE.Vector3();
          g.updateWorldMatrix(true, false);
          a.set(0, 0.95, 0); g.localToWorld(a); bq.set(0, 1.4, 0); g.localToWorld(bq);
          cand.push({ a: a, b: bq, node: g, part: "torso", r: 0.15 });
        }
      }
      if (loc === "throat" || !cand.length) {
        const g = victim.group || ch.group, a = new THREE.Vector3(), bq = new THREE.Vector3();
        if (ch.neck && ch.neck.getWorldPosition) { ch.neck.getWorldPosition(a); bq.copy(a); bq.y -= 0.08; cand.push({ a: a, b: bq, node: ch.neck, part: "throat", r: 0.06 }); }
        else if (g) { a.copy(g.position); a.y += 1.4; bq.copy(a); bq.y -= 0.2; cand.push({ a: a, b: bq, node: g, part: "throat", r: 0.07 }); }
      }
      let best = null, bd = 1e9;
      const q = { x: 0, y: 0, z: 0, t: 0 };
      for (let i = 0; i < cand.length; i++) {
        const cd = cand[i];
        closestOnSeg(mouth, cd.a, cd.b, q);
        const d = hypot(mouth.x - q.x, mouth.y - q.y, mouth.z - q.z);
        if (d < bd) { bd = d; best = { cd: cd, x: q.x, y: q.y, z: q.z }; }
      }
      if (!best) return null;
      // on the limb's surface, on the side the teeth came from
      const dx = mouth.x - best.x, dy = mouth.y - best.y, dz = mouth.z - best.z, dl = hypot(dx, dy, dz) || 1;
      const p = new THREE.Vector3(best.x + dx / dl * best.cd.r, best.y + dy / dl * best.cd.r, best.z + dz / dl * best.cd.r);
      const node = best.cd.node;
      node.updateWorldMatrix(true, false);
      const local = node.worldToLocal(p.clone());
      return { x: p.x, y: p.y, z: p.z, part: best.cd.part, node: node, local: local };
    }
    // an animal (or a body with no limbs): its own box, ellipsoid-fitted
    const g = victim.group;
    if (!g) return null;
    let bx = victim._biteBox;
    if (!bx) {
      g.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(g);
      const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      const loc0 = box.clone().applyMatrix4(inv);
      bx = victim._biteBox = { c: loc0.getCenter(new THREE.Vector3()), h: loc0.getSize(new THREE.Vector3()).multiplyScalar(0.5) };
    }
    g.updateWorldMatrix(true, false);
    const lp = g.worldToLocal(new THREE.Vector3(mouth.x, mouth.y, mouth.z));
    const rx = (lp.x - bx.c.x) / Math.max(1e-3, bx.h.x), ry = (lp.y - bx.c.y) / Math.max(1e-3, bx.h.y), rz = (lp.z - bx.c.z) / Math.max(1e-3, bx.h.z);
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (rl > 1) { lp.x = bx.c.x + rx / rl * bx.h.x; lp.y = bx.c.y + ry / rl * bx.h.y; lp.z = bx.c.z + rz / rl * bx.h.z; }
    const wp = g.localToWorld(lp.clone());
    // what was bitten, from where on the body the teeth closed
    const fx = (lp.x - bx.c.x) / bx.h.x, fy = (lp.y - bx.c.y) / bx.h.y;
    let part = loc || "flank";
    if (fy < -0.35) part = fx < 0 ? "hock" : "foreleg";
    else if (fx > 0.55) part = fy > 0.1 ? "neck" : "throat";
    else if (fx < -0.55) part = "rump";
    else part = "flank";
    if (loc === "nose" && fx > 0.6) part = "muzzle";
    return { x: wp.x, y: wp.y, z: wp.z, part: part, node: g, local: lp };
  }
  function gripPoint(grip, out) {
    if (!grip || !grip.node || !grip.local) return null;
    const THREE = W.THREE;
    const p = (grip._w || (grip._w = new THREE.Vector3())).copy(grip.local);
    grip.node.updateWorldMatrix(true, false);
    grip.node.localToWorld(p);
    out.x = p.x; out.y = p.y; out.z = p.z;
    return out;
  }
  /* bite(attacker, rig, victim, info) -> contact | null
       info.sev 0..1, info.loc (what the fight went for: arm leg throat flank
       hock rump nose), info.kill; the attacker is the actor (for fromX/Z).
     People: CBZ.bodyBite(victim, point, { jaw, sev, by, byActor, dir, part, fromX, fromZ });
     animals: CBZ.creatureBiteChunk(victim, point, { jaw, sev, by, byActor, dir, part, bleedS }). */
  function bite(att, rig, victim, info) {
    if (!rig || !victim || !W.THREE) return null;
    info = info || {};
    const mouth = mouthWorld(rig, { x: 0, y: 0, z: 0 });
    // the player's limbs live on its wound rig (systems/capture.js)
    const body = (victim.isPlayer && !victim.char && CBZ.playerWoundActor) ? CBZ.playerWoundActor : victim;
    let ct = null;
    try { ct = contactOn(body, mouth, info.loc); } catch (e) { ct = null; }
    if (!ct) return null;
    // the jaw's travel at contact: from the head pivot through the teeth to the flesh
    const hp = boneWorld(rig, BN.head, { x: 0, y: 0, z: 0 });
    let dx = ct.x - hp.x, dy = ct.y - hp.y, dz = ct.z - hp.z;
    const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const facts = { jaw: jawRadius(rig), sev: clamp(info.sev != null ? info.sev : 0.6, 0, 1), by: biteId(rig), dir: { x: dx, y: dy, z: dz }, part: ct.part };
    const person = !!(victim.char || victim.isPlayer) && !victim.beast && !victim.animal;
    try {
      if (person) {
        if (typeof CBZ.bodyBite === "function") {
          // byActor: the biter itself, so wounds.js can roll the head with the
          // shake and keep a torn-off piece in this mouth
          CBZ.bodyBite(victim, { x: ct.x, y: ct.y, z: ct.z }, { jaw: facts.jaw, sev: facts.sev, by: facts.by, byActor: att || null, dir: facts.dir, part: facts.part,
            fromX: att && att.pos ? att.pos.x : undefined, fromZ: att && att.pos ? att.pos.z : undefined, kill: !!info.kill });
        }
      } else if (typeof CBZ.creatureBiteChunk === "function") {
        CBZ.creatureBiteChunk(victim, { x: ct.x, y: ct.y, z: ct.z }, { jaw: facts.jaw, sev: facts.sev, by: facts.by, byActor: att || null, dir: facts.dir, part: facts.part, bleedS: 12 });
      }
    } catch (e) {}
    ct.facts = facts;
    return ct;
  }

  // ==========================================================================
  //  NPC WAR: build / animate
  // ==========================================================================
  function build(id, ctx) {
    if (!kitReady()) return null;
    const seed = ((ctx && ctx.seed) | 0) || Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const rid = id === "dog" ? WAR_DOGS[seed % WAR_DOGS.length] : id;
    // the battle scales the group by the bestiary row's `scale`; the body is
    // authored in real metres, so it carries the inverse
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
    const rowScale = sp && sp.scale ? sp.scale : 1;
    const rig = makeRig(rid, { seed: seed, scale: 1 / rowScale });
    const g = rig.group;
    const mass = rig.D.mass * rig.indiv * rig.indiv * rig.indiv;
    g.userData.canid = { id: rid, rig: rig, mass: mass, K: rig.D.K, withers: rig.D.withers * rig.indiv, rng: rig.rng, P: rig.D.row };
    g.userData.dogRig = rig;
    return g;
  }
  // the battle unit's pose from its own motion and its fight
  function animate(m, dt) {
    const cn = m.group && m.group.userData.canid;
    if (!cn) return;
    if (!m._cn) { m._cn = cn; cn.rig.trackMouth = true; deathProxy(m, cn.rig); }
    const rig = cn.rig, D = rig.D, P = D.row;
    const c = m._cnCtl || (m._cnCtl = { posture: "stand", limp: [0, 0, 0, 0] });
    const st0 = rig.st;
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y; c.heading = typeof m.heading === "number" ? m.heading : 0;
    c.ground = CBZ.floorAt || null;
    c.dead = !!m.dead;
    const cf = m._cf, t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const dT = t ? hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    const fleeing = m.state === "flee" || m.routed || m.slot === "fallback";
    const hpK = m.maxHp ? clamp(m.hp / m.maxHp, 0, 1) : 1;
    // hit reactions off the hp ledger
    const u = m._cnU || (m._cnU = { lastHp: m.hp, limp: [0, 0, 0, 0], still: 0, idleAct: 0, idleNext: 3, lookTo: 0 });
    c.flinch = 0; c.yelp = false;
    if (u.lastHp != null && m.hp < u.lastHp - 0.25) {
      const lost = (u.lastHp - m.hp) / (m.maxHp || 50), roll = rig.rng();
      const loc = roll < 0.12 ? 4 : roll < 0.62 ? 5 : Math.floor((roll - 0.62) / 0.095);
      c.flinch = Math.min(1, 0.45 + lost * 3);
      let side = rig.rng() < 0.5 ? -1 : 1;
      if (t) { const h = c.heading, lx = -sin(h) * (t.pos.x - m.pos.x) + cos(h) * (t.pos.z - m.pos.z); side = lx > 0 ? -1 : 1; }
      c.flinchS = side; c.yelp = true;
      if (loc < 4 && lost > 0.08) u.limp[Math.min(3, loc)] = Math.min(1, u.limp[Math.min(3, loc)] + lost * 2.6);
    }
    u.lastHp = m.hp;
    for (let i = 0; i < 4; i++) c.limp[i] = u.limp[i];
    const engaged = t && dT < 14 && !fleeing;
    const ph = cf && engaged ? cf.ph : "";
    c.alert = t ? 1 : 0.25;
    c.aggr = engaged ? (ph === "threat" ? 1 : 0.7) : 0;
    c.fear = fleeing ? 1 : (hpK < 0.35 ? 0.5 : 0) + (t && t.vehicle ? 0.6 : 0);
    c.pant = clamp((st0 ? abs(st0.v) * D.K : 0) / 5 + (cf && cf.stam < 0.6 ? 0.6 : 0) + (1 - hpK) * 0.3, 0, 1);
    c.threat = ph === "threat" ? 1 : 0;
    c.hold = ph === "hold" ? 1 : 0;
    let lungeE = 0, gape = 0;
    if (ph === "lunge" && cf) {
      const k = clamp(cf.pt / cf.lungeT, 0, 1);
      lungeE = k < 0.3 ? -0.35 * (k / 0.3) : k < 0.62 ? -0.35 + 1.35 * ((k - 0.3) / 0.32) : 1 - (k - 0.62) / 0.38;
      gape = k < 0.28 ? 0.2 : k < 0.6 ? 0.2 + 0.8 * ((k - 0.28) / 0.32) : Math.max(0, 1 - (k - 0.6) / 0.06);
    }
    c.lunge = lungeE; c.gape = gape;
    // a leap: airborne through the drive, an arc of a canid's ~25 degree launch
    // over the distance it flies (apex = d tan 25 / 4)
    c.air = 0; c.airH = 0; c.airTilt = 0;
    if (ph === "lunge" && cf && cf.leapD > 0.3) {
      const k = clamp(cf.pt / cf.lungeT, 0, 1), u = clamp((k - 0.2) / 0.45, 0, 1);
      c.air = u > 0 && u < 1 ? sin(PI * u) : 0;
      c.airH = 0.117 * cf.leapD / Math.max(0.3, (m.group.scale.x || 1) * rig.mesh.scale.x);
      c.airTilt = 1 - 2 * u;
    }
    const mY = D.mouth.y * rig.indiv;
    c.rearUp = (ph === "lunge" || ph === "hold") && cf ? clamp((cf.biteY - mY) / (D.withers * 0.9), 0, 1) * (ph === "lunge" ? Math.max(0, lungeE) : 1) : 0;
    c.lowBite = (ph === "lunge" || ph === "hold") && cf ? clamp((mY - cf.biteY) / (D.withers * 0.6), 0, 1) : 0;
    c.mouthTo = ph === "hold" ? cn.mouthTo || null : null;
    // the live mouth only while the jaws are at work (the bite itself
    // measures the posed jaw at contact either way)
    rig.trackMouth = ph === "lunge" || ph === "hold";
    // idle: sniff, look round, sit, lie, howl
    const v = st0 ? abs(st0.v) : 0;
    const still = v < 0.15 && !t;
    u.still = still ? u.still + dt : 0;
    if (still) {
      u.idleNext -= dt;
      if (u.idleNext <= 0) {
        const r = rig.rng();
        u.idleAct = r < 0.32 ? 1 : r < 0.72 && P.howl && u.still > 6 && r > 0.62 ? 3 : 0;
        u.idleNext = u.idleAct === 3 ? 4.5 : 1.6 + rig.rng() * 3;
      }
    } else u.idleAct = 0;
    c.sniff = u.idleAct === 1 ? 1 : 0;
    c.howl = u.idleAct === 3 ? 1 : 0;
    c.posture = m.dead ? "dead" : still && u.still > 30 ? "lie" : still && u.still > 14 ? "sit" : "stand";
    c.idle = !t && !m.dead;
    if (t) {
      const h = c.heading;
      c.lookYaw = -wrapPi(atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - h);
      c.lookPitch = clamp(((t.beast ? (t.eyeH || 1) * 0.7 : 1.4) - D.headP.y) / Math.max(1, dT), -0.4, 0.5);
    } else { c.lookYaw = 0; c.lookPitch = 0; }
    pose(rig, dt, c);
    scratchPose(rig, rig.st);
  }
  // the ragdoll proxy: bones answer to the corpse solver once dead
  function deathProxy(m, rig) {
    const D = rig.D, b = rig.bones, bp = rig.bindPos;
    const THREE = W.THREE;
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    // each leg's upper and lower segment bind directions (model = local at bind)
    const B1 = [], B2 = [];
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, a1 = front ? D.bF[1] : D.bH[0], a2 = front ? D.bF[2] : D.bH[1];
      B1.push(new THREE.Vector3(cos(a1), sin(a1), 0)); B2.push(new THREE.Vector3(cos(a2), sin(a2), 0));
    }
    let reset = false;
    function msc() { return rig.mesh.scale.x || 1; }
    function limp() {
      if (reset) return;
      reset = true; rig.ragdoll = true;
      limpPose(rig);
    }
    const bodyY = Math.max(D.shj.y, D.hip.y) * 1.02;
    const cols = [], KX = [], KY = [], KZ = [];
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg];
      const J = front ? D.shj : D.hip, z = (Lg % 2 === 0 ? -1 : 1) * (front ? D.zF : D.zH);
      const footY = front ? D.padF : D.padH, kneeY = (footY + bodyY) * 0.5;
      const s0 = msc();
      const knee = { position: { x: J.x * s0, y: kneeY * s0, z: z * s0, set: function (x, y, zz) { const s = msc(); KX[Lg] = x / s; KY[Lg] = y / s; KZ[Lg] = zz / s; } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
      const foot = { position: { x: J.x * s0, y: footY * s0, z: z * s0, set: function (x, y, zz) {
        if (!m.dead) return;
        limp();
        const s = msc(); x /= s; y /= s; zz /= s;
        // the first segment points at the knee point, the second at the foot
        const top = front ? D.shj : D.hip;
        v1.set(KX[Lg] - top.x, KY[Lg] - top.y, KZ[Lg] - z);
        if (v1.lengthSq() < 1e-8) return;
        v1.normalize();
        q1.setFromUnitVectors(B1[Lg], v1);
        b[ids[front ? 1 : 0]].quaternion.copy(q1);
        v2.set(x - KX[Lg], y - KY[Lg], zz - KZ[Lg]);
        if (v2.lengthSq() < 1e-8) return;
        v2.normalize().applyQuaternion(q2.copy(q1).invert());
        b[ids[front ? 2 : 1]].quaternion.setFromUnitVectors(B2[Lg], v2);
        rig._rcBones = (rig._rcBones || 0) + 1;
      } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
      cols.push({ x: J.x * s0, z: z * s0, top: bodyY * s0, h: bodyY * s0, parts: [{ m: knee, bx: J.x * s0, by: kneeY * s0 }, { m: foot, bx: J.x * s0, by: footY * s0 }] });
    }
    const hp = D.headP, neckX = D.shj.x, s0 = msc();
    const d0x = hp.x - neckX, d0y = hp.y - bodyY;
    const head = { position: { x: hp.x * s0, y: hp.y * s0, z: 0, set: function (x, y, zz) {
      if (!m.dead) return;
      limp();
      const s = msc(); x /= s; y /= s; zz /= s;
      const dx = x - neckX, dy = y - bodyY;
      const pitch = atan2(dy, hypot(dx, zz)) - atan2(d0y, d0x);
      const yaw = atan2(-zz, dx);
      b[BN.neck].rotation.set(0, yaw * 0.6, clamp(pitch * 0.6, -1.3, 1.0));
      b[BN.neck1].rotation.set(0, yaw * 0.4, clamp(pitch * 0.4, -1.0, 0.8));
      rig._rcBones = (rig._rcBones || 0) + 1;
    } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
    const gait = { cols: cols, head: [{ m: head, bx: hp.x * s0, by: hp.y * s0 }], headMesh: null, amp: 0.1, freq: 2, step: 0, k: 0, grazeK: 0, _canid: true };
    // the corpse solver (and anything that discovers a gait rig) sees the
    // proxy only once the animal is dead; alive, nothing else writes the bones
    try {
      Object.defineProperty(m, "gait", { configurable: true, enumerable: false, get: function () { if (m.dead) limp(); return m.dead ? gait : undefined; }, set: function () {} });
    } catch (e) {}
    rig.unragdoll = function () { reset = false; rig.ragdoll = false; rig._rc = null; rig.mesh.position.set(0, 0, 0); };
  }

  // ==========================================================================
  //  THE BESTIARY: the wildlife rows build this body and animate it here
  // ==========================================================================
  function wildBuild(id, ctx) {
    if (!kitReady()) return null;
    const r = (ctx && ctx.rng) || Math.random;
    const seed = Math.floor(r() * 1e9) + 1;
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
    const rowScale = sp && sp.scale ? sp.scale : 1;
    const rig = makeRig(id, { seed: seed, scale: 1 / rowScale });
    const g = rig.group;
    g.userData.canid = { id: id, rig: rig, mass: rig.D.mass, K: rig.D.K, withers: rig.D.withers, rng: rig.rng, P: rig.D.row };
    g.name = "beast:" + id;
    rig.mesh.name = "body";
    return g;
  }
  // a wildlife actor (city/wildlife.js): its state -> the body language
  function animateActor(a, dt) {
    const grp = a.group, cn = grp && grp.userData.canid;
    if (!cn) return false;
    const rig = cn.rig;
    // (a streamed body is rebuilt when the animal comes back into range: a
    // new rig, so everything below is re-seated on it)
    if (!a._cnA || a._cnA.rig !== rig) {
      a._cnA = { rig: rig, idle: 0, act: 0, next: 2 + rig.rng() * 3, lastHp: a.hp, limp: [0, 0, 0, 0] };
      rig.trackMouth = true;
      deathProxy(a, rig);
      // the creature seams read the mouth from here, live, in group units
      a._jawL = { x: rig.D.mouth.x * rig.mesh.scale.x, y: rig.D.mouth.y * rig.mesh.scale.x, z: 0 };
      a._jawGripL = { x: a._jawL.x - 0.03 * rig.D.K, y: a._jawL.y - 0.015 * rig.D.K, z: 0 };
      a.biteId = biteId(rig);
    }
    if (a.dead) {
      // laid down by the ragdoll or a tumble: rests bodily on the ground (a
      // skinned husk is let sink away by the engine)
      if (!a.skinned && (rig.ragdoll || tipped(grp))) {
        if (!rig.ragdoll && !rig._limp) { limpPose(rig); rig._limp = true; }
        restCorpse(rig, { ground: CBZ.floorAt || null });
      }
      return true;
    }
    // A PERSON IN THESE JAWS (systems/predator.js, THE BITE ON LAND): the seize
    // moves the body and then poses it itself, so the paws plant against the
    // body's real motion; the wildlife tick's own pass stands down
    const LG = a._landGrip;
    if (LG && LG.on && !LG.now) return true;
    // the hunger cue swells the belly (ribs + loin bones), not the whole
    // skinned mesh: wildlife_traits' named-hull swell is turned away here
    a._bodyMesh = null;
    const ms = rig.mesh.scale;
    if (ms.y !== ms.x || ms.z !== ms.x) { ms.y = ms.x; ms.z = ms.x; }
    if (CBZ.wildlifeHunger) {
      let hg = 0.5;
      try { hg = CBZ.wildlifeHunger(a); } catch (e) { hg = 0.5; }
      if (isFinite(hg)) rig.belly = Math.round((1 + (0.5 - hg) * 0.24) / 0.04) * 0.04;
    }
    const u = a._cnA, D = rig.D, P = D.row;
    const c = u.c || (u.c = { posture: "stand", limp: [0, 0, 0, 0] });
    c.x = grp.position.x; c.z = grp.position.z; c.y = grp.position.y;
    c.heading = a.faceH == null ? a.heading : a.faceH;
    c.ground = CBZ.floorAt || null;
    const s = a.state, hs = a._huntSt;
    const hpK = a.maxHp ? clamp(a.hp / a.maxHp, 0, 1) : 1;
    c.flinch = (a._flinchT || 0) > 0 ? 0.7 : 0; c.flinchS = 1; c.yelp = false;
    if (u.lastHp != null && a.hp < u.lastHp - 0.25) { c.yelp = true; c.flinch = 0.8; }
    u.lastHp = a.hp;
    c.fear = s === "flee" ? 1 : (hpK < 0.3 ? 0.5 : 0);
    c.alert = (s === "stalk" || s === "charge" || a.alarm > 0.5) ? 1 : (s === "flee" ? 0.5 : 0.2);
    c.aggr = s === "charge" ? 1 : (hs === "circle" || hs === "bump" ? 0.6 : 0);
    c.threat = hs === "circle" ? 0.6 : 0;
    c.hold = (hs === "seize" || a._seizing) ? 1 : 0;
    // a creature_combat strike: _atkAnim 0..1 drives the lunge and the snap
    let lungeE = 0, gape = 0;
    if (a._atkAnim != null && a._atkAnim >= 0) {
      const k = a._atkAnim;
      lungeE = k < 0.3 ? -0.35 * (k / 0.3) : k < 0.62 ? -0.35 + 1.35 * ((k - 0.3) / 0.32) : 1 - (k - 0.62) / 0.38;
      gape = k < 0.28 ? 0.2 : k < 0.6 ? 0.2 + 0.8 * ((k - 0.28) / 0.32) : Math.max(0, 1 - (k - 0.6) / 0.06);
    }
    c.lunge = lungeE; c.gape = gape;
    c.sniff = s === "graze" ? 1 : 0;
    // a hunt in cover is a stalk: low, slow, the head out level
    if (s === "stalk") { c.threat = Math.max(c.threat, 0.35); }
    const still = !(a._motionMoved > 0.003) && s !== "flee" && s !== "charge";
    u.idle = still ? u.idle + dt : 0;
    c.posture = "stand";
    if (a.tamed && (a._sitK || 0) > 0.5) c.posture = "sit";
    else if (still && s === "idle" && u.idle > 12) c.posture = u.idle > 30 ? "lie" : "sit";
    c.howl = 0;
    if (still && P.howl && u.idle > 8 && s === "idle") {
      u.next -= dt;
      if (u.next <= 0) { u.howlT = 4.2; u.next = 25 + rig.rng() * 40; }
    }
    if (u.howlT > 0) { u.howlT -= dt; c.howl = 1; c.posture = "sit"; }
    c.pant = null;
    c.idle = s !== "charge" && s !== "flee";
    c.lookYaw = 0; c.lookPitch = 0;
    const tgt = a._prey || (s === "charge" || s === "stalk" ? CBZ.player : null);
    const tp = tgt && (tgt.pos || (tgt.group && tgt.group.position));
    if (tp) { c.look = tp; } else c.look = null;
    c.mouthTo = null;
    if (LG && LG.on) {
      // the grip: the jaw reaches for the bitten part (LG.to, world), the body
      // braces back on it, rears to a high one and drops its forequarters to a
      // low one, and the head worries it in bursts (LG.shake)
      const wsc = rig.mesh.scale.x * (grp.scale.x || 1), mY = D.mouth.y * wsc, wH = D.withers * wsc;
      const ty = LG.to.y - grp.position.y;
      c.mouthTo = LG.to; c.look = null; c.hold = LG.gape > 0.05 ? 0 : 1; c.shake = !!LG.shake;
      c.aggr = 1; c.alert = 1; c.fear = 0; c.threat = 0; c.sniff = 0; c.howl = 0; c.idle = false; c.posture = "stand";
      c.lunge = LG.lunge || 0; c.gape = LG.gape || 0;
      c.rearUp = clamp((ty - mY) / (wH * 0.9), 0, 1);
      c.lowBite = clamp((mY - ty) / (wH * 0.6), 0, 1);
    } else { c.shake = false; c.rearUp = 0; c.lowBite = 0; }
    pose(rig, dt, c);
    scratchPose(rig, rig.st);
    // keep the creature seams' mouth on the posed jaw (group units)
    if (rig.mouthOk) {
      jawLocal(rig, grp, c.heading, a._jawL);
      a._jawGripL.x = a._jawL.x - 0.03 * D.K; a._jawGripL.y = a._jawL.y - 0.015 * D.K; a._jawGripL.z = a._jawL.z;
    }
    // the audit wildlife_rig keeps for every walker: moving along the nose
    const mx = grp.position.x, mz = grp.position.z;
    const mdx = a._gpx == null ? 0 : mx - a._gpx, mdz = a._gpz == null ? 0 : mz - a._gpz;
    const moved = hypot(mdx, mdz);
    a._gpx = mx; a._gpz = mz;
    a._motionMoved = moved > 0.0025 ? moved : 0;
    a._motionAlignment = moved > 0.0025 ? (mdx / moved) * cos(c.heading) + (mdz / moved) * sin(c.heading) : 1;
    return true;
  }

  Object.assign(API, {
    BN: BN, LEGB: LEGB, NB: NB, PARENT: PARENT, rig: makeRig, pose: function (rig, dt, c) { const s = pose(rig, dt, c); scratchPose(rig, rig.st); return s; },
    collar: collar, mouthWorld: mouthWorld, jawRadius: jawRadius, biteId: biteId, bite: bite, gripPoint: gripPoint, contactOn: contactOn, jawLocal: jawLocal,
    wildBuild: wildBuild, animateActor: animateActor, deathProxy: deathProxy, kitReady: kitReady,
    _shapeOf: shapeOf, _geoOf: geoOf, _coatFn: coatFn, _tailSetup: tailSetup, _legBind: legBind, _postures: postures,
  });
})();
