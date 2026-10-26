/* ============================================================
   battle/core/sides.js — A SIDE IS AN IDENTITY, NOT A COLOUR.

   Page-independent: no DOM. A side is what is ON it ("40 gorillas",
   "1 Bengal tiger", "200 soldiers", "1 man + 1 M1 Abrams"), and, when it is
   an army of people or machines, the NATION it fights for: that nation's
   name, flag (city/flags.js, the game's one flag system) and colour.

   The two side SLOTS are still keyed "red" and "blue" inside the sim (every
   ledger, the front's postMessage protocol and the node tools read those
   keys). Those are slot ids, A and B, and they are never shown: everything
   a player reads comes from here.

   PUBLIC
     CBZ.battleSides.make({ roster, n, tier, nation, slot, color }) -> side
       side = { slot, roster, n, parts:[{id,n}], label, short, title,
                nation, flagId, army, beasts, vehicles, color, plural }
     CBZ.battleSides.versus(a, b) -> { a: name, b: name }  the names to SHOW,
                disambiguated (two sides of "30 soldiers" become the nations)
     CBZ.battleSides.wins(name, plural) -> "40 GORILLAS WIN" / "KESH WINS"
     CBZ.battleSides.menWord(tier, n) -> "soldiers" | "men" | ...
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  // what a body of armed people is called, by its training (TRAININGS ids)
  const MEN_WORD = {
    civ: ["man", "men"], thug: ["man", "men"], pro: ["man", "men"],
    elite: ["soldier", "soldiers"], swat: ["SWAT officer", "SWAT officers"],
  };
  function menWord(tier, n) { const w = MEN_WORD[tier] || MEN_WORD.civ; return n === 1 ? w[0] : w[1]; }
  // a real country's men under arms are its soldiers, an armed group's its
  // fighters, whatever their training (battle/core/countries.js)
  function menWordFor(tier, n, nation) {
    const RC = nation && CBZ.countries && CBZ.countries.get ? CBZ.countries.get(nation) : null;
    if (RC && tier !== "civ" && tier !== "swat") return RC.kind === "group" ? (n === 1 ? "fighter" : "fighters") : (n === 1 ? "soldier" : "soldiers");
    return menWord(tier, n);
  }

  function nationName(id) {
    if (!id) return null;
    // a real country or force goes by its short name on the field ("USA",
    // "IRGC"); the picker shows the full one
    const RC = CBZ.countries && CBZ.countries.get ? CBZ.countries.get(id) : null;
    if (RC) return RC.short || RC.name;
    try { if (CBZ.flags && CBZ.flags.designFor) { const d = CBZ.flags.designFor(id); if (d && d.name) return d.name; } } catch (e) {}
    return String(id).replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function make(o) {
    const R = CBZ.battleRoster, K = CBZ.unitKit;
    const parts = R.kinds(o.roster, o.n);
    let army = false, beasts = false, vehicles = false;
    const words = parts.map(function (p) {
      const kind = p.id === "men" ? "men" : (K ? K.kindOf(p.id) : "species");
      if (kind === "men") { army = true; return p.n + " " + menWordFor(o.tier, p.n, o.nation); }
      if (kind === "vehicle") { army = true; vehicles = true; }
      else beasts = true;
      return K ? K.label(p.id, p.n) : p.n + " " + p.id;
    });
    const label = words.join(" + ");
    const total = parts.reduce(function (s, p) { return s + p.n; }, 0);
    const nation = army ? (o.nation || null) : null;
    return {
      slot: o.slot || null, roster: R.str(o.roster), n: total, parts: parts,
      label: label,                         // "1 man + 1 M1 Abrams"
      short: label,                         // what a HUD chip says
      title: nation ? nationName(nation) : null,
      nation: nation, flagId: nation, army: army, beasts: beasts, vehicles: vehicles,
      color: o.color, plural: !(parts.length === 1 && parts[0].n === 1),
    };
  }
  // the two names a viewer reads. Two sides that SAY the same thing ("30
  // soldiers" v "30 soldiers") are told apart by the nation they fight for.
  function versus(a, b) {
    // two armies of two countries are the countries: "USA" v "IRGC", the
    // head counts underneath
    if (a.army && b.army && a.title && b.title && a.title !== b.title && !a.beasts && !b.beasts) return { a: a.title, b: b.title, byNation: true };
    if (a.label === b.label && a.title && b.title && a.title !== b.title) return { a: a.title, b: b.title, byNation: true };
    return { a: a.label, b: b.label, byNation: false };
  }
  function wins(name, plural) { return String(name).toUpperCase() + (plural ? " WIN" : " WINS"); }

  CBZ.battleSides = { make: make, versus: versus, wins: wins, menWord: menWord, nationName: nationName };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleSides;
})();
