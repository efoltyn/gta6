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
// the guns on the menu; the side's country names the row its service rifle
// fires as by that rifle ("L85A3" on the carbine row for the UK)
function fillGuns(sel, cur, nation) {
  let h = "";
  const R = nation && CBZ.countries ? CBZ.countries.rifle(nation) : null;
  GUN_ORDER.forEach(function (id) {
    const w = CBZ.weaponById && CBZ.weaponById(id);
    if (!w) return;
    const label = R && R.gun === id ? R.name : w.label;
    h += "<option value=\"" + id + "\"" + (cur === id ? " selected" : "") + ">" + label + "</option>";
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
/* THE COUNTRY an army fights for (battle/core/countries.js): the select
   holds the value and lists them by kind (countries, armed forces, armed
   groups); the strip under it is the same choice as flags, one tap each.
   A country brings its rifle and its training into the two rows above it;
   both stay yours to change. An id the list does not hold (a URL naming one
   of the city's nations) is added rather than dropped. */
function fillFlag(sel, cur) {
  const C = CBZ.countries;
  if (!C) return;
  let h = "";
  C.groups().forEach(function (G) {
    h += "<optgroup label=\"" + G.title + "\">" + G.ids.map(function (id) {
      return "<option value=\"" + id + "\"" + (cur === id ? " selected" : "") + ">" + esc(String(C.name(id)).toUpperCase()) + "</option>";
    }).join("") + "</optgroup>";
  });
  sel.innerHTML = h;
  sel.value = cur;
  if (cur && sel.value !== cur) {
    const o = document.createElement("option");
    o.value = cur; o.textContent = String(CBZ.battleSides.nationName(cur)).toUpperCase();
    sel.insertBefore(o, sel.firstChild);
    sel.value = cur;
  }
}
const FLAG_TILE = {};
function flagTile(id) {
  if (FLAG_TILE[id] != null) return FLAG_TILE[id];
  let u = "";
  try { u = CBZ.flags && CBZ.flags.dataURL ? CBZ.flags.dataURL(id, 72) || "" : ""; } catch (e) {}
  return (FLAG_TILE[id] = u);
}
function fillFlagStrip(team) {
  const box = el(team + "FS"), C = CBZ.countries;
  if (!box || !C) return;
  box.innerHTML = "";
  C.list().forEach(function (r) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.id = r.id; b.title = r.name; b.setAttribute("aria-label", r.name);
    const u = flagTile(r.id);
    b.innerHTML = u ? "<img alt=\"\" src=\"" + u + "\">" : "<span>" + esc(r.short) + "</span>";
    b.addEventListener("click", function () { pickCountry(team, r.id); menuTouched(); });
    box.appendChild(b);
  });
  markFlagStrip(team);
}
function markFlagStrip(team) {
  const box = el(team + "FS");
  if (!box) return;
  const cur = el(team + "F").value;
  box.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.id === cur); });
}
// a country picked: its flag, and its rifle and training into the rows above
function pickCountry(team, id, keep) {
  const sel = el(team + "F");
  if (sel.value !== id) {
    sel.value = id;
    if (sel.value !== id) fillFlag(sel, id);
  }
  const C = CBZ.countries;
  const R = C ? C.rifle(id) : null;
  const w = el(team + "W");
  const cur = keep && keep.w ? keep.w : (R ? R.gun : w.value);
  fillGuns(w, cur, id);
  w.value = cur;
  if (!(keep && keep.t) && C && C.training(id)) el(team + "T").value = C.training(id);
  if (keep && keep.t) el(team + "T").value = keep.t;
  markFlagStrip(team);
  sumUp();
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
  const fs = el(team + "FS");
  if (fs) fs.classList.toggle("off", noArmy);
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
  fillGuns(el("redW"), SET.redW, SET.nationA); fillGuns(el("blueW"), SET.blueW, SET.nationB);
  fillTraining(el("redT"), SET.redT); fillTraining(el("blueT"), SET.blueT);
  fillSupport(el("redS"), SET.redS); fillSupport(el("blueS"), SET.blueS);
  fillKind(el("redU"), SET.redU); fillKind(el("blueU"), SET.blueU);
  fillFlag(el("redF"), SET.nationA); fillFlag(el("blueF"), SET.nationB);
  ["red", "blue"].forEach(function (t) {
    el(t + "U").addEventListener("change", function () { kindRows(t); });
    el(t + "F").addEventListener("change", function () { pickCountry(t, el(t + "F").value); });
    fillFlagStrip(t);
    kindRows(t);
  });
  el("redN").value = SET.redN; el("blueN").value = SET.blueN;
});
const esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
// a hand edit anywhere on the armies re-reads the two sides' names
function menuTouched() { sumUp(); }
CBZ.npcwar.onBoot(function () {
  document.querySelector("#menu .teams").addEventListener("input", menuTouched);
  document.querySelector("#menu .teams").addEventListener("change", menuTouched);
});

