"use strict";
/* src/battle/menu.js — NPC War: MENU: the war room.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let mapsEl, gFeat, gMain, gDet, gMore, moreIds, muEl, callBtns, streak;

CBZ.npcwar.onBoot(function () {
  /* ============================================================ MENU
     THE GROUND IS FETCHED WHILE YOU ARE STILL CHOOSING IT. Picking a map (or
     buying air support) warms exactly that pack set, so START is a build and
     not a download. Hover counts too, on anything with a pointer: by the time
     the finger arrives the city is already in the cache. */
  mapsEl = el("maps");
});
const pickMap = {};                     // id -> select this ground (matchups use it)
/* THREE TIERS OF GROUND. The two open grounds (`featured`) are the big
   cards; the kill box sits under them; the raised Gang City venues (and the
   downtown itself) live behind MORE GROUNDS. Every map is still one <button>
   inside #maps, which is what the capture tools count. */
const artOf = function (id) {
  return id === "dunes" || id === "water" || id === "arena" || id === "snow" || id === "grass" ? "art-" + id : "art-venue";
};
const tierOf = function (id) {
  return MAPS[id].featured ? "feat" : (MAPS[id].raise || id === "city") ? "more" : "main";
};
CBZ.npcwar.onBoot(function () {
  mapsEl.innerHTML = "";
  gFeat = document.createElement("div"); gFeat.className = "gfeat";
  gMain = document.createElement("div"); gMain.className = "gmain";
  gDet = document.createElement("details");
  gMore = document.createElement("div"); gMore.className = "gmore";
  moreIds = Object.keys(MAPS).filter(function (id) { return tierOf(id) === "more"; });
  gDet.innerHTML = "<summary>MORE GROUNDS<i>" + moreIds.length + " Gang City venues</i></summary>";
  gDet.appendChild(gMore);
  mapsEl.appendChild(gFeat); mapsEl.appendChild(gMain);
  if (moreIds.length) mapsEl.appendChild(gDet);
  Object.keys(MAPS).forEach(function (id) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.map = id;
    b.innerHTML = "<b>" + MAPS[id].label + "</b><i>" + MAPS[id].note + "</i>";
    b.className = artOf(id) + (id === SET.map ? " on" : "");
    const pick = function () {
      SET.map = id;
      mapsEl.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      if (tierOf(id) === "more") gDet.open = true;
      CBZ.studio.prefetch(MAPS[id].packs);
    };
    pickMap[id] = pick;
    b.addEventListener("click", function () { pick(); menuTouched(); });
    b.addEventListener("pointerenter", function () { CBZ.studio.prefetch(MAPS[id].packs); });
    ({ feat: gFeat, main: gMain, more: gMore })[tierOf(id)].appendChild(b);
  });
  // featured order: DUNES first, WATER second, whatever the table order is
  ["dunes", "water"].forEach(function (id) {
    const b = gFeat.querySelector("[data-map=\"" + id + "\"]");
    if (b) gFeat.appendChild(b);
  });
  if (tierOf(SET.map) === "more") gDet.open = true;
  CBZ.studio.prefetch(MAPS[SET.map].packs);       // whatever was chosen last time
});
function fillGuns(sel, cur) {
  let h = "";
  GUN_ORDER.forEach(function (id) {
    const w = CBZ.weaponById && CBZ.weaponById(id);
    if (!w) return;
    h += "<option value=\"" + id + "\"" + (cur === id ? " selected" : "") + ">" + w.label + "</option>";
  });
  h += "<option value=\"mixed\"" + (cur === "mixed" ? " selected" : "") + ">MIXED RIFLES</option>";
  h += "<option value=\"everything\"" + (cur === "everything" ? " selected" : "") + ">EVERYTHING</option>";
  h += "<option value=\"fists\"" + (cur === "fists" ? " selected" : "") + ">FISTS (UNARMED)</option>";
  sel.innerHTML = h;
}
/* WHO FIGHTS — men, or ANY species straight out of the bestiary the mainland
   hunts, land or water. The list is READ, not copied: a species added to Gang
   City appears here on the next load, which is why "add a tiger shark" is a
   change to city/wildlife/aquatic.js and nothing at all to this page. Snakes
   still wait (they have no gait and no bite driver out here); everything that
   walks or swims is in, fighters first.

   THE WATER HALF IS THE OWNER'S ASK. "add water arena and water animal
   options" — so the aquatics get their own group in the list rather than
   being mixed into one flat forty-row menu, and the group is derived from
   `sp.aquatic` exactly the way the land group is derived from its absence. */
