/* ============================================================
   units/kit/felid.js — CBZ.felidKit: ONE CAT ENGINE, MANY CATS.

   The cheetah and the snow leopard (src/units/species/cheetah.js,
   snow_leopard.js) are DATA handed to this file: skeleton lengths, body
   volumes, coat, gait table, top speed, acceleration, endurance, nerve and
   a move set. Everything that is the same about a cat lives here once:

     BODY     a lofted, skinned shell on a CBZ.quadRig skeleton (2-bone neck,
              6-bone tail, ears, jaw), vertex-coloured coat (belly, face,
              ears, pads, claws, teeth, eyes) plus a PATTERN SHADER that
              paints the spots / rosettes / tail rings / tear marks in the
              body's own bind space, so they are crisp at any distance and
              stick to the skin when it bends. One shared geometry per
              (species, sex, coat) and one material per (species, sex).
     GAIT     CBZ.quadGait with the species' table (lateral-sequence walk,
              trot, rotary gallop, a low-duty sprint), feet planted; the
              spine flexes and extends through the gallop, the head is held
              level, the tail is a rudder that swings into turns.
     BRAIN    per animal, riding the battle's own seams (no battle globals):
              speed is commanded through a per-unit copy of `m.tn`
              (acceleration, a stalk, a sprint that runs out, rest and
              panting), flight through `tn.prey` (thinkBeast's own flee
              path), fear from wounds, from bigger predators and machines.
     FIGHT    the species' real repertoire (trip + throat hold; pounce, nape
              bite, rear-up grapple; a defensive swat), damage from the
              move's own numbers x the battle's size/hunger multiplier, a man
              knocked down through CBZ.verbs.knockdown.
     DEATH    the body carries invisible leg/head/tail markers laid out the
              way systems/quadruped_ragdoll.js discovers a quadruped, so the
              existing corpse solver takes the cat; a hook on the skinned
              mesh then bends the real bones onto the solved points.

   API
     CBZ.felidKit.hooks(spec) -> { build(ctx), animate(m, dt), fight(m, t, dt, opts),
                                   preview(m, move, phase) }
     CBZ.felidKit.state(m)    the animal's live state (fear, stamina, mode) for probes

   Loads in node (no THREE until build). Needs units/kit/{loft,quadrig,gait}.js.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  if (CBZ.felidKit) return;
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function bell(p, a, b) { return p <= a || p >= b ? 0 : Math.sin(PI * (p - a) / (b - a)); }
  function mkRng(seed) {
    let s = (seed | 0) ^ 0x9e3779b9;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function shade(a, k) { return mixHex(a, k < 1 ? 0 : 0xffffff, k < 1 ? 1 - k : k - 1); }

  // ==========================================================================
  //  DIMS — the species' male numbers, the female scaled; every length in m.
  // ==========================================================================
  function dims(S, sex) {
    const B = S.body, k = sex === "f" ? S.female.len : 1, g = sex === "f" ? S.female.girth : 1;
    const D = { sex: sex, k: k, g: g };
    const L = function (v) { return v * k; }, R = function (v) { return v * k * g; };
    D.shX = L(B.sh[0]); D.sh = L(B.sh[1]); D.hipX = L(B.hip[0]); D.hipH = L(B.hip[1]);
    D.FJ = { x: D.shX, y: D.sh }; D.HJ = { x: D.hipX, y: D.hipH };
    D.fa = L(B.fa); D.fb = L(B.fb); D.fc = L(B.fc); D.ha = L(B.ha); D.hb = L(B.hb); D.hc = L(B.hc);
    D.pawR = L(B.paw[1]); D.paw = [L(B.paw[0]), L(B.paw[1]), L(B.paw[2])];
    D.legZf = R(B.zf); D.legZh = R(B.zh); D.legT = B.legT * g;
    D.withers = L(B.withers);
    D.K = D.withers / 0.62;
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    D.torso = B.torso.map(function (s) { return [L(s[0]), L(s[1]), R(s[2]), R(s[3]), R(s[4]), s[5]]; });
    D.neckB = { x: L(B.neck.b[0]), y: L(B.neck.b[1]) };
    D.headP = { x: L(B.neck.h[0]), y: L(B.neck.h[1]) };
    D.neckR = B.neck.r.map(function (r) { return [R(r[0]), R(r[1]), R(r[2])]; });
    const H = B.head;
    D.headAng = H.ang; D.u = { x: Math.cos(H.ang), y: Math.sin(H.ang) };
    D.headSt = H.st.map(function (s) { return [L(s[0]), L(s[1]), L(s[2]), L(s[3]), L(s[4]), s[5] || 0]; });
    const hp = function (d, dy) { return { x: D.headP.x + D.u.x * d - D.u.y * dy, y: D.headP.y + D.u.y * d + D.u.x * dy }; };
    D.hp = hp;
    D.jaw = { d0: L(H.jaw[0]), dy0: L(H.jaw[1]), d1: L(H.jaw[2]), dy1: L(H.jaw[3]), r: L(H.jaw[4]), w: L(H.jaw[5]) };
    D.jawP = hp(D.jaw.d0, D.jaw.dy0);
    D.eye = { d: L(H.eye[0]), dy: L(H.eye[1]), z: L(H.eye[2]), r: L(H.eye[3]) };
    // seat the eye ON the skull: the head loft's half-width at that point and
    // height, minus a third of the eyeball (H.eye[2] is only a floor)
    (function () {
      const st = D.headSt, d = D.eye.d;
      let i = 0; while (i < st.length - 2 && st[i + 1][0] < d) i++;
      const f = clamp((d - st[i][0]) / Math.max(1e-4, st[i + 1][0] - st[i][0]), 0, 1);
      const cy = lerp(st[i][1], st[i + 1][1], f), rt = lerp(st[i][2], st[i + 1][2], f), w = lerp(st[i][4], st[i + 1][4], f);
      const q = clamp((D.eye.dy - cy) / rt, -0.95, 0.95);
      const zs = w * Math.sqrt(1 - q * q);
      D.eye.z = Math.max(D.eye.z * 0.6, zs - D.eye.r * 0.3);
    })();
    D.ear = { d: L(H.ear[0]), dy: L(H.ear[1]), z: L(H.ear[2]), h: L(H.ear[3]), w: L(H.ear[4]), lean: H.ear[5] };
    const ep = hp(D.ear.d, D.ear.dy);
    D.earP = { x: ep.x, y: ep.y, z: D.ear.z };
    D.canine = { d: L(H.canine[0]), dy: L(H.canine[1]), z: L(H.canine[2]), len: L(H.canine[3]) };
    // tear mark: [d, dy] of the inner eye corner, [d, dy] of the mouth corner
    // (head axis), the half-width and the |z| the cheek starts at
    if (H.tear) {
      const ta = hp(L(H.tear[0]), L(H.tear[1])), tb = hp(L(H.tear[2]), L(H.tear[3]));
      D.tear = [ta.x, ta.y, L(H.tear[5]), tb.x, tb.y, 0, L(H.tear[4])];
    } else D.tear = null;
    D.tailP = { x: L(B.tail.root[0]), y: L(B.tail.root[1]) };
    D.tailL = L(B.tail.L); D.tailProf = B.tail.prof.map(function (r) { return R(r); });
    D.tailRest = B.tail.rest;
    // neutral foot spots (FL FR HL HR), the gait's home
    D.feet = [
      { x: D.FJ.x + L(B.footOff[0]), z: -D.legZf, front: true },
      { x: D.FJ.x + L(B.footOff[0]), z: D.legZf, front: true },
      { x: D.HJ.x + L(B.footOff[1]), z: -D.legZh, front: false },
      { x: D.HJ.x + L(B.footOff[1]), z: D.legZh, front: false },
    ];
    // where the mouth is (model space), for the fight and the shot service
    const tip = D.headSt[D.headSt.length - 1];
    D.mouth = hp(tip[0] * 0.9, tip[1] - tip[3] * 0.9);
    // lying (sphinx): chest bone and pelvis bone heights when the belly is down
    const deep = D.torso.reduce(function (a, s) { return Math.abs(s[0] - D.shX) < Math.abs(a[0] - D.shX) ? s : a; });
    D.lieC = Math.max(0.1, D.sh - (deep[1] - deep[3]) + 0.01);
    const rump = D.torso.reduce(function (a, s) { return Math.abs(s[0] - D.hipX) < Math.abs(a[0] - D.hipX) ? s : a; });
    D.lieP = Math.max(0.1, D.hipH - (rump[1] - rump[3]) + 0.02);
    return D;
  }

  // ==========================================================================
  //  COAT — vertex colours + the per-vertex pattern channel (felPat):
  //    x  pattern mask 0..1       y  mode: 0 spots, 1 rosettes, 2 tail band/tip
  //    z  scale (modes 0/1), or the tail parameter t 0..1 (mode 2)
  // ==========================================================================
  const OUT = { hex: 0, a: 0, b: 0, c: 1 };
  const _n = [0, 0, 0];
  function nrm(x, y, z, R) {
    _n[0] = x - R.x; _n[1] = y - R.y; _n[2] = z - (R.z || 0);
    const l = Math.hypot(_n[0], _n[1], _n[2]) || 1;
    _n[0] /= l; _n[1] /= l; _n[2] /= l;
    return _n;
  }
  function coat(S, D, P, part, x, y, z, R, t) {
    const n = nrm(x, y, z, R), C = S.coat;
    const belly = sstep(-0.42, -0.85, n[1]);
    const back = sstep(0.35, 0.95, n[1]);
    let hex = P.base, a = 1, b = C.mode, c = 1;
    switch (part) {
      case "torso": {
        hex = mixHex(mixHex(P.base, P.back, back * 0.8), P.belly, belly);
        a = 1 - belly * (1 - C.bellySpots); c = 1;
        break;
      }
      case "neck": {
        hex = mixHex(mixHex(P.base, P.back, back * 0.6), P.belly, sstep(-0.05, -0.6, n[1]));
        a = 1 - sstep(-0.2, -0.7, n[1]) * (1 - C.bellySpots); b = C.headMode; c = 0.85;
        break;
      }
      case "leg": case "thigh": {
        const inner = sstep(0.2, 0.8, -n[2] * Math.sign(R.z || 1));
        hex = mixHex(P.base, P.belly, inner * 0.6 + (part === "leg" ? 0 : belly * 0.4));
        a = 1 - inner * 0.35; b = C.legMode; c = part === "thigh" ? 0.95 : 0.72;
        break;
      }
      case "foot": {
        hex = mixHex(P.base, P.belly, 0.25);
        a = 0.8; b = C.legMode; c = 0.5;
        break;
      }
      case "paw": {
        const pad = sstep(-0.35, -0.8, n[1]);
        hex = mixHex(mixHex(P.base, P.belly, 0.3), P.pad, pad);
        a = 0.5 * (1 - pad); b = C.legMode; c = 0.42;
        break;
      }
      case "head": {
        // R.tag: "skull" | "stop" | "muzzle" | "nose"
        const fw = t;    // 0 occiput .. 1 nose tip, along the head loft
        const under = sstep(-0.1, -0.7, n[1]);
        hex = mixHex(P.base, P.back, back * 0.4);
        if (R.tag === "muzzle" || R.tag === "nose") {
          hex = mixHex(mixHex(P.base, P.muzzle, 0.55 + 0.45 * fw), P.belly, under);
          if (under > 0.72) hex = mixHex(hex, P.lip, 0.75);              // the dark lip line
          a = 0;
        } else {
          hex = mixHex(hex, P.belly, under * 0.9);
          a = (1 - under) * (1 - sstep(0.62, 0.8, fw));
        }
        if (R.tag === "nose" && n[0] > 0.2 && n[1] > -0.45) { hex = P.nose; a = 0; }
        b = C.headMode; c = C.headScale;
        break;
      }
      case "jaw": {
        const top = sstep(0.2, 0.7, n[1]);
        hex = top > 0.5 ? P.tongue : mixHex(P.belly, P.lip, sstep(0.0, 0.2, n[1]));
        a = 0; break;
      }
      case "ear": {
        const backSide = sstep(-0.1, -0.6, n[0]);
        hex = mixHex(P.earIn, P.earBack, backSide);
        if (backSide > 0.5 && P.earSpot != null && t > 0.35 && t < 0.75 && Math.abs(n[2]) < 0.6) hex = P.earSpot;
        if (t < 0.15) hex = mixHex(hex, P.base, 0.6);
        a = 0; break;
      }
      case "eye": {
        // R.dir: the way the eye looks; the pupil is the vertices facing it
        const d = n[0] * R.dir[0] + n[1] * R.dir[1] + n[2] * R.dir[2];
        hex = d > 0.82 ? P.pupil : (d > 0.25 ? P.iris : P.lid);
        a = 0; break;
      }
      case "tail": {
        hex = mixHex(mixHex(P.base, P.back, back * 0.5), P.belly, belly * 0.85);
        a = 1 - belly * 0.3; b = C.tailMode; c = C.tailScale;
        if (t >= C.tailBand) { b = 2; c = (t - 0) ; }      // the banded / tipped end: c carries t
        if (t >= C.tipFrom) { hex = P.tip; }
        break;
      }
      case "tooth": hex = P.tooth; a = 0; break;
      case "claw": hex = P.claw; a = 0; break;
      default: break;
    }
    OUT.hex = hex; OUT.a = clamp(a, 0, 1); OUT.b = b; OUT.c = c;
    return OUT;
  }
  function palette(S, variant) {
    const C = S.coat, tint = C.tints[variant % C.tints.length];
    const P = Object.assign({}, C.pal);
    P.base = mixHex(P.base, tint, 0.55);
    P.back = mixHex(P.back, tint, 0.35);
    return P;
  }

  // ---- the pattern shader (Lambert + a bind-space pattern) -----------------
  const PAT_VERT_HEAD = "attribute vec3 felPat;\nvarying vec3 vFelBind;\nvarying vec3 vFelPat;\n";
  const PAT_FRAG_HEAD = [
    "varying vec3 vFelBind;", "varying vec3 vFelPat;",
    "uniform vec3 uInk; uniform vec3 uTearA; uniform vec3 uTearB; uniform float uTearW;",
    "uniform float uCell; uniform float uSpotR; uniform float uRosR; uniform float uBand;",
    "vec3 felH3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }",
    // a solid spot: one jittered sphere per cell, kept inside its cell (so one lookup)
    "float felSpot(vec3 p, float cell, float r){ vec3 q = p / cell; vec3 c = floor(q); vec3 h = felH3(c);",
    "  if (h.z < 0.12) return 0.0; vec3 o = 0.3 + 0.4 * h; float d = length(q - c - o) * cell;",
    "  float rr = r * (0.7 + 0.55 * fract(h.x * 7.31 + h.y * 3.17)); return 1.0 - smoothstep(rr * 0.78, rr, d); }",
    // smooth 3D value noise, for organic edges and the breaks in a rosette
    "float felN(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  float a = felH3(i).x, b = felH3(i + vec3(1,0,0)).x, c = felH3(i + vec3(0,1,0)).x, d = felH3(i + vec3(1,1,0)).x;",
    "  float e = felH3(i + vec3(0,0,1)).x, g = felH3(i + vec3(1,0,1)).x, h = felH3(i + vec3(0,1,1)).x, k = felH3(i + vec3(1,1,1)).x;",
    "  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z); }",
    // a rosette: a broken, wobbling ring of blotches round a slightly darker centre
    "vec2 felRos(vec3 p, float cell, float r){ vec3 q = p / cell; vec3 c = floor(q); vec3 h = felH3(c);",
    "  if (h.z < 0.08) return vec2(0.0); vec3 o = 0.34 + 0.32 * h; vec3 v = (q - c - o) * cell;",
    "  float rr = r * (0.75 + 0.5 * fract(h.x * 5.13 + h.z * 2.7));",
    "  float wob = felN(p / (r * 0.55) + h * 17.0);",
    "  float d = length(v) * (0.82 + 0.36 * wob);",
    "  float ring = smoothstep(rr * 0.5, rr * 0.64, d) * (1.0 - smoothstep(rr * 0.86, rr * 1.0, d));",
    "  ring *= smoothstep(0.36, 0.46, felN(p / (r * 0.42) + h * 31.0));",
    "  float mid = 1.0 - smoothstep(rr * 0.45, rr * 0.62, d); return vec2(ring, mid); }",
    "float felSeg(vec3 p, vec3 a, vec3 b){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }",
  ].join("\n");
  const PAT_FRAG_BODY = [
    "{ vec3 P = vFelBind; float m = clamp(vFelPat.x, 0.0, 1.0); float ink = 0.0; float mid = 0.0;",
    "  if (vFelPat.y < 0.5) { float s = max(vFelPat.z, 0.2);",
    "    float rr = uSpotR * s * (0.45 + 0.55 * m);",
    "    ink = max(felSpot(P, uCell * s, rr), felSpot(P + vec3(0.5, 0.31, 0.27) * uCell * s, uCell * s, rr)) * step(0.12, m); }",
    "  else if (vFelPat.y < 1.5) { float s = max(vFelPat.z, 0.2); vec2 r = max(felRos(P, uCell * 1.6 * s, uRosR * s), felRos(P + vec3(0.41, 0.17, 0.33) * uCell * 1.6 * s, uCell * 1.6 * s, uRosR * 0.85 * s));",
    "    float sp = felSpot(P + vec3(0.37, 0.21, 0.43) * uCell * s, uCell * 1.3 * s, uSpotR * 0.7 * s);",
    "    ink = max(r.x, sp * 0.9) * step(0.15, m) * (0.55 + 0.45 * m); mid = r.y * m; }",
    "  else { float t = vFelPat.z; ink = (uBand > 0.5 ? step(0.52, fract(t * uBand - 0.15)) : smoothstep(0.88, 0.93, t)) * m; }",
    "  if (uTearW > 0.0 && abs(P.z) > uTearA.z) { ink = max(ink, 1.0 - smoothstep(uTearW * 0.7, uTearW, felSeg(vec3(P.xy, 0.0), vec3(uTearA.xy, 0.0), vec3(uTearB.xy, 0.0)))); }",
    "  diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.16 * mid), uInk, ink); }",
  ].join("\n");
  const _mats = new Map();
  function felidMaterial(S, D) {
    const THREE = W.THREE;
    const key = S.id + "|" + D.sex;
    let m = _mats.get(key);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true });
    m.name = "felid-" + key; m._shared = true;
    const C = S.coat, tw = D.tear;
    const U = {
      uInk: { value: new THREE.Color(C.ink) },
      uTearA: { value: tw ? new THREE.Vector3(tw[0], tw[1], tw[2]) : new THREE.Vector3() },
      uTearB: { value: tw ? new THREE.Vector3(tw[3], tw[4], tw[5]) : new THREE.Vector3() },
      uTearW: { value: tw ? tw[6] : 0 },
      uCell: { value: C.cell * D.k }, uSpotR: { value: C.spotR * D.k }, uRosR: { value: (C.rosR || 0.03) * D.k },
      uBand: { value: C.bands || 0 },
    };
    m.userData.felU = U;
    m.onBeforeCompile = function (sh) {
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = PAT_VERT_HEAD + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n vFelBind = position; vFelPat = felPat;");
      sh.fragmentShader = PAT_FRAG_HEAD + "\n" + sh.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\n" + PAT_FRAG_BODY);
    };
    m.customProgramCacheKey = function () { return "felid-pattern-v1"; };
    _mats.set(key, m);
    return m;
  }

  // ==========================================================================
  //  THE SHELL
  // ==========================================================================
  // densify a station list: n sub-steps between neighbours, Catmull-Rom on
  // the numbers, linear on the bone weights (merged by bone id)
  const NUMS = ["x", "y", "z", "rt", "rb", "w"];
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function mixW(a, b, t) {
    const m = new Map();
    for (let i = 0; i < a.length; i += 2) m.set(a[i], (m.get(a[i]) || 0) + a[i + 1] * (1 - t));
    for (let i = 0; i < b.length; i += 2) m.set(b[i], (m.get(b[i]) || 0) + b[i + 1] * t);
    const out = [];
    m.forEach(function (w, k) { if (w > 1e-4) out.push(k, w); });
    // keep the four heaviest
    const pairs = [];
    for (let i = 0; i < out.length; i += 2) pairs.push([out[i], out[i + 1]]);
    pairs.sort(function (u, v) { return v[1] - u[1]; });
    const r = [];
    for (let i = 0; i < Math.min(4, pairs.length); i++) r.push(pairs[i][0], pairs[i][1]);
    return r;
  }
  function dens(st, n) {
    if (n <= 1 || st.length < 2) return st;
    const out = [];
    for (let i = 0; i < st.length - 1; i++) {
      const p0 = st[Math.max(0, i - 1)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(st.length - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const t = k / n;
        if (k === 0) { out.push(p1); continue; }
        const s = Object.assign({}, t < 0.5 ? p1 : p2);
        for (let j = 0; j < NUMS.length; j++) {
          const q = NUMS[j];
          s[q] = cr(p0[q] || 0, p1[q] || 0, p2[q] || 0, p3[q] || 0, t);
        }
        s.rt = Math.max(0.001, s.rt); s.rb = Math.max(0.001, s.rb); s.w = Math.max(0.001, s.w);
        s.wts = mixW(p1.wts, p2.wts, t);
        out.push(s);
      }
    }
    out.push(st[st.length - 1]);
    return out;
  }

  function buildGeometry(S, D, T, variant) {
    const LK = CBZ.loftKit, BN = T.BN, LEGB = T.LEGB;
    const G = LK.geo(), pat = [];
    const P = palette(S, variant);
    const C = function (part) {
      return function (x, y, z, ca, sa, R, t) {
        const o = coat(S, D, P, part, x, y, z, R, t);
        pat.push(o.a, o.b, o.c);
        return o.hex;
      };
    };
    const loft = function (st, segs, part, opts, n) { LK.loft(G, dens(st, n || 1), segs, C(part), opts); };
    const PV = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, HD = BN.head, JW = BN.jaw;

    // ---- TORSO: rump -> loin -> tucked waist -> deep ribs -> point of shoulder
    const torso = D.torso.map(function (s) {
      const wp = s[5];
      return { x: s[0], y: s[1], rt: s[2], rb: s[3], w: s[4], wts: wp >= 1 ? [PV, 1] : (wp <= 0 ? [CH, 1] : [PV, wp, CH, 1 - wp]) };
    });
    loft(torso, 34, "torso", { capLen: 0.9 }, 3);

    // ---- NECK: from inside the chest up to the back of the skull
    const nb = D.neckB, hp0 = D.headP, NR = D.neckR;
    const nkp = function (t) { return { x: lerp(nb.x, hp0.x, t), y: lerp(nb.y, hp0.y, t) }; };
    const nW = [[CH, 1], [CH, 0.5, N0, 0.5], [N0, 0.6, N1, 0.4], [N1, 0.7, HD, 0.3], [N1, 0.25, HD, 0.75]];
    const nT = [-0.25, 0.05, 0.45, 0.82, 1.02];
    const neck = [];
    for (let i = 0; i < 5; i++) { const q = nkp(nT[i]); neck.push({ x: q.x, y: q.y, rt: NR[i][0], rb: NR[i][1], w: NR[i][2], wts: nW[i] }); }
    loft(neck, 26, "neck", { capLen: 0.5 }, 3);

    // ---- HEAD along its own axis u; tags drive the face colours
    const hs = D.headSt, tags = ["skull", "skull", "skull", "skull", "stop", "muzzle", "muzzle", "nose"];
    const head = hs.map(function (s, i) {
      const q = D.hp(s[0], s[1]);
      return { x: q.x, y: q.y, rt: s[2], rb: s[3], w: s[4], sq: s[5] || 1, wts: [HD, 1], tag: tags[Math.min(tags.length - 1, i)] };
    });
    loft(head, 30, "head", { capLen: 0.55 }, 3);
    // lower jaw on its hinge
    const J = D.jaw, jst = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4, q = D.hp(lerp(J.d0, J.d1, t), lerp(J.dy0, J.dy1, t));
      jst.push({ x: q.x, y: q.y, rt: J.r * lerp(1, 0.75, t), rb: J.r * lerp(1.15, 0.9, t), w: J.w * lerp(1, 0.62, t), wts: [JW, 1] });
    }
    loft(jst, 16, "jaw", { capLen: 0.8 }, 2);
    // eyes: set into the skull, looking forward and a little out
    const E = D.eye, eq = D.hp(E.d, E.dy);
    // seat the eyeball on the skin the head loft actually made: the outermost
    // head vertex at the eye's height, less 45% of the eyeball
    let skinZ = 0;
    for (let i = 0; i < G.n; i++) {
      const vx = G.p[i * 3], vy = G.p[i * 3 + 1], vz = G.p[i * 3 + 2];
      if (Math.abs(vx - eq.x) < 0.008 * D.k && Math.abs(vy - eq.y) < 0.008 * D.k && vz > skinZ) skinZ = vz;
    }
    if (skinZ > 0) E.z = skinZ - E.r * 0.45;
    for (let s = -1; s <= 1; s += 2) {
      const dir = [0.78, 0.08, s * 0.62], l = Math.hypot(dir[0], dir[1], dir[2]);
      dir[0] /= l; dir[1] /= l; dir[2] /= l;
      const cx = eq.x, cy = eq.y, cz = s * E.z;
      const st = [];
      // a short loft along the eye's own axis so the pupil sits on its front
      for (let i = 0; i < 5; i++) {
        const tt = -0.86 + 1.72 * i / 4, k = Math.sqrt(1 - tt * tt);
        st.push({ x: cx + dir[0] * tt * E.r * 0.7, y: cy + dir[1] * tt * E.r * 0.7, z: cz + dir[2] * tt * E.r * 0.7,
          rt: E.r * k, rb: E.r * k, w: E.r * 0.95 * k, wts: [HD, 1], dir: dir });
      }
      LK.loft(G, st, 14, C("eye"), { capLen: 0.6, side: [0, 1, 0] });
    }
    // canines: upper on the skull, lower on the jaw
    const Cn = D.canine;
    for (let s = -1; s <= 1; s += 2) {
      const up = D.hp(Cn.d, Cn.dy), lo = D.hp(Cn.d - 0.004 * D.k, J.dy1 + J.r * 0.4);
      loft([{ x: up.x, y: up.y + Cn.len * 0.2, z: s * Cn.z, rt: 0.0045 * D.k, rb: 0.0045 * D.k, w: 0.004 * D.k, wts: [HD, 1] },
            { x: up.x + 0.002, y: up.y - Cn.len * 0.8, z: s * Cn.z, rt: 0.0012, rb: 0.0012, w: 0.0012, wts: [HD, 1] }],
        6, "tooth", { capLen: 0.5 });
      loft([{ x: lo.x, y: lo.y - Cn.len * 0.1, z: s * Cn.z * 0.9, rt: 0.0038 * D.k, rb: 0.0038 * D.k, w: 0.0034 * D.k, wts: [JW, 1] },
            { x: lo.x + 0.002, y: lo.y + Cn.len * 0.65, z: s * Cn.z * 0.9, rt: 0.001, rb: 0.001, w: 0.001, wts: [JW, 1] }],
        6, "tooth", { capLen: 0.5 });
    }
    // ears: short rounded cups facing forward, leaning out
    const Ea = D.ear;
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E0 = D.earP, st = [];
      const prof = [1.0, 1.05, 0.95, 0.72, 0.38];
      for (let i = 0; i < prof.length; i++) {
        const t = i / (prof.length - 1);
        st.push({ x: E0.x - 0.006 * t * D.k, y: E0.y + Ea.h * t, z: s * (E0.z + Ea.h * Ea.lean * t),
          rt: 0.008 * D.k * (1 - 0.5 * t), rb: 0.006 * D.k * (1 - 0.4 * t), w: Ea.w * 0.5 * prof[i], wts: [eb, 1] });
      }
      LK.loft(G, dens(st, 2), 14, C("ear"), { capLen: 0.9 });
    }

    // ---- TAIL: six bones, the profile from the species
    const TP = D.tailP, tl = D.tailL, prof = D.tailProf, tst = [];
    const stops = T.spec.tailStops, nTb = T.spec.tail;
    for (let i = 0; i < prof.length; i++) {
      const t = i / (prof.length - 1), x = TP.x - tl * t;
      // weight between the two tail bones that bracket t
      let k = 0; while (k < nTb - 1 && stops[k + 1] <= t) k++;
      const a = stops[k], b = k < nTb - 1 ? stops[k + 1] : 1, f = clamp((t - a) / Math.max(1e-3, b - a), 0, 1);
      const wts = k < nTb - 1 ? [BN["tail" + k], 1 - f * 0.5, BN["tail" + (k + 1)], f * 0.5] : [BN["tail" + k], 1];
      if (i === 0) wts.push(PV, 0.6);
      tst.push({ x: x, y: TP.y, rt: prof[i], rb: prof[i], w: prof[i] * 0.94, wts: wts });
    }
    loft(tst, 18, "tail", { capLen: 1.0 }, 2);

    // ---- LEGS: straight down in bind; the IK bends them every frame
    const pts = T.bindPoints(D), lt = D.legT, k = D.k;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], sz = Math.sign(z);
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const x = P0[0], y0 = P0[1], body = front ? CH : PV;
      const r = function (v) { return v * k * lt; };
      const fy = y0 - a - b;
      // ONE loft per leg, shoulder/hip to the paw, weights blended across the
      // joints so the skin bends there instead of showing stacked tubes
      const u0 = ids[0], u1 = ids[1], u2 = ids[2];
      const st = front ? [
        { x: x, y: y0 + 0.11 * k, z: z * 0.55, rt: r(0.05), rb: r(0.06), w: r(0.034), wts: [body, 0.85, u0, 0.15] },
        { x: x, y: y0 + 0.02 * k, z: z * 0.85, rt: r(0.052), rb: r(0.064), w: r(0.038), wts: [body, 0.45, u0, 0.55] },
        { x: x, y: y0 - a * 0.45, z: z, rt: r(0.042), rb: r(0.056), w: r(0.036), wts: [u0, 1] },
        { x: x, y: y0 - a * 0.88, z: z, rt: r(0.03), rb: r(0.042), w: r(0.03), wts: [u0, 0.75, u1, 0.25] },
        { x: x, y: y0 - a - b * 0.12, z: z, rt: r(0.029), rb: r(0.032), w: r(0.028), wts: [u0, 0.2, u1, 0.8] },
        { x: x, y: y0 - a - b * 0.4, z: z, rt: r(0.026), rb: r(0.025), w: r(0.024), wts: [u1, 1] },
        { x: x, y: y0 - a - b * 0.85, z: z, rt: r(0.018), rb: r(0.019), w: r(0.018), wts: [u1, 0.85, u2, 0.15] },
        { x: x, y: fy - c * 0.15, z: z, rt: r(0.018), rb: r(0.02), w: r(0.019), wts: [u1, 0.2, u2, 0.8] },
        { x: x, y: fy - c * 0.6, z: z, rt: r(0.016), rb: r(0.016), w: r(0.017), wts: [u2, 1] },
        { x: x, y: fy - c, z: z, rt: r(0.018), rb: r(0.017), w: r(0.019), wts: [u2, 1] },
      ] : [
        { x: x + 0.02 * k, y: y0 + 0.13 * k, z: z * 0.55, rt: r(0.07), rb: r(0.08), w: r(0.044), wts: [body, 0.85, u0, 0.15] },
        { x: x, y: y0 + 0.02 * k, z: z * 0.85, rt: r(0.075), rb: r(0.085), w: r(0.05), wts: [body, 0.45, u0, 0.55] },
        { x: x, y: y0 - a * 0.45, z: z, rt: r(0.058), rb: r(0.068), w: r(0.045), wts: [u0, 1] },
        { x: x, y: y0 - a * 0.88, z: z, rt: r(0.034), rb: r(0.04), w: r(0.031), wts: [u0, 0.75, u1, 0.25] },
        { x: x, y: y0 - a - b * 0.12, z: z, rt: r(0.028), rb: r(0.04), w: r(0.029), wts: [u0, 0.2, u1, 0.8] },
        { x: x, y: y0 - a - b * 0.35, z: z, rt: r(0.025), rb: r(0.04), w: r(0.026), wts: [u1, 1] },
        { x: x, y: y0 - a - b * 0.85, z: z, rt: r(0.016), rb: r(0.022), w: r(0.017), wts: [u1, 0.85, u2, 0.15] },
        { x: x, y: fy - c * 0.1, z: z, rt: r(0.017), rb: r(0.026), w: r(0.018), wts: [u1, 0.2, u2, 0.8] },
        { x: x, y: fy - c * 0.6, z: z, rt: r(0.015), rb: r(0.016), w: r(0.016), wts: [u2, 1] },
        { x: x, y: fy - c, z: z, rt: r(0.018), rb: r(0.017), w: r(0.019), wts: [u2, 1] },
      ];
      LK.loft(G, dens(st, 2), 16, function (px, py, pz, ca, sa, R, t) {
        const o = coat(S, D, P, t < 0.42 ? "thigh" : (t < 0.8 ? "leg" : "foot"), px, py, pz, R, t);
        pat.push(o.a, o.b, o.c); return o.hex;
      }, { capLen: 0.6 });
      // the paw: an ellipsoid forward of the pastern's end, toes rounded
      const pw = D.paw, py = fy - c;
      LK.ellipsoid(G, x + pw[0] * 0.45, py, z, pw[0], pw[1], pw[2], 14, C("paw"), [ids[2], 1]);
      // four toes' claws (a cheetah's never fully sheathe; a leopard's barely show)
      const cl = S.coat.claw;
      for (let i = 0; i < 4; i++) {
        const zz = z + sz * (i - 1.5) * pw[2] * 0.48, cx0 = x + pw[0] * 1.32;
        loft([{ x: cx0, y: py - pw[1] * 0.35, z: zz, rt: cl, rb: cl, w: cl * 0.8, wts: [ids[2], 1] },
              { x: cx0 + cl * 2.4, y: py - pw[1] * 0.75, z: zz, rt: cl * 0.2, rb: cl * 0.2, w: cl * 0.2, wts: [ids[2], 1] }],
          5, "claw", { capLen: 0.5 });
      }
    }
    const geo = LK.toGeometry(G, { boundingSphere: [0, D.withers * 0.6, 0, D.withers * 2.6] });
    geo.setAttribute("felPat", new W.THREE.Float32BufferAttribute(pat, 3));
    geo._felVerts = G.n;
    return geo;
  }

  // ==========================================================================
  //  BUILD — shared shells, a skeleton per animal, ragdoll markers
  // ==========================================================================
  const _tables = new Map(), _geos = new Map(), _proxyGeo = new Map();
  function table(S) {
    let T = _tables.get(S.id);
    if (!T) {
      T = CBZ.quadRig.bones({ neck: 2, tail: 6, tailStops: [0, 0.14, 0.3, 0.47, 0.64, 0.82], ears: true, hackle: false, hump: false });
      _tables.set(S.id, T);
    }
    return T;
  }
  const _dims = new Map();
  function dimsOf(S, sex) { const k = S.id + sex; let D = _dims.get(k); if (!D) { D = dims(S, sex); _dims.set(k, D); } return D; }
  function boxGeo(w, h, d) {
    const k = w.toFixed(3) + "|" + h.toFixed(3) + "|" + d.toFixed(3);
    let g = _proxyGeo.get(k);
    if (!g) { g = new W.THREE.BoxGeometry(w, h, d); g._shared = true; _proxyGeo.set(k, g); }
    return g;
  }
  let _proxyMat = null;
  function proxy(group, w, h, d, x, y, z, tag) {
    const THREE = W.THREE;
    if (!_proxyMat) { _proxyMat = new THREE.MeshBasicMaterial({ color: 0xff00ff }); _proxyMat._shared = true; }
    const m = new THREE.Mesh(boxGeo(w, h, d), _proxyMat);
    m.position.set(x, y, z); m.visible = false; m.castShadow = false;
    m.userData.felProxy = tag; m.userData.dynamic = true;
    group.add(m);
    return m;
  }
  function build(S, ctx) {
    const THREE = W.THREE || (ctx && ctx.THREE);
    if (!THREE || !CBZ.loftKit || !CBZ.quadRig || !CBZ.quadGait) return null;
    const seed = Math.abs(((ctx && ctx.seed) | 0) || Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6));
    const rng = mkRng(seed * 7919 + 17);
    const sex = rng() < S.maleShare ? "m" : "f";
    const variant = Math.floor(rng() * S.coat.tints.length);
    const D = dimsOf(S, sex), T = table(S);
    const gk = S.id + "|" + sex + "|" + variant;
    let geo = _geos.get(gk);
    if (!geo) { geo = buildGeometry(S, D, T, variant); _geos.set(gk, geo); }
    const rig = CBZ.quadRig.makeSkeleton(T, D, S.id);
    const mesh = CBZ.quadRig.skinnedMesh(geo, felidMaterial(S, D), rig);
    mesh.name = S.id + "-body";
    mesh.userData.dynamic = true;
    mesh.onBeforeRender = deathPose;
    // the body sits in its own holder so the corpse solver's sweep (direct
    // children only) sees the markers, never the shell
    const holder = new THREE.Group();
    const ind = 1 + (rng() - 0.5) * 2 * S.indVar;          // the individual: +-indVar on every length
    holder.scale.setScalar(ind);
    holder.add(mesh);
    const group = new THREE.Group();
    group.add(holder);
    group.userData.dynamic = true;
    // ---- RAGDOLL MARKERS (invisible). quadruped_ragdoll.js finds a leg as a
    // mesh taller than wide standing on the ground, parts stacked on it as
    // that leg, the head far forward and up, the tail far back; we hand it
    // exactly that, and read the solved points back off the same markers.
    const H = Math.max(D.FJ.y, D.HJ.y) * ind, fr = 0.03 * ind;
    const legs = [];
    for (let Lg = 0; Lg < 4; Lg++) {
      // the solver merges columns closer than 0.14 m: a narrow-tracked cat's
      // hind feet would read as one leg, so the markers stand at least 0.16 apart
      const f = D.feet[Lg], x = f.x * ind, z = Math.sign(f.z) * Math.max(0.08, Math.abs(f.z) * ind);
      proxy(group, 0.05, H, 0.05, x, H / 2, z, "col" + Lg);
      const A = proxy(group, 0.02, 0.02, 0.02, x, H, z, "A" + Lg);
      const Kk = proxy(group, 0.02, 0.02, 0.02, x, (fr + H) / 2, z, "K" + Lg);
      const F = proxy(group, 0.02, 0.02, 0.02, x, fr, z, "F" + Lg);
      legs.push({ A: A, K: Kk, F: F });
    }
    const hm = proxy(group, 0.03, 0.03, 0.03, D.headP.x * ind, D.headP.y * ind, 0, "head");
    const tm = proxy(group, 0.03, 0.03, 0.03, (D.tailP.x - D.tailL * 0.45) * ind, Math.max(0.2, D.tailP.y * 0.8) * ind, 0, "tail");
    const backTop = Math.max.apply(null, D.torso.map(function (s) { return s[1] + s[2]; })) * ind;
    proxy(group, 0.3, 0.04, 0.12, 0, backTop - 0.02, 0, "torso");
    const R = {
      S: S, D: D, T: T, sex: sex, variant: variant, ind: ind, seed: seed, rng: rng,
      group: group, holder: holder, mesh: mesh, bones: rig.bones, bindPos: rig.bindPos, rig: rig,
      G: CBZ.quadGait.create(D, S.gaitTable), st: null, markers: { legs: legs, head: hm, tail: tm },
      bindHead: { x: D.headP.x * ind, y: D.headP.y * ind }, bindTail: { x: (D.tailP.x - D.tailL * 0.45) * ind, y: Math.max(0.2, D.tailP.y * 0.8) * ind },
    };
    group.userData.felid = R;
    mesh.userData.felRig = R;
    standPose(R);
    // the battle hangs its team collar on the group right after build: seat
    // it on the neck the moment it arrives, not a frame later
    group.add = function () {
      const r = THREE.Group.prototype.add.apply(this, arguments);
      for (let i = 0; i < arguments.length; i++) {
        const o = arguments[i];
        if (o && o.isMesh && o.userData.teamCollar && !R.collar) { seatCollar(R); break; }
      }
      return r;
    };
    return group;
  }

  // ==========================================================================
  //  STATE + BRAIN
  // ==========================================================================
  function rigOf(m) { return m && m.group && m.group.userData && m.group.userData.felid; }
  function newState() {
    return {
      init: false, t: 0, px: null, pz: null, ph: 0, v: 0, vRaw: 0, acc: 0, turn: 0,
      vCmd: 0, stam: 1, heat: 0, fear: 0, flee: false, cornered: false, rest: false,
      mode: "roam", threat: null, tdPrev: 0, hp0: null, hurtT: 0, injury: 0,
      limp: [0, 0, 0, 0], hit: { t: 0, dur: 0.45, k: 0, region: 0, side: 1 },
      idleT: 0, lie: 0, crouch: 0, alert: 0, aggr: 0, pant: 0, breathPh: 0,
      lookY: 0, lookP: 0, earTw: [0, 0], earTwT: 1, tailY: 0, tailYv: 0, tailFl: 0, tailFlT: 2,
      leap: null, leapCool: 0, land: 0,
      f: { move: null, t: 0, dur: 1, at: 0.5, hit: false, hold: false, cool: 0, acc: 0, accT: 0, downT: 0, fails: 0, vAtk: 0, kd: false, side: 1 },
      wasPost: false, lastFrame: -1, deadK: 0,
    };
  }
  function initUnit(S, m, R) {
    const st = R.st = newState();
    st.init = true;
    m._fel = st;
    R.unit = m;
    // the per-animal tuning: the battle reads m.tn for speed and nerve, and
    // this animal's speed is ITS OWN (accelerating, tiring, limping)
    m.tn = Object.assign({}, m.tn || {}, { brave: false, prey: false });
    // mass: the sex's mean x this individual's size, cubed (bodymass.js reads a._mass)
    const sz = R.ind * (m._sizeMul || 1);
    m._mass = (R.sex === "m" ? S.mass.m : S.mass.f) * sz * sz * sz;
    if (m.maxHp > 0 && m.maxHp < 1e8) {
      const f = R.sex === "m" ? 1 : S.female.hp;
      m.maxHp = Math.round(m.maxHp * f); m.hp = Math.min(m.hp * f, m.maxHp);
    }
    st.hp0 = m.hp;
    st.fit = (R.sex === "m" ? 1 : S.female.speed) * (0.96 + R.rng() * 0.08);
    st.vCmd = 0;
    seatCollar(R);
  }
  // the battle's team collar is a rigid box set on the bounding box; give it
  // a real collar's shape and hang it on the neck so it moves with the neck
  const _collarGeo = new Map();
  function seatCollar(R) {
    const THREE = W.THREE, g = R.group, D = R.D;
    if (R.collar) return;
    let col = null;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      if (c.isMesh && c.userData.teamCollar && c !== R.holder) { col = c; break; }
    }
    if (!col) return;
    const r = (D.neckR[2][1] + D.neckR[2][2]) * 0.5 * 1.08;
    let tg = _collarGeo.get(R.S.id + D.sex);
    if (!tg) { tg = new THREE.TorusGeometry(r, 0.012 * D.k, 6, 20); tg._shared = true; _collarGeo.set(R.S.id + D.sex, tg); }
    col.geometry = tg;
    col.scale.set(1, 1, 1);
    const dir = new THREE.Vector3(D.headP.x - D.neckB.x, D.headP.y - D.neckB.y, 0).normalize();
    col.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // into the first neck bone's frame (bind: bone at neckB, unrotated)
    col.position.set((D.headP.x - D.neckB.x) * 0.38, (D.headP.y - D.neckB.y) * 0.38, 0);
    col.castShadow = false;
    R.bones[R.T.BN.neck].add(col);
    R.collar = col;
  }

  function massOf(u) {
    if (!u) return 78;
    if (u.vehicle) return 1e4;
    if (u._mass > 0) return u._mass;
    if (CBZ.bodyMass) { try { return CBZ.bodyMass(u); } catch (e) {} }
    return u.beast ? 100 : 78;
  }
  function downed(u) {
    if (!u) return false;
    if (u.ko > 0) return true;
    const ch = u.char;
    return !!(ch && (ch.koPose || (ch.fall && ch.fall.on)));
  }
  // what this animal makes of another body
  const CLS = { veh: false, man: false, armed: false, pred: false, ratio: 1, bigger: false };
  function classify(S, m, t) {
    CLS.veh = !!t.vehicle; CLS.man = !t.beast && !t.vehicle; CLS.armed = CLS.man && !!t.armed && !t.fists;
    CLS.ratio = massOf(t) / Math.max(5, massOf(m));
    const sp = t.species;
    CLS.pred = !!(t.beast && sp && (sp.danger || 0) >= 0.45 && !(t.tn && t.tn.prey));
    CLS.bigger = CLS.veh || (CLS.pred && CLS.ratio > S.mind.bigRatio) || (!!t.beast && CLS.ratio > S.mind.hugeRatio);
    return CLS;
  }

  function hitReact(S, m, st, lost, bitten, R) {
    const H = st.hit, frac = lost / Math.max(1, m.maxHp || 100);
    // where it came from: the body that is biting or that it is fighting
    const src = st.threat || m.tgt;
    let rel = 0;
    if (src && src.pos) rel = wrapPi(Math.atan2(src.pos.z - m.pos.z, src.pos.x - m.pos.x) - (m.heading || 0));
    else rel = (R.rng() - 0.5) * TAU;
    const ar = Math.abs(rel), side = rel >= 0 ? 1 : -1;     // +1: from the right (+z)
    // a shot or a bite from the front takes the head or the forequarters, from
    // abeam the flank, from behind the hindquarters; a little scatter on top
    const u = R.rng();
    let region;
    if (ar < 0.6) region = u < 0.3 ? 0 : 1;                  // 0 head, 1 fore, 2 flank, 3 hind
    else if (ar < 2.0) region = u < 0.3 ? 1 : (u < 0.75 ? 2 : 3);
    else region = u < 0.75 ? 3 : 2;
    H.region = region; H.side = side;
    H.k = clamp(0.35 + frac * 4, 0.35, 1.4);
    H.dur = frac > 0.18 ? 0.85 : 0.45;
    H.t = H.dur;
    // a leg takes the wound often enough to matter: limps are remembered
    if ((region === 1 || region === 3) && R.rng() < 0.55 + frac) {
      const leg = (region === 1 ? 0 : 2) + (side > 0 ? 1 : 0);
      st.limp[leg] = Math.min(1, st.limp[leg] + frac * 3.2 + 0.1);
    }
    st.injury = clamp(1 - m.hp / Math.max(1, m.maxHp), 0, 1);
    st.fear += S.mind.hurtFear * frac * (bitten ? 1.2 : 1);
    st.hurtT = 3;
    // a held victim is let go when the holder is hurt enough (the brain decides)
    if (st.f.hold && frac > S.mind.holdBreak) endMove(st);
  }

  function brain(S, m, st, dt, R) {
    const L = S.loco, B = S.mind, tn = m.tn;
    if (m.you) { brainYou(S, m, st, dt, R); return; }
    // ---- what happened to me
    const lost = st.hp0 - m.hp;
    st.hp0 = m.hp;
    const bitten = m._flinchT > 0;
    if (bitten) m._flinchT = 0;
    if (lost > 0.01) hitReact(S, m, st, lost, bitten, R);
    if (st.hurtT > 0) st.hurtT -= dt;
    // ---- what I am looking at
    const tg = m.tgt && !m.tgt.dead && !m.tgt.fled ? m.tgt : null;
    if (tg) st.threat = tg;
    if (st.threat && (st.threat.dead || st.threat.fled)) st.threat = null;
    const th = st.threat;
    const td = th ? Math.hypot(th.pos.x - m.pos.x, th.pos.z - m.pos.z) : 1e9;
    const closing = th && st.tdPrev > 0 ? (st.tdPrev - td) / Math.max(dt, 1e-3) : 0;
    st.tdPrev = th ? td : 0;
    const cls = th ? classify(S, m, th) : null;
    // ---- nerve
    if (cls && td < B.fearRange) {
      const near = 1 - td / B.fearRange;
      if (cls.veh) st.fear += B.vehFear * near * dt;
      else if (cls.bigger) st.fear += B.bigFear * near * dt * (closing > 2 ? 1.6 : 1);
      else if (cls.armed && st.hurtT > 0) st.fear += B.gunFear * near * dt;
    }
    if (m.hp < m.maxHp * B.lowHp) st.fear += B.lowHpFear * dt;
    st.fear = Math.max(0, st.fear - B.fearDecay * dt * (st.flee && td > 30 ? 2 : 1));
    if (!st.flee && st.fear > B.fleeAt) { st.flee = true; endMove(st); }
    if (st.flee && st.fear < B.rallyAt && td > B.fearRange * 0.8) st.flee = false;
    // cornered: spent, and the thing it ran from is on top of it
    st.cornered = st.flee && st.stam < 0.15 && td < 4.5;
    tn.prey = st.flee && !st.cornered;
    // ---- rest after a spent sprint (a cheetah that missed stands and pants)
    if (!st.rest && st.stam < L.restBelow && !st.flee && td > 6) st.rest = true;
    if (st.rest && (st.stam > L.restUntil || td < 5 || st.flee)) st.rest = false;
    // ---- the hunt plan
    st.leapCool = Math.max(0, st.leapCool - dt);
    const vTop = L.vmax * st.fit * (1 - 0.5 * Math.max(st.injury * 0.6, Math.max(st.limp[0], st.limp[1], st.limp[2], st.limp[3]) * 0.7))
      * (st.stam < 0.08 ? 0.18 : (st.stam < 0.2 ? 0.45 : 1));
    let vDes;
    if (st.leap) vDes = L.leapV;
    else if (st.flee) vDes = td < 45 ? Math.max(vTop, L.trot) : L.trot;
    else if (st.rest) vDes = 0;
    else if (tg && !(cls && (cls.veh || cls.bigger))) {
      // stalk while unseen and far; a body charging at it, a wound, or the
      // range ends the stalk
      // far off it walks in (head up, trotting), inside stalk range it creeps
      if (st.mode !== "charge") {
        st.mode = td > L.stalkFrom ? "approach" : "stalk";
        if (td < L.burst || st.hurtT > 0 || closing > 4) st.mode = "charge";
      }
      vDes = st.mode === "stalk" ? L.stalk : (st.mode === "approach" ? L.trot : vTop);
      // the pounce from cover (snow leopard): a short explosive leap
      if (S.leap && !st.leap && st.leapCool <= 0 && td < S.leap.range + heightEdge(m, tg) * 1.5 && td > 3 && st.stam > 0.15) {
        startLeap(S, m, st, td);
        vDes = L.leapV;
      }
    } else if (tg) {
      // a machine or a bigger predator in front of it: hold off, watch
      st.mode = "wary";
      vDes = td < 20 ? L.trot : L.stalk;
    } else { st.mode = "roam"; vDes = L.march; }
    if (!st.leap) vDes = Math.min(vDes, Math.max(vTop, st.flee ? L.trot * 0.6 : 0));
    // ---- legs: acceleration is real (a cheetah's ~10 m/s^2), braking too
    if (st.leap) st.vCmd = L.leapV;
    else if (vDes > st.vCmd) st.vCmd = Math.min(vDes, st.vCmd + L.accel * (1 - 0.55 * st.vCmd / (L.vmax * 1.05)) * dt);
    else st.vCmd = Math.max(vDes, st.vCmd - L.decel * dt);
    const v = Math.max(0.04, st.vCmd);
    tn.chase = v / (st.flee ? 0.92 : (m.hunt ? 1.08 : 1));
    tn.march = v;
    // ---- stamina: a sprint is paid for (heat), rest pays it back
    const va = Math.abs(st.v);
    if (va > L.trot * 1.25) st.stam -= Math.pow(va / L.vmax, 2.4) / L.sprintSecs * dt;
    else st.stam += L.recover * (1 - va / (L.trot * 1.25)) * dt;
    st.stam = clamp(st.stam, 0, 1);
    st.pant = approach(st.pant, clamp((1 - st.stam) * 1.5 + (va > 8 ? 0.3 : 0), 0, 1), 1.5, dt);
    // ---- the leap's own clock
    if (st.leap) {
      st.leap.t += dt;
      if (!tg || st.leap.t > st.leap.max) endLeap(st, false);
    }
    if (st.land > 0) st.land -= dt;
    // ---- body language
    st.alert = approach(st.alert, tg || th ? 1 : 0.3, 3, dt);
    st.aggr = approach(st.aggr, (st.f.move || (tg && td < 6 && !st.flee)) ? 1 : 0, 5, dt);
    st.crouch = approach(st.crouch, (st.mode === "stalk" && tg) ? 1 : (st.mode === "wary" ? 0.5 : 0), 2.5, dt);
    // idle: a cat that has nothing to do lies down
    if (!tg && va < 0.2 && !st.flee) st.idleT += dt; else st.idleT = 0;
    st.lie = approach(st.lie, st.idleT > S.mind.lieAfter ? 1 : 0, st.idleT > S.mind.lieAfter ? 0.9 : 3, dt);
    for (let i = 0; i < 4; i++) st.limp[i] = Math.max(0, st.limp[i] - dt * 0.004);
  }
  // POSSESSED: the player has the legs. Nerve, stalking and flight stand down;
  // what stays real is the body: the top speed it can reach is built up at
  // its own acceleration, paid for in stamina, cut by wounds and limps
  function brainYou(S, m, st, dt, R) {
    const L = S.loco, tn = m.tn;
    const lost = st.hp0 - m.hp;
    st.hp0 = m.hp;
    const bitten = m._flinchT > 0;
    if (bitten) m._flinchT = 0;
    if (lost > 0.01) hitReact(S, m, st, lost, bitten, R);
    if (st.hurtT > 0) st.hurtT -= dt;
    st.flee = false; st.cornered = false; st.rest = false; st.leap = null; tn.prey = false;
    st.fear = Math.max(0, st.fear - S.mind.fearDecay * dt);
    const vTop = L.vmax * st.fit * (1 - 0.5 * Math.max(st.injury * 0.6, Math.max(st.limp[0], st.limp[1], st.limp[2], st.limp[3]) * 0.7))
      * (st.stam < 0.08 ? 0.18 : (st.stam < 0.2 ? 0.45 : 1));
    const va = Math.abs(st.v);
    st.vCap = st.vCap || L.trot * 1.5;
    if (va > st.vCap - 1.5) st.vCap = Math.min(vTop, st.vCap + L.accel * (1 - 0.55 * st.vCap / (L.vmax * 1.05)) * dt);
    else st.vCap = Math.max(L.trot * 1.5, Math.min(st.vCap, va + 3));
    tn.chase = Math.max(L.trot, Math.min(vTop, st.vCap));
    tn.march = Math.min(L.trot, tn.chase);
    if (va > L.trot * 1.25) st.stam -= Math.pow(va / L.vmax, 2.4) / L.sprintSecs * dt;
    else st.stam += L.recover * (1 - va / (L.trot * 1.25)) * dt;
    st.stam = clamp(st.stam, 0, 1);
    st.pant = approach(st.pant, clamp((1 - st.stam) * 1.5 + (va > 8 ? 0.3 : 0), 0, 1), 1.5, dt);
    st.alert = approach(st.alert, 1, 3, dt);
    st.aggr = approach(st.aggr, st.f.move ? 1 : 0.3, 5, dt);
    st.crouch = approach(st.crouch, 0, 3, dt);
    st.lie = approach(st.lie, 0, 3, dt);
    st.idleT = 0;
    if (st.land > 0) st.land -= dt;
  }
  function heightEdge(m, t) {
    // ambush from rocks: higher ground lengthens the pounce
    const dy = (m.pos.y || 0) - (t.pos.y || 0);
    return clamp(dy, 0, 4);
  }
  function startLeap(S, m, st, td) {
    st.leap = { d0: td, t: 0, max: 0.35 + td / S.loco.leapV * 1.4, u: 0, hit: false };
    st.vCmd = S.loco.leapV;
    st.stam = Math.max(0, st.stam - 0.06);
    st.leapCool = S.leap.cool;
  }
  function endLeap(st, contact) {
    if (!st.leap) return;
    st.leap = null;
    st.land = contact ? 0.6 : 0.35;
    st.landHit = !!contact;
    st.reset = true;
  }

  // ==========================================================================
  //  ANIMATE
  // ==========================================================================
  const _ik = [0, 0];
  const FOOT = { x: 0, y: 0, a: 0, abd: 0 };
  function animate(S, m, dt, preview) {
    const R = rigOf(m);
    if (!R) return;
    if (!R.st) initUnit(S, m, R);
    const st = R.st, D = R.D, b = R.bones, bp = R.bindPos, BN = R.T.BN, LEGB = R.T.LEGB, K = D.K, k = D.k;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    if (m.dead) return;
    st.t += dt;
    const ind = R.ind * (m.group.scale.x || 1);
    const gx = m.pos.x, gz = m.pos.z, h = typeof m.heading === "number" ? m.heading : 0;
    // ---- MEASURED motion: whatever moved the body, the legs answer to it
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - st.ph) / dt;
    // the gait works in the body's own model units (the battle scales the
    // group by its size draw, the holder by the individual): positions, the
    // ground and the speed all go in divided by that scale, so a planted paw
    // holds its world spot exactly
    R.sc = ind;
    const ground = R.groundFn || (R.groundFn = function (x, z) { const f = CBZ.floorAt; if (!f) return null; const y = f(x * R.sc, z * R.sc); return y == null ? null : y / R.sc; });
    const lx = gx / ind, lz = gz / ind, ly = m.pos.y / ind;
    if (mdx * mdx + mdz * mdz > 64 * dt * 60) { v = 0; turn = 0; CBZ.quadGait.reset(R.G, lx, lz, h, ground, ly); }
    st.px = gx; st.pz = gz; st.ph = h;
    const v0 = st.v;
    st.v = approach(st.v, clamp(v, -4, 32), 12, dt);
    st.acc = approach(st.acc, clamp((st.v - v0) / dt, -25, 25), 6, dt);
    st.turn = approach(st.turn, clamp(turn, -9, 9), 8, dt);
    if (!preview) brain(S, m, st, dt, R);
    else st.v = 0;
    const F = st.f, mv = F.move, p = mv ? clamp(F.t / F.dur, 0, 1) : 0;
    const holding = !!(mv && F.hold);
    // ---- posture weights
    const lieK = st.lie * (1 - (mv ? 1 : 0));
    const leapU = st.leap ? clamp(st.leap.u, 0, 1) : -1;
    const posing = lieK > 0.05 || leapU >= 0 || holding || mv === "grapple";
    // ---- GAIT (standing / moving)
    const G = R.G;
    const gv = st.v / ind;
    if (!posing) {
      if (st.wasPost || st.reset) { CBZ.quadGait.reset(G, lx, lz, h, ground, ly); st.wasPost = false; st.reset = false; }
      CBZ.quadGait.step(G, dt, preview ? 0 : gv, preview ? 0 : st.turn, lx, lz, h, ground, ly);
    } else st.wasPost = true;
    const M = G.mix, ph = G.phase;
    const moveK = clamp(Math.abs(gv) / 0.6, 0, 1);
    const wG = (M.wG || 0) + (M.wS || 0), wS = M.wS || 0, wW = M.wW || 0, wT = M.wT || 0;
    const gal = wG * moveK;

    // ---- BODY: pelvis + chest (position in the root frame, pitch, roll, yaw)
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0, roll = 0, pYaw = 0, cYaw = 0, rootY = 0;
    // walk: a soft bob and the shoulders rolling; trot: a firmer bob
    const bob2 = 0.5 - 0.5 * Math.cos(4 * PI * ph);
    pY -= (0.008 * wW + 0.014 * wT) * K * bob2 * moveK; cY -= (0.01 * wW + 0.014 * wT) * K * bob2 * moveK;
    cYaw += 0.05 * wW * moveK * Math.sin(TAU * ph); pYaw -= 0.05 * wW * moveK * Math.sin(TAU * ph);
    // THE GALLOP SPINE: flexed (arched, hips under) in the gathered flight,
    // extended (hollow, legs stretched) in the extended flight
    const flex = Math.cos(TAU * (ph - S.gait.flexAt));
    const sp = S.gait.spine * gal * (0.6 + 0.4 * wS);
    pR += 0.34 * sp * flex; cR -= 0.22 * sp * flex;
    pX += 0.11 * k * sp * flex; cX -= 0.07 * k * sp * flex;
    const gbob = Math.cos(4 * PI * (ph - S.gait.flexAt + 0.5));
    pY += 0.03 * k * gal * gbob - 0.05 * k * wS * moveK; cY += 0.03 * k * gal * gbob - 0.06 * k * wS * moveK;
    // acceleration and braking lean, turns lean in
    const acc = clamp(st.acc / 12, -1, 1);
    cY -= 0.04 * k * Math.max(0, acc) * moveK; cR -= 0.08 * acc * moveK; pY += 0.03 * k * Math.min(0, acc);
    roll = clamp(-st.turn * Math.abs(st.v) * 0.012, -0.32, 0.32);
    // stalking: low, shoulders up, belly near the ground
    const cro = st.crouch * (1 - lieK);
    pY -= 0.15 * k * cro * S.gait.crouchK; cY -= 0.2 * k * cro * S.gait.crouchK; cR -= 0.04 * cro;
    // fear / aggression: a cornered cat drops its rear and fronts up
    const def = (st.cornered ? 1 : 0) + (mv === "swat" ? 0.6 : 0);
    pY -= 0.08 * k * clamp(def, 0, 1);
    // breathing / panting: the flank heaves (the chest bone rides it)
    const brF = 0.4 + st.pant * 2.6;
    st.breathPh += dt * TAU * brF;
    cY += (0.003 + 0.006 * st.pant) * k * Math.sin(st.breathPh);
    // injured: the body sags, a lame leg is unloaded when it plants
    const inj = st.injury;
    pY -= 0.03 * k * inj; cY -= 0.02 * k * inj;
    for (let Lg = 0; Lg < 4; Lg++) {
      const lm = st.limp[Lg];
      if (lm > 0.05 && moveK > 0.1 && !G.feet[Lg].sw) {
        if (Lg < 2) { cY += 0.045 * k * lm; cR += 0.06 * lm; } else { pY += 0.04 * k * lm; roll += (Lg === 2 ? -1 : 1) * 0.06 * lm; }
      }
    }
    // ---- HIT REACTION by location
    const H = st.hit;
    let hk = 0;
    if (H.t > 0) { H.t = Math.max(0, H.t - dt); const q = 1 - H.t / H.dur; hk = H.k * Math.sin(PI * Math.min(1, q * 1.6)) * (1 - q * 0.4); }
    if (hk > 0) {
      if (H.region === 0) { cR += 0.12 * hk; }
      else if (H.region === 1) { cY -= 0.07 * k * hk; cR -= 0.1 * hk; }
      else if (H.region === 2) { roll -= H.side * 0.28 * hk; pYaw += H.side * 0.18 * hk; cYaw -= H.side * 0.22 * hk; }
      else { pY -= 0.09 * k * hk; pR -= 0.12 * hk; }
    }

    // ---- FIGHT POSES (the move's own shape)
    let lunge = 0, jawFight = 0, headDown = 0, earPin = 0, rear = 0;
    const ov = [null, null, null, null];
    if (mv) {
      const side = F.side;
      if (mv === "trip") {
        // the hook: the forepaw on the prey's side swings out and forward and
        // rakes back across the prey's legs
        const L = side > 0 ? 1 : 0, out = bell(p, 0.15, 0.9);
        const sweep = p < 0.5 ? sstep(0.15, 0.5, p) : 1 - sstep(0.5, 0.85, p) * 0.8;
        ov[L] = { x: D.shX + (0.12 + 0.38 * sweep) * k, y: D.pawR + 0.22 * k * out, abd: side * 0.55 * out, a: -HALF + 0.9 * out };
        cY -= 0.05 * k * out; roll += side * 0.12 * out; cYaw += side * 0.12 * out; headDown = 0.3 * out;
      } else if (mv === "swat") {
        const L = side > 0 ? 1 : 0, up = bell(p, 0.1, 0.62), down = bell(p, 0.45, 0.85);
        rear = 0.35 * up;
        ov[L] = { x: D.shX + (0.22 + 0.25 * down) * k, y: D.pawR + (0.42 * up + 0.05 * down) * k, abd: side * 0.25, a: -HALF + 1.1 * up };
        jawFight = 0.75 * Math.max(up, 0.6 * bell(p, 0, 1)); earPin = 1; headDown = 0.25;
      } else if (mv === "bite") {
        lunge = bell(p, 0.2, 0.75); jawFight = p < 0.5 ? 0.8 * sstep(0.1, 0.42, p) : 0.8 * (1 - sstep(0.5, 0.58, p)); earPin = 0.8; headDown = 0.2;
        cX += 0.14 * k * lunge; pX += 0.06 * k * lunge; cY -= 0.04 * k * lunge;
      } else if (mv === "pin") {
        // the pounce lands: forelegs reach forward and down onto the prey
        const r = bell(p, 0.0, 0.7);
        ov[0] = { x: D.shX + 0.42 * k * r + 0.05 * k, y: D.pawR + 0.2 * k * r, abd: -0.2 * r, a: -HALF + 0.7 * r };
        ov[1] = { x: D.shX + 0.42 * k * r + 0.05 * k, y: D.pawR + 0.2 * k * r, abd: 0.2 * r, a: -HALF + 0.7 * r };
        cY -= 0.08 * k * r; cX += 0.12 * k * r; jawFight = p < 0.45 ? 0.85 * sstep(0.05, 0.3, p) : 0.85 * (1 - sstep(0.45, 0.55, p)); headDown = 0.55 * r; earPin = 1;
      } else if (mv === "grapple") {
        // up on the hind legs, forelegs round the man's shoulders, the bite to the neck
        rear = sstep(0, 0.35, p) * (1 - sstep(0.8, 1, p));
        ov[0] = { x: D.shX + 0.3 * k, y: D.pawR + 0.05 * k + rear * 0.55 * k, abd: -0.35 * rear, a: -HALF + 1.3 * rear };
        ov[1] = { x: D.shX + 0.3 * k, y: D.pawR + 0.05 * k + rear * 0.55 * k, abd: 0.35 * rear, a: -HALF + 1.3 * rear };
        jawFight = 0.85 * bell(p, 0.25, 0.62); earPin = 1; headDown = -0.4 * rear;
      } else if (mv === "throat" || mv === "nape") {
        // the hold: crouched over the prey, forelegs spread and pinning, the
        // jaws clamped and the head down at the ground; the body heaves
        const c0 = sstep(0, 0.25, Math.min(1, F.t / 0.6));
        pY -= 0.14 * k * c0; cY -= 0.2 * k * c0; cR -= 0.1 * c0;
        ov[0] = { x: D.shX + 0.3 * k * c0, y: D.pawR, abd: -0.35 * c0, a: -HALF + 0.4 * c0 };
        ov[1] = { x: D.shX + 0.3 * k * c0, y: D.pawR, abd: 0.35 * c0, a: -HALF + 0.4 * c0 };
        headDown = 0.95 * c0; jawFight = 0.32 + 0.04 * Math.sin(st.t * 9); earPin = 0.7;
        cYaw += 0.06 * Math.sin(st.t * 3.1) * c0;                      // the shake, the tug
      }
    }
    // rearing: chest up, nose up
    if (rear > 0) { cY += 0.42 * k * rear; cR += 0.85 * rear; cX -= 0.12 * k * rear; pR += 0.25 * rear; }

    // ---- LEAP: the arc through the air, legs stretched out and gathered
    if (leapU >= 0) {
      const arc = Math.sin(PI * leapU);
      rootY = S.leap.height * k * arc * (st.leap.d0 / S.leap.range);
      const up = 1 - leapU;
      cR += 0.3 * up * up - 0.3 * leapU * leapU; pR += 0.2 * up - 0.15 * leapU;
      const ext = sstep(0.0, 0.25, leapU) * (1 - sstep(0.85, 1, leapU));
      for (let s = 0; s < 2; s++) {
        ov[s] = { x: D.shX + (0.35 + 0.15 * leapU) * k, y: D.sh * 0.45 - 0.2 * k * leapU, abd: (s ? 1 : -1) * 0.1, a: -HALF + 1.0 * ext };
        ov[2 + s] = { x: D.hipX - 0.45 * k * ext, y: D.hipH * 0.55, abd: (s ? 1 : -1) * 0.05, a: -HALF - 0.6 * ext };
      }
      jawFight = 0.6 * sstep(0.6, 0.9, leapU); earPin = 1; headDown = 0.2;
    } else if (st.land > 0) {
      const q = st.land / 0.6;
      cY -= 0.08 * k * q; pY -= 0.05 * k * q;
    }

    // ---- LIE (sphinx): belly down, forelegs out in front, hind folded under
    if (lieK > 0.001) {
      pX = lerp(pX, D.hipX + 0.03 * k, lieK); pY = lerp(pY, D.lieP, lieK);
      cX = lerp(cX, D.shX, lieK); cY = lerp(cY, D.lieC, lieK);
      pR = lerp(pR, 0, lieK); cR = lerp(cR, 0.05, lieK); roll *= 1 - lieK;
    }

    b[BN.root].position.set(0, rootY, 0);
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(roll * 0.8, pYaw, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(roll, cYaw, cR);

    // ---- LEGS
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, Fz = G.feet[Lg], ids = LEGB[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      const bx = front ? cX : pX, by = front ? cY : pY, br = front ? cR : pR;
      const off = bp[ids[0]];
      const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
      const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
      // gait foot
      const su = Fz.sw ? Math.sin(PI * Fz.u) : 0;
      let fx = Fz.lx, fy = Fz.ly + D.pawR, fa, abd = 0;
      if (front) fa = -HALF + S.gait.foreA - (1.25 + 0.9 * gal) * su;
      else {
        fa = -HALF + S.gait.hindA - (0.5 + 0.5 * gal) * su;
        if (!Fz.sw) fa += 0.3 * clamp((D.feet[Lg].x - Fz.lx) / (0.3 * K), -1, 1);
      }
      // the lame leg: lifted a little higher, touched down lightly
      if (st.limp[Lg] > 0.05) { fy += 0.03 * k * st.limp[Lg] * (Fz.sw ? 1 : 0.4); }
      // root-frame correction: the root bone is lifted on a leap, feet live in model space
      fy -= rootY;
      // overrides (fight poses, the leap)
      const o = ov[Lg];
      if (o) { fx = o.x; fy = o.y; fa = o.a; abd = o.abd || 0; }   // in the root's frame (on a leap the legs ride up with it)
      // sphinx
      if (lieK > 0.001) {
        const lx = front ? D.shX + (0.32 + 0.1) * k : pX + 0.2 * k, la = front ? 0.05 : 0.02;
        fx = lerp(fx, lx, lieK); fy = lerp(fy, D.pawR * 0.9, lieK); fa = lerp(fa, front ? -0.1 : la, lieK);
        abd = lerp(abd, front ? 0 : (Lg === 2 ? -0.35 : 0.35), lieK);
      }
      const wx = fx - cl * Math.cos(fa), wy = fy - cl * Math.sin(fa);
      CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
      const t1 = _ik[0], t2 = _ik[1];
      b[ids[0]].rotation.set(abd, 0, t1 + HALF - br);
      b[ids[1]].rotation.set(0, 0, t2 - t1);
      b[ids[2]].rotation.set(0, 0, fa - t2);
    }

    // ---- NECK / HEAD: a hunter's head is held level; it looks at its mark
    const tg = m.tgt && !m.tgt.dead ? m.tgt : (st.threat || null);
    let wantY = 0, wantP = 0;
    if (tg && tg.pos) {
      wantY = clamp(wrapPi(Math.atan2(tg.pos.z - m.pos.z, tg.pos.x - m.pos.x) - h), -1.3, 1.3);
      const dd = Math.hypot(tg.pos.x - m.pos.x, tg.pos.z - m.pos.z);
      wantP = clamp(Math.atan2(((tg.headY || tg.eyeH || 1.2) * 0.6) - D.headP.y, Math.max(0.5, dd)), -0.5, 0.6);
    } else if (!preview) {
      // scanning the horizon, now and then
      wantY = 0.7 * Math.sin(st.t * 0.37) * Math.sin(st.t * 0.11 + 1);
    }
    if (st.flee) { wantY *= 0.2; wantP = 0; }
    st.lookY = approach(st.lookY, -wantY, 5, dt);       // a +z bearing turns the head toward -yaw
    st.lookP = approach(st.lookP, wantP, 5, dt);
    let nP = -cR * 0.65 - 0.35 * gal - 0.5 * cro - 0.6 * headDown + 0.12 * st.alert - 0.35 * st.pant * (1 - moveK) - 0.12 * inj;
    if (lieK > 0) nP = lerp(nP, 0.15, lieK);
    if (hk > 0 && H.region === 0) nP += 0.35 * hk;
    nP += 0.06 * wW * moveK * Math.sin(4 * PI * ph + 0.6);
    const yawK = 1 - 0.8 * gal;
    b[BN.neck].rotation.set(0, st.lookY * 0.5 * yawK - (hk > 0 && H.region === 0 ? H.side * 0.3 * hk : 0), nP * 0.6);
    b[BN.neck1].rotation.set(0, st.lookY * 0.3 * yawK, nP * 0.4 - 0.06 * gal * Math.sin(TAU * ph));
    const hP = -cR * 0.35 + st.lookP * 0.6 - 0.2 * headDown + 0.15 * cro + (leapU >= 0 ? -0.2 : 0) + lunge * -0.1;
    b[BN.head].rotation.set(0, st.lookY * 0.25 * yawK, hP);
    // ---- JAW: panting, the snarl, the bite, the hold
    const jawOpen = clamp(Math.max(st.pant * (0.18 + 0.06 * Math.sin(st.breathPh)), jawFight, hk * 0.4 * (H.region <= 1 ? 1 : 0.4)), 0, 0.85);
    b[BN.jaw].rotation.set(0, 0, -jawOpen);
    // ---- EARS: forward when alert, flat back in a fight or in fear, flicks
    st.earTwT -= dt;
    if (st.earTwT <= 0) { st.earTwT = 0.8 + R.rng() * 3; st.earTw[R.rng() < 0.5 ? 0 : 1] = 1; }
    const pin = clamp(Math.max(earPin, st.flee ? 0.7 : 0, hk * 0.8, st.cornered ? 1 : 0), 0, 1);
    for (let s = 0; s < 2; s++) {
      st.earTw[s] = Math.max(0, st.earTw[s] - dt * 5);
      const e = b[s === 0 ? BN.earL : BN.earR], sg = s === 0 ? -1 : 1;
      e.rotation.set(sg * (0.55 * pin + 0.25 * st.earTw[s]), sg * -0.2 * pin, -0.1 * st.alert + 0.95 * pin + 0.35 * st.earTw[s]);
    }
    // ---- TAIL: carriage by mood, the rudder in turns, the flick at rest
    const TR = D.tailRest;
    st.tailFlT -= dt;
    if (st.tailFlT <= 0) { st.tailFlT = 1.5 + R.rng() * 4; st.tailFl = 1; }
    st.tailFl = Math.max(0, st.tailFl - dt * 2.5);
    // a damped spring toward the turn: it overshoots and comes back, the way a
    // tail used as a counterweight does
    const want = clamp(st.turn * (0.22 + 0.02 * Math.abs(st.v)), -1.0, 1.0) + (st.aggr > 0.5 && !mv ? 0.5 * Math.sin(st.t * 4.2) : 0);
    st.tailYv += ((want - st.tailY) * 60 - st.tailYv * 9) * dt;
    st.tailY += st.tailYv * dt;
    const run = clamp(Math.abs(gv) / 6, 0, 1);
    let carry = lerp(TR[0], S.gait.tailRun, run) + 0.25 * cro + 0.2 * st.injury + (st.flee ? 0.15 : 0);
    carry -= 0.25 * gal * Math.sin(TAU * (ph - S.gait.flexAt));
    carry -= pR * 0.85 * (1 - lieK);                 // held against the pelvis tilt: a counterweight, not a flag
    if (leapU >= 0) carry = lerp(carry, -0.15, 0.8);
    if (lieK > 0) carry = lerp(carry, 1.25, lieK);
    const tb = [BN.tail0, BN.tail1, BN.tail2, BN.tail3, BN.tail4, BN.tail5];
    for (let i = 0; i < 6; i++) {
      const tt = i / 5;
      const sway = st.tailY * (i === 0 ? 0.35 : 0.22) + st.tailFl * 0.35 * tt * Math.sin(st.t * 14 - i) + 0.04 * Math.sin(st.t * 1.3 - i * 0.6) * (1 - run);
      const pitch = i === 0 ? carry : (lerp(TR[1], S.gait.tailRunCurl, run) * (tt * tt) + (lieK > 0 ? -0.2 * lieK * (i < 3 ? 1 : -1.5) : 0));
      b[tb[i]].rotation.set(0, sway, pitch);
    }
    // leap progress for the shot service and the fight
    if (st.leap && tg) {
      const dd = Math.hypot(tg.pos.x - m.pos.x, tg.pos.z - m.pos.z);
      st.leap.u = clamp(1 - (dd - 1.0) / Math.max(0.5, st.leap.d0 - 1.0), 0, 1);
    }
  }

  // ==========================================================================
  //  DEATH: the corpse solver moved the markers; bend the bones onto them
  // ==========================================================================
  let _V = null;
  function scratch() {
    if (_V) return _V;
    const THREE = W.THREE;
    _V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
      q: new THREE.Quaternion(), qi: new THREE.Quaternion(), qp: new THREE.Quaternion(), down: new THREE.Vector3(0, -1, 0), back: new THREE.Vector3(-1, 0, 0) };
    return _V;
  }
  // a body nobody has animated yet (a turntable, a frozen field) still stands
  // like a cat: legs bent onto the neutral feet, tail at rest, collar seated
  function standPose(R) {
    const D = R.D, S = R.S, b = R.bones, BN = R.T.BN, LEGB = R.T.LEGB, bp = R.bindPos;
    b[BN.pelvis].position.set(D.hipX, D.hipH, 0); b[BN.chest].position.set(D.shX, D.sh, 0);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], f = D.feet[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      const fa = -HALF + (front ? S.gait.foreA : S.gait.hindA), jx = front ? D.shX : D.hipX, jy = front ? D.sh : D.hipH;
      CBZ.quadRig.ik2(jx, jy, f.x - cl * Math.cos(fa), D.pawR - cl * Math.sin(fa), a, bl, front ? -1 : 1, _ik);
      b[ids[0]].rotation.set(0, 0, _ik[0] + HALF);
      b[ids[1]].rotation.set(0, 0, _ik[1] - _ik[0]);
      b[ids[2]].rotation.set(0, 0, fa - _ik[1]);
    }
    b[BN.neck].rotation.set(0, 0, 0.04); b[BN.neck1].rotation.set(0, 0, 0.03);
    const TR = D.tailRest;
    for (let i = 0; i < 6; i++) b[BN["tail" + i]].rotation.set(0, 0.03 * Math.sin(i), i === 0 ? TR[0] : TR[1] * (i / 5) * (i / 5));
    void bp;
  }
  function deathPose(renderer) {
    const R = this.userData.felRig, m = R && R.unit;
    if (R && !R.collar && !R.noCollar) {
      seatCollar(R);
      if (R.collar) R.collar.updateMatrixWorld(true); else R.noCollar = true;
    }
    if (!m || !m.dead) return;
    const fr = renderer && renderer.info ? renderer.info.render.frame : 0;
    const st = R.st;
    if (!st || st.lastFrame === fr) return;
    st.lastFrame = fr;
    const V = scratch(), b = R.bones, bp = R.bindPos, BN = R.T.BN, D = R.D, ind = R.ind;
    st.deadK = Math.min(1, st.deadK + 0.08);
    // the body back to its bind frame: the group itself is the solved torso
    b[BN.root].position.set(0, 0, 0);
    b[BN.pelvis].position.copy(bp[BN.pelvis]); b[BN.pelvis].rotation.set(0, 0, 0.05);
    b[BN.chest].position.copy(bp[BN.chest]); b[BN.chest].rotation.set(0, 0, -0.05);
    const solved = !!(m.ragdoll && (!CBZ.quadRagdollActive || CBZ.quadRagdollActive(m) || m._quadSlot != null));
    const mk = R.markers;
    for (let Lg = 0; Lg < 4; Lg++) {
      const ids = R.T.LEGB[Lg], front = Lg < 2, Lm = mk.legs[Lg];
      if (solved) {
        // positions are in the group's frame; the shell is scaled by ind
        V.a.copy(Lm.A.position).divideScalar(ind);
        V.b.copy(Lm.K.position).divideScalar(ind);
        V.c.copy(Lm.F.position).divideScalar(ind);
        V.d.subVectors(V.b, V.a);
        if (V.d.lengthSq() < 1e-8) continue;
        V.d.normalize();
        V.q.setFromUnitVectors(V.down, V.d);
        b[ids[0]].quaternion.copy(V.q);
        V.d.subVectors(V.c, V.b);
        if (V.d.lengthSq() < 1e-8) continue;
        V.d.normalize();
        V.qi.copy(V.q).invert();
        V.d.applyQuaternion(V.qi);
        V.qp.setFromUnitVectors(V.down, V.d);
        b[ids[1]].quaternion.copy(V.qp);
        b[ids[2]].rotation.set(0, 0, front ? 0.35 : -0.3);
      } else {
        // the solver declined: the legs go slack where they are
        const kx = st.deadK;
        b[ids[0]].rotation.set(0, 0, (front ? 0.5 : -0.45) * kx);
        b[ids[1]].rotation.set(0, 0, (front ? -0.35 : 0.55) * kx);
        b[ids[2]].rotation.set(0, 0, (front ? 0.5 : -0.4) * kx);
      }
    }
    // the head lolls toward its solved point, the tail lies where it fell
    if (solved) {
      V.a.set(D.neckB.x, D.neckB.y, 0);
      V.b.set(D.headP.x - D.neckB.x, D.headP.y - D.neckB.y, 0).normalize();
      V.c.copy(mk.head.position).divideScalar(ind).sub(V.a);
      if (V.c.lengthSq() > 1e-8) { V.c.normalize(); V.q.setFromUnitVectors(V.b, V.c); b[BN.neck].quaternion.copy(V.q); }
      V.a.set(D.tailP.x, D.tailP.y, 0);
      V.c.copy(mk.tail.position).divideScalar(ind).sub(V.a);
      if (V.c.lengthSq() > 1e-8) { V.c.normalize(); V.q.setFromUnitVectors(V.back, V.c); b[BN.tail0].quaternion.copy(V.q); }
    } else {
      b[BN.neck].rotation.set(0, 0, -0.35 * st.deadK);
      b[BN.tail0].rotation.set(0, 0, 0.3 * st.deadK);
    }
    b[BN.neck1].rotation.set(0, 0, -0.1);
    b[BN.head].rotation.set(0, 0, -0.15);
    b[BN.jaw].rotation.set(0, 0, -0.22);
    b[BN.earL].rotation.set(-0.3, 0, 0.5); b[BN.earR].rotation.set(0.3, 0, 0.5);
    for (let i = 1; i < 6; i++) b[BN["tail" + i]].rotation.set(0, 0.08 * Math.sin(i * 1.7 + R.seed), 0.05);
  }

  // ==========================================================================
  //  FIGHT
  // ==========================================================================
  const RES = { inRange: false, dealt: 0, missed: false };
  function endMove(st) {
    const F = st.f;
    F.move = null; F.t = 0; F.hit = false; F.hold = false; F.acc = 0; F.accT = 0;
  }
  function startMove(S, st, name, side) {
    const F = st.f, mv = S.moves[name];
    F.move = name; F.t = 0; F.dur = mv.dur; F.at = mv.at; F.hit = false; F.hold = !!mv.hold; F.acc = 0; F.accT = 0;
    F.side = side; F.vAtk = Math.abs(st.v); F.kd = false;
  }
  function pickMove(S, m, st, t, cls, R) {
    const F = st.f, r = R.rng();
    if (cls.bigger) return "swat";
    const isDown = downed(t) || F.downT > 0;
    if (S.style === "courser") {
      if (isDown) return "throat";
      if (Math.abs(st.v) > 5 || r < 0.55) return "trip";
      return r < 0.8 ? "swat" : "bite";
    }
    // ambusher
    if (st.land > 0 && st.landHit) return "pin";
    if (isDown) return "nape";
    if (cls.man || cls.ratio > 1.3) return r < 0.6 ? "grapple" : (r < 0.8 ? "pin" : "swat");
    return r < 0.55 ? "pin" : (r < 0.8 ? "bite" : "swat");
  }
  function knock(t, ux, uz, dur, power) {
    if (!t || t.beast || t.vehicle || t.dead) return false;
    if (CBZ.verbs && CBZ.verbs.knockdown) {
      try { return CBZ.verbs.knockdown(t, { dir: { x: ux, z: uz }, power: power, dur: dur }); } catch (e) {}
    }
    t.ko = Math.max(t.ko || 0, dur);
    return true;
  }
  function deal(S, m, st, t, cls, F, ux, uz, dmgK, opts, R) {
    const mv = S.moves[F.move];
    // the blow: the move's own number, plus what the moving mass brings
    let dmg = mv.dmg * dmgK;
    if (mv.impact) dmg += mv.impact * dmgK * clamp(F.vAtk / 10, 0, 1.6) * clamp(massOf(m) / 45, 0.6, 1.6);
    if (opts && opts.onHit) opts.onHit(dmg);
    RES.dealt += dmg;
    if (cls.man || (t.beast && !cls.bigger)) {
      if (CBZ.creatureBiteBlood && (F.move !== "swat" && F.move !== "trip")) { try { CBZ.creatureBiteBlood(m, t, "bite"); } catch (e) {} }
    }
    // a knockdown: speed, the mass ratio and luck (a braced man is harder to drop)
    if (mv.kd) {
      const pk = clamp(mv.kd.base + mv.kd.perV * F.vAtk + mv.kd.mass * (1 / Math.max(0.2, cls.ratio)) - (cls.man && cls.armed ? 0.08 : 0), 0, 0.95);
      if (R.rng() < pk) {
        F.kd = true;
        F.downT = mv.kd.dur;
        knock(t, ux, uz, mv.kd.dur, 0.8);
        if (t.beast && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(t); } catch (e) {} }
      }
    }
    if (F.move === "trip" && !F.kd) st.f.fails++;
  }
  function fight(S, m, t, dt, opts) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    const R = rigOf(m);
    if (!R) return CBZ.creatureFight ? CBZ.creatureFight(m, t, dt, opts) : RES;
    if (!R.st) initUnit(S, m, R);
    const st = R.st, F = st.f, L = S.loco;
    if (!t || !dt) return RES;
    if (m.dead || t.dead) { endMove(st); return RES; }
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-3;
    const ux = dx / d, uz = dz / d;
    const cls = classify(S, m, t);
    const isDown = downed(t) || F.downT > 0;
    const mouthD = Math.max((m.rad || 0.5) + (t.rad || 0.45) * (isDown ? 0.55 : 1), (m.noseR || 0.8) * 0.86);
    const dmgK = opts && opts.dmg > 0 && S.stats.dmg > 0 ? opts.dmg / S.stats.dmg : 1;
    const move = opts && opts.move;
    F.cool -= dt; F.downT = Math.max(0, F.downT - dt);
    if (opts && opts.youMove) return fightYou(S, m, t, dt, opts, R, st, F, cls, isDown, mouthD, dmgK, ux, uz, d, dx, dz);
    // ---- face: away when running, at the mark otherwise
    const want = st.flee && !st.cornered ? Math.atan2(-dz, -dx) : Math.atan2(dz, dx);
    let cur = typeof m.heading === "number" ? m.heading : 0;
    const dh = wrapPi(want - cur), mt = L.turnRate * dt;
    cur += clamp(dh, -mt, mt);
    m.heading = cur; m.faceH = cur;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, cur);
    RES.inRange = d <= mouthD + 0.8;
    // ---- running away (the think has not caught up yet): break off
    if (st.flee && !st.cornered) {
      endMove(st);
      if (move) move(m, -ux, -uz, Math.max(st.vCmd, L.trot) * dt);
      return RES;
    }
    // ---- the pounce in flight
    if (st.leap) {
      const step = L.leapV * dt;
      if (move) move(m, ux, uz, Math.min(step, Math.max(0, d - mouthD)));
      if (d - step <= mouthD + 0.3) {
        endLeap(st, true);
        startMove(S, st, "pin", 1);
        F.t = F.dur * 0.25; F.vAtk = L.leapV;
      }
      return RES;
    }
    // ---- a move in progress
    if (F.move) {
      const mv = S.moves[F.move];
      F.t += dt;
      const p = F.t / F.dur;
      // the move's own footwork
      if (F.move === "bite" || F.move === "pin") {
        if (p > 0.15 && p < 0.55 && move) move(m, ux, uz, Math.min(Math.max(0, d - mouthD * 0.85), (F.move === "pin" ? 4 : 2.5) * dt));
      } else if (F.move === "trip") {
        // the run carries it past the prey's hindquarters
        const vv = Math.max(2, F.vAtk * (1 - p));
        if (move) move(m, ux, uz, Math.min(Math.max(0, d - mouthD * 0.7), vv * dt));
      } else if (F.hold && move && d > mouthD + 0.05) move(m, ux, uz, Math.min(d - mouthD, 2 * dt));
      if (!F.hit && p >= F.at) {
        F.hit = true;
        if (cls.veh) RES.missed = true;
        else if (d <= mouthD + mv.reach) deal(S, m, st, t, cls, F, ux, uz, dmgK, opts, R);
        else { RES.missed = true; F.fails++; }
      }
      if (F.hold && F.hit) {
        // the clamp: suffocation / the bite worked in, paid every half second
        if (!(isDown || t.beast) || d > mouthD + 0.9) { endMove(st); F.cool = 0.5; return RES; }
        F.acc += mv.dps * dmgK * dt; F.accT += dt;
        if (F.accT >= 0.5) { if (opts && opts.onHit) opts.onHit(F.acc); RES.dealt += F.acc; F.acc = 0; F.accT = 0; }
        // keep a man down while the jaws are on him
        if (cls.man && !downed(t)) knock(t, ux, uz, 1.6, 0.4);
        F.downT = Math.max(F.downT, 0.6);
      } else if (p >= 1) {
        const failed = !F.kd && (F.move === "trip" || F.move === "pin" || F.move === "grapple");
        endMove(st);
        F.cool = (S.moves[mv.next || "_"] ? 0.05 : mv.cool) / Math.max(0.3, (opts && opts.rate) || 1);
        // a courser that keeps failing loses interest (they give up easily)
        if (failed && S.style === "courser" && F.fails >= S.mind.giveUpFails) { st.fear += 0.35; F.fails = 0; }
      }
      return RES;
    }
    // ---- close in, then pick the move this body would use on that one
    if (d > mouthD + 0.05 && move) {
      const sp = clamp(Math.abs(st.v) > 2 ? Math.abs(st.v) : st.vCmd, 2.5, Math.max(3, L.vmax));
      move(m, ux, uz, Math.min(d - mouthD, sp * dt));
    }
    if (cls.veh) return RES;                                 // teeth do nothing to plate
    const lead = Math.abs(st.v) * 0.12;
    // a body arriving at a run strikes on arrival; the cooldown is for the
    // NEXT blow, not the first one
    if ((F.cool <= 0 || Math.abs(st.v) > 5) && d <= mouthD + 0.35 + lead) {
      const name = pickMove(S, m, st, t, cls, R);
      const rel = wrapPi(Math.atan2(dz, dx) - cur);
      startMove(S, st, name, rel >= 0 ? 1 : -1);
      if (cls.bigger) st.fear += 0.25;
    }
    return RES;
  }

  // THE PLAYER'S BLOW. The possessed driver chose the move (moves() below),
  // latched _atkAnim = 0 and carries the body in on a leap; this plays the
  // move with its real effects and reports progress through _atkAnim, which
  // is how the driver knows the blow has ended.
  function fightYou(S, m, t, dt, opts, R, st, F, cls, isDown, mouthD, dmgK, ux, uz, d, dx, dz) {
    const yv = opts.youMove, id = yv.id;
    const mine = S.moves[id] ? id : (isDown ? (S.moves.throat ? "throat" : "nape") : (S.moves.bite ? "bite" : Object.keys(S.moves)[0]));
    if (F.youMv !== yv || !F.move) {
      if (F.youMv === yv && !F.move) { m._atkAnim = -1; return RES; }   // this blow is done
      startMove(S, st, mine, wrapPi(Math.atan2(dz, dx) - (m.heading || 0)) >= 0 ? 1 : -1);
      F.youMv = yv; F.vAtk = Math.max(F.vAtk, Math.abs(m.speed || 0));
      // a held bite is a timed worry when a player throws it (press again to keep on)
      if (F.hold) { F.hold = false; F.youHold = true; F.dur = 1.4; } else F.youHold = false;
    }
    // face the mark
    const want = Math.atan2(dz, dx);
    let cur = typeof m.heading === "number" ? m.heading : 0;
    cur += clamp(wrapPi(want - cur), -S.loco.turnRate * dt, S.loco.turnRate * dt);
    m.heading = cur; m.faceH = cur;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, cur);
    const mv = S.moves[F.move];
    F.t += dt;
    const p = F.t / F.dur;
    RES.inRange = d <= mouthD + 0.8;
    if (!F.hit && p >= F.at) {
      F.hit = true;
      if (t.dummy || cls.veh) RES.missed = true;
      else if (d <= mouthD + mv.reach * (yv.rng || 1)) deal(S, m, st, t, cls, F, ux, uz, dmgK * (yv.pow || 1), opts, R);
      else RES.missed = true;
    }
    if (F.youHold && F.hit && !t.dummy && !t.dead && d <= mouthD + 0.9) {
      F.acc += mv.dps * dmgK * dt; F.accT += dt;
      if (F.accT >= 0.35) { if (opts.onHit) opts.onHit(F.acc); RES.dealt += F.acc; F.acc = 0; F.accT = 0; }
      if (cls.man && !downed(t)) knock(t, ux, uz, 1.2, 0.4);
    }
    if (p >= 1) { endMove(st); m._atkAnim = -1; }
    else m._atkAnim = clamp(p, 0, 0.999);
    return RES;
  }

  // what a player's ATTACK becomes for this cat, chosen by the moment
  // (units/kit/moves.js contract): { id, style, pow, dur, rng, leap, cd }
  function youMoves(S, m, t, ctx) {
    const M = S.moves, reach = ctx.reach || 2, dist = ctx.dist == null ? 99 : ctx.dist;
    const far = !t || dist > reach * 1.05, n = ctx.n || 1;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    const mk = function (id, style, extra) {
      const r = { id: id, style: style, pow: 1, dur: M[id].hold ? 1.4 : M[id].dur, rng: 1, cd: M[id].cool };
      return extra ? Object.assign(r, extra) : r;
    };
    if (S.style === "courser") {
      if (ctx.downed) return mk("throat", "maul", { cd: 0.15 });
      // at a run the forepaw hook is thrown from a stride out: the trip
      if (far && running && dist < reach * 2.6) return mk("trip", "pounce", { leap: 0.7 });
      if (running) return mk("trip", "maul");
      return n % 3 === 0 ? mk("bite", "bite") : mk("swat", "maul");
    }
    if (ctx.downed) return mk("nape", "maul", { cd: 0.15 });
    // the ambusher's pounce: from a standstill or a run, out to ~9 m
    if (far && t && dist < reach * 4.2) return mk("pin", "pounce", { leap: 2.0 });
    if (ctx.heavy || ctx.crowd > 2) return n % 2 === 0 ? mk("bite", "bite") : mk("swat", "maul");
    const big = t && !t.beast;
    if (big) return n % 2 === 0 ? mk("swat", "maul") : mk("grapple", "maul");
    return n % 2 === 0 ? mk("bite", "bite") : mk("pin", "pounce");
  }

  // ==========================================================================
  //  PREVIEW (the shot service's attack preset): one move at one phase
  // ==========================================================================
  function preview(S, m, move, phase) {
    const R = rigOf(m);
    if (!R) return;
    if (!R.st) initUnit(S, m, R);
    const st = R.st;
    if (move === "leap" && S.leap) {
      st.leap = { d0: S.leap.range, t: 0, max: 9, u: clamp(phase, 0, 1), hit: false };
      endMove(st);
    } else if (S.moves[move]) {
      st.leap = null;
      startMove(S, st, move, 1);
      st.f.t = clamp(phase, 0, 0.999) * (st.f.hold ? 1.2 : st.f.dur);
    }
    st.v = 0; st.turn = 0; st.acc = 0;
    animate(S, m, 1 / 60, true);
  }

  function hooks(S) {
    return {
      build: function (ctx) { return build(S, ctx); },
      animate: function (m, dt) { animate(S, m, dt, false); },
      fight: function (m, t, dt, opts) { return fight(S, m, t, dt, opts); },
      preview: function (m, move, phase) { preview(S, m, move, phase); },
      moves: function (m, t, ctx) { return youMoves(S, m, t, ctx || {}); },
    };
  }
  CBZ.felidKit = {
    hooks: hooks, dims: dims,
    state: function (m) { const R = rigOf(m); return R ? R.st : null; },
    rig: rigOf,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.felidKit;
})();