/* ============================================================ THE FORCE
   A SIDE IS A LIST OF WHAT IT BRINGS. The war room used to open on a wall of
   "who would win" poster cards and a single WHO dropdown per side, so an
   army was one kind of thing (and the owner: "I hate those pregame settings.
   It makes the game so stupid"). Now each side is a force you build: a row
   of infantry and a row for every machine or animal you add, each with its
   own count. Quick buttons add the usual arms; the select under them adds
   anything the game has. The list is written into the hidden WHO / HOW MANY
   controls as one roster string (battle/core/roster.js: "m1_abrams*4,men*120"),
   so everything downstream reads a side exactly as it always did. */
const FORCE = { red: [], blue: [] };
const FORCE_QUICK = [["m1_abrams", "TANK"], ["bradley_ifv", "IFV"], ["stryker_apc", "APC"], ["hmmwv", "HUMVEE"],
  ["m270_mlrs", "ROCKET ARTILLERY"], ["ah64_apache", "GUNSHIP"], ["uh60_black_hawk", "AIR ASSAULT"], ["f35", "STRIKE JET"], ["b52", "HEAVY BOMBER"]];
function forceLabel(id) { return id === "men" ? "INFANTRY" : kindLabel(id); }
function forceIsMachine(id) { return !!(CBZ.unitKit && id !== "men" && CBZ.unitKit.kindOf(id) === "vehicle"); }
function forceRead(t) {
  const u = el(t + "U").value || SET[t + "U"], n = parseInt(el(t + "N").value, 10) || SET[t + "N"] || 1;
  const L = [];
  CBZ.battleRoster.kinds(u, n).forEach(function (e) {
    const had = L.find(function (x) { return x.id === e.id; });
    if (had) had.n += e.n; else L.push({ id: e.id, n: e.n });
  });
  FORCE[t] = L.length ? L : [{ id: "men", n: 30 }];
}
function forceWrite(t) {
  let L = FORCE[t].filter(function (e) { return e.n > 0; });
  if (!L.length) { L = [{ id: "men", n: 1 }]; FORCE[t] = L; }
  let u, n;
  if (L.length === 1) { u = L[0].id; n = L[0].n; }
  else {
    // machines first, the infantry last: the order they are put on the field
    const ord = L.slice().sort(function (a, b) { return (a.id === "men") - (b.id === "men"); });
    u = ord.map(function (e) { return e.id + "*" + e.n; }).join(",");
    n = ord.reduce(function (s0, e) { return s0 + e.n; }, 0);
  }
  setKind(el(t + "U"), u);
  el(t + "N").value = n;
  kindRows(t);
}
function forceBump(t, id, by) {
  let e = FORCE[t].find(function (x) { return x.id === id; });
  if (!e) { e = { id: id, n: 0 }; FORCE[t].push(e); }
  if (by === 0) e.n = 0;
  else if (Math.abs(by) === 1 && !forceIsMachine(id)) e.n = e.n < 1 ? 10 : stepCount(e.n, by);
  else e.n = Math.max(0, e.n + by);
  if (e.n <= 0) FORCE[t] = FORCE[t].filter(function (x) { return x !== e; });
  forceWrite(t); forceDraw(t); menuTouched();
}
function forceDraw(t) {
  const box = el(t + "Force");
  box.innerHTML = FORCE[t].map(function (e) {
    return "<div class=\"fr\" data-id=\"" + esc(e.id) + "\"><span class=\"fn\">" + esc(forceLabel(e.id)) + "</span>" +
      "<button type=\"button\" data-d=\"-1\" aria-label=\"fewer\">&minus;</button>" +
      "<input type=\"number\" inputmode=\"numeric\" min=\"0\" value=\"" + e.n + "\" aria-label=\"how many\">" +
      "<button type=\"button\" data-d=\"1\" aria-label=\"more\">+</button>" +
      "<button type=\"button\" class=\"fx\" data-d=\"0\" aria-label=\"remove\">&times;</button></div>";
  }).join("");
}
CBZ.npcwar.onBoot(function () {
  const MAN = CBZ.UNIT_MANIFEST || {};
  ["red", "blue"].forEach(function (t) {
    forceRead(t); forceWrite(t); forceDraw(t);
    const box = el(t + "Force");
    box.addEventListener("click", function (ev) {
      const b = ev.target.closest && ev.target.closest("button"), row = ev.target.closest && ev.target.closest(".fr");
      if (!b || !row) return;
      forceBump(t, row.dataset.id, parseInt(b.dataset.d, 10));
    });
    box.addEventListener("change", function (ev) {
      const row = ev.target.closest && ev.target.closest(".fr");
      if (!row || ev.target.tagName !== "INPUT") return;
      const e = FORCE[t].find(function (x) { return x.id === row.dataset.id; });
      if (!e) return;
      e.n = Math.max(0, parseInt(ev.target.value, 10) || 0);
      if (e.n <= 0) FORCE[t] = FORCE[t].filter(function (x) { return x !== e; });
      forceWrite(t); forceDraw(t); menuTouched();
      ev.stopPropagation();
    });
    // the usual arms, one tap each; then anything else the game has
    const add = el(t + "Add");
    add.innerHTML = "<button type=\"button\" data-id=\"men\">+ INFANTRY</button>" +
      FORCE_QUICK.filter(function (q) { return !!MAN[q[0]]; }).map(function (q) {
        return "<button type=\"button\" data-id=\"" + q[0] + "\">+ " + q[1] + "</button>";
      }).join("") + "<select aria-label=\"add any unit\"></select>";
    const sel = add.querySelector("select");
    fillKind(sel, "");
    sel.insertAdjacentHTML("afterbegin", "<option value=\"\" selected>+ MORE</option>");
    sel.value = "";
    add.addEventListener("click", function (ev) {
      const b = ev.target.closest && ev.target.closest("button");
      if (b) forceBump(t, b.dataset.id, 1);
    });
    sel.addEventListener("change", function (ev) {
      const id = sel.value;
      sel.value = "";
      ev.stopPropagation();
      if (id) forceBump(t, id, forceIsMachine(id) ? 1 : 10);
    });
  });
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
  el("presets").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      ["red", "blue"].forEach(function (t) {
        let e = FORCE[t].find(function (x) { return x.id === "men"; });
        if (!e) { e = { id: "men", n: 0 }; FORCE[t].push(e); }
        e.n = parseInt(b.dataset.n, 10) || 30;
        forceWrite(t); forceDraw(t);
      });
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
  });
}
CBZ.npcwar.onBoot(function () {
  // the record of calls made on the end card (scoring.js) is kept; the war room no longer asks for one
  streak = (function () {
    try { return JSON.parse(localStorage.getItem("cbz-npcwar-streak") || "null"); } catch (e) { return null; }
  })();
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