function speciesIn(water) {
  const SP = CBZ.WILDLIFE_SPECIES || {};
  // a species with a unit file but no bestiary row yet (the dog: its file
  // defines the row when it loads) is offered on land
  const MAN = CBZ.UNIT_MANIFEST || {};
  const extra = water ? [] : Object.keys(MAN).filter(function (id) { return MAN[id].kind === "species" && !SP[id]; });
  return extra.concat(Object.keys(SP)
    .filter(function (id) {
      const sp = SP[id];
      if (!sp || !sp.build || sp.snake) return false;
      /* A ROW IS AQUATIC IF IT SAYS SO EITHER WAY. `aquatic` is the flag
         wildlife.js itself branches on and the one every shipped water row
         sets; `biome === "water"` is the column the bestiary sorts by. A new
         species that declares only one of them is a species this menu would
         silently drop, and a shark missing from the roster is exactly the
         drift a derived list exists to prevent. */
      const wet = !!sp.aquatic || sp.biome === "water";
      return water ? wet : !wet;
    })
    .sort(function (a, b) { return (SP[b].danger || 0) - (SP[a].danger || 0) || (a < b ? -1 : 1); }));
}
// every vehicle a side can field (units/manifest.js), ground first
function vehiclesIn() {
  const MAN = CBZ.UNIT_MANIFEST || {};
  return Object.keys(MAN).filter(function (id) { return MAN[id].kind === "vehicle"; })
    .sort(function (a, b) { return (MAN[a].domain === "air") - (MAN[b].domain === "air"); });
}
/* A SIDE CAN BE TWO THINGS. `?ru=men|great_white_shark` is a mixed roster —
   swimmers with sharks in among them — and it is one string rather than a
   second unit select per team because the alternative is two more controls on
   the form for one kind of fight. Alternating by spawn index keeps the split
   even and deterministic; drainSpawns resolves it per body (kindAt, spawn.js). */
// a roster in words, for a select row: "MEN + DOLPHINS", "M1 ABRAMS + MEN"
function kindLabel(u) {
  const K = CBZ.unitKit;
  return CBZ.battleRoster.ids(u).map(function (k) {
    if (k === "men") return "MEN";
    return String(K ? K.meta(k).plural : k).toUpperCase();
  }).join(" + ");
}
function fillKind(sel, cur) {
  const K = CBZ.unitKit;
  const opt = function (id, label) {
    return "<option value=\"" + id + "\"" + (cur === id ? " selected" : "") + ">" + label + "</option>";
  };
  let h = opt("men", "MEN");
  const grp = function (title, ids) {
    if (!ids.length) return "";
    return "<optgroup label=\"" + title + "\">" + ids.map(function (id) {
      return opt(id, String(K ? K.meta(id).plural : id).toUpperCase());
    }).join("") + "</optgroup>";
  };
  h += grp("MACHINES", vehiclesIn());
  h += grp("THE WATER", speciesIn(true));
  h += grp("THE LAND", speciesIn(false));
  sel.innerHTML = h;
  setKind(sel, cur);
}
// the nations an army can fight for (city/flags.js); hidden until it loads
function fillFlag(sel, cur) {
  const ids = CBZ.flags && CBZ.flags.ids ? CBZ.flags.ids() : [];
  const f = sel.closest ? sel.closest(".f") : null;
  if (!ids.length) { if (f) f.style.display = "none"; return; }
  sel.innerHTML = ids.map(function (id) {
    return "<option value=\"" + id + "\"" + (cur === id ? " selected" : "") + ">" +
      String(CBZ.battleSides.nationName(id)).toUpperCase() + "</option>";
  }).join("");
  sel.value = cur;
}
/* A MATCHUP MAY HAND THIS A ROSTER THE LIST DOES NOT OFFER (a mixed side, or
   a species a pack has not loaded yet). A select silently showing the wrong
   row is how a one-tap button quietly starts the wrong war, so the value is
   ADDED rather than dropped. */
