/* ============================================================
   entities/heritage.js — WHO IS IN THIS PRISON, AND WHICH CAR HE RUNS WITH.

   OWNER (2026-09-05): different races in the jail game, men only.
   OWNER (2026-09-28): "look at the colorful bands on people's arms. That's
   really dumb. Instead of a colorful band showing what gang you're in, it's
   the race. We already have races. Make races more clear and make more of
   them. And those are the gangs. That's how it is in real life."

   A real US state-prison yard sorts itself into racial "cars": the Southern
   Mexican-American car, the Black car, the White car, the Paisas (Mexican
   nationals, who run apart from the Southsiders), the Asians, and "the
   others" (everyone the big four don't absorb). No armband says which car a
   man is in — his FACE does, his hair, and above all his INK. So this file
   authors people, and every heritage names the car it rides in (`car`); the
   yard politics (systems/prisoncars.js, ai.js) read `CBZ.heritageCar(id)` and
   never paint a colour on anybody.

   SIXTEEN HERITAGES, each a coherent look with real variation inside it —
   a skin RANGE (neighbouring groups overlap, as they do in life), hair colour
   + style odds, bald odds, facial-hair odds, eye colours, nose / lips / lid
   weights, grey-hair odds, tattoo odds + which INK SETS, and how likely the
   jumpsuit top is tied at the waist over a tank (the only way arm ink shows).
   The weights are the shape of a US state prison's men: ~33% Black, ~30%
   White, ~24% Hispanic, ~4% Asian, and the rest.

   One roll (heritageRoll) produces a complete `look` that IS a character.js
   colour object — makeCharacter(look) builds the body, heritageApply(ch, look)
   stamps the tags the wardrobe reads and hands his ink family to
   entities/tattoo.js, which draws the pieces and inks whatever of him is
   bare skin (tank arms, hands, face, throat). Ink multiplies under the skin
   colour, so reactions.js's flash / gore's corpse tint / mugshot's skinTone
   read all keep working.

   THE INK IS THE REAL IDENTIFIER. Each car has its ink cultures, drawn as
   the pieces those cultures wear (tattoo.js). Words are real words, numbers
   are area codes and home states; no real gang's name or symbol is drawn:
     chicano    fine-line black-and-grey: a rose or the two masks in clouds,
                script across the forearm, an area code in old english, a
                rosary at the wrist, throat script, three dots by the eye
     paisa      sparse: his home state in script, a small star or cross
     dots       dotted marks by the eye and down the forearm
     block      area codes in old english, a banner, knuckle letters
     script     one word down the inside of the forearm / on the throat
     teardrop   one teardrop under the eye
     web        a spiderweb over the elbow / on the neck
     blackwork  the heaviest set: barbed wire, skulls, dice, webs on the
                elbows and behind the ear, a packed band at the wrist
     vory       eight-point stars, domes, a dagger, finger rings
     sleeve     irezumi: wind bars, blossoms, a wave sea
     yant       rows of Khom-style script, the nine spires
     batok      geometric linework bands
     tribal     Polynesian bands
     chest      under the shirt: nothing shows on head or arm
   The old "skinhead" heritage is GONE as a race: a subculture is not an
   ethnicity. heritageRoll("skinhead") still answers (old callers) with a
   white man, shaved, in the blackwork set; "skinhead" still paints as an ink
   key, and it paints the blackwork set.

   API
     CBZ.HERITAGE                    the catalogue (id -> def), CBZ.HERITAGE_IDS
     CBZ.HERITAGE_CARS               the six car ids
     CBZ.heritageCar(id)             -> car id ("south" … "others"), null if unknown
     CBZ.heritagesOfCar(car)         -> [heritage ids] riding in that car
     CBZ.heritageRoll(id?, rng?, o?) -> look (a makeCharacter colour object +
                                       {heritage, yardCar, beard, bald, ink, tank};
                                       the rig gets ch.heritage / ch.yardCar / ch.ink —
                                       `yardCar`, because `.car` means a vehicle here)
     CBZ.heritageRollCar(car, rng?, o?) -> a look from that car, weighted
     CBZ.heritageApply(ch, look)     stamp the tags and hand his ink to tattoo.js
     CBZ.heritageCensus()            live counts (preset metric)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const CARS = ["south", "black", "white", "paisa", "asian", "others"];

  // ---- the catalogue -------------------------------------------------------
  // car      the yard car he rides with (one of CARS)
  // weight   share of the anonymous crowd (US state-prison shape, men only; sums to 100)
  // skins    the RANGE — every roll picks one, so brothers still differ. The
  //          game's exposure lifts every tone ~a stop, so ranges start darker
  //          than the hex suggests.
  // hair     colour pool; styles: weighted character.js HAIR_STYLES ids
  // bald     odds of a shaved head (no hair mesh at all)
  // beard    odds per facial-hair style (character.js c.beard), first hit wins
  // grey     odds his hair (and beard) has gone grey — the old-timers
  // ink      odds of tattoos at all; sets: which ink set when inked
  // tank     odds the jumpsuit top is tied at the waist over a tank (bare arms)
  // eyes     weighted eye colours (names from CBZ.human.eyeColours)
  // nose     weights for [narrow, medium, broad] (character.js head variants)
  // lips     odds of fuller lips
  // lids     weights for [round, almond, hooded/monolid] (character.js c.eyeShape)
  const BLACKHAIR = [0x141010, 0x1a120c, 0x0d0b0a];
  const H = {
    // ---------------------------------------------------------------- BLACK CAR
    black: { name: "Black", car: "black", weight: 29,
      skins: [0x8a5e3e, 0x7a5236, 0x6b4a32, 0x5a3c28, 0x4a3020, 0x3c2618, 0x2e1c12],
      hair: BLACKHAIR, styles: [["buzz", 5], ["short", 2], ["crop", 2], ["curly", 2], ["afro", 1], ["locs", 1.5]],
      bald: 0.20, beard: { full: 0.20, goatee: 0.28, moustache: 0.06, stubble: 0.15 }, grey: 0.07,
      ink: 0.50, sets: [["block", 3], ["script", 3], ["chest", 2], ["teardrop", 1], ["web", 0.5]], tank: 0.38,
      eyes: [["dark", 8], ["brown", 2]], nose: [1, 3, 6], lips: 0.70, lids: [4, 5, 1] },
    caribbean: { name: "Afro-Caribbean (Jamaican / Haitian)", car: "black", weight: 4,
      skins: [0x6b4a32, 0x5a3c28, 0x4a3020, 0x3c2618, 0x2e1c12, 0x241610],
      hair: BLACKHAIR, styles: [["locs", 5], ["buzz", 3], ["short", 2], ["afro", 1], ["curly", 1]],
      bald: 0.10, beard: { full: 0.28, goatee: 0.18, stubble: 0.18 }, grey: 0.06,
      ink: 0.35, sets: [["script", 3], ["block", 1], ["chest", 1]], tank: 0.35,
      eyes: [["dark", 8], ["brown", 2]], nose: [1, 3, 6], lips: 0.72, lids: [4, 5, 1] },
    // ---------------------------------------------------------------- WHITE CAR
    white: { name: "White", car: "white", weight: 25,
      skins: [0xfae0c8, 0xf5d3b3, 0xf0c39a, 0xe8c39a, 0xe8b58c, 0xe8b096, 0xd9b08e],
      hair: [0x4a3526, 0x2a2018, 0x7a4a2e, 0xb08a4a, 0xa3401f, 0x8c7a68, 0x5a4636],
      styles: [["short", 4], ["crop", 3], ["buzz", 4], ["long", 1], ["pony", 0.4]],
      bald: 0.18, beard: { full: 0.22, goatee: 0.20, stubble: 0.22, moustache: 0.08 }, grey: 0.10,
      ink: 0.55, sets: [["web", 2], ["script", 2], ["blackwork", 1.5], ["teardrop", 0.5]], tank: 0.40,
      eyes: [["brown", 3], ["hazel", 2], ["blue", 3], ["green", 1.5], ["grey", 1]], nose: [4, 5, 1], lips: 0.15, lids: [3, 6, 1] },
    easteuro: { name: "Eastern European", car: "white", weight: 5,
      skins: [0xfae0c8, 0xf0c39a, 0xecc6a3, 0xe8b58c, 0xf5d3b3],
      hair: [0x4a3526, 0x2a2018, 0x8c7a68, 0xb08a4a, 0x6a5a48], styles: [["buzz", 5], ["short", 2], ["crop", 1]],
      bald: 0.32, beard: { stubble: 0.35, goatee: 0.08, full: 0.06 }, grey: 0.10,
      ink: 0.75, sets: [["vory", 4], ["web", 1]], tank: 0.55,
      eyes: [["blue", 4], ["grey", 3], ["green", 2], ["brown", 2], ["hazel", 1]], nose: [3, 6, 1], lips: 0.10, lids: [3, 6, 1] },
    // ----------------------------------------------------------- SOUTH (SUR) CAR
    latino: { name: "Mexican-American", car: "south", weight: 11,
      skins: [0xe0b48e, 0xd9a983, 0xd8a177, 0xc08a5a, 0xb5825a, 0xb67b52, 0xa87049],
      hair: [0x101820, 0x1a120c, 0x0d0b0a], styles: [["buzz", 7], ["short", 2], ["crop", 2], ["curly", 0.5]],
      bald: 0.42, beard: { goatee: 0.38, moustache: 0.20, stubble: 0.15 }, grey: 0.05,
      ink: 0.88, sets: [["chicano", 5], ["dots", 1], ["teardrop", 1], ["script", 1]], tank: 0.62,
      eyes: [["dark", 3], ["brown", 5], ["hazel", 2], ["amber", 1]], nose: [2, 5, 3], lips: 0.30, lids: [3, 6, 1] },
    centralam: { name: "Central American (Salvadoran / Guatemalan / Honduran)", car: "south", weight: 4,
      skins: [0xc08a5a, 0xb67b52, 0xa87049, 0x9c6a45, 0x8a5a3a],
      hair: [0x0d0b0a, 0x101820, 0x141010], styles: [["buzz", 5], ["short", 3], ["crop", 2]],
      bald: 0.28, beard: { goatee: 0.22, moustache: 0.18, stubble: 0.15 }, grey: 0.04,
      ink: 0.60, sets: [["script", 2], ["chicano", 2], ["dots", 2], ["teardrop", 0.5]], tank: 0.50,
      eyes: [["dark", 6], ["brown", 4]], nose: [2, 5, 3], lips: 0.35, lids: [2, 6, 2] },
    carlatino: { name: "Caribbean Latino (Puerto Rican / Dominican / Cuban)", car: "south", weight: 4,
      skins: [0xe8c39a, 0xd9a983, 0xc08a5a, 0xa87049, 0x8a5e3e, 0x7a5236, 0x5a3c28],
      hair: [0x0d0b0a, 0x1a120c, 0x2a2018, 0x3a2a1e], styles: [["curly", 5], ["short", 3], ["crop", 2], ["buzz", 2], ["afro", 0.6]],
      bald: 0.12, beard: { goatee: 0.32, full: 0.15, stubble: 0.20, moustache: 0.06 }, grey: 0.06,
      ink: 0.60, sets: [["script", 3], ["chicano", 1], ["web", 1], ["block", 1]], tank: 0.45,
      eyes: [["brown", 5], ["dark", 4], ["hazel", 2], ["green", 0.5]], nose: [2, 5, 3], lips: 0.45, lids: [3, 6, 1] },
    // ---------------------------------------------------------------- PAISA CAR
    mexican: { name: "Mexican national (Paisa)", car: "paisa", weight: 5,
      skins: [0xc08a5a, 0xb67b52, 0xb5825a, 0xa87049, 0x9c6a45, 0x8a5a3a],
      hair: [0x0d0b0a, 0x141010, 0x1a120c], styles: [["short", 5], ["crop", 3], ["buzz", 2]],
      bald: 0.06, beard: { moustache: 0.45, stubble: 0.18, goatee: 0.10 }, grey: 0.12,
      ink: 0.25, sets: [["paisa", 4], ["script", 1]], tank: 0.30,
      eyes: [["dark", 6], ["brown", 4]], nose: [2, 4, 4], lips: 0.30, lids: [2, 6, 2] },
    // ---------------------------------------------------------------- ASIAN CAR
    eastasian: { name: "East Asian (Chinese / Korean / Japanese)", car: "asian", weight: 1.5,
      skins: [0xf5d3b3, 0xf0d0a8, 0xe8c39a, 0xe0b894, 0xd9b08e],
      hair: [0x0d0b0a, 0x101820], styles: [["short", 3], ["crop", 3], ["buzz", 2]],
      bald: 0.05, beard: { stubble: 0.12, goatee: 0.08, moustache: 0.04 }, grey: 0.06,
      ink: 0.40, sets: [["sleeve", 4], ["script", 1]], tank: 0.30,
      eyes: [["dark", 7], ["brown", 3]], nose: [3, 5, 2], lips: 0.15, lids: [1, 3, 6] },
    seasian: { name: "Southeast Asian (Vietnamese / Cambodian / Laotian / Hmong)", car: "asian", weight: 1.5,
      skins: [0xd9aa7c, 0xd0a070, 0xc4925f, 0xb5825a, 0xa87049],
      hair: [0x0d0b0a, 0x101820, 0x141010], styles: [["short", 3], ["crop", 3], ["buzz", 3]],
      bald: 0.08, beard: { stubble: 0.12, goatee: 0.10, moustache: 0.08 }, grey: 0.04,
      ink: 0.60, sets: [["yant", 3], ["sleeve", 2], ["script", 2], ["dots", 1]], tank: 0.45,
      eyes: [["dark", 7], ["brown", 3]], nose: [2, 5, 3], lips: 0.30, lids: [1, 4, 5] },
    filipino: { name: "Filipino", car: "asian", weight: 1,
      skins: [0xd4a77a, 0xc99a68, 0xb88a5a, 0xb5825a, 0xa87a4f],
      hair: [0x0d0b0a, 0x101820, 0x1a120c], styles: [["short", 4], ["crop", 3], ["buzz", 2], ["curly", 0.5]],
      bald: 0.08, beard: { stubble: 0.14, goatee: 0.14, moustache: 0.10 }, grey: 0.05,
      ink: 0.55, sets: [["batok", 3], ["script", 2], ["tribal", 1]], tank: 0.45,
      eyes: [["dark", 7], ["brown", 3]], nose: [2, 5, 3], lips: 0.35, lids: [2, 5, 3] },
    // --------------------------------------------------------------- THE OTHERS
    native: { name: "Native American", car: "others", weight: 2.5,
      skins: [0xc4835a, 0xb06f48, 0xa8683f, 0x9c5f3c, 0x8a5236],
      hair: [0x0d0b0a, 0x141010], styles: [["long", 4], ["pony", 4], ["short", 2], ["buzz", 1]],
      bald: 0.04, beard: { stubble: 0.10, moustache: 0.05 }, grey: 0.08,
      ink: 0.40, sets: [["script", 2], ["chest", 2], ["web", 1], ["dots", 1]], tank: 0.35,
      eyes: [["dark", 6], ["brown", 4]], nose: [1, 4, 5], lips: 0.20, lids: [2, 5, 3] },
    islander: { name: "Pacific Islander (Samoan / Tongan / Hawaiian)", car: "others", weight: 1.5,
      skins: [0xbc855a, 0xb0784e, 0xa87049, 0x9c6a45, 0x8a5a3a],
      hair: [0x0d0b0a, 0x141010], styles: [["buzz", 3], ["short", 3], ["crop", 2], ["bun", 1.5], ["curly", 2]],
      bald: 0.12, beard: { goatee: 0.30, full: 0.22, stubble: 0.20 }, grey: 0.05,
      ink: 0.88, sets: [["tribal", 1]], tank: 0.72,
      eyes: [["dark", 6], ["brown", 4]], nose: [1, 3, 6], lips: 0.55, lids: [3, 5, 2] },
    mideast: { name: "Middle Eastern", car: "others", weight: 1.5,
      skins: [0xe0c09a, 0xdcb691, 0xd0b08a, 0xc9a27a, 0xb58a62],
      hair: [0x0d0b0a, 0x1a120c, 0x2a2018], styles: [["short", 4], ["crop", 2], ["buzz", 2], ["curly", 1]],
      bald: 0.15, beard: { full: 0.50, stubble: 0.30, goatee: 0.08 }, grey: 0.08,
      ink: 0.12, sets: [["script", 1]], tank: 0.15,
      eyes: [["brown", 5], ["dark", 3], ["hazel", 2], ["green", 1]], nose: [2, 5, 3], lips: 0.20, lids: [3, 6, 1] },
    southasian: { name: "South Asian", car: "others", weight: 1,
      skins: [0xc49870, 0xb5825a, 0xa87049, 0x9c6a45, 0x8a5a3a, 0x7a4a2e, 0x6b4028],
      hair: [0x0d0b0a, 0x141010], styles: [["short", 4], ["crop", 2], ["buzz", 2], ["curly", 0.5]],
      bald: 0.10, beard: { full: 0.38, stubble: 0.30, moustache: 0.18 }, grey: 0.08,
      ink: 0.15, sets: [["script", 1]], tank: 0.20,
      eyes: [["dark", 6], ["brown", 3], ["hazel", 1]], nose: [2, 5, 3], lips: 0.25, lids: [3, 6, 1] },
    mixed: { name: "Mixed race", car: "others", weight: 2.5,
      skins: [0xe0b48e, 0xd9a983, 0xc08a5a, 0xa87049, 0x8a5e3e, 0x7a5236, 0x6b4a32],
      hair: [0x0d0b0a, 0x1a120c, 0x2a2018, 0x4a3526], styles: [["curly", 4], ["short", 3], ["buzz", 3], ["crop", 2], ["afro", 1], ["locs", 0.5]],
      bald: 0.14, beard: { goatee: 0.24, stubble: 0.20, full: 0.12 }, grey: 0.05,
      ink: 0.50, sets: [["script", 3], ["block", 1], ["web", 1], ["sleeve", 1], ["chest", 1]], tank: 0.40,
      eyes: [["brown", 5], ["dark", 3], ["hazel", 2], ["green", 0.6], ["amber", 0.6]], nose: [2, 5, 3], lips: 0.45, lids: [3, 6, 1] },
  };
  const IDS = Object.keys(H);
  let totalW = 0;
  for (let i = 0; i < IDS.length; i++) totalW += H[IDS[i]].weight;
  // old ids that are no longer a heritage: id -> {as, over} (applied under the caller's own `over`)
  const ALIAS = {
    skinhead: { as: "white", over: { bald: true, hairStyle: "buzz", ink: "blackwork", tank: true } },
  };

  function heritageCar(id) {
    if (!id) return null;
    if (H[id]) return H[id].car;
    if (ALIAS[id]) return H[ALIAS[id].as].car;
    return null;
  }
  function heritagesOfCar(car) { return IDS.filter((id) => H[id].car === car); }

  // ---- rolling -------------------------------------------------------------
  function pickW(list, r) {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += list[i][1];
    let x = r * t;
    for (let i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function pick(list, r) { return list[Math.min(list.length - 1, (r * list.length) | 0)]; }
  function rollId(r, ids) {
    const pool = ids || IDS;
    let tw = totalW;
    if (ids) { tw = 0; for (let i = 0; i < pool.length; i++) tw += H[pool[i]].weight; }
    let x = r * tw;
    for (let i = 0; i < pool.length; i++) { x -= H[pool[i]].weight; if (x <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  // a deterministic rng from a name, so a named man looks the same every boot.
  // mulberry32 over an FNV-1a hash. The old one was a bare mod-2^31 LCG: every
  // roll eats a near-fixed number of draws, so the heritage draw sampled the
  // LCG's lattice and a 20k-man census came out with the South car 3 points
  // short and the Islanders 1 point over the weights.
  function seeded(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    let s = h >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toRng(rng) { return typeof rng === "function" ? rng : (typeof rng === "string" ? seeded(rng) : Math.random); }
  // grey: the colour pulled most of the way to a cool silver, keeping a hint of what it was
  function greyOf(hex, r) {
    const g = r < 0.5 ? 0x9a9690 : 0xc8c4bc, t = 0.72;
    const a = [hex >> 16 & 255, hex >> 8 & 255, hex & 255], b = [g >> 16 & 255, g >> 8 & 255, g & 255];
    return (Math.round(a[0] + (b[0] - a[0]) * t) << 16) | (Math.round(a[1] + (b[1] - a[1]) * t) << 8) | Math.round(a[2] + (b[2] - a[2]) * t);
  }
  function rollFrom(id, r) {
    const d = H[id];
    const look = {
      heritage: id,
      yardCar: d.car,
      skin: pick(d.skins, r()),
      hair: pick(d.hair, r()),
      hairStyle: pickW(d.styles, r()),
      bald: r() < d.bald,
      beard: null, ink: "", tank: false,
    };
    // facial hair: one style at most, odds independent per style, first hit wins
    const bk = Object.keys(d.beard);
    for (let i = 0; i < bk.length; i++) if (r() < d.beard[bk[i]]) { look.beard = bk[i]; break; }
    if (r() < d.ink) look.ink = pickW(d.sets, r());
    look.tank = r() < d.tank;
    // FEATURES (character.js reads c.eye / c.nose / c.lips / c.eyeShape)
    const EC = (CBZ.human && CBZ.human.eyeColours) || null;
    const eyeName = d.eyes ? pickW(d.eyes, r()) : null;
    if (EC && eyeName && EC[eyeName] != null) look.eye = EC[eyeName];
    const nw = d.nose || [1, 2, 1];
    look.nose = pickW([[0, nw[0]], [1, nw[1]], [2, nw[2]]], r());
    look.lips = r() < (d.lips || 0);
    const lw = d.lids || [3, 6, 1];
    look.eyeShape = pickW([[0, lw[0]], [1, lw[1]], [2, lw[2]]], r());
    // the old-timers: the hair goes grey (character.js tones the brows and a
    // stubble off c.hair, so they follow). Drawn last to keep the stream above.
    const gr = r(), gs = r();
    if (gr < (d.grey || 0)) look.hair = greyOf(look.hair, gs);
    return look;
  }
  function heritageRoll(id, rng, over) {
    const r = toRng(rng);
    const inkSeed = typeof rng === "string" ? "ink|" + rng : null;
    const alias = id && ALIAS[id];
    if (alias) id = alias.as;
    if (!id || !H[id]) id = rollId(r());
    const look = rollFrom(id, r);
    if (alias) Object.assign(look, alias.over);
    if (over) Object.assign(look, over);
    if (inkSeed && look.inkSeed == null) look.inkSeed = inkSeed;
    return look;
  }
  // a man of a CAR: the heritage inside the car by weight, then the look
  function heritageRollCar(car, rng, over) {
    const r = toRng(rng);
    const ids = heritagesOfCar(car);
    const look = heritageRoll(ids.length ? rollId(r(), ids) : null, r, over);
    if (typeof rng === "string" && look.inkSeed == null) look.inkSeed = "ink|" + rng;
    return look;
  }

  // ---- apply to a built rig ------------------------------------------------
  function heritageApply(ch, look) {
    if (!ch || !look) return false;
    ch.heritage = look.heritage || null;
    ch.yardCar = look.yardCar || heritageCar(look.heritage) || null;
    ch.ink = look.ink || "";
    ch.beardStyle = look.beard || null;
    // his ink: the family is his car's ink culture; entities/tattoo.js draws
    // the pieces (arms, hands, face and neck) and inks whatever is bare
    if (CBZ.tattoo) CBZ.tattoo.assign(ch, ch.ink, { seed: look.inkSeed || null });
    return true;
  }

  function heritageCensus(list) {
    const rows = list || (CBZ.npcs || []).map((n) => n && n.char);
    const out = { actors: 0, byHeritage: {}, byCar: {}, inked: 0, bearded: 0, bald: 0, tank: 0, skins: {} };
    for (let i = 0; i < rows.length; i++) {
      const ch = rows[i]; if (!ch) continue;
      out.actors++;
      if (ch.heritage) {
        out.byHeritage[ch.heritage] = (out.byHeritage[ch.heritage] || 0) + 1;
        const car = ch.yardCar || heritageCar(ch.heritage);
        if (car) out.byCar[car] = (out.byCar[car] || 0) + 1;
      }
      if (ch.ink) out.inked++;
      if (ch.beardStyle) out.bearded++;
      if (ch.skinSlots && ch.skinSlots.hair && !ch.skinSlots.hair.length && !(ch.skinSlots.cap && ch.skinSlots.cap.length)) out.bald++;
      if (ch._prisonOutfitKey === "inmate_tank") out.tank++;
      if (ch.skinTone != null) out.skins[ch.skinTone] = 1;
    }
    out.distinctSkins = Object.keys(out.skins).length;
    delete out.skins;
    return out;
  }

  CBZ.HERITAGE = H;
  CBZ.HERITAGE_IDS = IDS;
  CBZ.HERITAGE_CARS = CARS;
  CBZ.heritageCar = heritageCar;
  CBZ.heritagesOfCar = heritagesOfCar;
  CBZ.heritageRoll = heritageRoll;
  CBZ.heritageRollCar = heritageRollCar;
  CBZ.heritageApply = heritageApply;
  CBZ.heritageSeeded = seeded;
  CBZ.heritageCensus = heritageCensus;
})();
