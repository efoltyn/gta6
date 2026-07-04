/* ============================================================
   city/demographics.js — Stage X, step X4: POPULATION CONFIG PER COUNTRY.

   MASTER-PLAN V.1a (verbatim): "Different demographics: each country/region
   carries a population config — skin-tone distribution, culturally coherent
   name pools (first + surname sets per region), and dress palettes — so an
   African-inspired nation's population is predominantly dark-skinned with
   its own name pools, an East-Asian-inspired one likewise, etc., exactly as
   the real world varies by geography. Demographics and wealth are
   independent config axes (the fiction can have rich and poor countries of
   any demographic); makePed reads the spawn region's config for skin/name/
   dress rolls, and migration (V.6) mixes populations over time — port
   cities polyglot, remote villages homogeneous."

   BUILD-PLAN X4 (verbatim): "Demographics: per-region population config
   (skin-tone distribution, name pools per culture, dress palettes) read by
   makePed/crowds at spawn; region-correct populations, migration mixes them
   over time."

   ============================================================
   AXES INDEPENDENCE (the plan's explicit requirement — read this before
   editing either file):
   ------------------------------------------------------------
   `skinWeights`/`firstM`/`firstF`/`surnames`/`outfitPalette` here and
   `wealthLevel` on the SAME country record in city/countries.js are
   DELIBERATELY unrelated fields with NO coupling anywhere in code. A rich
   or poor country of any demographic mix is a pure DATA edit (swap which
   config a country id maps to, or hand-tune one config's numbers) — never
   a code change. Concretely: this file never reads wealthLevel, cash,
   treasury, or any econ field, and city/peds.js's wealth roll
   (richWealth()/opts.wealth, a few lines above the seam this file plugs
   into) is computed by a totally separate call, off a totally separate rng
   draw, before demographics.rollFor() is ever invoked — the ONLY reads of
   this file's config are the three appearance rolls (skin/name/dress).
   `grep -n "wealth\|cash" city/demographics.js` should turn up nothing but
   this comment.

   ------------------------------------------------------------
   OWNERSHIP: this file, not city/countries.js, owns every population
   config, keyed by country id (CONFIGS below) — countries.js stays pure
   layout/wealth/geometry data (see ITS header's "DATA vs GEOMETRY SPLIT").
   On load (after countries.js — see index.html) this file also stamps
   `cd.demographics = CONFIGS[cd.id]` onto every CBZ.COUNTRIES entry purely
   for data-cohesion/introspection (nothing reads it off the country record
   today; the canonical lookup is CONFIGS[countryId] inside rollFor below,
   which works even for "republic", the hierarchy root that ISN'T one of
   countries.js's COUNTRIES array entries — see city/polity.js's hardcoded
   root record).

   CONFIG SHAPE: { skinWeights:[[colorFromPedsSKINPool, weight], ...],
     firstM:[...], firstF:[...], surnames:[...], mix, outfitPalette }.
   `skinWeights` reuses the EXACT 8 hex values from city/peds.js's own SKIN
   pool (copied here, not invented — that file keeps the canonical pool;
   this file just weights it differently per country) so a demographic-config
   ped is drawn from the SAME underlying skin-tone palette as every other
   ped in the game, just with different odds.

   MIX: "mix" is the fraction of spawns in this country that draw from the
   caller's GLOBAL pool regardless of the country config — the plan's own
   "port cities polyglot, remote villages homogeneous" line, and the
   mechanism migration (V.6) will tune over time. Concretely: rollFor rolls
   `r() < cfg.mix` first; on a hit it returns null (the caller's existing
   global SKIN/FIRST/SURNAMES rolls fire exactly as if no config existed).
   The mainland ("republic") config below sets mix:1.0 — ALWAYS defers —
   which makes it byte-identical to "no demographics config" (the "current
   mixed pool, status quo, explicitly cosmopolitan" behavior the task calls
   for), without this file needing to duplicate peds.js's private SKIN/
   FIRST_M/FIRST_F/SURNAMES arrays (which aren't exposed on CBZ) just to
   re-implement its own global pool.

   API: CBZ.demographics.rollFor(x, z, r, gender?) -> {skin, name, gender,
   shirt?} | null. `r` is the SAME deterministic rng function stream the
   caller (makePed) is already threading through every other appearance
   roll — never Math.random. `gender` is OPTIONAL: pass it when the caller
   already rolled one (makePed does, so the returned name always matches
   the ped's actual body/build — see that file's call site) so this file
   never needs its own gender roll; omit it (the documented 3-arg call —
   used by the harness below) and rollFor rolls its own ~50/50 and reports
   it back in the returned `gender` field. Returns null whenever: no
   CBZ.polity, the point resolves to no city/federal record, that city's
   country has no CONFIGS entry, or the mix roll defers to global — every
   one of those is a legitimate "no config, fall back" case, not an error.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- helpers ----------------------------------------------------------
  // weighted pick over [[value, weight], ...] pairs off a single r() draw.
  function wroll(pairs, x) {
    let total = 0;
    for (let i = 0; i < pairs.length; i++) total += pairs[i][1];
    let t = x * total;
    for (let i = 0; i < pairs.length; i++) {
      t -= pairs[i][1];
      if (t <= 0) return pairs[i][0];
    }
    return pairs[pairs.length - 1][0];
  }
  // plain uniform pick — same shape as peds.js's own `pick(arr, r())`.
  function pick(arr, x) { return arr && arr.length ? arr[(x * arr.length) | 0] : null; }

  // ============================================================
  //  POPULATION CONFIGS — one per country id. skinWeights values are the
  //  8 hex colors from city/peds.js's SKIN pool (copied verbatim, reordered
  //  light -> dark below for readability; NOT invented — see header).
  // ------------------------------------------------------------
  //  peds.js SKIN pool, light -> dark (luminance-sorted, for reference):
  //    0xfae0c8 (lightest) > 0xf0c39a > 0xe8b58c > 0xd8a177 > 0xc08a5a
  //    > 0x8a5a3a > 0x6b4a32 > 0x5a3c28 (darkest)
  // ============================================================
  const CONFIGS = {
    // republic (mainland): status quo. mix 1.0 -> ALWAYS defers to the
    // caller's own global pools -> byte-identical to "no config" (see
    // header's MIX section). skinWeights/name pools kept here only for
    // documentation completeness; never actually consulted (see rollFor).
    republic: {
      skinWeights: [
        [0xf0c39a, 1], [0xe8b58c, 1], [0xc08a5a, 1], [0x8a5a3a, 1],
        [0x6b4a32, 1], [0xd8a177, 1], [0xfae0c8, 1], [0x5a3c28, 1],
      ],
      firstM: [], firstF: [], surnames: [],
      mix: 1.0, outfitPalette: null,
    },

    // veridia — Republic of Veridia: European-inspired. Lighter tones
    // weighted heavy (still the full 8-tone pool — a cosmopolitan capital +
    // a harbor town, not a monoculture). mix .18: Lowport is a harbor town
    // ("port cities polyglot" per the plan).
    veridia: {
      skinWeights: [
        [0xfae0c8, 30], [0xf0c39a, 28], [0xe8b58c, 20], [0xd8a177, 10],
        [0xc08a5a, 6], [0x8a5a3a, 3], [0x6b4a32, 2], [0x5a3c28, 1],
      ],
      firstM: ["Anders", "Felix", "Henrik", "Klaus", "Luca", "Mattias", "Niels", "Oskar", "Pieter", "Soren", "Viggo", "Wilhelm"],
      firstF: ["Annika", "Brigitte", "Elin", "Freya", "Greta", "Ingrid", "Liesel", "Marit", "Odette", "Signe", "Ulla", "Ilse"],
      surnames: ["Weber", "Lindqvist", "Moreau", "Andersson", "Bergstrom", "Dubois", "Fischer", "Novak", "Schmidt", "Karlsson"],
      mix: 0.18,
      // dress palette: reuses peds.js's own SHIRT hex values (see that
      // file), just weighted toward muted business/formal tones.
      outfitPalette: [[0x8a939c, 10], [0x23262b, 8], [0x2c3e5c, 8], [0xe8e6e0, 6], [0x33573b, 3], [0x6e2b33, 2], [0xc9a23a, 1]],
    },

    // kesh — Kingdom of Kesh: South-Asian-inspired. Mid tones weighted
    // heavy. mix .08: a rural monarchy of a capital + 2 villages, no port
    // ("remote villages homogeneous" per the plan).
    kesh: {
      skinWeights: [
        [0xc08a5a, 26], [0xd8a177, 24], [0x8a5a3a, 20], [0xe8b58c, 12],
        [0x6b4a32, 10], [0xf0c39a, 4], [0x5a3c28, 3], [0xfae0c8, 1],
      ],
      firstM: ["Arjun", "Ravi", "Vikram", "Sanjay", "Anil", "Rohan", "Deepak", "Ashok", "Nikhil", "Suresh", "Manoj", "Rajesh"],
      firstF: ["Devi", "Priya", "Meera", "Anjali", "Kavita", "Sunita", "Lakshmi", "Radha", "Pooja", "Divya", "Asha", "Indira"],
      surnames: ["Sharma", "Rao", "Patel", "Gupta", "Reddy", "Iyer", "Singh", "Chatterjee", "Nair", "Kapoor"],
      mix: 0.08,
      outfitPalette: [[0xc9a23a, 10], [0x6e2b33, 8], [0xe8e6e0, 6], [0x33573b, 4], [0x8a939c, 2]],
    },

    // solara — Solara: East-Asian-inspired. Light-to-mid tones. mix .25 —
    // the highest of the four new countries: a single-settlement ISLAND
    // CITY-STATE, the plan's quintessential "port city polyglot".
    solara: {
      skinWeights: [
        [0xe8b58c, 26], [0xf0c39a, 22], [0xd8a177, 18], [0xc08a5a, 16],
        [0xfae0c8, 10], [0x8a5a3a, 5], [0x6b4a32, 2], [0x5a3c28, 1],
      ],
      firstM: ["Haruto", "Kenji", "Wei", "Jian", "Minho", "Daiki", "Ryo", "Takashi", "Yong", "Hyun", "Feng", "Sora"],
      firstF: ["Yui", "Sakura", "Mei", "Ling", "Jisoo", "Hana", "Aiko", "Yuna", "Xia", "Naomi", "Suki", "Rina"],
      // Chen/Sato/Park style; some overlap with peds.js's own global
      // SURNAMES pool is fine (that pool is already deliberately mixed-
      // origin — see that file's own W12 comment).
      surnames: ["Chen", "Sato", "Park", "Tanaka", "Kim", "Wong", "Watanabe", "Lee", "Takahashi", "Liu"],
      mix: 0.25,
      outfitPalette: [[0xe8e6e0, 8], [0x23262b, 6], [0x2c3e5c, 6], [0xc9a23a, 4], [0x6e2b33, 3], [0x33573b, 3]],
    },

    // mbeya — Mbeya Federation: African-inspired. Darker tones weighted
    // heavy. mix .06 — the lowest: the poorest country, a capital + 3
    // villages, no port ("remote villages homogeneous" per the plan).
    // NOTE: mix (polyglot-ness) is a demographic/geography axis, not a
    // wealth one — mbeya's low mix comes from being landlocked/rural, not
    // from wealthLevel .25 (see header's AXES INDEPENDENCE).
    mbeya: {
      skinWeights: [
        [0x5a3c28, 28], [0x6b4a32, 26], [0x8a5a3a, 22], [0xc08a5a, 12],
        [0xd8a177, 6], [0xe8b58c, 3], [0xf0c39a, 2], [0xfae0c8, 1],
      ],
      firstM: ["Kwame", "Kofi", "Tendai", "Sipho", "Jabari", "Chidi", "Themba", "Obi", "Kato", "Amadi", "Bakari", "Enzi"],
      firstF: ["Amara", "Zola", "Nia", "Ayana", "Folake", "Chiamaka", "Thandiwe", "Imani", "Sade", "Nala", "Adaeze", "Zuri"],
      surnames: ["Okafor", "Mensah", "Banda", "Ndlovu", "Diallo", "Osei", "Chukwu", "Mwangi", "Abara", "Kamau"],
      mix: 0.06,
      outfitPalette: [[0xc9a23a, 10], [0x6e2b33, 6], [0x33573b, 6], [0x8a939c, 2]],
    },
  };

  // stamp onto CBZ.COUNTRIES entries for data-cohesion (see header) — guarded,
  // never throws if countries.js hasn't run yet / ever (load order, headless).
  try {
    const list = CBZ.COUNTRIES || [];
    for (let i = 0; i < list.length; i++) {
      const cd = list[i];
      if (cd && cd.id && CONFIGS[cd.id]) cd.demographics = CONFIGS[cd.id];
    }
  } catch (e) {}

  // ============================================================
  //  rollFor(x, z, r, gender?) — see header for the full contract.
  // ============================================================
  function rollFor(x, z, r, gender) {
    if (!CBZ.polity || !CBZ.polity.of || !CBZ.polity.countryOf) return null;
    const cityRec = CBZ.polity.of(x, z);
    if (!cityRec) return null;
    const countryRec = CBZ.polity.countryOf(cityRec.id);
    if (!countryRec) return null;
    const cfg = CONFIGS[countryRec.id];
    if (!cfg) return null;
    // MIX: a flat fraction of spawns defer to the global pool regardless of
    // country (see header) — checked FIRST so republic's mix:1.0 never
    // touches the weighted rolls below at all.
    if (r() < cfg.mix) return null;
    const skin = wroll(cfg.skinWeights, r());
    const g = (gender === "f" || gender === "m") ? gender : (r() < 0.5 ? "f" : "m");
    const firstPool = g === "f" ? cfg.firstF : cfg.firstM;
    const nm = (firstPool && firstPool.length && cfg.surnames && cfg.surnames.length)
      ? (pick(firstPool, r()) + " " + pick(cfg.surnames, r()))
      : null;
    const out = { skin: skin, name: nm, gender: g };
    if (cfg.outfitPalette && cfg.outfitPalette.length) out.shirt = wroll(cfg.outfitPalette, r());
    return out;
  }

  CBZ.demographics = {
    rollFor: rollFor,
    CONFIGS: CONFIGS,   // exposed for the harness / any future migration (V.6) tuning
  };
})();
