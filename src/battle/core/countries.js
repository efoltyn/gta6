/* ============================================================
   battle/core/countries.js — THE REAL COUNTRIES AND FORCES AN ARMY CAN BE.

   OWNER (2026-10-26): "I want the USA, basically be able to get the flag of
   any country, and their gun of choice for the soldiers: USA is the M4,
   Russia the AK ... each country should have the training level, so you can
   show 100 US versus 1,000 Iran or IRGC, and get the flags right."

   Page-independent: no DOM, no THREE. One row per country or force, and
   every system that shows a side reads its own column of the row:
     flag      the flag in city/flags.js's design grammar (layout, colours,
               emblems at real proportions). flags.js designFor(id) answers
               it, so the war room's picker, the HUD, the flag bearers' cloth
               and every vehicle's marking are the same flag.
     rifle     the side's service rifle: `gun` is the weapon row that fires it
               (weapons/weapon-data.js: "carbine" is the 5.56 class, "ak47"
               the AK class), `look` the model that is drawn when it is not
               that row's own (weapons/appearances/rifles.js: L85, Tavor,
               QBZ-95, the black AK-74M/AK-12), `name` what it is called.
     training  the default training (NPC War's TRAININGS ids: civ, thug,
               pro, elite, swat). The war room sets it when the country is
               picked; it stays editable.
     kit       what the men wear (entities/combatkit.js's NATIONS row shape:
               camouflage, kit colour, helmet, plates, boots, gloves;
               `irregular` = no issue kit, a chest rig and what they own).
     mark      the ID-tape colour on the arms and the side's colour on the
               HUD, taken from the flag.
   kind: "state" (a country's army), "force" (a separate armed service of a
   state: the IRGC), "group" (a non-state armed group). Names are the
   factual ones the groups and states use or are known by.

   PUBLIC  CBZ.countries = { list(), get(id), has(id), flag(id), kit(id),
                             rifle(id), training(id), mark(id), name(id),
                             short(id), groups() }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  // kit rows (combatkit.js shape). Helmets: "ballistic" (ACH/ECH/MICH cut,
  // and the modern lids built on it), "b6b47" (Ratnik), "pasgt" (the older
  // fibreglass/kevlar cut). Plates: esapi, gr6, lvl3.
  function kit(camo, kitHex, helmet, helmetHex, plates, o) {
    return Object.assign({ camo: camo, kit: kitHex, helmet: helmet, helmetHex: helmetHex, plates: plates,
      soft: plates ? "iiia" : null, boots: 0x1c1c1a, gloves: 0x2c2d26 }, o || {});
  }
  const A_US = { sides: "esbi", boots: 0x8a7556, gloves: 0x6e5f47 };
  const TAN = { boots: 0x8e7a5a, gloves: 0x7e6c50 };

  // the flags. ratio = [hoist, fly]. `at` = [x of the fly, y of the hoist,
  // size as a share of the hoist] for an emblem that sits off the layout's spot.
  const ROWS = [
    { id: "usa", name: "United States", short: "USA", kind: "state",
      flag: { ratio: [10, 19], layout: "stripes-canton", colors: ["#B22234", "#FFFFFF", "#3C3B6E"],
        stripes: 13, cantonStripes: 7, cantonW: 0.4, emblem: { kind: "star-grid", color: "#FFFFFF" } },
      rifle: { gun: "carbine", name: "M4A1" }, training: "elite", mark: 0x3c5ab0,
      kit: kit("ocp", 0x7a6a4e, "ballistic", 0x6f6650, "esapi", A_US) },
    { id: "rus", name: "Russia", short: "RUSSIA", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#FFFFFF", "#0039A6", "#D52B1E"] },
      rifle: { gun: "ak47", look: "ak74m", name: "AK-12" }, training: "pro", mark: 0xd52b1e,
      kit: kit("emr", 0x4a4e38, "b6b47", 0x51573c, "gr6") },
    { id: "chn", name: "China", short: "CHINA", kind: "state",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#EE1C25"], emblem: { kind: "prc-stars", color: "#FFFF00" } },
      rifle: { gun: "carbine", look: "qbz95", name: "QBZ-95" }, training: "pro", mark: 0xee1c25,
      kit: kit("type07", 0x4c5236, "ballistic", 0x4c5236, "lvl3") },
    { id: "gbr", name: "United Kingdom", short: "UK", kind: "state",
      flag: { ratio: [1, 2], layout: "union", colors: ["#012169", "#FFFFFF", "#C8102E"] },
      rifle: { gun: "carbine", look: "l85", name: "L85A3" }, training: "elite", mark: 0x1f3c8f,
      kit: kit("mtp", 0x7a6c50, "ballistic", 0x6d6450, "esapi", TAN) },
    { id: "fra", name: "France", short: "FRANCE", kind: "state",
      flag: { ratio: [2, 3], layout: "tricolour-v", colors: ["#002395", "#FFFFFF", "#ED2939"] },
      rifle: { gun: "carbine", name: "HK416F" }, training: "elite", mark: 0x2747b8,
      kit: kit("cce", 0x4f5438, "ballistic", 0x4f5438, "esapi") },
    { id: "deu", name: "Germany", short: "GERMANY", kind: "state",
      flag: { ratio: [3, 5], layout: "bands-h", colors: ["#000000", "#DD0000", "#FFCE00"] },
      rifle: { gun: "carbine", name: "HK416 A8" }, training: "elite", mark: 0xffce00,
      kit: kit("flecktarn", 0x4f5438, "ballistic", 0x4c5135, "esapi") },
    { id: "isr", name: "Israel", short: "ISRAEL", kind: "state",
      flag: { ratio: [8, 11], layout: "bands-h", colors: ["#FFFFFF", "#0038B8", "#FFFFFF", "#0038B8", "#FFFFFF"],
        bands: [15, 25, 80, 25, 15], emblem: { kind: "hexagram", color: "#0038B8", at: [0.5, 0.5, 0.375] } },
      rifle: { gun: "carbine", look: "tavor", name: "TAVOR X95" }, training: "elite", mark: 0x2850c8,
      kit: kit("zayit", 0x55573b, "ballistic", 0x55573b, "esapi") },
    { id: "ukr", name: "Ukraine", short: "UKRAINE", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#0057B7", "#FFD700"] },
      rifle: { gun: "ak47", look: "ak74m", name: "AK-74M" }, training: "elite", mark: 0xffd700,
      kit: kit("mm14", 0x50553a, "ballistic", 0x50553a, "esapi") },
    { id: "irn", name: "Iran", short: "IRAN", kind: "state",
      flag: { ratio: [4, 7], layout: "bands-h", colors: ["#239F40", "#FFFFFF", "#DA0000"],
        emblem: { kind: "iran", color: "#DA0000", at: [0.5, 0.5, 0.3] },
        emblems: [{ kind: "takbir-border", color: "#FFFFFF", y: 1 / 3, dir: -1, n: 11 },
          { kind: "takbir-border", color: "#FFFFFF", y: 2 / 3, dir: 1, n: 11 }] },
      rifle: { gun: "ak47", name: "KL-7.62" }, training: "pro", mark: 0x239f40,
      kit: kit("irandes", 0x7d6d50, "pasgt", 0x6f6650, "lvl3", TAN) },
    { id: "irgc", name: "Islamic Revolutionary Guard Corps", short: "IRGC", kind: "force",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#0E7A3C"],
        emblem: { kind: "raised-rifle", color: "#D9252A", color2: "#FFFFFF", at: [0.5, 0.58, 0.6] },
        emblems: [{ kind: "script", color: "#FFFFFF", at: [0.5, 0.15], w: 0.46, h: 0.1, seed: "irgc-verse" }] },
      rifle: { gun: "ak47", name: "KL-7.62" }, training: "pro", mark: 0x18a04a,
      kit: kit("irgcdigi", 0x4e5236, "pasgt", 0x4e5236, "lvl3") },
    { id: "prk", name: "North Korea", short: "N. KOREA", kind: "state",
      flag: { ratio: [1, 2], layout: "bands-h", colors: ["#024FA2", "#FFFFFF", "#ED1C27", "#FFFFFF", "#024FA2"],
        bands: [6, 1, 22, 1, 6], emblem: { kind: "disc-star", color: "#FFFFFF", color2: "#ED1C27", at: [0.36, 0.5, 0.47] } },
      rifle: { gun: "ak47", name: "TYPE 58" }, training: "pro", mark: 0xed1c27,
      kit: kit("kpa", 0x56553a, "pasgt", 0x55573b, "lvl3") },
    { id: "kor", name: "South Korea", short: "S. KOREA", kind: "state",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#FFFFFF"],
        emblem: { kind: "taegeuk", color: "#CD2E3A", color2: "#0047A0", color3: "#000000", at: [0.5, 0.5, 0.5] } },
      rifle: { gun: "carbine", name: "K2C1" }, training: "elite", mark: 0x0047a0,
      kit: kit("rokgranite", 0x4c5136, "ballistic", 0x4c5136, "esapi") },
    { id: "jpn", name: "Japan", short: "JAPAN", kind: "state",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#FFFFFF"], emblem: { kind: "disc", color: "#BC002D", at: [0.5, 0.5, 0.6] } },
      rifle: { gun: "carbine", name: "HOWA TYPE 20" }, training: "elite", mark: 0xbc002d,
      kit: kit("jgsdf", 0x4c5236, "ballistic", 0x4c5236, "esapi") },
    { id: "ind", name: "India", short: "INDIA", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#FF9933", "#FFFFFF", "#138808"],
        emblem: { kind: "chakra", color: "#000080", at: [0.5, 0.5, 0.31] } },
      rifle: { gun: "ak47", look: "ak74m", name: "AK-203" }, training: "pro", mark: 0xff9933,
      kit: kit("inddigi", 0x56553a, "ballistic", 0x55573b, "lvl3") },
    { id: "pak", name: "Pakistan", short: "PAKISTAN", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-v", colors: ["#FFFFFF", "#01411C"], bands: [1, 3],
        emblem: { kind: "crescent", color: "#FFFFFF", bg: "#01411C", at: [0.625, 0.5, 0.62], dir: -0.785, k: 0.42, off: 0.15, starD: 0.58, starR: 0.17 } },
      rifle: { gun: "ak47", name: "TYPE 56" }, training: "pro", mark: 0x0d7a3a,
      kit: kit("woodland", 0x4f5136, "ballistic", 0x4c5236, "lvl3") },
    { id: "tur", name: "Turkey", short: "TURKEY", kind: "state",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#E30A17"],
        emblem: { kind: "crescent", color: "#FFFFFF", bg: "#E30A17", at: [1 / 3, 0.5, 0.5], dir: 0, k: 0.4, off: 0.125, starD: 0.66, starR: 0.25 } },
      rifle: { gun: "carbine", name: "MPT-76" }, training: "pro", mark: 0xe30a17,
      kit: kit("turkdigi", 0x50553a, "ballistic", 0x50553a, "lvl3") },
    { id: "sau", name: "Saudi Arabia", short: "SAUDI", kind: "state",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#006C35"],
        emblem: { kind: "script", color: "#FFFFFF", at: [0.5, 0.4], w: 0.62, h: 0.22, seed: "shahada-ksa" },
        emblems: [{ kind: "sword", color: "#FFFFFF", at: [0.5, 0.71], w: 0.6 }] },
      rifle: { gun: "carbine", name: "M4" }, training: "pro", mark: 0x15934c,
      kit: kit("marpat", 0x8c7a58, "ballistic", 0x95835f, "esapi", TAN) },
    { id: "syr", name: "Syria", short: "SYRIA", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#007A3D", "#FFFFFF", "#000000"],
        emblem: { kind: "stars-row", color: "#CE1126", n: 3, at: [0.5, 0.5, 0.26], gapX: 0.22 } },
      rifle: { gun: "ak47", name: "AKM" }, training: "pro", mark: 0x0b8a45,
      kit: kit("woodland", 0x4f5136, "pasgt", 0x4c5236, "lvl3") },
    { id: "irq", name: "Iraq", short: "IRAQ", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#CE1126", "#FFFFFF", "#000000"],
        emblem: { kind: "script", color: "#007A3D", at: [0.5, 0.5], w: 0.42, h: 0.2, seed: "takbir-iraq" } },
      rifle: { gun: "carbine", name: "M4" }, training: "pro", mark: 0xce1126,
      kit: kit("marpat", 0x8c7a58, "ballistic", 0x95835f, "lvl3", TAN) },
    { id: "egy", name: "Egypt", short: "EGYPT", kind: "state",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#CE1126", "#FFFFFF", "#000000"],
        emblem: { kind: "eagle", color: "#C09300", at: [0.5, 0.5, 0.3] } },
      rifle: { gun: "ak47", name: "MISR" }, training: "pro", mark: 0xc09300,
      kit: kit("chip6", 0x8c7a58, "pasgt", 0x95835f, "lvl3", TAN) },
    { id: "pol", name: "Poland", short: "POLAND", kind: "state",
      flag: { ratio: [5, 8], layout: "bands-h", colors: ["#FFFFFF", "#DC143C"] },
      rifle: { gun: "carbine", name: "MSBS GROT" }, training: "elite", mark: 0xdc143c,
      kit: kit("pantera", 0x4f5436, "ballistic", 0x4f5436, "esapi") },
    { id: "ita", name: "Italy", short: "ITALY", kind: "state",
      flag: { ratio: [2, 3], layout: "tricolour-v", colors: ["#009246", "#FFFFFF", "#CE2B37"] },
      rifle: { gun: "carbine", name: "ARX160" }, training: "elite", mark: 0x009246,
      kit: kit("vegetato", 0x4f5436, "ballistic", 0x4f5436, "esapi") },
    { id: "can", name: "Canada", short: "CANADA", kind: "state",
      flag: { ratio: [1, 2], layout: "bands-v", colors: ["#FF0000", "#FFFFFF", "#FF0000"], bands: [1, 2, 1],
        emblem: { kind: "maple", color: "#FF0000", at: [0.5, 0.52, 0.56] } },
      rifle: { gun: "carbine", name: "C8" }, training: "elite", mark: 0xe0201c,
      kit: kit("cadpat", 0x4f5436, "ballistic", 0x4f5436, "esapi") },
    // ---- non-state armed groups, by the names they are known by
    { id: "taliban", name: "Taliban", short: "TALIBAN", kind: "group",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#FFFFFF"],
        emblem: { kind: "script", color: "#111111", at: [0.5, 0.5], w: 0.72, h: 0.26, seed: "shahada-iea" } },
      rifle: { gun: "ak47", name: "AK-47" }, training: "thug", mark: 0xe8e4d8,
      kit: kit("khaki", 0x5a5440, null, null, null, { boots: 0x2b2620, gloves: null, irregular: true,
        // shalwar kameez and the turban, a chest rig over it
        hats: [["turban", 0x1a1a1c], ["turban", 0xe6e1d4], ["turban", 0x34332f], ["shemagh", 0xd9d2c0, 0x121212]],
        shirts: [0xc8bea4, 0x6f6b5d, 0x8e8774, 0x4c4f46, 0xd6cfbd, 0x5b6470], legs: [0xc8bea4, 0x6f6b5d, 0x8e8774, 0x4c4f46] }) },
    { id: "hezbollah", name: "Hezbollah", short: "HEZBOLLAH", kind: "group",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#FFE600"],
        emblem: { kind: "raised-rifle", color: "#0F7A3A", at: [0.5, 0.53, 0.56] },
        emblems: [{ kind: "script", color: "#D9252A", at: [0.5, 0.14], w: 0.5, h: 0.1, seed: "hzb-top" },
          { kind: "script", color: "#0F7A3A", at: [0.5, 0.89], w: 0.56, h: 0.09, seed: "hzb-bottom" }] },
      rifle: { gun: "ak47", name: "AKM" }, training: "pro", mark: 0xffe600,
      kit: kit("woodland", 0x4f5136, "pasgt", 0x4c5236, "lvl3") },
    { id: "hamas", name: "Hamas (al-Qassam Brigades)", short: "HAMAS", kind: "group",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#0F7A3A"],
        emblem: { kind: "script", color: "#FFFFFF", at: [0.5, 0.5], w: 0.7, h: 0.26, seed: "shahada-qassam" } },
      rifle: { gun: "ak47", name: "AKM" }, training: "thug", mark: 0x2fa85a,
      kit: kit("woodland", 0x3a3a30, null, null, null, { boots: 0x1c1c1a, gloves: null, irregular: true,
        hats: [["headband", 0x1f7a3a], ["beanie", 0x18181a], ["headband", 0x1f7a3a], ["shemagh", 0xd9d2c0, 0x121212]],
        shirts: [0x2b2c28, 0x3d4436, 0x4a4a44], legs: [0x2b2c28, 0x3a3830, 0x4a4d3a] }) },
    { id: "houthis", name: "Houthis (Ansar Allah)", short: "HOUTHIS", kind: "group",
      flag: { ratio: [2, 3], layout: "plain", colors: ["#FFFFFF"],
        emblems: [
          { kind: "script", color: "#0F7A3A", at: [0.5, 0.15], w: 0.5, h: 0.12, seed: "sarkha-1" },
          { kind: "script", color: "#D9252A", at: [0.5, 0.33], w: 0.74, h: 0.12, seed: "sarkha-2" },
          { kind: "script", color: "#D9252A", at: [0.5, 0.5], w: 0.74, h: 0.12, seed: "sarkha-3" },
          { kind: "script", color: "#D9252A", at: [0.5, 0.67], w: 0.74, h: 0.12, seed: "sarkha-4" },
          { kind: "script", color: "#0F7A3A", at: [0.5, 0.85], w: 0.56, h: 0.12, seed: "sarkha-5" }] },
      rifle: { gun: "ak47", name: "AKM" }, training: "thug", mark: 0xd9252a,
      kit: kit("ragpatch", 0x5a5440, null, null, null, { boots: 0x2b2620, gloves: null, irregular: true,
        hats: [["shemagh", 0xd9d2c0, 0x8a2a22], ["turban", 0xe6e1d4], ["shemagh", 0xe2ddd0, 0x2a2a2a], null],
        shirts: [0xd6cfbd, 0x7a6f58, 0x5b5a48, 0x9a8b6d], legs: [0x3a3830, 0x6f6450, 0x2f3a4c] }) },
    { id: "peshmerga", name: "Peshmerga (Kurdistan Region)", short: "PESHMERGA", kind: "force",
      flag: { ratio: [2, 3], layout: "bands-h", colors: ["#ED2024", "#FFFFFF", "#278E43"],
        emblem: { kind: "sun", color: "#FEBD11", n: 21, at: [0.5, 0.5, 0.42] } },
      rifle: { gun: "ak47", name: "AKM" }, training: "pro", mark: 0xfebd11,
      kit: kit("woodland", 0x4f5136, "pasgt", 0x4c5236, "lvl3") },
  ];
  const BY = Object.create(null);
  ROWS.forEach(function (r) {
    r.flag.name = r.name;
    BY[r.id] = r;
  });
  function get(id) { return id != null && BY[id] ? BY[id] : null; }
  const KIND_TITLE = { state: "COUNTRIES", force: "ARMED FORCES", group: "ARMED GROUPS" };

  CBZ.countries = {
    list: function () { return ROWS.slice(); },
    get: get,
    has: function (id) { return !!get(id); },
    flag: function (id) { const r = get(id); return r ? r.flag : null; },
    kit: function (id) { const r = get(id); return r ? r.kit : null; },
    rifle: function (id) { const r = get(id); return r ? r.rifle : null; },
    training: function (id) { const r = get(id); return r ? r.training : null; },
    mark: function (id) { const r = get(id); return r ? r.mark : null; },
    name: function (id) { const r = get(id); return r ? r.name : null; },
    short: function (id) { const r = get(id); return r ? r.short : null; },
    // the picker's groups, in order: [{ title, ids }]
    groups: function () {
      return ["state", "force", "group"].map(function (k) {
        return { kind: k, title: KIND_TITLE[k], ids: ROWS.filter(function (r) { return r.kind === k; }).map(function (r) { return r.id; }) };
      });
    },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.countries;
})();