function setKind(sel, value) {
  if (value == null) return;
  sel.value = value;
  if (sel.value === value) return;
  const o = document.createElement("option");
  o.value = value; o.textContent = kindLabel(value);
  sel.insertBefore(o, sel.firstChild);
  sel.value = value;
}
// a beast army has no rifle and no drill sergeant: its gun/training rows
// grey out rather than lie. A MIXED side still has men in it, so it keeps
// both — the men in the water are the ones carrying the rifles.
function kindRows(team) {
  const u = el(team + "U").value;
  const noMen = !CBZ.battleRoster.has(u, "men");
  // an army (men or machines) fights under a flag; a pride of lions does not
  const noArmy = noMen && !CBZ.battleRoster.ids(u).some(function (id) { return CBZ.unitKit.kindOf(id) === "vehicle"; });
  [["W", noMen], ["T", noMen], ["F", noArmy]].forEach(function (r) {
    const s = el(team + r[0]);
    if (!s) return;
    s.disabled = r[1];
    const f = s.closest(".f") || s;
    f.classList.toggle("off", r[1]);
  });
  sumUp();
}
function fillTraining(sel, cur) {
  sel.innerHTML = TRAININGS.map(function (t) {
    return "<option value=\"" + t.id + "\"" + (cur === t.id ? " selected" : "") + ">" + t.label + "</option>";
  }).join("");
}
function fillSupport(sel, cur) {
  sel.innerHTML = SUPPORTS.map(function (s) {
    return "<option value=\"" + s.id + "\"" + (cur === s.id ? " selected" : "") + ">" + s.label + "</option>";
  }).join("");
}
CBZ.npcwar.onBoot(function () {
  fillGuns(el("redW"), SET.redW); fillGuns(el("blueW"), SET.blueW);
  fillTraining(el("redT"), SET.redT); fillTraining(el("blueT"), SET.blueT);
  fillSupport(el("redS"), SET.redS); fillSupport(el("blueS"), SET.blueS);
  fillKind(el("redU"), SET.redU); fillKind(el("blueU"), SET.blueU);
  fillFlag(el("redF"), SET.nationA); fillFlag(el("blueF"), SET.nationB);
  ["red", "blue"].forEach(function (t) {
    el(t + "U").addEventListener("change", function () { kindRows(t); });
    kindRows(t);
  });
  el("redN").value = SET.redN; el("blueN").value = SET.blueN;
  // BEST OF: one tap, lit while chosen
  const boBtns = el("bestof").querySelectorAll("button");
  const showBo = function () { boBtns.forEach(function (b) { b.classList.toggle("on", +b.dataset.bo === SET.bo); }); };
  boBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      SET.bo = +b.dataset.bo;
      SERIES = CBZ.battleSeries.make(SET.bo, 0, 0);
      showBo();
    });
  });
  showBo();
});
/* THE QUESTIONS. Each card is a fight people argue about, asked as the
   question itself. A tap fills the form (ground, kind, count, weapon,
   training) and nothing else; START is still yours.

   EVERY ROW NAMES ITS GROUND. "8 ORCAS v A MEGALODON" on the kill box is not
   a matchup, it is a bug, and a land fight on whatever you picked last is a
   card that lies about what it shows. The land fights are on the open dunes
   (the owner's favourite ground), the sea fights on open water.

   The water pod sizes are the argument: 8 is the pod that wins on the
   shipped rows, 4 is the pod that does not (measured; see
   tools/visual-presets/water-arena.mjs). A fleet is a crew, not a
   battalion: at 48 riflemen the megalodon died in nineteen seconds and
   never reached a hull, because bullets sit outside the body-mass model;
   twenty men with shotguns is a fishing fleet, and it is a fight. THE SHARK
   LINE-UP is the animation test bed as a button: one of each shark with
   something to chase, for the STUDY camera (V, and [ ] to walk it). */
