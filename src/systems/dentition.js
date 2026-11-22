/* ============================================================
   systems/dentition.js — CBZ.dentition: WHAT A MOUTH LEAVES IN A BODY.

   A bite is printed by teeth. systems/wounds.js strikes every tooth of the
   attacker's real dental arch against the victim's real surface and lays a
   mark where each one lands; this file says where those teeth ARE, how long
   and wide each one is, what shape it cuts, and what the animal does with its
   head once the jaw has closed (shake, saw, rake, crush, slice, take flesh).

   WHERE THE TEETH COME FROM, in order:
     1. THE ATTACKER'S BUILT BODY. A sea animal's body is built from its tooth
        rows (city/wildlife/aquatic.js: per row n, crown height h and width w as
        fractions of the body length, blade or cone `thick`, `span`, the
        corner taper). When the attacker actor is known, those rows are read
        off its own body at its own size (and remembered for its species).
        When only its species id is known, the rows a live one of the species
        showed are used, or the same rows copied into SEA below.
     2. A CANID's skull is a row of real measurements (units/kit/canid.js:
        head length, muzzle width, muzzle share, cheek mass, wild or domestic)
        and its teeth are placed by those numbers exactly as the kit places
        them in the skull it draws: canines at 0.72 (upper) and 0.60 (lower)
        of the muzzle's half width, three incisors a side between them, the
        premolars and the carnassial behind.
     3. EVERY OTHER FAMILY: one table of adult anatomy in metres (skull and
        dental measurements from mammal anatomy references: brown bear,
        tiger, gorilla, wild boar, horse, ruminants with a dental pad, vipers
        and constrictors, lagomorphs). Per family, never per species, apart
        from a size factor per species.
   Anything unknown falls back to a generic carnivore arch sized from `jaw`.

   THE ARCH, in the mouth's own frame: s = lateral (m, + one side), x = back
   from the front of the mouth (m). Upper and lower teeth are separate; the
   gape opens them along the head's up axis. wounds.js owns that frame.

   BEHAVIOUR, 0..1, what the head does after the teeth are in:
     removes  takes flesh with it (a shark's scoop; 0 = punctures only)
     shake    worries side to side: lacerations dragged from the deep teeth
     saw      saws the head across the line of the jaw (serrated sharks)
     rake     the teeth drag along the line of travel (orcas, dolphins)
     crush    bruising and crush between the jaws
     slice    clean straight cuts (barracuda, a boar's tusks, a turtle's beak)

   API
     CBZ.dentition.of(sid, actor, jaw) -> arch
        { family, sid, k, hw, depth, gape, pinch, jawRef, teeth: [{ up, s, x, L, W, kind }],
          removes, shake, saw, rake, crush, slice, deep, venom }
     CBZ.dentition.family(sid) -> family name
   ============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---- THE TABLE: adult anatomy, metres ------------------------------------
     A tooth group: [kind, s (lateral, centre of the crown), x (back from the
     front of the mouth), L (crown length: how deep it goes in), W (crown
     width), up (true = upper jaw)]. Every group is mirrored to both sides
     unless s is 0. `hw` is the arch half width at its widest contact and
     `jawRef` the jaw radius a caller passes for this adult (wounds.js scales
     the arch by jaw / jawRef within a narrow band: land callers' jaw numbers
     are coarse, so they only nudge the size). */
  function tg(kind, s, x, L, Wd, up) { return { kind: kind, s: s, x: x, L: L, W: Wd, up: up }; }
  const FAMILY = {
    // BROWN BEAR (Ursus arctos): skull ~0.38 m; upper canines ~45 mm crown,
    // ~19 mm at the base, ~75 mm apart; massive flat molars that crush.
    bear: {
      hw: 0.052, depth: 0.15, gape: 0.17, pinch: 0.065, jawRef: 0.055,
      removes: 0.28, shake: 0.55, saw: 0, rake: 0.15, crush: 0.95, slice: 0, deep: 1,
      teeth: [
        tg("incisor", 0.007, 0.000, 0.012, 0.009, true), tg("incisor", 0.017, 0.002, 0.013, 0.010, true), tg("incisor", 0.027, 0.006, 0.015, 0.011, true),
        tg("canine", 0.037, 0.020, 0.045, 0.019, true),
        tg("molar", 0.042, 0.075, 0.010, 0.020, true), tg("molar", 0.044, 0.105, 0.010, 0.024, true), tg("molar", 0.045, 0.135, 0.010, 0.026, true),
        tg("incisor", 0.006, 0.004, 0.011, 0.008, false), tg("incisor", 0.015, 0.006, 0.012, 0.009, false), tg("incisor", 0.023, 0.009, 0.013, 0.010, false),
        tg("canine", 0.031, 0.024, 0.040, 0.017, false),
        tg("molar", 0.038, 0.080, 0.010, 0.019, false), tg("molar", 0.040, 0.112, 0.010, 0.022, false), tg("molar", 0.041, 0.140, 0.010, 0.024, false),
      ],
    },
    // TIGER (Panthera tigris): upper canines 60-75 mm crown, ~70 mm apart;
    // tiny incisors; the carnassial blade far back. A cat kills with the
    // four canines, deep, at the throat or the nape, and holds.
    cat: {
      hw: 0.045, depth: 0.10, gape: 0.22, pinch: 0.07, jawRef: 0.045,
      removes: 0.10, shake: 0.15, saw: 0, rake: 0.10, crush: 0.6, slice: 0.2, deep: 1,
      teeth: [
        tg("incisor", 0.004, 0.000, 0.007, 0.005, true), tg("incisor", 0.010, 0.001, 0.008, 0.006, true), tg("incisor", 0.017, 0.003, 0.010, 0.007, true),
        tg("canine", 0.034, 0.014, 0.062, 0.020, true),
        tg("premolar", 0.037, 0.050, 0.014, 0.012, true), tg("blade", 0.040, 0.075, 0.016, 0.022, true),
        tg("incisor", 0.003, 0.004, 0.006, 0.004, false), tg("incisor", 0.008, 0.005, 0.007, 0.005, false), tg("incisor", 0.014, 0.007, 0.008, 0.006, false),
        tg("canine", 0.027, 0.018, 0.046, 0.017, false),
        tg("premolar", 0.031, 0.055, 0.012, 0.011, false), tg("blade", 0.034, 0.080, 0.016, 0.020, false),
      ],
    },
    // GORILLA: long upper canines (~50 mm in a silverback), broad incisors,
    // grinding molars: a crushing, tearing bite.
    ape: {
      hw: 0.040, depth: 0.09, gape: 0.13, pinch: 0.05, jawRef: 0.042,
      removes: 0.15, shake: 0.4, saw: 0, rake: 0.1, crush: 0.9, slice: 0, deep: 0.85,
      teeth: [
        tg("incisor", 0.005, 0.000, 0.010, 0.010, true), tg("incisor", 0.015, 0.003, 0.010, 0.010, true),
        tg("canine", 0.027, 0.012, 0.042, 0.016, true),
        tg("molar", 0.031, 0.045, 0.008, 0.014, true), tg("molar", 0.032, 0.065, 0.008, 0.015, true),
        tg("incisor", 0.005, 0.004, 0.009, 0.009, false), tg("incisor", 0.014, 0.006, 0.009, 0.009, false),
        tg("canine", 0.023, 0.015, 0.028, 0.014, false),
        tg("molar", 0.028, 0.048, 0.008, 0.014, false), tg("molar", 0.029, 0.068, 0.008, 0.015, false),
      ],
    },
    // WILD BOAR: the lower tusks (canines, ~60 mm out of the gum) slash up and
    // out; the upper tusks hone them. Incisors nip.
    boar: {
      hw: 0.035, depth: 0.14, gape: 0.10, pinch: 0.04, jawRef: 0.04,
      removes: 0.1, shake: 0.6, saw: 0, rake: 0.2, crush: 0.5, slice: 0.8, deep: 0.8,
      teeth: [
        tg("incisor", 0.006, 0.000, 0.008, 0.007, true), tg("incisor", 0.015, 0.004, 0.008, 0.007, true),
        tg("canine", 0.030, 0.030, 0.030, 0.014, true),
        tg("incisor", 0.005, 0.000, 0.010, 0.006, false), tg("incisor", 0.013, 0.003, 0.010, 0.006, false),
        tg("tusk", 0.034, 0.035, 0.060, 0.013, false),
      ],
    },
    // HORSE / ZEBRA: six chisel incisors a jaw in a tight arc; a hard nip that
    // crushes and abrades rather than punctures.
    equid: {
      hw: 0.032, depth: 0.03, gape: 0.07, pinch: 0.03, jawRef: 0.035,
      removes: 0, shake: 0.2, saw: 0, rake: 0.25, crush: 0.85, slice: 0, deep: 0.25,
      teeth: [
        tg("flat", 0.006, 0.000, 0.006, 0.012, true), tg("flat", 0.018, 0.004, 0.006, 0.012, true), tg("flat", 0.029, 0.010, 0.006, 0.011, true),
        tg("flat", 0.006, 0.002, 0.006, 0.011, false), tg("flat", 0.017, 0.006, 0.006, 0.011, false), tg("flat", 0.027, 0.012, 0.006, 0.010, false),
      ],
    },
    // RUMINANTS (cattle, deer, sheep, goats, bison, moose, giraffe): no upper
    // incisors at all, a dental pad against eight lower incisors. A pinch.
    ruminant: {
      hw: 0.028, depth: 0.02, gape: 0.05, pinch: 0.025, jawRef: 0.03,
      removes: 0, shake: 0.1, saw: 0, rake: 0.1, crush: 0.5, slice: 0, deep: 0.15,
      teeth: [
        tg("pad", 0.000, 0.000, 0.002, 0.040, true),
        tg("flat", 0.004, 0.002, 0.005, 0.008, false), tg("flat", 0.011, 0.004, 0.005, 0.008, false),
        tg("flat", 0.018, 0.007, 0.005, 0.008, false), tg("flat", 0.025, 0.011, 0.005, 0.007, false),
      ],
    },
    // RABBITS AND HARES: two deep chisel incisors above, two below.
    lagomorph: {
      hw: 0.006, depth: 0.004, gape: 0.02, pinch: 0.008, jawRef: 0.012,
      removes: 0, shake: 0.1, saw: 0, rake: 0.1, crush: 0.2, slice: 0.3, deep: 0.4,
      teeth: [tg("flat", 0.0018, 0.000, 0.006, 0.003, true), tg("flat", 0.0016, 0.001, 0.005, 0.0028, false)],
    },
    // RACCOON (a procyonid carnivore): a small canid-like arch.
    procyonid: {
      hw: 0.016, depth: 0.04, gape: 0.05, pinch: 0.02, jawRef: 0.02,
      removes: 0, shake: 0.6, saw: 0, rake: 0.2, crush: 0.3, slice: 0, deep: 0.8,
      teeth: [
        tg("incisor", 0.003, 0.000, 0.003, 0.002, true), tg("incisor", 0.007, 0.001, 0.003, 0.002, true),
        tg("canine", 0.012, 0.006, 0.011, 0.004, true),
        tg("incisor", 0.003, 0.002, 0.003, 0.002, false), tg("canine", 0.010, 0.008, 0.009, 0.0035, false),
      ],
    },
    // VIPERS, COBRAS, MAMBAS: two hollow fangs at the front of the upper jaw
    // (a rattlesnake's ~10 mm), a row of tiny recurved teeth below.
    viper: {
      hw: 0.012, depth: 0.03, gape: 0.06, pinch: 0.02, jawRef: 0.02,
      removes: 0, shake: 0, saw: 0, rake: 0.1, crush: 0.05, slice: 0, deep: 1, venom: true,
      teeth: [
        tg("fang", 0.008, 0.004, 0.011, 0.002, true),
        tg("needle", 0.007, 0.006, 0.002, 0.001, false), tg("needle", 0.009, 0.012, 0.002, 0.001, false), tg("needle", 0.010, 0.018, 0.002, 0.001, false),
        tg("needle", 0.011, 0.024, 0.002, 0.001, false),
      ],
    },
    // CONSTRICTORS (anaconda): rows of recurved needles, no fangs: a U of tiny
    // punctures that hooks in and holds.
    constrictor: {
      hw: 0.030, depth: 0.07, gape: 0.12, pinch: 0.05, jawRef: 0.04,
      removes: 0, shake: 0, saw: 0, rake: 0.3, crush: 0.3, slice: 0, deep: 0.5,
      rows: [
        { kind: "needle", up: true, n: 12, from: 0.0, to: 1.0, L: 0.010, W: 0.002, scale: 1.0 },
        { kind: "needle", up: true, n: 9, from: 0.05, to: 0.9, L: 0.008, W: 0.002, scale: 0.62 },
        { kind: "needle", up: false, n: 12, from: 0.0, to: 1.0, L: 0.010, W: 0.002, scale: 0.92 },
      ],
      arch: [[0, 0], [0.55, 0.12], [0.9, 0.55], [1.0, 1.0]],
    },
    // A BEAK (sea turtle): keratin cutting edges that close like shears and
    // crush.
    beak: {
      hw: 0.03, depth: 0.03, gape: 0.06, pinch: 0.03, jawRef: 0.04,
      removes: 0.25, shake: 0.2, saw: 0, rake: 0, crush: 0.7, slice: 0.8, deep: 0.3,
      teeth: [tg("edge", 0.000, 0.000, 0.006, 0.05, true), tg("edge", 0.000, 0.004, 0.006, 0.045, false)],
    },
    // A PECK (birds): one hard point.
    peck: {
      hw: 0.004, depth: 0.004, gape: 0.012, pinch: 0.006, jawRef: 0.01,
      removes: 0, shake: 0.1, saw: 0, rake: 0.2, crush: 0.2, slice: 0, deep: 0.5,
      teeth: [tg("canine", 0.000, 0.000, 0.006, 0.003, true)],
    },
    // FILTER FEEDERS (baleen whales, mantas): no teeth. A blow, not a bite.
    none: {
      hw: 0.1, depth: 0.1, gape: 0.2, pinch: 0.1, jawRef: 0.3,
      removes: 0, shake: 0, saw: 0, rake: 0, crush: 0.6, slice: 0, deep: 0,
      teeth: [],
    },
  };

  /* ---- THE SEA'S MOUTHS: rows of teeth along an arch -------------------------
     These are the species' own rows (city/wildlife/aquatic.js), used when the
     species' body cannot be read. ref = the adult the numbers are for: body
     length L (model units) x scale, mouth width and length (model units). */
  const SEA = {
    great_white_shark: { L: 4.35, scale: 1.08, mw: 0.436, ml: 0.20,
      up: { n: 24, h: 0.0115, w: 0.0072, thick: 0.2, cornerK: 0.42 }, lo: { n: 22, h: 0.0098, w: 0.0050, thick: 0.22, cornerK: 0.40 } },
    megalodon: { L: 6.32, scale: 2.6, mw: 0.737, ml: 0.33,
      up: { n: 24, h: 0.0125, w: 0.0080, thick: 0.2, cornerK: 0.42 }, lo: { n: 22, h: 0.0110, w: 0.0060, thick: 0.22, cornerK: 0.40 } },
    bull_shark: { L: 3.42, scale: 0.76, mw: 0.390, ml: 0.17,
      up: { n: 26, h: 0.0082, w: 0.0062, thick: 0.2, cornerK: 0.42 }, lo: { n: 24, h: 0.0074, w: 0.0030, thick: 0.25, cornerK: 0.45 } },
    hammerhead_shark: { L: 4.0, scale: 1.25, mw: 0.30, ml: 0.12,
      up: { n: 30, h: 0.0052, w: 0.0034, thick: 0.2, cornerK: 0.45 }, lo: { n: 30, h: 0.0046, w: 0.0026, thick: 0.22, cornerK: 0.45 } },
    orca: { L: 6.61, scale: 0.95, mw: 0.887, ml: 0.62,
      up: { n: 24, h: 0.0070, w: 0.0044, thick: 0.85, cornerK: 0.6 }, lo: { n: 24, h: 0.0066, w: 0.0042, thick: 0.85, cornerK: 0.6 } },
    dolphin: { L: 4.20, scale: 0.66, mw: 0.288, ml: 0.42,
      up: { n: 40, h: 0.0028, w: 0.0021, thick: 0.8, cornerK: 0.7, span: 0.68 }, lo: { n: 40, h: 0.0028, w: 0.0021, thick: 0.8, cornerK: 0.7, span: 0.68 } },
    barracuda: { L: 2.88, scale: 0.45, mw: 0.154, ml: 0.25,
      up: [{ n: 4, h: 0.016, w: 0.0060, thick: 0.35, cornerK: 0.9, span: 0.10 }, { n: 26, h: 0.0062, w: 0.0035, thick: 0.3, cornerK: 0.6, jag: 0.55, span: 0.86 }],
      lo: [{ n: 2, h: 0.018, w: 0.0065, thick: 0.35, cornerK: 0.9, span: 0.06 }, { n: 24, h: 0.0068, w: 0.0036, thick: 0.3, cornerK: 0.6, jag: 0.55, span: 0.86 }] },
  };
  // what each sea mouth does once it is in
  const SEA_BEHAVIOUR = {
    // a white shark bites, shakes its head to saw the serrations through, and
    // swims off with the piece
    shark: { removes: 1.0, shake: 0.3, saw: 0.85, rake: 0.2, crush: 0.25, slice: 0, deep: 1 },
    // a bull shark grabs and shakes: its narrow lower teeth hold, the upper
    // blades cut; the crushing bite of the family
    bullshark: { removes: 0.85, shake: 0.55, saw: 0.6, rake: 0.15, crush: 0.7, slice: 0, deep: 1 },
    // a hammerhead's teeth are small: it cuts, it does not scoop
    hammer: { removes: 0.45, shake: 0.3, saw: 0.6, rake: 0.25, crush: 0.2, slice: 0, deep: 0.8 },
    // an orca's conical teeth grip and tear; the tooth rakes are its signature
    orca: { removes: 0.55, shake: 0.5, saw: 0, rake: 0.9, crush: 0.5, slice: 0, deep: 1 },
    // a dolphin's needle row only scrapes: the parallel rake lines every
    // dolphin carries
    dolphin: { removes: 0, shake: 0.2, saw: 0, rake: 1.0, crush: 0.1, slice: 0, deep: 0.35 },
    // a barracuda's jaw closes like scissors on knife-edged teeth
    barracuda: { removes: 0.4, shake: 0.1, saw: 0, rake: 0.1, crush: 0, slice: 1.0, deep: 0.9 },
    // small toothed fish: a nip
    fish: { removes: 0.1, shake: 0.1, saw: 0, rake: 0.4, crush: 0.1, slice: 0.2, deep: 0.3 },
  };
  const SEA_FAMILY = {
    great_white_shark: "shark", megalodon: "shark", bull_shark: "bullshark", hammerhead_shark: "hammer",
    orca: "orca", dolphin: "dolphin", barracuda: "barracuda",
  };

  /* ---- WHICH FAMILY: by data where the species row says enough, explicitly
     where it does not. */
  const EXPLICIT = {
    black_bear: ["bear", 0.82], brown_bear: ["bear", 1.0], polar_bear: ["bear", 1.05],
    bengal_tiger: ["cat", 1.0], lion: ["cat", 1.0], white_lion: ["cat", 1.0], cheetah: ["cat", 0.62], snow_leopard: ["cat", 0.66],
    gorilla: ["ape", 1.0],
    wild_boar: ["boar", 1.0], pig: ["boar", 0.8],
    horse: ["equid", 1.0], zebra: ["equid", 0.92],
    cow: ["ruminant", 1.0], bison: ["ruminant", 1.1], moose: ["ruminant", 1.05], elk: ["ruminant", 0.95], caribou: ["ruminant", 0.85],
    whitetail_deer: ["ruminant", 0.8], white_stag: ["ruminant", 0.9], sheep: ["ruminant", 0.7], goat: ["ruminant", 0.7],
    mountain_goat: ["ruminant", 0.75], bighorn_sheep: ["ruminant", 0.78], giraffe: ["ruminant", 1.1],
    african_elephant: ["none", 1.0], white_rhino: ["none", 1.0], humpback_whale: ["none", 1.0], manta_ray: ["none", 1.0],
    jackrabbit: ["lagomorph", 1.0], snowshoe_hare: ["lagomorph", 1.0], cottontail_rabbit: ["lagomorph", 0.85],
    raccoon: ["procyonid", 1.0], chicken: ["peck", 1.0], sea_turtle: ["beak", 1.0],
    tuna: ["fish", 1.0], marlin: ["fish", 1.2], fish: ["fish", 0.5], sardine: ["fish", 0.2],
  };
  function speciesRow(sid) { return (CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[sid]) || null; }
  function canidRow(sid) {
    const K = CBZ.canid;
    if (!K || !K.ROWS) return null;
    if (sid === "dog") return K.ROWS.mutt || null;
    if (sid.indexOf("dog:") === 0) return K.ROWS[sid.slice(4)] || K.ROWS.mutt || null;
    const R = K.ROWS[sid];
    return R || null;
  }
  function familyOf(sid) {
    sid = String(sid || "");
    if (!sid) return "generic";
    if (canidRow(sid) || sid === "dog" || sid.indexOf("dog:") === 0) return "canid";
    if (SEA_FAMILY[sid]) return SEA_FAMILY[sid];
    if (EXPLICIT[sid]) return EXPLICIT[sid][0];
    const sp = speciesRow(sid);
    if (sp) {
      if (sp.snake) return sp.constrictor ? "constrictor" : "viper";
      if (/bear/.test(sid)) return "bear";
      if (/wolf|fox|coyote|dog|jackal/.test(sid)) return "canid";
      if (/tiger|lion|leopard|cougar|puma|lynx|jaguar|cheetah/.test(sid)) return "cat";
      if (/shark/.test(sid)) return "shark";
    }
    return "generic";
  }

  /* ---- an arch for a sea animal's rows ---------------------------------------
     The rows run along the lip from one corner, round the front, to the
     other: n teeth over the row's span (centred on the front), the crown
     shrinking to cornerK of its front size at the corners. The lip line is a
     parabola from the front (s 0, x 0) to the corner (s hw, x depth). */
  function seaTeeth(rows, up, hw, depth, Lm, out) {
    const list = Array.isArray(rows) ? rows : [rows];
    for (let r = 0; r < list.length; r++) {
      const R = list[r];
      if (!R || !R.n) continue;
      const span = R.span || 1, half = Math.max(1, Math.round(R.n / 2));
      const kind = R.thick >= 0.6 ? "cone" : (R.jag ? "blade" : "serrated");
      for (let i = 0; i < half; i++) {
        // centre of tooth i along the half arch (0 at the front)
        const t = span * (i + 0.5) / half;
        const s = hw * t, x = depth * t * t;
        const k = lerp(1, R.cornerK != null ? R.cornerK : 0.6, t);
        const L = R.h * Lm * k, Wd = R.w * Lm * k;
        out.push({ up: up, s: s, x: x, L: L, W: Wd, kind: kind, jag: R.jag || 0 });
        out.push({ up: up, s: -s, x: x, L: L, W: Wd, kind: kind, jag: R.jag || 0 });
      }
    }
  }
  /* the rows of a live marine body (its own spec at its own size), or null.
     What a live body shows is remembered per species (in model units), so a
     later bite that names only the species prints the same real rows. */
  const _seaSeen = Object.create(null);
  function bodyRows(actor) {
    const g = actor && actor.group;
    const mb = g && g.userData && g.userData.marineBody;
    const sp = mb && mb.tpl && mb.tpl.spec;
    const mo = sp && sp.mouth;
    const c = g && g.userData && g.userData.aquaticMouth;
    if (!mo || !mo.teeth || !c) return null;
    const sc = (g.scale && g.scale.x) || 1;
    const live = function (rows) { return (rows || []).filter(function (r) { return r && !r.age; }); };
    const sid = (actor.species && actor.species.id) || sp.id;
    const unit = { L: sp.L, mw: c.width, ml: c.length || c.width * 0.45, up: live(mo.teeth.upper), lo: live(mo.teeth.lower) };
    if (sid) _seaSeen[sid] = unit;
    return { L: unit.L * sc, mw: unit.mw * sc, ml: unit.ml * sc, up: unit.up, lo: unit.lo };
  }
  // a species named without its body: the rows a live one showed, at the
  // species' adult size
  function speciesRows(sid) {
    const u = _seaSeen[sid];
    if (!u) return null;
    const sp = speciesRow(sid), s = (sp && sp.scale) || 1;
    return { L: u.L * s, mw: u.mw * s, ml: u.ml * s, up: u.up, lo: u.lo };
  }

  /* ---- a canid's arch from its row (units/kit/canid.js's own placement) ---- */
  function canidArch(R) {
    const hl = R.headL * R.W, tw = R.muzW * hl;
    const wild = R.kind !== "dog";
    const cl = 0.09 * hl * (wild ? 1.1 : 1);
    const T = [];
    const both = function (kind, s, x, L, Wd, up) { T.push({ up: up, s: s, x: x, L: L, W: Wd, kind: kind }, { up: up, s: -s, x: x, L: L, W: Wd, kind: kind }); };
    for (let k = 0; k < 3; k++) {
      both("incisor", tw * (0.12 + 0.17 * k), k * 0.004 * hl, cl * 0.35, 0.014 * hl, true);
      both("incisor", tw * (0.12 + 0.17 * k) * 0.92, 0.015 * hl + k * 0.004 * hl, cl * 0.3, 0.012 * hl, false);
    }
    both("canine", tw * 0.72, 0.075 * hl, cl, 0.030 * hl, true);
    both("canine", tw * 0.60, 0.090 * hl, cl * 0.8, 0.024 * hl, false);
    for (let k = 0; k < 3; k++) {
      const u = lerp(0.55, 0.8, k / 2) * hl;
      both("premolar", tw * lerp(0.92, 0.78, k / 2), 0.975 * hl - u, cl * (k === 0 ? 0.55 : 0.38), 0.024 * hl, true);
      if (k < 2) both("premolar", tw * lerp(0.8, 0.68, k), 0.975 * hl - u - 0.02 * hl, cl * 0.33, 0.02 * hl, false);
    }
    /* THE BITE'S CHARACTER FROM THE SKULL. A short, broad muzzle on heavy
       cheeks is a short lever on a big muscle: more force at the canines, a
       grip that crushes and holds (a mastiff, a pit). A long narrow muzzle
       snaps and slashes (a wolf, a fox). leverage = muzzle width over muzzle
       share of the head, times the masseter; the wolf's 0.24 is the middle. */
    const lev = (R.muzW / Math.max(0.2, R.muzK)) * (R.cheek || 1);
    const crush = clamp(0.25 + (lev - 0.2) * 1.3, 0.2, 1);
    // force grows with body mass ^ 2/3; the deep tooth's purchase with it
    const force = Math.pow(Math.max(2, R.mass || 30), 0.667) * lev;
    return {
      teeth: T, hw: tw * 0.95, depth: 0.42 * hl,
      gape: 0.42 * hl, pinch: 0.13 * hl,
      jawRef: 0.5 * Math.hypot(R.muzK * hl * 0.62, R.muzW * hl * 2),
      removes: 0.04 + 0.1 * crush, shake: wild ? 0.85 : 0.75, saw: 0, rake: 0.12,
      crush: crush, slice: 0, deep: clamp(0.55 + force / 30, 0.6, 1),
    };
  }

  // the generic carnivore: a canid's proportions sized from the jaw alone
  function genericArch(jaw) {
    const hl = clamp(jaw, 0.02, 1.5) / 0.19;
    return canidArch({ headL: 1, W: hl, muzW: 0.12, muzK: 0.5, cheek: 1, mass: 30, kind: "wild" });
  }

  function scaleArch(A, k) {
    const out = Object.assign({}, A);
    out.teeth = A.teeth.map(function (t) { return { up: t.up, s: t.s * k, x: t.x * k, L: t.L * k, W: t.W * k, kind: t.kind, jag: t.jag || 0 }; });
    out.hw = A.hw * k; out.depth = A.depth * k; out.gape = A.gape * k; out.pinch = A.pinch * k;
    out.k = k;
    return out;
  }
  // a table family with rows (the constrictor) laid along its arch polyline
  function rowArch(F) {
    const T = [];
    const pts = F.arch;
    const segL = [0];
    for (let i = 1; i < pts.length; i++) segL.push(segL[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = segL[segL.length - 1];
    const at = function (f) {
      const d = f * tot;
      let i = 1; while (i < pts.length - 1 && segL[i] < d) i++;
      const u = (d - segL[i - 1]) / Math.max(1e-9, segL[i] - segL[i - 1]);
      return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)];
    };
    for (let r = 0; r < F.rows.length; r++) {
      const R = F.rows[r];
      for (let i = 0; i < R.n; i++) {
        const p = at(lerp(R.from, R.to, (i + 0.5) / R.n));
        const s = p[0] * F.hw * R.scale, x = p[1] * F.depth;
        T.push({ up: R.up, s: s, x: x, L: R.L, W: R.W, kind: R.kind }, { up: R.up, s: -s, x: x, L: R.L, W: R.W, kind: R.kind });
      }
    }
    return T;
  }
  function tableArch(F) {
    const T = [];
    if (F.rows) return rowArch(F);
    for (let i = 0; i < F.teeth.length; i++) {
      const t = F.teeth[i];
      T.push({ up: t.up, s: t.s, x: t.x, L: t.L, W: t.W, kind: t.kind });
      if (t.s > 1e-6) T.push({ up: t.up, s: -t.s, x: t.x, L: t.L, W: t.W, kind: t.kind });
    }
    return T;
  }

  // the size of the attacker relative to the adult the table describes
  function actorSize(actor, sid) {
    const g = actor && actor.group;
    if (!g || !g.scale) return 1;
    const sp = speciesRow(sid);
    const base = (sp && sp.scale) || 1;
    const s = (g.scale.x || 1) / base;
    return isFinite(s) && s > 0 ? s : 1;
  }

  /* ---- THE ONE CALL --------------------------------------------------------- */
  function of(sid, actor, jaw) {
    sid = String(sid || "");
    const fam = familyOf(sid);
    let A = null, k = 1;
    if (fam === "canid") {
      const rig = actor && actor.group && actor.group.userData && actor.group.userData.canidRig;
      const R = (rig && rig.D && rig.D.row) || canidRow(sid) || (CBZ.canid && CBZ.canid.ROWS && (CBZ.canid.ROWS[sid] || CBZ.canid.ROWS.mutt));
      A = R ? canidArch(R) : genericArch(jaw || 0.05);
      // the canid seam passes its own measured jaw (the individual's size);
      // other callers pass coarse numbers, so the band is an individual's
      // spread, not a licence to draw a wolf's bite half a metre wide
      if (jaw > 0 && A.jawRef > 0) k = clamp(jaw / A.jawRef, 0.75, 1.3);
      else if (rig && rig.mesh) k = clamp(rig.mesh.scale.x || 1, 0.6, 1.6);
    } else if (SEA_FAMILY[sid] || SEA_BEHAVIOUR[fam]) {
      const B = SEA_BEHAVIOUR[fam] || SEA_BEHAVIOUR.fish;
      const live = bodyRows(actor);
      let rows = live || speciesRows(sid);
      if (!rows && SEA[sid]) {
        const S = SEA[sid], Lm = S.L * S.scale;
        rows = { L: Lm, mw: S.mw * S.scale, ml: S.ml * S.scale, up: S.up, lo: S.lo };
      }
      if (rows && (rows.up && (rows.up.length || rows.up.n))) {
        const T = [];
        const hw = rows.mw * 0.5, depth = Math.max(hw * 0.35, rows.ml * 0.85);
        seaTeeth(rows.up, true, hw, depth, rows.L, T);
        seaTeeth(rows.lo, false, hw * 0.92, depth * 0.95, rows.L, T);
        A = Object.assign({ teeth: T, hw: hw, depth: depth, gape: hw * 1.5, pinch: hw * 0.55, jawRef: hw }, B);
        // a live body is already at its own size; a species read is the
        // adult, sized to the caller's mouth within the individual spread
        if (!live && jaw > 0) k = clamp(jaw / hw, 0.5, 1.6);
      } else {
        // a fish with no tooth rows on its body: a small rasping nip
        const j = clamp(jaw || 0.05, 0.01, 0.5);
        A = Object.assign({
          teeth: [], hw: j, depth: j * 0.5, gape: j * 1.2, pinch: j * 0.5, jawRef: j,
        }, B);
        const n = 8;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, s = j * t, x = j * 0.5 * t * t;
          A.teeth.push({ up: true, s: s, x: x, L: j * 0.05, W: j * 0.04, kind: "cone" }, { up: true, s: -s, x: x, L: j * 0.05, W: j * 0.04, kind: "cone" });
          A.teeth.push({ up: false, s: s * 0.92, x: x, L: j * 0.05, W: j * 0.04, kind: "cone" }, { up: false, s: -s * 0.92, x: x, L: j * 0.05, W: j * 0.04, kind: "cone" });
        }
        if (EXPLICIT[sid]) k = 1;
      }
    } else if (FAMILY[fam]) {
      const F = FAMILY[fam];
      A = Object.assign({}, F, { teeth: tableArch(F) });
      const per = EXPLICIT[sid] ? EXPLICIT[sid][1] : 1;
      // land callers' jaw numbers are coarse (a scale times a constant), so
      // they nudge the size; the attacker's own body, when known, sets it
      const kj = jaw > 0 ? clamp(jaw / (F.jawRef * per), 0.85, 1.2) : 1;
      k = per * (actor ? clamp(actorSize(actor, sid), 0.5, 1.8) : kj);
    } else {
      A = genericArch(jaw || 0.2);
      // the unknown biter: the jaw is all there is
      if (jaw > 0 && A.jawRef > 0) k = clamp(jaw / A.jawRef, 0.4, 3);
    }
    const out = scaleArch(A, k);
    out.family = fam; out.sid = sid;
    return out;
  }

  CBZ.dentition = { of: of, family: familyOf, FAMILY: FAMILY, SEA: SEA };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.dentition;
})();
