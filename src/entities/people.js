/* ============================================================
   entities/people.js — THE BLENDER PEOPLE: real human bodies, skinned,
   on the game's own rig.

   OWNER: "remake human models in Blender ... so clothes look better on
   people, and they're more easy to animate ... make people just incredibly
   real. So the different races are incredibly real. Facial hair, it's all
   going to be incredibly real ... and gore."

   WHERE THE PEOPLE COME FROM. tools/people/build_pack.py reads MakeHuman's
   CC0 data (the hm08 base body, its macro targets, the game_engine skeleton
   and weights, the community skins / hair / beards / garments the MPFB
   Blender extension installs) and writes assets/people/pack.{json,bin} +
   textures. This file is a small MakeHuman: every person is BUILT here, at
   spawn, from that pack —

     SHAPE      MakeHuman's own macro blend (sex x age x ancestry, sex x age x
                muscle x weight, breast cup x firmness) through an SVD basis
                of all 288 macro targets: base + sum_k c_k * shape_k, the
                coefficients mixed exactly as MakeHuman mixes the targets.
                Plus seeded face detail (nose, jaw, chin, cheeks, eyes, mouth,
                ears, brow) so no two faces match.
     SKIN       a real skin texture by ancestry x age x sex, toned to the
                casting's skin hex (heritage.js keeps deciding who is who);
                pores and wrinkles as a per-age relief map; light wraps
                through it reddened (cheap subsurface scatter).
     HAIR       real hair cards per style (character.js hairStyle), tinted to
                the person's hair colour, alpha-tested + a soft blended edge
                pass; a shaved scalp and STUBBLE are shaded into the skin
                (beard and scalp masks in skin UV space).
     BEARDS     full / goatee / moustache meshes over stubble; plain stubble.
     FACE       eyes, brows, lashes, teeth, tongue, each fitted by MakeHuman's
                MHCLO binding; blink / jaw / smile / pain / fear / snarl /
                anger blend shapes (ARKit face units, CC0) driven by
                systems/facial.js through CBZ.human.facePose.
     CLOTHES    real garments (fit, collar, cuffs, lapels, ties, folds, seams:
                their own texture, normal + AO maps) fitted to THIS body by
                MHCLO, the body under them removed. A uniform is BUILT from
                them in layers (THE REAL WARDROBE: a duty shirt, a suit with
                its own tie, a gilet over a sleeve), each garment zone dyed in
                the colours the game's outfit painter (city/clothes.js) gives
                that outfit, its markings (badge, patch, tape, lettering)
                lifted off the painter's picture onto the real cloth. Only a
                true print (a patterned dress) wears the picture itself.
     RIG        MakeHuman's game_engine skeleton (53 bones, UE names), placed
                on THIS body by its joint cubes, skinned by its own weights
                (garments inherit them through their binding).

   ANIMATION STAYS WHERE IT IS. The procedural rig (character.js + every
   system that poses it: gait, aim, vault, seats, swimming, ragdoll, gore) is
   still the one source of truth. The skinned body is retargeted off it after
   the scene graph has composed it (a driver node, last child of the rig,
   runs inside scene.updateMatrixWorld): each bone takes its proc part's
   rotation delta, positions come down the person's OWN skeleton, and two-bone
   IK lands wrists and ankles where the proc hands and feet are (so guns stay
   in hands and soles on floors whatever the proportions). The proc meshes
   stay alive, hidden on a layer the cameras do not draw, so hit tests,
   gore's state flags and every reader of them keep working.

   API
     CBZ.people.ready()            -> Promise (loads the pack once)
     CBZ.people.attach(ch, look)   -> true when the rig now wears a person
     CBZ.people.detach(ch)         -> back to the procedural body
     CBZ.people.wound(ch, worldPos, opts)  a wound on the skin (+ cloth)
     CBZ.people.sever(ch, part, opts)      dismember (la ra ll rl head)
     CBZ.people.pending()          -> textures still loading
     CBZ.people.stats()
   Flag: CBZ.CONFIG.PEOPLE_SKINNED (false: attach refuses, nothing changes).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.people || typeof THREE === "undefined") return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PEOPLE_SKINNED == null) CBZ.CONFIG.PEOPLE_SKINNED = true;

  const SRC = (typeof document !== "undefined" && document.currentScript && document.currentScript.src) || "";
  const ROOT = SRC ? new URL("../../assets/people/", SRC).href : "assets/people/";
  const VER = "p3";
  /* THE PROC BODY HIDES ON A LAYER OF ITS OWN. It used to share
     pedinstance.js's hide layer (30), and that is a layer with an owner: the
     outfit guarantee sweep asks pedinstance whether a hidden cloth part is
     drawn, pedinstance has no record of a part WE hid, calls it a hole, and
     "repairs" it back onto layer 0. A swept real person walked about inside
     their old box body. 29 is nobody's: no camera draws it, nothing reveals
     it, and its readers (the touch tap ray) are told about it here. */
  const HIDE = 29;
  CBZ.PEOPLE_HIDE_LAYER = HIDE;
  const NW = 12;                   // wounds per person (shader arrays)
  const EXPR = ["blink", "jaw", "smile", "pain", "fear", "snarl", "anger"];

  let M = null, BIN = null, loading = null, failed = null, pendingTex = 0;
  const S = {};                    // shared data derived from the pack, built once
  const texCache = Object.create(null);
  const assetCache = Object.create(null);
  const live = new Set();

  // ================================================================ load
  function view(d) {
    if (!d) return null;
    const C = { f32: Float32Array, i16: Int16Array, u16: Uint16Array, u32: Uint32Array, i32: Int32Array, u8: Uint8Array, i8: Int8Array }[d.t];
    return new C(BIN, d.o, d.n);
  }
  function ready() {
    if (loading) return loading;
    loading = Promise.all([
      fetch(ROOT + "pack.json?v=" + VER).then(function (r) { if (!r.ok) throw new Error("people pack.json " + r.status); return r.json(); }),
      fetch(ROOT + "pack.bin?v=" + VER).then(function (r) { if (!r.ok) throw new Error("people pack.bin " + r.status); return r.arrayBuffer(); }),
    ]).then(function (res) { M = res[0]; BIN = res[1]; prepare(); return true; });
    loading.catch(function (e) { failed = e; });
    return loading;
  }
  function tex(name, srgb) {
    if (!name) return null;
    let t = texCache[name];
    if (t) return t;
    pendingTex++;
    let done = false;
    const fin = function () { if (!done) { done = true; pendingTex--; } };
    t = new THREE.TextureLoader().load(ROOT + "tex/" + name + "?v=" + VER, fin, undefined, fin);
    // THE GAME'S COLOUR CONVENTION: hexes and painted canvases go to the GPU
    // as stored (no sRGB decode) and every look in the game was tuned that
    // way, so the people's textures do the same — a person's skin then lands
    // on exactly the tone the casting picked, beside everything else.
    t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
    t.anisotropy = 4;
    return (texCache[name] = t);
  }

  // bone groups: torso 0, arm 1, leg 2, foot 3, head 4
  function boneGroup(n) {
    if (/^(thigh|calf)/.test(n)) return 2;
    if (/^(foot|ball)/.test(n)) return 3;
    if (/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/.test(n)) return 1;
    if (n === "head") return 4;
    return 0;
  }
  function sparse(t) { return { idx: view(t.idx), d: view(t.d), s: t.s, name: t.name }; }

  function prepare() {
    const NB = S.NB = M.nBase;
    S.base = view(M.base.pos);
    S.K = M.shape.K; S.basis = view(M.shape.basis); S.bscale = view(M.shape.scale); S.coef = view(M.shape.coef);
    S.tix = Object.create(null);
    M.shape.targets.forEach(function (n, i) { S.tix[n] = i; });
    S.sIdx = view(M.rig.skinIndex); S.sWt = view(M.rig.skinWeight);
    S.bones = M.rig.bones;
    S.bix = Object.create(null);
    S.bones.forEach(function (b, i) { S.bix[b.name] = i; });
    S.bgroup = S.bones.map(function (b) { return boneGroup(b.name); });
    // per base vertex: weight share in torso / arm / leg / foot / head
    const vg = S.vgroup = new Float32Array(NB * 5);
    for (let v = 0; v < NB; v++) for (let j = 0; j < 4; j++) {
      const w = S.sWt[v * 4 + j];
      if (w) vg[v * 5 + S.bgroup[S.sIdx[v * 4 + j]]] += w / 255;
    }
    // ---- the body: render vertices (split on UV seams) -> base vertices
    const map = S.bodyMap = view(M.body.map), nR = map.length;
    S.bodyIndex = view(M.body.index);
    S.bodyTris = new Uint32Array(S.bodyIndex.length);
    for (let i = 0; i < S.bodyIndex.length; i++) S.bodyTris[i] = map[S.bodyIndex[i]];
    const inv = invMap(map, NB); S.bodyInv = inv;
    const sk = skinAttrs(map, function (r, j) { return S.sIdx[map[r] * 4 + j]; }, function (r, j) { return S.sWt[map[r] * 4 + j]; });
    S.body = {
      nR: nR, uv: new THREE.BufferAttribute(new Float32Array(view(M.body.uv)), 2),
      skinIndex: sk.i, skinWeight: sk.w,
    };
    // the expressions as dense base deltas (assets bound to the face take
    // theirs through the binding) and as the body's shared morph attributes
    S.exprDense = {};
    S.body.morph = EXPR.map(function (name) {
      const t = M.expr[name] ? sparse(M.expr[name]) : null;
      const dense = new Float32Array(NB * 3);
      if (t) for (let j = 0; j < t.idx.length; j++) {
        const i = t.idx[j];
        dense[i * 3] = t.d[j * 3] * t.s; dense[i * 3 + 1] = t.d[j * 3 + 1] * t.s; dense[i * 3 + 2] = t.d[j * 3 + 2] * t.s;
      }
      S.exprDense[name] = dense;
      const a = new Float32Array(nR * 3);
      for (let r = 0; r < nR; r++) { const b = map[r] * 3; a[r * 3] = dense[b]; a[r * 3 + 1] = dense[b + 1]; a[r * 3 + 2] = dense[b + 2]; }
      return new THREE.BufferAttribute(a, 3);
    });
    S.detail = (M.detail || []).map(function (pair) { return pair.map(sparse); });
    // face masks (beard / goatee / moustache in rgb; scalp in a): see build_pack.py
    S.ready = true;
  }
  function invMap(map, n) {
    const start = new Uint32Array(n + 1);
    for (let r = 0; r < map.length; r++) start[map[r] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const fill = start.slice(0, n), list = new Uint32Array(map.length);
    for (let r = 0; r < map.length; r++) list[fill[map[r]]++] = r;
    return { start: start, list: list };
  }
  function skinAttrs(map, idxOf, wtOf) {
    const n = map.length, I = new Uint16Array(n * 4), W = new Uint8Array(n * 4);
    for (let r = 0; r < n; r++) for (let j = 0; j < 4; j++) { I[r * 4 + j] = idxOf(r, j); W[r * 4 + j] = wtOf(r, j); }
    return { i: new THREE.Uint16BufferAttribute(I, 4), w: new THREE.BufferAttribute(W, 4, true) };
  }

  // ================================================================ shape
  function comps(name, v) {
    const out = [], parts = M.macro[name];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.lowest < v && v < p.highest) {
        const t = (v - p.lowest) / (p.highest - p.lowest);
        if (p.low) out.push([p.low, 1 - t]);
        if (p.high) out.push([p.high, t]);
      }
    }
    return out;
  }
  // MakeHuman's macro target weights for one body (macro.json's own rules)
  function macroWeights(m) {
    const w = Object.create(null);
    const add = function (k, x) { if (x > 1e-5 && S.tix[k] != null) w[k] = (w[k] || 0) + x; };
    const cg = comps("gender", m.gender), ca = comps("age", m.age), cm = comps("muscle", m.muscle), cw = comps("weight", m.weight);
    const cc = comps("cupsize", m.cup), cf = comps("firmness", m.firm);
    for (const r in m.race) {
      const rw = m.race[r];
      if (!(rw > 0)) continue;
      for (const [a, aw] of ca) for (const [g, gw] of cg) add("macrodetails/" + r + "-" + g + "-" + a, rw * gw * aw);
    }
    for (const [g, gw] of cg) for (const [a, aw] of ca) for (const [mu, mw] of cm) for (const [x, xw] of cw)
      add("macrodetails/universal-" + g + "-" + a + "-" + mu + "-" + x, gw * aw * mw * xw);
    for (const [g, gw] of cg) {
      if (g !== "female") continue;
      for (const [a, aw] of ca) for (const [mu, mw] of cm) for (const [x, xw] of cw) for (const [c, cw2] of cc) for (const [f, fw] of cf) {
        if (c === "averagecup" && f === "averagefirmness") continue;
        add("breast/female-" + a + "-" + mu + "-" + x + "-" + c + "-" + f, gw * aw * mw * xw * cw2 * fw);
      }
    }
    return w;
  }
  function shapeOf(m, detail) {
    const NB3 = S.NB * 3, K = S.K, pos = new Float32Array(S.base);
    const cv = new Float32Array(K), w = macroWeights(m);
    for (const k in w) {
      const ti = S.tix[k], x = w[k];
      for (let j = 0; j < K; j++) cv[j] += x * S.coef[ti * K + j];
    }
    for (let j = 0; j < K; j++) {
      const c = cv[j] * S.bscale[j];
      if (Math.abs(c) < 1e-9) continue;
      const B = S.basis, o = j * NB3;
      for (let i = 0; i < NB3; i++) pos[i] += c * B[o + i];
    }
    if (detail) for (const d of detail) {
      const t = d.t, x = d.x;
      for (let j = 0; j < t.idx.length; j++) {
        const i = t.idx[j] * 3;
        pos[i] += x * t.d[j * 3] * t.s; pos[i + 1] += x * t.d[j * 3 + 1] * t.s; pos[i + 2] += x * t.d[j * 3 + 2] * t.s;
      }
    }
    return pos;
  }

  // ================================================================ casting
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // ancestry mixes [african, asian, caucasian] per heritage (entities/heritage.js ids)
  const RACE = {
    black: [0.9, 0, 0.1], caribbean: [0.85, 0, 0.15], white: [0, 0, 1], easteuro: [0, 0.05, 0.95],
    latino: [0.12, 0.33, 0.55], centralam: [0.12, 0.48, 0.4], carlatino: [0.4, 0.08, 0.52], mexican: [0.08, 0.47, 0.45],
    eastasian: [0, 1, 0], seasian: [0.08, 0.86, 0.06], filipino: [0.06, 0.78, 0.16], native: [0.02, 0.62, 0.36],
    islander: [0.25, 0.55, 0.2], mideast: [0.08, 0.04, 0.88], southasian: [0.22, 0.18, 0.6], mixed: [0.45, 0.1, 0.45],
  };
  function lum(hex) { return (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255; }
  function raceOf(look, r) {
    const h = look.heritage && RACE[look.heritage];
    if (h) return { african: h[0], asian: h[1], caucasian: h[2] };
    // no heritage on the look: read it off the skin the casting chose
    const L = lum(look.skin != null ? look.skin : 0xcf9a72);
    const af = Math.max(0, Math.min(1, (0.66 - L) / 0.36));
    const as = (1 - af) * (r() < 0.25 ? 0.35 + 0.5 * r() : 0.08 * r());
    return { african: af, asian: as, caucasian: Math.max(0, 1 - af - as) };
  }
  // MakeHuman's age slider: 1 y -> 0, 11 y -> 0.1875, 25 y -> 0.5, 90 y -> 1
  function ageParam(y) {
    if (y <= 1) return 0.0;
    if (y < 11) return (y - 1) / 10 * 0.1875;
    if (y < 25) return 0.1875 + (y - 11) / 14 * 0.3125;
    return Math.min(1, 0.5 + (y - 25) / 65 * 0.5);
  }
  const PHYS = { average: [0.5, 0.5], slim: [0.4, 0.22], heavy: [0.42, 0.92], muscular: [0.95, 0.6] };
  function castPerson(ch, look) {
    const seed = look.seed != null ? look.seed >>> 0 : hashStr([look.skin, look.hair, look.build, look.heritage, look.hairStyle, look.beard, look.age, look.physique].join("|"));
    const r = rng(seed);
    const f = look.build === "f";
    const ageY = ch && ch.ageYears != null ? ch.ageYears : (look.age != null && isFinite(look.age) ? +look.age : 24 + Math.floor(r() * 22));
    const ph = PHYS[look.physique] || PHYS[(ch && ch.physique)] || PHYS.average;
    const kid = ageY < 16;
    const m = {
      gender: f ? 0.02 + 0.06 * r() : 0.97 - 0.05 * r(),
      age: ageParam(ageY),
      muscle: Math.max(0, Math.min(1, (kid ? 0.5 : ph[0]) + (r() - 0.5) * 0.12)),
      weight: Math.max(0, Math.min(1, (kid ? 0.48 : ph[1]) + (r() - 0.5) * 0.14)),
      cup: f && !kid ? 0.38 + 0.3 * r() : 0.5, firm: f ? 0.4 + 0.25 * r() : 0.5,
      race: raceOf(look, r),
    };
    // face detail: every pair a slider in [-0.6, 0.6]; mirrored l-/r- pairs move together
    const detail = [], sym = Object.create(null);
    for (const pair of S.detail) {
      const nm = pair[0].name.replace(/^[lr]-/, "").replace(/-(decr|incr|in|out)$/, "");
      let x = sym[nm];
      if (x == null) x = sym[nm] = (r() + r() - 1) * 0.8;
      if (pair.length === 1) { if (x > 0) detail.push({ t: pair[0], x: x * 0.5 }); }
      else detail.push(x < 0 ? { t: pair[0], x: -x } : { t: pair[1], x: x });
    }
    return { seed: seed, r: r, f: f, ageY: ageY, kid: kid, macro: m, detail: detail };
  }
  function skinFor(look, cast) {
    const race = cast.macro.race;
    const anc = race.african >= 0.5 ? "african" : race.asian >= 0.5 ? "asian" : "caucasian";
    const band = cast.ageY < 34 ? "young" : cast.ageY < 58 ? "middleage" : "old";
    const sex = cast.f ? "female" : "male";
    if (look.heritage === "southasian" && cast.f && M.skins.cutoff3d_indian_female_skin) return "cutoff3d_indian_female_skin";
    let k = band + "_" + anc + "_" + sex;
    if (!M.skins[k]) k = "young_" + anc + "_" + sex;
    if (!M.skins[k]) k = "young_caucasian_" + sex;
    return k;
  }
  const EYE = { dark: "brown", brown: "brownlight", hazel: "bluegreen", green: "green", blue: "blue", grey: "grey", gray: "grey", light: "lightblue" };
  function hairKey(look, cast) {
    if (look.bald || look.hairStyle === "bald") return null;
    const st = look.hairStyle || (cast.f || look.longHair ? "long" : "short");
    const alt = cast.r() < 0.5;
    const pick = function (a, b) { return M.assets["hair:" + (alt && M.assets["hair:" + b] ? b : a)] ? "hair:" + (alt && M.assets["hair:" + b] ? b : a) : null; };
    switch (st) {
      case "buzz": return null;
      case "short": return "hair:short";
      case "crop": return pick("crop", "crop_b");
      case "bob": return pick("bob", "bob_b");
      case "long": return pick("long", "long_b");
      case "pony": return "hair:pony";
      case "bun": return "hair:bun";
      case "pigtail": return "hair:pigtail";
      case "afro": return "hair:afro";
      case "curly": return "hair:curly";
      case "locs": return "hair:locs";
      default: return cast.f ? "hair:long" : "hair:short";
    }
  }

  // ================================================================ garments
  /* WHICH REAL GARMENT A PAINTED OUTFIT IS. The painted set (clothes.js)
     declares what it covers: parts.arms (long sleeves) or parts.sleeves
     (short), parts.legs (trousers) or a hem (skirt / dress), parts.jacket (a
     tailored shell). The garment is the closest real cut; its colour and
     markings stay the painter's. */
  const JACKETS = /puffer|hoodie|varsity|denim_jacket|ski|tracksuit|bomber|parka|leather|windbreaker|fleece/;
  function garmentFor(ch, cast, worn) {
    const id = worn ? String(worn.key).split("|")[0] : "street";
    const parts = worn && worn.set ? worn.set.parts || {} : {};
    const longSleeve = !!parts.arms;
    const skirt = !!(parts.hem) || /dress|skirt|gown/.test(id);
    if (cast.f) {
      if (skirt) return /halter|sundress/.test(id) ? "cloth:f_halter" : (parts.jacket ? "cloth:f_suit" : "cloth:f_dress");
      if (parts.jacket || /suit|exec|office|banker/.test(id)) return "cloth:f_suit";
      if (/sport|athletic|gym|jog/.test(id)) return "cloth:f_sport";
      if (longSleeve) return "cloth:m_long";
      return "cloth:f_tee";
    }
    if (parts.jacket || /suit|tux|banker|exec/.test(id)) return "cloth:m_suit";
    if (JACKETS.test(id)) return "cloth:m_jacket";
    if (/coverall|overall|farmer|mechanic/.test(id)) return "cloth:m_overalls";
    if (!longSleeve) return cast.r() < 0.5 ? "cloth:m_tee" : "cloth:m_tee_b";
    return cast.r() < 0.6 ? "cloth:m_long" : "cloth:m_long_b";
  }
  function shoesFor(cast, worn) {
    const id = worn ? String(worn.key).split("|")[0] : "street";
    if (cast.f) return /police|precinct|soldier|army|guard|swat|tactical|construction|hivis|groundcrew|marshal|hunter|ranger|farmer|fisherman|corrections|sheriff|warden|security|firefighter|ems/.test(id) ? "shoes:boots_f" : (/dress|exec|suit|office|tuxedo|driver|pilot|cabincrew|waiter|designer|detective|doctor/.test(id) ? "shoes:flats" : "shoes:sneakers");
    if (/police|precinct|soldier|army|guard|swat|tactical|construction|hivis|groundcrew|marshal|hunter|ranger|farmer|fisherman|coverall|fire|corrections|sheriff|warden|security|ems|mariner|janitor/.test(id)) return "shoes:boots";
    if (/suit|tux|exec|office|banker|waiter|valet|driver|pilot|cabincrew|bartender|detective|doctor|designer|mailman|busdriver/.test(id)) return "shoes:dress";
    return cast.r() < 0.5 ? "shoes:sneakers" : "shoes:sneakers_b";
  }

  /* ================================================================ THE REAL WARDROBE
     OWNER, looking at the first Blender people: the suits and the button-down
     shirts "look so real", the chauffeur "looks terrible ... that painted on
     looks horrible". The difference was exactly this: a plain shirt was a real
     garment dyed one colour, a uniform was the outfit painter's FLAT PICTURE of
     a uniform (a waistcoat drawn as a polygon, a tie as a stripe, buttons as
     dots, lapels, pockets and aprons as outlines) wrapped round a real
     garment that had none of them.

     So a uniform is now BUILT, not painted: real garments (tools/people/
     build_pack.py ships them, each split into ZONES: its main cloth, legs,
     the shirt under it, the tie, the trim) layered the way the uniform is
     worn — a shirt, a three-piece suit with its own tie, a gilet over a long
     sleeve, bib overalls over a tee — each zone dyed in the uniform's colours.
     Those COLOURS are read off the outfit painter's own picture (city/
     clothes.js stays the one place an outfit is designed; the far, boxy body
     still wears its picture), so a cop is the same navy at 10 m and at 100.
     Its MARKINGS (the badge, the nameplate, the agency patch, reflective
     tape, a red cross, lettering, a tracksuit's stripes) are lifted off that
     picture too and laid on the real cloth — but only the markings: whatever
     the painter drew to fake STRUCTURE (a vest, lapels, pockets, a placket, a
     tie) is left behind, because the garment has the real one.
     An outfit whose picture IS its cloth (a printed dress, gingham, a kid's
     graphic tee) keeps it as the print it is.

     A layer:  { g: garment, z: { main, legs, shirt, tie } colour sources,
                 sleeve: source, marks: "TAL" rows that may carry markings,
                 camo: 1, rough, fabric: 1 (a suit picks its nearest real cloth),
                 over: 1 (worn over the layer below: hides no body),
                 under: 1 (worn under the layers above it: only what they
                   leave showing is kept, an undershirt at an open collar),
                 hide: [zones] (a zone of this garment not worn: the duty
                   shirt's jeans under real slacks),
                 conceal: 1 (a jacket over the duty belt: the kit is worn under
                   it, the shield on the breast) }
     A colour source:  T  the painter's torso (back panel: plain cloth)
                       Tf the torso's front panel   J the tailored jacket
                       A  the sleeve   L the trousers   tie the painter's tie
                       C  the outfit's collar colour (an undershirt)
                       "#rrggbb" a fixed colour     keep the garment's own */
  const SHIRT = function (o) { return [Object.assign({ g: "m_shirt", z: { main: "T", legs: "L" }, marks: "TAL" }, o || {})]; };
  const SUIT3 = function (z, o) { return [Object.assign({ g: "m_suit3", z: z, marks: "" }, o || {})]; };
  const BLAZER = function (z, o) { return [Object.assign({ g: "f_blazer", z: z, marks: "" }, o || {})]; };
  const JACKET = function (o) { return [Object.assign({ g: "m_jacket", z: { main: "T", shirt: "Tf", legs: "L" }, marks: "TAL" }, o || {})]; };
  /* A PATROL OFFICER: real uniform slacks; over them the duty shirt (its own
     jeans not worn) carrying the badge, the nameplate and the patches; and
     at its open collar the crew-neck undershirt, in the uniform's collar
     colour (navy for a cop, white under a guard's black). An open-collared
     shirt over bare chest and jeans is a man in a button-down, not a cop. */
  const DUTY = function () {
    return [{ g: "m_slacks", z: { main: "L", legs: "L" }, marks: "L" },
      { g: "m_shirt", z: { main: "T" }, hide: [1], marks: "TA" },        // zone 1: its jeans
      { g: "m_crew", z: { main: "C" }, under: 1, marks: "" }];
  };
  const HIVIS = function (base) {
    return [{ g: base || "m_long", z: { main: "A", legs: "L" }, marks: "AL" }, { g: "m_gilet", z: { main: "T" }, marks: "T", over: 1 }];
  };
  const WARDROBE = {
    // ---- duty shirts: a real button-down (collar, placket, yoke, pockets)
    police: { m: DUTY() }, precinct: { m: DUTY() }, corrections: { m: DUTY() }, sheriff: { m: DUTY() },
    security: { m: DUTY() }, warden: { m: SHIRT() }, mailman: { m: SHIRT() }, ranger: { m: SHIRT() },
    janitor: { m: SHIRT() }, mariner: { m: SHIRT() }, busdriver: { m: SHIRT() }, ems: { m: SHIRT() },
    inmate: { m: SHIRT() }, inmate_cap: { m: SHIRT() }, inmate_orderly: { m: SHIRT() }, inmate_chapel: { m: SHIRT() },
    chef: { m: SHIRT({ marks: "T" }) }, bartender: { m: SHIRT({ marks: "" }) }, school: { m: SHIRT({ marks: "" }) },
    soldier: { m: SHIRT({ camo: 1, marks: "" }) },
    // ---- a vest over a sleeve: hi-vis, blaze orange, a plate carrier
    construction: { m: HIVIS("m_long") }, hivis: { m: HIVIS("m_long") }, groundcrew: { m: HIVIS("m_long") },
    marshal: { m: HIVIS("m_long") },
    hunter: { m: [{ g: "m_shirt", z: { main: "A", legs: "L" }, camo: "A", marks: "" }, { g: "m_gilet", z: { main: "T" }, marks: "T", over: 1 }] },
    swat: { m: [{ g: "m_shirt", z: { main: "A", legs: "L" }, marks: "AL" }, { g: "m_gilet", z: { main: "T" }, marks: "T", over: 1, rough: 0.8 }] },
    tactical: { m: [{ g: "m_shirt", z: { main: "A", legs: "L" }, marks: "" }, { g: "m_gilet", z: { main: "T" }, marks: "T", over: 1, rough: 0.8 }] },
    // ---- jackets: a turnout coat, a ski shell, a coverall, a tracksuit
    firefighter: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" } }) },
    // (a ski shell is plain: the painter's crosses sit at the chest's centre,
    // which on an open jacket is the tee, and a cross cut in half is a glitch)
    ski: { m: JACKET({ sleeve: "A", marks: "" }) }, ski_patrol: { m: JACKET({ sleeve: "A", marks: "" }) },
    puffer: { m: JACKET({ marks: "" }) }, denim_jacket: { m: JACKET({ marks: "" }) }, hoodie: { m: JACKET({ marks: "T" }) },
    leather: { m: JACKET({ z: { main: "J", shirt: "Tf", legs: "L" }, marks: "", rough: 0.5 }) },
    varsity: { m: JACKET({ sleeve: "A", marks: "T" }) }, hiker: { m: JACKET({ sleeve: "A", marks: "" }) },
    homeless: { m: JACKET({ z: { main: "J", shirt: "Tf", legs: "L" }, marks: "" }) },
    coveralls: { m: JACKET({ z: { main: "T", shirt: "T", legs: "T" }, marks: "T" }) },
    // (a sleeve stripe runs down the outer arm, which faces the camera only
    // as a sliver at the silhouette: on these the sleeves stay plain)
    pitcrew: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) }, racer: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) },
    athletic: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) }, tracksuit: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) },
    tracksuit2: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) }, tracksuit3: { m: JACKET({ z: { main: "T", shirt: "T", legs: "L" }, marks: "TL" }) },
    // ---- tailoring: a real suit, a real tie, a real bow tie
    suit: { m: [{ g: "m_suit", z: { main: "J", legs: "L" }, fabric: 1, marks: "" }], f: BLAZER({ main: "J", shirt: "Tf", legs: "L" }) },
    tuxedo: { m: [{ g: "m_tux", z: { main: "J", shirt: "#f1f2ec", tie: "#141414", legs: "L" }, marks: "" }], f: BLAZER({ main: "J", shirt: "#f1f2ec", legs: "L" }) },
    office: { m: SUIT3({ main: "L", shirt: "T", tie: "tie", legs: "L" }), f: BLAZER({ main: "L", shirt: "T", legs: "L" }) },
    // a plainclothes detective in his suit (its real tie, a closed collar):
    // the duty belt and the gun under the jacket, the gold shield on the breast
    detective: { m: SUIT3({ main: "L", shirt: "T", tie: "tie", legs: "L" }, { conceal: 1 }), f: BLAZER({ main: "L", shirt: "T", legs: "L" }, { conceal: 1 }) },
    doctor: { m: SUIT3({ main: "J", shirt: "Tf", tie: "tie", legs: "L" }), f: BLAZER({ main: "J", shirt: "Tf", legs: "L" }) },
    // a chauffeur, a valet: the waistcoat they were painted in is a jacket
    driver: { m: SUIT3({ main: "T", shirt: "A", tie: "tie", legs: "L" }), f: BLAZER({ main: "T", shirt: "A", legs: "L" }) },
    valet: { m: SUIT3({ main: "Tf", shirt: "A", tie: "tie", legs: "L" }), f: BLAZER({ main: "Tf", shirt: "A", legs: "L" }) },
    waiter: { m: [{ g: "m_tux", z: { main: "J", shirt: "#f1f2ec", tie: "#141414", legs: "L" }, marks: "" }], f: BLAZER({ main: "J", shirt: "#f1f2ec", legs: "L" }) },
    pilot: { m: SUIT3({ main: "#1c2639", shirt: "T", tie: "tie", legs: "L" }, { marks: "T" }), f: BLAZER({ main: "#1c2639", shirt: "T", legs: "L" }, { marks: "T" }) },
    cabincrew: { m: SUIT3({ main: "T", shirt: "#eef0f2", tie: "tie", legs: "L" }), f: BLAZER({ main: "T", shirt: "#eef0f2", legs: "L" }) },
    designer: { m: SUIT3({ main: "J", shirt: "Tf", tie: "tie", legs: "L" }), f: BLAZER({ main: "J", shirt: "Tf", legs: "L" }) },
    // ---- work and play
    scrubs: { m: [{ g: "m_tee", z: { main: "T", legs: "L" }, marks: "" }], f: [{ g: "f_tee", z: { main: "T", legs: "L" }, marks: "" }] },
    vendor: { m: [{ g: "m_tee", z: { main: "T", legs: "L" }, marks: "" }] },
    housekeeping: { m: SHIRT({ marks: "" }), f: [{ g: "f_suit", z: { main: "T", legs: "L" }, marks: "" }] },
    lifeguard: { m: [{ g: "m_tee", z: { main: "T", legs: "L" }, marks: "TL" }], f: [{ g: "f_shorts", z: { main: "T", legs: "L" }, marks: "TL" }] },
    fisherman: { m: [{ g: "m_overalls", z: { main: "Tf", shirt: "A" }, marks: "" }] },
    farmer: { m: [{ g: "m_overalls", z: { main: "Tf", shirt: "A" }, marks: "" }] },
    wifebeater: { m: [{ g: "m_tank", z: { main: "T", legs: "L" }, marks: "" }] }, inmate_tank: { m: [{ g: "m_tank", z: { main: "T", legs: "L" }, marks: "" }] },
    schoolgirl: { m: SHIRT({ marks: "" }), f: [{ g: "f_suit", z: { main: "T", legs: "L" }, marks: "" }] },
  };
  // an outfit whose picture IS its cloth: a printed dress, gingham, a kid's tee
  const PRINTS = /^(dress|sundress|blouse|romper|pinafore|onesie|pyjamas|kidtee|kidhoodie|graphic_tee|comp|gang|basics|street|civvies)$/;

  /* THE PAINTER'S COLOURS. Its picture at 1x, read once per outfit key: the
     modal colour of a plain patch of each panel (the back of the torso is the
     cloth with nothing on it; the front's middle strip is skipped, that is
     where ties and plackets are). */
  const palCache = Object.create(null);
  /* the cloth's colour in a patch: the biggest CLUSTER of near colours, not
     the single commonest one (a painter shades its cloth with gradients, which
     spread the cloth over many near bins, while a flat strap or badge lands in
     one: counted bin by bin, the mailman's bag strap outvoted his shirt) */
  function modalHex(d, W, x0, y0, x1, y1, skip) {
    const bins = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (skip && skip(x, y)) continue;
      const i = (y * W + x) * 4;
      if (d[i + 3] < 128) continue;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      let b = bins.get(k);
      if (!b) { b = [0, 0, 0, 0]; bins.set(k, b); }
      b[0]++; b[1] += d[i]; b[2] += d[i + 1]; b[3] += d[i + 2];
    }
    if (!bins.size) return null;
    const all = Array.from(bins.values());
    for (const b of all) { b.r = b[1] / b[0]; b.g = b[2] / b[0]; b.b = b[3] / b[0]; }
    all.sort(function (a, b) { return b[0] - a[0]; });
    let best = null, bestN = -1;
    for (let i = 0; i < Math.min(16, all.length); i++) {
      const c = all[i];
      let n = 0;
      for (const o of all) if (Math.max(Math.abs(o.r - c.r), Math.abs(o.g - c.g), Math.abs(o.b - c.b)) <= 26) n += o[0];
      if (n > bestN) { bestN = n; best = c; }
    }
    let n = 0, r = 0, g = 0, bl = 0;
    for (const o of all) if (Math.max(Math.abs(o.r - best.r), Math.abs(o.g - best.g), Math.abs(o.b - best.b)) <= 26) { n += o[0]; r += o[1]; g += o[2]; bl += o[3]; }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n);
  }
  /* WOODLAND in the uniform's own colour: its base, a darker shade, an earth
     brown and a light khaki (a painter's picture is no palette: its block
     highlights read as two khakis and the soldier went pale) */
  function camoFrom(h) {
    const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255;
    const c = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    const mk = function (R, G, B) { return (c(R) << 16) | (c(G) << 8) | c(B); };
    return [h, mk(r * 0.6, g * 0.62, b * 0.58), mk(r * 0.95 + 20, g * 0.76, b * 0.55), mk(r * 1.32 + 16, g * 1.26 + 14, b * 1.22 + 12)];
  }
  function paletteOf(worn) {
    const key = worn.key;
    if (palCache[key] !== undefined) return palCache[key];
    let out = null;
    try {
      const hi = CBZ.cityClothesHiRes ? CBZ.cityClothesHiRes(key, 1, true) : null;
      const cv = hi && hi.canvas;
      if (cv) {
        const W = cv.width, d = cv.getContext("2d").getImageData(0, 0, W, cv.height).data;
        const neck = worn.set.parts && worn.set.parts.neck;
        out = {
          T: modalHex(d, W, 64, 14, 96, 70), Tf: modalHex(d, W, 4, 16, 60, 70, function (x) { return x >= 26 && x <= 38; }),
          J: modalHex(d, W, 64, 106, 96, 160), A: modalHex(d, W, 64, 182, 96, 206), L: modalHex(d, W, 64, 222, 96, 250),
          tie: neck && neck.tie != null ? neck.tie | 0 : modalHex(d, W, 30, 34, 34, 60),
        };
      }
    } catch (e) { out = null; }
    return (palCache[key] = out);
  }

  /* THE MARKINGS. The painter's picture at 4x; per panel, its cloth colour
     (modal) and every pixel that is NOT that cloth and not just a lighter or
     darker shade of it (shading, seams, pockets, a placket, a tie on a white
     shirt are all shades). Of those, connected runs that are SMALL (a badge,
     a nameplate, a patch, a letter, a cross) or BANDS / STRIPES (reflective
     tape, a tracksuit stripe) stay; a big run is a painted vest or apron or
     colour block, which the real garment's own cut replaces. */
  const markCache = Object.create(null);
  const AWK = 4;
  const PANELS = [];
  [["torso", 0, 96], ["arm", 176, 216], ["leg", 216, 256]].forEach(function (r) {
    [["front", 0, 64], ["back", 64, 96], ["side", 96, 112]].forEach(function (c) { PANELS.push({ row: r[0], col: c[0], x0: c[1], x1: c[2], y0: r[1], y1: r[2] }); });
  });
  // a pixel that is not the panel's cloth and not merely a shade of it
  function notCloth(d, i, br, bg, bb, bs) {
    if (d[i + 3] < 128) return false;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dr = r - br, dg = g - bg, db = b - bb;
    if (0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db < 30 * 30) return false;
    const s = r + g + b + 30;
    return Math.max(Math.abs(r / s - br / bs), Math.abs(g / s - bg / bs), Math.abs(b / s - bb / bs)) >= 0.045;
  }
  /* Found on the 1x picture (cheap: 32k pixels), drawn from the 4x one: only
     the 4x pixels inside a kept 1x cell (grown by one) are tested again, so
     the edges are the painter's own crisp ones. */
  function marksOf(worn) {
    const key = worn.key;
    if (markCache[key] !== undefined) return markCache[key];
    let tx = null;
    try {
      const lo = CBZ.cityClothesHiRes ? CBZ.cityClothesHiRes(key, 1, true) : null;
      const hi = lo ? CBZ.cityClothesHiRes(key, AWK, true) : null;
      const cv = hi && hi.canvas;
      if (cv && lo.canvas) {
        const W1 = lo.canvas.width, H1 = lo.canvas.height;
        const d1 = lo.canvas.getContext("2d").getImageData(0, 0, W1, H1).data;
        const W = cv.width, H = cv.height, ctx = cv.getContext("2d");
        const img = ctx.getImageData(0, 0, W, H), d = img.data;
        const keep1 = new Uint8Array(W1 * H1), baseAt = new Int32Array(W1 * H1).fill(-1);
        const keep = new Uint8Array(W * H);
        let any = false;
        for (const p of PANELS) {
          const x0 = p.x0, x1 = p.x1, y0 = p.y0, y1 = p.y1, pw = x1 - x0, ph = y1 - y0;
          const base = modalHex(d1, W1, x0, y0, x1, y1);
          if (base == null) continue;
          const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255, bs = br + bg + bb + 30;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) baseAt[y * W1 + x] = base;
          const mark = new Uint8Array(pw * ph);
          for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            if (notCloth(d1, ((y0 + y) * W1 + x0 + x) * 4, br, bg, bb, bs)) mark[y * pw + x] = 1;
          }
          // connected runs (4-neighbour union-find over the panel)
          const par = new Int32Array(pw * ph).fill(-1);
          const find = function (a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
          for (let i = 0; i < pw * ph; i++) {
            if (!mark[i]) continue;
            par[i] = i;
            const x = i % pw;
            if (x > 0 && mark[i - 1]) { const a = find(i - 1), b = find(i); if (a !== b) par[b] = a; }
            if (i >= pw && mark[i - pw]) { const a = find(i - pw), b = find(i); if (a !== b) par[b] = a; }
          }
          const st = new Map();
          for (let i = 0; i < pw * ph; i++) {
            if (!mark[i]) continue;
            const r = find(i), x = i % pw, y = (i / pw) | 0;
            let s = st.get(r);
            if (!s) { s = [0, x, y, x, y]; st.set(r, s); }
            s[0]++; if (x < s[1]) s[1] = x; if (y < s[2]) s[2] = y; if (x > s[3]) s[3] = x; if (y > s[4]) s[4] = y;
          }
          const ok = new Map();
          st.forEach(function (s, r) {
            const w = s[3] - s[1] + 1, h = s[4] - s[2] + 1, n = s[0];
            // small for its panel, or small outright: a patch on a 16 px side
            // panel is a big share of it (a painted vest is thousands of px)
            const small = n < Math.max(0.07 * pw * ph, 360);
            const band = h < 0.12 * ph && w > 0.55 * pw;
            const cx = (s[1] + s[3]) / 2 / pw;
            // a painted tie hangs from the collar, dead centre (a lifeguard's
            // cross beside it is a marking)
            const tieLike = p.row === "torso" && p.col === "front" && cx > 0.42 && cx < 0.58 && s[2] < 0.16 * ph && h > 0.28 * ph && w < 0.2 * pw;
            // a stripe: narrow for its panel, or a few pixels in a narrow one
            const stripe = (w < 0.14 * pw || w <= 4) && h > 0.4 * ph && !tieLike;
            ok.set(r, (small || band || stripe) && !tieLike);
          });
          for (let i = 0; i < pw * ph; i++) {
            if (!mark[i] || !ok.get(find(i))) continue;
            keep1[(y0 + ((i / pw) | 0)) * W1 + x0 + (i % pw)] = 1;
          }
        }
        // the 4x pixels of every kept cell and its neighbours, tested against
        // that cell's own panel cloth
        for (let y = 0; y < H1; y++) for (let x = 0; x < W1; x++) {
          let near = 0;
          for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy >= 0 && yy < H1 && xx >= 0 && xx < W1 && keep1[yy * W1 + xx] && baseAt[yy * W1 + xx] === baseAt[y * W1 + x]) { near = 1; break; }
          }
          const base = baseAt[y * W1 + x];
          if (!near || base < 0) continue;
          const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255, bs = br + bg + bb + 30;
          for (let sy = 0; sy < AWK; sy++) for (let sx = 0; sx < AWK; sx++) {
            const X = x * AWK + sx, Y = y * AWK + sy;
            if (notCloth(d, (Y * W + X) * 4, br, bg, bb, bs)) { keep[Y * W + X] = 1; any = true; }
          }
        }
        if (any) {
          // raw bytes, not a canvas: a canvas stores its pixels premultiplied,
          // so every clear texel would come back black and the filtering would
          // ring each badge with a dark fringe; here a clear texel keeps the
          // cloth's own colour. Rows flipped: the projection's v runs up.
          const out = new Uint8Array(W * H * 4);
          for (let y = 0; y < H; y++) {
            const sy = H - 1 - y;
            for (let x = 0; x < W; x++) {
              const si = (sy * W + x) * 4, di = (y * W + x) * 4;
              out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = keep[sy * W + x] ? 255 : 0;
            }
          }
          tx = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
          tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearMipmapLinearFilter;
          tx.generateMipmaps = true; tx.anisotropy = 4; tx.encoding = THREE.LinearEncoding;
          tx.needsUpdate = true;
        }
      }
    } catch (e) { tx = null; }
    return (markCache[key] = tx);
  }
  const _noMarks = (function () {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = c.height = 2;
    const t = new THREE.CanvasTexture(c); return t;
  })();
  function hexOrNull(v) { return v == null || v === "keep" ? null : v; }
  /* A STREET NEVER WAITS FOR A BADGE. In the city (the LOD manager's
     builds) an outfit's markings are worked out on a later quiet tick; the
     person is dressed at once and the badge lands a moment after, on the
     materials waiting for it. Tools and the lab get them at once. */
  const marksQueue = [], marksWait = new Map();
  function marksSoon(worn) {
    if (markCache[worn.key] !== undefined) return markCache[worn.key];
    if (!marksWait.has(worn.key)) { marksWait.set(worn.key, []); marksQueue.push(worn); }
    return undefined;
  }
  function marksPump() {
    const w = marksQueue.shift();
    if (!w) return false;
    const t = marksOf(w);
    const list = marksWait.get(w.key) || [];
    marksWait.delete(w.key);
    for (const m of list) if (m.userData && m.userData.u) m.userData.u.pMarks.value = t || _noMarks;
    return true;
  }
  /* the outfit's LAYERS, each a garment and the colours / markings it wears */
  function wardrobePlan(ch, cast, worn, flat, defer) {
    const id = worn ? String(worn.key).split("|")[0] : null;
    const spec = id && WARDROBE[id];
    const pal = spec ? paletteOf(worn) : null;
    if (spec && pal) {
      const src = (cast.f && spec.f) || spec.m;
      const parts = (worn.set && worn.set.parts) || {};
      const cc = (worn.set && worn.set.c) || {};
      // a region the painter did not paint is whatever the outfit dyed the
      // rig there (its picture there is only the fill): the office shirt's
      // painter draws no trousers, the rig's trousers are charcoal
      const own = function (region, fallback) {
        const v = flat[region] != null ? flat[region] : cc[region];
        return v != null ? v : fallback;
      };
      const col = function (s) {
        if (s == null || s === "keep") return null;
        if (typeof s === "number") return s;
        if (s[0] === "#") return parseInt(s.slice(1), 16);
        if (s === "L") return parts.legs ? pal.L : own("legs", pal.L);
        if (s === "A") return parts.arms || parts.sleeves ? pal.A : own("arms", pal.A);
        if ((s === "T" || s === "Tf") && !parts.torso) return own("torso", pal[s]);
        if (s === "J" && !parts.jacket) return col("T");
        if (s === "C") return cc.collar != null && cc.collar !== cc.torso ? cc.collar : 0x15171c;
        return pal[s] != null ? pal[s] : null;
      };
      return src.map(function (ly) {
        const z = ly.z || {};
        const mk = ly.marks ? (defer ? marksSoon(worn) : marksOf(worn)) : null;
        return {
          key: "cloth:" + ly.g, over: !!ly.over, under: !!ly.under, hide: ly.hide || null, conceal: !!ly.conceal, rough: ly.rough,
          zc: [col(z.main || "T"), col(z.legs || "L"), col(z.shirt), col(z.tie), null, null],
          sleeve: ly.sleeve ? col(ly.sleeve) : null,
          marks: mk || null, marksKey: mk === undefined ? worn.key : null, markRows: ly.marks || "",
          camo: ly.camo ? camoFrom(col(ly.camo === 1 ? "T" : ly.camo) || 0x4a5238) : null, fabric: !!ly.fabric,
        };
      });
    }
    // PRINTS and the plain path: the garment the structure asks for, its own
    // cut; a painted print projected on it, or flat colours read off the rig.
    // (A uniform whose picture could not be read wears the picture: never the
    // garment's raw texture, a cop in a denim-blue shirt.)
    const key = garmentFor(ch, cast, worn);
    if (worn && (PRINTS.test(id) || !spec || !pal)) {
      return [{ key: key, print: true, flat: flat, zc: [null, null, null, null, null, null] }];
    }
    return [{ key: key, zc: [hexOrNull(flat.torso), hexOrNull(flat.legs), null, null, null, null], sleeve: flat.arms != null && flat.arms !== flat.torso ? flat.arms : null, marks: null, markRows: "" }];
  }

  // ================================================================ assets (shared per asset)
  /* The atlas layout of city/clothes.js (128 x 256: rows torso / jacket / arm
     / leg; columns front / back / side / cap) and how its box body maps a
     face: u across the face as the box's own UV runs, row 0 at the top of the
     column (collarbone / shoulder / hip). A real garment is projected the
     same way, per TRIANGLE (a triangle on the front panel samples only the
     front column), splitting vertices where panels or rows change. */
  const AW = 128, AH = 256;
  const COLS = { front: [0, 64], back: [64, 96], side: [96, 112] };
  const ROWS = { torso: [0, 96], jacket: [96, 176], arm: [176, 216], leg: [216, 256] };
  const FACE = ["front", "back", "side", "side"];   // 0 front, 1 back, 2 +x side, 3 -x side
  const SHELL_V0 = 0.028, SHELL_VK = 0.951;

  function cubeMean(pos, list, out) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < list.length; i++) { const k = list[i] * 3; x += pos[k]; y += pos[k + 1]; z += pos[k + 2]; }
    const n = list.length || 1;
    out = out || new THREE.Vector3();
    return out.set(x / n, y / n, z / n);
  }
  function joints(pos) {
    const J = {};
    for (let i = 0; i < S.bones.length; i++) {
      const b = S.bones[i];
      J[b.name] = { head: b.head ? cubeMean(pos, b.head) : new THREE.Vector3(b.headDef[0], b.headDef[1], b.headDef[2]),
                    tail: b.tail ? cubeMean(pos, b.tail) : new THREE.Vector3(b.tailDef[0], b.tailDef[1], b.tailDef[2]) };
    }
    return J;
  }
  // MHCLO fit: every asset vertex = three body vertices + a scaled offset
  function fit(a, pos, out, tight) {
    const e = a.e, bv = a.bv, bw = a.bw, bo = a.bo, n = e.nVerts;
    const sc = [1, 1, 1];
    const ax = { x: 0, y: 1, z: 2 };
    for (const k in ax) {
      const s = e.scale && e.scale[k];
      if (s) { const i = ax[k]; sc[i] = Math.abs(pos[s[0] * 3 + i] - pos[s[1] * 3 + i]) / (s[2] * 0.1); }
    }
    // skin-tight: the garment's offsets off the body shrunk (an undershirt)
    if (tight) { sc[0] *= tight; sc[1] *= tight; sc[2] *= tight; }
    out = out || new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const i0 = bv[v * 3] * 3, i1 = bv[v * 3 + 1] * 3, i2 = bv[v * 3 + 2] * 3;
      const w0 = bw[v * 3], w1 = bw[v * 3 + 1], w2 = bw[v * 3 + 2];
      out[v * 3] = w0 * pos[i0] + w1 * pos[i1] + w2 * pos[i2] + bo[v * 3] * sc[0];
      out[v * 3 + 1] = w0 * pos[i0 + 1] + w1 * pos[i1 + 1] + w2 * pos[i2 + 1] + bo[v * 3 + 1] * sc[1];
      out[v * 3 + 2] = w0 * pos[i0 + 2] + w1 * pos[i1 + 2] + w2 * pos[i2 + 2] + bo[v * 3 + 2] * sc[2];
    }
    return out;
  }
  function assetShared(key) {
    let a = assetCache[key];
    if (a !== undefined) return a;
    const e = M.assets[key];
    if (!e) return (assetCache[key] = null);
    a = { key: key, e: e, bv: view(e.bv), bw: view(e.bw), bo: view(e.bo) };
    const n = e.nVerts;
    // skin weights per ORIGINAL vertex: the bound body vertices' weights mixed
    // by the binding (what MPFB does when it rigs a garment)
    const wi = new Uint16Array(n * 4), ww = new Uint8Array(n * 4), acc = new Float32Array(S.bones.length);
    const touched = [];
    for (let v = 0; v < n; v++) {
      touched.length = 0;
      for (let k = 0; k < 3; k++) {
        const b = a.bv[v * 3 + k], bw = Math.max(0, a.bw[v * 3 + k]);
        if (!bw) continue;
        for (let j = 0; j < 4; j++) {
          const w = S.sWt[b * 4 + j];
          if (!w) continue;
          const bi = S.sIdx[b * 4 + j];
          if (!acc[bi]) touched.push(bi);
          acc[bi] += bw * w;
        }
      }
      touched.sort(function (x, y) { return acc[y] - acc[x]; });
      let tot = 0;
      for (let j = 0; j < 4 && j < touched.length; j++) tot += acc[touched[j]];
      let left = 255;
      for (let j = 0; j < 4 && j < touched.length; j++) {
        const q = j === 3 || j === touched.length - 1 ? left : Math.round(255 * acc[touched[j]] / (tot || 1));
        wi[v * 4 + j] = touched[j]; ww[v * 4 + j] = Math.max(0, Math.min(left, q)); left -= ww[v * 4 + j];
      }
      if (!touched.length) { wi[v * 4] = S.bix.pelvis; ww[v * 4] = 255; }
      for (let j = 0; j < touched.length; j++) acc[touched[j]] = 0;
    }
    let map = view(e.map), uv = view(e.uv), index = view(e.index), atlasA = null, atlasB = null, zone = e.zone ? view(e.zone) : null;
    if (e.role === "cloth") {
      const r = atlasSplit(a, map, uv, index, zone);
      map = r.map; uv = r.uv; index = r.index; atlasA = r.A; atlasB = r.B; zone = r.Z;
    }
    a.map = map; a.nR = map.length;
    a.uv = new THREE.BufferAttribute(new Float32Array(uv), 2);
    if (atlasA) { a.atlasA = new THREE.BufferAttribute(atlasA, 2); a.atlasB = new THREE.BufferAttribute(atlasB, 2); }
    // each vertex's zone of the garment (main cloth / legs / shirt / tie /
    // trim / hidden): what the real wardrobe dyes it as
    if (e.role === "cloth") a.zone = new THREE.BufferAttribute(zone || new Uint8Array(map.length), 1);
    a.index = new THREE.BufferAttribute(index.length && map.length > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1);
    a.index._peopleShared = true;
    const sk = skinAttrs(map, function (r, j) { return wi[map[r] * 4 + j]; }, function (r, j) { return ww[map[r] * 4 + j]; });
    a.skinIndex = sk.i; a.skinWeight = sk.w;
    a.origTris = new Uint32Array(index.length);
    for (let i = 0; i < index.length; i++) a.origTris[i] = map[index[i]];
    a.del = e.del ? view(e.del) : null;
    // the face moves what is bound to it: expressions through the binding
    if (/^(brows|lashes|beard|teeth|tongue)$/.test(e.role)) {
      a.morph = EXPR.map(function (name) {
        const D = S.exprDense[name], o = new Float32Array(a.nR * 3);
        for (let r = 0; r < a.nR; r++) {
          const v = map[r];
          for (let k = 0; k < 3; k++) {
            const b = a.bv[v * 3 + k] * 3, w = a.bw[v * 3 + k];
            o[r * 3] += w * D[b]; o[r * 3 + 1] += w * D[b + 1]; o[r * 3 + 2] += w * D[b + 2];
          }
        }
        return new THREE.BufferAttribute(o, 3);
      });
    }
    return (assetCache[key] = a);
  }
  /* THE PROJECTION. Done once per garment, on MakeHuman's neutral body in
     its bind pose, because WHERE on a garment a vertex is (front panel of
     the left sleeve, 40 % down) does not change with who wears it. */
  function atlasSplit(a, map0, uv0, index0, zone0) {
    const e = a.e, pos = fit(a, S.base);
    const J = joints(S.base);
    const piece = view(e.piece), pieces = e.pieces || [];
    const hipY = (J.thigh_l.head.y + J.thigh_r.head.y) / 2, colY = (J.clavicle_l.head.y + J.clavicle_r.head.y) / 2 + 0.02;
    const cz = J.spine_02.head.z, hw = Math.abs(J.upperarm_l.head.x) * 0.92, hd = 0.11;
    const limb = {};
    [["l", 1], ["r", -1]].forEach(function (s) {
      const sh = J["upperarm_" + s[0]].head, wr = J["hand_" + s[0]].head, hp = J["thigh_" + s[0]].head, an = J["foot_" + s[0]].head;
      const qa = new THREE.Quaternion().setFromUnitVectors(wr.clone().sub(sh).normalize(), new THREE.Vector3(0, -1, 0));
      const ql = new THREE.Quaternion().setFromUnitVectors(an.clone().sub(hp).normalize(), new THREE.Vector3(0, -1, 0));
      limb["arm" + s[0]] = { o: sh, q: qa, len: sh.distanceTo(wr) };
      limb["leg" + s[0]] = { o: hp, q: ql, len: hp.distanceTo(an) };
    });
    const vg = new Float32Array(e.nVerts * 5);
    for (let v = 0; v < e.nVerts; v++) for (let k = 0; k < 3; k++) {
      const b = a.bv[v * 3 + k], w = Math.max(0, a.bw[v * 3 + k]);
      for (let g = 0; g < 5; g++) vg[v * 5 + g] += w * S.vgroup[b * 5 + g];
    }
    const tmp = new THREE.Vector3();
    // region 0 torso, 1 arm, 2 leg; returns [faceIdx, u, r]
    function project(region, x, y, z) {
      let X, Z, rr, side = x >= 0 ? "l" : "r";
      if (region === 0) {
        X = x / hw; Z = (z - cz) / hd;
        rr = 0.09 + 0.9 * (colY - y) / (colY - hipY);
      } else {
        const L = limb[(region === 1 ? "arm" : "leg") + side];
        tmp.set(x, y, z).sub(L.o).applyQuaternion(L.q);
        X = tmp.x; Z = tmp.z; rr = -tmp.y / L.len;
      }
      return [X, Z, rr];
    }
    function faceOf(X, Z) {
      if (Z >= Math.abs(X)) return 0;
      if (-Z >= Math.abs(X)) return 1;
      return X > 0 ? 2 : 3;
    }
    function uOf(f, X, Z) {
      const th = Math.atan2(X, Z), D = Math.PI / 2, Q = Math.PI / 4;
      let u;
      if (f === 0) u = (th + Q) / D;
      else if (f === 2) u = (th - Q) / D;
      else if (f === 3) u = (th + 3 * Q) / D;
      else { let t = th < 0 ? th + 2 * Math.PI : th; u = (t - 3 * Q) / D; }
      return Math.max(0.002, Math.min(0.998, u));
    }
    // a "mixed" piece (bound to both hips and legs) is a dress or overalls
    // only if it reaches the chest; otherwise it is trousers cut high
    const pieceTop = new Float32Array(pieces.length).fill(-1e9);
    for (let v = 0; v < e.nVerts; v++) { const pi = piece[v]; if (pos[v * 3 + 1] > pieceTop[pi]) pieceTop[pi] = pos[v * 3 + 1]; }
    const keyMap = new Map(), outMap = [], outUv = [], outZ = [], A = [], B = [], idx = [];
    const nT = index0.length / 3;
    for (let t = 0; t < nT; t++) {
      const r0 = index0[t * 3], r1 = index0[t * 3 + 1], r2 = index0[t * 3 + 2];
      const o0 = map0[r0], o1 = map0[r1], o2 = map0[r2];
      const pr = pieces[piece[o0]] || { region: "top" };
      let g0 = 0, g1 = 0, g2 = 0, cy = 0, cx = 0, czz = 0;
      for (const o of [o0, o1, o2]) {
        const s = vg[o * 5] + vg[o * 5 + 1] + vg[o * 5 + 2] + vg[o * 5 + 3] + vg[o * 5 + 4] || 1;
        g0 += vg[o * 5] / s; g1 += vg[o * 5 + 1] / s; g2 += (vg[o * 5 + 2] + vg[o * 5 + 3]) / s;
        cx += pos[o * 3]; cy += pos[o * 3 + 1]; czz += pos[o * 3 + 2];
      }
      g0 /= 3; g1 /= 3; g2 /= 3; cx /= 3; cy /= 3; czz /= 3;
      let region;
      // trousers / shorts / a skirt are the LEG row all the way up to the
      // waistband (the torso row there is the shirt's colour)
      const dressy = pr.region === "mixed" && pieceTop[piece[o0]] > hipY + 0.25;
      if (pr.region === "bottom" || (pr.region === "mixed" && !dressy)) region = 2;
      else if (dressy) region = cy < hipY + 0.04 ? 2 : (g1 > 0.45 ? 1 : 0);
      else region = g1 > 0.45 ? 1 : 0;
      const pc = project(region, cx, cy, czz), f = faceOf(pc[0], pc[1]);
      const code = region * 4 + f;
      for (const r of [r0, r1, r2]) {
        const k = r * 16 + code;
        let id = keyMap.get(k);
        if (id === undefined) {
          id = outMap.length; keyMap.set(k, id);
          const o = map0[r];
          outMap.push(o); outUv.push(uv0[r * 2], uv0[r * 2 + 1]); outZ.push(zone0 ? zone0[r] : 0);
          const p = project(region, pos[o * 3], pos[o * 3 + 1], pos[o * 3 + 2]);
          const u = uOf(f, p[0], p[1]);
          const row = region === 0 ? ROWS.torso : region === 1 ? ROWS.arm : ROWS.leg;
          const col = COLS[FACE[f]];
          const e2 = 2.5 / (row[1] - row[0]);
          const rr = Math.max(e2, Math.min(1 - e2, p[2]));
          const xp = col[0] + u * (col[1] - col[0]);
          A.push(xp / AW, 1 - (row[0] + rr * (row[1] - row[0])) / AH);
          if (region === 0) {
            const rj = Math.max(0.03, Math.min(0.97, SHELL_V0 + SHELL_VK * rr));
            B.push(xp / AW, 1 - (ROWS.jacket[0] + rj * (ROWS.jacket[1] - ROWS.jacket[0])) / AH);
          } else B.push(A[A.length - 2], A[A.length - 1]);
        }
        idx.push(id);
      }
    }
    return { map: Uint32Array.from(outMap), uv: Float32Array.from(outUv), A: Float32Array.from(A), B: Float32Array.from(B), index: idx, Z: Uint8Array.from(outZ) };
  }

  // ================================================================ normals
  function normalsOrig(pos, tris, n) {
    const N = new Float32Array(n * 3);
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    for (let i = 0; i < n; i++) {
      const k = i * 3, l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1;
      N[k] /= l; N[k + 1] /= l; N[k + 2] /= l;
    }
    return N;
  }
  function gather(src, map) {
    const o = new Float32Array(map.length * 3);
    for (let r = 0; r < map.length; r++) { const k = map[r] * 3; o[r * 3] = src[k]; o[r * 3 + 1] = src[k + 1]; o[r * 3 + 2] = src[k + 2]; }
    return o;
  }

  // ================================================================ materials
  /* Every material here is PBR: it joins the game's shared environment and
     tier management (core/gfx.js: the sky-following IBL, the low tiers'
     env-off) at the world's own intensity, so a real body is lit exactly
     like the street it stands in. */
  function pbr(m) {
    m.envMapIntensity = 0.5;
    if (typeof CBZ.gfxRegisterPbr === "function") CBZ.gfxRegisterPbr(m);
    return m;
  }
  const LPF = (function () {
    const src = THREE.ShaderChunk.lights_physical_pars_fragment;
    const line = "reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );";
    if (src.indexOf(line) < 0) return null;
    // SKIN SCATTERS. Light reaches past the terminator, red furthest (the
    // classic wrap approximation of subsurface scattering): the hard plastic
    // shadow line on a face becomes the soft warm falloff of real skin.
    return src.replace(line,
      "#ifdef PEOPLE_WRAP\n" +
      "\tvec3 wrapIrr = clamp( ( vec3( dot( geometry.normal, directLight.direction ) ) + PEOPLE_WRAP ) / ( 1.0 + PEOPLE_WRAP ), 0.0, 1.0 ) * directLight.color;\n" +
      "\t#ifndef PHYSICALLY_CORRECT_LIGHTS\n\t\twrapIrr *= PI;\n\t#endif\n" +
      "\treflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * wrapIrr * BRDF_Diffuse_Lambert( material.diffuseColor );\n" +
      "#else\n\t" + line + "\n#endif");
  })();
  const WOUND_PARS = [
    "uniform vec4 pWound[ " + NW + " ];",      // xyz bind position, w radius
    "uniform vec4 pWoundN[ " + NW + " ];",     // xyz bind normal, w kind (0 hole, 1 cut, 2 burn, 3 stump)
    "uniform vec4 pWoundT[ " + NW + " ];",     // x wet 0..1, y run length (m), z seed, w soak (cloth)
    "varying vec3 vBind;", "varying vec3 vBindN;",
  ].join("\n");
  // blood / hole / char at this bind-space point; out: vec3(blood, hole, burn)
  const WOUND_FN = [
    "vec3 peopleWounds( vec3 p, vec3 n, float soak ) {",
    "\tvec3 o = vec3( 0.0 );",
    "\tfor ( int i = 0; i < " + NW + "; i ++ ) {",
    "\t\tvec4 w = pWound[ i ];",
    "\t\tif ( w.w <= 0.0 ) continue;",
    "\t\tvec4 wn = pWoundN[ i ]; vec4 wt = pWoundT[ i ];",
    "\t\tvec3 d = p - w.xyz;",
    "\t\tfloat facing = smoothstep( -0.1, 0.35, dot( n, wn.xyz ) );",
    "\t\tfloat r = length( d );",
    "\t\tfloat ang = atan( d.y, d.x + d.z );",
    "\t\tfloat rag = 0.86 + 0.08 * sin( ang * 3.0 + wt.z * 31.0 ) + 0.06 * sin( ang * 5.0 + wt.z * 7.0 ) + 0.03 * sin( ang * 11.0 + wt.z * 3.0 );",
    "\t\tfloat R = w.w * ( 1.0 + soak * 1.6 );",
    "\t\tfloat stain = ( 1.0 - smoothstep( R * 0.35 * rag, R * rag, r ) ) * facing;",
    "\t\tstain *= 0.75 + 0.25 * ( 1.0 - smoothstep( 0.0, R * 0.5, r ) );",
    "\t\tfloat hole = wn.w > 2.5 ? 0.0 : ( 1.0 - smoothstep( w.w * 0.16, w.w * 0.3, r ) ) * facing;",
    "\t\tif ( wn.w > 0.5 && wn.w < 1.5 ) { float cut = 1.0 - smoothstep( 0.0025, 0.006, abs( dot( d, normalize( cross( wn.xyz, vec3( 0.0, 1.0, 0.0 ) ) + vec3( 1e-4 ) ) ) ) ); hole = max( hole * 0.3, cut * ( 1.0 - smoothstep( w.w * 1.2, w.w * 1.6, r ) ) * facing ); }",
    "\t\t// the run: blood leaves the wound and runs DOWN the body (bind -y), a",
    "\t\t// tapering rivulet that wanders a little",
    "\t\tfloat below = -d.y;",
    "\t\tfloat run = 0.0;",
    "\t\tif ( below > 0.0 && below < wt.y ) {",
    "\t\t\tfloat k = below / wt.y;",
    "\t\t\tfloat lat = length( vec2( d.x + 0.006 * sin( below * 70.0 + wt.z * 13.0 ), d.z ) - wn.xz * dot( d.xz, wn.xz ) );",
    "\t\t\tfloat wdt = w.w * ( 0.32 - 0.22 * k ) * ( 1.0 + soak );",
    "\t\t\trun = ( 1.0 - smoothstep( wdt * 0.5, wdt, lat ) ) * ( 1.0 - k * k ) * facing * step( abs( dot( d, wn.xyz ) ), w.w * 1.2 );",
    "\t\t}",
    "\t\tif ( wn.w > 1.5 && wn.w < 2.5 ) { o.z = max( o.z, stain ); }",
    "\t\telse { o.x = max( o.x, max( stain, run ) * wt.x ); o.y = max( o.y, hole ); }",
    "\t}",
    "\treturn o;",
    "}",
  ].join("\n");
  const WOUND_APPLY = [
    "{",
    "\tvec3 wb = peopleWounds( vBind, normalize( vBindN ), PEOPLE_SOAK );",
    "\tvec3 bloodWet = vec3( 0.30, 0.012, 0.012 ), bloodDry = vec3( 0.16, 0.02, 0.018 );",
    "\tdiffuseColor.rgb = mix( diffuseColor.rgb, mix( bloodDry, bloodWet, 0.65 ), clamp( wb.x, 0.0, 1.0 ) * 0.92 );",
    "\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.006, 0.006 ), clamp( wb.y, 0.0, 1.0 ) );",
    "\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.03, 0.022 ), clamp( wb.z, 0.0, 1.0 ) * 0.9 );",
    "\tpeopleWet = clamp( wb.x + wb.y, 0.0, 1.0 );",
    "}",
  ].join("\n");
  function woundUniforms() {
    const mk = function () { const a = []; for (let i = 0; i < NW; i++) a.push(new THREE.Vector4(0, 0, 0, 0)); return a; };
    return { pWound: { value: mk() }, pWoundN: { value: mk() }, pWoundT: { value: mk() } };
  }
  function patchVertexBind(vs) {
    return vs.replace("#include <common>", "#include <common>\nvarying vec3 vBind;\nvarying vec3 vBindN;")
      .replace("#include <skinning_vertex>", "vBind = transformed; vBindN = objectNormal;\n#include <skinning_vertex>");
  }
  function patchRough(fs) {
    return fs.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 0.18, peopleWet );");
  }
  function skinMaterial(P) {
    const U = Object.assign(woundUniforms(), {
      pTone: { value: new THREE.Vector3(1, 1, 1) }, pHair: { value: new THREE.Vector3(0.1, 0.08, 0.06) },
      pStub: { value: new THREE.Vector4(0, 0, 0, 0) }, pMask: { value: tex(M.masks) }, pScalp: { value: tex(M.scalpMask) },
    });
    const m = new THREE.MeshStandardMaterial({ map: P.skinTex, normalMap: P.reliefTex, roughness: 0.56, metalness: 0, skinning: true, morphTargets: true });
    m.normalScale.set(0.55, 0.55);
    m.userData.u = U;
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.defines = Object.assign(sh.defines || {}, { PEOPLE_WRAP: "vec3( 0.48, 0.24, 0.15 )", PEOPLE_SOAK: "0.0" });
      sh.vertexShader = patchVertexBind(sh.vertexShader);
      let fs = sh.fragmentShader;
      if (LPF) fs = fs.replace("#include <lights_physical_pars_fragment>", LPF);
      fs = fs.replace("#include <common>", "#include <common>\nuniform vec3 pTone;\nuniform vec3 pHair;\nuniform vec4 pStub;\nuniform sampler2D pMask;\nuniform sampler2D pScalp;\n" + WOUND_PARS + "\n" + WOUND_FN + "\nfloat peopleWet = 0.0;")
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "diffuseColor.rgb *= pTone;",
          // a decoded photo is more saturated than the game's palette around
          // it; a touch of grey keeps warm mid-tones skin and not leather
          "diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.85 );",
          // STUBBLE AND A SHAVED SCALP: hair that is cut to the skin is a fine
          // dark grain in the hair's colour over the beard / scalp masks; up
          // close it is follicles, at a distance their average (no shimmer)
          "{",
          "\tvec4 fm = texture2D( pMask, vUv );",
          "\tfloat cover = max( max( fm.r * pStub.x, fm.g * pStub.y ), max( fm.b * pStub.z, texture2D( pScalp, vUv ).r * pStub.w ) );",
          "\tif ( cover > 0.001 ) {",
          "\t\tvec2 q = vUv * 6000.0;",
          "\t\tfloat n = fract( sin( dot( floor( q ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );",
          "\t\tfloat dotm = smoothstep( 0.42, 0.18, length( fract( q ) - 0.5 + ( n - 0.5 ) * 0.3 ) ) * step( 0.35, n );",
          "\t\tfloat fw = clamp( 1.5 - 6000.0 * max( fwidth( vUv.x ), fwidth( vUv.y ) ), 0.0, 1.0 );",
          "\t\tfloat grain = mix( 0.55, 0.3 + 0.7 * dotm, fw );",
          "\t\tvec3 hairTone = pHair * 0.9 + 0.02;",
          "\t\tdiffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35 + hairTone * 0.65, clamp( cover * grain, 0.0, 1.0 ) * 0.9 );",
          "\t}",
          "}",
          WOUND_APPLY,
        ].join("\n"));
      sh.fragmentShader = patchRough(fs);
    };
    m.customProgramCacheKey = function () { return "people-skin-1"; };
    return pbr(m);
  }
  /* THE CLOTH.
     REAL (the wardrobe's garments): the garment's own texture, every zone
     dyed by its own light and dark (each texel against its zone's mean
     luminance: the weave, the folds, a tie's stripes or paisley come through
     in any colour; DETAIL from the pack says how much), the trim (buttons,
     buckles) in its own colours, the painter's MARKINGS laid on through the
     body projection, a camouflage printed in bind space so it rides the body
     across every seam.
     PRINT (a printed dress, gingham, a kid's tee): the painter's picture is
     the fabric, projected panel by panel the way the boxy body maps it, over
     the garment's own AO and weave. */
  const CAMO_FN = [
    "float pcHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }",
    "float pcNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );",
    "\treturn mix( mix( mix( pcHash( i ), pcHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( pcHash( i + vec3( 0.0, 1.0, 0.0 ) ), pcHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),",
    "\t\tmix( mix( pcHash( i + vec3( 0.0, 0.0, 1.0 ) ), pcHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( pcHash( i + vec3( 0.0, 1.0, 1.0 ) ), pcHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z ); }",
    // woodland: three overlapping fields of blobs (~12 cm, a little taller
    // than wide), each with a finer octave to fray its edge
    "vec3 peopleCamo( vec3 p ) {",
    "\tvec3 q = p * vec3( 8.0, 5.5, 8.0 );",
    "\tfloat a = pcNoise( q ) * 0.72 + pcNoise( q * 2.9 + 3.1 ) * 0.28;",
    "\tfloat b = pcNoise( q + vec3( 11.7, 3.3, 5.1 ) ) * 0.72 + pcNoise( q * 3.1 + 7.3 ) * 0.28;",
    "\tfloat c = pcNoise( q * 1.4 + vec3( 23.1, 9.2, 1.7 ) ) * 0.72 + pcNoise( q * 3.4 + 1.7 ) * 0.28;",
    "\tvec3 col = pCamo[ 0 ];",
    "\tif ( a > 0.55 ) col = pCamo[ 1 ];",
    "\tif ( b > 0.6 ) col = pCamo[ 2 ];",
    "\tif ( c > 0.66 ) col = pCamo[ 3 ];",
    "\treturn col;",
    "}",
  ].join("\n");
  function hexVec(h) { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); }
  function clothMaterial(P, a, L) {
    const e = a.e, Z = e.zones || [], print = !!L.print;
    let mapTex = print ? (L.tex || null) : tex(e.mat && e.mat.map);
    const zc = [], zp = [];
    let ref01 = null, keep01 = false;
    // a suit wears the nearest of its real cloths; near enough, as it is
    if (!print && L.fabric && e.mat && e.mat.fabrics && L.zc[0] != null) {
      const t = new THREE.Color(L.zc[0]);
      let best = null, bd = 1e9;
      for (const f of e.mat.fabrics) {
        const dd = Math.abs(f.main[0] - t.r) + Math.abs(f.main[1] - t.g) + Math.abs(f.main[2] - t.b);
        if (dd < bd) { bd = dd; best = f; }
      }
      if (best) {
        mapTex = tex(best.map);
        ref01 = 0.2126 * best.main[0] + 0.7152 * best.main[1] + 0.0722 * best.main[2];
        keep01 = bd < 0.09;
        P.fabric = best.name;
      }
    }
    for (let z = 0; z < 6; z++) {
      const h = L.zc ? L.zc[z] : null, Zs = Z[z] || { ref: 0.5, k: 0.6 };
      zc.push(hexVec(h != null ? h : 0x808080));
      let ref = Zs.ref || 0.5, keep = h == null || z === 4;
      if (ref01 != null && z <= 1) { ref = ref01; if (keep01) keep = true; }
      zp.push(new THREE.Vector4(Zs.k != null ? Zs.k : 0.6, ref, keep ? 1 : 0, z === 5 ? 1 : 0));
    }
    const fl = L.flat || {};
    const fv = function (h) { const c = new THREE.Color(h != null ? h : 0); return new THREE.Vector4(c.r, c.g, c.b, h != null ? 1 : 0); };
    const rows = L.markRows || "";
    const camo = L.camo || null;
    const U = Object.assign(woundUniforms(), {
      pShade: { value: tex(e.mat && e.mat.shade) },
      pZC: { value: zc }, pZP: { value: zp },
      pSleeve: { value: L.sleeve != null ? (function () { const c = new THREE.Color(L.sleeve); return new THREE.Vector4(c.r, c.g, c.b, 1); })() : new THREE.Vector4(0, 0, 0, 0) },
      pMarks: { value: L.marks || _noMarks }, pMarkRows: { value: new THREE.Vector3(rows.indexOf("T") >= 0 ? 1 : 0, rows.indexOf("A") >= 0 ? 1 : 0, rows.indexOf("L") >= 0 ? 1 : 0) },
      pCamo: { value: (camo || [0, 0, 0, 0]).map(hexVec) }, pCamoOn: { value: camo ? 1 : 0 },
      // print mode
      pJacket: { value: L.jacket ? 1 : 0 }, pFill: { value: new THREE.Color(L.bodyHex != null ? L.bodyHex : 0x555555) },
      pFlatT: { value: fv(fl.torso) }, pFlatA: { value: fv(fl.arms) }, pFlatL: { value: fv(fl.legs) },
    });
    const m = new THREE.MeshStandardMaterial({ map: mapTex, color: 0xffffff, normalMap: tex(e.mat && e.mat.normalMap),
      roughness: L.rough || 0.88, metalness: 0, skinning: true });
    m.normalScale.set(0.9, 0.9);
    m.userData.u = U;
    m.userData.cloth = { print: print, zc: zc, zp: zp };
    if (L.marksKey && marksWait.has(L.marksKey)) marksWait.get(L.marksKey).push(m);
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.defines = Object.assign(sh.defines || {}, { PEOPLE_SOAK: "1.0" });
      if (print) sh.defines.PEOPLE_PRINT = "1";
      sh.vertexShader = patchVertexBind(sh.vertexShader)
        .replace("#include <common>", "#include <common>\nattribute vec2 atlasA;\nattribute vec2 atlasB;\nattribute float zone;\nuniform vec3 pZC[ 6 ];\nuniform vec4 pZP[ 6 ];\n" +
          "varying vec2 vAtA;\nvarying vec2 vAtB;\nvarying vec3 vZC;\nvarying vec4 vZP;\nvarying float vZone;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvAtA = atlasA; vAtB = atlasB;\n{ int zi = int( clamp( zone, 0.0, 5.0 ) + 0.5 ); vZC = pZC[ zi ]; vZP = pZP[ zi ]; vZone = zone; }");
      let fs = sh.fragmentShader;
      fs = fs.replace("#include <common>", "#include <common>\nuniform sampler2D pShade;\nuniform vec4 pSleeve;\nuniform sampler2D pMarks;\nuniform vec3 pMarkRows;\nuniform vec3 pCamo[ 4 ];\nuniform float pCamoOn;\n" +
          "uniform float pJacket;\nuniform vec3 pFill;\nuniform vec4 pFlatT;\nuniform vec4 pFlatA;\nuniform vec4 pFlatL;\n" +
          "varying vec2 vAtA;\nvarying vec2 vAtB;\nvarying vec3 vZC;\nvarying vec4 vZP;\nvarying float vZone;\n" + WOUND_PARS + "\n" + WOUND_FN + "\n" + CAMO_FN + "\nfloat peopleWet = 0.0;")
        .replace("#include <map_fragment>", [
          "\tif ( vZP.w > 0.5 ) discard;",
          "\tfloat sh = texture2D( pShade, vUv ).r * 2.0;",
          "#ifdef PEOPLE_PRINT",
          // the atlas row says which region this is: torso / arm / leg
          "\tvec4 flatC = vAtA.y > 0.6 ? pFlatT : ( vAtA.y > 0.15 ? pFlatA : pFlatL );",
          "\tvec3 clothC = pFill;",
          "#ifdef USE_MAP",
          // a tailored print: the jacket row first (its V shows the shirt row)
          "\tvec4 texelColor = texture2D( map, pJacket > 0.5 ? vAtB : vAtA );",
          "\tif ( pJacket > 0.5 && texelColor.a < 0.5 ) texelColor = texture2D( map, vAtA );",
          "\tif ( texelColor.a < 0.5 ) texelColor = vec4( pFill, 1.0 );",
          "\tclothC = mapTexelToLinear( texelColor ).rgb;",
          "#endif",
          "\tif ( flatC.a > 0.5 ) clothC = flatC.rgb;",
          "\tdiffuseColor.rgb *= clothC * sh;",
          "#else",
          "#ifdef USE_MAP",
          "\tvec3 alb = texture2D( map, vUv ).rgb;",
          "#else",
          "\tvec3 alb = vec3( vZP.y );",
          "#endif",
          "\tfloat ratio = clamp( dot( alb, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( vZP.y, 0.02 ), 0.12, 2.8 );",
          "\tvec3 col = vZC;",
          "\tfloat isMain = 1.0 - step( 0.5, vZone );",
          "\tfloat rowA = step( 0.156, vAtA.y ) * step( vAtA.y, 0.3125 );",
          "\tcol = mix( col, pSleeve.rgb, pSleeve.a * isMain * rowA );",
          "\tif ( pCamoOn > 0.5 && vZone < 1.5 ) col = peopleCamo( vBind );",
          "\tvec3 cloth = vZP.z > 0.5 ? alb : col * mix( sh, ratio, vZP.x );",
          // the painter's markings, on the main cloth and the trousers only
          "\tfloat rowT = step( 0.625, vAtA.y ), rowL = 1.0 - step( 0.156, vAtA.y );",
          "\tvec4 mk = texture2D( pMarks, vAtA );",
          "\tfloat gate = dot( vec3( rowT, rowA, rowL ), pMarkRows ) * ( 1.0 - step( 1.5, vZone ) );",
          "\tcloth = mix( cloth, mk.rgb * mix( sh, 1.0, 0.35 ), clamp( mk.a * gate, 0.0, 1.0 ) );",
          "\tdiffuseColor.rgb *= cloth;",
          "#endif",
          WOUND_APPLY,
        ].join("\n"));
      sh.fragmentShader = patchRough(fs);
    };
    m.customProgramCacheKey = function () { return print ? "people-cloth-print-2" : "people-cloth-real-2"; };
    return pbr(m);
  }
  // EYES: the painted iris is far too saturated taken as stored (the game's
  // convention, which the sclera needs to sit beside the skin) and the white
  // goes grey taken as sRGB: a 1.6 curve between the two gives a white white
  // and a dark, real iris. Wet: a hard specular.
  // THE IRIS IS RECOLOURED, not swapped: one detailed iris (fibres, limbal
  // ring, crypts) takes any colour by its own intensity; the white and the
  // pupil (unsaturated) are left alone.
  function eyeMaterial(map, iris) {
    const U = { pIris: { value: new THREE.Vector4(iris ? iris[0] : 0, iris ? iris[1] : 0, iris ? iris[2] : 0, iris ? 1 : 0) } };
    const m = new THREE.MeshStandardMaterial({ map: map, roughness: 0.07, metalness: 0, alphaTest: 0.5, skinning: true });
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 pIris;")
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "\tvec3 ec = max( diffuseColor.rgb, vec3( 0.0 ) );",
          "\tif ( pIris.a > 0.5 ) {",
          "\t\tfloat mxc = max( ec.r, max( ec.g, ec.b ) ), mnc = min( ec.r, min( ec.g, ec.b ) );",
          "\t\tfloat sat = ( mxc - mnc ) / max( mxc, 1e-3 );",
          "\t\tfloat irisM = smoothstep( 0.22, 0.42, sat );",
          "\t\tec = mix( ec, pIris.rgb * ( 0.25 + 1.5 * mxc ), irisM );",
          "\t}",
          "\tdiffuseColor.rgb = pow( ec, vec3( 1.6 ) ) * 1.12;",
        ].join("\n"));
    };
    m.customProgramCacheKey = function () { return "people-eye-2"; };
    return pbr(m);
  }
  // SHOES wear the outfit's shoe colour (outfits.js / footwear.js): the real
  // shoe's leather, laces, stitching and sole as luminance, re-coloured;
  // white soles stay pale
  function shoeMaterial(map, hex, mean) {
    const c = new THREE.Color(hex != null ? hex : 0x2b2b2b);
    const ml = mean ? 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2] : 0.5;
    const U = { pShoe: { value: new THREE.Vector4(c.r, c.g, c.b, 1 / Math.max(0.05, ml)) } };
    const m = new THREE.MeshStandardMaterial({ map: map, roughness: 0.5, metalness: 0, skinning: true });
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 pShoe;")
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "\tfloat sl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );",
          "\tvec3 dyed = pShoe.rgb * clamp( sl * pShoe.a, 0.0, 2.2 );",
          "\tdiffuseColor.rgb = mix( dyed, vec3( sl * 1.1 ), smoothstep( 0.72, 0.9, sl ) * 0.8 );",
        ].join("\n"));
    };
    m.customProgramCacheKey = function () { return "people-shoe-1"; };
    return pbr(m);
  }
  function plainMaterial(opts, wounds) {
    const m = new THREE.MeshStandardMaterial(opts);
    if (!wounds) return pbr(m);
    const U = woundUniforms();
    m.userData.u = U;
    m.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.defines = Object.assign(sh.defines || {}, { PEOPLE_SOAK: "0.6" });
      sh.vertexShader = patchVertexBind(sh.vertexShader);
      sh.fragmentShader = patchRough(sh.fragmentShader.replace("#include <common>", "#include <common>\n" + WOUND_PARS + "\n" + WOUND_FN + "\nfloat peopleWet = 0.0;")
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + WOUND_APPLY));
    };
    m.customProgramCacheKey = function () { return "people-plain-w1"; };
    return pbr(m);
  }
  // HAIR: two passes over the same cards. The solid pass (alpha-tested,
  // writes depth) is the body of the hair; the soft pass draws only the
  // translucent strand ends, blended, over it — fine edges with no sorting.
  function hairMaterials(texName, color, opts) {
    const t = tex(texName);
    const base = Object.assign({ map: t, color: color, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, skinning: true }, opts || {});
    const solid = new THREE.MeshStandardMaterial(Object.assign({}, base, { alphaTest: 0.5 }));
    const soft = new THREE.MeshStandardMaterial(Object.assign({}, base, { transparent: true, depthWrite: false }));
    soft.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <alphatest_fragment>", "if ( diffuseColor.a >= 0.5 || diffuseColor.a < 0.03 ) discard;");
    };
    soft.customProgramCacheKey = function () { return "people-hair-soft"; };
    return [pbr(solid), pbr(soft)];
  }

  // ================================================================ the proc rig, measured
  const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _s = new THREE.Vector3();
  const _gInv = new THREE.Matrix4();
  // local (rig group) matrix of a node: group^-1 * node.matrixWorld
  function localOf(node, gInv, out) { return out.multiplyMatrices(gInv, node.matrixWorld); }
  function procNodes(ch) {
    const p = ch.parts || {}, lo = ch.low || {};
    const capL = p.la && p.la.userData && p.la.userData.cap, capR = p.ra && p.ra.userData && p.ra.userData.cap;
    // which leg / arm is on +x: measured, never assumed
    return { body: ch.body, neck: ch.neck, head: ch.head, la: p.la, ra: p.ra, ll: p.ll, rl: p.rl,
      lowla: lo.la, lowra: lo.ra, lowll: lo.ll, lowrl: lo.rl, capla: capL, capra: capR,
      footll: ch.feet && ch.feet.ll, footrl: ch.feet && ch.feet.rl, model: ch.model };
  }
  // the relaxed hand's placement in its elbow frame (character.js placeBodyHand)
  function relaxedHandQ(side, out) {
    const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(0, 1, 0);
    if (side > 0) { bx.set(0, 0, -1); by.set(-1, 0, 0); } else { bx.set(0, 0, 1); by.set(1, 0, 0); }
    _m4.makeBasis(bx, by, bz);
    out.setFromRotationMatrix(_m4);
    out.premultiply(_q2.setFromAxisAngle(bz, side > 0 ? 0.30 : -0.30));
    return out;
  }

  // ================================================================ build a person
  const BONE_SRC = {
    // bone -> [proc node key, how its rest is aligned]
    pelvis: "body", spine_01: "body", spine_02: "body", spine_03: "body", clavicle_l: "body", clavicle_r: "body",
    neck_01: "neck", head: "head",
  };
  function build(ch, look, opts) {
    const cast = castPerson(ch, look);
    const pos0 = shapeOf(cast.macro, cast.detail);
    const J0 = joints(pos0);
    // ---- measure the proc rig at its zero pose (group-local)
    const g = ch.group, N = procNodes(ch);
    if (!N.body || !N.la || !N.ra || !N.ll || !N.rl || !N.lowla || !N.lowll || !N.footll || !N.footrl) return null;
    const saved = [];
    for (const k in N) { const n = N[k]; if (n && k !== "model" && k.slice(0, 3) !== "cap") { saved.push([n, n.quaternion.clone()]); n.quaternion.identity(); } }
    const capSaved = [];
    for (const k of ["capla", "capra"]) { const n = N[k]; if (n) { capSaved.push([n, n.quaternion.clone()]); relaxedHandQ(k === "capla" ? -1 : 1, n.quaternion); } }
    g.updateMatrixWorld(true);
    _gInv.copy(g.matrixWorld).invert();
    const rest = {};
    for (const k in N) {
      const n = N[k];
      if (!n) continue;
      const L = localOf(n, _gInv, new THREE.Matrix4());
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      L.decompose(p, q, s);
      rest[k] = { L: L, p: p, q: q };
    }
    for (const sv of saved) sv[0].quaternion.copy(sv[1]);
    for (const sv of capSaved) sv[0].quaternion.copy(sv[1]);
    g.updateMatrixWorld(true);
    // sides: MakeHuman _l is +x
    const legL = rest.ll.p.x > rest.rl.p.x ? "ll" : "rl", legR = legL === "ll" ? "rl" : "ll";
    const armL = rest.la.p.x > rest.ra.p.x ? "la" : "ra", armR = armL === "la" ? "ra" : "la";
    // ---- place and scale the person on the rig. THE SAME HEIGHT, REAL
    // PROPORTIONS: the proc body is stylised (hip at 45 % of stature, a real
    // one at 53 %), so the person matches the rig's STATURE (top of the head)
    // and keeps their own legs; the pelvis rides above the proc hips (and
    // comes down to them as the hips flex: a seat is sat on) and IK puts
    // feet and hands where the rig's are.
    const mhHip = J0.thigh_l.head.clone().add(J0.thigh_r.head).multiplyScalar(0.5);
    const ground = J0.Root.head.y;
    const procHip = rest[legL].p.clone().add(rest[legR].p).multiplyScalar(0.5);
    let procTop = 0;
    const headMesh = ch.skinSlots && ch.skinSlots.head && ch.skinSlots.head[0];
    if (headMesh && headMesh.geometry) {
      for (const sv of saved) sv[0].quaternion.identity();
      g.updateMatrixWorld(true);
      if (!headMesh.geometry.boundingBox) headMesh.geometry.computeBoundingBox();
      const bb = headMesh.geometry.boundingBox.clone().applyMatrix4(_m4.multiplyMatrices(_gInv, headMesh.matrixWorld));
      procTop = bb.max.y;
      ch._peopleHeadBox = bb;
      // the brow line: a hat's band sits a fixed way above it on any head
      const brow = ch.face && ch.face.brow;
      if (brow) ch._peopleBrowY = _v.setFromMatrixPosition(_m4.multiplyMatrices(_gInv, brow.matrixWorld)).y;
      for (const sv of saved) sv[0].quaternion.copy(sv[1]);
      g.updateMatrixWorld(true);
    }
    let mhTop = -1e9;
    for (let r = 0; r < S.bodyMap.length; r++) { const y = pos0[S.bodyMap[r] * 3 + 1]; if (y > mhTop) mhTop = y; }
    mhTop -= ground;
    const sc = procTop > 0.5 ? procTop / Math.max(0.5, mhTop) : procHip.y / Math.max(0.3, mhHip.y - ground);
    const pos = new Float32Array(pos0.length);
    for (let i = 0; i < pos0.length; i += 3) {
      pos[i] = (pos0[i] - mhHip.x) * sc + procHip.x;
      pos[i + 1] = (pos0[i + 1] - ground) * sc;
      pos[i + 2] = (pos0[i + 2] - mhHip.z) * sc + procHip.z;
    }
    const J = joints(pos);
    const P = { ch: ch, look: look, cast: cast, scale: sc, meshes: [], mats: [], wounds: [], severed: {}, expr: new Float32Array(EXPR.length),
      sides: { legL: legL, legR: legR, armL: armL, armR: armR }, J: J, rest: rest, nodes: N };
    // ---- skeleton: bind = translation only (each bone's frame is the rig
    // group's axes at its joint), so a bone's world rotation IS its delta
    const bones = [], inv = [];
    for (let i = 0; i < S.bones.length; i++) {
      const b = new THREE.Bone();
      b.name = S.bones[i].name;
      b.matrixAutoUpdate = false;
      bones.push(b);
      inv.push(new THREE.Matrix4().makeTranslation(-J[b.name].head.x, -J[b.name].head.y, -J[b.name].head.z));
    }
    P.bones = bones;
    P.skeleton = new THREE.Skeleton(bones, inv);
    // rest alignment: MakeHuman binds in an A-pose; the proc rig's zero pose
    // hangs the arms. A_b turns each bone's bind direction onto its proc
    // segment's zero-pose direction (minimal arc: no twist).
    const A = {};
    const dirOf = function (a, b) { return b.clone().sub(a).normalize(); };
    const alignArm = function (s, side) {
      const arm = side === "l" ? armL : armR;
      const sh = rest[arm].p, el = rest["low" + arm].p, wr = rest["cap" + arm] ? rest["cap" + arm].p : el;
      // a real arm hangs a few degrees out from the body and the elbow a
      // touch bent; the proc zero pose hangs it plumb
      const out = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s === "l" ? 0.1 : -0.1);
      const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.12);
      const du = dirOf(sh, el).applyQuaternion(out), dl = dirOf(el, wr).applyQuaternion(out).applyQuaternion(bend);
      A["upperarm_" + s] = new THREE.Quaternion().setFromUnitVectors(dirOf(J["upperarm_" + s].head, J["lowerarm_" + s].head), du);
      A["lowerarm_" + s] = new THREE.Quaternion().setFromUnitVectors(dirOf(J["lowerarm_" + s].head, J["hand_" + s].head), dl);
      A["hand_" + s] = A["lowerarm_" + s].clone();
    };
    const alignLeg = function (s, side) {
      const leg = side === "l" ? legL : legR;
      const hp = rest[leg].p, kn = rest["low" + leg].p, an = rest["foot" + leg].p;
      A["thigh_" + s] = new THREE.Quaternion().setFromUnitVectors(dirOf(J["thigh_" + s].head, J["calf_" + s].head), dirOf(hp, kn));
      A["calf_" + s] = new THREE.Quaternion().setFromUnitVectors(dirOf(J["calf_" + s].head, J["foot_" + s].head), dirOf(kn, an));
      A["foot_" + s] = new THREE.Quaternion();
    };
    alignArm("l", "l"); alignArm("r", "r"); alignLeg("l", "l"); alignLeg("r", "r");
    P.A = A;
    // bone -> its proc node key
    const src = Object.assign({}, BONE_SRC, {
      upperarm_l: armL, lowerarm_l: "low" + armL, hand_l: "cap" + armL,
      upperarm_r: armR, lowerarm_r: "low" + armR, hand_r: "cap" + armR,
      thigh_l: legL, calf_l: "low" + legL, foot_l: "foot" + legL, ball_l: "foot" + legL,
      thigh_r: legR, calf_r: "low" + legR, foot_r: "foot" + legR, ball_r: "foot" + legR,
    });
    P.src = src;
    // IK end effectors, rigid on the proc hand / foot: where this person's
    // wrist / ankle sits relative to them at rest
    P.eff = {};
    for (const s of ["l", "r"]) {
      const arm = s === "l" ? armL : armR, leg = s === "l" ? legL : legR;
      const capK = rest["cap" + arm] ? "cap" + arm : "low" + arm;
      // the hand's rest pose carries the A alignment: the wrist rotates with the arm
      const wr = restPoint(P, "hand_" + s), an = restPoint(P, "foot_" + s);
      P.eff["hand_" + s] = { node: capK, local: wr.applyMatrix4(_m4b.copy(rest[capK].L).invert()), side: s };
      P.eff["foot_" + s] = { node: "foot" + leg, local: an.applyMatrix4(_m4b.copy(rest["foot" + leg].L).invert()) };
    }
    // pelvis rides the proc body node, this much above the proc hips (what
    // a flexed hip gives back: see drive)
    const pelvisRest = restPoint(P, "pelvis");
    const mhHipNow = J.thigh_l.head.clone().add(J.thigh_r.head).multiplyScalar(0.5);
    P.hipLift = Math.max(0, mhHipNow.y - procHip.y);
    P.pelvisLocal = pelvisRest.applyMatrix4(_m4b.copy(rest.body.L).invert());
    P.hold = { l: 0, r: 0 };
    // ---- the meshes (a city build leaves its markings for a quiet tick)
    P.deferMarks = !!(opts && opts.auto);
    dress(P, pos);
    // ---- hide the proc body (layers: the meshes stay alive for every reader)
    hideProc(P);
    setupHats(P, pos);
    setupKit(P);
    // ---- the driver: the last child of the rig, run inside the scene's own
    // matrix update, after every proc node above it has composed
    const drv = new THREE.Object3D();
    drv.name = "people-driver";
    drv.updateMatrixWorld = function () { drive(P); };
    g.add(drv);
    P.driver = drv;
    drive(P);
    return P;
  }
  // the rest-pose (aligned) position of a bone head, by FK down the bind skeleton
  function restPoint(P, name) {
    // walk from the root: each bone's head = parent head + R_parent_rest * (bind offset)
    const chain = [];
    let i = S.bix[name];
    while (i >= 0) { chain.unshift(i); i = S.bones[i].parent; }
    const p = P.J[S.bones[chain[0]].name].head.clone();
    const R = new THREE.Quaternion();
    for (let k = 1; k < chain.length; k++) {
      const par = S.bones[chain[k - 1]].name, me = S.bones[chain[k]].name;
      R.copy(P.A[par] || _q.identity());
      const off = P.J[me].head.clone().sub(P.J[par].head).applyQuaternion(R);
      p.add(off);
    }
    return p;
  }

  // ---------------------------------------------------------------- meshes
  function dress(P, pos) {
    const ch = P.ch, look = P.look, cast = P.cast;
    const g = ch.group;
    const root = new THREE.Group();
    root.name = "people";
    g.add(root);
    P.root = root;
    // what is worn: the painted outfit set the rig is dressed in
    const worn = CBZ.cityClothesWorn ? CBZ.cityClothesWorn(ch) : null;
    P.clothesKey = ch._clothesKey;
    // WHAT THE RIG ACTUALLY WEARS, region by region: a part the painter drew
    // is the painter's; a part it did not is the flat colour the outfit
    // system (outfits.js recolorRig) gave the rig's own slot — read straight
    // off that slot, so the two bodies can never disagree
    const sl = ch.skinSlots || {};
    const slotHex = function (arr) { const m = arr && arr[0] && arr[0].material; return m && m.color && !m.map ? m.color.getHex() : null; };
    const parts = worn && worn.set ? worn.set.parts || {} : {};
    const flat = {
      torso: parts.torso ? null : slotHex(sl.torso),
      arms: parts.arms ? null : (parts.sleeves ? (parts.sleeves.hex != null ? parts.sleeves.hex : (worn.set.bodyHex != null ? worn.set.bodyHex : slotHex(sl.torso))) : slotHex(sl.arms)),
      legs: parts.legs ? null : slotHex(sl.legs),
    };
    P.flat = flat;
    // WHAT IS WORN, AS REAL CLOTHES (THE REAL WARDROBE): layers of garments,
    // each dyed zone by zone; a print keeps the painter's picture at 4x
    const plan = wardrobePlan(ch, cast, worn, flat, P.deferMarks);
    for (const ly of plan) {
      if (ly.print) {
        const hi = worn && CBZ.cityClothesHiRes ? CBZ.cityClothesHiRes(worn.key, 4) : null;
        ly.tex = worn ? (hi ? hi.tex : worn.set.tex) : null;
        ly.jacket = !!(worn && worn.set.parts && worn.set.parts.jacket);
        ly.bodyHex = worn ? worn.set.bodyHex : slotHex(sl.torso);
      } else if (!worn) {
        if (ly.zc[0] == null) ly.zc[0] = 0x6a6f78;
        if (ly.zc[1] == null) ly.zc[1] = 0x2c3a52;
      }
    }
    P.plan = plan;
    const keys = {};
    keys.cloth = plan.map(function (ly) { return ly.key; });
    keys.shoes = shoesFor(cast, worn);
    keys.hair = hairKey(look, cast);
    const beard = !cast.f && !cast.kid ? look.beard || null : null;
    keys.beard = beard === "full" ? "beard:full" : beard === "goatee" ? "beard:goatee" : beard === "moustache" ? "beard:moustache" : null;
    P.keys = keys;
    // ---- body faces under the clothes go
    const del = new Uint8Array(S.NB);
    // a layer worn OVER another (a gilet) hides nothing: the one under it does
    // (an undershirt worn under them hides none either: it shows only where
    // they leave the body bare)
    const covers = plan.filter(function (ly) { return !ly.over && !ly.under; }).map(function (ly) { return ly.key; }).concat([keys.shoes]);
    for (const k of covers) {
      const a = k && assetShared(k);
      if (a && a.del) for (let i = 0; i < a.del.length; i++) del[a.del[i]] = 1;
    }
    const tris = S.bodyIndex, keep = [];
    for (let t = 0; t < tris.length; t += 3) {
      if (del[S.bodyMap[tris[t]]] || del[S.bodyMap[tris[t + 1]]] || del[S.bodyMap[tris[t + 2]]]) continue;
      keep.push(tris[t], tris[t + 1], tris[t + 2]);
    }
    // ---- the body
    const nB = normalsOrig(pos, S.bodyTris, S.NB);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(gather(pos, S.bodyMap), 3));
    bg.setAttribute("normal", new THREE.BufferAttribute(gather(nB, S.bodyMap), 3));
    bg.setAttribute("uv", S.body.uv);
    bg.setAttribute("skinIndex", S.body.skinIndex); bg.setAttribute("skinWeight", S.body.skinWeight);
    bg.setIndex(new THREE.BufferAttribute(Uint16Array.from(keep), 1));
    bg.morphAttributes.position = S.body.morph;
    bg.morphTargetsRelative = true;
    const skinKey = skinFor(look, cast), sk = M.skins[skinKey];
    P.skinKey = skinKey;
    const ageKey = (cast.ageY < 34 ? "young" : cast.ageY < 58 ? "middleage" : "old") + "_" + (cast.f ? "female" : "male");
    // the skin photo DECODED (sRGB): its own contrast and colour (lips, flush,
    // shadow under the brow) survive; its linear mean is then scaled to the
    // casting's tone, so the person still matches the cast
    const sm = skinMaterial({ skinTex: tex(sk.map, true), reliefTex: tex(M.skinNormals[ageKey] || M.skinNormals.young_male) });
    const hex = look.skin != null ? look.skin : 0xcf9a72;
    const tgt = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    // the palest casting hexes are brighter than any real skin's albedo; a
    // textured face shows it (porcelain), so the top end is eased down
    const Lh = 0.2126 * tgt[0] + 0.7152 * tgt[1] + 0.0722 * tgt[2];
    if (Lh > 0.55) { const f = 1 - 0.3 * (Lh - 0.55) / 0.45; tgt[0] *= f; tgt[1] *= f; tgt[2] *= f; }
    // THE CASTING'S TONE, THE TEXTURE'S LIFE: brightness follows the hex all
    // the way, hue only halfway, so a pale hex does not bleach the real skin's
    // own warmth and flush out of it (a per-channel match turns it porcelain)
    const lin = function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const st = [lin(sk.tone[0]), lin(sk.tone[1]), lin(sk.tone[2])];
    const lt = 0.2126 * tgt[0] + 0.7152 * tgt[1] + 0.0722 * tgt[2], ls = 0.2126 * st[0] + 0.7152 * st[1] + 0.0722 * st[2];
    const kl = lt / Math.max(0.01, ls), hue = function (i) { return Math.max(0.3, Math.min(6, kl * Math.sqrt((tgt[i] / Math.max(0.005, st[i])) / kl))); };
    sm.userData.u.pTone.value.set(hue(0), hue(1), hue(2));
    const hairHex = look.hair != null ? look.hair : 0x2a2018;
    const hc = new THREE.Color(hairHex);
    sm.userData.u.pHair.value.set(hc.r, hc.g, hc.b);
    // stubble / scalp: the beard style's own mask under its mesh; a buzz cut
    // or any hair at all darkens the scalp (no pale skin between the cards)
    const stub = sm.userData.u.pStub.value;
    const sv = beard === "stubble" ? 0.85 : beard === "full" ? 0.9 : 0;
    stub.set(sv, beard === "goatee" ? 0.95 : 0, beard === "moustache" ? 0.95 : 0,
      look.bald && look.hairStyle !== "buzz" ? 0 : (keys.hair ? 0.75 : (look.hairStyle === "buzz" || !cast.f ? 0.8 : 0.6)));
    if (cast.f || cast.kid) { stub.x = 0; stub.y = 0; stub.z = 0; }
    P.skinMat = sm;
    addMesh(P, bg, sm, "body");
    // ---- face parts
    // eye colour: the casting's (heritage.js) or, with none, by ancestry
    const ec = look.eye || (cast.macro.race.caucasian > 0.7 && cast.r() < 0.45 ? ["blue", "green", "grey", "hazel"][(cast.seed >>> 5) & 3] : (cast.r() < 0.6 ? "dark" : "brown"));
    const IRIS = { dark: [0.3, 0.16, 0.07], brown: [0.42, 0.25, 0.1], hazel: [0.46, 0.38, 0.14], green: [0.3, 0.44, 0.22],
      grey: [0.42, 0.47, 0.5], gray: [0.42, 0.47, 0.5], light: [0.45, 0.6, 0.75], blue: null };
    const eyeTex = M.eyeMats.blue || M.eyeMats.brown;
    const iris = IRIS[ec] !== undefined ? IRIS[ec] : IRIS.brown;
    part(P, pos, "eyes", eyeMaterial(tex(eyeTex), iris));
    const browTexs = Object.keys(M.brows || {});
    const browTex = M.brows[browTexs[(cast.seed >>> 3) % Math.max(1, browTexs.length)]];
    const browCol = new THREE.Color(hairHex).multiplyScalar(cast.ageY > 60 ? 1.6 : 1.5);
    part(P, pos, "brows", plainMaterial({ map: tex(browTex), color: browCol, transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.8, skinning: true, morphTargets: true }), { order: 2 });
    part(P, pos, "lashes", plainMaterial({ map: tex(M.assets.lashes.mat.map), color: 0x2a221e, transparent: true, alphaTest: 0.1, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7, skinning: true, morphTargets: true }), { order: 3 });
    part(P, pos, "teeth", plainMaterial({ map: tex(M.assets.teeth.mat.map), roughness: 0.32, metalness: 0, skinning: true, morphTargets: true }));
    part(P, pos, "tongue", plainMaterial({ map: tex(M.assets.tongue.mat.map), roughness: 0.4, metalness: 0, skinning: true, morphTargets: true }));
    // ---- hair
    if (keys.hair) {
      const a = assetShared(keys.hair);
      if (a) {
        const col = new THREE.Color(hairHex).multiplyScalar(1.55);
        const hm = hairMaterials(a.e.mat.map, col);
        part(P, pos, keys.hair, hm[0], { cast: true }).userData.hair = true;
        part(P, pos, keys.hair, hm[1], { order: 4, reuse: true }).userData.hair = true;
      }
    }
    if (keys.beard) {
      const a = assetShared(keys.beard);
      if (a) {
        const col = new THREE.Color(hairHex).multiplyScalar(cast.ageY > 55 ? 1.8 : 1.5);
        const hm = hairMaterials(a.e.mat.map, col, { morphTargets: true });
        part(P, pos, keys.beard, hm[0], {});
        part(P, pos, keys.beard, hm[1], { order: 4, reuse: true });
      }
    }
    // ---- clothes and shoes
    for (const ly of plan) {
      const a = assetShared(ly.key);
      if (!a) continue;
      const index = ly.under ? underIndex(a, del) : ly.hide ? zonesIndex(a, ly.hide) : null;
      if (index && !index.count) continue;
      part(P, pos, ly.key, clothMaterial(P, a, ly), { cast: !ly.under, index: index, tight: ly.under ? 0.25 : 0 });
    }
    if (keys.shoes) {
      const a = assetShared(keys.shoes);
      if (a) {
        const want = slotHex(sl.shoes) != null ? slotHex(sl.shoes) : (worn && worn.set && worn.set.c && worn.set.c.shoes != null ? worn.set.c.shoes : null);
        part(P, pos, keys.shoes, shoeMaterial(tex(a.e.mat.map), want, a.e.mat.mean), { cast: true });
      }
    }
  }
  function clampT(x) { return Math.max(0.3, Math.min(2.6, x)); }
  function addMesh(P, geo, mat, name, opts) {
    opts = opts || {};
    const m = new THREE.SkinnedMesh(geo, mat);
    m.name = "people:" + name;
    m.bindMode = "detached";
    m.bind(P.skeleton, new THREE.Matrix4());
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    m.frustumCulled = false;
    if (opts.order) m.renderOrder = opts.order;
    m.userData.people = P;
    P.root.add(m);
    P.meshes.push(m);
    P.mats.push(mat);
    return m;
  }
  function part(P, pos, key, mat, opts) {
    const a = assetShared(key);
    if (!a) return null;
    opts = opts || {};
    let geo = opts.reuse && P._lastGeo && P._lastGeo.key === key ? P._lastGeo.geo : null;
    if (!geo) {
      const p = fit(a, pos, null, opts.tight);
      const n = normalsOrig(p, a.origTris, a.e.nVerts);
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(gather(p, a.map), 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(gather(n, a.map), 3));
      geo.setAttribute("uv", a.uv);
      if (a.atlasA) { geo.setAttribute("atlasA", a.atlasA); geo.setAttribute("atlasB", a.atlasB); }
      if (a.zone) geo.setAttribute("zone", a.zone);
      geo.setAttribute("skinIndex", a.skinIndex); geo.setAttribute("skinWeight", a.skinWeight);
      geo.setIndex(opts.index || a.index);
      if (a.morph && mat.morphTargets) { geo.morphAttributes.position = a.morph; geo.morphTargetsRelative = true; }
      P._lastGeo = { key: key, geo: geo };
    }
    return addMesh(P, geo, mat, key, opts);
  }
  /* a garment with a zone not worn (the duty shirt's jeans under real
     slacks): its faces in that zone out of the index, once per asset */
  function zonesIndex(a, hide) {
    const k = "_hide" + hide.join(",");
    if (a[k]) return a[k];
    const z = a.zone ? a.zone.array : null, src = a.index.array, out = [];
    for (let t = 0; t < src.length; t += 3) {
      if (z && (hide.indexOf(z[src[t]]) >= 0 || hide.indexOf(z[src[t + 1]]) >= 0 || hide.indexOf(z[src[t + 2]]) >= 0)) continue;
      out.push(src[t], src[t + 1], src[t + 2]);
    }
    const ix = new THREE.BufferAttribute(a.nR > 65535 ? new Uint32Array(out) : new Uint16Array(out), 1);
    ix._peopleShared = true;
    return (a[k] = ix);
  }
  /* A garment worn UNDER the others (the undershirt at an open collar): its
     faces over the body the garments above delete are not drawn (a face
     shows only with all three vertices riding on bare skin). It is
     also fitted SKIN-TIGHT (part opts.tight): the delete lists spare the skin
     round collars and shoulders that a shirt still hangs over, and a tee
     fitted at its own ease stood out through the shirt there; a couple of
     millimetres off the skin it is behind any shirt. */
  function underIndex(a, del) {
    const n = a.e.nVerts, bv = a.bv, bw = a.bw, open = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      let ok = 1;
      for (let k = 0; k < 3; k++) if (bw[v * 3 + k] > 0.05 && del[bv[v * 3 + k]]) { ok = 0; break; }
      open[v] = ok;
    }
    const src = a.index.array, map = a.map, out = [];
    for (let t = 0; t < src.length; t += 3) {
      if (open[map[src[t]]] && open[map[src[t + 1]]] && open[map[src[t + 2]]]) out.push(src[t], src[t + 1], src[t + 2]);
    }
    return new THREE.BufferAttribute(a.nR > 65535 ? new Uint32Array(out) : new Uint16Array(out), 1);
  }
  function hideProc(P) {
    const ch = P.ch, keep = new Set();
    // a rig the instancer pooled comes back whole first (its layers restored),
    // and its matrix-authority stamp goes: this subtree is walked by the
    // render again (core/matrixskip.js), which is where the driver runs
    if (CBZ.pedInstanceForget) CBZ.pedInstanceForget(ch.group);
    ch.group._cbzMatrixOwnedFrame = undefined;
    const sk = ch.sockets || {};
    for (const k in sk) if (sk[k]) sk[k].traverse(function (o) { keep.add(o); });
    // the role's hat is re-fitted onto the real head (setupHats / driveHats)
    P.hidden = [];
    ch.group.traverse(function (o) {
      if (!o.isMesh || keep.has(o) || o.userData.people || o === P.root) return;
      if (o.parent && o.parent.name === "people") return;
      P.hidden.push([o, o.layers.mask]);
      o.layers.set(HIDE);
    });
  }

  /* HATS. The role's hat (headwear.js: the police cap, the soldier's cover,
     a ballcap, a campaign hat) was modelled round the proc head, which is
     wide and short. It is SHRINK-WRAPPED onto this person's skull: both
     heads are sampled as a radius per direction from the brow-line centre,
     and every hat vertex keeps its direction while its distance scales by
     the ratio of the two heads' radii there — the band hugs this skull where
     it hugged that one, the peak keeps its proportion. One clone per hat
     mesh per person, riding the real head bone; the original hides with the
     proc body. Hair under a hat hides. */
  const HAZ = 24, HEL = 14;
  function headProfile(pts, c) {
    const R = new Float32Array(HAZ * HEL);
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i] - c.x, dy = pts[i + 1] - c.y, dz = pts[i + 2] - c.z, r = Math.hypot(dx, dy, dz);
      if (r < 1e-4) continue;
      const a = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI)) + 1) % 1 * HAZ) % HAZ;
      const e = Math.max(0, Math.min(HEL - 1, Math.floor((Math.asin(dy / r) / Math.PI + 0.5) * HEL)));
      if (r > R[e * HAZ + a]) R[e * HAZ + a] = r;
    }
    // directions the head has no skin in (under the jaw): the nearest row above
    for (let e = HEL - 2; e >= 0; e--) for (let a = 0; a < HAZ; a++) if (!R[e * HAZ + a]) R[e * HAZ + a] = R[(e + 1) * HAZ + a];
    for (let e = 1; e < HEL; e++) for (let a = 0; a < HAZ; a++) if (!R[e * HAZ + a]) R[e * HAZ + a] = R[(e - 1) * HAZ + a];
    // smooth (a max per bin is jagged): two passes of a 3 x 3 mean, wrapping round
    for (let pass = 0; pass < 2; pass++) {
      const T = R.slice();
      for (let e = 0; e < HEL; e++) for (let a = 0; a < HAZ; a++) {
        let s2 = 0, n = 0;
        for (let de = -1; de <= 1; de++) { const ee = e + de; if (ee < 0 || ee >= HEL) continue; for (let da = -1; da <= 1; da++) { s2 += T[ee * HAZ + (a + da + HAZ) % HAZ]; n++; } }
        R[e * HAZ + a] = s2 / n;
      }
    }
    return R;
  }
  function profileAt(R, dx, dy, dz) {
    const r = Math.hypot(dx, dy, dz) || 1;
    const fa = ((Math.atan2(dx, dz) / (2 * Math.PI)) + 1) % 1 * HAZ - 0.5, fe = Math.max(0, Math.min(HEL - 1.001, (Math.asin(dy / r) / Math.PI + 0.5) * HEL - 0.5));
    const a0 = Math.floor(fa), e0 = Math.floor(fe), ta = fa - a0, te = fe - e0;
    const A0 = (a0 + HAZ) % HAZ, A1 = (a0 + 1 + HAZ) % HAZ, E1 = Math.min(HEL - 1, e0 + 1);
    return (R[e0 * HAZ + A0] * (1 - ta) + R[e0 * HAZ + A1] * ta) * (1 - te) + (R[E1 * HAZ + A0] * (1 - ta) + R[E1 * HAZ + A1] * ta) * te;
  }
  function setupHats(P, pos) {
    const ch = P.ch, head = ch.head, bb = ch._peopleHeadBox;
    if (!head || !head.geometry || !bb || !P.rest.head) return;
    // the proc skull, at rest, group-local
    const hp = head.geometry.attributes.position, L = P.rest.head.L, pp = new Float32Array(hp.count * 3);
    for (let i = 0; i < hp.count; i++) { _v.fromBufferAttribute(hp, i).applyMatrix4(L); pp[i * 3] = _v.x; pp[i * 3 + 1] = _v.y; pp[i * 3 + 2] = _v.z; }
    // this person's skull: the skin above the head joint
    const hy = P.J.head.head.y, mp = [];
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (let r = 0; r < S.bodyMap.length; r++) {
      const v = S.bodyMap[r], x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (y < hy - 0.03 || Math.abs(x) > 0.2) continue;
      mp.push(x, y, z);
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    let browM = null;
    const ba = assetShared("brows");
    if (ba) { const bp = fit(ba, pos); let y = 0; for (let i = 1; i < bp.length; i += 3) y += bp[i]; browM = y / (bp.length / 3); }
    const browP = ch._peopleBrowY != null ? ch._peopleBrowY : (bb.min.y + bb.max.y) / 2;
    P.hatCp = new THREE.Vector3((bb.min.x + bb.max.x) / 2, browP + 0.02, (bb.min.z + bb.max.z) / 2);
    P.hatCm = new THREE.Vector3((mnx + mxx) / 2, (browM != null ? browM : hy + 0.1) + 0.042, (mnz + mxz) / 2);
    // how far a hat stands off the skull (crown, peak, brim) scales with the head
    P.hatKf = Math.max(0.35, Math.min(1.2, (mxx - mnx) / Math.max(0.05, bb.max.x - bb.min.x))) * 1.15;
    P.hatRp = headProfile(pp, P.hatCp);
    P.hatRm = headProfile(Float32Array.from(mp), P.hatCm);
    P.hatBrestInv = new THREE.Matrix4().makeTranslation(...restPoint(P, "head").toArray()).invert();
    const anchor = new THREE.Group();
    anchor.name = "people-hat";
    anchor.matrixAutoUpdate = false;
    P.root.add(anchor);
    P.hatAnchor = anchor;
    P.hatClones = new Map();
  }
  function wrapHat(P, src) {
    // the hat's vertices in group-local REST space (relative to the head mesh)
    const ch = P.ch, head = ch.head, g = src.geometry;
    if (!g || !g.attributes || !g.attributes.position) return null;
    head.updateMatrixWorld(true);
    const inHead = _m4.copy(head.matrixWorld).invert().multiply(src.matrixWorld);
    const toRest = _m4b.multiplyMatrices(P.rest.head.L, inHead);
    const geo = g.clone();
    const pa = geo.attributes.position, cp = P.hatCp, cm = P.hatCm, Bi = P.hatBrestInv;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(toRest);
      const dx = _v.x - cp.x, dy = _v.y - cp.y, dz = _v.z - cp.z;
      const r = Math.hypot(dx, dy, dz) || 1e-6;
      const rp = profileAt(P.hatRp, dx, dy, dz), rm = profileAt(P.hatRm, dx, dy, dz);
      // ON this skull where it was on that one; its stand-off kept (scaled)
      const r2 = rm + (r - rp) * P.hatKf + 0.004;
      _v.set(cm.x + dx / r * r2, cm.y + dy / r * r2, cm.z + dz / r * r2).applyMatrix4(Bi);
      pa.setXYZ(i, _v.x, _v.y, _v.z);
    }
    if (geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, src.material);
    m.name = "people-hat:" + (src.name || "");
    m.castShadow = true; m.receiveShadow = true;
    m.userData.people = P;
    return m;
  }
  function visibleUp(o, stop) { while (o && o !== stop) { if (!o.visible) return false; o = o.parent; } return true; }
  function driveHats(P) {
    const an = P.hatAnchor;
    if (!an) return;
    const caps = (P.ch.skinSlots && P.ch.skinSlots.cap) || [];
    let on = false;
    const seen = new Set();
    for (const c of caps) {
      if (!c || !c.isMesh) continue;
      seen.add(c);
      let cl = P.hatClones.get(c);
      if (cl === undefined) {
        cl = wrapHat(P, c);
        P.hatClones.set(c, cl);
        if (cl) an.add(cl);
        if (c.layers.mask !== (1 << HIDE)) { P.hidden.push([c, c.layers.mask]); c.layers.set(HIDE); }
      }
      const vis = visibleUp(c, P.ch.group);
      if (cl) cl.visible = vis;
      if (vis) on = true;
    }
    P.hatClones.forEach(function (cl, src) { if (!seen.has(src) && cl) cl.visible = false; });
    for (const m of P.meshes) if (m.userData.hair) m.visible = !on;
    an.matrix.copy(P.bones[S.bix.head].matrixWorld);
    an.matrixWorld.multiplyMatrices(P.root.matrixWorld, an.matrix);
    for (const c of an.children) c.updateMatrixWorld(true);
  }

  /* THIS BODY'S SECTION. What is hung on a real body (the duty kit) is
     built round its CLOTHED surface: body and garments, the
     arms and the head left out (they hang beside the hips in the bind pose).
     Measured once a build as 48 radii round the body's axis every centimetre
     from under the hips to over the shoulders (rig-local, at rest). Then
     dilated a bin and a level: a stiff belt bridges the folds of the cloth
     under it, and a wrinkle between two samples must not poke through. */
  const SEC_NS = 48, SEC_STEP = 0.01, TAU = Math.PI * 2;
  function section(P) {
    if (P.sec !== undefined) return P.sec;
    const rest = P.rest, J = P.J;
    if (!rest.body || !J.thigh_l || !J.thigh_r || !J.upperarm_l || !J.upperarm_r) return (P.sec = null);
    const e = rest.body.L.elements, ax = e[12], az = e[14], NS = SEC_NS;
    const yHip = (J.thigh_l.head.y + J.thigh_r.head.y) / 2, ySh = (J.upperarm_l.head.y + J.upperarm_r.head.y) / 2;
    const y0 = yHip - 0.45, nl = Math.max(8, Math.ceil((ySh + 0.2 - y0) / SEC_STEP));
    const R0 = new Float32Array(nl * NS);
    for (const m of P.meshes) {
      const cloth = m.name.indexOf("people:cloth:") === 0;
      if (!cloth && m.name !== "people:body") continue;
      const g = m.geometry, pa = g.attributes.position, si = g.attributes.skinIndex, ix = g.index;
      if (!pa || !si || pa.isInterleavedBufferAttribute || si.isInterleavedBufferAttribute) continue;
      const p = pa.array, sa = si.array, ss = si.itemSize, n = pa.count;
      // only what is drawn: the body under a garment is gone from its index
      let used = null;
      if (ix) { used = new Uint8Array(n); const ia = ix.array; for (let t = 0; t < ia.length; t++) used[ia[t]] = 1; }
      for (let i = 0; i < n; i++) {
        if (used && !used[i]) continue;
        const l = Math.round((p[i * 3 + 1] - y0) / SEC_STEP);
        if (l < 0 || l >= nl) continue;
        const grp = S.bgroup[sa[i * ss]];
        if (grp === 1 || grp === 4) continue;
        const dx = p[i * 3] - ax, dz = p[i * 3 + 2] - az, r = Math.sqrt(dx * dx + dz * dz);
        const o = l * NS + Math.round((Math.atan2(dx, dz) / TAU + 1) * NS) % NS;
        if (r > R0[o]) R0[o] = r;
      }
    }
    /* A bin no vertex fell in (a garment's rows of vertices run a little
       over a centimetre apart): first from the same bin above and below,
       within 3 cm, the surface changes slowly up a body; only then round the
       ring (which across the front would borrow the wider sides and stand
       the chest out by centimetres); an empty level from the nearest level
       that has one. */
    const R1 = R0.slice();
    for (let j = 0; j < NS; j++) for (let l = 0; l < nl; l++) {
      if (R1[l * NS + j] > 0) continue;
      let a = -1, b = -1;
      for (let d = 1; d <= 3 && a < 0; d++) if (l - d >= 0 && R1[(l - d) * NS + j] > 0) a = l - d;
      for (let d = 1; d <= 3 && b < 0; d++) if (l + d < nl && R1[(l + d) * NS + j] > 0) b = l + d;
      if (a >= 0 && b >= 0) R0[l * NS + j] = R1[a * NS + j] + (R1[b * NS + j] - R1[a * NS + j]) * (l - a) / (b - a);
      else if (a >= 0 && l - a === 1) R0[l * NS + j] = R1[a * NS + j];
      else if (b >= 0 && b - l === 1) R0[l * NS + j] = R1[b * NS + j];
    }
    const have = new Uint8Array(nl);
    for (let l = 0; l < nl; l++) {
      const o = l * NS;
      let known = 0;
      for (let j = 0; j < NS; j++) if (R0[o + j] > 0) known++;
      if (known < 3) continue;
      have[l] = 1;
      for (let j = 0; j < NS; j++) {
        if (R0[o + j] > 0) continue;
        let a = j, b = j;
        while (R0[o + ((a + NS) % NS)] <= 0) a--;
        while (R0[o + (b % NS)] <= 0) b++;
        const ra = R0[o + ((a + NS) % NS)], rb = R0[o + (b % NS)];
        R0[o + j] = ra + (rb - ra) * (j - a) / (b - a);
      }
    }
    for (let l = 0; l < nl; l++) {
      if (have[l]) continue;
      let d = 1;
      while (d < nl && !(l - d >= 0 && have[l - d]) && !(l + d < nl && have[l + d])) d++;
      const src = l - d >= 0 && have[l - d] ? l - d : l + d;
      if (src >= 0 && src < nl && have[src]) R0.copyWithin(l * NS, src * NS, src * NS + NS);
    }
    const R = new Float32Array(nl * NS);
    for (let l = 0; l < nl; l++) for (let j = 0; j < NS; j++) {
      let r = 0;
      for (let dl = -1; dl <= 1; dl++) {
        const ll = Math.min(nl - 1, Math.max(0, l + dl)) * NS;
        for (let dj = -1; dj <= 1; dj++) { const v = R0[ll + (j + dj + NS) % NS]; if (v > r) r = v; }
      }
      R[l * NS + j] = r;
    }
    return (P.sec = { R: R, y0: y0, nl: nl, ax: ax, az: az, yHip: yHip, ySh: ySh });
  }
  function secR(sec, y, th) {                                  // bilinear: height, angle
    const NS = SEC_NS, R = sec.R;
    const fl = Math.max(0, Math.min(sec.nl - 1.001, (y - sec.y0) / SEC_STEP)), l0 = Math.floor(fl), tl = fl - l0;
    const fa = (th / TAU + 1) * NS, f0 = Math.floor(fa), ta = fa - f0, a0 = f0 % NS, a1 = (a0 + 1) % NS;
    const o0 = l0 * NS, o1 = o0 + NS;
    return (R[o0 + a0] * (1 - ta) + R[o0 + a1] * ta) * (1 - tl) + (R[o1 + a0] * (1 - ta) + R[o1 + a1] * ta) * tl;
  }
  // the outermost surface's z (from the axis) at x (from the axis), round
  // the front from the wearer's right to the left
  function secFront(sec, x, y) {
    const q0 = -SEC_NS / 4;
    let px = 0, pz = 0;
    for (let q = q0; q <= SEC_NS / 4; q++) {
      const th = q / SEC_NS * TAU, r = secR(sec, y, th), sx = Math.sin(th) * r, sz = Math.cos(th) * r;
      if (q === q0) { if (sx >= x) return sz; }
      else if (sx >= x && sx > px) return pz + (sz - pz) * (x - px) / (sx - px);
      px = sx; pz = sz;
    }
    return pz;
  }

  /* THE DUTY KIT ON THE REAL BODY. entities/dutykit.js hangs an officer's
     hard kit (the duty belt, holster and pistol, magazine pouches, radio,
     torch, cuff case, keys, the badge on the chest, the shoulder mic) as ONE
     mesh built round the proc body's section, so it went out of sight with
     that body: a cop with no belt and no gun. The kit is BUILT AGAIN for this
     body: dutykit.js is handed a body that answers with THIS section
     (CBZ.bodySection reads ch._section) and this chest. So the belt is cut
     round this waistband, the holster and every pouch hang off this belt
     clear of these hips and thighs, the badge lies on this shirt: by the
     kit's own rules, at its true size, nothing bent. Then it rides the real
     skeleton, the belt and all that hangs on it on the pelvis, the chest kit
     on the chest. The shoulder straps stay off: the real shirt has its own
     shoulders. */
  function setupKit(P) {
    const ch = P.ch, rest = P.rest, sd = P.sides, TS = ch.torsoShape;
    if (!ch._dutyKit || P.kit) return;
    const sec = CBZ.dutyKit && CBZ.bodySection && TS && TS.at && ch.profile && rest[sd.armL] && rest[sd.legL] ? section(P) : null;
    if (!sec) { P.kitNo = true; return; }
    const t0 = performance.now();
    // the proc body's frame in the rig (no turn, a scale), and the height
    // landmarks, proc then real: the hip joints and the shoulders
    const e = rest.body.L.elements, s = Math.hypot(e[0], e[1], e[2]);
    const yh0 = (rest[sd.legL].p.y + rest[sd.legR].p.y) / 2, yh1 = sec.yHip;
    const ys0 = (rest[sd.armL].p.y + rest[sd.armR].p.y) / 2, ys1 = sec.ySh;
    const k = (ys1 - yh1) / Math.max(0.05, ys0 - yh0);
    /* A proc body-local height -> this body's. The belt lands where the hips
       and the shoulders put it, and the belt and all that hangs on it (to
       15 cm over it) keep their true size; the chest above is stretched so
       the proc shoulders land on these. */
    const B0 = TS.pTop, yB0 = yh1 + (s * B0 + e[13] - yh0) * k;
    const B1 = B0 + 0.15 / s, yB1 = yB0 + 0.15, Bs = (ys0 - e[13]) / s;
    const k2 = Math.max(0.5, Math.min(2, (ys1 - yB1) / Math.max(0.05, s * (Bs - B1))));
    const yOf = (yb) => (yb <= B1 ? yB0 + s * (yb - B0) : yB1 + s * (yb - B1) * k2);
    const rAt = (yr, th) => secR(sec, yr, th) / s;               // proc model units
    // the body dutykit.js builds round: this section, this chest
    const body = Object.create(ch);
    body._section = function (yb) {
      const yr = yOf(yb), out = [];
      for (let j = 0; j < SEC_NS; j++) { const th = j / SEC_NS * TAU, r = rAt(yr, th); out.push([Math.sin(th) * r, Math.cos(th) * r]); }
      return out;
    };
    body.torsoFrontZ = function (xb, yb) { return secFront(sec, xb * s, yOf(yb)) / s; };
    // a ring as wide as this body: the badge sits 0.40 of the way out (over
    // the pocket), the mic 0.56
    body.torsoShape = Object.create(TS);
    body.torsoShape.at = function (yb) {
      const yr = yOf(yb);
      return Object.assign({}, TS.at(yb), { a: (rAt(yr, TAU / 4) + rAt(yr, -TAU / 4)) / 2 });
    };
    P.kit = { body: body, s: s, ax: sec.ax, az: sec.az, yOf: yOf, B1: B1, k2: k2, yBelt: yB0 + 0.005, proc: null, src: null, mesh: null, mat: null };
    refitKit(P);
    P.kit.ms = performance.now() - t0;                         // what it cost (the LOD budget)
  }
  function refitKit(P) {
    const ch = P.ch, kit = ch._dutyKit, K = P.kit;
    K.proc = kit; K.src = kit ? kit.geometry : null;
    const u = kit && kit.userData;
    // under a jacket (a detective in his suit) the belt is under it, the
    // shield on the breast
    const concealed = !!(P.plan && P.plan.some(function (l) { return l.conceal; }));
    const g = u && u.kind ? CBZ.dutyKit.geometry(K.body, u.kind, Object.assign({}, u.opts, { torchOut: !!u.torchOut, straps: false, store: false, concealed: concealed })) : null;
    if (!g) { if (K.mesh) K.mesh.visible = false; return; }
    // the proc kit leaves with the rest of the proc body
    if (kit.layers.mask !== (1 << HIDE)) { P.hidden.push([kit, kit.layers.mask]); kit.layers.set(HIDE); }
    // proc body-local -> this rig at rest; the belt and all that hangs on it
    // ride the pelvis, the chest kit the chest
    const pa = g.attributes.position.array, na = g.attributes.normal.array, n = pa.length / 3;
    const sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
    const pel = S.bix.pelvis, chest = S.bix.spine_03 != null ? S.bix.spine_03 : S.bix.spine_02;
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      const yb = pa[o + 1], up = yb > K.B1;
      pa[o] = K.ax + K.s * pa[o]; pa[o + 1] = K.yOf(yb); pa[o + 2] = K.az + K.s * pa[o + 2];
      if (up) {                                              // stretched by k2 up there
        const nx = na[o], ny = na[o + 1] / K.k2, nz = na[o + 2], l = Math.hypot(nx, ny, nz) || 1;
        na[o] = nx / l; na[o + 1] = ny / l; na[o + 2] = nz / l;
      }
      sI[i * 4] = up ? chest : pel; sW[i * 4] = 1;
    }
    g.setAttribute("skinIndex", new THREE.BufferAttribute(sI, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sW, 4));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g._shared = false;
    g.userData.own = true;                                     // every buffer here is this person's
    if (!K.mat) { K.mat = kit.material.clone(); K.mat.skinning = true; }
    if (K.mesh) { K.mesh.geometry.dispose(); K.mesh.geometry = g; }
    else { K.mesh = addMesh(P, g, K.mat, "dutykit", { cast: false }); K.mesh.receiveShadow = false; }
    K.mesh.visible = true;
  }
  function driveKit(P) {
    const kit = P.ch._dutyKit, K = P.kit;
    // a kit put on after this body was built
    if (!K) { if (kit && !P.kitNo) setupKit(P); return; }
    // the torch comes off the belt, a re-dress swaps the kit: follow it
    if (kit !== K.proc || (kit && kit.geometry !== K.src)) refitKit(P);
    if (K.mesh) K.mesh.visible = !!kit && visibleUp(kit, P.ch.group);
  }

  // ================================================================ the driver
  const _R = [], _Pp = [];
  for (let i = 0; i < 64; i++) { _R.push(new THREE.Quaternion()); _Pp.push(new THREE.Vector3()); }
  const _cur = {};
  const _dq = new THREE.Quaternion(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
  const _fk = new THREE.Vector3(), _ik = new THREE.Vector3(), _corr = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
  function nodeNow(P, k, gInv) {
    let c = _cur[k];
    if (!c) c = _cur[k] = { L: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
    const n = P.nodes[k];
    if (!n) return null;
    c.L.multiplyMatrices(gInv, n.matrixWorld);
    c.L.decompose(c.p, c.q, c.s);
    return c;
  }
  function drive(P) {
    const ch = P.ch, g = ch.group;
    if (!P.root || !P.root.visible) return;
    _gInv.copy(g.matrixWorld).invert();
    const bones = P.bones, Sb = S.bones, J = P.J, A = P.A, rest = P.rest;
    // world (group-local) rotation of every bone: the delta of its proc node
    // from that node's zero pose
    const pq = P._pq || (P._pq = {});
    const stamp = (P._stamp = (P._stamp || 0) + 1);
    const procQ = function (k) {
      let e = pq[k];
      if (e && e.stamp === stamp) return e;
      const c = nodeNow(P, k, _gInv);
      if (!c) return null;
      if (!e) e = pq[k] = { dq: new THREE.Quaternion(), L: new THREE.Matrix4(), stamp: 0 };
      e.dq.copy(c.q).multiply(_q.copy(rest[k].q).invert());
      e.L.copy(c.L);
      e.stamp = stamp;
      return e;
    };
    for (let i = 0; i < Sb.length; i++) {
      const name = Sb[i].name;
      let k = P.src[name];
      if (!k) {
        // fingers / thumbs / root: ride the parent
        const par = Sb[i].parent;
        if (par >= 0) _R[i].copy(_R[par]); else _R[i].identity();
        if (/^(thumb|index|middle|ring|pinky)_/.test(name)) fingerCurl(P, i, _R[i]);
        continue;
      }
      const e = procQ(k);
      if (!e) { _R[i].identity(); continue; }
      _R[i].copy(e.dq);
      if (A[name]) _R[i].multiply(A[name]);
    }
    // positions: pelvis rides the proc body; everything else FK down this
    // person's own skeleton
    const pb = procQ("body");
    _Pp[S.bix.pelvis].copy(P.pelvisLocal).applyMatrix4(pb.L);
    if (P.hipLift > 0.005) {
      // hip flexion (thigh vs the body's down axis, both legs): standing and
      // walking keep the person's own hip height; a crouch, a seat, a kneel
      // bring the pelvis down onto the rig's hips
      const up = _t2.set(0, 1, 0).applyQuaternion(pb.dq);
      let flex = 0;
      for (const lk of [P.sides.legL, P.sides.legR]) {
        const h = nodeNow(P, lk, _gInv), kn = nodeNow(P, "low" + lk, _gInv);
        if (!h || !kn) continue;
        const d = _t3.subVectors(kn.p, h.p).normalize();
        flex += Math.acos(Math.max(-1, Math.min(1, -d.dot(up)))) * 0.5;
      }
      const t = Math.max(0, Math.min(1, (flex - 0.6) / 0.75)), f = t * t * (3 - 2 * t);
      _Pp[S.bix.pelvis].addScaledVector(up, -P.hipLift * f);
    }
    _Pp[0].set(_Pp[S.bix.pelvis].x, 0, _Pp[S.bix.pelvis].z);
    for (let i = 1; i < Sb.length; i++) {
      const par = Sb[i].parent;
      if (Sb[i].name === "pelvis") continue;
      if (par < 0) continue;
      _t1.copy(J[Sb[i].name].head).sub(J[Sb[par].name].head).applyQuaternion(_R[par]);
      _Pp[i].copy(_Pp[par]).add(_t1);
    }
    // two-bone IK: wrists onto the proc hands, ankles onto the proc feet
    ik(P, "upperarm_l", "lowerarm_l", "hand_l", P.sides.armL);
    ik(P, "upperarm_r", "lowerarm_r", "hand_r", P.sides.armR);
    ik(P, "thigh_l", "calf_l", "foot_l", P.sides.legL);
    ik(P, "thigh_r", "calf_r", "foot_r", P.sides.legR);
    // severed chains collapse into their joint
    for (const nm in P.severed) collapse(P, nm);
    for (let i = 0; i < Sb.length; i++) {
      const s = P._scale && P._scale[i];
      bones[i].matrixWorld.compose(_Pp[i], _R[i], s != null ? _s.set(s, s, s) : _one);
    }
    faceDrive(P);
    driveHats(P);
    driveKit(P);
  }
  const _ikDir = new THREE.Vector3(), _ikPole = new THREE.Vector3(), _ikMid = new THREE.Vector3(), _ikTgt = new THREE.Vector3();
  const HOLD = { pistol: 1, grip: 1, support: 1, cupover: 1, wheel: 1, plant: 1, point: 1, card: 1 };
  function ik(P, up, lo, end, procKey) {
    const iu = S.bix[up], il = S.bix[lo], ie = S.bix[end];
    const eff = P.eff[end];
    const c = nodeNow(P, eff.node, _gInv);
    if (!c) return;
    const target = _ikTgt.copy(eff.local).applyMatrix4(c.L);
    if (eff.side) {
      // A HAND THAT HOLDS SOMETHING IS ON IT: a grip, a gun, a wheel, a
      // planted palm put the wrist exactly on the rig's wrist; a hanging
      // hand keeps this person's own reach
      const hand = P.nodes[eff.node], pose = hand && hand.userData && hand.userData.handPose;
      const want = (pose && (HOLD[pose] || /^(trig|hold)\d/.test(pose))) || P.ch.aimingPose ? 1 : 0;
      const h = P.hold[eff.side] += (want - P.hold[eff.side]) * 0.25;
      if (h > 0.001) target.lerp(c.p, h);
    }
    const root = _Pp[iu], a = P.J[up].head.distanceTo(P.J[lo].head), b = P.J[lo].head.distanceTo(P.J[end].head);
    _ikDir.subVectors(target, root);
    let d = _ikDir.length();
    if (d < 1e-5) return;
    _ikDir.multiplyScalar(1 / d);
    d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, d));
    // the bend plane: toward where the FK mid joint already is (the twist the
    // rotations gave), nudged toward the proc rig's own elbow / knee
    _ikPole.subVectors(_Pp[il], root);
    const pc = nodeNow(P, "low" + procKey, _gInv);
    if (pc) _ikPole.addScaledVector(_t2.subVectors(pc.p, root), 0.5);
    _ikPole.addScaledVector(_ikDir, -_ikPole.dot(_ikDir));
    if (_ikPole.lengthSq() < 1e-10) return;
    _ikPole.normalize();
    const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    _ikMid.copy(root).addScaledVector(_ikDir, a * cosA).addScaledVector(_ikPole, a * sinA);
    // the upper bone onto the new mid joint...
    _fk.subVectors(_Pp[il], root).normalize();
    _t1.subVectors(_ikMid, root).normalize();
    _corr.setFromUnitVectors(_fk, _t1);
    _R[iu].premultiply(_corr);
    _R[il].premultiply(_corr);
    // ...the lower one onto the target
    _fk.subVectors(_Pp[ie], _Pp[il]).applyQuaternion(_corr).normalize();
    _t1.subVectors(target, _ikMid).normalize();
    _q2.setFromUnitVectors(_fk, _t1);
    _R[il].premultiply(_q2);
    _Pp[il].copy(_ikMid);
    _Pp[ie].copy(_ikMid).addScaledVector(_t1, b);
    // what hangs below the end (fingers, the ball of the foot) follows it
    for (let i = ie + 1; i < S.bones.length; i++) {
      let p = S.bones[i].parent, under = false;
      while (p >= 0) { if (p === ie) { under = true; break; } p = S.bones[p].parent; }
      if (!under) continue;
      const par = S.bones[i].parent;
      _t1.copy(P.J[S.bones[i].name].head).sub(P.J[S.bones[par].name].head).applyQuaternion(_R[par]);
      _Pp[i].copy(_Pp[par]).add(_t1);
    }
  }
  // FINGERS: the proc hand's pose (fphands.POSES flex tables) curls this
  // hand's own finger bones about each finger's knuckle axis
  const FINGERS = ["index", "middle", "ring", "pinky"];
  function fingerCurl(P, i, R) {
    const name = S.bones[i].name, m = /^(thumb|index|middle|ring|pinky)_0(\d)_([lr])$/.exec(name);
    if (!m) return;
    const side = m[3], seg = +m[2] - 1;
    const hand = P.nodes["cap" + (side === "l" ? P.sides.armL : P.sides.armR)];
    const pose = hand && hand.userData && hand.userData.handPose || "relaxed";
    const H = CBZ.fpHands && CBZ.fpHands.POSES ? CBZ.fpHands.POSES[pose] : null;
    let ang;
    if (m[1] === "thumb") ang = (H && H.wrap) || pose === "fist" || pose === "point" ? 0.45 : 0.18;
    else {
      const fi = FINGERS.indexOf(m[1]);
      if (H && H.flex) { const row = H.flex[Math.min(fi, H.flex.length - 1)]; ang = row[Math.min(seg, row.length - 1)]; }
      else if (H && H.wrap) ang = [1.0, 1.25, 0.8][seg];
      else ang = [0.3, 0.42, 0.22][seg];
    }
    // the knuckle axis in bind: across the hand, perpendicular to the finger
    let ax = P._fax && P._fax[i];
    if (!ax) {
      P._fax = P._fax || {};
      const J = P.J, b = S.bones[i];
      const fdir = J[b.name].tail.clone().sub(J[b.name].head).normalize();
      const across = J["index_01_" + side].head.clone().sub(J["pinky_01_" + side].head).normalize();
      ax = P._fax[i] = new THREE.Vector3().crossVectors(across, fdir).normalize();
      if (side === "r") ax.negate();
      if (m[1] === "thumb") ax = P._fax[i] = fdir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    }
    // the parent's rotation already holds the curl of the joints above
    R.multiply(_q.setFromAxisAngle(ax, ang));
  }
  // THE FACE: systems/facial.js's pose (blink, lip gap, mouth / brow
  // expression) read off CBZ.human.facePose into this face's blend shapes
  function faceDrive(P) {
    const f = P.ch._facePoseP, e = P.expr;
    e.fill(0);
    if (f) {
      e[0] = Math.max(0, Math.min(1, f.blink || 0)) * 0.95 + Math.max(0, f.lidU || 0) * 0.6;
      e[1] = Math.max(0, Math.min(1, (f.open || 0) / 0.05));
      if (f.mouth === "smile") e[2] = 0.75;
      else if (f.mouth === "grimace") e[3] = 0.85;
      else if (f.mouth === "fear") e[4] = 0.8;
      else if (f.mouth === "snarl") e[5] = 0.8;
      if (f.brow === "a") e[6] = Math.max(e[6], 0.8);
      else if (f.brow === "f") e[4] = Math.max(e[4], 0.6);
    }
    if (P.pain > 0) {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      const k = P.pain * Math.exp(-(now - (P.painT || now)) / 1600);
      if (k < 0.02) P.pain = 0; else e[3] = Math.max(e[3], k);
    }
    for (const m of P.meshes) {
      const inf = m.morphTargetInfluences;
      if (!inf) continue;
      for (let i = 0; i < inf.length && i < e.length; i++) inf[i] = e[i];
    }
    // the mouth's inside (7.5k triangles of teeth and tongue) draws only
    // while something parts the lips
    const open = e[1] > 0.02 || e[3] > 0.2 || e[4] > 0.2 || e[5] > 0.2 || e[2] > 0.3;
    if (open !== P.mouthOpen) {
      P.mouthOpen = open;
      for (const m of P.meshes) if (m.name === "people:teeth" || m.name === "people:tongue") m.visible = open;
    }
  }
  // the face writer: remember each rig's latest pose (facial.js owns it)
  (function wrapFace() {
    const H = CBZ.human;
    if (!H || typeof H.facePose !== "function" || H.facePose._people) return;
    const orig = H.facePose;
    const w = function (rig, p) { if (rig) rig._facePoseP = p; return orig.apply(this, arguments); };
    w._people = true;
    H.facePose = w;
  })();

  // ================================================================ gore
  // a point on the skin in BIND space: undo the skinning of the bone that
  // owns the nearest joint segment
  function toBind(P, world, out) {
    const g = P.ch.group;
    _gInv.copy(g.matrixWorld).invert();
    const p = _t1.copy(world).applyMatrix4(_gInv);
    let best = -1, bd = 1e9;
    for (let i = 1; i < S.bones.length; i++) {
      const b = S.bones[i];
      if (/^(thumb|index|middle|ring|pinky|ball|Root)/.test(b.name)) continue;
      const h = P.bones[i].matrixWorld, a = _t2.setFromMatrixPosition(h);
      // segment head -> tail in the current pose
      const len = P.J[b.name].tail.distanceTo(P.J[b.name].head);
      const dir = _t3.copy(P.J[b.name].tail).sub(P.J[b.name].head).normalize().applyQuaternion(_q.setFromRotationMatrix(h));
      const t = Math.max(0, Math.min(len, _v.subVectors(p, a).dot(dir)));
      const d = _v2.copy(a).addScaledVector(dir, t).distanceTo(p);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    // world = boneWorld * T(-head) * bind  ->  bind = T(head) * boneWorld^-1 * world
    _m4.copy(P.bones[best].matrixWorld).invert();
    (out || (out = new THREE.Vector3())).copy(p).applyMatrix4(_m4).add(P.J[S.bones[best].name].head);
    out.bone = best;
    return out;
  }
  /* WHERE THE ROUND MET THE SKIN. The body is skinned on the CPU (render
     vertices x their four bone matrices, ~2 ms) and the first vertex along
     the shot line wins (the nearest one to the point when there is no line);
     its BIND position and normal are the wound's, so the hole rides every
     pose after this one. */
  const _bmE = new Float32Array(64 * 16);
  function surfaceHit(P, world, from) {
    const body = P.meshes[0], g = body && body.geometry;
    if (!g) return -1;
    const pa = g.attributes.position.array, si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
    for (let i = 0; i < P.bones.length; i++) {
      _m4.multiplyMatrices(P.bones[i].matrixWorld, P.skeleton.boneInverses[i]);
      _bmE.set(_m4.elements, i * 16);
    }
    _gInv.copy(P.ch.group.matrixWorld).invert();
    const p = _t1.copy(world).applyMatrix4(_gInv);
    let o = null, d = null;
    if (from) { o = _t2.copy(from).applyMatrix4(_gInv); d = _t3.subVectors(p, o); const l = d.length(); if (l < 1e-4) o = null; else d.multiplyScalar(1 / l); }
    let best = -1, bs = 1e9;
    const n = pa.length / 3;
    for (let v = 0; v < n; v++) {
      const x = pa[v * 3], y = pa[v * 3 + 1], z = pa[v * 3 + 2];
      let qx = 0, qy = 0, qz = 0;
      for (let j = 0; j < 4; j++) {
        const w = sw[v * 4 + j];
        if (!w) continue;
        const e = si[v * 4 + j] * 16, k = w / 255;
        qx += k * (_bmE[e] * x + _bmE[e + 4] * y + _bmE[e + 8] * z + _bmE[e + 12]);
        qy += k * (_bmE[e + 1] * x + _bmE[e + 5] * y + _bmE[e + 9] * z + _bmE[e + 13]);
        qz += k * (_bmE[e + 2] * x + _bmE[e + 6] * y + _bmE[e + 10] * z + _bmE[e + 14]);
      }
      if (o) {
        const rx = qx - o.x, ry = qy - o.y, rz = qz - o.z, t = rx * d.x + ry * d.y + rz * d.z;
        if (t <= 0) continue;
        const px = rx - d.x * t, py = ry - d.y * t, pz = rz - d.z * t, perp = Math.sqrt(px * px + py * py + pz * pz);
        if (perp > 0.045) continue;
        // nearest the shooter along the line, ties to the line itself
        const sc = t + perp * 2;
        if (sc < bs) { bs = sc; best = v; }
      } else {
        const dd = (qx - p.x) * (qx - p.x) + (qy - p.y) * (qy - p.y) + (qz - p.z) * (qz - p.z);
        if (dd < bs) { bs = dd; best = v; }
      }
    }
    // a line that grazed nothing: the nearest skin to the point
    if (best < 0 && o) return surfaceHit(P, world, null);
    return best;
  }
  function wound(ch, world, opts) {
    const P = ch && ch._people;
    if (!P) return false;
    opts = opts || {};
    let from = null;
    if (opts.from && opts.from.isVector3) from = opts.from;
    else if (opts.fromX != null && opts.fromZ != null) from = new THREE.Vector3(opts.fromX, world.y + (opts.fromY != null ? opts.fromY - world.y : 0), opts.fromZ);
    else if (opts.dir && (opts.dir.x || opts.dir.z)) from = new THREE.Vector3(world.x - opts.dir.x * 3, world.y - (opts.dir.y || 0) * 3, world.z - opts.dir.z * 3);
    const v = surfaceHit(P, world, from);
    if (v < 0) return false;
    const g = P.meshes[0].geometry;
    const b = new THREE.Vector3().fromBufferAttribute(g.attributes.position, v);
    const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, v).normalize();
    const kind = opts.kind === "cut" || opts.kind === "blade" ? 1 : opts.kind === "burn" ? 2 : opts.kind === "stump" ? 3 : 0;
    const cal = opts.cal != null ? opts.cal : 1;
    const r = opts.radius || (kind === 2 ? 0.07 : kind === 1 ? 0.035 : 0.02 + 0.012 * Math.min(2.5, cal) + Math.min(0.02, (opts.dmg || 0) / 2000));
    const w = { p: b, n: n, kind: kind, r: r, run: opts.run != null ? opts.run : (kind === 2 ? 0 : 0.1 + Math.random() * 0.2 + 0.05 * cal), seed: Math.random(), wet: 1, born: performance.now() };
    P.wounds.push(w);
    if (P.wounds.length > NW) P.wounds.shift();
    P.pain = Math.max(P.pain || 0, 0.85); P.painT = performance.now();
    pushWounds(P);
    return true;
  }
  function pushWounds(P) {
    for (const m of P.mats) {
      const U = m.userData && m.userData.u;
      if (!U || !U.pWound) continue;
      for (let i = 0; i < NW; i++) {
        const w = P.wounds[i];
        if (!w) { U.pWound.value[i].set(0, 0, 0, 0); continue; }
        U.pWound.value[i].set(w.p.x, w.p.y, w.p.z, w.r);
        U.pWoundN.value[i].set(w.n.x, w.n.y, w.n.z, w.kind);
        U.pWoundT.value[i].set(w.wet, w.run, w.seed, 0);
      }
    }
  }
  // DISMEMBERMENT: the chain below the cut collapses into the joint (its
  // skin goes with it), a stump wound opens on the parent, and the limb
  // itself leaves as a real piece of this person (gib), skinned in its pose
  const CHAINS = { la: "upperarm_", ra: "upperarm_", ll: "thigh_", rl: "thigh_", head: "neck_01" };
  function sever(ch, partKey, opts) {
    const P = ch && ch._people;
    if (!P) return false;
    let bone;
    if (partKey === "head") bone = "head";
    else {
      const side = (partKey === P.sides.armL || partKey === P.sides.legL) ? "l" : "r";
      bone = (partKey[1] === "a" ? "upperarm_" : "thigh_") + side;
      if (opts && opts.at === "low") bone = (partKey[1] === "a" ? "lowerarm_" : "calf_") + side;
    }
    if (P.severed[bone]) return false;
    const gib = makeGib(P, bone, opts || {});
    P.severed[bone] = true;
    // the stump: blood round the joint on the parent's skin, the cap over it
    const par = S.bones[S.bix[bone]].parent;
    P.wounds.push({ p: P.J[bone].head.clone(), n: P.J[bone].tail.clone().sub(P.J[bone].head).normalize(), kind: 3,
      r: bone === "head" ? 0.075 : 0.065, run: 0.3, seed: Math.random(), wet: 1, born: performance.now() });
    if (P.wounds.length > NW) P.wounds.shift();
    pushWounds(P);
    addStumpCap(P, bone);
    P.sevJoint = P.sevJoint || {};
    P.sevJoint[bone] = par;
    P.pain = 1; P.painT = performance.now();
    return gib;
  }
  function collapse(P, bone) {
    const bi = S.bix[bone];
    P._scale = P._scale || {};
    // the bone and everything under it shrink to the joint
    const head = _Pp[bi].clone();
    for (let i = bi; i < S.bones.length; i++) {
      let p = i, under = false;
      while (p >= 0) { if (p === bi) { under = true; break; } p = S.bones[p].parent; }
      if (!under) continue;
      _Pp[i].copy(head);
      P._scale[i] = 0.0001;
    }
  }
  function addStumpCap(P, bone) {
    const bi = S.bix[bone], par = S.bones[bi].parent;
    const r = bone === "head" ? 0.055 : /thigh/.test(bone) ? 0.075 : /calf/.test(bone) ? 0.05 : /upperarm/.test(bone) ? 0.05 : 0.038;
    const geo = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1, 0.32, 1);                          // a cut face, barely domed
    // the cap is skinned rigidly to the parent bone, centred on the joint,
    // facing down the severed bone
    const J = P.J, dir = J[bone].tail.clone().sub(J[bone].head).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));   // r128: no applyQuaternion on geometry
    geo.translate(J[bone].head.x, J[bone].head.y, J[bone].head.z);
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = par; sw[i * 4] = 255; }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4, true));
    // flesh, a ring of fat, bone in the middle
    const col = new Float32Array(n * 3), pos = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).sub(J[bone].head);
      const rad = _v.clone().addScaledVector(dir, -_v.dot(dir)).length() / r;
      const jit = 0.08 * Math.sin(i * 12.9898) * Math.sin(i * 4.1414);
      const c = rad < 0.16 ? [0.82, 0.76, 0.64] : rad < 0.21 ? [0.36, 0.03, 0.03] : rad < 0.8 ? [0.36 + jit, 0.025, 0.03] :
        rad < 0.9 ? [0.74, 0.6, 0.36] : [0.5, 0.12, 0.1];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = pbr(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, skinning: true }));
    addMesh(P, geo, mat, "stump:" + bone, { cast: true });
  }
  // a CPU-skinned copy of everything this bone chain owns, frozen in its
  // current pose, in WORLD space: gore.js (or anyone) can throw it
  function makeGib(P, bone, opts) {
    const bi = S.bix[bone];
    const owned = new Uint8Array(S.bones.length);
    for (let i = 0; i < S.bones.length; i++) { let p = i; while (p >= 0) { if (p === bi) { owned[i] = 1; break; } p = S.bones[p].parent; } }
    const grp = new THREE.Group();
    grp.name = "people-gib:" + bone;
    const bm = P.bones.map(function (b, i) { return new THREE.Matrix4().multiplyMatrices(b.matrixWorld, P.skeleton.boneInverses[i]); });
    const gw = P.ch.group.matrixWorld;
    for (const m of P.meshes) {
      const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pa = g.attributes.position, idx = g.index;
      if (!si || !idx || /^people:stump/.test(m.name)) continue;
      const n = pa.count, keep = new Uint8Array(n);
      let any = false;
      for (let v = 0; v < n; v++) {
        let own = 0, tot = 0;
        for (let j = 0; j < 4; j++) { const w = sw.array[v * 4 + j] / 255; tot += w; if (owned[si.array[v * 4 + j]]) own += w; }
        if (own > 0.5 * (tot || 1)) { keep[v] = 1; any = true; }
      }
      if (!any) continue;
      const remap = new Int32Array(n).fill(-1), P2 = [], N2 = [], U2 = [], I2 = [];
      const uv = g.attributes.uv, nm = g.attributes.normal;
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.array[t], b = idx.array[t + 1], c = idx.array[t + 2];
        if (!(keep[a] && keep[b] && keep[c])) continue;
        for (const v of [a, b, c]) {
          if (remap[v] < 0) {
            remap[v] = P2.length / 3;
            _v.set(0, 0, 0); _v2.set(0, 0, 0);
            for (let j = 0; j < 4; j++) {
              const w = sw.array[v * 4 + j] / 255;
              if (!w) continue;
              _v3.fromBufferAttribute(pa, v).applyMatrix4(bm[si.array[v * 4 + j]]);
              _v.addScaledVector(_v3, w);
              _v3.fromBufferAttribute(nm, v).transformDirection(bm[si.array[v * 4 + j]]);
              _v2.addScaledVector(_v3, w);
            }
            _v.applyMatrix4(gw); _v2.transformDirection(gw);
            P2.push(_v.x, _v.y, _v.z); N2.push(_v2.x, _v2.y, _v2.z);
            if (uv) U2.push(uv.getX(v), uv.getY(v));
          }
          I2.push(remap[v]);
        }
      }
      if (!I2.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P2, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(N2, 3));
      if (U2.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(U2, 2));
      const src = m.material, cl = src.userData && src.userData.cloth;
      if (cl && cl.print && m.geometry.attributes.atlasA) {
        // a print keeps its painted panel: copy the atlas UVs as the uv
        const at = m.geometry.attributes.atlasA, A2 = new Float32Array(P2.length / 3 * 2);
        for (let v = 0; v < n; v++) if (remap[v] >= 0) { A2[remap[v] * 2] = at.getX(v); A2[remap[v] * 2 + 1] = at.getY(v); }
        geo.setAttribute("uv", new THREE.BufferAttribute(A2, 2));
      }
      let vcol = false;
      if (cl && !cl.print && m.geometry.attributes.zone) {
        // real cloth: each vertex its zone's dye (a kept zone, its own mean)
        const zt = m.geometry.attributes.zone, C2 = new Float32Array(P2.length);
        for (let v = 0; v < n; v++) {
          if (remap[v] < 0) continue;
          const z = Math.max(0, Math.min(5, Math.round(zt.getX(v)))), c = cl.zc[z], p = cl.zp[z];
          // a kept zone (trim, a real shirt) stands as a neutral of its own mean
          const k = p.y * 1.4, r = remap[v] * 3;
          C2[r] = p.z > 0.5 ? k : c.x; C2[r + 1] = p.z > 0.5 ? k : c.y; C2[r + 2] = p.z > 0.5 ? k : c.z;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(C2, 3));
        vcol = true;
      }
      geo.setIndex(I2);
      const mat = vcol ? new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: src.roughness != null ? src.roughness : 0.85, normalMap: src.normalMap || null })
        : (src.map || src.color ? new THREE.MeshStandardMaterial({ map: src.map || null, color: src.color ? src.color.clone() : 0xffffff,
          roughness: src.roughness != null ? src.roughness : 0.7, transparent: !!src.transparent, alphaTest: src.alphaTest || 0, side: src.side }) : src);
      if (m === P.meshes[0] && P.skinMat) {
        const t = P.skinMat.userData.u.pTone.value;
        mat.color.setRGB(t.x, t.y, t.z);
      }
      const gm = new THREE.Mesh(geo, mat);
      gm.castShadow = true;
      grp.add(gm);
    }
    // centred on the joint it left from, so it tumbles about that end
    const pivot = new THREE.Vector3().setFromMatrixPosition(P.bones[bi].matrixWorld).applyMatrix4(gw);
    for (const gm of grp.children) gm.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
    grp.position.copy(pivot);
    grp.userData.bone = bone;
    grp.userData.person = P;
    grp.userData.pivot = pivot;
    return grp;
  }

  // ================================================================ public
  function attach(ch, look, opts) {
    if (CBZ.CONFIG.PEOPLE_SKINNED === false) return false;
    if (!S.ready || !ch || !ch.group) return false;
    if (ch._people) return true;
    let P;
    try { P = build(ch, look || {}, opts || {}); }
    catch (e) { if (typeof console !== "undefined") console.error("people.attach", e); return false; }
    if (!P) return false;
    P.manual = !(opts && opts.auto);
    ch._people = P;
    live.add(P);
    return true;
  }
  function detach(ch) {
    const P = ch && ch._people;
    if (!P) return false;
    for (const h of P.hidden) h[0].layers.mask = h[1];
    if (P.hatClones) P.hatClones.forEach(function (cl) { if (cl && cl.geometry) cl.geometry.dispose(); });
    if (P.driver && P.driver.parent) P.driver.parent.remove(P.driver);
    if (P.root && P.root.parent) P.root.parent.remove(P.root);
    const done = new Set();
    for (const m of P.meshes) {
      // only THIS person's buffers go (positions, normals, a body index):
      // the uv / skin / atlas / morph / asset-index buffers are shared by
      // every person and r128's dispose would free them all
      const g = m.geometry;
      if (g && !done.has(g)) {
        done.add(g);
        if (!g.userData.own) for (const k of ["uv", "skinIndex", "skinWeight", "atlasA", "atlasB", "zone"]) if (g.attributes[k]) g.deleteAttribute(k);
        if (g.index && g.index._peopleShared) g.setIndex(null);
        g.morphAttributes = {};
        g.dispose();
      }
      if (m.material && m.material.dispose) m.material.dispose();
    }
    if (P.skeleton && P.skeleton.dispose) P.skeleton.dispose();
    live.delete(P);
    ch._people = null;
    return true;
  }
  /* ================================================================ LOD
     THE NEAREST PEOPLE ARE REAL. Every ~10 frames: the full-rig people the
     game runs (CBZ.cityPeds / cityCops / npcs, plus any list a mode adds with
     CBZ.people.track) inside PEOPLE_NEAR metres of the camera, nearest first,
     up to PEOPLE_MAX, wear a real body; past PEOPLE_FAR (hysteresis) or out
     of the lists they go back to the procedural one, which pedinstance.js
     pools again. Builds spend ~12 ms a tick (one at least, three at most).
     A rig that is re-dressed (its outfit key changes) is rebuilt in the new
     clothes. */
  const lists = [];
  function track(name) { if (lists.indexOf(name) < 0) lists.push(name); }
  ["cityPeds", "cityCops", "npcs"].forEach(track);
  const isTouch = typeof navigator !== "undefined" && (navigator.maxTouchPoints > 1 || /iPhone|iPad|Android/i.test(navigator.userAgent || ""));
  if (CBZ.CONFIG.PEOPLE_MAX == null) CBZ.CONFIG.PEOPLE_MAX = isTouch ? 8 : 18;
  if (CBZ.CONFIG.PEOPLE_NEAR == null) CBZ.CONFIG.PEOPLE_NEAR = 28;
  if (CBZ.CONFIG.PEOPLE_FAR == null) CBZ.CONFIG.PEOPLE_FAR = 34;
  let lodTick = 0;
  const _cand = [];
  function manage() {
    if (CBZ.CONFIG.PEOPLE_SKINNED === false) { if (live.size) Array.from(live).forEach(function (P) { detach(P.ch); }); return; }
    if (++lodTick % 10) return;
    const cam = CBZ.camera;
    if (!cam) return;
    const ce = cam.matrixWorld.elements, cx = ce[12], cy = ce[13], cz = ce[14];
    const near2 = CBZ.CONFIG.PEOPLE_NEAR * CBZ.CONFIG.PEOPLE_NEAR, far2 = CBZ.CONFIG.PEOPLE_FAR * CBZ.CONFIG.PEOPLE_FAR;
    _cand.length = 0;
    const inList = new Set();
    for (const nm of lists) {
      const L = CBZ[nm];
      if (!L || !L.length) continue;
      for (let i = 0; i < L.length; i++) {
        const a = L[i], ch = a && a.char;
        if (!ch || !ch.group || !ch.skinSlots || !ch.parts || inList.has(ch)) continue;
        inList.add(ch);
        // a hidden ped (riding in a car, going through a door, not yet
        // revealed) is drawn by nobody, so it earns no new body; one that is
        // already real keeps it, so a short hide never costs a rebuild
        if (a.culled || !ch.group.parent || !ch.group.visible && !ch._people || ch.child && (ch.ageYears || 10) < 5) continue;
        const e = ch.group.matrixWorld.elements, dx = e[12] - cx, dy = e[13] - cy, dz = e[14] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < (ch._people ? far2 : near2)) _cand.push([d2, ch]);
      }
    }
    if (!_cand.length && !live.size) return;
    if (!S.ready) { if (_cand.length && !loading) ready(); return; }
    _cand.sort(function (a, b) { return a[0] - b[0]; });
    const keep = new Set();
    for (let i = 0; i < _cand.length && keep.size < CBZ.CONFIG.PEOPLE_MAX; i++) keep.add(_cand[i][1]);
    // out: gone from the lists, detached, too far, over the cap, or re-dressed
    Array.from(live).forEach(function (P) {
      const ch = P.ch;
      if (P.manual) return;
      if (!keep.has(ch) || !ch.group.parent || ch._clothesKey !== P.clothesKey || (ch.look && ch.look !== P.look)) detach(ch);
    });
    // a frame budget, not a count: people keep coming in until ~12 ms of
    // building is spent (one at least, three at most); a tick that builds no
    // one works out one queued outfit's markings instead
    let built = 0;
    const t0 = performance.now();
    for (const ch of keep) {
      if (ch._people) continue;
      if (built >= 3 || (built >= 1 && performance.now() - t0 > 12)) break;
      if (attach(ch, ch.look || {}, { auto: true })) built++;
    }
    if (!built) marksPump();
  }
  if (CBZ.onAlways) CBZ.onAlways(95.8, manage);

  CBZ.people = {
    ready: ready, attach: attach, detach: detach, wound: wound, sever: sever, track: track, manage: manage,
    pending: function () { return pendingTex; },
    // the wardrobe's own view of an outfit (tools/people/wardrobe-look.mjs)
    _wardrobe: { table: WARDROBE, palette: function (worn) { return paletteOf(worn); }, marks: function (worn) { return marksOf(worn); } },
    failed: function () { return failed; },
    loaded: function () { return !!S.ready; },
    stats: function () {
      let tris = 0;
      live.forEach(function (P) { for (const m of P.meshes) tris += (m.geometry.index ? m.geometry.index.count : 0) / 3; });
      return { people: live.size, tris: Math.round(tris), assets: Object.keys(assetCache).length, textures: Object.keys(texCache).length, pending: pendingTex };
    },
    _S: S, _live: live,
  };
})();