const MATCHUPS = [
  { q: "100 MEN v A GORILLA", sub: "bare fists, nobody trained", map: "dunes",
    r: { u: "men", n: 100, w: "fists", t: "civ" }, b: { u: "gorilla", n: 1 } },
  { q: "A TIGER v A LION", sub: "one on one", map: "dunes",
    r: { u: "bengal_tiger", n: 1 }, b: { u: "lion", n: 1 } },
  { q: "100 MEN v AN ELEPHANT", sub: "street fighters, bare fists", map: "dunes",
    r: { u: "men", n: 100, w: "fists", t: "thug" }, b: { u: "african_elephant", n: 1 } },
  { q: "100 LIONS v 1000 DOGS", sub: "teeth against numbers", map: "dunes",
    r: { u: "lion", n: 100 }, b: { u: "dog", n: 1000 } },
  /* ARMOUR. A counted roster ("m1_abrams*1,men*1") puts the man IN the tank:
     a side's men crew its vehicles first (src/battle/vehicles.js). */
  { q: "1 MAN AND AN M1 ABRAMS v 200 MEN", sub: "one tank, one crewman, two hundred rifles", map: "dunes",
    r: { u: "m1_abrams*1,men*1", n: 2, w: "ak47", t: "elite" }, b: { u: "men", n: 200, w: "ak47", t: "pro" } },
  { q: "3 M1 ABRAMS v 20 GORILLAS", sub: "a troop of silverbacks against armour", map: "dunes",
    r: { u: "m1_abrams*3", n: 3 }, b: { u: "gorilla", n: 20 } },
  { q: "A STRYKER AND 30 SOLDIERS v 12 LIONS", sub: "infantry and their APC against a pride", map: "dunes",
    r: { u: "stryker_apc*1,men*30", n: 31, w: "ak47", t: "elite" }, b: { u: "lion", n: 12 } },
  { q: "60 WOLVES v 30 SOLDIERS", sub: "the pack against rifles", map: "dunes",
    r: { u: "gray_wolf", n: 60 }, b: { u: "men", n: 30, w: "ak47", t: "elite" } },
  { q: "12 BEARS v 120 MEN", sub: "and the men have no guns", map: "dunes",
    r: { u: "brown_bear", n: 12 }, b: { u: "men", n: 120, w: "fists", t: "thug" } },
  { q: "200 BISON v 60 RIFLES", sub: "the stampede", map: "dunes",
    r: { u: "bison", n: 200 }, b: { u: "men", n: 60, w: "ak47", t: "pro" } },
  { q: "8 ORCAS v A MEGALODON", sub: "is a pod of eight enough?", map: "water",
    r: { u: "orca", n: 8 }, b: { u: "megalodon", n: 1 } },
  { q: "4 ORCAS v A MEGALODON", sub: "half the pod", map: "water",
    r: { u: "orca", n: 4 }, b: { u: "megalodon", n: 1 } },
  { q: "A MEGALODON v A FLEET", sub: "20 fishermen with shotguns", map: "water",
    r: { u: "megalodon", n: 1 }, b: { u: "men", n: 20, w: "shotgun", t: "civ" } },
  { q: "A GREAT WHITE v A BAIT BALL", sub: "400 sardines", map: "water",
    r: { u: "great_white_shark", n: 1 }, b: { u: "sardine", n: 400 } },
  { q: "4 GREAT WHITES v 30 SWIMMERS", sub: "nobody brought a weapon", map: "water",
    r: { u: "great_white_shark", n: 4 }, b: { u: "men", n: 30, w: "fists", t: "civ" } },
  { q: "DIVERS AND DOLPHINS v SHARKS", sub: "pistols against bulls and hammerheads", map: "water",
    r: { u: "men|dolphin", n: 40, w: "sidearm", t: "pro" }, b: { u: "bull_shark|hammerhead_shark", n: 26 } },
  { q: "THE REEF, ALIVE", sub: "tuna and barracuda on the shoals", map: "water",
    r: { u: "tuna|barracuda", n: 90 }, b: { u: "sardine|fish", n: 300 } },
  { q: "THE SHARK LINE-UP", sub: "one of each, to study up close", map: "water",
    r: { u: "great_white_shark|hammerhead_shark|bull_shark|orca", n: 8 }, b: { u: "sardine", n: 120 } },
];
CBZ.npcwar.onBoot(function () {
  muEl = el("matchups");
});
const muBtns = [];
const esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
function markMu(btn) { muBtns.forEach(function (x) { x.classList.toggle("on", x === btn); }); }
// any hand edit after a card means the form is no longer that card
function menuTouched() { markMu(null); sumUp(); }
function muMatches(mu) {
  if (mu.map && mu.map !== SET.map) return false;
  return [["red", mu.r], ["blue", mu.b]].every(function (row) {
    const t = row[0], v = row[1];
    return el(t + "U").value === v.u && String(el(t + "N").value) === String(v.n) &&
      (!v.w || el(t + "W").value === v.w) && (!v.t || el(t + "T").value === v.t);
  });
}
CBZ.npcwar.onBoot(function () {
  MATCHUPS.forEach(function (mu) {
    const b = document.createElement("button");
    b.type = "button";
    const ground = MAPS[mu.map] ? mu.map : SET.map;
    b.className = "mu " + artOf(ground);
    b.innerHTML = "<span class=\"mg\">" + esc(MAPS[ground].label) + "</span>" +
      "<span class=\"mq\">" + esc(mu.q).split(" v ").join(" <em>v</em> ") + "</span>" +
      "<span class=\"ms\">" + esc(mu.sub || "") + "</span>" +
      "<span class=\"mb\"><s></s><s></s></span>";
    b.addEventListener("click", function () {
      if (mu.map && pickMap[mu.map]) pickMap[mu.map]();
      [["red", mu.r], ["blue", mu.b]].forEach(function (row) {
        const t = row[0], v = row[1];
        setKind(el(t + "U"), v.u);
        el(t + "N").value = v.n;
        if (v.w) el(t + "W").value = v.w;
        if (v.t) el(t + "T").value = v.t;
        kindRows(t);
      });
      markMu(b);
      sumUp();
    });
    muBtns.push(b);
    muEl.appendChild(b);
    if (muMatches(mu)) b.classList.add("on");
  });
  // a hand edit anywhere on the armies clears the highlighted question
  document.querySelector("#menu .teams").addEventListener("input", menuTouched);
  document.querySelector("#menu .teams").addEventListener("change", menuTouched);
});

