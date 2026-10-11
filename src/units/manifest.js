/* ============================================================
   units/manifest.js — every unit NPC War can field, by id: what it is
   CALLED (one and many) and its real collective noun. Data only.

   This is the ONLY place a unit's name lives. The war room, the HUD and the
   end card read it (CBZ.unitKit.label(id, n) -> "40 gorillas"), so a side is
   always a number and the real name of the thing: "1 Bengal tiger",
   "200 soldiers", "3 M1 Abrams". Never "RED", never an invented army.

   `group` is the real collective noun and is left OUT where there is none
   (a crash of rhinos, yes; nothing invented for a raccoon). Presets may use
   it ("a troop of gorillas"); plain labels never need it.

   A row here also says the unit has a file: units/species/<id>.js or
   units/vehicles/<id>.js, loaded at START by CBZ.unitKit.need(). `needs`
   lists extra engine files the unit file depends on (studio-root relative).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  function S(name, plural, group) { const r = { kind: "species", name: name, plural: plural }; if (group) r.group = group; return r; }
  // the cat engine (units/kit/felid.js) and the kit it stands on
  const FELID = ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/kit/felid.js"];
  // men: the unit word follows the size, as an army counts it
  function menGroup(n) {
    return n <= 12 ? "squad" : n <= 50 ? "platoon" : n <= 250 ? "company" : n <= 1000 ? "battalion" : n <= 5000 ? "brigade" : "division";
  }
  // the wild dogs share one rig: src/units/kit/canid.js on the animal kit
  const CANID = ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/kit/canid.js"];
  CBZ.UNIT_MANIFEST = {
    men: { kind: "men", name: "man", plural: "men", group: menGroup },

    // ---- land -------------------------------------------------------------
    gorilla: Object.assign(S("gorilla", "gorillas", "troop"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    bengal_tiger: Object.assign(S("Bengal tiger", "Bengal tigers", "streak"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    lion: Object.assign(S("lion", "lions", "pride"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    white_lion: Object.assign(S("white lion", "white lions", "pride"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/lion.js"] }),
    cheetah: Object.assign(S("cheetah", "cheetahs", "coalition"), { needs: FELID }),
    snow_leopard: Object.assign(S("snow leopard", "snow leopards", "leap"), { needs: FELID }),
    gray_wolf: Object.assign(S("gray wolf", "gray wolves", "pack"), { needs: CANID }),
    arctic_wolf: Object.assign(S("Arctic wolf", "Arctic wolves", "pack"), { needs: CANID }),
    coyote: Object.assign(S("coyote", "coyotes", "pack"), { needs: CANID }),
    black_bear: Object.assign(S("black bear", "black bears", "sloth"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/brown_bear.js"] }),
    brown_bear: Object.assign(S("brown bear", "brown bears", "sloth"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    polar_bear: Object.assign(S("polar bear", "polar bears", "sloth"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/brown_bear.js"] }),
    african_elephant: Object.assign(S("African elephant", "African elephants", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    white_rhino: Object.assign(S("white rhino", "white rhinos", "crash"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    giraffe: S("giraffe", "giraffes", "tower"),
    zebra: S("zebra", "zebras", "dazzle"),
    bison: Object.assign(S("bison", "bison", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    moose: Object.assign(S("moose", "moose", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/bison.js"] }),
    elk: Object.assign(S("elk", "elk", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/bison.js"] }),
    caribou: Object.assign(S("caribou", "caribou", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "units/species/bison.js"] }),
    whitetail_deer: S("whitetail deer", "whitetail deer", "herd"),
    white_stag: S("white stag", "white stags", "herd"),
    wild_boar: S("wild boar", "wild boar", "sounder"),
    mountain_goat: S("mountain goat", "mountain goats", "herd"),
    bighorn_sheep: S("bighorn sheep", "bighorn sheep", "flock"),
    red_fox: Object.assign(S("red fox", "red foxes", "skulk"), { needs: CANID }),
    raccoon: S("raccoon", "raccoons"),
    cottontail_rabbit: S("cottontail rabbit", "cottontail rabbits", "colony"),
    jackrabbit: S("jackrabbit", "jackrabbits"),
    snowshoe_hare: S("snowshoe hare", "snowshoe hares"),
    cow: S("cow", "cows", "herd"),
    pig: S("pig", "pigs"),
    sheep: S("sheep", "sheep", "flock"),
    goat: S("goat", "goats", "herd"),
    horse: Object.assign(S("horse", "horses", "herd"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js"] }),
    chicken: S("chicken", "chickens", "flock"),
    // the war room's "1000 DOGS": the city's one dog (city/dogmodel.js)
    dog: Object.assign(S("dog", "dogs", "pack"), { needs: ["units/kit/gait.js", "units/kit/quadrig.js", "units/kit/loft.js", "city/dogmodel.js"] }),

    // ---- water ------------------------------------------------------------
    great_white_shark: S("great white shark", "great white sharks", "shiver"),
    megalodon: S("megalodon", "megalodons"),
    hammerhead_shark: S("great hammerhead", "great hammerheads", "shiver"),
    bull_shark: S("bull shark", "bull sharks", "shiver"),
    orca: S("orca", "orcas", "pod"),
    dolphin: S("dolphin", "dolphins", "pod"),
    humpback_whale: S("humpback whale", "humpback whales", "pod"),
    tuna: S("bluefin tuna", "bluefin tuna", "school"),
    marlin: S("blue marlin", "blue marlin"),
    barracuda: S("great barracuda", "great barracudas", "school"),
    fish: S("mackerel", "mackerel", "school"),
    sardine: S("sardine", "sardines", "school"),
    manta_ray: S("giant manta ray", "giant manta rays"),
    sea_turtle: S("green sea turtle", "green sea turtles", "bale"),

    // ---- vehicles ---------------------------------------------------------
    /* The ground hulls are built by city/mil_armor.js (one builder per class)
       and nothing in a studio pack loaded it outside the full city, so every
       one of them threw in NPC War. `needs` pulls it with the unit. Air
       frames come from city/mil_air.js (the `military` pack) and the B-2
       from city/strategic.js. */
    m1_abrams: V("M1 Abrams", "M1 Abrams", "ground", ["city/mil_armor.js"]),
    bradley_ifv: V("M2 Bradley", "M2 Bradleys", "ground", ["city/mil_armor.js"]),
    stryker_apc: V("Stryker", "Strykers", "ground"),
    hmmwv: V("Humvee", "Humvees", "ground", ["units/kit/hull.js"]),
    m35_truck: V("M35 cargo truck", "M35 cargo trucks", "ground", ["units/kit/hull.js"]),
    fmtv: V("FMTV truck", "FMTV trucks", "ground", ["units/kit/hull.js"]),
    m270_mlrs: V("M142 HIMARS", "M142 HIMARS launchers", "ground", ["city/mil_armor.js"]),   // the id keeps the census name; the model is the wheeled six-round pod
    patriot_launcher: V("Patriot launcher", "Patriot launchers", "ground", ["city/mil_armor.js"]),
    technical: V("technical", "technicals", "ground", ["units/kit/hull.js"]),
    ah64_apache: V("AH-64 Apache", "AH-64 Apaches", "air", ["city/mil_air.js"]),
    uh60_black_hawk: V("UH-60 Black Hawk", "UH-60 Black Hawks", "air", ["city/mil_air.js"]),
    f35: V("F-35", "F-35s", "air", ["city/mil_air.js"]),
    mq9_reaper: V("MQ-9 Reaper", "MQ-9 Reapers", "air", ["city/mil_air.js"]),
    b52: V("B-52", "B-52s", "air", ["city/mil_air.js"]),
    b2_spirit: V("B-2 Spirit", "B-2 Spirits", "air", []),            // draws itself (units/vehicles/b2_spirit.js)
    a400m: V("A400M", "A400Ms", "air", ["city/mil_air.js", "city/mil_armor.js", "city/island_military.js"]),
  };
  // a vehicle row: `domain` ground|air, `needs` engine files its build uses.
  // A group of vehicles is a platoon (4 tanks) / troop / flight: left to the
  // unit file (`group`), never invented here.
  function V(name, plural, domain, needs) { return { kind: "vehicle", name: name, plural: plural, domain: domain, needs: needs }; }
})();
