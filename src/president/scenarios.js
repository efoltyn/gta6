/* ============================================================
   president/scenarios.js — WHICH WORLD YOU PLAY: THE WHOLE EARTH OR ONE
   REGION OF IT.

   OWNER (2026-10-28): "different versions of game should be regions. i want
   a full world game and then regions: middle east, africa, europe, asia,
   na, sa, and americas, me and africa, plus full world, just usa like state
   vs state, and it is possible to conquer everyone and map shows your
   country growing".

   ONE TABLE. A scenario is only who is in it and where the map looks:
     id, name, sub      what the lobby says
     kind               "nations" (president/nations.js rows) or "states"
                        (president/states.js rows)
     regions            the nations rows whose `reg` is one of these
     ids / plus         an exact member list, or extra members on top of regions
     frame              [lonW, lonE, latN, latS]: what the map shows first
                        (lonE may pass 180: the map wraps)
     pick               the country the lobby offers first
     aggr               added to every AI leader's appetite for war (the
                        states are a union coming apart: they need a push)
     tension            how much more often its AI goes to war, and that
                        its democracies fight like anyone else
   Everything else (the economy outside the scenario, the borders, the
   fronts) world.js derives from the members. Land of a country that is not
   a member is drawn, named and grey, and nobody marches across it.

   PUBLIC  CBZ.presScenarios = { list, byId, members(id) -> rows }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  const MIDEAST = ["tur", "cyp", "syr", "lbn", "isr", "pse", "jor", "irq", "irn", "sau", "kwt", "bhr", "qat", "are", "omn", "yem", "egy"];
  const LIST = [
    { id: "world", name: "Full World", sub: "Every country on Earth", kind: "nations", regions: ["na", "sa", "eu", "me", "af", "as", "oc"], frame: [-180, 180, 76, -56], pick: "usa" },
    { id: "mideast", name: "Middle East", sub: "From the Bosporus to the Gulf", kind: "nations", ids: MIDEAST, frame: [24, 64, 43, 11], pick: "sau" },
    { id: "africa", name: "Africa", sub: "All 54 countries", kind: "nations", regions: ["af"], plus: ["egy"], frame: [-26, 60, 38, -36], pick: "nga" },
    { id: "europe", name: "Europe", sub: "The Atlantic to the Urals", kind: "nations", regions: ["eu"], frame: [-25, 62, 72, 34], pick: "deu" },
    { id: "asia", name: "Asia", sub: "From the Urals to the Pacific", kind: "nations", regions: ["as"], plus: ["rus"], frame: [25, 180, 76, -12], pick: "chn" },
    { id: "na", name: "North America", sub: "Canada to Panama and the Caribbean", kind: "nations", regions: ["na"], frame: [-170, -52, 76, 6], pick: "usa" },
    { id: "sa", name: "South America", sub: "Colombia to Cape Horn", kind: "nations", regions: ["sa"], frame: [-93, -32, 14, -56], pick: "bra" },
    { id: "americas", name: "The Americas", sub: "Alaska to Cape Horn", kind: "nations", regions: ["na", "sa"], frame: [-170, -32, 76, -56], pick: "usa" },
    { id: "meaf", name: "Middle East and Africa", sub: "The Gulf, the Levant and Africa", kind: "nations", regions: ["af"], plus: MIDEAST, frame: [-26, 64, 43, -36], pick: "egy" },
    { id: "usa", name: "USA", sub: "State against state", kind: "states", frame: [-170, -65, 72, 18], pick: "tx", aggr: 0.2, tension: 3 },
  ];
  const byId = {};
  LIST.forEach(function (s) { byId[s.id] = s; });

  function nations() { return CBZ.presNations || (typeof require === "function" ? require("./nations.js") : null); }
  function states() { return CBZ.presStates || (typeof require === "function" ? require("./states.js") : null); }
  // the member rows, in their data file's order
  function members(id) {
    const sc = byId[id] || byId.world;
    if (sc.kind === "states") return states().list.slice();
    const want = {};
    (sc.ids || []).forEach(function (k) { want[k] = 1; });
    (sc.plus || []).forEach(function (k) { want[k] = 1; });
    return nations().list.filter(function (n) { return want[n.id] || (sc.regions && sc.regions.indexOf(n.reg) >= 0); });
  }
  CBZ.presScenarios = { list: LIST, byId: byId, members: members };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presScenarios;
})(this);