/* THE COUNT STEPPER COUNTS IN ORDERS OF MAGNITUDE. 1, 2 .. 9, 10, 20 .. 90,
   100, 200 .. so "1 v 1000" is a dozen taps and not a hundred. Minus steps by
   the magnitude BELOW the current value, so it walks back the same ladder. */
function stepCount(v, dir) {
  const base = dir > 0 ? v : Math.max(1, v - 1);
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(1, base))));
  return Math.max(1, v + dir * step);
}
CBZ.npcwar.onBoot(function () {
  document.querySelectorAll("#menu .cnt button").forEach(function (b) {
    b.addEventListener("click", function () {
      const inp = el(b.dataset.t + "N");
      inp.value = stepCount(parseInt(inp.value, 10) || 1, parseInt(b.dataset.d, 10) > 0 ? 1 : -1);
      menuTouched();
    });
  });
  el("presets").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      el("redN").value = b.dataset.n; el("blueN").value = b.dataset.n;
      menuTouched();
    });
  });
});

/* WHAT EACH SIDE IS, read back in words: as the side's name and on its WHO
   WINS button, so the call is made on "100 MEN" and not on a colour. The
   form is read into SET first so the words are exactly the ones the HUD and
   the end card will use (refreshSides, battle/core/sides.js). */
// the war room's form as a SET-shaped record (blank controls keep SET's value)
function formSet() {
  const v = function (id, d) { const e = el(id); return e && e.value !== "" && e.value != null ? e.value : d; };
  const o = {
    redN: Math.max(1, parseInt(v("redN", SET.redN), 10) || 1), blueN: Math.max(1, parseInt(v("blueN", SET.blueN), 10) || 1),
    redU: v("redU", SET.redU), blueU: v("blueU", SET.blueU),
    redT: v("redT", SET.redT), blueT: v("blueT", SET.blueT),
    nationA: v("redF", SET.nationA), nationB: v("blueF", SET.nationB),
  };
  // a counted roster carries its own size
  if (CBZ.battleRoster.parse(o.redU).counted) o.redN = CBZ.battleRoster.size(o.redU);
  if (CBZ.battleRoster.parse(o.blueU).counted) o.blueN = CBZ.battleRoster.size(o.blueU);
  return o;
}
function formToSet() { Object.assign(SET, formSet()); }
function sumUp() {
  refreshSides(formSet());
  ["red", "blue"].forEach(function (t) {
    const S = SIDES[t];
    const h = el(t + "H"); if (h) h.innerHTML = flagImg(t) + " " + esc(TEAMS[t].name);
    // under the name: the nation when the name is the head count, or the
    // head count when two armies are told apart by their nations
    const sub = TEAMS[t].name === String(S.label).toUpperCase() ? (S.title || "") : S.label;
    const k = el(t + "K"); if (k) k.textContent = String(sub).toUpperCase();
    const n = el(t + "CallN"); if (n) n.textContent = TEAMS[t].name;
    const c = el(t + "CallK"); if (c) c.textContent = String(sub).toUpperCase();
  });
}
CBZ.npcwar.onBoot(function () {

  /* THE CALL. Two buttons, both optional; tapping your pick again takes it
     back. The end screen reads SET.call and scores it into the streak. */
  callBtns = el("callrow").querySelectorAll("button");
});
function showCall() {
  callBtns.forEach(function (b) { b.classList.toggle("on", b.dataset.call === SET.call); });
}
CBZ.npcwar.onBoot(function () {
  callBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      SET.call = SET.call === b.dataset.call ? null : b.dataset.call;
      showCall();
    });
  });
  showCall();
  streak = (function () {
    try { return JSON.parse(localStorage.getItem("cbz-npcwar-streak") || "null"); } catch (e) { return null; }
  })();
  if (streak && (streak.calls > 0 || streak.best > 0)) {
    const parts = ["STREAK " + (streak.streak | 0), "BEST " + (streak.best | 0)];
    if (streak.calls > 0) parts.push("CALLED " + (streak.right | 0) + " OF " + (streak.calls | 0));
    el("streak").textContent = parts.join("    ");
  }
  sumUp();
});

function readMenu() {
  formToSet();
  SET.redW = el("redW").value; SET.blueW = el("blueW").value;
  SET.redS = el("redS").value; SET.blueS = el("blueS").value;
  refreshSides();
  try {
    localStorage.setItem("cbz-npcwar", JSON.stringify({
      map: SET.map, redN: SET.redN, blueN: SET.blueN,
      redU: SET.redU, blueU: SET.blueU,
      redW: SET.redW, blueW: SET.blueW, redT: SET.redT, blueT: SET.blueT,
      redS: SET.redS, blueS: SET.blueS, call: SET.call,
      nationA: SET.nationA, nationB: SET.nationB, bo: SET.bo,
    }));
  } catch (e) {}
}
// what the chosen battle actually needs: the ground's packs, plus the air
// stack only when somebody bought air, plus the mushroom only for a nuke
// Is either army an animal army? Read once per battle at begin() — it gates
// the corpse solver's step and the blood pack (see both call sites).
let HAS_BEASTS = false;
// an animal anywhere on either side (a vehicle or a man is not one)
function rosterHasBeasts() {
  const R = CBZ.battleRoster, K = CBZ.unitKit;
  return R.ids(SET.redU).concat(R.ids(SET.blueU)).some(function (id) {
    return id !== "men" && (!K || K.kindOf(id) !== "vehicle");
  });
}
function packsFor() {
  const p = MAPS[SET.map].packs.slice();
  // the General's own sorties need the air stack loaded even with no army air
  // airbase rides along for its aircraft FACTORIES, not for a base: raw
  // milModels.bomber (the B-52H unit) returns a {group, footprint} record,
  // and airbase.js is the layer that hands back a seated THREE.Group — the
  // exact reason studio.model asks it first.
  if (SET.redS !== "none" || SET.blueS !== "none") p.push("military", "airbase", "air", "ordnance");
  if (SET.redS === "nuke" || SET.blueS === "nuke") p.push("nukefx");
  /* BLOOD RIDES WITH THE ANIMALS. creature_combat's bite now draws real
     blood (systems/gore.js), and this page had bodies that remembered hits
     and a world that never showed one landing — a gorilla closed its jaws on
     a man and the only evidence in the frame was a decal you had to fly down
     to find. But 2.5k lines of gore is the ANIMALS' bill: men on this page
     shoot each other and gunfx has drawn their impacts since it shipped. So
     the pack is pulled exactly when a side is a beast army, and a battle of
     riflemen loads and costs precisely what it always did — which is what
     tools/battle-check.mjs measures. */
  HAS_BEASTS = rosterHasBeasts();
  // ?blood=1 pulls it for a battle of MEN too — a rifle war that stains the
  // street is a legitimate thing to want, it is just not worth 2.5k lines by
  // default when gunfx already draws every impact. ?blood=0 refuses it even
  // for an animal army, which is the revert.
  if (BLOOD_Q !== "0" && (HAS_BEASTS || BLOOD_Q === "1")) p.push("blood");
  /* AND THE SEA RIDES WITH THE SEA, for exactly the reason blood rides with
     the animals — and this one was a real hole, not a tidy-up.

     OPEN WATER and the marine roster shipped with the new models and NONE of
     the systems that make them animals: no hunt, so a great white swam in a
     straight line forever; no dorsal cutting the surface, which is the whole
     above-water read; no blood in the water; no megalodon bite across a
     hull; no bait ball to attack. Every one of those lives in a file that
     was in no studio pack at all, so nothing errored and the pack list gave
     no hint. The `marine` pack is where they live now.

     Pulled when the venue is water OR either side is a sea animal, so a
     battle of riflemen in a city costs precisely what it always did — the
     same bargain `blood` strikes, measured by tools/battle-check.mjs.
     ?marine=0 refuses it, which is the revert. */
  const wetRoster = isWaterSpecies(SET.redU) || isWaterSpecies(SET.blueU);
  if (MARINE_Q !== "0" && (MAPS[SET.map].ocean || wetRoster)) p.push("marine");
  return p;
}
CBZ.npcwar.onBoot(function () {
  // buying air is a decision that costs four packs; warm them on the change,
  // not on the START press
  ["redS", "blueS"].forEach(function (k) {
    el(k).addEventListener("change", function () {
      SET[k] = el(k).value;
      CBZ.studio.prefetch(packsFor());
    });
  });
  el("start").addEventListener("click", function () {
    readMenu();
    const need = packsFor();
    if (need.length) {
      filesIn = 0;
      const groundPlan = CBZ.studio.plan(need);
      TOTAL_FILES = Math.max(1, groundPlan.files.length);
      el("boottrack").classList.remove("done");
      bar("BUILDING THE GROUND");
      CBZ.studio.need(need).then(function () { withUnits(function () { begin(false); }); });
    } else withUnits(function () { begin(false); });
  });
  el("boottrack").classList.add("done");
  el("menu").classList.add("ready");
  bootst("READY");
});
